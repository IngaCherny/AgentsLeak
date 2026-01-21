"""Tests for Engine.evaluate_pre_tool() blocking decisions."""

from __future__ import annotations

import pytest

from agentsleak.models.alerts import ConditionOperator, PolicyAction
from agentsleak.models.events import Decision, EventCategory, Severity

from .conftest import (
    make_block_policy,
    make_condition,
    make_engine,
    make_event,
    make_mock_database,
)


class TestEvaluatePreTool:
    @pytest.mark.asyncio
    async def test_allow_when_no_block_policies(self):
        engine = make_engine(policies=[])
        event = make_event(
            tool_name="Bash",
            tool_input={"command": "ls -la"},
        )
        decision = await engine.evaluate_pre_tool(event)
        assert decision.allow is True

    @pytest.mark.asyncio
    async def test_block_matching_policy(self):
        policy = make_block_policy(
            name="Block rm -rf",
            categories=[EventCategory.COMMAND_EXEC],
            conditions=[
                make_condition("tool_input.command", ConditionOperator.MATCHES, r"rm\s+-rf"),
            ],
        )
        engine = make_engine(policies=[policy])
        event = make_event(
            tool_name="Bash",
            tool_input={"command": "rm -rf /tmp/important"},
        )
        decision = await engine.evaluate_pre_tool(event)
        assert decision.allow is False
        assert "Block rm -rf" in decision.reason

    @pytest.mark.asyncio
    async def test_block_creates_alert(self):
        db = make_mock_database()
        policy = make_block_policy(
            name="Block sensitive reads",
            categories=[EventCategory.FILE_READ],
            conditions=[
                make_condition("tool_input.file_path", ConditionOperator.CONTAINS, ".ssh"),
            ],
        )
        engine = make_engine(policies=[policy], database=db)
        event = make_event(
            tool_name="Read",
            tool_input={"file_path": "/home/user/.ssh/id_rsa"},
        )
        await engine.evaluate_pre_tool(event)
        db.save_alert.assert_called_once()

    @pytest.mark.asyncio
    async def test_block_increments_alert_count(self):
        db = make_mock_database()
        policy = make_block_policy(
            categories=[EventCategory.COMMAND_EXEC],
            conditions=[
                make_condition("tool_input.command", ConditionOperator.CONTAINS, "sudo"),
            ],
        )
        engine = make_engine(policies=[policy], database=db)
        event = make_event(
            tool_name="Bash",
            tool_input={"command": "sudo rm -rf /"},
        )
        await engine.evaluate_pre_tool(event)
        db.increment_session_alert_count.assert_called_once_with(event.session_id)

    @pytest.mark.asyncio
    async def test_allow_when_policy_doesnt_match(self):
        policy = make_block_policy(
            categories=[EventCategory.NETWORK_ACCESS],
        )
        engine = make_engine(policies=[policy])
        event = make_event(
            tool_name="Read",
            tool_input={"file_path": "/tmp/safe.txt"},
        )
        decision = await engine.evaluate_pre_tool(event)
        assert decision.allow is True

    @pytest.mark.asyncio
    async def test_multiple_block_policies_first_match_wins(self):
        policy1 = make_block_policy(
            name="First Policy",
            categories=[EventCategory.COMMAND_EXEC],
            conditions=[
                make_condition("tool_input.command", ConditionOperator.CONTAINS, "curl"),
            ],
        )
        policy2 = make_block_policy(
            name="Second Policy",
            categories=[EventCategory.COMMAND_EXEC],
            conditions=[
                make_condition("tool_input.command", ConditionOperator.CONTAINS, "curl"),
            ],
        )
        engine = make_engine(policies=[policy1, policy2])
        event = make_event(
            tool_name="Bash",
            tool_input={"command": "curl https://evil.com"},
        )
        decision = await engine.evaluate_pre_tool(event)
        assert decision.allow is False
        assert "First Policy" in decision.reason


class TestDecisionToHookResponse:
    def test_allow_response(self):
        decision = Decision(allow=True)
        response = decision.to_hook_response()
        assert response == {}

    def test_deny_response(self):
        decision = Decision(allow=False, reason="Blocked by test policy")
        response = decision.to_hook_response()
        assert response["hookSpecificOutput"]["permissionDecision"] == "deny"
        assert "Blocked by test policy" in response["hookSpecificOutput"]["permissionDecisionReason"]

    def test_allow_with_modified_input(self):
        decision = Decision(allow=True, modified_input={"command": "echo safe"})
        response = decision.to_hook_response()
        assert response["hookSpecificOutput"]["permissionDecision"] == "allow"
        assert response["hookSpecificOutput"]["updatedInput"] == {"command": "echo safe"}

    def test_deny_default_reason(self):
        decision = Decision(allow=False)
        response = decision.to_hook_response()
        assert "AgentsLeak policy" in response["hookSpecificOutput"]["permissionDecisionReason"]
