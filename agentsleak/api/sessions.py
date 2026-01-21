"""Session API routes for AgentsLeak."""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from agentsleak.models.events import Event, EventCategory
from agentsleak.store.database import Database, get_database

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/sessions", tags=["sessions"])


# =============================================================================
# Response Models
# =============================================================================


class SessionSummary(BaseModel):
    """Summary of a session for list view."""

    id: UUID
    session_id: str
    started_at: datetime
    ended_at: datetime | None
    cwd: str | None
    parent_session_id: str | None
    event_count: int
    alert_count: int
    risk_score: int = 0
    status: str
    endpoint_hostname: str | None = None
    endpoint_user: str | None = None
    session_source: str | None = None


class SessionDetail(SessionSummary):
    """Detailed session information."""

    events_by_category: dict[str, int] = Field(default_factory=dict)
    events_by_severity: dict[str, int] = Field(default_factory=dict)
    alerts_by_severity: dict[str, int] = Field(default_factory=dict)
    first_event_at: datetime | None = None
    last_event_at: datetime | None = None


class SessionListResponse(BaseModel):
    """Response for session list endpoint."""

    items: list[SessionSummary]
    total: int
    page: int
    page_size: int
    pages: int


class TimelineEntry(BaseModel):
    """Entry in session timeline."""

    timestamp: datetime
    event_type: str
    tool_name: str | None
    category: str
    severity: str
    description: str
    event_id: UUID
    has_alert: bool = False


class SessionTimelineResponse(BaseModel):
    """Response for session timeline endpoint."""

    session_id: str
    entries: list[TimelineEntry]
    total_events: int
    total_alerts: int


# =============================================================================
# Endpoints
# =============================================================================


@router.get("", response_model=SessionListResponse)
async def list_sessions(
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(20, ge=1, le=100, description="Items per page"),
    status: str | None = Query(None, description="Filter by status (active, ended)"),
    hostname: str | None = Query(None, description="Filter by hostname"),
    endpoint: str | None = Query(None, description="Filter by endpoint hostname"),
    username: str | None = Query(None, description="Filter by username"),
    session_source: str | None = Query(None, description="Filter by session source (claude_code, cursor)"),
    from_date: datetime | None = Query(None, description="Filter from date"),
    to_date: datetime | None = Query(None, description="Filter to date"),
    db: Database = Depends(get_database),
) -> SessionListResponse:
    """List sessions with pagination and filters."""
    # The 'endpoint' parameter is an alias for hostname filtering
    effective_hostname = hostname or endpoint
    result = db.get_sessions_paginated(
        page=page,
        page_size=page_size,
        status=status,
        hostname=effective_hostname,
        username=username,
        from_date=from_date,
        to_date=to_date,
        session_source=session_source,
    )

    # Compute actual event/alert counts for listed sessions
    session_ids = [s.session_id for s in result["items"]]
    event_counts = db.get_event_counts_by_session(session_ids) if session_ids else {}
    alert_counts = db.get_alert_counts_by_session(session_ids) if session_ids else {}

    items = [
        SessionSummary(
            id=s.id,
            session_id=s.session_id,
            started_at=s.started_at,
            ended_at=s.ended_at,
            cwd=s.cwd,
            parent_session_id=s.parent_session_id,
            event_count=event_counts.get(s.session_id, s.event_count),
            alert_count=alert_counts.get(s.session_id, s.alert_count),
            risk_score=s.risk_score,
            status=s.status,
            endpoint_hostname=s.endpoint_hostname,
            endpoint_user=s.endpoint_user,
            session_source=s.session_source,
        )
        for s in result["items"]
    ]

    return SessionListResponse(
        items=items,
        total=result["total"],
        page=page,
        page_size=page_size,
        pages=(result["total"] + page_size - 1) // page_size,
    )


@router.get("/{session_id}", response_model=SessionDetail)
async def get_session(
    session_id: str,
    db: Database = Depends(get_database),
) -> SessionDetail:
    """Get session by ID with event/alert counts."""
    session = db.get_session_by_id(session_id)
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found",
        )

    # Get breakdown statistics
    stats = db.get_session_stats(session_id)

    # Compute actual counts from DB rather than relying on stored counter
    actual_event_count = db.get_event_count(session_id=session_id)
    actual_alert_count = db.get_alert_count(session_id=session_id)

    return SessionDetail(
        id=session.id,
        session_id=session.session_id,
        started_at=session.started_at,
        ended_at=session.ended_at,
        cwd=session.cwd,
        parent_session_id=session.parent_session_id,
        event_count=actual_event_count,
        alert_count=actual_alert_count,
        risk_score=session.risk_score,
        status=session.status,
        endpoint_hostname=session.endpoint_hostname,
        endpoint_user=session.endpoint_user,
        session_source=session.session_source,
        events_by_category=stats.get("events_by_category", {}),
        events_by_severity=stats.get("events_by_severity", {}),
        alerts_by_severity=stats.get("alerts_by_severity", {}),
        first_event_at=stats.get("first_event_at"),
        last_event_at=stats.get("last_event_at"),
    )


@router.get("/{session_id}/events")
async def get_session_events(
    session_id: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    category: str | None = Query(None),
    severity: str | None = Query(None),
    db: Database = Depends(get_database),
) -> dict[str, Any]:
    """Get paginated events for a session."""
    # Verify session exists
    session = db.get_session_by_id(session_id)
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found",
        )

    result = db.get_events_paginated(
        session_id=session_id,
        category=category,
        severity=severity,
        page=page,
        page_size=page_size,
    )

    total = result["total"]
    return {
        "items": [e.model_dump(mode="json") for e in result["items"]],
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": (total + page_size - 1) // page_size,
    }


@router.get("/{session_id}/timeline", response_model=SessionTimelineResponse)
async def get_session_timeline(
    session_id: str,
    db: Database = Depends(get_database),
) -> SessionTimelineResponse:
    """Get timeline data for session visualization."""
    # Verify session exists
    session = db.get_session_by_id(session_id)
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found",
        )

    # Get all events for the session
    events = db.get_events(session_id=session_id, limit=1000)

    # Get alerts for the session to mark events that triggered alerts
    alerts = db.get_alerts(session_id=session_id, limit=1000)
    alert_event_ids = set()
    for alert in alerts:
        alert_event_ids.update(alert.event_ids)

    entries = []
    for event in events:
        description = _format_event_description(event)
        entries.append(
            TimelineEntry(
                timestamp=event.timestamp,
                event_type=event.hook_type,
                tool_name=event.tool_name,
                category=event.category.value,
                severity=event.severity.value,
                description=description,
                event_id=event.id,
                has_alert=event.id in alert_event_ids,
            )
        )

    # Sort by timestamp
    entries.sort(key=lambda e: e.timestamp)

    return SessionTimelineResponse(
        session_id=session_id,
        entries=entries,
        total_events=len(events),
        total_alerts=len(alerts),
    )


@router.post("/{session_id}/terminate", status_code=status.HTTP_200_OK)
async def terminate_session(
    session_id: str,
    db: Database = Depends(get_database),
) -> dict[str, str]:
    """Manually terminate (end) a session."""
    session = db.get_session_by_id(session_id)
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found",
        )
    if session.status == "ended":
        return {"status": "already_ended", "session_id": session_id}

    db.end_session(session_id)
    logger.info(f"Session {session_id} terminated manually")
    return {"status": "terminated", "session_id": session_id}


def _format_event_description(event: Event) -> str:
    """Format a human-readable description for an event."""
    tool_name = event.tool_name or "unknown"

    if event.category == EventCategory.FILE_READ:
        paths = event.file_paths[:3] if event.file_paths else ["unknown"]
        return f"Read file(s): {', '.join(paths)}"
    elif event.category == EventCategory.FILE_WRITE:
        paths = event.file_paths[:3] if event.file_paths else ["unknown"]
        return f"Wrote file(s): {', '.join(paths)}"
    elif event.category == EventCategory.FILE_DELETE:
        paths = event.file_paths[:3] if event.file_paths else ["unknown"]
        return f"Deleted file(s): {', '.join(paths)}"
    elif event.category == EventCategory.COMMAND_EXEC:
        cmd = event.commands[0] if event.commands else "unknown"
        if len(cmd) > 100:
            cmd = cmd[:100] + "..."
        return f"Executed command: {cmd}"
    elif event.category == EventCategory.NETWORK_ACCESS:
        urls = event.urls[:2] if event.urls else ["unknown"]
        return f"Network access: {', '.join(urls)}"
    elif event.category == EventCategory.SUBAGENT_SPAWN:
        return "Spawned subagent"
    elif event.category == EventCategory.SESSION_LIFECYCLE:
        return f"Session lifecycle: {event.hook_type}"
    else:
        return f"Tool invocation: {tool_name}"
