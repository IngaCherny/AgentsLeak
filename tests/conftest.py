"""Shared test fixtures for AgentsLeak."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from agentsleak.engine.processor import Engine
from agentsleak.engine.sequence import SequenceRule, SequenceStep, SequenceTracker
from agentsleak.models.alerts import (
    ConditionOperator,
    Policy,
    PolicyAction,
    RuleCondition,
)
from agentsleak.models.events import Event, EventCategory, HookPayload, Severity


# ---------------------------------------------------------------------------
# Event / Payload factories
# ---------------------------------------------------------------------------


def make_event(
    tool_name: str = "Bash",
    tool_input: dict[str, Any] | None = None,
    hook_type: str = "PreToolUse",
    session_id: str = "test-session-001",
    category: EventCategory = EventCategory.UNKNOWN,
    severity: Severity = Severity.INFO,
    file_paths: list[str] | None = None,
    commands: list[str] | None = None,
    urls: list[str] | None = None,
    ip_addresses: list[str] | None = None,
    timestamp: datetime | None = None,
    raw_payload: dict[str, Any] | None = None,
) -> Event:
    """Build an Event with sensible defaults."""
    return Event(
        session_id=session_id,
        hook_type=hook_type,
        tool_name=tool_name,
        tool_input=tool_input or {},
        category=category,
        severity=severity,
        file_paths=file_paths or [],
        commands=commands or [],
        urls=urls or [],
        ip_addresses=ip_addresses or [],
        timestamp=timestamp or datetime.utcnow(),
        raw_payload=raw_payload,
    )


def make_hook_payload(
    session_id: str = "test-session-001",
    tool_name: str = "Bash",
    tool_input: dict[str, Any] | None = None,
    hook_type: str = "PreToolUse",
    session_cwd: str | None = "/home/user/project",
    **kwargs: Any,
) -> HookPayload:
    """Build a HookPayload with sensible defaults."""
    return HookPayload(
        session_id=session_id,
        hook_type=hook_type,
        tool_name=tool_name,
        tool_input=tool_input or {},
        session_cwd=session_cwd,
        **kwargs,
    )


# ---------------------------------------------------------------------------
# Mock database
# ---------------------------------------------------------------------------


def make_mock_database() -> MagicMock:
    """Create a MagicMock mimicking the Database interface."""
    db = MagicMock()
    db.get_session_by_id = MagicMock(return_value=None)
    db.save_event = MagicMock()
    db.save_alert = MagicMock()
    db.save_session = MagicMock()
    db.increment_session_alert_count = MagicMock()
    db.increment_session_risk_score = MagicMock()
    db.save_graph_node = MagicMock(return_value=str(uuid4()))
    db.save_graph_edge = MagicMock()
    db.get_policies = MagicMock(return_value=[])
    return db


# ---------------------------------------------------------------------------
# Engine with injected policies
# ---------------------------------------------------------------------------


def make_engine(
    policies: list[Policy] | None = None,
    database: MagicMock | None = None,
) -> Engine:
    """Create an Engine with a mock database and injected policies."""
    db = database or make_mock_database()
    settings = MagicMock()
    settings.process_interval = 0.1
    settings.db_path = "/tmp/test.db"

    engine = Engine.__new__(Engine)
    engine.settings = settings
    engine._database = db
    engine._policies = policies or []
    engine._sequence_tracker = SequenceTracker()
    engine._event_queue = MagicMock()
    engine._processing_task = None

    return engine


# ---------------------------------------------------------------------------
# Policy factories
# ---------------------------------------------------------------------------


def make_block_policy(
    name: str = "Test Block Policy",
    categories: list[EventCategory] | None = None,
    tools: list[str] | None = None,
    conditions: list[RuleCondition] | None = None,
    condition_logic: str = "all",
    severity: Severity = Severity.HIGH,
) -> Policy:
    """Create a BLOCK policy."""
    return Policy(
        name=name,
        description=f"Test block policy: {name}",
        enabled=True,
        categories=categories or [],
        tools=tools or [],
        conditions=conditions or [],
        condition_logic=condition_logic,
        action=PolicyAction.BLOCK,
        severity=severity,
    )


def make_alert_policy(
    name: str = "Test Alert Policy",
    categories: list[EventCategory] | None = None,
    tools: list[str] | None = None,
    conditions: list[RuleCondition] | None = None,
    condition_logic: str = "all",
    severity: Severity = Severity.MEDIUM,
) -> Policy:
    """Create an ALERT policy."""
    return Policy(
        name=name,
        description=f"Test alert policy: {name}",
        enabled=True,
        categories=categories or [],
        tools=tools or [],
        conditions=conditions or [],
        condition_logic=condition_logic,
        action=PolicyAction.ALERT,
        severity=severity,
    )


# ---------------------------------------------------------------------------
# Condition factory
# ---------------------------------------------------------------------------


def make_condition(
    field: str,
    operator: ConditionOperator,
    value: Any,
    case_sensitive: bool = False,
) -> RuleCondition:
    """Create a RuleCondition."""
    return RuleCondition(
        field=field,
        operator=operator,
        value=value,
        case_sensitive=case_sensitive,
    )
