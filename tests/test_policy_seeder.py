"""Default policies: all enabled, all alert-only (nothing blocks out of the box)."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

from agentsleak.config.policy_seeder import seed_default_policies
from agentsleak.models.alerts import Policy, PolicyAction
from agentsleak.store.database import Database


def test_default_policies_are_enabled_and_alert_only(tmp_path: Path) -> None:
    settings = MagicMock()
    settings.db_path = tmp_path / "test.db"
    db = Database(settings=settings)

    assert seed_default_policies(db) > 0
    policies = db.get_policies(enabled_only=False)

    assert policies and all(p.enabled for p in policies)
    assert [p.name for p in policies if p.action == PolicyAction.BLOCK] == []
    # Alert text never claims the action was blocked.
    assert [p.name for p in policies if (p.alert_description or "").startswith("Blocked")] == []


def test_retired_default_policies_are_removed(tmp_path: Path) -> None:
    settings = MagicMock()
    settings.db_path = tmp_path / "test.db"
    db = Database(settings=settings)
    # As seeded by an older version, next to a user's own policy.
    db.save_policy(Policy(name="[EXEC-001] Download and execute", action=PolicyAction.BLOCK))
    db.save_policy(Policy(name="My EXEC-001 notes", action=PolicyAction.ALERT))

    seed_default_policies(db)

    names = {p.name for p in db.get_policies(enabled_only=False)}
    assert "[EXEC-001] Download and execute" not in names
    assert "My EXEC-001 notes" in names


def test_renamed_default_policy_leaves_no_old_copy(tmp_path: Path) -> None:
    settings = MagicMock()
    settings.db_path = tmp_path / "test.db"
    db = Database(settings=settings)
    # EVASION-003 under its previous name, as an older version seeded it.
    db.save_policy(Policy(name="[EVASION-003] Eval or command substitution evasion"))

    seed_default_policies(db)

    evasion_003 = [p.name for p in db.get_policies(enabled_only=False) if p.name.startswith("[EVASION-003] ")]
    assert evasion_003 == ["[EVASION-003] Eval of generated or encoded code"]
