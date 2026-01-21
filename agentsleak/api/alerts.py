"""Alert API routes for AgentsLeak."""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from agentsleak.models.alerts import AlertStatus
from agentsleak.store.database import Database, get_database

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/alerts", tags=["alerts"])


# =============================================================================
# Request/Response Models
# =============================================================================


class AlertSummary(BaseModel):
    """Summary of an alert for list view."""

    id: UUID
    session_id: str
    created_at: datetime
    updated_at: datetime
    title: str
    severity: str
    category: str
    status: str
    blocked: bool
    event_count: int


class EvidenceItem(BaseModel):
    """Evidence item in alert detail."""

    event_id: UUID
    timestamp: datetime
    description: str
    data: dict[str, Any] = Field(default_factory=dict)
    file_path: str | None = None
    command: str | None = None
    url: str | None = None


class AlertDetail(BaseModel):
    """Detailed alert information."""

    id: UUID
    session_id: str
    created_at: datetime
    updated_at: datetime
    title: str
    description: str
    severity: str
    category: str
    status: str
    assigned_to: str | None
    policy_id: UUID | None
    event_ids: list[UUID]
    evidence: list[EvidenceItem]
    action_taken: str | None
    blocked: bool
    tags: list[str]
    metadata: dict[str, Any]


class AlertListResponse(BaseModel):
    """Response for alert list endpoint."""

    items: list[AlertSummary]
    total: int
    page: int
    page_size: int
    pages: int


class AlertUpdateRequest(BaseModel):
    """Request to update an alert."""

    status: AlertStatus | None = None
    notes: str | None = None
    assigned_to: str | None = None
    tags: list[str] | None = None


class AlertUpdateResponse(BaseModel):
    """Response after updating an alert."""

    id: UUID
    status: str
    updated_at: datetime
    message: str


# =============================================================================
# Endpoints
# =============================================================================


@router.get("")
async def list_alerts(
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(20, ge=1, le=100, description="Items per page"),
    status: str | None = Query(None, description="Filter by status"),
    severity: str | None = Query(None, description="Filter by severity"),
    blocked: bool | None = Query(None, description="Filter by blocked status"),
    rule_id: UUID | None = Query(None, description="Filter by policy/rule ID"),
    session_id: str | None = Query(None, description="Filter by session ID"),
    endpoint: str | None = Query(None, description="Filter by endpoint hostname"),
    from_date: datetime | None = Query(None, description="Filter from date"),
    to_date: datetime | None = Query(None, description="Filter to date"),
    db: Database = Depends(get_database),
) -> dict:
    """List alerts with pagination and filters."""
    # Strip timezone info to avoid naive vs aware datetime comparison errors
    if from_date and from_date.tzinfo is not None:
        from_date = from_date.replace(tzinfo=None)
    if to_date and to_date.tzinfo is not None:
        to_date = to_date.replace(tzinfo=None)

    # If filtering by endpoint, first get session_ids matching that hostname
    endpoint_session_ids: set[str] | None = None
    if endpoint:
        endpoint_sessions = db.get_sessions_paginated(
            page=1, page_size=10000, hostname=endpoint,
        )
        endpoint_session_ids = {s.session_id for s in endpoint_sessions["items"]}
        if not endpoint_session_ids:
            return {"items": [], "total": 0, "page": page, "page_size": page_size, "pages": 0}

    result = db.get_alerts_paginated(
        page=page,
        page_size=page_size,
        status=status,
        severity=severity,
        policy_id=rule_id,
        session_id=session_id,
        from_date=from_date,
        to_date=to_date,
    )

    # Resolve policy names for alerts that have policy_id
    policy_ids = {a.policy_id for a in result["items"] if a.policy_id}
    policy_names: dict[UUID, str] = {}
    for pid in policy_ids:
        policy = db.get_policy_by_id(pid)
        if policy:
            policy_names[pid] = policy.name

    raw_items = result["items"]

    # Apply blocked filter client-side (DB doesn't support it natively)
    if blocked is not None:
        raw_items = [a for a in raw_items if a.blocked == blocked]

    # Apply endpoint filter client-side
    if endpoint_session_ids is not None:
        raw_items = [a for a in raw_items if a.session_id in endpoint_session_ids]

    # Batch-lookup sessions for endpoint info
    unique_session_ids = {a.session_id for a in raw_items}
    session_endpoints: dict[str, tuple[str | None, str | None]] = {}
    for sid in unique_session_ids:
        sess = db.get_session_by_id(sid)
        if sess:
            session_endpoints[sid] = (sess.endpoint_hostname, sess.endpoint_user)

    items = []
    for a in raw_items:
        ep_hostname, ep_user = session_endpoints.get(a.session_id, (None, None))
        items.append({
            "id": str(a.id),
            "session_id": a.session_id,
            "created_at": a.created_at.isoformat(),
            "updated_at": a.updated_at.isoformat(),
            "title": a.title,
            "description": a.description,
            "severity": a.severity.value,
            "category": a.category.value,
            "status": a.status.value,
            "assigned_to": a.assigned_to,
            "policy_id": str(a.policy_id) if a.policy_id else None,
            "policy_name": policy_names.get(a.policy_id) if a.policy_id else None,
            "event_ids": [str(eid) for eid in a.event_ids],
            "evidence": [e.model_dump(mode="json") for e in a.evidence],
            "action_taken": a.action_taken,
            "blocked": a.blocked,
            "tags": a.tags,
            "metadata": a.metadata,
            "endpoint_hostname": ep_hostname,
            "endpoint_user": ep_user,
        })

    total = result["total"]
    return {
        "items": items,
        "total": len(items) if blocked is not None else total,
        "page": page,
        "page_size": page_size,
        "pages": (total + page_size - 1) // page_size,
    }


@router.get("/{alert_id}", response_model=AlertDetail)
async def get_alert(
    alert_id: UUID,
    db: Database = Depends(get_database),
) -> AlertDetail:
    """Get alert by ID with full evidence."""
    alert = db.get_alert_by_id(alert_id)
    if alert is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Alert {alert_id} not found",
        )

    evidence_items = [
        EvidenceItem(
            event_id=e.event_id,
            timestamp=e.timestamp,
            description=e.description,
            data=e.data,
            file_path=e.file_path,
            command=e.command,
            url=e.url,
        )
        for e in alert.evidence
    ]

    return AlertDetail(
        id=alert.id,
        session_id=alert.session_id,
        created_at=alert.created_at,
        updated_at=alert.updated_at,
        title=alert.title,
        description=alert.description,
        severity=alert.severity.value,
        category=alert.category.value,
        status=alert.status.value,
        assigned_to=alert.assigned_to,
        policy_id=alert.policy_id,
        event_ids=alert.event_ids,
        evidence=evidence_items,
        action_taken=alert.action_taken,
        blocked=alert.blocked,
        tags=alert.tags,
        metadata=alert.metadata,
    )


@router.patch("/{alert_id}", response_model=AlertUpdateResponse)
async def update_alert(
    alert_id: UUID,
    update: AlertUpdateRequest,
    db: Database = Depends(get_database),
) -> AlertUpdateResponse:
    """Update alert status, notes, or assignment."""
    alert = db.get_alert_by_id(alert_id)
    if alert is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Alert {alert_id} not found",
        )

    update_data: dict[str, Any] = {}
    if update.status is not None:
        update_data["status"] = update.status.value
    if update.notes is not None:
        update_data["action_taken"] = update.notes
    if update.assigned_to is not None:
        update_data["assigned_to"] = update.assigned_to
    if update.tags is not None:
        update_data["tags"] = update.tags

    updated_alert = db.update_alert(alert_id, update_data)

    return AlertUpdateResponse(
        id=alert_id,
        status=updated_alert.status.value,
        updated_at=updated_alert.updated_at,
        message="Alert updated successfully",
    )


@router.post("/{alert_id}/acknowledge", response_model=AlertUpdateResponse)
async def acknowledge_alert(
    alert_id: UUID,
    db: Database = Depends(get_database),
) -> AlertUpdateResponse:
    """Set alert status to investigating (acknowledged)."""
    alert = db.get_alert_by_id(alert_id)
    if alert is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Alert {alert_id} not found",
        )

    updated_alert = db.update_alert(alert_id, {"status": AlertStatus.INVESTIGATING.value})

    return AlertUpdateResponse(
        id=alert_id,
        status=updated_alert.status.value,
        updated_at=updated_alert.updated_at,
        message="Alert acknowledged",
    )


@router.post("/{alert_id}/resolve", response_model=AlertUpdateResponse)
async def resolve_alert(
    alert_id: UUID,
    resolution: str | None = Query(None, description="Resolution notes"),
    db: Database = Depends(get_database),
) -> AlertUpdateResponse:
    """Set alert status to resolved."""
    alert = db.get_alert_by_id(alert_id)
    if alert is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Alert {alert_id} not found",
        )

    update_data: dict[str, Any] = {"status": AlertStatus.RESOLVED.value}
    if resolution:
        update_data["action_taken"] = resolution

    updated_alert = db.update_alert(alert_id, update_data)

    return AlertUpdateResponse(
        id=alert_id,
        status=updated_alert.status.value,
        updated_at=updated_alert.updated_at,
        message="Alert resolved",
    )


@router.get("/{alert_id}/context")
async def get_alert_context(
    alert_id: UUID,
    limit: int = Query(20, ge=1, le=50, description="Number of events to return"),
    db: Database = Depends(get_database),
) -> dict:
    """Get the event chain leading up to an alert.

    Returns the most recent events in the same session that occurred
    at or before the alert was created, in chronological order.
    The triggering event(s) are marked.
    """
    alert = db.get_alert_by_id(alert_id)
    if alert is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Alert {alert_id} not found",
        )

    events = db.get_events_before(
        session_id=alert.session_id,
        before=alert.created_at,
        limit=limit,
    )

    trigger_ids = {str(eid) for eid in alert.event_ids}

    items = []
    for ev in events:
        # Build a short description
        desc = ""
        if ev.file_paths:
            desc = ev.file_paths[0]
        elif ev.commands:
            cmd = ev.commands[0]
            desc = cmd[:80] + ("..." if len(cmd) > 80 else "")
        elif ev.urls:
            desc = ev.urls[0]

        items.append({
            "id": str(ev.id),
            "timestamp": ev.timestamp.isoformat(),
            "tool_name": ev.tool_name,
            "category": ev.category.value,
            "severity": ev.severity.value,
            "description": desc,
            "is_trigger": str(ev.id) in trigger_ids,
        })

    return {
        "alert_id": str(alert_id),
        "session_id": alert.session_id,
        "events": items,
    }


@router.get("/{alert_id}/graph")
async def get_alert_graph(
    alert_id: UUID,
    db: Database = Depends(get_database),
) -> dict:
    """Get the subgraph of nodes/edges related to an alert's triggering events.

    Extracts the relevant portion of the session graph that contains
    the alert's event_ids, then walks up to include parent nodes
    (session, tool, command group) for full chain context.
    """
    alert = db.get_alert_by_id(alert_id)
    if alert is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Alert {alert_id} not found",
        )

    # Get full session graph
    graph_data = db.get_session_graph(alert.session_id)
    all_nodes = graph_data["nodes"]
    all_edges = graph_data["edges"]

    trigger_event_ids = {str(eid) for eid in alert.event_ids}

    # Find nodes that contain any trigger event_id
    matched_node_ids: set[str] = set()
    for node in all_nodes:
        node_event_ids = {str(eid) for eid in node.event_ids}
        if node_event_ids & trigger_event_ids:
            matched_node_ids.add(str(node.id))

    if not matched_node_ids:
        return {"alert_id": str(alert_id), "session_id": alert.session_id, "nodes": [], "edges": []}

    # Build adjacency: for each node, find its parents (sources in edges targeting it)
    parent_map: dict[str, set[str]] = {}
    for edge in all_edges:
        tid = str(edge.target_id)
        sid = str(edge.source_id)
        parent_map.setdefault(tid, set()).add(sid)

    # Walk up from matched nodes to include full chain to root (session)
    included_ids = set(matched_node_ids)
    queue = list(matched_node_ids)
    while queue:
        nid = queue.pop()
        for parent_id in parent_map.get(nid, set()):
            if parent_id not in included_ids:
                included_ids.add(parent_id)
                queue.append(parent_id)

    # Also walk DOWN one level from matched nodes to include children (file, url targets)
    child_map: dict[str, set[str]] = {}
    for edge in all_edges:
        sid = str(edge.source_id)
        tid = str(edge.target_id)
        child_map.setdefault(sid, set()).add(tid)

    for nid in list(matched_node_ids):
        for child_id in child_map.get(nid, set()):
            # Only include leaf-type children (file, url, process)
            included_ids.add(child_id)

    # Build response
    node_map = {str(n.id): n for n in all_nodes}
    result_nodes = []
    for nid in included_ids:
        node = node_map.get(nid)
        if not node:
            continue
        node_event_ids = {str(eid) for eid in node.event_ids}
        is_trigger = bool(node_event_ids & trigger_event_ids)
        result_nodes.append({
            "id": str(node.id),
            "node_type": node.node_type.value,
            "label": node.label,
            "value": node.value,
            "alert_count": node.alert_count,
            "is_trigger": is_trigger,
            "blocked": alert.blocked if is_trigger else False,
        })

    result_edges = []
    for edge in all_edges:
        sid = str(edge.source_id)
        tid = str(edge.target_id)
        if sid in included_ids and tid in included_ids:
            result_edges.append({
                "id": str(edge.id),
                "source_id": sid,
                "target_id": tid,
                "relation": edge.relation.value,
            })

    # Get policy name for context
    policy_name = None
    if alert.policy_id:
        policy = db.get_policy_by_id(alert.policy_id)
        if policy:
            policy_name = policy.name

    return {
        "alert_id": str(alert_id),
        "session_id": alert.session_id,
        "alert_title": alert.title,
        "alert_description": alert.description,
        "alert_severity": alert.severity.value if hasattr(alert.severity, 'value') else str(alert.severity),
        "blocked": alert.blocked,
        "policy_name": policy_name,
        "nodes": result_nodes,
        "edges": result_edges,
    }
