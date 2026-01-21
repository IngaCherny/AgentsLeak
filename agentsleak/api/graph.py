"""Graph API routes for AgentsLeak."""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from agentsleak.store.database import Database, get_database

logger = logging.getLogger(__name__)


def _naive(dt: datetime) -> datetime:
    """Strip timezone info to allow safe min/max comparison of mixed datetimes."""
    return dt.replace(tzinfo=None) if dt.tzinfo is not None else dt

router = APIRouter(prefix="/graph", tags=["graph"])


# =============================================================================
# Response Models
# =============================================================================


class GraphNodeResponse(BaseModel):
    """Node in the graph response."""

    id: str
    node_type: str
    label: str
    value: str
    first_seen: datetime
    last_seen: datetime
    access_count: int
    alert_count: int
    size: float
    color: str | None = None


class GraphEdgeResponse(BaseModel):
    """Edge in the graph response."""

    id: str
    source_id: str
    target_id: str
    relation: str
    first_seen: datetime
    last_seen: datetime
    count: int
    weight: float
    color: str | None = None


class GraphStatsResponse(BaseModel):
    """Statistics for the graph."""

    total_nodes: int
    total_edges: int
    nodes_by_type: dict[str, int]
    edges_by_relation: dict[str, int]


class GraphResponse(BaseModel):
    """Full graph response."""

    nodes: list[GraphNodeResponse]
    edges: list[GraphEdgeResponse]
    stats: GraphStatsResponse
    time_range: dict[str, str] | None = None


class CytoscapeElement(BaseModel):
    """Element in Cytoscape.js format."""

    data: dict[str, Any]
    classes: str | None = None


class CytoscapeGraphResponse(BaseModel):
    """Graph in Cytoscape.js format for visualization."""

    elements: list[CytoscapeElement]
    stats: GraphStatsResponse


# =============================================================================
# Endpoints
# =============================================================================


@router.get("/session/{session_id}", response_model=GraphResponse)
async def get_session_graph(
    session_id: str,
    cluster_dirs: bool = Query(False, description="Cluster file nodes by directory"),
    from_date: datetime | None = Query(None, description="Filter nodes by first_seen >= date"),
    to_date: datetime | None = Query(None, description="Filter nodes by last_seen <= date"),
    db: Database = Depends(get_database),
) -> GraphResponse:
    """Get graph nodes and edges for a specific session."""
    # Verify session exists
    session = db.get_session_by_id(session_id)
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found",
        )

    graph_data = db.get_session_graph(session_id)

    raw_nodes = graph_data["nodes"]
    raw_edges = graph_data["edges"]

    # Compute full time range before any filtering
    time_range = None
    if raw_nodes:
        all_times = [_naive(n.first_seen) for n in raw_nodes] + [_naive(n.last_seen) for n in raw_nodes]
        time_range = {
            "min": min(all_times).isoformat(),
            "max": max(all_times).isoformat(),
        }

    # Apply time window filter
    # Strip timezone info to avoid naive vs aware datetime comparison errors
    # (JS sends UTC with 'Z' suffix, but DB stores naive datetimes)
    if from_date and from_date.tzinfo is not None:
        from_date = from_date.replace(tzinfo=None)
    if to_date and to_date.tzinfo is not None:
        to_date = to_date.replace(tzinfo=None)

    if from_date or to_date:
        filtered_ids: set[str] = set()
        filtered_nodes = []
        for n in raw_nodes:
            if from_date and _naive(n.last_seen) < from_date:
                continue
            if to_date and _naive(n.first_seen) > to_date:
                continue
            filtered_nodes.append(n)
            filtered_ids.add(str(n.id))
        raw_nodes = filtered_nodes
        raw_edges = [
            e for e in raw_edges
            if str(e.source_id) in filtered_ids and str(e.target_id) in filtered_ids
        ]

    # Inject session_source into session node color field
    source_val = getattr(session, "session_source", None) or "claude_code"
    nodes = [
        GraphNodeResponse(
            id=str(n.id),
            node_type=n.node_type.value,
            label=n.label,
            value=n.value,
            first_seen=n.first_seen,
            last_seen=n.last_seen,
            access_count=n.access_count,
            alert_count=n.alert_count,
            size=n.size,
            color=source_val if n.node_type.value == "session" else n.color,
        )
        for n in raw_nodes
    ]

    edges = [
        GraphEdgeResponse(
            id=str(e.id),
            source_id=str(e.source_id),
            target_id=str(e.target_id),
            relation=e.relation.value,
            first_seen=e.first_seen,
            last_seen=e.last_seen,
            count=e.count,
            weight=e.weight,
            color=e.color,
        )
        for e in raw_edges
    ]

    # Cluster file nodes by directory
    if cluster_dirs:
        import os

        file_types = {"file", "directory"}
        dir_groups: dict[str, list[GraphNodeResponse]] = {}
        non_file_nodes: list[GraphNodeResponse] = []

        for n in nodes:
            if n.node_type in file_types:
                parent = os.path.dirname(n.value) or os.path.dirname(n.label)
                if parent:
                    dir_groups.setdefault(parent, []).append(n)
                else:
                    non_file_nodes.append(n)
            else:
                non_file_nodes.append(n)

        # Only cluster directories with 3+ files
        clustered_nodes = list(non_file_nodes)
        clustered_ids: dict[str, str] = {}  # old_node_id -> cluster_id

        for dir_path, file_nodes in dir_groups.items():
            if len(file_nodes) >= 3:
                cluster_id = f"dir:{dir_path}"
                total_access = sum(n.access_count for n in file_nodes)
                total_alerts = sum(n.alert_count for n in file_nodes)
                min_first = min(file_nodes, key=lambda n: _naive(n.first_seen)).first_seen
                max_last = max(file_nodes, key=lambda n: _naive(n.last_seen)).last_seen

                cluster_node = GraphNodeResponse(
                    id=cluster_id,
                    node_type="directory",
                    label=f"{dir_path}/ ({len(file_nodes)} files)",
                    value=dir_path,
                    first_seen=min_first,
                    last_seen=max_last,
                    access_count=total_access,
                    alert_count=total_alerts,
                    size=len(file_nodes) * 1.5,
                    color=None,
                )
                # Store children IDs as extra data (via label for now)
                clustered_nodes.append(cluster_node)

                for fn in file_nodes:
                    clustered_ids[fn.id] = cluster_id
            else:
                clustered_nodes.extend(file_nodes)

        # Redirect and deduplicate edges
        if clustered_ids:
            seen_edges: set[tuple[str, str, str]] = set()
            new_edges: list[GraphEdgeResponse] = []
            for e in edges:
                src = clustered_ids.get(e.source_id, e.source_id)
                tgt = clustered_ids.get(e.target_id, e.target_id)
                key = (src, tgt, e.relation)
                if key not in seen_edges:
                    seen_edges.add(key)
                    new_edges.append(GraphEdgeResponse(
                        id=e.id,
                        source_id=src,
                        target_id=tgt,
                        relation=e.relation,
                        first_seen=e.first_seen,
                        last_seen=e.last_seen,
                        count=e.count,
                        weight=e.weight,
                        color=e.color,
                    ))
            edges = new_edges

        nodes = clustered_nodes

    # Calculate stats
    nodes_by_type: dict[str, int] = {}
    for n in nodes:
        t = n.node_type
        nodes_by_type[t] = nodes_by_type.get(t, 0) + 1

    edges_by_relation: dict[str, int] = {}
    for e in edges:
        r = e.relation
        edges_by_relation[r] = edges_by_relation.get(r, 0) + 1

    stats = GraphStatsResponse(
        total_nodes=len(nodes),
        total_edges=len(edges),
        nodes_by_type=nodes_by_type,
        edges_by_relation=edges_by_relation,
    )

    return GraphResponse(nodes=nodes, edges=edges, stats=stats, time_range=time_range)


@router.get("/session/{session_id}/cytoscape", response_model=CytoscapeGraphResponse)
async def get_session_graph_cytoscape(
    session_id: str,
    db: Database = Depends(get_database),
) -> CytoscapeGraphResponse:
    """Get graph in Cytoscape.js format for session visualization."""
    session = db.get_session_by_id(session_id)
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found",
        )

    graph_data = db.get_session_graph(session_id)

    elements: list[CytoscapeElement] = []

    # Add nodes
    for node in graph_data["nodes"]:
        elements.append(
            CytoscapeElement(
                data={
                    "id": str(node.id),
                    "label": node.label,
                    "type": node.node_type.value,
                    "value": node.value,
                    "size": node.size,
                    "accessCount": node.access_count,
                    "alertCount": node.alert_count,
                },
                classes=node.node_type.value,
            )
        )

    # Add edges
    for edge in graph_data["edges"]:
        elements.append(
            CytoscapeElement(
                data={
                    "id": str(edge.id),
                    "source": str(edge.source_id),
                    "target": str(edge.target_id),
                    "label": edge.relation.value,
                    "weight": edge.weight,
                    "count": edge.count,
                },
                classes=edge.relation.value,
            )
        )

    # Calculate stats
    nodes_by_type: dict[str, int] = {}
    for n in graph_data["nodes"]:
        t = n.node_type.value
        nodes_by_type[t] = nodes_by_type.get(t, 0) + 1

    edges_by_relation: dict[str, int] = {}
    for e in graph_data["edges"]:
        r = e.relation.value
        edges_by_relation[r] = edges_by_relation.get(r, 0) + 1

    stats = GraphStatsResponse(
        total_nodes=len(graph_data["nodes"]),
        total_edges=len(graph_data["edges"]),
        nodes_by_type=nodes_by_type,
        edges_by_relation=edges_by_relation,
    )

    return CytoscapeGraphResponse(elements=elements, stats=stats)


@router.get("/global", response_model=GraphResponse)
async def get_global_graph(
    from_date: datetime | None = Query(None, description="Start of time range"),
    to_date: datetime | None = Query(None, description="End of time range"),
    cluster_dirs: bool = Query(False, description="Cluster file nodes by directory"),
    limit_nodes: int = Query(500, ge=1, le=2000, description="Max nodes to return"),
    endpoint: str | None = Query(None, description="Filter by endpoint hostname"),
    session_source: str | None = Query(None, description="Filter by session source (claude_code, cursor)"),
    db: Database = Depends(get_database),
) -> GraphResponse:
    """Get aggregated graph across all sessions with optional time filter."""
    # Strip timezone info to avoid naive vs aware datetime comparison errors
    if from_date and from_date.tzinfo is not None:
        from_date = from_date.replace(tzinfo=None)
    if to_date and to_date.tzinfo is not None:
        to_date = to_date.replace(tzinfo=None)

    graph_data = db.get_global_graph(
        from_date=from_date,
        to_date=to_date,
        limit_nodes=limit_nodes,
        endpoint=endpoint,
        session_source=session_source,
    )

    nodes = [
        GraphNodeResponse(
            id=str(n.id),
            node_type=n.node_type.value,
            label=n.label,
            value=n.value,
            first_seen=n.first_seen,
            last_seen=n.last_seen,
            access_count=n.access_count,
            alert_count=n.alert_count,
            size=n.size,
            color=n.color,
        )
        for n in graph_data["nodes"]
    ]

    edges = [
        GraphEdgeResponse(
            id=str(e.id),
            source_id=str(e.source_id),
            target_id=str(e.target_id),
            relation=e.relation.value,
            first_seen=e.first_seen,
            last_seen=e.last_seen,
            count=e.count,
            weight=e.weight,
            color=e.color,
        )
        for e in graph_data["edges"]
    ]

    # --- Inject synthetic User/Endpoint nodes + session source ---
    # Build a mapping from session_id -> endpoint label
    session_nodes = [n for n in nodes if n.node_type == "session"]
    if session_nodes:
        # Collect all session_ids present in the graph's session nodes
        {n.value for n in session_nodes}
        # Also collect from raw graph data for session_id mapping
        raw_session_map: dict[str, str] = {}  # session_id -> node.id
        for n in graph_data["nodes"]:
            if n.node_type.value == "session":
                raw_session_map[n.value] = str(n.id)

        # Query endpoint + source info for these sessions
        with db.transaction() as cursor:
            cursor.execute(
                "SELECT session_id, endpoint_hostname, endpoint_user, "
                "COALESCE(session_source, 'claude_code') as session_source "
                "FROM sessions WHERE endpoint_hostname IS NOT NULL"
            )
            endpoint_rows = cursor.fetchall()

        # Inject session_source into session node color field
        session_source_map: dict[str, str] = {}
        for row in endpoint_rows:
            session_source_map[row["session_id"]] = row["session_source"]
        for sn in session_nodes:
            sn.color = session_source_map.get(sn.value, "claude_code")

        # Group sessions by endpoint label
        endpoint_sessions: dict[str, list[str]] = {}  # label -> [session_ids]
        for row in endpoint_rows:
            sid = row["session_id"]
            if sid not in raw_session_map:
                continue
            user = row["endpoint_user"] or ""
            host = row["endpoint_hostname"]
            label = f"{user}@{host}" if user else host
            endpoint_sessions.setdefault(label, []).append(sid)

        # Create user nodes and edges
        for ep_label, session_ids in endpoint_sessions.items():
            user_node_id = f"user:{ep_label}"
            # Calculate aggregated stats
            matching_session_nodes = [
                n for n in session_nodes
                if n.value in session_ids
            ]
            if not matching_session_nodes:
                continue

            total_alerts = sum(n.alert_count for n in matching_session_nodes)
            min_first = min(matching_session_nodes, key=lambda n: _naive(n.first_seen)).first_seen
            max_last = max(matching_session_nodes, key=lambda n: _naive(n.last_seen)).last_seen

            user_node = GraphNodeResponse(
                id=user_node_id,
                node_type="user",
                label=ep_label,
                value=ep_label,
                first_seen=min_first,
                last_seen=max_last,
                access_count=len(matching_session_nodes),
                alert_count=total_alerts,
                size=2.0,
                color=None,
            )
            nodes.append(user_node)

            # Create edges from user -> each session node
            for sn in matching_session_nodes:
                edge_id = f"user-edge:{ep_label}:{sn.id}"
                edges.append(GraphEdgeResponse(
                    id=edge_id,
                    source_id=user_node_id,
                    target_id=sn.id,
                    relation="contains",
                    first_seen=sn.first_seen,
                    last_seen=sn.last_seen,
                    count=1,
                    weight=1.0,
                    color=None,
                ))

    # Cluster file nodes by directory
    if cluster_dirs:
        import os

        file_types = {"file", "directory"}
        dir_groups: dict[str, list[GraphNodeResponse]] = {}
        non_file_nodes: list[GraphNodeResponse] = []

        for n in nodes:
            if n.node_type in file_types:
                parent = os.path.dirname(n.value) or os.path.dirname(n.label)
                if parent:
                    dir_groups.setdefault(parent, []).append(n)
                else:
                    non_file_nodes.append(n)
            else:
                non_file_nodes.append(n)

        clustered_nodes = list(non_file_nodes)
        clustered_ids: dict[str, str] = {}

        for dir_path, file_nodes in dir_groups.items():
            if len(file_nodes) >= 3:
                cluster_id = f"dir:{dir_path}"
                total_access = sum(n.access_count for n in file_nodes)
                total_alerts = sum(n.alert_count for n in file_nodes)
                min_first = min(file_nodes, key=lambda n: _naive(n.first_seen)).first_seen
                max_last = max(file_nodes, key=lambda n: _naive(n.last_seen)).last_seen

                cluster_node = GraphNodeResponse(
                    id=cluster_id,
                    node_type="directory",
                    label=f"{dir_path}/ ({len(file_nodes)} files)",
                    value=dir_path,
                    first_seen=min_first,
                    last_seen=max_last,
                    access_count=total_access,
                    alert_count=total_alerts,
                    size=len(file_nodes) * 1.5,
                    color=None,
                )
                clustered_nodes.append(cluster_node)

                for fn in file_nodes:
                    clustered_ids[fn.id] = cluster_id
            else:
                clustered_nodes.extend(file_nodes)

        if clustered_ids:
            seen_edges: set[tuple[str, str, str]] = set()
            new_edges: list[GraphEdgeResponse] = []
            for e in edges:
                src = clustered_ids.get(e.source_id, e.source_id)
                tgt = clustered_ids.get(e.target_id, e.target_id)
                key = (src, tgt, e.relation)
                if key not in seen_edges:
                    seen_edges.add(key)
                    new_edges.append(GraphEdgeResponse(
                        id=e.id,
                        source_id=src,
                        target_id=tgt,
                        relation=e.relation,
                        first_seen=e.first_seen,
                        last_seen=e.last_seen,
                        count=e.count,
                        weight=e.weight,
                        color=e.color,
                    ))
            edges = new_edges

        nodes = clustered_nodes

    # Calculate stats
    nodes_by_type: dict[str, int] = {}
    for n in nodes:
        t = n.node_type
        nodes_by_type[t] = nodes_by_type.get(t, 0) + 1

    edges_by_relation: dict[str, int] = {}
    for e in edges:
        r = e.relation
        edges_by_relation[r] = edges_by_relation.get(r, 0) + 1

    stats = GraphStatsResponse(
        total_nodes=len(nodes),
        total_edges=len(edges),
        nodes_by_type=nodes_by_type,
        edges_by_relation=edges_by_relation,
    )

    return GraphResponse(nodes=nodes, edges=edges, stats=stats)


@router.get("/global/cytoscape", response_model=CytoscapeGraphResponse)
async def get_global_graph_cytoscape(
    from_date: datetime | None = Query(None, description="Start of time range"),
    to_date: datetime | None = Query(None, description="End of time range"),
    limit_nodes: int = Query(500, ge=1, le=2000, description="Max nodes to return"),
    db: Database = Depends(get_database),
) -> CytoscapeGraphResponse:
    """Get global graph in Cytoscape.js format for visualization."""
    # Strip timezone info to avoid naive vs aware datetime comparison errors
    if from_date and from_date.tzinfo is not None:
        from_date = from_date.replace(tzinfo=None)
    if to_date and to_date.tzinfo is not None:
        to_date = to_date.replace(tzinfo=None)

    graph_data = db.get_global_graph(
        from_date=from_date,
        to_date=to_date,
        limit_nodes=limit_nodes,
    )

    elements: list[CytoscapeElement] = []

    # Add nodes
    for node in graph_data["nodes"]:
        elements.append(
            CytoscapeElement(
                data={
                    "id": str(node.id),
                    "label": node.label,
                    "type": node.node_type.value,
                    "value": node.value,
                    "size": node.size,
                    "accessCount": node.access_count,
                    "alertCount": node.alert_count,
                    "sessionCount": len(node.session_ids),
                },
                classes=node.node_type.value,
            )
        )

    # Add edges
    for edge in graph_data["edges"]:
        elements.append(
            CytoscapeElement(
                data={
                    "id": str(edge.id),
                    "source": str(edge.source_id),
                    "target": str(edge.target_id),
                    "label": edge.relation.value,
                    "weight": edge.weight,
                    "count": edge.count,
                },
                classes=edge.relation.value,
            )
        )

    # Calculate stats
    nodes_by_type: dict[str, int] = {}
    for n in graph_data["nodes"]:
        t = n.node_type.value
        nodes_by_type[t] = nodes_by_type.get(t, 0) + 1

    edges_by_relation: dict[str, int] = {}
    for e in graph_data["edges"]:
        r = e.relation.value
        edges_by_relation[r] = edges_by_relation.get(r, 0) + 1

    stats = GraphStatsResponse(
        total_nodes=len(graph_data["nodes"]),
        total_edges=len(graph_data["edges"]),
        nodes_by_type=nodes_by_type,
        edges_by_relation=edges_by_relation,
    )

    return CytoscapeGraphResponse(elements=elements, stats=stats)
