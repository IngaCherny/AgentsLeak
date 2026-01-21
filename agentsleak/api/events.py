"""Event API routes for AgentsLeak."""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from agentsleak.store.database import Database, get_database

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/events", tags=["events"])


# =============================================================================
# Response Models
# =============================================================================


class EventSummary(BaseModel):
    """Summary of an event for list view."""

    id: UUID
    session_id: str
    timestamp: datetime
    hook_type: str
    tool_name: str | None
    category: str
    severity: str
    file_paths: list[str] = Field(default_factory=list)
    commands: list[str] = Field(default_factory=list)
    urls: list[str] = Field(default_factory=list)


class EventDetail(BaseModel):
    """Detailed event information."""

    id: UUID
    session_id: str
    timestamp: datetime
    hook_type: str
    tool_name: str | None
    tool_input: dict[str, Any] | None
    tool_result: dict[str, Any] | None
    category: str
    severity: str
    file_paths: list[str]
    commands: list[str]
    urls: list[str]
    ip_addresses: list[str]
    processed: bool
    enriched: bool
    raw_payload: dict[str, Any] | None


class EventListResponse(BaseModel):
    """Response for event list endpoint."""

    items: list[EventSummary]
    total: int
    page: int
    page_size: int
    pages: int


# =============================================================================
# Endpoints
# =============================================================================


@router.get("", response_model=EventListResponse)
async def list_events(
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(50, ge=1, le=200, description="Items per page"),
    session_id: str | None = Query(None, description="Filter by session ID"),
    category: str | None = Query(None, description="Filter by category"),
    severity: str | None = Query(None, description="Filter by severity"),
    tool_name: str | None = Query(None, description="Filter by tool name"),
    blocked: bool | None = Query(None, description="Filter blocked events"),
    from_date: datetime | None = Query(None, description="Filter from date"),
    to_date: datetime | None = Query(None, description="Filter to date"),
    db: Database = Depends(get_database),
) -> EventListResponse:
    """List events with pagination and filters."""
    result = db.get_events_paginated(
        page=page,
        page_size=page_size,
        session_id=session_id,
        category=category,
        severity=severity,
        tool_name=tool_name,
        blocked=blocked,
        from_date=from_date,
        to_date=to_date,
    )

    items = [
        EventSummary(
            id=e.id,
            session_id=e.session_id,
            timestamp=e.timestamp,
            hook_type=e.hook_type,
            tool_name=e.tool_name,
            category=e.category.value,
            severity=e.severity.value,
            file_paths=e.file_paths,
            commands=e.commands,
            urls=e.urls,
        )
        for e in result["items"]
    ]

    return EventListResponse(
        items=items,
        total=result["total"],
        page=page,
        page_size=page_size,
        pages=(result["total"] + page_size - 1) // page_size,
    )


@router.get("/{event_id}", response_model=EventDetail)
async def get_event(
    event_id: UUID,
    db: Database = Depends(get_database),
) -> EventDetail:
    """Get event by ID with full details."""
    event = db.get_event_by_id(event_id)
    if event is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Event {event_id} not found",
        )

    return EventDetail(
        id=event.id,
        session_id=event.session_id,
        timestamp=event.timestamp,
        hook_type=event.hook_type,
        tool_name=event.tool_name,
        tool_input=event.tool_input,
        tool_result=event.tool_result,
        category=event.category.value,
        severity=event.severity.value,
        file_paths=event.file_paths,
        commands=event.commands,
        urls=event.urls,
        ip_addresses=event.ip_addresses,
        processed=event.processed,
        enriched=event.enriched,
        raw_payload=event.raw_payload,
    )
