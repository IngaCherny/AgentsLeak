"""Graph models for AgentsLeak.

These models represent the activity graph for visualization and analysis.
"""

from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Any
from uuid import UUID, uuid4

from pydantic import BaseModel, Field


class NodeType(StrEnum):
    """Type of node in the activity graph."""

    SESSION = "session"
    FILE = "file"
    DIRECTORY = "directory"
    COMMAND = "command"
    PROCESS = "process"
    NETWORK = "network"
    URL = "url"
    IP_ADDRESS = "ip_address"
    TOOL = "tool"
    USER = "user"
    ALERT = "alert"


class EdgeRelation(StrEnum):
    """Type of relationship between nodes."""

    # File operations
    READS = "reads"
    WRITES = "writes"
    CREATES = "creates"
    DELETES = "deletes"
    MODIFIES = "modifies"

    # Command/process operations
    EXECUTES = "executes"
    SPAWNS = "spawns"
    TERMINATES = "terminates"

    # Network operations
    CONNECTS_TO = "connects_to"
    DOWNLOADS_FROM = "downloads_from"
    UPLOADS_TO = "uploads_to"
    FETCHES = "fetches"

    # Session relationships
    CONTAINS = "contains"
    PARENT_OF = "parent_of"
    CHILD_OF = "child_of"

    # Tool relationships
    USES = "uses"
    INVOKES = "invokes"

    # Alert relationships
    TRIGGERS = "triggers"
    RELATED_TO = "related_to"


class GraphNode(BaseModel):
    """A node in the activity graph."""

    id: UUID = Field(default_factory=uuid4)
    node_type: NodeType = Field(..., description="Type of the node")
    label: str = Field(..., description="Display label for the node")
    value: str = Field(..., description="Actual value (path, command, URL, etc.)")

    # Timestamps
    first_seen: datetime = Field(default_factory=lambda: datetime.now(UTC))
    last_seen: datetime = Field(default_factory=lambda: datetime.now(UTC))

    # Metrics
    access_count: int = Field(default=1, description="Number of times this node was accessed")
    alert_count: int = Field(default=0, description="Number of alerts associated with this node")

    # Associated data
    session_ids: list[str] = Field(default_factory=list, description="Sessions that touched this node")
    event_ids: list[UUID] = Field(default_factory=list, description="Events involving this node")

    # Visual properties
    size: float = Field(default=1.0, description="Relative size for visualization")
    color: str | None = Field(None, description="Color for visualization")
    metadata: dict[str, Any] = Field(default_factory=dict)

    model_config = {"from_attributes": True}



class GraphEdge(BaseModel):
    """An edge (relationship) in the activity graph."""

    id: UUID = Field(default_factory=uuid4)
    source_id: UUID = Field(..., description="Source node ID")
    target_id: UUID = Field(..., description="Target node ID")
    relation: EdgeRelation = Field(..., description="Type of relationship")

    # Timestamps
    first_seen: datetime = Field(default_factory=lambda: datetime.now(UTC))
    last_seen: datetime = Field(default_factory=lambda: datetime.now(UTC))

    # Metrics
    count: int = Field(default=1, description="Number of times this edge was traversed")

    # Associated data
    session_ids: list[str] = Field(default_factory=list)
    event_ids: list[UUID] = Field(default_factory=list)

    # Visual properties
    weight: float = Field(default=1.0, description="Edge weight for visualization")
    color: str | None = Field(None)
    metadata: dict[str, Any] = Field(default_factory=dict)

    model_config = {"from_attributes": True}

