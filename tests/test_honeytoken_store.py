"""Tests for the editable honeytoken store (DB CRUD + seeding)."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import pytest

from agentsleak.engine.honeytokens import DEFAULT_HONEYTOKENS
from agentsleak.store.database import Database


@pytest.fixture
def db(tmp_path: Path) -> Database:
    settings = MagicMock()
    settings.db_path = tmp_path / "test.db"
    return Database(settings=settings)


def test_seeds_defaults_on_first_init(db: Database) -> None:
    rows = db.get_honeytoken_rows()
    assert len(rows) == len(DEFAULT_HONEYTOKENS)
    assert all(r["builtin"] for r in rows)
    assert all(r["enabled"] for r in rows)


def test_get_honeytokens_returns_honeytoken_objects(db: Database) -> None:
    tokens = db.get_honeytokens(enabled_only=True)
    assert {t.id for t in tokens} == {t.id for t in DEFAULT_HONEYTOKENS}


def test_add_user_honeytoken(db: Database) -> None:
    row = db.add_honeytoken("value", "sk_live_DECOY", "Decoy Stripe")
    assert row["builtin"] is False
    assert row["enabled"] is True
    assert row["id"].startswith("ht-user-")
    ids = {r["id"] for r in db.get_honeytoken_rows()}
    assert row["id"] in ids


def test_disable_excludes_from_active_set(db: Database) -> None:
    assert db.set_honeytoken_enabled("ht-env-decoy", False) is True
    active_ids = {t.id for t in db.get_honeytokens(enabled_only=True)}
    assert "ht-env-decoy" not in active_ids
    # still present in the full listing, just disabled
    all_rows = {r["id"]: r for r in db.get_honeytoken_rows()}
    assert all_rows["ht-env-decoy"]["enabled"] is False


def test_delete_user_token(db: Database) -> None:
    row = db.add_honeytoken("value", "abc", "x")
    assert db.delete_honeytoken(row["id"]) == "deleted"
    assert row["id"] not in {r["id"] for r in db.get_honeytoken_rows()}


def test_delete_builtin_refused(db: Database) -> None:
    assert db.delete_honeytoken("ht-env-decoy") == "builtin"
    assert "ht-env-decoy" in {r["id"] for r in db.get_honeytoken_rows()}


def test_delete_missing_returns_none(db: Database) -> None:
    assert db.delete_honeytoken("ht-does-not-exist") is None


def test_seeding_is_idempotent(db: Database) -> None:
    """Re-running init must not duplicate or resurrect deleted decoys."""
    row = db.add_honeytoken("value", "keep-me", "x")
    db.set_honeytoken_enabled("ht-env-decoy", False)
    db._seed_default_honeytokens()  # simulate a second startup
    rows = {r["id"]: r for r in db.get_honeytoken_rows()}
    # user token survives, disabled builtin stays disabled, no duplicates
    assert row["id"] in rows
    assert rows["ht-env-decoy"]["enabled"] is False
    assert len(rows) == len(DEFAULT_HONEYTOKENS) + 1
