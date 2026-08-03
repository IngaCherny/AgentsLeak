"""FastAPI routes for collecting events from Claude Code hooks."""

from __future__ import annotations

import logging
import re
from typing import Any

from fastapi import APIRouter, Depends, Request

from agentsleak.engine.processor import Engine, get_engine
from agentsleak.models.events import Event, HookPayload, Session
from agentsleak.store.database import Database, get_database

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/collect", tags=["collector"])


def _resolve_endpoint_fields(
    payload: HookPayload,
    request: Request | None = None,
) -> tuple[str | None, str | None]:
    """Resolve endpoint_hostname and endpoint_user from payload or headers.

    Returns (endpoint_hostname, endpoint_user).
    """
    hostname = payload.endpoint_hostname
    user = payload.endpoint_user
    if request is not None:
        if not hostname:
            hostname = request.headers.get("X-Endpoint-Hostname")
        if not user:
            user = request.headers.get("X-Endpoint-User")
    return hostname, user


def _resolve_session_source(
    payload: HookPayload,
    request: Request | None = None,
) -> str:
    """Resolve session_source from payload or headers. Defaults to 'claude_code'."""
    source = payload.session_source
    if not source and request is not None:
        source = request.headers.get("X-AgentsLeak-Source")
    return source or "claude_code"


def _create_or_update_session(
    payload: HookPayload,
    db: Database,
    request: Request | None = None,
) -> Session:
    """Create or update a session from a hook payload."""
    session = db.get_session_by_id(payload.session_id)

    if session is None:
        hostname, user = _resolve_endpoint_fields(payload, request)
        source = _resolve_session_source(payload, request)
        session = Session(
            session_id=payload.session_id,
            cwd=payload.session_cwd,
            parent_session_id=payload.parent_session_id,
            endpoint_hostname=hostname,
            endpoint_user=user,
            session_source=source,
        )
        db.save_session(session)
        logger.info(f"Created new session: {payload.session_id}")

    return session


@router.post("/pre-tool-use", response_model=dict[str, Any])
async def collect_pre_tool_use(
    payload: HookPayload,
    request: Request,
    db: Database = Depends(get_database),
    engine: Engine = Depends(get_engine),
) -> dict[str, Any]:
    """Collect pre-tool-use event and return a decision.

    This endpoint is called BEFORE a tool is executed.
    It can block, allow, or modify the tool execution.

    Returns Claude Code hook response format:
    - {"continue": null} - Allow execution
    - {"continue": {...}} - Allow with modified input
    - {"block": "reason"} - Block execution
    """
    logger.debug(f"PreToolUse: session={payload.session_id}, tool={payload.tool_name}")

    # Ensure session exists
    _create_or_update_session(payload, db, request)

    # Create and enqueue event
    event = Event.from_hook_payload(payload)
    event.hook_type = "PreToolUse"

    # Synchronously evaluate for blocking decision
    decision = await engine.evaluate_pre_tool(event)

    # Record whether the call was blocked so the UI can pair Pre→Block
    # without needing a separate alert join.
    if not decision.allow:
        event.blocked = True

    # Save event regardless of decision
    db.save_event(event)
    db.increment_session_event_count(payload.session_id)

    # Queue for async processing
    await engine.enqueue(event)

    return decision.to_hook_response()


@router.post("/post-tool-use")
async def collect_post_tool_use(
    payload: HookPayload,
    request: Request,
    db: Database = Depends(get_database),
    engine: Engine = Depends(get_engine),
) -> dict[str, Any]:
    """Collect post-tool-use event.

    This endpoint is called AFTER a tool is executed.
    Used for logging, analysis, and retroactive alerting.
    """
    logger.debug(f"PostToolUse: session={payload.session_id}, tool={payload.tool_name}")

    # Ensure session exists
    _create_or_update_session(payload, db, request)

    # Create event with result
    event = Event.from_hook_payload(payload)
    event.hook_type = "PostToolUse"

    # Save and queue for processing
    db.save_event(event)
    db.increment_session_event_count(payload.session_id)
    await engine.enqueue(event)

    return {"status": "received"}


@router.post("/session-start")
async def collect_session_start(
    payload: HookPayload,
    request: Request,
    db: Database = Depends(get_database),
    engine: Engine = Depends(get_engine),
) -> dict[str, Any]:
    """Collect session start event.

    Called when a new Claude Code session begins.
    """
    logger.info(f"SessionStart: {payload.session_id} in {payload.session_cwd}")

    # Create new session
    hostname, user = _resolve_endpoint_fields(payload, request)
    source = _resolve_session_source(payload, request)
    session = Session(
        session_id=payload.session_id,
        cwd=payload.session_cwd,
        parent_session_id=payload.parent_session_id,
        started_at=payload.timestamp,
        endpoint_hostname=hostname,
        endpoint_user=user,
        session_source=source,
    )
    db.save_session(session)

    # Create session start event
    event = Event.from_hook_payload(payload)
    event.hook_type = "SessionStart"
    db.save_event(event)
    db.increment_session_event_count(payload.session_id)
    await engine.enqueue(event)

    return {"status": "session_started", "session_id": payload.session_id}


@router.post("/session-end")
async def collect_session_end(
    payload: HookPayload,
    request: Request,
    db: Database = Depends(get_database),
    engine: Engine = Depends(get_engine),
) -> dict[str, Any]:
    """Collect session end event.

    Called when a Claude Code session ends.
    """
    logger.info(f"SessionEnd: {payload.session_id}")

    # Create session end event
    event = Event.from_hook_payload(payload)
    event.hook_type = "SessionEnd"
    db.save_event(event)
    # Count the event first — this re-activates the session (un-stale on activity) —
    # then end the session LAST so the 'ended' status is the final state. Ending
    # before the increment would let increment_session_event_count flip it back to
    # 'active', leaving a closed session counted as active.
    db.increment_session_event_count(payload.session_id)
    db.end_session(payload.session_id)
    await engine.enqueue(event)

    return {"status": "session_ended", "session_id": payload.session_id}


@router.post("/subagent-start")
async def collect_subagent_start(
    payload: HookPayload,
    request: Request,
    db: Database = Depends(get_database),
    engine: Engine = Depends(get_engine),
) -> dict[str, Any]:
    """Collect subagent start event.

    Called when a subagent is spawned from a parent session.
    """
    logger.info(
        f"SubagentStart: {payload.session_id} (parent: {payload.parent_session_id})"
    )

    # Create new session for subagent
    hostname, user = _resolve_endpoint_fields(payload, request)
    source = _resolve_session_source(payload, request)
    session = Session(
        session_id=payload.session_id,
        cwd=payload.session_cwd,
        parent_session_id=payload.parent_session_id,
        started_at=payload.timestamp,
        endpoint_hostname=hostname,
        endpoint_user=user,
        session_source=source,
    )
    db.save_session(session)

    # Create subagent start event
    event = Event.from_hook_payload(payload)
    event.hook_type = "SubagentStart"
    db.save_event(event)
    db.increment_session_event_count(payload.session_id)
    await engine.enqueue(event)

    return {
        "status": "subagent_started",
        "session_id": payload.session_id,
        "parent_session_id": payload.parent_session_id,
    }


@router.post("/post-tool-use-error")
async def collect_post_tool_use_error(
    payload: HookPayload,
    request: Request,
    db: Database = Depends(get_database),
    engine: Engine = Depends(get_engine),
) -> dict[str, Any]:
    """Collect post-tool-use-error event.

    Called when a tool execution fails.
    """
    logger.debug(f"PostToolUseError: session={payload.session_id}, tool={payload.tool_name}")

    # Ensure session exists
    _create_or_update_session(payload, db, request)

    # Create event with error info
    event = Event.from_hook_payload(payload)
    event.hook_type = "PostToolUseFailure"

    # Save and queue for processing
    db.save_event(event)
    db.increment_session_event_count(payload.session_id)
    await engine.enqueue(event)

    return {"status": "received"}


@router.post("/permission-request")
async def collect_permission_request(
    payload: HookPayload,
    request: Request,
    db: Database = Depends(get_database),
    engine: Engine = Depends(get_engine),
) -> dict[str, Any]:
    """Collect permission request event.

    Called when Claude Code prompts the user for permission.
    Tracks approve/deny decisions for rubber-stamping detection.
    """
    logger.debug(f"PermissionRequest: session={payload.session_id}, tool={payload.tool_name}")

    # Ensure session exists
    _create_or_update_session(payload, db, request)

    # Create event
    event = Event.from_hook_payload(payload)
    event.hook_type = "PermissionRequest"

    # Save and queue for processing
    db.save_event(event)
    db.increment_session_event_count(payload.session_id)
    await engine.enqueue(event)

    return {"status": "received"}


# A command name is letters/digits plus - _ : (plugin skills look like
# "plugin:skill"). Anything else — a slash, a dot, a space — means the token
# isn't a command, so a pasted path like "/Users/x/notes.txt ..." is not
# mistaken for a "/Users..." skill.
_COMMAND_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_:-]{0,63}$")


def _parse_slash_command(prompt: str) -> tuple[str, str] | None:
    """Parse a leading slash command out of a user prompt.

    ``"/code-review high"`` -> ``("code-review", "high")``,
    ``"/verify"`` -> ``("verify", "")``, ``"just text"`` -> ``None``.
    The slash must be immediately followed by a command-shaped name; a pasted
    path (``"/Users/x/notes.txt what is this"``) returns ``None``.
    """
    stripped = prompt.strip()
    if not stripped.startswith("/"):
        return None
    body = stripped[1:]
    if not body or body[0].isspace():
        return None
    parts = body.split(None, 1)
    name = parts[0]
    if not _COMMAND_NAME_RE.match(name):
        return None
    args = parts[1].strip() if len(parts) > 1 else ""
    return name, args


@router.post("/user-prompt-submit")
async def collect_user_prompt_submit(
    payload: HookPayload,
    request: Request,
    db: Database = Depends(get_database),
    engine: Engine = Depends(get_engine),
) -> dict[str, Any]:
    """Collect user prompt submit event.

    Called when a user submits a prompt to Claude Code.
    Used for audit trail and prompt injection detection.
    """
    logger.debug(f"UserPromptSubmit: session={payload.session_id}")

    # Ensure session exists
    _create_or_update_session(payload, db, request)

    # Create event — the prompt event is kept intact for audit fidelity
    # ("what did the user actually type"). We do NOT rewrite it into a Skill.
    event = Event.from_hook_payload(payload)
    event.hook_type = "UserPromptSubmit"

    db.save_event(event)
    db.increment_session_event_count(payload.session_id)
    await engine.enqueue(event)

    # A user-typed slash command ("/code-review high") is a skill/command
    # invocation that never passes through the Skill *tool*, so it produces no
    # PreToolUse event. Emit a *separate* Skill-shaped event so it surfaces in
    # the feed as "/<name>" alongside assistant-invoked skills — without
    # clobbering the original prompt event. The "invocation" marker keeps it
    # distinguishable from a real Skill tool call.
    prompt_text = (event.raw_payload or {}).get("prompt")
    parsed = _parse_slash_command(prompt_text) if isinstance(prompt_text, str) else None
    if parsed is not None:
        name, args = parsed
        skill_event = Event.from_hook_payload(payload)
        skill_event.hook_type = "UserPromptSubmit"
        skill_event.tool_name = "Skill"
        skill_event.tool_input = {
            "skill": name,
            "args": args,
            "invocation": "slash_command",
        }
        db.save_event(skill_event)
        db.increment_session_event_count(payload.session_id)
        await engine.enqueue(skill_event)

    return {"status": "received"}


@router.post("/subagent-stop")
async def collect_subagent_stop(
    payload: HookPayload,
    request: Request,
    db: Database = Depends(get_database),
    engine: Engine = Depends(get_engine),
) -> dict[str, Any]:
    """Collect subagent stop event.

    Called when a subagent completes its task.
    Completes the subagent lifecycle pair (start → stop).
    """
    logger.info(f"SubagentStop: {payload.session_id}")

    # End the subagent session
    db.end_session(payload.session_id)

    # Create subagent stop event
    event = Event.from_hook_payload(payload)
    event.hook_type = "SubagentStop"
    db.save_event(event)
    db.increment_session_event_count(payload.session_id)
    await engine.enqueue(event)

    return {
        "status": "subagent_stopped",
        "session_id": payload.session_id,
    }


@router.post("/pre-compact")
async def collect_pre_compact(
    payload: HookPayload,
    request: Request,
    db: Database = Depends(get_database),
    engine: Engine = Depends(get_engine),
) -> dict[str, Any]:
    """Collect pre-compact event.

    Called BEFORE Claude Code compacts the conversation context.
    Compaction summarizes/discards earlier turns to fit the context window,
    so without this snapshot the audit trail has gaps at every boundary.
    """
    logger.info(f"PreCompact: session={payload.session_id}")

    # Ensure session exists
    _create_or_update_session(payload, db, request)

    # Create pre-compact event
    event = Event.from_hook_payload(payload)
    event.hook_type = "PreCompact"
    db.save_event(event)
    db.increment_session_event_count(payload.session_id)
    await engine.enqueue(event)

    return {"status": "received"}


@router.get("/health")
async def health_check() -> dict[str, str]:
    """Health check endpoint for the collector."""
    return {"status": "healthy", "service": "collector"}
