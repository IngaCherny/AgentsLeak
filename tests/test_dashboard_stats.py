"""Tests for dashboard stat counts — closing an alert must drop it from triage."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import pytest

from agentsleak.models.alerts import Alert, AlertStatus
from agentsleak.models.events import Session, Severity
from agentsleak.store.database import Database


@pytest.fixture
def db(tmp_path: Path) -> Database:
    settings = MagicMock()
    settings.db_path = tmp_path / "test.db"
    d = Database(settings=settings)
    d.save_session(Session(session_id="s1", cwd="/tmp"))
    return d


def _alert(status: AlertStatus, severity: Severity = Severity.CRITICAL) -> Alert:
    return Alert(
        session_id="s1",
        title="Test alert",
        description="x",
        severity=severity,
        status=status,
    )


def test_open_criticals_counted(db: Database) -> None:
    db.save_alert(_alert(AlertStatus.NEW))
    db.save_alert(_alert(AlertStatus.INVESTIGATING))
    stats = db.get_dashboard_stats()
    assert stats["alerts_by_severity"]["critical"] == 2


def test_resolved_and_false_positive_excluded(db: Database) -> None:
    db.save_alert(_alert(AlertStatus.NEW))            # open
    db.save_alert(_alert(AlertStatus.RESOLVED))       # closed
    db.save_alert(_alert(AlertStatus.FALSE_POSITIVE)) # closed
    stats = db.get_dashboard_stats()
    # Only the open one counts toward triage.
    assert stats["alerts_by_severity"]["critical"] == 1


def test_closing_all_zeroes_the_count(db: Database) -> None:
    db.save_alert(_alert(AlertStatus.RESOLVED))
    db.save_alert(_alert(AlertStatus.FALSE_POSITIVE))
    stats = db.get_dashboard_stats()
    assert stats["alerts_by_severity"]["critical"] == 0
    # total_alerts still reflects everything ever raised.
    assert stats["total_alerts"] == 2
