"""Seed default detection policies into the database."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import TYPE_CHECKING

from agentsleak.models.alerts import ConditionOperator, Policy, PolicyAction, RuleCondition
from agentsleak.models.events import EventCategory, Severity

if TYPE_CHECKING:
    from agentsleak.store.database import Database

logger = logging.getLogger(__name__)

# Map JSON rule categories to EventCategory enum values
CATEGORY_MAP: dict[str, EventCategory] = {
    "bash_command": EventCategory.COMMAND_EXEC,
    "web_fetch": EventCategory.NETWORK_ACCESS,
    "grep_search": EventCategory.FILE_READ,
    "glob_search": EventCategory.FILE_READ,
    "file_read": EventCategory.FILE_READ,
    "file_write": EventCategory.FILE_WRITE,
    "file_delete": EventCategory.FILE_DELETE,
    "network_access": EventCategory.NETWORK_ACCESS,
    "command_exec": EventCategory.COMMAND_EXEC,
}

SEVERITY_MAP: dict[str, Severity] = {
    "critical": Severity.CRITICAL,
    "high": Severity.HIGH,
    "medium": Severity.MEDIUM,
    "low": Severity.LOW,
    "info": Severity.INFO,
}

ACTION_MAP: dict[str, PolicyAction] = {
    "block": PolicyAction.BLOCK,
    "alert": PolicyAction.ALERT,
    "log": PolicyAction.LOG,
}

# Rules to skip — they require runtime context or threshold logic not supported by simple policies
SKIP_RULES = {"SCOPE-001", "ENUM-001"}


def _resolve_categories(category_spec: str | dict) -> list[EventCategory]:
    """Resolve a category specification from JSON to EventCategory list."""
    if isinstance(category_spec, dict) and "any_of" in category_spec:
        cats = []
        for c in category_spec["any_of"]:
            mapped = CATEGORY_MAP.get(c)
            if mapped and mapped not in cats:
                cats.append(mapped)
        return cats
    if isinstance(category_spec, str):
        mapped = CATEGORY_MAP.get(category_spec)
        return [mapped] if mapped else []
    return []


def _translate_pattern_rule(rule: dict) -> Policy | None:
    """Translate a pattern-type JSON rule into a Policy object."""
    rule_id = rule["id"]
    conditions_spec = rule["conditions"]
    event_spec = conditions_spec.get("event", {})

    # Resolve categories
    category_spec = event_spec.get("category")
    categories = _resolve_categories(category_spec) if category_spec else []

    # Build RuleConditions from pattern fields
    conditions: list[RuleCondition] = []

    # Handle metadata.file_path.regex
    file_path_spec = event_spec.get("metadata.file_path", {})
    if isinstance(file_path_spec, dict) and "regex" in file_path_spec:
        conditions.append(RuleCondition(
            field="tool_input.file_path",
            operator=ConditionOperator.MATCHES,
            value=file_path_spec["regex"],
            case_sensitive=True,
        ))

    # Handle metadata.command.regex
    command_spec = event_spec.get("metadata.command", {})
    if isinstance(command_spec, dict) and "regex" in command_spec:
        conditions.append(RuleCondition(
            field="tool_input.command",
            operator=ConditionOperator.MATCHES,
            value=command_spec["regex"],
            case_sensitive=True,
        ))

    # Handle metadata.any_match (EXEC-002, ENUM-002)
    metadata_spec = event_spec.get("metadata", {})
    if isinstance(metadata_spec, dict) and "any_match" in metadata_spec:
        for match_item in metadata_spec["any_match"]:
            for field_name, field_spec in match_item.items():
                if isinstance(field_spec, dict) and "regex" in field_spec:
                    # Map JSON field names to tool_input fields
                    tool_field = f"tool_input.{field_name}"
                    conditions.append(RuleCondition(
                        field=tool_field,
                        operator=ConditionOperator.MATCHES,
                        value=field_spec["regex"],
                        case_sensitive=True,
                    ))

    if not conditions and not categories:
        logger.warning(f"Rule {rule_id}: no conditions or categories extracted, skipping")
        return None

    return Policy(
        name=f"[{rule_id}] {rule['name']}",
        description=rule.get("description", ""),
        enabled=rule.get("enabled", True),
        categories=categories,
        conditions=conditions,
        condition_logic="any" if len(conditions) > 1 else "all",
        action=ACTION_MAP.get(rule.get("action", "alert"), PolicyAction.ALERT),
        severity=SEVERITY_MAP.get(rule.get("severity", "medium"), Severity.MEDIUM),
        alert_title=rule.get("name", "Policy Violation"),
        alert_description=rule.get("block_message", rule.get("description", "")),
        tags=rule.get("tags", []),
    )


def _translate_sequence_rule(rule: dict) -> Policy | None:
    """Translate a sequence-type JSON rule into a simplified single-step Policy.

    Sequence rules are reduced to a single pattern that catches the most
    dangerous step in the sequence.
    """
    rule_id = rule["id"]

    if rule_id == "EXFIL-001":
        # Data exfiltration: sensitive file read + network access
        # Simplify to: curl/wget POST with sensitive file references
        return Policy(
            name=f"[{rule_id}] {rule['name']}",
            description=rule.get("description", ""),
            enabled=rule.get("enabled", True),
            categories=[EventCategory.COMMAND_EXEC],
            conditions=[RuleCondition(
                field="tool_input.command",
                operator=ConditionOperator.MATCHES,
                value=r"(curl|wget|fetch)\s+.*(\.(env|pem|key)|credentials|secrets|password|api_key|\.ssh/id_)",
                case_sensitive=True,
            )],
            condition_logic="all",
            action=PolicyAction.BLOCK,
            severity=Severity.CRITICAL,
            alert_title=rule.get("name", "Data exfiltration pattern"),
            alert_description=rule.get("block_message", rule.get("description", "")),
            tags=rule.get("tags", []),
        )

    if rule_id == "EXEC-001":
        # Download and execute: simplify to pipe-to-shell pattern
        return Policy(
            name=f"[{rule_id}] {rule['name']}",
            description=rule.get("description", ""),
            enabled=rule.get("enabled", True),
            categories=[EventCategory.COMMAND_EXEC],
            conditions=[RuleCondition(
                field="tool_input.command",
                operator=ConditionOperator.MATCHES,
                value=r"(curl|wget)\s+.*\|\s*(bash|sh|python|perl|ruby)",
                case_sensitive=True,
            )],
            condition_logic="all",
            action=PolicyAction.BLOCK,
            severity=Severity.CRITICAL,
            alert_title=rule.get("name", "Download and execute"),
            alert_description=rule.get("block_message", rule.get("description", "")),
            tags=rule.get("tags", []),
        )

    logger.warning(f"Rule {rule_id}: unhandled sequence rule, skipping")
    return None


def seed_default_policies(db: Database) -> int:
    """Seed default detection policies from default_rules.json.

    Idempotent: uses ON CONFLICT(name) DO UPDATE via db.save_policy().

    Returns:
        Number of policies seeded (0 if all already existed unchanged).
    """
    rules_path = Path(__file__).parent / "default_rules.json"
    if not rules_path.exists():
        logger.error(f"Default rules file not found: {rules_path}")
        return 0

    with open(rules_path) as f:
        rules_data = json.load(f)

    rules = rules_data.get("rules", [])
    count = 0

    for rule in rules:
        rule_id = rule.get("id", "")

        if rule_id in SKIP_RULES:
            logger.debug(f"Skipping rule {rule_id} (not supported as simple policy)")
            continue

        condition_type = rule.get("conditions", {}).get("type")

        policy: Policy | None = None
        if condition_type == "pattern":
            policy = _translate_pattern_rule(rule)
        elif condition_type == "sequence":
            policy = _translate_sequence_rule(rule)
        else:
            logger.debug(f"Skipping rule {rule_id}: unsupported condition type '{condition_type}'")
            continue

        if policy is None:
            continue

        try:
            db.save_policy(policy)
            count += 1
            logger.debug(f"Seeded policy: {policy.name}")
        except Exception as e:
            logger.error(f"Failed to seed policy for rule {rule_id}: {e}")

    # ── Built-in policies that use raw_payload fields ──────────────────────
    builtin_policies = [
        Policy(
            name="[SESSION-001] Dangerous skip permissions mode",
            description=(
                "Alerts when a Claude Code session starts with permissions bypassed "
                "(--dangerously-skip-permissions). Sessions running without permission "
                "checks can execute any tool without user approval, making them high-risk "
                "for uncontrolled file writes, command execution, and network access."
            ),
            enabled=True,
            categories=[],
            conditions=[
                RuleCondition(
                    field="hook_type",
                    operator=ConditionOperator.EQUALS,
                    value="SessionStart",
                    case_sensitive=True,
                ),
                RuleCondition(
                    field="permission_mode",
                    operator=ConditionOperator.MATCHES,
                    value="(?i)(dangerously.*skip|bypass|none|disabled)",
                    case_sensitive=False,
                ),
            ],
            condition_logic="all",
            action=PolicyAction.ALERT,
            severity=Severity.CRITICAL,
            alert_title="Session started with permissions bypassed",
            alert_description=(
                "A Claude Code session was started with --dangerously-skip-permissions. "
                "All tool executions in this session will proceed without user approval. "
                "Monitor this session closely for unauthorized actions."
            ),
            tags=["permissions", "session-security", "skip-permissions", "high-risk"],
        ),
    ]

    for bp in builtin_policies:
        try:
            db.save_policy(bp)
            count += 1
            logger.debug(f"Seeded built-in policy: {bp.name}")
        except Exception as e:
            logger.error(f"Failed to seed built-in policy {bp.name}: {e}")

    return count
