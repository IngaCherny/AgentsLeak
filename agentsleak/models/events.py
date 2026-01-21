"""Event models for AgentsLeak.

These models represent the events collected from Claude Code hooks.
"""

from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Any
from uuid import UUID, uuid4

from pydantic import AliasChoices, BaseModel, Field


class EventCategory(StrEnum):
    """Category of an event based on the action being performed."""

    FILE_READ = "file_read"
    FILE_WRITE = "file_write"
    FILE_DELETE = "file_delete"
    COMMAND_EXEC = "command_exec"
    NETWORK_ACCESS = "network_access"
    CODE_EXECUTION = "code_execution"
    SUBAGENT_SPAWN = "subagent_spawn"
    MCP_TOOL_USE = "mcp_tool_use"
    SESSION_LIFECYCLE = "session_lifecycle"
    UNKNOWN = "unknown"


class Severity(StrEnum):
    """Severity level for events and alerts."""

    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INFO = "info"


class HookType(StrEnum):
    """Type of Claude Code hook that generated the event."""

    PRE_TOOL_USE = "PreToolUse"
    POST_TOOL_USE = "PostToolUse"
    SESSION_START = "SessionStart"
    SESSION_END = "SessionEnd"
    SUBAGENT_START = "SubagentStart"
    SUBAGENT_STOP = "SubagentStop"
    PERMISSION_REQUEST = "PermissionRequest"
    USER_PROMPT_SUBMIT = "UserPromptSubmit"
    STOP = "Stop"
    NOTIFICATION = "Notification"


class ToolInput(BaseModel):
    """Input parameters for a tool invocation."""

    command: str | None = None
    file_path: str | None = None
    content: str | None = None
    url: str | None = None
    pattern: str | None = None
    query: str | None = None

    # Allow additional fields for different tool types
    model_config = {"extra": "allow"}


class ToolResult(BaseModel):
    """Result from a tool invocation."""

    output: str | None = None
    error: str | None = None
    exit_code: int | None = None
    truncated: bool = False

    model_config = {"extra": "allow"}


class HookPayload(BaseModel):
    """Payload received from Claude Code hooks.

    Accepts both Claude Code's native field names and our internal names.
    Claude Code sends: cwd, hook_event_name, tool_response
    We normalize to: session_cwd, hook_type, tool_result
    """

    # Session information
    session_id: str = Field(..., description="Unique session identifier")
    session_cwd: str | None = Field(
        None,
        validation_alias=AliasChoices("session_cwd", "cwd"),
        description="Current working directory of the session",
    )

    # Hook metadata (optional - determined by which endpoint is called)
    hook_type: str = Field(
        default="unknown",
        validation_alias=AliasChoices("hook_type", "hook_event_name"),
        description="Type of hook (PreToolUse, PostToolUse, etc.)",
    )

    # Tool information (for tool-related hooks)
    tool_name: str | None = Field(None, description="Name of the tool being used")
    tool_input: dict[str, Any] | None = Field(None, description="Input parameters for the tool")
    tool_result: dict[str, Any] | None = Field(
        None,
        validation_alias=AliasChoices("tool_result", "tool_response"),
        description="Result from the tool",
    )

    # Claude Code specific fields
    tool_use_id: str | None = Field(None, description="Tool use ID from Claude Code")
    transcript_path: str | None = Field(None, description="Path to session transcript")
    permission_mode: str | None = Field(None, description="Current permission mode")

    # Additional context
    timestamp: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        validation_alias=AliasChoices("timestamp", "sensor_timestamp"),
    )
    query: str | None = Field(None, description="User query that triggered the action")
    parent_session_id: str | None = Field(None, description="Parent session ID for subagents")

    # Endpoint information (multi-endpoint support)
    endpoint_hostname: str | None = Field(None, description="Hostname of the reporting endpoint")
    endpoint_user: str | None = Field(None, description="Username on the reporting endpoint")

    # Session source (claude_code or cursor)
    session_source: str | None = Field(None, description="Source tool: claude_code or cursor")

    model_config = {"extra": "allow", "populate_by_name": True}


class Decision(BaseModel):
    """Decision response for PreToolUse hooks.

    Controls whether the tool execution should proceed, be blocked, or modified.
    """

    allow: bool = Field(True, description="Whether to allow the tool execution")
    reason: str | None = Field(None, description="Reason for the decision")
    modified_input: dict[str, Any] | None = Field(
        None, description="Modified input parameters (if any)"
    )
    alert_id: UUID | None = Field(None, description="Associated alert ID if blocked")

    def to_hook_response(self) -> dict[str, Any]:
        """Convert to Claude Code hook response format.

        Uses hookSpecificOutput format that Claude Code expects.
        """
        if self.allow:
            result: dict[str, Any] = {}
            if self.modified_input:
                result["hookSpecificOutput"] = {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "allow",
                    "updatedInput": self.modified_input,
                }
            return result
        return {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": self.reason or "Blocked by AgentsLeak policy",
            }
        }


class Session(BaseModel):
    """A Claude Code session being monitored."""

    id: UUID = Field(default_factory=uuid4)
    session_id: str = Field(..., description="Claude Code session ID")
    started_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    ended_at: datetime | None = None
    cwd: str | None = Field(None, description="Working directory")
    parent_session_id: str | None = Field(None, description="Parent session for subagents")
    event_count: int = Field(default=0)
    alert_count: int = Field(default=0)
    risk_score: int = Field(default=0)
    status: str = Field(default="active")

    # Endpoint information (multi-endpoint support)
    endpoint_hostname: str | None = Field(None, description="Hostname of the reporting endpoint")
    endpoint_user: str | None = Field(None, description="Username on the reporting endpoint")

    # Session source (claude_code or cursor)
    session_source: str | None = Field(None, description="Source tool: claude_code or cursor")

    model_config = {"from_attributes": True}


class Event(BaseModel):
    """An event captured from Claude Code agent activity."""

    id: UUID = Field(default_factory=uuid4)
    session_id: str = Field(..., description="Claude Code session ID")
    timestamp: datetime = Field(default_factory=lambda: datetime.now(UTC))

    # Hook information
    hook_type: str = Field(..., description="Type of hook that generated this event")
    tool_name: str | None = Field(None, description="Name of the tool used")
    tool_input: dict[str, Any] | None = Field(None, description="Tool input parameters")
    tool_result: dict[str, Any] | None = Field(None, description="Tool execution result")

    # Classification
    category: EventCategory = Field(default=EventCategory.UNKNOWN)
    severity: Severity = Field(default=Severity.INFO)

    # Enrichment metadata
    file_paths: list[str] = Field(default_factory=list)
    commands: list[str] = Field(default_factory=list)
    urls: list[str] = Field(default_factory=list)
    ip_addresses: list[str] = Field(default_factory=list)

    # Processing state
    processed: bool = Field(default=False)
    enriched: bool = Field(default=False)

    # Raw payload for debugging
    raw_payload: dict[str, Any] | None = Field(None)

    model_config = {"from_attributes": True}

    @classmethod
    def from_hook_payload(cls, payload: HookPayload) -> Event:
        """Create an Event from a HookPayload."""
        return cls(
            session_id=payload.session_id,
            timestamp=payload.timestamp,
            hook_type=payload.hook_type,
            tool_name=payload.tool_name,
            tool_input=payload.tool_input,
            tool_result=payload.tool_result,
            raw_payload=payload.model_dump(),
        )
