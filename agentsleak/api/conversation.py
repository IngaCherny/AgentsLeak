"""Group a session's events into conversation turns.

A turn is one user prompt and everything Claude did for it:

    prompt -> [note, step, step, note, step, ...] -> reply

- Turns are keyed by Claude Code's ``prompt_id``, which every hook payload of
  the turn carries. Events without one (older Claude Code) join the turn of
  the most recent prompt. A queued prompt (typed while Claude was busy) is
  re-numbered when it starts, so an id no prompt announced also joins the
  most recent prompt's turn.
- Steps merge the Pre/Post/Failure/Permission events of one tool call by
  ``tool_use_id``.
- The Stop event supplies the reply and Claude's mid-turn notes; each note
  goes before the step it introduces (``before_tool_use_id``). Other agents'
  turn-end events arrive as Stop too, with a reply and no notes.
- Tool calls made by a subagent (``agent_id``) nest under the Agent step that
  launched it.

Nothing here is stored: turns are rebuilt from events on every request.
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Any

from agentsleak.models.alerts import Alert
from agentsleak.models.events import Event

RESULT_PREVIEW_CHARS = 2000
SUMMARY_CHARS = 200
AGENT_REPLY_CHARS = 4000

SEVERITY_RANK = {"info": 0, "low": 1, "medium": 2, "high": 3, "critical": 4}

# Tool input fields that best describe a call, in order of preference.
_SUMMARY_FIELDS = (
    "command", "file_path", "notebook_path", "path", "pattern", "url",
    "query", "description", "skill", "prompt",
)

_TASK_NOTIFICATION_RE = re.compile(r"^\s*<task-notification>", re.IGNORECASE)


def _tag(text: str, name: str) -> str | None:
    match = re.search(rf"<{name}>(.*?)</{name}>", text, re.DOTALL)
    return match.group(1).strip() if match else None


def _raw(event: Event) -> dict[str, Any]:
    return event.raw_payload or {}


def _iso(ts: datetime | None) -> str | None:
    return ts.isoformat() if ts else None


def _duration_ms(start: datetime | None, end: datetime | None) -> int | None:
    if start is None or end is None:
        return None
    return max(0, int((end - start).total_seconds() * 1000))


def _max_severity(*values: str | None) -> str | None:
    present = [v for v in values if v]
    return max(present, key=lambda v: SEVERITY_RANK.get(v, 0)) if present else None


def _enum_value(value: Any) -> str:
    return value.value if hasattr(value, "value") else str(value)


def summarize_input(tool_input: dict[str, Any] | None) -> str:
    """One-line description of a tool call (its most telling argument)."""
    if not tool_input:
        return ""
    for field in _SUMMARY_FIELDS:
        value = tool_input.get(field)
        if isinstance(value, str) and value.strip():
            line = " ".join(value.split())
            return line[:SUMMARY_CHARS] + ("…" if len(line) > SUMMARY_CHARS else "")
    return ""


def preview_result(result: Any) -> tuple[str | None, bool]:
    """Readable text of a tool result, capped. Returns (text, truncated)."""
    if result is None:
        return None, False
    text: str
    if isinstance(result, dict):
        if "stdout" in result or "stderr" in result:
            text = "\n".join(s for s in (result.get("stdout"), result.get("stderr")) if s)
        elif isinstance(result.get("file"), dict) and isinstance(result["file"].get("content"), str):
            text = result["file"]["content"]
        elif isinstance(result.get("content"), str):
            text = result["content"]
        elif isinstance(result.get("result"), str):
            text = result["result"]
        else:
            text = json.dumps(result, indent=2, default=str)
    elif isinstance(result, str):
        text = result
    else:
        text = json.dumps(result, indent=2, default=str)
    if len(text) > RESULT_PREVIEW_CHARS:
        return text[:RESULT_PREVIEW_CHARS], True
    return text, False


class _Turn:
    def __init__(self, key: str, kind: str) -> None:
        self.key = key
        self.kind = kind  # "prompt" | "task_notification" | "session_start"
        self.prompt: dict[str, Any] | None = None
        self.task: dict[str, Any] | None = None
        self.items: list[dict[str, Any]] = []
        self.steps: dict[str, dict[str, Any]] = {}
        self.pending_permissions: list[Event] = []
        self.stop: Event | None = None
        self.started: datetime | None = None
        self.ended: datetime | None = None

    def touch(self, ts: datetime) -> None:
        if self.started is None or ts < self.started:
            self.started = ts
        if self.ended is None or ts > self.ended:
            self.ended = ts


def _new_step(event: Event) -> dict[str, Any]:
    return {
        "type": "step",
        "tool_use_id": event.tool_use_id,
        "tool_name": event.tool_name,
        "summary": summarize_input(event.tool_input),
        "input": event.tool_input,
        "status": "pending",
        "result_preview": None,
        "result_truncated": False,
        "error": None,
        "started_at": _iso(event.timestamp),
        "ended_at": None,
        "duration_ms": None,
        "permission_requested": False,
        "event_ids": [],
        "alerts": [],
        "severity": None,
        "agent_id": _raw(event).get("agent_id"),
        "agent_type": _raw(event).get("agent_type"),
        "launched_agent_id": None,
        "agent_reply": None,
        "children": [],
        "_start": event.timestamp,
    }


def _apply_to_step(step: dict[str, Any], event: Event) -> None:
    step["event_ids"].append(str(event.id))
    step["severity"] = _max_severity(step["severity"], _enum_value(event.severity))
    if step["tool_name"] is None:
        step["tool_name"] = event.tool_name
    if step["input"] is None and event.tool_input:
        step["input"] = event.tool_input
        step["summary"] = summarize_input(event.tool_input)

    hook = event.hook_type
    if hook == "PreToolUse":
        step["started_at"] = _iso(event.timestamp)
        step["_start"] = event.timestamp
        if event.blocked:
            step["status"] = "blocked"
    elif hook == "PostToolUse":
        if step["status"] != "blocked":
            step["status"] = "ok"
        step["result_preview"], step["result_truncated"] = preview_result(event.tool_result)
        step["ended_at"] = _iso(event.timestamp)
        step["duration_ms"] = _raw(event).get("duration_ms") or _duration_ms(step["_start"], event.timestamp)
        if isinstance(event.tool_result, dict) and event.tool_result.get("agentId"):
            step["launched_agent_id"] = event.tool_result["agentId"]
    elif hook == "PostToolUseFailure":
        if step["status"] != "blocked":
            step["status"] = "error"
        raw = _raw(event)
        error = raw.get("error") or (event.tool_result or {}).get("error")
        step["error"] = str(error)[:RESULT_PREVIEW_CHARS] if error else "Tool call failed"
        step["ended_at"] = _iso(event.timestamp)
        step["duration_ms"] = _duration_ms(step["_start"], event.timestamp)
    elif hook == "PermissionRequest":
        step["permission_requested"] = True


def _parse_task_notification(text: str) -> dict[str, Any]:
    return {
        "task_id": _tag(text, "task-id"),
        "tool_use_id": _tag(text, "tool-use-id"),
        "status": _tag(text, "status"),
        "summary": _tag(text, "summary"),
        "result": (_tag(text, "result") or "")[:AGENT_REPLY_CHARS] or None,
    }


def build_conversation(
    events: list[Event],
    alerts: list[Alert],
    session_active: bool,
) -> dict[str, Any]:
    """Group a session's events (oldest first) into conversation turns."""
    alerts_by_event: dict[str, list[dict[str, Any]]] = {}
    for alert in alerts:
        summary = {
            "id": str(alert.id),
            "title": alert.title,
            "severity": _enum_value(alert.severity),
            "blocked": alert.blocked,
        }
        for event_id in alert.event_ids:
            alerts_by_event.setdefault(str(event_id), []).append(summary)

    turns: dict[str, _Turn] = {}
    order: list[str] = []
    current: str | None = None
    aliases: dict[str, str] = {}
    agent_replies: dict[str, str] = {}
    replies_captured = any(e.hook_type == "Stop" for e in events)

    def turn_for(key: str, kind: str = "prompt") -> _Turn:
        if key not in turns:
            turns[key] = _Turn(key, kind)
            order.append(key)
        return turns[key]

    for event in events:
        raw = _raw(event)
        prompt_id = raw.get("prompt_id")
        hook = event.hook_type

        if hook == "UserPromptSubmit":
            key = prompt_id or f"event:{event.id}"
            if event.tool_name == "Skill":
                # Synthetic slash-command event: a badge on its prompt.
                turn = turn_for(prompt_id or current or key)
                if turn.prompt is not None:
                    turn.prompt["slash_command"] = (event.tool_input or {}).get("skill")
                continue
            # Claude Code sends `prompt`; the other agents' adapters send `query`.
            prompt_text = raw.get("prompt") or raw.get("query")
            text = prompt_text if isinstance(prompt_text, str) else ""
            if _TASK_NOTIFICATION_RE.match(text):
                turn = turn_for(key, "task_notification")
                turn.task = _parse_task_notification(text)
            else:
                turn = turn_for(key)
                turn.kind = "prompt"
                turn.prompt = {
                    "text": text,
                    "timestamp": _iso(event.timestamp),
                    "event_id": str(event.id),
                    "slash_command": None,
                }
            turn.touch(event.timestamp)
            current = key
            continue

        if hook in ("SessionStart", "SessionEnd"):
            continue

        if prompt_id and prompt_id not in turns and current is not None:
            aliases.setdefault(prompt_id, current)
        if prompt_id:
            key = aliases.get(prompt_id, prompt_id)
        elif current:
            key = current
        else:
            key = "session-start"
        turn = turn_for(key, "session_start" if key == "session-start" else "prompt")
        turn.touch(event.timestamp)

        if hook == "Stop":
            # Some agents end a turn twice (Cursor: afterAgentResponse with the
            # reply, then stop without it); a text-less one never replaces a reply.
            if turn.stop is None or (event.tool_result or {}).get("reply"):
                turn.stop = event
            continue
        if hook == "SubagentStop":
            reply = raw.get("last_assistant_message")
            if raw.get("agent_id") and isinstance(reply, str):
                agent_replies[raw["agent_id"]] = reply[:AGENT_REPLY_CHARS]
            continue
        if hook == "SubagentStart":
            continue
        if hook == "PreCompact":
            turn.items.append({"type": "divider", "kind": "compact", "timestamp": _iso(event.timestamp)})
            continue
        if hook not in ("PreToolUse", "PostToolUse", "PostToolUseFailure", "PermissionRequest"):
            continue

        tool_use_id = event.tool_use_id
        if hook == "PermissionRequest" and not tool_use_id:
            # No id: attach to the next call of the same tool in this turn.
            turn.pending_permissions.append(event)
            continue

        step_key = tool_use_id or f"event:{event.id}"
        step = turn.steps.get(step_key)
        if step is None:
            step = _new_step(event)
            turn.steps[step_key] = step
            turn.items.append(step)
            for pending in list(turn.pending_permissions):
                if pending.tool_name == event.tool_name:
                    _apply_to_step(step, pending)
                    turn.pending_permissions.remove(pending)
                    break
        _apply_to_step(step, event)

    # Nest subagent steps under the Agent step that launched them.
    launched: dict[str, dict[str, Any]] = {}
    for turn in turns.values():
        for step in turn.steps.values():
            if step["launched_agent_id"]:
                launched[step["launched_agent_id"]] = step
    for turn in turns.values():
        kept = []
        for item in turn.items:
            parent = launched.get(item.get("agent_id") or "") if item["type"] == "step" else None
            if parent is not None and parent is not item:
                parent["children"].append(item)
            else:
                kept.append(item)
        turn.items = kept
    for agent_id, step in launched.items():
        step["agent_reply"] = agent_replies.get(agent_id)

    # Alerts, notes, reply, status.
    result_turns: list[dict[str, Any]] = []
    session_alert_ids: set[str] = set()
    for index, key in enumerate(order):
        turn = turns[key]
        is_last = index == len(order) - 1

        all_steps = list(turn.steps.values())
        for step in all_steps:
            seen: set[str] = set()
            for event_id in step["event_ids"]:
                for alert in alerts_by_event.get(event_id, []):
                    if alert["id"] not in seen:
                        seen.add(alert["id"])
                        step["alerts"].append(alert)
                        step["severity"] = _max_severity(step["severity"], alert["severity"])

        reply = None
        items = turn.items
        if turn.stop is not None:
            captured = turn.stop.tool_result or {}
            notes = [n for n in captured.get("notes") or [] if isinstance(n, dict) and n.get("text")]
            step_ids = {item.get("tool_use_id") for item in items if item["type"] == "step"}
            before: dict[str, list[dict[str, Any]]] = {}
            trailing: list[dict[str, Any]] = []
            for note in notes:
                item = {"type": "note", "text": note["text"], "timestamp": note.get("timestamp")}
                target = note.get("before_tool_use_id")
                if target and target in step_ids:
                    before.setdefault(target, []).append(item)
                else:
                    trailing.append(item)
            merged: list[dict[str, Any]] = []
            for item in items:
                if item["type"] == "step":
                    merged.extend(before.get(item.get("tool_use_id") or "", []))
                merged.append(item)
            items = merged + trailing
            if captured.get("reply"):
                reply = {
                    "text": captured["reply"],
                    "truncated": bool(captured.get("truncated")),
                    "timestamp": _iso(turn.stop.timestamp),
                    "event_id": str(turn.stop.id),
                }

        if turn.stop is not None:
            status = "complete"
        elif is_last and session_active:
            status = "in_progress"
        elif turn.kind == "session_start" or not replies_captured:
            # Without any Stop events (hooks predate reply capture) a finished
            # turn can't be told apart from an interrupted one.
            status = "complete"
        else:
            status = "interrupted"

        blocked = sum(1 for s in all_steps if s["status"] == "blocked")
        errors = sum(1 for s in all_steps if s["status"] == "error")
        alert_ids = {a["id"] for s in all_steps for a in s["alerts"]}
        session_alert_ids |= alert_ids
        severity = _max_severity(*(s["severity"] for s in all_steps if s["alerts"] or s["status"] == "blocked"))

        for step in all_steps:
            step.pop("_start", None)
            if step["status"] == "pending" and status != "in_progress":
                step["status"] = "no_result"

        result_turns.append({
            "index": index + 1,
            "prompt_id": None if key.startswith(("event:", "session-start")) else key,
            "kind": turn.kind,
            "prompt": turn.prompt,
            "task": turn.task,
            "status": status,
            "started_at": _iso(turn.started),
            "ended_at": _iso(turn.ended),
            "duration_ms": _duration_ms(turn.started, turn.ended),
            "items": items,
            "reply": reply,
            "counts": {
                "steps": len(all_steps),
                "blocked": blocked,
                "errors": errors,
                "alerts": len(alert_ids),
            },
            "severity": severity,
        })

    return {
        "replies_captured": replies_captured,
        "turns": result_turns,
        "totals": {
            "turns": sum(1 for t in result_turns if t["kind"] == "prompt"),
            "steps": sum(t["counts"]["steps"] for t in result_turns),
            "blocked": sum(t["counts"]["blocked"] for t in result_turns),
            "alerts": len(session_alert_ids),
        },
    }
