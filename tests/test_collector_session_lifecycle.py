"""Regression tests for session lifecycle in the collector.

Guards the bug where ending a session left it counted as 'active': the
session-end handler called increment_session_event_count() (which re-activates
a session to un-stale it on activity) *after* end_session(), flipping the just
-closed session back to 'active'.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from agentsleak.collector.routes import collect_session_end
from agentsleak.models.events import HookPayload, Session
from agentsleak.store.database import Database


@pytest.fixture
def db(tmp_path: Path) -> Database:
    settings = MagicMock()
    settings.db_path = tmp_path / "test.db"
    return Database(settings=settings)


@pytest.mark.asyncio
async def test_session_end_marks_session_ended(db: Database) -> None:
    sid = "sess-1"
    db.save_session(Session(session_id=sid, cwd="/tmp"))
    assert db.get_session_by_id(sid).status == "active"

    payload = HookPayload(session_id=sid, hook_event_name="SessionEnd")
    engine = MagicMock()
    engine.enqueue = AsyncMock()

    await collect_session_end(payload, MagicMock(), db=db, engine=engine)

    session = db.get_session_by_id(sid)
    assert session.status == "ended"
    assert session.ended_at is not None


@pytest.mark.asyncio
async def test_session_end_removes_from_active_count(db: Database) -> None:
    db.save_session(Session(session_id="a", cwd="/tmp"))
    db.save_session(Session(session_id="b", cwd="/tmp"))

    def active_count() -> int:
        with db.transaction() as cur:
            cur.execute("SELECT COUNT(*) FROM sessions WHERE status = 'active'")
            return cur.fetchone()[0]

    assert active_count() == 2

    engine = MagicMock()
    engine.enqueue = AsyncMock()
    await collect_session_end(
        HookPayload(session_id="a", hook_event_name="SessionEnd"),
        MagicMock(),
        db=db,
        engine=engine,
    )

    # Closing one session must drop the active count, never raise it.
    assert active_count() == 1


@pytest.mark.asyncio
async def test_session_end_still_counts_the_end_event(db: Database) -> None:
    sid = "sess-count"
    db.save_session(Session(session_id=sid, cwd="/tmp"))
    before = db.get_session_by_id(sid).event_count

    engine = MagicMock()
    engine.enqueue = AsyncMock()
    await collect_session_end(
        HookPayload(session_id=sid, hook_event_name="SessionEnd"),
        MagicMock(),
        db=db,
        engine=engine,
    )

    # The SessionEnd event is still recorded in the session's event count.
    assert db.get_session_by_id(sid).event_count == before + 1
