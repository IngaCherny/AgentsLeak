"""Statistics API routes for AgentsLeak."""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from agentsleak.store.database import Database, get_database

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/stats", tags=["statistics"])


# =============================================================================
# Response Models
# =============================================================================


class AlertCountBySeverity(BaseModel):
    """Alert counts grouped by severity."""

    critical: int = 0
    high: int = 0
    medium: int = 0
    low: int = 0
    info: int = 0


class EventCountByCategory(BaseModel):
    """Event counts grouped by category."""

    file_read: int = 0
    file_write: int = 0
    file_delete: int = 0
    command_exec: int = 0
    network_access: int = 0
    code_execution: int = 0
    subagent_spawn: int = 0
    mcp_tool_use: int = 0
    session_lifecycle: int = 0
    unknown: int = 0


class RecentAlert(BaseModel):
    """Recent alert summary."""

    id: str
    title: str
    severity: str
    status: str
    session_id: str
    created_at: datetime


class RecentEvent(BaseModel):
    """Recent event summary."""

    id: str
    tool_name: str | None
    category: str
    severity: str
    session_id: str
    timestamp: datetime


class DashboardStats(BaseModel):
    """Dashboard overview statistics."""

    total_sessions: int
    active_sessions: int
    total_events: int
    total_alerts: int
    new_alerts: int
    blocked_actions: int
    endpoint_count: int = 0
    alerts_by_severity: AlertCountBySeverity
    events_by_category: EventCountByCategory
    recent_alerts: list[RecentAlert]
    recent_events: list[RecentEvent]
    sessions_by_source: dict[str, int] = Field(default_factory=dict)


class EndpointStatsEntry(BaseModel):
    """Statistics for a single endpoint."""

    endpoint_hostname: str | None
    endpoint_user: str | None
    session_count: int
    total_events: int
    total_alerts: int


class EndpointStatsResponse(BaseModel):
    """Response for endpoint stats endpoint."""

    items: list[EndpointStatsEntry]
    total: int


class TimelinePoint(BaseModel):
    """Single point in timeline data."""

    timestamp: datetime
    events: int
    alerts: int


class TimelineResponse(BaseModel):
    """Response for timeline endpoint."""

    points: list[TimelinePoint]
    total_events: int
    total_alerts: int
    start_time: datetime
    end_time: datetime


class TopFileEntry(BaseModel):
    """Entry in top files list."""

    file_path: str
    read_count: int
    write_count: int
    delete_count: int
    total_access: int
    last_accessed: datetime | None
    alert_count: int


class TopCommandEntry(BaseModel):
    """Entry in top commands list."""

    command: str
    execution_count: int
    last_executed: datetime | None
    alert_count: int


class TopDomainEntry(BaseModel):
    """Entry in top domains list."""

    hostname: str
    access_count: int
    last_accessed: datetime | None
    alert_count: int


class TopFilesResponse(BaseModel):
    """Response for top files endpoint."""

    items: list[TopFileEntry]
    total: int


class TopCommandsResponse(BaseModel):
    """Response for top commands endpoint."""

    items: list[TopCommandEntry]
    total: int


class TopDomainsResponse(BaseModel):
    """Response for top domains endpoint."""

    items: list[TopDomainEntry]
    total: int


# =============================================================================
# Endpoints
# =============================================================================


@router.get("/dashboard", response_model=DashboardStats)
async def get_dashboard_stats(
    from_date: datetime | None = Query(None, description="Start of time range"),
    to_date: datetime | None = Query(None, description="End of time range"),
    endpoint: str | None = Query(None, description="Filter by endpoint hostname"),
    db: Database = Depends(get_database),
) -> DashboardStats:
    """Get dashboard overview statistics."""
    # Strip timezone info to avoid naive vs aware datetime comparison errors
    if from_date and from_date.tzinfo is not None:
        from_date = from_date.replace(tzinfo=None)
    if to_date and to_date.tzinfo is not None:
        to_date = to_date.replace(tzinfo=None)
    stats = db.get_dashboard_stats(from_date=from_date, to_date=to_date, endpoint=endpoint)

    endpoint_count = db.get_unique_endpoint_count()

    return DashboardStats(
        total_sessions=stats["total_sessions"],
        active_sessions=stats["active_sessions"],
        total_events=stats["total_events"],
        total_alerts=stats["total_alerts"],
        new_alerts=stats["new_alerts"],
        blocked_actions=stats["blocked_actions"],
        endpoint_count=endpoint_count,
        alerts_by_severity=AlertCountBySeverity(**stats["alerts_by_severity"]),
        events_by_category=EventCountByCategory(**stats["events_by_category"]),
        recent_alerts=[
            RecentAlert(
                id=str(a["id"]),
                title=a["title"],
                severity=a["severity"],
                status=a["status"],
                session_id=a["session_id"],
                created_at=a["created_at"],
            )
            for a in stats["recent_alerts"]
        ],
        recent_events=[
            RecentEvent(
                id=str(e["id"]),
                tool_name=e["tool_name"],
                category=e["category"],
                severity=e["severity"],
                session_id=e["session_id"],
                timestamp=e["timestamp"],
            )
            for e in stats["recent_events"]
        ],
        sessions_by_source=stats.get("sessions_by_source", {}),
    )


@router.get("/endpoints", response_model=EndpointStatsResponse)
async def get_endpoint_stats(
    db: Database = Depends(get_database),
) -> EndpointStatsResponse:
    """Get aggregated statistics grouped by endpoint."""
    endpoint_stats = db.get_endpoint_stats()

    items = [
        EndpointStatsEntry(
            endpoint_hostname=e["endpoint_hostname"],
            endpoint_user=e["endpoint_user"],
            session_count=e["session_count"],
            total_events=e["total_events"],
            total_alerts=e["total_alerts"],
        )
        for e in endpoint_stats
    ]

    return EndpointStatsResponse(items=items, total=len(items))


@router.get("/timeline", response_model=TimelineResponse)
async def get_timeline_stats(
    from_date: datetime | None = Query(
        None, description="Start of time range (defaults to 24 hours ago)"
    ),
    to_date: datetime | None = Query(
        None, description="End of time range (defaults to now)"
    ),
    interval: str = Query(
        "hour", description="Time interval: 'minute', 'hour', or 'day'"
    ),
    session_id: str | None = Query(
        None, description="Filter to a specific session"
    ),
    endpoint: str | None = Query(
        None, description="Filter by endpoint hostname"
    ),
    db: Database = Depends(get_database),
) -> TimelineResponse:
    """Get hourly/daily event and alert counts for charts."""
    # Default time range: last 24 hours
    end_time = to_date or datetime.now(UTC)
    start_time = from_date or (end_time - timedelta(hours=24))

    timeline_data = db.get_timeline_stats(
        from_date=start_time,
        to_date=end_time,
        interval=interval,
        session_id=session_id,
        endpoint=endpoint,
    )

    points = [
        TimelinePoint(
            timestamp=p["timestamp"],
            events=p["events"],
            alerts=p["alerts"],
        )
        for p in timeline_data["points"]
    ]

    return TimelineResponse(
        points=points,
        total_events=timeline_data["total_events"],
        total_alerts=timeline_data["total_alerts"],
        start_time=start_time,
        end_time=end_time,
    )


@router.get("/top-files", response_model=TopFilesResponse)
async def get_top_files(
    limit: int = Query(20, ge=1, le=100, description="Number of files to return"),
    sort_by: str = Query(
        "total_access", description="Sort by: total_access, read_count, write_count, alert_count"
    ),
    from_date: datetime | None = Query(None, description="Start of time range"),
    to_date: datetime | None = Query(None, description="End of time range"),
    endpoint: str | None = Query(None, description="Filter by endpoint hostname"),
    db: Database = Depends(get_database),
) -> TopFilesResponse:
    """Get most accessed files."""
    if from_date and from_date.tzinfo is not None:
        from_date = from_date.replace(tzinfo=None)
    if to_date and to_date.tzinfo is not None:
        to_date = to_date.replace(tzinfo=None)
    files = db.get_top_files(limit=limit, sort_by=sort_by, from_date=from_date, to_date=to_date, endpoint=endpoint)

    items = [
        TopFileEntry(
            file_path=f["file_path"],
            read_count=f["read_count"],
            write_count=f["write_count"],
            delete_count=f["delete_count"],
            total_access=f["read_count"] + f["write_count"] + f["delete_count"],
            last_accessed=f["last_accessed"],
            alert_count=f["alert_count"],
        )
        for f in files
    ]

    return TopFilesResponse(items=items, total=len(items))


@router.get("/top-commands", response_model=TopCommandsResponse)
async def get_top_commands(
    limit: int = Query(20, ge=1, le=100, description="Number of commands to return"),
    sort_by: str = Query(
        "execution_count", description="Sort by: execution_count, alert_count"
    ),
    from_date: datetime | None = Query(None, description="Start of time range"),
    to_date: datetime | None = Query(None, description="End of time range"),
    endpoint: str | None = Query(None, description="Filter by endpoint hostname"),
    db: Database = Depends(get_database),
) -> TopCommandsResponse:
    """Get most executed commands."""
    if from_date and from_date.tzinfo is not None:
        from_date = from_date.replace(tzinfo=None)
    if to_date and to_date.tzinfo is not None:
        to_date = to_date.replace(tzinfo=None)
    commands = db.get_top_commands(limit=limit, sort_by=sort_by, from_date=from_date, to_date=to_date, endpoint=endpoint)

    items = [
        TopCommandEntry(
            command=c["command"],
            execution_count=c["execution_count"],
            last_executed=c["last_executed"],
            alert_count=c["alert_count"],
        )
        for c in commands
    ]

    return TopCommandsResponse(items=items, total=len(items))


@router.get("/top-domains", response_model=TopDomainsResponse)
async def get_top_domains(
    limit: int = Query(20, ge=1, le=100, description="Number of domains to return"),
    sort_by: str = Query(
        "access_count", description="Sort by: access_count, alert_count"
    ),
    from_date: datetime | None = Query(None, description="Start of time range"),
    to_date: datetime | None = Query(None, description="End of time range"),
    endpoint: str | None = Query(None, description="Filter by endpoint hostname"),
    db: Database = Depends(get_database),
) -> TopDomainsResponse:
    """Get most accessed domains."""
    if from_date and from_date.tzinfo is not None:
        from_date = from_date.replace(tzinfo=None)
    if to_date and to_date.tzinfo is not None:
        to_date = to_date.replace(tzinfo=None)
    domains = db.get_top_domains(limit=limit, sort_by=sort_by, from_date=from_date, to_date=to_date, endpoint=endpoint)

    items = [
        TopDomainEntry(
            hostname=d["hostname"],
            access_count=d["access_count"],
            last_accessed=d["last_accessed"],
            alert_count=d["alert_count"],
        )
        for d in domains
    ]

    return TopDomainsResponse(items=items, total=len(items))
