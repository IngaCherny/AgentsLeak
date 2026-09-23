"""Turn-end (reply) capture in the Cursor, Codex, Gemini CLI and Windsurf adapters.

Each adapter maps its agent's turn-end event to POST /api/collect/stop with the
reply as ``reply`` (see apply_reply_capture in hooks/common.sh). Payload shapes
follow each agent's published hooks reference.
"""

from __future__ import annotations

import json
import os
import subprocess
import time
from pathlib import Path
from typing import Any

import pytest

from tests.test_stop_capture import HOOKS, needs_jq


def run_adapter(
    tmp_path: Path, server: Any, script: str, payload: dict[str, Any], **env: str
) -> tuple[str, dict[str, Any], str]:
    """Run an adapter; return (collector path, body it sent, adapter stdout)."""
    home = tmp_path / "home"
    home.mkdir(exist_ok=True)
    port = server.server_address[1]
    proc = subprocess.run(
        ["bash", str(HOOKS / script)],
        input=json.dumps(payload), capture_output=True, text=True, check=True, timeout=10,
        env={**os.environ, "HOME": str(home), "AGENTSLEAK_SERVER": f"http://127.0.0.1:{port}", **env},
    )
    deadline = time.time() + 10
    while not server.received and time.time() < deadline:
        time.sleep(0.05)
    assert server.received, f"{script} sent nothing"
    path, body = server.received[0]
    return path, body, proc.stdout


@needs_jq
class TestAgentStopAdapters:
    def test_codex_stop(self, tmp_path, collector):
        path, body, out = run_adapter(tmp_path, collector, "codex-hook.sh", {
            "hook_event_name": "Stop",
            "session_id": "codex-1",
            "turn_id": "turn-7",
            "cwd": "/work",
            "transcript_path": None,
            "stop_hook_active": False,
            "last_assistant_message": "Tests pass now.",
        })
        assert path == "/api/collect/stop"
        assert body["hook_type"] == "Stop"
        assert body["session_id"] == "codex-1"
        assert body["reply"] == "Tests pass now."
        assert body["notes"] == [] and body["capture_truncated"] is False
        assert body["_codex"]["turn_id"] == "turn-7"
        # Codex expects JSON on stdout from Stop.
        assert json.loads(out) == {}

    def test_gemini_after_agent(self, tmp_path, collector):
        path, body, _ = run_adapter(tmp_path, collector, "gemini-hook.sh", {
            "hook_event_name": "AfterAgent",
            "session_id": "gem-1",
            "cwd": "/work",
            "transcript_path": "/tmp/t.json",
            "timestamp": "2026-01-01T00:00:00Z",
            "prompt": "fix it",
            "prompt_response": "Fixed the import.",
            "stop_hook_active": False,
        })
        assert path == "/api/collect/stop"
        assert body["hook_type"] == "Stop"
        assert body["reply"] == "Fixed the import."
        assert body["session_source"] == "gemini"

    def test_windsurf_post_cascade_response(self, tmp_path, collector):
        path, body, _ = run_adapter(tmp_path, collector, "windsurf-hook.sh", {
            "agent_action_name": "post_cascade_response",
            "trajectory_id": "traj-1",
            "execution_id": "exec-1",
            "timestamp": "2026-01-01T00:00:00Z",
            "tool_info": {"response": "### Planner Response\n\nDone."},
        })
        assert path == "/api/collect/stop"
        assert body["hook_type"] == "Stop"
        assert body["session_id"] == "traj-1"
        assert body["reply"] == "### Planner Response\n\nDone."

    def test_cursor_after_agent_response(self, tmp_path, collector):
        path, body, _ = run_adapter(tmp_path, collector, "cursor-hook.sh", {
            "hook_event_name": "afterAgentResponse",
            "conversation_id": "cur-1",
            "generation_id": "gen-1",
            "workspace_roots": ["/work"],
            "text": "Renamed the function.",
        })
        assert path == "/api/collect/stop"
        assert body["hook_type"] == "Stop"
        assert body["session_id"] == "cur-1"
        assert body["reply"] == "Renamed the function."

    def test_cursor_stop_ends_the_turn_not_the_session(self, tmp_path, collector):
        path, body, out = run_adapter(tmp_path, collector, "cursor-hook.sh", {
            "hook_event_name": "stop",
            "conversation_id": "cur-1",
            "workspace_roots": ["/work"],
            "status": "completed",
            "loop_count": 0,
        })
        assert path == "/api/collect/stop"
        assert body["hook_type"] == "Stop"
        assert body["reply"] is None
        assert body["_cursor"]["status"] == "completed"
        assert json.loads(out) == {}

    def test_reply_is_capped(self, tmp_path, collector):
        _, body, _ = run_adapter(
            tmp_path, collector, "gemini-hook.sh",
            {"hook_event_name": "AfterAgent", "session_id": "gem-1", "prompt_response": "y" * 50},
            AGENTSLEAK_MAX_REPLY_CHARS="10",
        )
        assert body["reply"] == "y" * 10
        assert body["capture_truncated"] is True

    def test_capture_disabled_sends_marker_without_text(self, tmp_path, collector):
        _, body, _ = run_adapter(
            tmp_path, collector, "codex-hook.sh",
            {"hook_event_name": "Stop", "session_id": "codex-1", "last_assistant_message": "secret"},
            AGENTSLEAK_CAPTURE_RESPONSES="0",
        )
        assert body["hook_type"] == "Stop"
        assert body["reply"] is None
        assert "secret" not in json.dumps(body)


@pytest.mark.parametrize("installer,event", [
    ("install-codex.sh", "Stop"),
    ("install-gemini.sh", "AfterAgent"),
    ("install-windsurf.sh", "post_cascade_response"),
    ("install-cursor.sh", "afterAgentResponse"),
])
def test_installers_register_the_turn_end_event(installer, event):
    assert f"{event}:" in (HOOKS / installer).read_text()
