"""Tests for capturing Claude's replies and mid-turn notes (Stop hook).

Covers the three layers:
- hooks/lib/extract-turn.jq: pulls notes out of a Claude Code transcript
- hooks/stop.sh: builds the payload and sends it to the collector
- POST /api/collect/stop: stores it as a Stop event
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
from http.server import HTTPServer
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from agentsleak.collector.routes import collect_stop
from agentsleak.models.events import HookPayload
from agentsleak.store.database import Database

REPO = Path(__file__).resolve().parent.parent
HOOKS = REPO / "hooks"
FILTER = HOOKS / "lib" / "extract-turn.jq"

needs_jq = pytest.mark.skipif(shutil.which("jq") is None, reason="jq not installed")

PID = "prompt-1"


# -----------------------------------------------------------------------------
# Transcript builders (shapes match Claude Code's JSONL: one block per line)
# -----------------------------------------------------------------------------


def prompt(text: str, pid: str | None = PID) -> dict[str, Any]:
    entry: dict[str, Any] = {"type": "user", "isSidechain": False, "message": {"role": "user", "content": text}}
    if pid is not None:
        entry["promptId"] = pid
    return entry


def text(t: str, ts: str = "2026-01-01T00:00:00Z", sidechain: bool = False) -> dict[str, Any]:
    return {
        "type": "assistant",
        "isSidechain": sidechain,
        "timestamp": ts,
        "message": {"role": "assistant", "content": [{"type": "text", "text": t}]},
    }


def thinking() -> dict[str, Any]:
    return {"type": "assistant", "message": {"content": [{"type": "thinking", "thinking": "hmm"}]}}


def tool_use(tid: str, name: str = "Bash") -> dict[str, Any]:
    return {
        "type": "assistant",
        "message": {"content": [{"type": "tool_use", "id": tid, "name": name, "input": {}}]},
    }


def tool_result(tid: str, pid: str = PID) -> dict[str, Any]:
    return {
        "type": "user",
        "promptId": pid,
        "message": {"content": [{"type": "tool_result", "tool_use_id": tid, "content": "x" * 50}]},
    }


def noise() -> dict[str, Any]:
    return {"type": "file-history-snapshot", "snapshot": {}}


def run_filter(entries: list[dict[str, Any]], pid: str = PID, reply: str = "", note_max: int = 4000) -> dict[str, Any]:
    lines = "\n".join(json.dumps(e) for e in entries) + "\n"
    out = subprocess.run(
        ["jq", "-n", "-c", "--arg", "pid", pid, "--arg", "reply", reply,
         "--argjson", "note_max", str(note_max), "-f", str(FILTER)],
        input=lines, capture_output=True, text=True, check=True,
    )
    return json.loads(out.stdout)


# -----------------------------------------------------------------------------
# extract-turn.jq
# -----------------------------------------------------------------------------


@needs_jq
class TestExtractTurn:
    def test_notes_are_linked_to_the_tool_call_they_introduce(self):
        result = run_filter([
            prompt("fix it"),
            thinking(),
            text("Let me look at the test."),
            tool_use("t1"),
            tool_result("t1"),
            text("Found it."),
            text("Editing now."),
            tool_use("t2"),
            tool_result("t2"),
        ])
        assert [(n["text"], n["before_tool_use_id"]) for n in result["notes"]] == [
            ("Let me look at the test.", "t1"),
            ("Found it.", "t2"),
            ("Editing now.", "t2"),
        ]
        assert result["truncated"] is False

    def test_final_reply_is_not_repeated_as_a_note(self):
        result = run_filter(
            [prompt("go"), text("Checking."), tool_use("t1"), tool_result("t1"), text("All done.")],
            reply="All done.",
        )
        assert [n["text"] for n in result["notes"]] == ["Checking."]

    def test_text_after_last_tool_call_that_is_not_the_reply_is_kept(self):
        result = run_filter(
            [prompt("go"), tool_use("t1"), tool_result("t1"), text("Interim remark."), text("Reply.")],
            reply="Reply.",
        )
        assert result["notes"] == [
            {"text": "Interim remark.", "before_tool_use_id": None, "timestamp": "2026-01-01T00:00:00Z"}
        ]

    def test_stops_at_the_next_prompt(self):
        result = run_filter([
            prompt("first"),
            text("First turn note."),
            tool_use("t1"),
            tool_result("t1"),
            prompt("second", pid="prompt-2"),
            text("Second turn note."),
            tool_use("t2"),
        ])
        assert [n["text"] for n in result["notes"]] == ["First turn note."]

    def test_ignores_thinking_sidechains_blank_text_and_other_entries(self):
        result = run_filter([
            prompt("go"),
            thinking(),
            noise(),
            text("   \n"),
            text("Subagent chatter.", sidechain=True),
            text("Real note."),
            tool_use("t1"),
        ])
        assert [n["text"] for n in result["notes"]] == ["Real note."]

    def test_prompt_with_array_content_starts_a_new_turn(self):
        image_prompt = {
            "type": "user",
            "promptId": "prompt-2",
            "message": {"content": [{"type": "text", "text": "look"}, {"type": "image"}]},
        }
        result = run_filter([prompt("first"), text("Mine."), tool_use("t1"), image_prompt, text("Not mine.")])
        assert [n["text"] for n in result["notes"]] == ["Mine."]

    def test_long_notes_are_truncated_and_flagged(self):
        result = run_filter([prompt("go"), text("abcdefghij"), tool_use("t1")], note_max=4)
        assert result["notes"][0]["text"] == "abcd"
        assert result["truncated"] is True

    def test_without_prompt_id_uses_the_last_prompt(self):
        # Older Claude Code: no promptId, and the input is just the file tail.
        result = run_filter(
            [
                prompt("old", pid=None),
                text("Old note."),
                tool_use("t0"),
                prompt("current", pid=None),
                text("Current note."),
                tool_use("t1"),
            ],
            pid="",
        )
        assert [n["text"] for n in result["notes"]] == ["Current note."]


# -----------------------------------------------------------------------------
# stop.sh end to end (against a local stand-in for the collector)
# -----------------------------------------------------------------------------


def run_stop_hook(tmp_path: Path, collector: HTTPServer, payload: dict[str, Any], **env: str) -> dict[str, Any]:
    home = tmp_path / "home"
    home.mkdir(exist_ok=True)
    port = collector.server_address[1]
    subprocess.run(
        ["bash", str(HOOKS / "stop.sh")],
        input=json.dumps(payload), text=True, check=True, timeout=10,
        env={**os.environ, "HOME": str(home), "AGENTSLEAK_SERVER": f"http://127.0.0.1:{port}", **env},
    )
    # The hook sends in the background; wait for it to arrive.
    deadline = time.time() + 10
    while not collector.received and time.time() < deadline:
        time.sleep(0.05)
    assert collector.received, "stop.sh sent nothing"
    path, body = collector.received[0]
    assert path == "/api/collect/stop"
    return body


@needs_jq
class TestStopHook:
    def _transcript(self, tmp_path: Path) -> Path:
        path = tmp_path / "transcript.jsonl"
        entries = [
            prompt("earlier", pid="prompt-0"),
            text("Earlier note."),
            tool_use("t0"),
            prompt("do it"),
            text("Running the tests."),
            tool_use("t1"),
            tool_result("t1"),
            text("Done, all green."),
        ]
        path.write_text("\n".join(json.dumps(e) for e in entries) + "\n")
        return path

    def _payload(self, transcript: Path, reply: str = "Done, all green.") -> dict[str, Any]:
        return {
            "session_id": "s1",
            "prompt_id": PID,
            "hook_event_name": "Stop",
            "transcript_path": str(transcript),
            "last_assistant_message": reply,
            "stop_hook_active": False,
        }

    def test_sends_reply_and_notes(self, tmp_path, collector):
        body = run_stop_hook(tmp_path, collector, self._payload(self._transcript(tmp_path)))
        assert body["reply"] == "Done, all green."
        assert [(n["text"], n["before_tool_use_id"]) for n in body["notes"]] == [("Running the tests.", "t1")]
        assert body["capture_truncated"] is False
        assert "last_assistant_message" not in body
        assert body["_event_type"] == "stop"

    def test_long_reply_is_capped(self, tmp_path, collector):
        body = run_stop_hook(
            tmp_path, collector, self._payload(self._transcript(tmp_path), reply="y" * 50),
            AGENTSLEAK_MAX_REPLY_CHARS="10",
        )
        assert body["reply"] == "y" * 10
        assert body["capture_truncated"] is True

    def test_capture_disabled_sends_marker_without_text(self, tmp_path, collector):
        body = run_stop_hook(
            tmp_path, collector, self._payload(self._transcript(tmp_path)),
            AGENTSLEAK_CAPTURE_RESPONSES="0",
        )
        assert body["reply"] is None
        assert body["notes"] == []
        assert "last_assistant_message" not in body

    def test_missing_transcript_still_sends_reply(self, tmp_path, collector):
        body = run_stop_hook(tmp_path, collector, self._payload(tmp_path / "nope.jsonl"))
        assert body["reply"] == "Done, all green."
        assert body["notes"] == []


# -----------------------------------------------------------------------------
# POST /api/collect/stop
# -----------------------------------------------------------------------------


@pytest.fixture
def db(tmp_path: Path) -> Database:
    settings = MagicMock()
    settings.db_path = tmp_path / "test.db"
    return Database(settings=settings)


@pytest.mark.asyncio
async def test_collect_stop_stores_reply_and_notes(db: Database) -> None:
    notes = [{"text": "Running the tests.", "before_tool_use_id": "t1", "timestamp": "2026-01-01T00:00:00Z"}]
    payload = HookPayload.model_validate({
        "session_id": "s1",
        "hook_event_name": "Stop",
        "prompt_id": PID,
        "reply": "Done.",
        "notes": notes,
        "capture_truncated": False,
    })
    engine = MagicMock()
    engine.enqueue = AsyncMock()
    request = MagicMock()
    request.headers = {}

    await collect_stop(payload, request, db=db, engine=engine)

    events = db.get_events(session_id="s1")
    assert len(events) == 1
    event = events[0]
    assert event.hook_type == "Stop"
    assert event.tool_result == {"reply": "Done.", "notes": notes, "truncated": False}
    # Text lives in tool_result only; the turn id stays in the raw payload.
    assert "reply" not in event.raw_payload and "notes" not in event.raw_payload
    assert event.raw_payload["prompt_id"] == PID
    engine.enqueue.assert_awaited_once()
