"""Database operations for AgentsLeak."""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from agentsleak.config.settings import Settings, get_settings
from agentsleak.models.alerts import Alert, Policy
from agentsleak.models.events import Event, Session
from agentsleak.models.graph import GraphEdge, GraphNode
from agentsleak.store.schema import SCHEMA_SQL


def _serialize_json(value: Any) -> str | None:
    """Serialize a value to JSON string."""
    if value is None:
        return None
    return json.dumps(value, default=str)


def _deserialize_json(value: str | None) -> Any:
    """Deserialize a JSON string to a value."""
    if value is None:
        return None
    return json.loads(value)


def _uuid_to_str(value: UUID | str | None) -> str | None:
    """Convert UUID to string."""
    if value is None:
        return None
    return str(value)


class Database:
    """SQLite database manager for AgentsLeak."""

    ALLOWED_ALERT_COLUMNS = {"status", "action_taken", "assigned_to", "tags", "metadata"}
    ALLOWED_POLICY_COLUMNS = {"name", "description", "enabled", "severity", "action", "conditions", "metadata"}

    def __init__(self, settings: Settings | None = None) -> None:
        """Initialize database connection.

        Args:
            settings: Optional settings. If not provided, uses global settings.
        """
        self.settings = settings or get_settings()
        self.db_path = self.settings.db_path

        # Ensure directory exists
        self.db_path.parent.mkdir(parents=True, exist_ok=True)

        # Initialize connection
        self._connection: sqlite3.Connection | None = None
        self._init_schema()

    @property
    def connection(self) -> sqlite3.Connection:
        """Get or create database connection."""
        if self._connection is None:
            self._connection = sqlite3.connect(
                str(self.db_path),
                check_same_thread=False,
            )
            self._connection.row_factory = sqlite3.Row
            # Enable WAL mode for better concurrent access
            self._connection.execute("PRAGMA journal_mode=WAL")
            # Enable foreign keys
            self._connection.execute("PRAGMA foreign_keys = ON")
        return self._connection

    def _init_schema(self) -> None:
        """Initialize the database schema."""
        with self.transaction() as cursor:
            cursor.executescript(SCHEMA_SQL)
        # Run idempotent migrations
        self._run_migrations()

    def _run_migrations(self) -> None:
        """Run schema migrations (safe to call multiple times)."""
        migrations = [
            "ALTER TABLE sessions ADD COLUMN risk_score INTEGER DEFAULT 0",
            "ALTER TABLE sessions ADD COLUMN endpoint_hostname TEXT",
            "ALTER TABLE sessions ADD COLUMN endpoint_user TEXT",
            "ALTER TABLE sessions ADD COLUMN session_source TEXT",
        ]
        for sql in migrations:
            try:
                self.connection.execute(sql)
                self.connection.commit()
            except sqlite3.OperationalError:
                # Column already exists — expected
                pass

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Cursor]:
        """Context manager for database transactions."""
        cursor = self.connection.cursor()
        try:
            yield cursor
            self.connection.commit()
        except Exception:
            self.connection.rollback()
            raise
        finally:
            cursor.close()

    def close(self) -> None:
        """Close database connection."""
        if self._connection is not None:
            self._connection.close()
            self._connection = None

    # =========================================================================
    # Session Operations
    # =========================================================================

    def save_session(self, session: Session) -> None:
        """Save or update a session."""
        with self.transaction() as cursor:
            cursor.execute(
                """
                INSERT INTO sessions (
                    id, session_id, started_at, ended_at, cwd,
                    parent_session_id, event_count, alert_count, status,
                    endpoint_hostname, endpoint_user, session_source
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(session_id) DO UPDATE SET
                    ended_at = excluded.ended_at,
                    event_count = excluded.event_count,
                    alert_count = excluded.alert_count,
                    status = excluded.status
                """,
                (
                    _uuid_to_str(session.id),
                    session.session_id,
                    session.started_at.isoformat(),
                    session.ended_at.isoformat() if session.ended_at else None,
                    session.cwd,
                    session.parent_session_id,
                    session.event_count,
                    session.alert_count,
                    session.status,
                    session.endpoint_hostname,
                    session.endpoint_user,
                    session.session_source,
                ),
            )

    def get_session_by_id(self, session_id: str) -> Session | None:
        """Get a session by its Claude Code session ID."""
        with self.transaction() as cursor:
            cursor.execute(
                "SELECT * FROM sessions WHERE session_id = ?",
                (session_id,),
            )
            row = cursor.fetchone()
            if row is None:
                return None
            return self._row_to_session(row)

    def get_sessions(
        self,
        limit: int = 100,
        offset: int = 0,
        status: str | None = None,
    ) -> list[Session]:
        """Get sessions with optional filtering."""
        query = "SELECT * FROM sessions"
        params: list[Any] = []

        if status:
            query += " WHERE status = ?"
            params.append(status)

        query += " ORDER BY started_at DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])

        with self.transaction() as cursor:
            cursor.execute(query, params)
            return [self._row_to_session(row) for row in cursor.fetchall()]

    def _row_to_session(self, row: sqlite3.Row) -> Session:
        """Convert a database row to a Session object."""
        # risk_score may not exist in older databases
        try:
            risk_score = row["risk_score"]
        except (IndexError, KeyError):
            risk_score = 0
        # endpoint fields may not exist in older databases
        try:
            endpoint_hostname = row["endpoint_hostname"]
        except (IndexError, KeyError):
            endpoint_hostname = None
        try:
            endpoint_user = row["endpoint_user"]
        except (IndexError, KeyError):
            endpoint_user = None
        try:
            session_source = row["session_source"]
        except (IndexError, KeyError):
            session_source = None
        return Session(
            id=UUID(row["id"]),
            session_id=row["session_id"],
            started_at=datetime.fromisoformat(row["started_at"]),
            ended_at=datetime.fromisoformat(row["ended_at"]) if row["ended_at"] else None,
            cwd=row["cwd"],
            parent_session_id=row["parent_session_id"],
            event_count=row["event_count"],
            alert_count=row["alert_count"],
            risk_score=risk_score or 0,
            status=row["status"],
            endpoint_hostname=endpoint_hostname,
            endpoint_user=endpoint_user,
            session_source=session_source,
        )

    def increment_session_event_count(self, session_id: str) -> None:
        """Increment the event count for a session."""
        with self.transaction() as cursor:
            cursor.execute(
                "UPDATE sessions SET event_count = event_count + 1, status = 'active', ended_at = NULL WHERE session_id = ?",
                (session_id,),
            )

    def increment_session_alert_count(self, session_id: str) -> None:
        """Increment the alert count for a session."""
        with self.transaction() as cursor:
            cursor.execute(
                "UPDATE sessions SET alert_count = alert_count + 1 WHERE session_id = ?",
                (session_id,),
            )

    def increment_session_risk_score(self, session_id: str, delta: int) -> None:
        """Increment the risk score for a session."""
        with self.transaction() as cursor:
            cursor.execute(
                "UPDATE sessions SET risk_score = risk_score + ? WHERE session_id = ?",
                (delta, session_id),
            )

    def end_session(self, session_id: str) -> None:
        """Mark a session as ended."""
        with self.transaction() as cursor:
            cursor.execute(
                "UPDATE sessions SET ended_at = ?, status = 'ended' WHERE session_id = ?",
                (datetime.now(UTC).isoformat(), session_id),
            )

    def cleanup_stale_sessions(self, inactive_minutes: int = 10) -> int:
        """Mark active sessions as ended if they have no recent events.

        A session is considered stale if:
        - Its status is 'active', AND
        - Its last event was more than `inactive_minutes` ago, OR
        - It has no events and was started more than `inactive_minutes` ago.

        Returns the number of sessions closed.
        """
        now = datetime.now(UTC).isoformat()
        cutoff = (datetime.now(UTC) - timedelta(minutes=inactive_minutes)).isoformat()

        with self.transaction() as cursor:
            # Sessions with events: check last event timestamp
            cursor.execute(
                """
                UPDATE sessions SET ended_at = ?, status = 'ended'
                WHERE status = 'active'
                AND session_id IN (
                    SELECT s.session_id FROM sessions s
                    LEFT JOIN (
                        SELECT session_id, MAX(timestamp) as last_event
                        FROM events GROUP BY session_id
                    ) e ON s.session_id = e.session_id
                    WHERE s.status = 'active'
                    AND (
                        (e.last_event IS NOT NULL AND e.last_event < ?)
                        OR (e.last_event IS NULL AND s.started_at < ?)
                    )
                )
                """,
                (now, cutoff, cutoff),
            )
            return cursor.rowcount

    # =========================================================================
    # Event Operations
    # =========================================================================

    def save_event(self, event: Event) -> None:
        """Save an event to the database."""
        with self.transaction() as cursor:
            cursor.execute(
                """
                INSERT OR REPLACE INTO events (
                    id, session_id, timestamp, hook_type, tool_name,
                    tool_input, tool_result, category, severity,
                    file_paths, commands, urls, ip_addresses,
                    processed, enriched, raw_payload
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    _uuid_to_str(event.id),
                    event.session_id,
                    event.timestamp.isoformat(),
                    event.hook_type,
                    event.tool_name,
                    _serialize_json(event.tool_input),
                    _serialize_json(event.tool_result),
                    event.category.value,
                    event.severity.value,
                    _serialize_json(event.file_paths),
                    _serialize_json(event.commands),
                    _serialize_json(event.urls),
                    _serialize_json(event.ip_addresses),
                    1 if event.processed else 0,
                    1 if event.enriched else 0,
                    _serialize_json(event.raw_payload),
                ),
            )

    def get_event_by_id(self, event_id: UUID) -> Event | None:
        """Get an event by its ID."""
        with self.transaction() as cursor:
            cursor.execute(
                "SELECT * FROM events WHERE id = ?",
                (_uuid_to_str(event_id),),
            )
            row = cursor.fetchone()
            if row is None:
                return None
            return self._row_to_event(row)

    def get_events(
        self,
        session_id: str | None = None,
        category: str | None = None,
        severity: str | None = None,
        limit: int = 100,
        offset: int = 0,
        start_time: datetime | None = None,
        end_time: datetime | None = None,
    ) -> list[Event]:
        """Get events with optional filtering."""
        query = "SELECT * FROM events WHERE 1=1"
        params: list[Any] = []

        if session_id:
            query += " AND session_id = ?"
            params.append(session_id)
        if category:
            query += " AND category = ?"
            params.append(category)
        if severity:
            query += " AND severity = ?"
            params.append(severity)
        if start_time:
            query += " AND timestamp >= ?"
            params.append(start_time.isoformat())
        if end_time:
            query += " AND timestamp <= ?"
            params.append(end_time.isoformat())

        query += " ORDER BY timestamp DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])

        with self.transaction() as cursor:
            cursor.execute(query, params)
            return [self._row_to_event(row) for row in cursor.fetchall()]

    def get_unprocessed_events(self, limit: int = 100) -> list[Event]:
        """Get events that haven't been processed yet."""
        with self.transaction() as cursor:
            cursor.execute(
                "SELECT * FROM events WHERE processed = 0 ORDER BY timestamp LIMIT ?",
                (limit,),
            )
            return [self._row_to_event(row) for row in cursor.fetchall()]

    def mark_event_processed(self, event_id: UUID) -> None:
        """Mark an event as processed."""
        with self.transaction() as cursor:
            cursor.execute(
                "UPDATE events SET processed = 1 WHERE id = ?",
                (_uuid_to_str(event_id),),
            )

    def _row_to_event(self, row: sqlite3.Row) -> Event:
        """Convert a database row to an Event object."""
        from agentsleak.models.events import EventCategory, Severity

        return Event(
            id=UUID(row["id"]),
            session_id=row["session_id"],
            timestamp=datetime.fromisoformat(row["timestamp"]),
            hook_type=row["hook_type"],
            tool_name=row["tool_name"],
            tool_input=_deserialize_json(row["tool_input"]),
            tool_result=_deserialize_json(row["tool_result"]),
            category=EventCategory(row["category"]),
            severity=Severity(row["severity"]),
            file_paths=_deserialize_json(row["file_paths"]) or [],
            commands=_deserialize_json(row["commands"]) or [],
            urls=_deserialize_json(row["urls"]) or [],
            ip_addresses=_deserialize_json(row["ip_addresses"]) or [],
            processed=bool(row["processed"]),
            enriched=bool(row["enriched"]),
            raw_payload=_deserialize_json(row["raw_payload"]),
        )

    # =========================================================================
    # Alert Operations
    # =========================================================================

    def save_alert(self, alert: Alert) -> None:
        """Save an alert to the database."""
        with self.transaction() as cursor:
            cursor.execute(
                """
                INSERT INTO alerts (
                    id, session_id, created_at, updated_at, title, description,
                    severity, category, status, assigned_to, policy_id,
                    event_ids, evidence, action_taken, blocked, tags, metadata
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    status = excluded.status,
                    assigned_to = excluded.assigned_to,
                    action_taken = excluded.action_taken,
                    evidence = excluded.evidence,
                    tags = excluded.tags,
                    metadata = excluded.metadata
                """,
                (
                    _uuid_to_str(alert.id),
                    alert.session_id,
                    alert.created_at.isoformat(),
                    alert.updated_at.isoformat(),
                    alert.title,
                    alert.description,
                    alert.severity.value,
                    alert.category.value,
                    alert.status.value,
                    alert.assigned_to,
                    _uuid_to_str(alert.policy_id),
                    _serialize_json([str(eid) for eid in alert.event_ids]),
                    _serialize_json([e.model_dump() for e in alert.evidence]),
                    alert.action_taken,
                    1 if alert.blocked else 0,
                    _serialize_json(alert.tags),
                    _serialize_json(alert.metadata),
                ),
            )

    def get_alert_by_id(self, alert_id: UUID) -> Alert | None:
        """Get an alert by its ID."""
        with self.transaction() as cursor:
            cursor.execute(
                "SELECT * FROM alerts WHERE id = ?",
                (_uuid_to_str(alert_id),),
            )
            row = cursor.fetchone()
            if row is None:
                return None
            return self._row_to_alert(row)

    def get_alerts(
        self,
        session_id: str | None = None,
        status: str | None = None,
        severity: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[Alert]:
        """Get alerts with optional filtering."""
        query = "SELECT * FROM alerts WHERE 1=1"
        params: list[Any] = []

        if session_id:
            query += " AND session_id = ?"
            params.append(session_id)
        if status:
            query += " AND status = ?"
            params.append(status)
        if severity:
            query += " AND severity = ?"
            params.append(severity)

        query += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])

        with self.transaction() as cursor:
            cursor.execute(query, params)
            return [self._row_to_alert(row) for row in cursor.fetchall()]

    def update_alert_status(self, alert_id: UUID, status: str) -> None:
        """Update an alert's status."""
        with self.transaction() as cursor:
            cursor.execute(
                "UPDATE alerts SET status = ? WHERE id = ?",
                (status, _uuid_to_str(alert_id)),
            )

    def _row_to_alert(self, row: sqlite3.Row) -> Alert:
        """Convert a database row to an Alert object."""
        from agentsleak.models.alerts import AlertEvidence, AlertStatus
        from agentsleak.models.events import EventCategory, Severity

        evidence_data = _deserialize_json(row["evidence"]) or []
        evidence = [AlertEvidence(**e) for e in evidence_data]

        event_ids_data = _deserialize_json(row["event_ids"]) or []
        event_ids = [UUID(eid) for eid in event_ids_data]

        return Alert(
            id=UUID(row["id"]),
            session_id=row["session_id"],
            created_at=datetime.fromisoformat(row["created_at"]),
            updated_at=datetime.fromisoformat(row["updated_at"]),
            title=row["title"],
            description=row["description"] or "",
            severity=Severity(row["severity"]),
            category=EventCategory(row["category"]),
            status=AlertStatus(row["status"]),
            assigned_to=row["assigned_to"],
            policy_id=UUID(row["policy_id"]) if row["policy_id"] else None,
            event_ids=event_ids,
            evidence=evidence,
            action_taken=row["action_taken"],
            blocked=bool(row["blocked"]),
            tags=_deserialize_json(row["tags"]) or [],
            metadata=_deserialize_json(row["metadata"]) or {},
        )

    # =========================================================================
    # Policy Operations
    # =========================================================================

    def save_policy(self, policy: Policy) -> None:
        """Save a policy to the database."""
        with self.transaction() as cursor:
            cursor.execute(
                """
                INSERT INTO policies (
                    id, name, description, enabled, categories, tools,
                    conditions, condition_logic, action, severity,
                    alert_title, alert_description, tags
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(name) DO UPDATE SET
                    description = excluded.description,
                    enabled = excluded.enabled,
                    categories = excluded.categories,
                    tools = excluded.tools,
                    conditions = excluded.conditions,
                    condition_logic = excluded.condition_logic,
                    action = excluded.action,
                    severity = excluded.severity,
                    alert_title = excluded.alert_title,
                    alert_description = excluded.alert_description,
                    tags = excluded.tags
                """,
                (
                    _uuid_to_str(policy.id),
                    policy.name,
                    policy.description,
                    1 if policy.enabled else 0,
                    _serialize_json([c.value for c in policy.categories]),
                    _serialize_json(policy.tools),
                    _serialize_json([c.model_dump() for c in policy.conditions]),
                    policy.condition_logic,
                    policy.action.value,
                    policy.severity.value,
                    policy.alert_title,
                    policy.alert_description,
                    _serialize_json(policy.tags),
                ),
            )

    def get_policies(self, enabled_only: bool = True) -> list[Policy]:
        """Get all policies."""
        query = "SELECT * FROM policies"
        params: list[Any] = []

        if enabled_only:
            query += " WHERE enabled = 1"

        with self.transaction() as cursor:
            cursor.execute(query, params)
            return [self._row_to_policy(row) for row in cursor.fetchall()]

    def _row_to_policy(self, row: sqlite3.Row) -> Policy:
        """Convert a database row to a Policy object."""
        from agentsleak.models.alerts import PolicyAction, RuleCondition
        from agentsleak.models.events import EventCategory, Severity

        categories_data = _deserialize_json(row["categories"]) or []
        categories = [EventCategory(c) for c in categories_data]

        conditions_data = _deserialize_json(row["conditions"]) or []
        conditions = [RuleCondition(**c) for c in conditions_data]

        return Policy(
            id=UUID(row["id"]),
            name=row["name"],
            description=row["description"] or "",
            enabled=bool(row["enabled"]),
            categories=categories,
            tools=_deserialize_json(row["tools"]) or [],
            conditions=conditions,
            condition_logic=row["condition_logic"],
            action=PolicyAction(row["action"]),
            severity=Severity(row["severity"]),
            alert_title=row["alert_title"] or "",
            alert_description=row["alert_description"] or "",
            tags=_deserialize_json(row["tags"]) or [],
            created_at=datetime.fromisoformat(row["created_at"]),
            updated_at=datetime.fromisoformat(row["updated_at"]),
        )

    def get_events_before(
        self,
        session_id: str,
        before: datetime,
        limit: int = 20,
    ) -> list[Event]:
        """Get events in a session up to a given timestamp, ordered chronologically."""
        query = (
            "SELECT * FROM events WHERE session_id = ? AND timestamp <= ? "
            "ORDER BY timestamp DESC LIMIT ?"
        )
        with self.transaction() as cursor:
            cursor.execute(query, (session_id, before.isoformat(), limit))
            rows = cursor.fetchall()
        # Return in chronological order (oldest first)
        return [self._row_to_event(row) for row in reversed(rows)]

    def get_alert_counts_by_policy(self) -> dict[str, int]:
        """Return {policy_id: alert_count} for all policies that have alerts."""
        query = "SELECT policy_id, COUNT(*) as cnt FROM alerts WHERE policy_id IS NOT NULL GROUP BY policy_id"
        with self.transaction() as cursor:
            cursor.execute(query)
            return {row["policy_id"]: row["cnt"] for row in cursor.fetchall()}

    # =========================================================================
    # Graph Operations
    # =========================================================================

    def save_graph_node(self, node: GraphNode) -> str:
        """Save or update a graph node. Returns the actual node ID (existing or new)."""
        with self.transaction() as cursor:
            cursor.execute(
                """
                INSERT INTO graph_nodes (
                    id, node_type, label, value, first_seen, last_seen,
                    access_count, alert_count, session_ids, event_ids,
                    size, color, metadata
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(node_type, value) DO UPDATE SET
                    last_seen = excluded.last_seen,
                    access_count = access_count + 1,
                    alert_count = alert_count + excluded.alert_count,
                    session_ids = excluded.session_ids,
                    event_ids = excluded.event_ids,
                    size = size + 1
                """,
                (
                    _uuid_to_str(node.id),
                    node.node_type.value,
                    node.label,
                    node.value,
                    node.first_seen.isoformat(),
                    node.last_seen.isoformat(),
                    node.access_count,
                    node.alert_count,
                    _serialize_json(node.session_ids),
                    _serialize_json([str(eid) for eid in node.event_ids]),
                    node.size,
                    node.color,
                    _serialize_json(node.metadata),
                ),
            )
            # Return the actual ID (may differ from node.id on conflict)
            cursor.execute(
                "SELECT id FROM graph_nodes WHERE node_type = ? AND value = ?",
                (node.node_type.value, node.value),
            )
            row = cursor.fetchone()
            return row["id"] if row else _uuid_to_str(node.id)

    def save_graph_edge(self, edge: GraphEdge) -> None:
        """Save or update a graph edge."""
        with self.transaction() as cursor:
            cursor.execute(
                """
                INSERT INTO graph_edges (
                    id, source_id, target_id, relation, first_seen, last_seen,
                    count, session_ids, event_ids, weight, color, metadata
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(source_id, target_id, relation) DO UPDATE SET
                    last_seen = excluded.last_seen,
                    count = count + 1,
                    session_ids = excluded.session_ids,
                    event_ids = excluded.event_ids,
                    weight = weight + 1
                """,
                (
                    _uuid_to_str(edge.id),
                    _uuid_to_str(edge.source_id),
                    _uuid_to_str(edge.target_id),
                    edge.relation.value,
                    edge.first_seen.isoformat(),
                    edge.last_seen.isoformat(),
                    edge.count,
                    _serialize_json(edge.session_ids),
                    _serialize_json([str(eid) for eid in edge.event_ids]),
                    edge.weight,
                    edge.color,
                    _serialize_json(edge.metadata),
                ),
            )

    # =========================================================================
    # Statistics Operations
    # =========================================================================

    def get_event_count(
        self,
        session_id: str | None = None,
        start_time: datetime | None = None,
        end_time: datetime | None = None,
    ) -> int:
        """Get total event count with optional filtering."""
        query = "SELECT COUNT(*) FROM events WHERE 1=1"
        params: list[Any] = []

        if session_id:
            query += " AND session_id = ?"
            params.append(session_id)
        if start_time:
            query += " AND timestamp >= ?"
            params.append(start_time.isoformat())
        if end_time:
            query += " AND timestamp <= ?"
            params.append(end_time.isoformat())

        with self.transaction() as cursor:
            cursor.execute(query, params)
            result = cursor.fetchone()
            return result[0] if result else 0

    def get_alert_count(
        self,
        session_id: str | None = None,
        status: str | None = None,
    ) -> int:
        """Get total alert count with optional filtering."""
        query = "SELECT COUNT(*) FROM alerts WHERE 1=1"
        params: list[Any] = []

        if session_id:
            query += " AND session_id = ?"
            params.append(session_id)
        if status:
            query += " AND status = ?"
            params.append(status)

        with self.transaction() as cursor:
            cursor.execute(query, params)
            result = cursor.fetchone()
            return result[0] if result else 0

    def get_event_counts_by_session(self, session_ids: list[str]) -> dict[str, int]:
        """Get actual event counts for multiple sessions in one query."""
        if not session_ids:
            return {}
        placeholders = ",".join("?" * len(session_ids))
        with self.transaction() as cursor:
            cursor.execute(
                f"SELECT session_id, COUNT(*) as cnt FROM events "
                f"WHERE session_id IN ({placeholders}) GROUP BY session_id",
                session_ids,
            )
            return {row["session_id"]: row["cnt"] for row in cursor.fetchall()}

    def get_alert_counts_by_session(self, session_ids: list[str]) -> dict[str, int]:
        """Get actual alert counts for multiple sessions in one query."""
        if not session_ids:
            return {}
        placeholders = ",".join("?" * len(session_ids))
        with self.transaction() as cursor:
            cursor.execute(
                f"SELECT session_id, COUNT(*) as cnt FROM alerts "
                f"WHERE session_id IN ({placeholders}) GROUP BY session_id",
                session_ids,
            )
            return {row["session_id"]: row["cnt"] for row in cursor.fetchall()}

    def get_session_count(self, status: str | None = None) -> int:
        """Get total session count with optional filtering."""
        query = "SELECT COUNT(*) FROM sessions WHERE 1=1"
        params: list[Any] = []

        if status:
            query += " AND status = ?"
            params.append(status)

        with self.transaction() as cursor:
            cursor.execute(query, params)
            result = cursor.fetchone()
            return result[0] if result else 0

    # =========================================================================
    # Extended API Query Methods
    # =========================================================================

    def get_sessions_paginated(
        self,
        page: int = 1,
        page_size: int = 20,
        status: str | None = None,
        hostname: str | None = None,
        username: str | None = None,
        from_date: datetime | None = None,
        to_date: datetime | None = None,
        session_source: str | None = None,
    ) -> dict[str, Any]:
        """Get sessions with pagination and filters."""
        base_query = "FROM sessions WHERE 1=1"
        params: list[Any] = []

        if status:
            base_query += " AND status = ?"
            params.append(status)
        if hostname:
            base_query += " AND endpoint_hostname = ?"
            params.append(hostname)
        if username:
            base_query += " AND endpoint_user = ?"
            params.append(username)
        if session_source:
            base_query += " AND session_source = ?"
            params.append(session_source)
        if from_date:
            base_query += " AND started_at >= ?"
            params.append(from_date.isoformat())
        if to_date:
            base_query += " AND started_at <= ?"
            params.append(to_date.isoformat())

        # Get total count
        with self.transaction() as cursor:
            cursor.execute(f"SELECT COUNT(*) {base_query}", params)
            total = cursor.fetchone()[0]

        # Get paginated results
        offset = (page - 1) * page_size
        query = f"SELECT * {base_query} ORDER BY started_at DESC LIMIT ? OFFSET ?"
        params.extend([page_size, offset])

        with self.transaction() as cursor:
            cursor.execute(query, params)
            items = [self._row_to_session(row) for row in cursor.fetchall()]

        return {"items": items, "total": total}

    def get_session_stats(self, session_id: str) -> dict[str, Any]:
        """Get detailed statistics for a session."""
        stats: dict[str, Any] = {
            "events_by_category": {},
            "events_by_severity": {},
            "alerts_by_severity": {},
        }

        # Events by category
        with self.transaction() as cursor:
            cursor.execute(
                """
                SELECT category, COUNT(*) as count
                FROM events WHERE session_id = ?
                GROUP BY category
                """,
                (session_id,),
            )
            for row in cursor.fetchall():
                stats["events_by_category"][row["category"]] = row["count"]

        # Events by severity
        with self.transaction() as cursor:
            cursor.execute(
                """
                SELECT severity, COUNT(*) as count
                FROM events WHERE session_id = ?
                GROUP BY severity
                """,
                (session_id,),
            )
            for row in cursor.fetchall():
                stats["events_by_severity"][row["severity"]] = row["count"]

        # Alerts by severity
        with self.transaction() as cursor:
            cursor.execute(
                """
                SELECT severity, COUNT(*) as count
                FROM alerts WHERE session_id = ?
                GROUP BY severity
                """,
                (session_id,),
            )
            for row in cursor.fetchall():
                stats["alerts_by_severity"][row["severity"]] = row["count"]

        # Event time range
        with self.transaction() as cursor:
            cursor.execute(
                """
                SELECT MIN(timestamp) as first_event_at,
                       MAX(timestamp) as last_event_at
                FROM events WHERE session_id = ?
                """,
                (session_id,),
            )
            row = cursor.fetchone()
            stats["first_event_at"] = row["first_event_at"] if row else None
            stats["last_event_at"] = row["last_event_at"] if row else None

        return stats

    def get_events_paginated(
        self,
        page: int = 1,
        page_size: int = 50,
        session_id: str | None = None,
        category: str | None = None,
        severity: str | None = None,
        tool_name: str | None = None,
        blocked: bool | None = None,
        from_date: datetime | None = None,
        to_date: datetime | None = None,
    ) -> dict[str, Any]:
        """Get events with pagination and filters."""
        base_query = "FROM events WHERE 1=1"
        params: list[Any] = []

        if session_id:
            base_query += " AND session_id = ?"
            params.append(session_id)
        if category:
            base_query += " AND category = ?"
            params.append(category)
        if severity:
            base_query += " AND severity = ?"
            params.append(severity)
        if tool_name:
            base_query += " AND tool_name = ?"
            params.append(tool_name)
        if from_date:
            base_query += " AND timestamp >= ?"
            params.append(from_date.isoformat())
        if to_date:
            base_query += " AND timestamp <= ?"
            params.append(to_date.isoformat())

        # Get total count
        with self.transaction() as cursor:
            cursor.execute(f"SELECT COUNT(*) {base_query}", params)
            total = cursor.fetchone()[0]

        # Get paginated results
        offset = (page - 1) * page_size
        query = f"SELECT * {base_query} ORDER BY timestamp DESC LIMIT ? OFFSET ?"
        params.extend([page_size, offset])

        with self.transaction() as cursor:
            cursor.execute(query, params)
            items = [self._row_to_event(row) for row in cursor.fetchall()]

        return {"items": items, "total": total}

    def get_alerts_paginated(
        self,
        page: int = 1,
        page_size: int = 20,
        status: str | None = None,
        severity: str | None = None,
        policy_id: UUID | None = None,
        session_id: str | None = None,
        from_date: datetime | None = None,
        to_date: datetime | None = None,
    ) -> dict[str, Any]:
        """Get alerts with pagination and filters."""
        base_query = "FROM alerts WHERE 1=1"
        params: list[Any] = []

        if status:
            base_query += " AND status = ?"
            params.append(status)
        if severity:
            base_query += " AND severity = ?"
            params.append(severity)
        if policy_id:
            base_query += " AND policy_id = ?"
            params.append(_uuid_to_str(policy_id))
        if session_id:
            base_query += " AND session_id = ?"
            params.append(session_id)
        if from_date:
            base_query += " AND created_at >= ?"
            params.append(from_date.isoformat())
        if to_date:
            base_query += " AND created_at <= ?"
            params.append(to_date.isoformat())

        # Get total count
        with self.transaction() as cursor:
            cursor.execute(f"SELECT COUNT(*) {base_query}", params)
            total = cursor.fetchone()[0]

        # Get paginated results
        offset = (page - 1) * page_size
        query = f"SELECT * {base_query} ORDER BY created_at DESC LIMIT ? OFFSET ?"
        params.extend([page_size, offset])

        with self.transaction() as cursor:
            cursor.execute(query, params)
            items = [self._row_to_alert(row) for row in cursor.fetchall()]

        return {"items": items, "total": total}

    def update_alert(self, alert_id: UUID, data: dict[str, Any]) -> Alert:
        """Update an alert with the given data."""
        set_clauses = []
        params: list[Any] = []

        for key, value in data.items():
            if key not in self.ALLOWED_ALERT_COLUMNS:
                raise ValueError(
                    f"Invalid alert column: {key!r}. "
                    f"Allowed columns: {sorted(self.ALLOWED_ALERT_COLUMNS)}"
                )
            if key == "tags":
                set_clauses.append(f"{key} = ?")
                params.append(_serialize_json(value))
            else:
                set_clauses.append(f"{key} = ?")
                params.append(value)

        # Always update updated_at
        set_clauses.append("updated_at = ?")
        params.append(datetime.now(UTC).isoformat())

        params.append(_uuid_to_str(alert_id))

        with self.transaction() as cursor:
            cursor.execute(
                f"UPDATE alerts SET {', '.join(set_clauses)} WHERE id = ?",
                params,
            )

        return self.get_alert_by_id(alert_id)  # type: ignore

    def get_all_policies(self, enabled_only: bool = False) -> list[Policy]:
        """Get all policies."""
        query = "SELECT * FROM policies"
        if enabled_only:
            query += " WHERE enabled = 1"
        query += " ORDER BY created_at DESC"

        with self.transaction() as cursor:
            cursor.execute(query)
            return [self._row_to_policy(row) for row in cursor.fetchall()]

    def get_policy_by_id(self, policy_id: UUID) -> Policy | None:
        """Get a policy by its ID."""
        with self.transaction() as cursor:
            cursor.execute(
                "SELECT * FROM policies WHERE id = ?",
                (_uuid_to_str(policy_id),),
            )
            row = cursor.fetchone()
            if row is None:
                return None
            return self._row_to_policy(row)

    def update_policy(self, policy_id: UUID, data: dict[str, Any]) -> Policy:
        """Update a policy with the given data."""

        set_clauses = []
        params: list[Any] = []

        for key, value in data.items():
            if key not in self.ALLOWED_POLICY_COLUMNS:
                raise ValueError(
                    f"Invalid policy column: {key!r}. "
                    f"Allowed columns: {sorted(self.ALLOWED_POLICY_COLUMNS)}"
                )
            if key == "categories":
                set_clauses.append(f"{key} = ?")
                params.append(_serialize_json([c.value for c in value]))
            elif key == "conditions":
                set_clauses.append(f"{key} = ?")
                params.append(_serialize_json([c.model_dump() for c in value]))
            elif key == "tags" or key == "tools":
                set_clauses.append(f"{key} = ?")
                params.append(_serialize_json(value))
            elif key == "action":
                set_clauses.append(f"{key} = ?")
                params.append(value.value if hasattr(value, "value") else value)
            elif key == "severity":
                set_clauses.append(f"{key} = ?")
                params.append(value.value if hasattr(value, "value") else value)
            elif key == "enabled":
                set_clauses.append(f"{key} = ?")
                params.append(1 if value else 0)
            else:
                set_clauses.append(f"{key} = ?")
                params.append(value)

        params.append(_uuid_to_str(policy_id))

        with self.transaction() as cursor:
            cursor.execute(
                f"UPDATE policies SET {', '.join(set_clauses)} WHERE id = ?",
                params,
            )

        return self.get_policy_by_id(policy_id)  # type: ignore

    def delete_policy(self, policy_id: UUID) -> None:
        """Delete a policy."""
        with self.transaction() as cursor:
            # Unlink alerts that reference this policy
            cursor.execute(
                "UPDATE alerts SET policy_id = NULL WHERE policy_id = ?",
                (_uuid_to_str(policy_id),),
            )
            cursor.execute(
                "DELETE FROM policies WHERE id = ?",
                (_uuid_to_str(policy_id),),
            )

    def get_session_graph(self, session_id: str) -> dict[str, Any]:
        """Get graph nodes and edges for a specific session."""

        nodes: list[GraphNode] = []
        edges: list[GraphEdge] = []

        # Get nodes associated with this session
        with self.transaction() as cursor:
            cursor.execute(
                """
                SELECT * FROM graph_nodes
                WHERE session_ids LIKE ?
                ORDER BY access_count DESC
                """,
                (f'%"{session_id}"%',),
            )
            for row in cursor.fetchall():
                nodes.append(self._row_to_graph_node(row))

        # Get edges associated with this session
        if nodes:
            node_ids = [_uuid_to_str(n.id) for n in nodes]
            placeholders = ",".join("?" * len(node_ids))
            with self.transaction() as cursor:
                cursor.execute(
                    f"""
                    SELECT * FROM graph_edges
                    WHERE source_id IN ({placeholders})
                    OR target_id IN ({placeholders})
                    """,
                    node_ids + node_ids,
                )
                for row in cursor.fetchall():
                    edges.append(self._row_to_graph_edge(row))

        return {"nodes": nodes, "edges": edges}

    def get_global_graph(
        self,
        from_date: datetime | None = None,
        to_date: datetime | None = None,
        limit_nodes: int = 500,
        endpoint: str | None = None,
        session_source: str | None = None,
    ) -> dict[str, Any]:
        """Get aggregated graph across all sessions."""

        nodes: list[GraphNode] = []
        edges: list[GraphEdge] = []

        # If endpoint or source filter is set, get the allowed session_ids
        allowed_session_ids: set[str] | None = None
        if endpoint:
            ep_ids = self._get_session_ids_for_endpoint(endpoint)
            if not ep_ids:
                return {"nodes": nodes, "edges": edges}
            allowed_session_ids = set(ep_ids)

        if session_source:
            src_ids = self._get_session_ids_for_source(session_source)
            if not src_ids:
                return {"nodes": nodes, "edges": edges}
            if allowed_session_ids is not None:
                allowed_session_ids &= set(src_ids)
            else:
                allowed_session_ids = set(src_ids)

        base_query = "SELECT * FROM graph_nodes WHERE 1=1"
        params: list[Any] = []

        if from_date:
            base_query += " AND last_seen >= ?"
            params.append(from_date.isoformat())
        if to_date:
            base_query += " AND last_seen <= ?"
            params.append(to_date.isoformat())

        base_query += " ORDER BY access_count DESC LIMIT ?"
        params.append(limit_nodes)

        with self.transaction() as cursor:
            cursor.execute(base_query, params)
            for row in cursor.fetchall():
                nodes.append(self._row_to_graph_node(row))

        # Post-filter nodes by endpoint: keep only nodes whose session_ids
        # intersect with the allowed set
        if allowed_session_ids is not None:
            nodes = [
                n for n in nodes
                if set(n.session_ids) & allowed_session_ids
            ]

        # Get edges between these nodes
        if nodes:
            node_ids = [_uuid_to_str(n.id) for n in nodes]
            placeholders = ",".join("?" * len(node_ids))
            with self.transaction() as cursor:
                cursor.execute(
                    f"""
                    SELECT * FROM graph_edges
                    WHERE source_id IN ({placeholders})
                    AND target_id IN ({placeholders})
                    """,
                    node_ids + node_ids,
                )
                for row in cursor.fetchall():
                    edges.append(self._row_to_graph_edge(row))

        return {"nodes": nodes, "edges": edges}

    def _row_to_graph_node(self, row: sqlite3.Row) -> GraphNode:
        """Convert a database row to a GraphNode."""
        from agentsleak.models.graph import NodeType

        event_ids_data = _deserialize_json(row["event_ids"]) or []
        event_ids = [UUID(eid) for eid in event_ids_data]

        return GraphNode(
            id=UUID(row["id"]),
            node_type=NodeType(row["node_type"]),
            label=row["label"],
            value=row["value"],
            first_seen=datetime.fromisoformat(row["first_seen"]),
            last_seen=datetime.fromisoformat(row["last_seen"]),
            access_count=row["access_count"],
            alert_count=row["alert_count"],
            session_ids=_deserialize_json(row["session_ids"]) or [],
            event_ids=event_ids,
            size=row["size"],
            color=row["color"],
            metadata=_deserialize_json(row["metadata"]) or {},
        )

    def _row_to_graph_edge(self, row: sqlite3.Row) -> GraphEdge:
        """Convert a database row to a GraphEdge."""
        from agentsleak.models.graph import EdgeRelation

        event_ids_data = _deserialize_json(row["event_ids"]) or []
        event_ids = [UUID(eid) for eid in event_ids_data]

        return GraphEdge(
            id=UUID(row["id"]),
            source_id=UUID(row["source_id"]),
            target_id=UUID(row["target_id"]),
            relation=EdgeRelation(row["relation"]),
            first_seen=datetime.fromisoformat(row["first_seen"]),
            last_seen=datetime.fromisoformat(row["last_seen"]),
            count=row["count"],
            session_ids=_deserialize_json(row["session_ids"]) or [],
            event_ids=event_ids,
            weight=row["weight"],
            color=row["color"],
            metadata=_deserialize_json(row["metadata"]) or {},
        )

    def get_dashboard_stats(
        self,
        from_date: datetime | None = None,
        to_date: datetime | None = None,
        endpoint: str | None = None,
    ) -> dict[str, Any]:
        """Get dashboard overview statistics, optionally filtered by time range and endpoint."""
        stats: dict[str, Any] = {}

        # Build date filter clauses
        ev_date_clause = ""
        al_date_clause = ""
        ev_params: list[Any] = []
        al_params: list[Any] = []
        if from_date:
            ev_date_clause += " AND timestamp >= ?"
            ev_params.append(from_date.isoformat())
            al_date_clause += " AND created_at >= ?"
            al_params.append(from_date.isoformat())
        if to_date:
            ev_date_clause += " AND timestamp <= ?"
            ev_params.append(to_date.isoformat())
            al_date_clause += " AND created_at <= ?"
            al_params.append(to_date.isoformat())

        # Endpoint filter — restrict to session_ids belonging to the endpoint
        ep_session_clause_ev = ""
        ep_session_clause_al = ""
        if endpoint:
            ep_session_ids = self._get_session_ids_for_endpoint(endpoint)
            if ep_session_ids:
                placeholders = ",".join("?" * len(ep_session_ids))
                ep_session_clause_ev = f" AND session_id IN ({placeholders})"
                ep_session_clause_al = f" AND session_id IN ({placeholders})"
                ev_params.extend(ep_session_ids)
                al_params.extend(ep_session_ids)
            else:
                # No sessions for this endpoint — return zeros
                return {
                    "total_sessions": 0, "active_sessions": 0, "total_events": 0,
                    "total_alerts": 0, "new_alerts": 0, "blocked_actions": 0,
                    "alerts_by_severity": {"critical": 0, "high": 0, "medium": 0, "low": 0, "info": 0},
                    "events_by_category": {
                        "file_read": 0, "file_write": 0, "file_delete": 0, "command_exec": 0,
                        "network_access": 0, "code_execution": 0, "subagent_spawn": 0,
                        "mcp_tool_use": 0, "session_lifecycle": 0, "unknown": 0,
                    },
                    "recent_alerts": [], "recent_events": [],
                    "sessions_by_source": {},
                }

        # Build endpoint clause for sessions table
        ep_sess_clause = ""
        ep_sess_params: list[Any] = []
        if endpoint:
            ep_sess_clause = " AND endpoint_hostname = ?"
            ep_sess_params = [endpoint]

        with self.transaction() as cursor:
            # Total/active sessions
            sess_clause = "WHERE 1=1"
            sess_params: list[Any] = []
            if from_date:
                sess_clause += " AND started_at >= ?"
                sess_params.append(from_date.isoformat())
            if to_date:
                sess_clause += " AND started_at <= ?"
                sess_params.append(to_date.isoformat())
            sess_clause += ep_sess_clause
            sess_params.extend(ep_sess_params)
            cursor.execute(f"SELECT COUNT(*) FROM sessions {sess_clause}", sess_params)
            stats["total_sessions"] = cursor.fetchone()[0]
            cursor.execute(f"SELECT COUNT(*) FROM sessions {sess_clause} AND status = 'active'", sess_params)
            stats["active_sessions"] = cursor.fetchone()[0]

            # Event count
            cursor.execute(f"SELECT COUNT(*) FROM events WHERE 1=1{ev_date_clause}{ep_session_clause_ev}", ev_params)
            stats["total_events"] = cursor.fetchone()[0]

            # Alert counts
            cursor.execute(f"SELECT COUNT(*) FROM alerts WHERE 1=1{al_date_clause}{ep_session_clause_al}", al_params)
            stats["total_alerts"] = cursor.fetchone()[0]
            cursor.execute(f"SELECT COUNT(*) FROM alerts WHERE status = 'new'{al_date_clause}{ep_session_clause_al}", al_params)
            stats["new_alerts"] = cursor.fetchone()[0]

            # Blocked actions count
            cursor.execute(f"SELECT COUNT(*) FROM alerts WHERE blocked = 1{al_date_clause}{ep_session_clause_al}", al_params)
            stats["blocked_actions"] = cursor.fetchone()[0]

        # Alerts by severity
        stats["alerts_by_severity"] = {
            "critical": 0,
            "high": 0,
            "medium": 0,
            "low": 0,
            "info": 0,
        }
        with self.transaction() as cursor:
            cursor.execute(
                f"SELECT severity, COUNT(*) as count FROM alerts WHERE 1=1{al_date_clause}{ep_session_clause_al} GROUP BY severity",
                al_params,
            )
            for row in cursor.fetchall():
                if row["severity"] in stats["alerts_by_severity"]:
                    stats["alerts_by_severity"][row["severity"]] = row["count"]

        # Events by category
        stats["events_by_category"] = {
            "file_read": 0,
            "file_write": 0,
            "file_delete": 0,
            "command_exec": 0,
            "network_access": 0,
            "code_execution": 0,
            "subagent_spawn": 0,
            "mcp_tool_use": 0,
            "session_lifecycle": 0,
            "unknown": 0,
        }
        with self.transaction() as cursor:
            cursor.execute(
                f"SELECT category, COUNT(*) as count FROM events WHERE 1=1{ev_date_clause}{ep_session_clause_ev} GROUP BY category",
                ev_params,
            )
            for row in cursor.fetchall():
                if row["category"] in stats["events_by_category"]:
                    stats["events_by_category"][row["category"]] = row["count"]

        # Recent alerts (within range)
        stats["recent_alerts"] = []
        with self.transaction() as cursor:
            cursor.execute(
                f"""
                SELECT id, title, severity, status, session_id, created_at
                FROM alerts WHERE 1=1{al_date_clause}{ep_session_clause_al}
                ORDER BY created_at DESC LIMIT 10
                """,
                al_params,
            )
            for row in cursor.fetchall():
                stats["recent_alerts"].append({
                    "id": row["id"],
                    "title": row["title"],
                    "severity": row["severity"],
                    "status": row["status"],
                    "session_id": row["session_id"],
                    "created_at": datetime.fromisoformat(row["created_at"]),
                })

        # Recent events (within range)
        stats["recent_events"] = []
        with self.transaction() as cursor:
            cursor.execute(
                f"""
                SELECT id, tool_name, category, severity, session_id, timestamp
                FROM events WHERE 1=1{ev_date_clause}{ep_session_clause_ev}
                ORDER BY timestamp DESC LIMIT 10
                """,
                ev_params,
            )
            for row in cursor.fetchall():
                stats["recent_events"].append({
                    "id": row["id"],
                    "tool_name": row["tool_name"],
                    "category": row["category"],
                    "severity": row["severity"],
                    "session_id": row["session_id"],
                    "timestamp": datetime.fromisoformat(row["timestamp"]),
                })

        # Sessions by source
        stats["sessions_by_source"] = {}
        with self.transaction() as cursor:
            cursor.execute(
                f"SELECT COALESCE(session_source, 'claude_code') as src, COUNT(*) as count FROM sessions {sess_clause} GROUP BY src",
                sess_params,
            )
            for row in cursor.fetchall():
                stats["sessions_by_source"][row["src"]] = row["count"]

        return stats

    MAX_TIMELINE_BUCKETS = 500

    def get_timeline_stats(
        self,
        from_date: datetime,
        to_date: datetime,
        interval: str = "hour",
        session_id: str | None = None,
        endpoint: str | None = None,
    ) -> dict[str, Any]:
        """Get timeline data for events and alerts.

        Caps at MAX_TIMELINE_BUCKETS — auto-upgrades interval if needed.
        """
        # Auto-upgrade interval if range would exceed bucket cap
        range_seconds = (to_date - from_date).total_seconds()
        interval_seconds = {"minute": 60, "hour": 3600, "day": 86400}
        estimated_buckets = range_seconds / interval_seconds.get(interval, 3600)

        if estimated_buckets > self.MAX_TIMELINE_BUCKETS:
            if interval == "minute":
                interval = "hour"
                estimated_buckets = range_seconds / 3600
            if estimated_buckets > self.MAX_TIMELINE_BUCKETS:
                interval = "day"

        # Determine the strftime format based on interval
        if interval == "minute":
            time_format = "%Y-%m-%d %H:%M:00"
        elif interval == "day":
            time_format = "%Y-%m-%d 00:00:00"
        else:  # hour
            time_format = "%Y-%m-%d %H:00:00"

        points: list[dict[str, Any]] = []
        total_events = 0
        total_alerts = 0

        # Build optional session filter
        session_clause = ""
        session_params: list[str] = []
        if session_id:
            session_clause = " AND session_id = ?"
            session_params = [session_id]

        # Endpoint filter — restrict to session_ids for that hostname
        endpoint_clause = ""
        endpoint_params: list[str] = []
        if endpoint and not session_id:
            ep_session_ids = self._get_session_ids_for_endpoint(endpoint)
            if not ep_session_ids:
                # Return empty timeline
                return {"points": [], "total_events": 0, "total_alerts": 0, "interval": interval}
            placeholders = ",".join("?" * len(ep_session_ids))
            endpoint_clause = f" AND session_id IN ({placeholders})"
            endpoint_params = ep_session_ids

        extra_params = session_params + endpoint_params

        # Get events grouped by time
        events_by_time: dict[str, int] = {}
        with self.transaction() as cursor:
            cursor.execute(
                f"""
                SELECT strftime('{time_format}', timestamp) as time_bucket,
                       COUNT(*) as count
                FROM events
                WHERE timestamp >= ? AND timestamp <= ?{session_clause}{endpoint_clause}
                GROUP BY time_bucket
                ORDER BY time_bucket
                """,
                [from_date.isoformat(), to_date.isoformat()] + extra_params,
            )
            for row in cursor.fetchall():
                events_by_time[row["time_bucket"]] = row["count"]
                total_events += row["count"]

        # Get alerts grouped by time
        alerts_by_time: dict[str, int] = {}
        with self.transaction() as cursor:
            cursor.execute(
                f"""
                SELECT strftime('{time_format}', created_at) as time_bucket,
                       COUNT(*) as count
                FROM alerts
                WHERE created_at >= ? AND created_at <= ?{session_clause}{endpoint_clause}
                GROUP BY time_bucket
                ORDER BY time_bucket
                """,
                [from_date.isoformat(), to_date.isoformat()] + extra_params,
            )
            for row in cursor.fetchall():
                alerts_by_time[row["time_bucket"]] = row["count"]
                total_alerts += row["count"]

        # Generate all time buckets in the range (fill gaps with zeros)
        if interval == "minute":
            delta = timedelta(minutes=1)
        elif interval == "day":
            delta = timedelta(days=1)
        else:  # hour
            delta = timedelta(hours=1)

        # Truncate from_date to the interval boundary
        current = from_date.replace(second=0, microsecond=0)
        if interval == "hour":
            current = current.replace(minute=0)
        elif interval == "day":
            current = current.replace(hour=0, minute=0)

        while current <= to_date:
            bucket_str = current.strftime(
                "%Y-%m-%d %H:%M:00" if interval == "minute"
                else "%Y-%m-%d %H:00:00" if interval == "hour"
                else "%Y-%m-%d 00:00:00"
            )
            points.append({
                "timestamp": current,
                "events": events_by_time.get(bucket_str, 0),
                "alerts": alerts_by_time.get(bucket_str, 0),
            })
            current += delta

            # Hard cap safety net
            if len(points) >= self.MAX_TIMELINE_BUCKETS:
                break

        return {
            "points": points,
            "total_events": total_events,
            "total_alerts": total_alerts,
            "interval": interval,
        }

    def _get_session_ids_for_endpoint(self, endpoint: str) -> list[str]:
        """Get all session_ids belonging to a given endpoint hostname."""
        with self.transaction() as cursor:
            cursor.execute(
                "SELECT session_id FROM sessions WHERE endpoint_hostname = ?",
                [endpoint],
            )
            return [row["session_id"] for row in cursor.fetchall()]

    def _get_session_ids_for_source(self, source: str) -> list[str]:
        """Get all session_ids belonging to a given session source."""
        with self.transaction() as cursor:
            cursor.execute(
                "SELECT session_id FROM sessions WHERE COALESCE(session_source, 'claude_code') = ?",
                [source],
            )
            return [row["session_id"] for row in cursor.fetchall()]

    def get_top_files(
        self,
        limit: int = 20,
        sort_by: str = "total_access",
        from_date: datetime | None = None,
        to_date: datetime | None = None,
        endpoint: str | None = None,
    ) -> list[dict[str, Any]]:
        """Get most accessed files by aggregating from events table."""
        date_clause = ""
        params: list[Any] = []
        if from_date:
            date_clause += " AND timestamp >= ?"
            params.append(from_date.isoformat())
        if to_date:
            date_clause += " AND timestamp <= ?"
            params.append(to_date.isoformat())

        endpoint_clause = ""
        if endpoint:
            ep_session_ids = self._get_session_ids_for_endpoint(endpoint)
            if not ep_session_ids:
                return []
            placeholders = ",".join("?" * len(ep_session_ids))
            endpoint_clause = f" AND session_id IN ({placeholders})"
            params.extend(ep_session_ids)

        with self.transaction() as cursor:
            cursor.execute(
                f"""
                SELECT file_paths, category, timestamp
                FROM events
                WHERE category IN ('file_read', 'file_write', 'file_delete')
                  AND file_paths IS NOT NULL AND file_paths != '[]'
                  {date_clause}{endpoint_clause}
                """,
                params,
            )
            file_stats: dict[str, dict[str, Any]] = {}
            for row in cursor.fetchall():
                try:
                    paths = json.loads(row["file_paths"])
                except (TypeError, json.JSONDecodeError):
                    continue
                cat = row["category"]
                ts = row["timestamp"]
                for fp in paths:
                    if not fp:
                        continue
                    if fp not in file_stats:
                        file_stats[fp] = {
                            "file_path": fp,
                            "read_count": 0,
                            "write_count": 0,
                            "delete_count": 0,
                            "last_accessed": ts,
                            "alert_count": 0,
                        }
                    entry = file_stats[fp]
                    if cat == "file_read":
                        entry["read_count"] += 1
                    elif cat == "file_write":
                        entry["write_count"] += 1
                    elif cat == "file_delete":
                        entry["delete_count"] += 1
                    if ts and (not entry["last_accessed"] or ts > entry["last_accessed"]):
                        entry["last_accessed"] = ts

            results = list(file_stats.values())
            for r in results:
                r["total_access"] = r["read_count"] + r["write_count"] + r["delete_count"]
                if r["last_accessed"]:
                    r["last_accessed"] = datetime.fromisoformat(r["last_accessed"])

            sort_key = {
                "total_access": "total_access",
                "read_count": "read_count",
                "write_count": "write_count",
                "alert_count": "alert_count",
            }.get(sort_by, "total_access")
            results.sort(key=lambda x: x[sort_key], reverse=True)
            return results[:limit]

    def get_top_commands(
        self,
        limit: int = 20,
        sort_by: str = "execution_count",
        from_date: datetime | None = None,
        to_date: datetime | None = None,
        endpoint: str | None = None,
    ) -> list[dict[str, Any]]:
        """Get most executed commands by aggregating from events table."""
        date_clause = ""
        params: list[Any] = []
        if from_date:
            date_clause += " AND timestamp >= ?"
            params.append(from_date.isoformat())
        if to_date:
            date_clause += " AND timestamp <= ?"
            params.append(to_date.isoformat())

        endpoint_clause = ""
        if endpoint:
            ep_session_ids = self._get_session_ids_for_endpoint(endpoint)
            if not ep_session_ids:
                return []
            placeholders = ",".join("?" * len(ep_session_ids))
            endpoint_clause = f" AND session_id IN ({placeholders})"
            params.extend(ep_session_ids)

        with self.transaction() as cursor:
            cursor.execute(
                f"""
                SELECT commands, timestamp
                FROM events
                WHERE category = 'command_exec'
                  AND commands IS NOT NULL AND commands != '[]'
                  {date_clause}{endpoint_clause}
                """,
                params,
            )
            cmd_stats: dict[str, dict[str, Any]] = {}
            for row in cursor.fetchall():
                try:
                    cmds = json.loads(row["commands"])
                except (TypeError, json.JSONDecodeError):
                    continue
                ts = row["timestamp"]
                for cmd in cmds:
                    if not cmd:
                        continue
                    # Use first token as the command key for grouping
                    short_cmd = cmd.split()[0] if cmd.split() else cmd
                    if short_cmd not in cmd_stats:
                        cmd_stats[short_cmd] = {
                            "command": short_cmd,
                            "execution_count": 0,
                            "last_executed": ts,
                            "alert_count": 0,
                        }
                    entry = cmd_stats[short_cmd]
                    entry["execution_count"] += 1
                    if ts and (not entry["last_executed"] or ts > entry["last_executed"]):
                        entry["last_executed"] = ts

            results = list(cmd_stats.values())
            for r in results:
                if r["last_executed"]:
                    r["last_executed"] = datetime.fromisoformat(r["last_executed"])

            sort_key = {
                "execution_count": "execution_count",
                "alert_count": "alert_count",
            }.get(sort_by, "execution_count")
            results.sort(key=lambda x: x[sort_key], reverse=True)
            return results[:limit]

    def get_top_domains(
        self,
        limit: int = 20,
        sort_by: str = "access_count",
        from_date: datetime | None = None,
        to_date: datetime | None = None,
        endpoint: str | None = None,
    ) -> list[dict[str, Any]]:
        """Get most accessed domains by aggregating from events table."""
        from urllib.parse import urlparse

        date_clause = ""
        params: list[Any] = []
        if from_date:
            date_clause += " AND timestamp >= ?"
            params.append(from_date.isoformat())
        if to_date:
            date_clause += " AND timestamp <= ?"
            params.append(to_date.isoformat())

        endpoint_clause = ""
        if endpoint:
            ep_session_ids = self._get_session_ids_for_endpoint(endpoint)
            if not ep_session_ids:
                return []
            placeholders = ",".join("?" * len(ep_session_ids))
            endpoint_clause = f" AND session_id IN ({placeholders})"
            params.extend(ep_session_ids)

        with self.transaction() as cursor:
            cursor.execute(
                f"""
                SELECT urls, timestamp
                FROM events
                WHERE category = 'network_access'
                  AND urls IS NOT NULL AND urls != '[]'
                  {date_clause}{endpoint_clause}
                """,
                params,
            )
            domain_stats: dict[str, dict[str, Any]] = {}
            for row in cursor.fetchall():
                try:
                    urls = json.loads(row["urls"])
                except (TypeError, json.JSONDecodeError):
                    continue
                ts = row["timestamp"]
                for url in urls:
                    if not url:
                        continue
                    try:
                        hostname = urlparse(url).hostname or url
                    except Exception:
                        hostname = url
                    if hostname not in domain_stats:
                        domain_stats[hostname] = {
                            "hostname": hostname,
                            "access_count": 0,
                            "last_accessed": ts,
                            "alert_count": 0,
                        }
                    entry = domain_stats[hostname]
                    entry["access_count"] += 1
                    if ts and (not entry["last_accessed"] or ts > entry["last_accessed"]):
                        entry["last_accessed"] = ts

            results = list(domain_stats.values())
            for r in results:
                if r["last_accessed"]:
                    r["last_accessed"] = datetime.fromisoformat(r["last_accessed"])

            sort_key = {
                "access_count": "access_count",
                "alert_count": "alert_count",
            }.get(sort_by, "access_count")
            results.sort(key=lambda x: x[sort_key], reverse=True)
            return results[:limit]

    def get_endpoint_stats(self) -> list[dict[str, Any]]:
        """Get aggregated statistics grouped by endpoint."""
        with self.transaction() as cursor:
            cursor.execute(
                """
                SELECT endpoint_hostname, endpoint_user,
                       COUNT(*) as session_count,
                       SUM(event_count) as total_events,
                       SUM(alert_count) as total_alerts,
                       session_source
                FROM sessions
                GROUP BY endpoint_hostname, endpoint_user, session_source
                """
            )
            results = []
            for row in cursor.fetchall():
                try:
                    source = row["session_source"]
                except (IndexError, KeyError):
                    source = None
                results.append({
                    "endpoint_hostname": row["endpoint_hostname"],
                    "endpoint_user": row["endpoint_user"],
                    "session_count": row["session_count"],
                    "total_events": row["total_events"] or 0,
                    "total_alerts": row["total_alerts"] or 0,
                    "session_source": source,
                })
            return results

    def get_unique_endpoint_count(self) -> int:
        """Get the number of unique endpoints (distinct hostname+user pairs)."""
        with self.transaction() as cursor:
            cursor.execute(
                """
                SELECT COUNT(*) FROM (
                    SELECT DISTINCT endpoint_hostname, endpoint_user
                    FROM sessions
                    WHERE endpoint_hostname IS NOT NULL
                )
                """
            )
            result = cursor.fetchone()
            return result[0] if result else 0


# Global database instance
_database: Database | None = None


def get_database() -> Database:
    """Get the global database instance."""
    global _database
    if _database is None:
        _database = Database()
    return _database


def set_database(database: Database) -> None:
    """Set the global database instance."""
    global _database
    _database = database
