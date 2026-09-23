"""Behavioral sequence detection for AgentsLeak.

Tracks multi-step attack patterns across events within a session.
Unlike single-event policies, sequence rules match ordered or unordered
combinations of events within a sliding time window.

Example: "Read .env file" → "curl POST to external server" within 5 minutes
         triggers EXFIL-001 (data exfiltration).
"""

from __future__ import annotations

import ipaddress
import json
import logging
import os
import re
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import UUID

from agentsleak.models.alerts import PolicyAction
from agentsleak.models.events import Severity

logger = logging.getLogger(__name__)


# Built-in trusted software sources. A download from any of these (or a
# subdomain) is NOT considered "unknown". Deliberately small and infra-focused;
# deployments extend this via config (see load_trusted_domains).
DEFAULT_TRUSTED_DOMAINS: frozenset[str] = frozenset({
    "pypi.org", "files.pythonhosted.org", "pypi.python.org",
    "github.com", "raw.githubusercontent.com", "objects.githubusercontent.com",
    "codeload.github.com", "registry.npmjs.org", "npmjs.com", "registry.yarnpkg.com",
    "crates.io", "static.crates.io", "proxy.golang.org", "sum.golang.org",
    "deb.debian.org", "security.ubuntu.com", "archive.ubuntu.com",
    "anthropic.com", "api.anthropic.com", "docs.anthropic.com",
})

_URL_RE = re.compile(r"https?://([^/\s'\"]+)", re.IGNORECASE)


def _normalize_domain(raw: str) -> str:
    """Strip scheme/path/whitespace so 'https://Foo.COM/x' → 'foo.com'."""
    host = raw.strip().lower()
    m = _URL_RE.match(host)
    if m:
        host = m.group(1)
    host = host.split("/")[0].split("@")[-1].split(":")[0]
    return host.strip(".")


def load_trusted_domains() -> frozenset[str]:
    """Return the active trusted-domain set: defaults plus user-configured ones.

    User domains are ADDED to the defaults (defaults are always trusted) from:

      * ``AGENTSLEAK_TRUSTED_DOMAINS`` — a comma/space/newline-separated list, and
      * a JSON array file at ``AGENTSLEAK_TRUSTED_DOMAINS_FILE`` (or, by default,
        ``~/.agentsleak/trusted_domains.json``).

    A malformed file is logged and ignored rather than failing startup.
    """
    domains: set[str] = {d.lower() for d in DEFAULT_TRUSTED_DOMAINS}

    env_val = os.environ.get("AGENTSLEAK_TRUSTED_DOMAINS")
    if env_val:
        for tok in re.split(r"[,\s]+", env_val):
            if tok.strip():
                domains.add(_normalize_domain(tok))

    path_str = os.environ.get("AGENTSLEAK_TRUSTED_DOMAINS_FILE")
    path = Path(path_str) if path_str else Path.home() / ".agentsleak" / "trusted_domains.json"
    if path.is_file():
        try:
            raw = json.loads(path.read_text())
            if isinstance(raw, list):
                for entry in raw:
                    if isinstance(entry, str) and entry.strip():
                        domains.add(_normalize_domain(entry))
            else:
                logger.warning("Trusted-domains file must be a JSON array: %s", path)
        except (OSError, ValueError) as exc:
            logger.warning("Failed to load trusted domains from %s: %s", path, exc)

    return frozenset(d for d in domains if d)


def _is_local_or_private(host: str) -> bool:
    """True for localhost and loopback/private/link-local IPs.

    A fetch from the local machine or a private network is never an internet
    malware source, so it must not count as a download from an "unknown domain".
    """
    host = host.lower().strip(".")
    if host == "localhost" or host.endswith(".localhost"):
        return True
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False
    return ip.is_loopback or ip.is_private or ip.is_link_local


def _is_trusted_domain(host: str, trusted: frozenset[str] | None = None) -> bool:
    """True if host is local/private, or equals/subdomains a trusted domain."""
    if trusted is None:
        trusted = DEFAULT_TRUSTED_DOMAINS
    host = host.lower().strip(".")
    if _is_local_or_private(host):
        return True
    return any(host == d or host.endswith("." + d) for d in trusted)


def _extract_domains(event_data: dict[str, Any]) -> set[str]:
    """Pull hostnames referenced by an event (WebFetch url, curl/wget commands, urls list)."""
    candidates: list[str] = []

    urls = event_data.get("urls")
    if isinstance(urls, list):
        candidates += [u for u in urls if isinstance(u, str)]

    tool_input = event_data.get("tool_input")
    if isinstance(tool_input, dict):
        url = tool_input.get("url")
        if isinstance(url, str):
            candidates.append(url)

    commands = event_data.get("commands")
    if isinstance(commands, list):
        candidates += [c for c in commands if isinstance(c, str)]

    domains: set[str] = set()
    for text in candidates:
        for match in _URL_RE.finditer(text):
            host = match.group(1).split("@")[-1].split(":")[0].lower()
            if host:
                domains.add(host)
    return domains


@dataclass
class SequenceStep:
    """A single step in a sequence rule."""

    label: str
    categories: list[str] = field(default_factory=list)
    field_patterns: dict[str, str] = field(default_factory=dict)
    # field_patterns maps dot-notation fields to regex patterns (ALL must match)
    # e.g. {"tool_input.command": r"curl.*-d"}
    any_field_patterns: dict[str, str] = field(default_factory=dict)
    # any_field_patterns: like field_patterns but OR — at least one must match.
    # Lets one step cover both a shell download (commands) and a WebFetch (url).
    unknown_domain: bool = False
    # unknown_domain: step matches only if the event references at least one URL
    # whose host is not in TRUSTED_DOMAINS (i.e. a download from an unknown source).


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

    def __init__(
        self,
        max_buffer_size: int = 500,
        trusted_domains: frozenset[str] | None = None,
    ) -> None:
        self._rules: list[SequenceRule] = []
        self._buffers: dict[str, deque[_BufferedEvent]] = {}
        self._max_buffer_size = max_buffer_size
        # Track fired sequences: {(rule_id, session_id, frozenset(event_ids))}
        self._fired: set[tuple[str, str]] = set()
        self._trusted_domains = (
            trusted_domains if trusted_domains is not None else load_trusted_domains()
        )

    def reload_trusted_domains(self) -> None:
        """Re-read the trusted-domain config so edits take effect."""
        self._trusted_domains = load_trusted_domains()
        logger.info("Loaded %d trusted domains", len(self._trusted_domains))

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
        return self._match_in_window(rule, window_events)

    def _match_in_window(
        self, rule: SequenceRule, window_events: list[_BufferedEvent]
    ) -> list[_BufferedEvent] | None:
        """Match a rule's steps against a fixed list of window events."""
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

    def _field_matches(
        self, event_data: dict[str, Any], field_path: str, pattern: str
    ) -> bool:
        """True if the event's field value matches the regex pattern."""
        field_value = self._get_nested(event_data, field_path)
        if field_value is None:
            return False
        try:
            return bool(re.search(pattern, str(field_value), re.IGNORECASE))
        except re.error:
            return False

    def _matches_step(self, step: SequenceStep, event_data: dict[str, Any]) -> bool:
        """Check if an event matches a sequence step."""
        # Check category
        if step.categories:
            event_cat = event_data.get("category", "")
            if event_cat not in step.categories:
                return False

        # Check field patterns (ALL must match)
        for field_path, pattern in step.field_patterns.items():
            if not self._field_matches(event_data, field_path, pattern):
                return False

        # Check any_field_patterns (at least ONE must match)
        if step.any_field_patterns:
            if not any(
                self._field_matches(event_data, fp, pat)
                for fp, pat in step.any_field_patterns.items()
            ):
                return False

        # Check unknown-domain condition: needs at least one untrusted URL host.
        if step.unknown_domain:
            domains = _extract_domains(event_data)
            if not domains or all(
                _is_trusted_domain(d, self._trusted_domains) for d in domains
            ):
                return False

        return True

    def check_blocking(
        self,
        event_id: UUID,
        session_id: str,
        timestamp: datetime,
        event_data: dict[str, Any],
    ) -> tuple[SequenceRule, list[_BufferedEvent]] | None:
        """Would this incoming event COMPLETE a BLOCK-action sequence right now?

        Used synchronously at PreToolUse: the earlier steps are already in the
        session buffer (added during their own async processing); this checks
        whether the incoming (final) event closes the pattern. Does not mutate
        the buffer — the async path adds the event canonically afterwards — but
        marks the rule fired so it won't also raise a duplicate alert.
        """
        buf = self._buffers.get(session_id)
        incoming = _BufferedEvent(event_id=event_id, timestamp=timestamp, data=event_data)

        for rule in self._rules:
            if rule.action != PolicyAction.BLOCK or not rule.enabled:
                continue
            if (rule.id, session_id) in self._fired:
                continue
            cutoff = timestamp - timedelta(seconds=rule.time_window_seconds)
            window = [e for e in (buf or []) if e.timestamp >= cutoff]
            window.append(incoming)
            result = self._match_in_window(rule, window)
            # Only block when the incoming event is itself part of the match
            # (i.e. it is the step that completes the sequence).
            if result is not None and any(e.event_id == event_id for e in result):
                self._fired.add((rule.id, session_id))
                logger.warning(
                    f"Blocking sequence completed: {rule.id} ({rule.name}) "
                    f"in session {session_id[:12]}"
                )
                return rule, result

        return None

    def _find_ordered_match(
        self, step_matches: list[list[_BufferedEvent]]
    ) -> list[_BufferedEvent] | None:
        """Find an ordered sequence of DISTINCT events matching each step.

        Greedy forward scan: for each step, pick the earliest event at or after
        the previous step's event that hasn't already been used. Requiring
        distinct events per step means one event can't satisfy two steps — e.g. a
        single command that both references a URL and runs ``python3`` is not a
        download-then-execute sequence.
        """
        result: list[_BufferedEvent] = []
        used_ids: set[UUID] = set()
        last_time: datetime | None = None

        for matches in step_matches:
            # Sort by timestamp
            sorted_matches = sorted(matches, key=lambda e: e.timestamp)
            found = False
            for event in sorted_matches:
                if event.event_id in used_ids:
                    continue
                if last_time is None or event.timestamp >= last_time:
                    result.append(event)
                    used_ids.add(event.event_id)
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
            name="Download from unknown domain and execute",
            description=(
                "Alerts when a file is downloaded from an untrusted domain — "
                "curl/wget saving to disk, or a script/binary URL — and then "
                "executed (bash, python, chmod +x, ./file) within the time "
                "window. Downloads from trusted software sources (PyPI, "
                "GitHub, npm, …) are exempt."
            ),
            steps=[
                SequenceStep(
                    label="Download from an unknown domain",
                    # A fetch whose host is not trusted and that brings back a
                    # file: curl/wget saving to disk, or a URL of a script or
                    # binary. Reading a web page (docs, articles) doesn't count.
                    categories=["command_exec", "network_access"],
                    any_field_patterns={
                        "tool_input.command": (
                            r"\bcurl\b[^;&|\n]*\s(?:-[a-zA-Z]*[oO]\b|--output\b|--remote-name\b|>\s*[^\s&/])"
                            r"|\bwget\b"
                        ),
                        "tool_input.url": (
                            r"\.(?:sh|bash|zsh|py|pl|rb|js|mjs|php|ps1|bin|exe|elf|jar|deb|rpm|pkg|dmg|appimage)(?:[?#]|$)"
                        ),
                    },
                    unknown_domain=True,
                ),
                SequenceStep(
                    label="Execute the downloaded file",
                    categories=["command_exec"],
                    field_patterns={
                        # An interpreter at the start of a command, running a
                        # file (not `python3 - <<EOF` or `python -c "..."`), or
                        # chmod +x / ./file. A filename ending in .sh is not.
                        "tool_input.command": (
                            r"(?:^|[\n;&|(`])\s*(?:sudo\s+)?(?:\S*/)?(?:bash|sh|zsh|python[23]?|perl|ruby|node)"
                            r"(?!\s+-[ce]\b)(?!\s+-(?:\s|$))\s+(?:-[\w-]+\s+)*['\"]?[^\s<'\"-]"
                            r"|\bchmod\s+(?:[ugoa]*\+x|[0-7]*[1357][0-7]{0,2})\s|(?:^|[\n;&|(`])\s*\./\S"
                        ),
                    },
                ),
            ],
            time_window_seconds=120,
            ordered=True,
            action=PolicyAction.ALERT,
            severity=Severity.CRITICAL,
            alert_title="Download from unknown domain then execute",
            alert_description=(
                "A file was fetched from an untrusted domain and then executed — "
                "a common malware-deployment pattern."
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
