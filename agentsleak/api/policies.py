"""Policy API routes for AgentsLeak."""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from agentsleak.config.settings import get_settings
from agentsleak.engine.processor import get_engine
from agentsleak.models.alerts import (
    ConditionOperator,
    Policy,
    PolicyAction,
    RuleCondition,
)
from agentsleak.models.events import EventCategory, Severity
from agentsleak.store.database import Database, get_database

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/policies", tags=["policies"])


# =============================================================================
# Request/Response Models
# =============================================================================


class RuleConditionCreate(BaseModel):
    """Condition for policy rule creation."""

    field: str = Field(..., description="Field to evaluate")
    operator: ConditionOperator = Field(..., description="Comparison operator")
    value: Any = Field(..., description="Value to compare against")
    case_sensitive: bool = Field(default=False)


class PolicySummary(BaseModel):
    """Summary of a policy for list view."""

    id: UUID
    name: str
    description: str
    enabled: bool
    action: str
    severity: str
    created_at: datetime
    updated_at: datetime


class PolicyDetail(BaseModel):
    """Detailed policy information."""

    id: UUID
    name: str
    description: str
    enabled: bool
    categories: list[str]
    tools: list[str]
    conditions: list[RuleConditionCreate]
    condition_logic: str
    action: str
    severity: str
    alert_title: str
    alert_description: str
    tags: list[str]
    created_at: datetime
    updated_at: datetime
    hit_count: int = 0


class PolicyListResponse(BaseModel):
    """Response for policy list endpoint."""

    items: list[PolicySummary]
    total: int


class PolicyCreateRequest(BaseModel):
    """Request to create a new policy."""

    name: str = Field(..., description="Policy name")
    description: str = Field(default="", description="Policy description")
    enabled: bool = Field(default=True)
    categories: list[str] = Field(default_factory=list)
    tools: list[str] = Field(default_factory=list)
    conditions: list[RuleConditionCreate] = Field(default_factory=list)
    condition_logic: str = Field(default="all", pattern="^(all|any)$")
    action: PolicyAction = Field(default=PolicyAction.ALERT)
    severity: Severity = Field(default=Severity.MEDIUM)
    alert_title: str = Field(default="Policy Violation Detected")
    alert_description: str = Field(default="")
    tags: list[str] = Field(default_factory=list)


class PolicyUpdateRequest(BaseModel):
    """Request to update a policy."""

    name: str | None = None
    description: str | None = None
    enabled: bool | None = None
    categories: list[str] | None = None
    tools: list[str] | None = None
    conditions: list[RuleConditionCreate] | None = None
    condition_logic: str | None = None
    action: PolicyAction | None = None
    severity: Severity | None = None
    alert_title: str | None = None
    alert_description: str | None = None
    tags: list[str] | None = None


class PolicyResponse(BaseModel):
    """Response after policy operation."""

    id: UUID
    name: str
    enabled: bool
    message: str


class GeneratePolicyRequest(BaseModel):
    """Request body for policy generation."""

    prompt: str = Field(..., description="Plain-English description of the desired policy")


class GeneratePolicyResponse(BaseModel):
    """Response from policy generation."""

    policy: PolicyCreateRequest
    explanation: str


# =============================================================================
# Constants
# =============================================================================

POLICY_ASSISTANT_SYSTEM_PROMPT = """\
You are a policy generator for AgentsLeak, an AI agent security monitoring tool.
Given a user's plain-English description, generate a structured policy JSON object.

You MUST respond with ONLY a JSON object containing exactly two keys:
- "policy": the policy object matching the schema below
- "explanation": a short (1-2 sentence) explanation of what the policy does

Policy schema:
{
  "name": string (short descriptive name),
  "description": string (what the policy detects),
  "enabled": true,
  "categories": array of strings from: ["file_read", "file_write", "file_delete", "command_exec", "network_access", "code_execution", "subagent_spawn", "mcp_tool_use", "session_lifecycle"],
  "tools": array of strings (tool names to match, empty = all tools),
  "conditions": array of {
    "field": string (dot-notation path, e.g. "tool_input.command", "tool_input.file_path", "tool_input.url", "tool_name"),
    "operator": string from: ["equals", "not_equals", "contains", "not_contains", "starts_with", "ends_with", "matches", "not_matches", "greater_than", "less_than", "in", "not_in"],
    "value": string or array,
    "case_sensitive": boolean (default false)
  },
  "condition_logic": "all" or "any",
  "action": string from: ["alert", "block", "log"],
  "severity": string from: ["critical", "high", "medium", "low", "info"],
  "alert_title": string (short alert title),
  "alert_description": string (detail shown in alert),
  "tags": array of strings (for organization)
}

Common fields for conditions:
- tool_input.command — the shell command being executed
- tool_input.file_path — file being read/written/deleted
- tool_input.url — URL being accessed
- tool_input.content — content being written
- tool_name — name of the tool (e.g. "Bash", "Write", "Read", "WebFetch")

Example 1 — Block curl-to-bash piping:
User: "Block any command that downloads and pipes to bash"
{
  "policy": {
    "name": "Block curl pipe to shell",
    "description": "Prevents downloading scripts and piping directly to a shell interpreter",
    "enabled": true,
    "categories": ["command_exec"],
    "tools": [],
    "conditions": [
      {"field": "tool_input.command", "operator": "matches", "value": "(curl|wget).*\\\\|.*(bash|sh|zsh)", "case_sensitive": false}
    ],
    "condition_logic": "all",
    "action": "block",
    "severity": "critical",
    "alert_title": "Remote script execution blocked",
    "alert_description": "A command attempted to download and pipe a script to a shell",
    "tags": ["exfiltration", "remote-code"]
  },
  "explanation": "This blocks commands that use curl or wget to download content and pipe it to bash/sh/zsh, a common attack pattern for remote code execution."
}

Example 2 — Alert on .env file access:
User: "Alert when any .env file is read"
{
  "policy": {
    "name": "Alert on .env file access",
    "description": "Detects when environment files containing secrets are read",
    "enabled": true,
    "categories": ["file_read"],
    "tools": [],
    "conditions": [
      {"field": "tool_input.file_path", "operator": "matches", "value": ".*\\\\.env($|\\\\..*)", "case_sensitive": false}
    ],
    "condition_logic": "all",
    "action": "alert",
    "severity": "high",
    "alert_title": "Environment file accessed",
    "alert_description": "An agent read an .env file which may contain secrets",
    "tags": ["credentials", "secrets"]
  },
  "explanation": "This alerts whenever an agent reads any .env file, which typically contains sensitive credentials and API keys."
}

Example 3 — Block writes to /etc:
User: "Block any file writes to system directories"
{
  "policy": {
    "name": "Block system directory writes",
    "description": "Prevents writing files to critical system directories",
    "enabled": true,
    "categories": ["file_write"],
    "tools": [],
    "conditions": [
      {"field": "tool_input.file_path", "operator": "matches", "value": "^/(etc|usr|sys|boot|var/lib)/", "case_sensitive": true}
    ],
    "condition_logic": "all",
    "action": "block",
    "severity": "critical",
    "alert_title": "System directory write blocked",
    "alert_description": "An agent attempted to write to a protected system directory",
    "tags": ["system-integrity", "filesystem"]
  },
  "explanation": "This blocks any file write operations targeting critical system directories like /etc, /usr, /sys, and /boot."
}

IMPORTANT: Output ONLY valid JSON. No markdown, no code fences, no extra text.\
"""


# =============================================================================
# Endpoints
# =============================================================================


@router.get("")
async def list_policies(
    enabled_only: bool = Query(False, description="Only return enabled policies"),
    db: Database = Depends(get_database),
) -> dict:
    """List all policies."""
    policies = db.get_all_policies(enabled_only=enabled_only)
    hit_counts = db.get_alert_counts_by_policy()

    items = [
        PolicyDetail(
            id=p.id,
            name=p.name,
            description=p.description,
            enabled=p.enabled,
            categories=[c.value for c in p.categories],
            tools=p.tools,
            conditions=[
                RuleConditionCreate(
                    field=c.field,
                    operator=c.operator,
                    value=c.value,
                    case_sensitive=c.case_sensitive,
                )
                for c in p.conditions
            ],
            condition_logic=p.condition_logic,
            action=p.action.value,
            severity=p.severity.value,
            alert_title=p.alert_title,
            alert_description=p.alert_description,
            tags=p.tags,
            created_at=p.created_at,
            updated_at=p.updated_at,
            hit_count=hit_counts.get(str(p.id), 0),
        )
        for p in policies
    ]

    return {"items": items, "total": len(items)}


# --- Policy Assistant (must be registered before /{policy_id}) ---


@router.get("/assistant-status")
async def get_assistant_status() -> dict:
    """Check if the Policy Assistant feature is available."""
    settings = get_settings()
    return {"available": settings.anthropic_api_key is not None}


@router.post("/generate", response_model=GeneratePolicyResponse)
async def generate_policy(request: GeneratePolicyRequest) -> GeneratePolicyResponse:
    """Generate a policy from a plain-English description using Claude."""
    settings = get_settings()

    if not settings.anthropic_api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Policy Assistant is not available. Set ANTHROPIC_API_KEY to enable it.",
        )

    try:
        import anthropic
    except ImportError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="anthropic package is not installed. Run: pip install anthropic",
        )

    try:
        client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        message = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1024,
            system=POLICY_ASSISTANT_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": request.prompt}],
        )
    except anthropic.AuthenticationError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Invalid Anthropic API key.",
        )
    except anthropic.RateLimitError:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Anthropic rate limit exceeded. Please try again shortly.",
        )
    except anthropic.APIError as e:
        logger.error(f"Anthropic API error: {e}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Anthropic API error: {e}",
        )

    # Parse the response
    raw_text = message.content[0].text.strip()

    # Strip markdown code fences if present
    if raw_text.startswith("```"):
        lines = raw_text.split("\n")
        lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        raw_text = "\n".join(lines).strip()

    try:
        parsed = json.loads(raw_text)
    except json.JSONDecodeError:
        logger.error(f"Failed to parse Claude response as JSON: {raw_text[:200]}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to parse policy from AI response. Please try rephrasing your request.",
        )

    if "policy" not in parsed or "explanation" not in parsed:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="AI response missing required fields. Please try rephrasing your request.",
        )

    try:
        policy = PolicyCreateRequest(**parsed["policy"])
    except Exception as e:
        logger.error(f"Failed to validate generated policy: {e}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Generated policy failed validation: {e}",
        )

    return GeneratePolicyResponse(
        policy=policy,
        explanation=parsed["explanation"],
    )


@router.get("/{policy_id}", response_model=PolicyDetail)
async def get_policy(
    policy_id: UUID,
    db: Database = Depends(get_database),
) -> PolicyDetail:
    """Get policy by ID."""
    policy = db.get_policy_by_id(policy_id)
    if policy is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Policy {policy_id} not found",
        )

    conditions = [
        RuleConditionCreate(
            field=c.field,
            operator=c.operator,
            value=c.value,
            case_sensitive=c.case_sensitive,
        )
        for c in policy.conditions
    ]

    return PolicyDetail(
        id=policy.id,
        name=policy.name,
        description=policy.description,
        enabled=policy.enabled,
        categories=[c.value for c in policy.categories],
        tools=policy.tools,
        conditions=conditions,
        condition_logic=policy.condition_logic,
        action=policy.action.value,
        severity=policy.severity.value,
        alert_title=policy.alert_title,
        alert_description=policy.alert_description,
        tags=policy.tags,
        created_at=policy.created_at,
        updated_at=policy.updated_at,
    )


@router.post("", response_model=PolicyResponse, status_code=status.HTTP_201_CREATED)
async def create_policy(
    request: PolicyCreateRequest,
    db: Database = Depends(get_database),
) -> PolicyResponse:
    """Create a new policy."""
    # Convert categories from strings to EventCategory enum
    categories = []
    for cat in request.categories:
        try:
            categories.append(EventCategory(cat))
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid category: {cat}",
            )

    # Convert conditions
    conditions = [
        RuleCondition(
            field=c.field,
            operator=c.operator,
            value=c.value,
            case_sensitive=c.case_sensitive,
        )
        for c in request.conditions
    ]

    policy = Policy(
        name=request.name,
        description=request.description,
        enabled=request.enabled,
        categories=categories,
        tools=request.tools,
        conditions=conditions,
        condition_logic=request.condition_logic,
        action=request.action,
        severity=request.severity,
        alert_title=request.alert_title,
        alert_description=request.alert_description,
        tags=request.tags,
    )

    try:
        db.save_policy(policy)
    except Exception as e:
        if "UNIQUE constraint" in str(e):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Policy with name '{request.name}' already exists",
            )
        raise

    # Reload engine policies so new policy takes effect immediately
    get_engine().reload_policies()

    logger.info(f"Created policy: {policy.name} ({policy.id})")

    return PolicyResponse(
        id=policy.id,
        name=policy.name,
        enabled=policy.enabled,
        message="Policy created successfully",
    )


@router.put("/{policy_id}", response_model=PolicyResponse)
async def update_policy(
    policy_id: UUID,
    request: PolicyUpdateRequest,
    db: Database = Depends(get_database),
) -> PolicyResponse:
    """Update an existing policy."""
    existing = db.get_policy_by_id(policy_id)
    if existing is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Policy {policy_id} not found",
        )

    # Build update data
    update_data: dict[str, Any] = {}

    if request.name is not None:
        update_data["name"] = request.name
    if request.description is not None:
        update_data["description"] = request.description
    if request.enabled is not None:
        update_data["enabled"] = request.enabled
    if request.categories is not None:
        categories = []
        for cat in request.categories:
            try:
                categories.append(EventCategory(cat))
            except ValueError:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid category: {cat}",
                )
        update_data["categories"] = categories
    if request.tools is not None:
        update_data["tools"] = request.tools
    if request.conditions is not None:
        update_data["conditions"] = [
            RuleCondition(
                field=c.field,
                operator=c.operator,
                value=c.value,
                case_sensitive=c.case_sensitive,
            )
            for c in request.conditions
        ]
    if request.condition_logic is not None:
        update_data["condition_logic"] = request.condition_logic
    if request.action is not None:
        update_data["action"] = request.action
    if request.severity is not None:
        update_data["severity"] = request.severity
    if request.alert_title is not None:
        update_data["alert_title"] = request.alert_title
    if request.alert_description is not None:
        update_data["alert_description"] = request.alert_description
    if request.tags is not None:
        update_data["tags"] = request.tags

    updated_policy = db.update_policy(policy_id, update_data)

    # Reload engine policies so changes take effect immediately
    get_engine().reload_policies()

    logger.info(f"Updated policy: {updated_policy.name} ({policy_id})")

    return PolicyResponse(
        id=policy_id,
        name=updated_policy.name,
        enabled=updated_policy.enabled,
        message="Policy updated successfully",
    )


@router.delete("/{policy_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_policy(
    policy_id: UUID,
    db: Database = Depends(get_database),
) -> None:
    """Delete a policy."""
    existing = db.get_policy_by_id(policy_id)
    if existing is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Policy {policy_id} not found",
        )

    db.delete_policy(policy_id)

    # Reload engine policies so deletion takes effect immediately
    get_engine().reload_policies()

    logger.info(f"Deleted policy: {existing.name} ({policy_id})")


@router.post("/{policy_id}/toggle", response_model=PolicyResponse)
async def toggle_policy(
    policy_id: UUID,
    db: Database = Depends(get_database),
) -> PolicyResponse:
    """Enable or disable a policy (toggle current state)."""
    existing = db.get_policy_by_id(policy_id)
    if existing is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Policy {policy_id} not found",
        )

    new_enabled = not existing.enabled
    updated_policy = db.update_policy(policy_id, {"enabled": new_enabled})

    # Reload engine policies so toggle takes effect immediately
    get_engine().reload_policies()

    action = "enabled" if new_enabled else "disabled"
    logger.info(f"Policy {action}: {updated_policy.name} ({policy_id})")

    return PolicyResponse(
        id=policy_id,
        name=updated_policy.name,
        enabled=updated_policy.enabled,
        message=f"Policy {action}",
    )
