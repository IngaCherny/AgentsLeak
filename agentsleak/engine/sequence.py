"""Behavioral sequence detection for AgentsLeak.

Tracks multi-step attack patterns across events within a session.
Unlike single-event policies, sequence rules match ordered or unordered
combinations of events within a sliding time window.

Example: "Read .env file" → "curl POST to external server" within 5 minutes
         triggers EXFIL-001 (data exfiltration).
"""

from __future__ import annotations

import logging
import re
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from agentsleak.models.alerts import PolicyAction
from agentsleak.models.events import Severity

logger = logging.getLogger(__name__)


@dataclass
class SequenceStep:
    """A single step in a sequence rule."""

    label: str
    categories: list[str] = field(default_factory=list)
    field_patterns: dict[str, str] = field(default_factory=dict)
    # field_patterns maps dot-notation fields to regex patterns
    # e.g. {"tool_input.command": r"curl.*-d"}


@dataclass
class SequenceRule:
    """A multi-step behavioral detection rule."""

    id: str
    name: str
    description: str
    steps: list[SequenceStep]
    time_window_seconds: int = 300  # 5 minutes
    ordered: bool = True
    action: PolicyAction = PolicyAction.ALERT
    severity: Severity = Severity.CRITICAL
    alert_title: str = ""
    alert_description: str = ""
    tags: list[str] = field(default_factory=list)
    enabled: bool = True


@dataclass
class _BufferedEvent:
    """An event in the session sliding window."""

    event_id: UUID
    timestamp: datetime
    data: dict[str, Any]


class SequenceTracker:
    """Tracks event sequences per session and detects multi-step patterns.

    Maintains a sliding window of recent events per session.
    When a new event is added, checks all sequence rules for matches.
    Uses deduplication to avoid firing the same sequence multiple times.
    """

    def __init__(self, max_buffer_size: int = 500) -> None:
        self._rules: list[SequenceRule] = []
        self._buffers: dict[str, deque[_BufferedEvent]] = {}
        self._max_buffer_size = max_buffer_size
        # Track fired sequences: {(rule_id, session_id, frozenset(event_ids))}
        self._fired: set[tuple[str, str]] = set()

    def load_rules(self, rules: list[SequenceRule]) -> None:
        """Load sequence rules."""
        self._rules = [r for r in rules if r.enabled]
        logger.info(f"Loaded {len(self._rules)} sequence rules")

    def track_event(
        self,
        event_id: UUID,
        session_id: str,
        timestamp: datetime,
        event_data: dict[str, Any],
    ) -> list[tuple[SequenceRule, list[_BufferedEvent]]]:
        """Add an event and return any newly completed sequences.

        Returns:
            List of (rule, matching_events) tuples for sequences that fired.
        """
        # Add to session buffer
        buf = self._buffers.setdefault(
            session_id, deque(maxlen=self._max_buffer_size)
        )
        entry = _BufferedEvent(
            event_id=event_id,
            timestamp=timestamp,
            data=event_data,
        )
        buf.append(entry)

        # Prune old events beyond the largest time window
        max_window = max((r.time_window_seconds for r in self._rules), default=300)
        cutoff = timestamp - timedelta(seconds=max_window)
        while buf and buf[0].timestamp < cutoff:
            buf.popleft()

        # Check all rules
        matches: list[tuple[SequenceRule, list[_BufferedEvent]]] = []
        for rule in self._rules:
            result = self._check_rule(rule, session_id, timestamp)
            if result is not None:
                # Deduplication: use rule_id + session_id + hash of step event IDs
                dedup_key = (rule.id, session_id)
                if dedup_key not in self._fired:
                    self._fired.add(dedup_key)
                    matches.append((rule, result))
                    logger.info(
                        f"Sequence detected: {rule.id} ({rule.name}) "
                        f"in session {session_id[:12]}"
                    )

        return matches

    def reset_session(self, session_id: str) -> None:
        """Clear buffer and fired state for a session."""
        self._buffers.pop(session_id, None)
        self._fired = {
            (rid, sid) for rid, sid in self._fired if sid != session_id
        }

    def _check_rule(
        self,
        rule: SequenceRule,
        session_id: str,
        now: datetime,
    ) -> list[_BufferedEvent] | None:
        """Check if a sequence rule is satisfied in the session buffer.

        Returns matching events if the rule fires, None otherwise.
        """
        buf = self._buffers.get(session_id)
        if not buf:
            return None

        # Time window cutoff
        cutoff = now - timedelta(seconds=rule.time_window_seconds)
        window_events = [e for e in buf if e.timestamp >= cutoff]

        if not window_events:
            return None

        # Find events matching each step
        step_matches: list[list[_BufferedEvent]] = []
        for step in rule.steps:
            matching = [
                e for e in window_events if self._matches_step(step, e.data)
            ]
            if not matching:
                return None  # Step has no matching events → sequence incomplete
            step_matches.append(matching)

        # Check ordering constraint
        if rule.ordered:
            return self._find_ordered_match(step_matches)
        else:
            # Unordered: just need one match per step within the window
            return [matches[0] for matches in step_matches]

    def _matches_step(self, step: SequenceStep, event_data: dict[str, Any]) -> bool:
        """Check if an event matches a sequence step."""
        # Check category
        if step.categories:
            event_cat = event_data.get("category", "")
            if event_cat not in step.categories:
                return False

        # Check field patterns
        for field_path, pattern in step.field_patterns.items():
            field_value = self._get_nested(event_data, field_path)
            if field_value is None:
                return False
            try:
                if not re.search(pattern, str(field_value), re.IGNORECASE):
                    return False
            except re.error:
                return False

        return True

    def _find_ordered_match(
        self, step_matches: list[list[_BufferedEvent]]
    ) -> list[_BufferedEvent] | None:
        """Find an ordered sequence of events matching each step.

        Uses greedy forward scan: for each step, pick the earliest event
        that occurs after the previous step's event.
        """
        result: list[_BufferedEvent] = []
        last_time: datetime | None = None

        for matches in step_matches:
            # Sort by timestamp
            sorted_matches = sorted(matches, key=lambda e: e.timestamp)
            found = False
            for event in sorted_matches:
                if last_time is None or event.timestamp >= last_time:
                    result.append(event)
                    last_time = event.timestamp
                    found = True
                    break
            if not found:
                return None

        return result

    @staticmethod
    def _get_nested(data: dict[str, Any], path: str) -> Any:
        """Get a nested value from a dict using dot notation."""
        parts = path.split(".")
        value: Any = data
        for part in parts:
            if isinstance(value, dict):
                value = value.get(part)
            else:
                return None
        return value


# ── Built-in sequence rules ─────────────────────────────────────────────────

def get_default_sequence_rules() -> list[SequenceRule]:
    """Return the built-in sequence detection rules."""
    return [
        SequenceRule(
            id="SEQ-EXFIL-001",
            name="Data exfiltration: sensitive file read → network access",
            description=(
                "Detects when a sensitive file (.env, .pem, credentials, SSH keys) "
                "is read followed by any network access within the time window. "
                "This is the classic exfiltration pattern."
            ),
            steps=[
                SequenceStep(
                    label="Read sensitive file",
                    categories=["file_read"],
                    field_patterns={
                        "file_paths": r"(\.(env|pem|key)|credentials|secrets|password|api_key|\.ssh/id_)",
                    },
                ),
                SequenceStep(
                    label="Network access",
                    categories=["network_access", "command_exec"],
                    field_patterns={
                        # Match curl, wget, python requests, node fetch, etc.
                        "commands": r"(curl|wget|fetch|requests\.|http\.client|urllib|aiohttp|node\s+-e|python.*import\s+(requests|urllib|http))",
                    },
                ),
            ],
            time_window_seconds=300,
            ordered=True,
            action=PolicyAction.ALERT,
            severity=Severity.CRITICAL,
            alert_title="Data exfiltration pattern detected",
            alert_description=(
                "A sensitive file was read followed by network access. "
                "This sequence matches the classic data exfiltration pattern "
                "where credentials or secrets are stolen and transmitted externally."
            ),
            tags=["exfiltration", "sequence", "data-theft"],
        ),
        SequenceRule(
            id="SEQ-EXFIL-002",
            name="Staged exfiltration: file copy → encode → network",
            description=(
                "Detects multi-step exfiltration where files are first copied or "
                "encoded (base64, xxd, tar) and then sent over the network."
            ),
            steps=[
                SequenceStep(
                    label="Encode or archive sensitive data",
                    categories=["command_exec"],
                    field_patterns={
                        "commands": r"(base64|xxd|tar\s+[czf]|zip|gzip|openssl\s+(enc|base64)).*(\.(env|pem|key|json|conf)|credentials|secrets|\.ssh)",
                    },
                ),
                SequenceStep(
                    label="Network transmission",
                    categories=["command_exec", "network_access"],
                    field_patterns={
                        "commands": r"(curl|wget|nc\s|ncat|python.*socket|ruby.*TCPSocket)",
                    },
                ),
            ],
            time_window_seconds=300,
            ordered=True,
            action=PolicyAction.ALERT,
            severity=Severity.CRITICAL,
            alert_title="Staged data exfiltration detected",
            alert_description=(
                "Data was encoded or archived and then transmitted over the network. "
                "This multi-step pattern is used to evade simple exfiltration detection."
            ),
            tags=["exfiltration", "sequence", "encoding", "evasion"],
        ),
        SequenceRule(
            id="SEQ-EXEC-001",
            name="Download and execute",
            description=(
                "Detects when a file is downloaded (curl -o, wget) followed by "
                "execution (bash, python, chmod +x) within the time window."
            ),
            steps=[
                SequenceStep(
                    label="Download file",
                    categories=["command_exec", "network_access"],
                    field_patterns={
                        "commands": r"(curl\s+.*-[oO]\s|wget\s|fetch\s+.*-o\s)",
                    },
                ),
                SequenceStep(
                    label="Execute downloaded file",
                    categories=["command_exec"],
                    field_patterns={
                        "commands": r"(bash|sh|python[23]?|perl|ruby|chmod\s+\+x)\s+",
                    },
                ),
            ],
            time_window_seconds=120,
            ordered=True,
            action=PolicyAction.ALERT,
            severity=Severity.CRITICAL,
            alert_title="Download and execute pattern detected",
            alert_description=(
                "A file was downloaded and then executed. This is a common "
                "malware deployment technique."
            ),
            tags=["download-execute", "sequence", "malware"],
        ),
        SequenceRule(
            id="SEQ-RECON-001",
            name="Reconnaissance → privilege escalation",
            description=(
                "Detects reconnaissance (reading system files like /etc/passwd, "
                "/proc) followed by privilege escalation attempts (sudo, chmod +s)."
            ),
            steps=[
                SequenceStep(
                    label="System reconnaissance",
                    categories=["file_read"],
                    field_patterns={
                        "file_paths": r"^(/etc/(passwd|shadow|sudoers|group|hosts)|/proc/)",
                    },
                ),
                SequenceStep(
                    label="Privilege escalation attempt",
                    categories=["command_exec"],
                    field_patterns={
                        "commands": r"(sudo\s|chmod\s+\+s|chmod\s+777|chown\s+root|setuid|pkexec|doas\s)",
                    },
                ),
            ],
            time_window_seconds=600,
            ordered=True,
            action=PolicyAction.ALERT,
            severity=Severity.HIGH,
            alert_title="Reconnaissance followed by privilege escalation",
            alert_description=(
                "System files were read for reconnaissance followed by a "
                "privilege escalation attempt. This sequence indicates a "
                "deliberate attack progression."
            ),
            tags=["reconnaissance", "sequence", "privilege-escalation"],
        ),
        SequenceRule(
            id="SEQ-PERSIST-001",
            name="Persistence installation",
            description=(
                "Detects writing to persistence locations (cron, systemd, "
                "shell profiles, launchd) after downloading or creating a script."
            ),
            steps=[
                SequenceStep(
                    label="Create or download script",
                    categories=["file_write", "command_exec"],
                    field_patterns={
                        "file_paths": r"\.(sh|py|pl|rb|js)$",
                    },
                ),
                SequenceStep(
                    label="Install persistence",
                    categories=["file_write", "command_exec"],
                    field_patterns={
                        "file_paths": r"(cron|systemd|launchd|\.bashrc|\.zshrc|\.profile|\.bash_profile|/etc/init\.d|LaunchAgents|LaunchDaemons)",
                    },
                ),
            ],
            time_window_seconds=600,
            ordered=True,
            action=PolicyAction.ALERT,
            severity=Severity.HIGH,
            alert_title="Persistence mechanism installed",
            alert_description=(
                "A script was created and then installed into a persistence "
                "location (cron, systemd, shell profile, launchd). This indicates "
                "an attempt to maintain access across reboots."
            ),
            tags=["persistence", "sequence", "backdoor"],
        ),
    ]
