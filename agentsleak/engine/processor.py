"""Event processing engine for AgentsLeak."""

from __future__ import annotations

import asyncio
import logging
import re
from typing import Any, ClassVar

from agentsleak.config.settings import Settings, get_settings
from agentsleak.engine.classifier import (
    classify_event,
    compute_severity,
    extract_command_file_refs,
    extract_commands,
    extract_file_paths,
    extract_ip_addresses,
    extract_urls,
)
from agentsleak.engine.sequence import SequenceTracker, get_default_sequence_rules
from agentsleak.models.alerts import Alert, Policy, PolicyAction
from agentsleak.models.events import Decision, Event, EventCategory
from agentsleak.models.graph import EdgeRelation, GraphEdge, GraphNode, NodeType
from agentsleak.store.database import Database, get_database

logger = logging.getLogger(__name__)


class Engine:
    """Event processing engine for AgentsLeak.

    Handles event enrichment, classification, policy evaluation,
    sequence detection, risk scoring, and alert generation.
    """

    def __init__(
        self,
        settings: Settings | None = None,
        database: Database | None = None,
    ) -> None:
        """Initialize the engine.

        Args:
            settings: Optional settings. Uses global settings if not provided.
            database: Optional database. Uses global database if not provided.
        """
        self.settings = settings or get_settings()
        self._database = database
        self._event_queue: asyncio.Queue[Event] = asyncio.Queue()
        self._running = False
        self._task: asyncio.Task[None] | None = None
        self._policies: list[Policy] = []
        self._sequence_tracker = SequenceTracker()

    @property
    def database(self) -> Database:
        """Get the database instance."""
        if self._database is None:
            self._database = get_database()
        return self._database

    @property
    def event_queue(self) -> asyncio.Queue[Event]:
        """Get the event queue."""
        return self._event_queue

    async def start(self) -> None:
        """Start the processing loop."""
        if self._running:
            return

        self._running = True
        self._load_policies()
        self._task = asyncio.create_task(self._process_loop())
        logger.info("Engine processing loop started")

    async def stop(self) -> None:
        """Stop the processing loop."""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("Engine processing loop stopped")

    def _load_policies(self) -> None:
        """Load policies and sequence rules."""
        try:
            self._policies = self.database.get_policies(enabled_only=True)
            logger.info(f"Loaded {len(self._policies)} active policies")
        except Exception as e:
            logger.error(f"Failed to load policies: {e}")
            self._policies = []

        # Load sequence rules
        self._sequence_tracker.load_rules(get_default_sequence_rules())

    def reload_policies(self) -> None:
        """Reload policies and sequence rules."""
        self._load_policies()

    async def enqueue(self, event: Event) -> None:
        """Add an event to the processing queue.

        Args:
            event: The event to process
        """
        await self._event_queue.put(event)

    async def _process_loop(self) -> None:
        """Background task that processes events from the queue."""
        while self._running:
            try:
                # Get event with timeout to allow checking running flag
                try:
                    event = await asyncio.wait_for(
                        self._event_queue.get(),
                        timeout=self.settings.process_interval,
                    )
                except TimeoutError:
                    continue

                # Process the event
                await self._process_event(event)
                self._event_queue.task_done()

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.exception(f"Error processing event: {e}")

    async def _process_event(self, event: Event) -> None:
        """Process a single event.

        Args:
            event: The event to process
        """
        try:
            # Enrich event with metadata
            self.enrich(event)

            # Classify event
            self.classify(event)

            # Evaluate policies (for non-PreToolUse events)
            if event.hook_type != "PreToolUse":
                await self._evaluate_policies(event)

            # Evaluate behavioral sequences
            await self._evaluate_sequences(event)

            # Update session risk score
            self._update_risk_score(event)

            # Build graph from enriched event
            self._build_graph(event)

            # Mark as processed
            event.processed = True
            event.enriched = True

            # Update in database
            self.database.save_event(event)

            # Broadcast event via WebSocket
            await self._broadcast_event(event)

            logger.debug(
                f"Processed event: {event.id} "
                f"(category={event.category.value}, severity={event.severity.value})"
            )

        except Exception as e:
            logger.exception(f"Failed to process event {event.id}: {e}")

    def enrich(self, event: Event) -> None:
        """Enrich an event with extracted metadata.

        Args:
            event: The event to enrich
        """
        # Extract file paths
        event.file_paths = extract_file_paths(event)

        # Extract commands
        event.commands = extract_commands(event)

        # Extract URLs
        event.urls = extract_urls(event)

        # Extract IP addresses
        event.ip_addresses = extract_ip_addresses(event)

        event.enriched = True

    def classify(self, event: Event) -> None:
        """Classify an event's category and severity.

        Args:
            event: The event to classify
        """
        event.category = classify_event(event)
        event.severity = compute_severity(event)

    async def evaluate_pre_tool(self, event: Event) -> Decision:
        """Evaluate an event for pre-tool blocking.

        This is called synchronously during PreToolUse to determine
        if the tool execution should be blocked.

        Args:
            event: The event to evaluate

        Returns:
            Decision indicating whether to allow, block, or modify
        """
        # First enrich and classify
        self.enrich(event)
        self.classify(event)

        # Check blocking policies
        for policy in self._policies:
            if policy.action != PolicyAction.BLOCK:
                continue

            event_data = self._event_to_dict(event)
            if policy.matches(event_data):
                # Create alert for blocked action
                alert = Alert(
                    session_id=event.session_id,
                    title=policy.alert_title or f"Blocked: {policy.name}",
                    description=policy.alert_description or policy.description,
                    severity=policy.severity,
                    category=event.category,
                    policy_id=policy.id,
                    event_ids=[event.id],
                    blocked=True,
                )
                alert.add_evidence(
                    event_id=event.id,
                    description=f"Blocked by policy: {policy.name}",
                    data={"tool_name": event.tool_name, "category": event.category.value if hasattr(event.category, 'value') else str(event.category)},
                    file_path=event.file_paths[0] if event.file_paths else None,
                    command=event.commands[0] if event.commands else None,
                    url=event.urls[0] if event.urls else None,
                )
                self.database.save_alert(alert)
                self.database.increment_session_alert_count(event.session_id)
                await self._broadcast_alert(alert)

                logger.warning(
                    f"Blocked tool execution: policy={policy.name}, "
                    f"tool={event.tool_name}, session={event.session_id}"
                )

                return Decision(
                    allow=False,
                    reason=f"Blocked by policy: {policy.name}",
                    alert_id=alert.id,
                )

        # Allow by default
        return Decision(allow=True)

    async def _evaluate_policies(self, event: Event) -> None:
        """Evaluate event against all policies and generate alerts.

        Args:
            event: The event to evaluate
        """
        event_data = self._event_to_dict(event)

        for policy in self._policies:
            # Skip blocking policies (already handled in pre-tool)
            if policy.action == PolicyAction.BLOCK:
                continue

            if policy.matches(event_data):
                if policy.action == PolicyAction.ALERT:
                    alert = Alert(
                        session_id=event.session_id,
                        title=policy.alert_title or f"Alert: {policy.name}",
                        description=policy.alert_description or policy.description,
                        severity=policy.severity,
                        category=event.category,
                        policy_id=policy.id,
                        event_ids=[event.id],
                    )
                    alert.add_evidence(
                        event_id=event.id,
                        description=f"Matched policy: {policy.name}",
                        data={"tool_name": event.tool_name, "category": event.category.value if hasattr(event.category, 'value') else str(event.category)},
                        file_path=event.file_paths[0] if event.file_paths else None,
                        command=event.commands[0] if event.commands else None,
                        url=event.urls[0] if event.urls else None,
                    )
                    self.database.save_alert(alert)
                    self.database.increment_session_alert_count(event.session_id)
                    await self._broadcast_alert(alert)

                    logger.info(
                        f"Generated alert: policy={policy.name}, "
                        f"severity={policy.severity.value}"
                    )

                elif policy.action == PolicyAction.LOG:
                    logger.info(
                        f"Policy match logged: policy={policy.name}, "
                        f"event={event.id}"
                    )

    async def _evaluate_sequences(self, event: Event) -> None:
        """Evaluate event against behavioral sequence rules.

        Feeds the event into the sequence tracker and generates alerts
        for any newly completed attack sequences.
        """
        event_data = self._event_to_dict(event)

        matches = self._sequence_tracker.track_event(
            event_id=event.id,
            session_id=event.session_id,
            timestamp=event.timestamp,
            event_data=event_data,
        )

        for rule, matching_events in matches:
            # Build evidence from each step
            alert = Alert(
                session_id=event.session_id,
                title=rule.alert_title or f"Sequence: {rule.name}",
                description=rule.alert_description or rule.description,
                severity=rule.severity,
                category=event.category,
                event_ids=[me.event_id for me in matching_events],
            )

            for i, (step, matched_event) in enumerate(
                zip(rule.steps, matching_events)
            ):
                step_data = matched_event.data
                alert.add_evidence(
                    event_id=matched_event.event_id,
                    description=f"Step {i + 1}: {step.label}",
                    data={
                        "tool_name": step_data.get("tool_name", ""),
                        "category": step_data.get("category", ""),
                        "sequence_rule": rule.id,
                    },
                    file_path=(step_data.get("file_paths") or [None])[0] if isinstance(step_data.get("file_paths"), list) else None,
                    command=(step_data.get("commands") or [None])[0] if isinstance(step_data.get("commands"), list) else None,
                    url=(step_data.get("urls") or [None])[0] if isinstance(step_data.get("urls"), list) else None,
                )

            alert.tags = [*rule.tags, "sequence-detection"]
            self.database.save_alert(alert)
            self.database.increment_session_alert_count(event.session_id)
            await self._broadcast_alert(alert)

            logger.warning(
                f"Sequence alert: rule={rule.id} ({rule.name}), "
                f"session={event.session_id[:12]}, "
                f"steps={len(matching_events)}"
            )

    # ── Risk signal patterns ─────────────────────────────────────────────
    # Each tuple: (compiled_regex, weight). Evaluated against the relevant
    # content field.  Weights are additive — an event can match multiple
    # signals and the scores stack.

    _FILE_RISK_SIGNALS: ClassVar[list[tuple[re.Pattern[str], int]]] = [
        # Cryptographic keys / SSH
        (re.compile(r"\.ssh/(id_|authorized_keys|known_hosts)", re.I), 15),
        (re.compile(r"\.(pem|key|p12|pfx|jks|keystore)$", re.I), 12),
        # Cloud / service credentials
        (re.compile(r"\.aws/(credentials|config)", re.I), 15),
        (re.compile(r"\.gcloud/|\.azure/|\.kube/config", re.I), 12),
        (re.compile(r"\.git-credentials|\.netrc", re.I), 12),
        # Env / secret files
        (re.compile(r"\.env(\.\w+)?$", re.I), 10),
        (re.compile(r"(secret|credential|password|token)s?(\.\w+)?$", re.I), 10),
        # System sensitive
        (re.compile(r"/etc/(passwd|shadow|sudoers)", re.I), 10),
        (re.compile(r"/proc/(self|[0-9]+)/(environ|maps|cmdline)", re.I), 8),
        # Browser / app data
        (re.compile(r"(cookies|login\s*data|\.gnupg)", re.I), 8),
    ]

    _CMD_RISK_SIGNALS: ClassVar[list[tuple[re.Pattern[str], int]]] = [
        # Reverse shells
        (re.compile(r"/dev/tcp/|/dev/udp/", re.I), 25),
        (re.compile(r"nc\b.*-e\s+/bin/|ncat\b.*-e\s+/bin/", re.I), 25),
        (re.compile(r"mkfifo.*nc\b|socat\b.*exec:", re.I), 25),
        # Download-and-execute
        (re.compile(r"curl\b.*\|\s*(ba)?sh|wget\b.*\|\s*(ba)?sh", re.I), 20),
        (re.compile(r"curl\b.*-o\s+\S+.*&&.*chmod\s+\+x", re.I), 20),
        # Data exfiltration
        (re.compile(r"curl\b.*(-F|--data|--upload-file)\s+.*@", re.I), 18),
        (re.compile(r"curl\b.*\|\s*base64", re.I), 15),
        # Encoding / obfuscation
        (re.compile(r"base64\b.*(-d|--decode|encode)", re.I), 10),
        (re.compile(r"\beval\b.*\$\(|`.*`.*\beval\b", re.I), 12),
        # Interpreter one-liners with network
        (re.compile(r"python[23]?\s+-c\s+.*\b(requests|urllib|socket)\b", re.I), 12),
        (re.compile(r"node\s+-e\s+.*\bfetch\b", re.I), 10),
        (re.compile(r"ruby\s+-e\s+.*\bNet::HTTP\b", re.I), 10),
        # Privilege escalation
        (re.compile(r"\bsudo\b.*chmod\s+[0-7]*[4-7][0-7]{2}|chown\s+root", re.I), 8),
        (re.compile(r"\bchmod\b.*\+s\b", re.I), 10),
        # Recon
        (re.compile(r"\bwhoami\b|\bid\b|\buname\b.*-a", re.I), 3),
    ]

    _SEARCH_RISK_SIGNALS: ClassVar[list[tuple[re.Pattern[str], int]]] = [
        # Credential hunting
        (re.compile(r"password|passwd|api_key|api.key|secret.key|token", re.I), 8),
        (re.compile(r"AKIA[0-9A-Z]|aws_secret|aws_access", re.I), 12),
        (re.compile(r"BEGIN\s+(RSA|DSA|EC|OPENSSH)\s+PRIVATE", re.I), 15),
        (re.compile(r"ghp_[A-Za-z0-9]|github_pat_", re.I), 10),
    ]

    _URL_RISK_SIGNALS: ClassVar[list[tuple[re.Pattern[str], int]]] = [
        # Raw IP destinations (not localhost)
        (re.compile(r"https?://(?!127\.|0\.|10\.|192\.168\.|172\.(1[6-9]|2|3[01])\.)\d+\.\d+\.\d+\.\d+"), 8),
        # Known paste / exfil services
        (re.compile(r"(pastebin|requestbin|ngrok|burp|interact\.sh|oast)", re.I), 12),
    ]

    def _compute_event_risk(self, event: Event) -> int:
        """Compute risk score from event content by scanning for risk signals.

        The score is the sum of all matched signal weights across four
        dimensions: file paths, commands, search patterns, and URLs.
        Only non-zero scores propagate to the session total — benign
        development activity (reading source files, running tests, git)
        scores zero and is ignored.
        """
        score = 0

        # 1. File path signals
        for fp in event.file_paths:
            for pattern, weight in self._FILE_RISK_SIGNALS:
                if pattern.search(fp):
                    score += weight
                    break  # one match per file path

        # 2. Command signals
        for cmd in event.commands:
            for pattern, weight in self._CMD_RISK_SIGNALS:
                if pattern.search(cmd):
                    score += weight
                    # don't break — a command can match multiple signals
                    # (e.g. curl exfil + base64 encoding)

        # 3. Search / grep pattern signals
        if event.tool_input and event.tool_name in ("Grep", "Search"):
            search_text = str(event.tool_input.get("pattern", ""))
            for pattern, weight in self._SEARCH_RISK_SIGNALS:
                if pattern.search(search_text):
                    score += weight

        # 4. URL / network destination signals
        for url in event.urls:
            for pattern, weight in self._URL_RISK_SIGNALS:
                if pattern.search(url):
                    score += weight
                    break

        # 5. IP address signals — contacting external IPs
        for ip in event.ip_addresses:
            if not ip.startswith(("127.", "0.", "10.", "192.168.", "172.")):
                score += 6

        return score

    def _update_risk_score(self, event: Event) -> None:
        """Update session risk score based on content analysis.

        Scans event content (file paths, commands, URLs, search patterns)
        against risk signal patterns. Only events that match at least one
        signal contribute to the session risk score. Normal development
        activity (reading source, running tests, git) scores zero.
        """
        try:
            risk_delta = self._compute_event_risk(event)

            if risk_delta > 0:
                self.database.increment_session_risk_score(
                    event.session_id, risk_delta
                )
        except Exception as e:
            logger.debug(f"Risk score update failed for {event.session_id}: {e}")

    def _build_graph(self, event: Event) -> None:
        """Build a multi-level graph from an enriched event.

        Hierarchy:
            Session ──uses──▶ Tool ──reads/writes──▶ File
                                   ──executes──▶ Process ──connects_to──▶ URL
                                   ──connects_to──▶ URL  (when no process)

        This creates readable attack-chain trees instead of flat stars.
        """
        try:
            import os
            from urllib.parse import urlparse
            from uuid import UUID as _UUID

            db = self.database
            sid = event.session_id
            eid = event.id

            # ── 1) Session node (always) ──────────────────────────────
            session_node = GraphNode(
                node_type=NodeType.SESSION,
                label=sid[:16],
                value=sid,
                session_ids=[sid],
                event_ids=[eid],
            )
            session_actual_id = _UUID(db.save_graph_node(session_node))

            # ── 2) Tool node — intermediate layer ─────────────────────
            # Scoped per-session so each session has its own tool tree.
            # (value includes session_id to prevent cross-session merging)
            parent_id = session_actual_id

            if event.tool_name:
                tool_node = GraphNode(
                    node_type=NodeType.TOOL,
                    label=event.tool_name,
                    value=f"{event.tool_name}:{sid}",
                    session_ids=[sid],
                    event_ids=[eid],
                )
                tool_actual_id = _UUID(db.save_graph_node(tool_node))
                db.save_graph_edge(GraphEdge(
                    source_id=session_actual_id,
                    target_id=tool_actual_id,
                    relation=EdgeRelation.USES,
                    session_ids=[sid],
                    event_ids=[eid],
                ))
                parent_id = tool_actual_id

            # ── 3) File nodes → connect to tool ──────────────────────
            # Skip for command events — step 4 creates more precise
            # process→file edges with correct roles (writes/reads/executes).
            if not event.commands:
                for fp in event.file_paths:
                    label = os.path.basename(fp) or fp
                    file_node = GraphNode(
                        node_type=NodeType.FILE,
                        label=label,
                        value=fp,
                        session_ids=[sid],
                        event_ids=[eid],
                    )
                    file_actual_id = _UUID(db.save_graph_node(file_node))

                    if event.category == EventCategory.FILE_WRITE:
                        rel = EdgeRelation.WRITES
                    elif event.category == EventCategory.FILE_DELETE:
                        rel = EdgeRelation.DELETES
                    else:
                        rel = EdgeRelation.READS

                    db.save_graph_edge(GraphEdge(
                        source_id=parent_id,
                        target_id=file_actual_id,
                        relation=rel,
                        session_ids=[sid],
                        event_ids=[eid],
                    ))

            # ── 4) Command/process nodes → connect to tool ───────────
            #      Group by base command for cleaner hierarchy:
            #      Tool → CommandGroup (curl) → Process (curl -o ...) → File/URL
            process_actual_ids: list[_UUID] = []

            for cmd in event.commands:
                # Extract base command name for grouping
                base = cmd.strip().split()[0] if cmd.strip() else "unknown"
                base = os.path.basename(base)  # /usr/bin/curl → curl

                # Create command group node (deduplicated per session)
                group_node = GraphNode(
                    node_type=NodeType.COMMAND,
                    label=base,
                    value=f"cmdgroup:{base}:{sid}",
                    session_ids=[sid],
                    event_ids=[eid],
                )
                group_actual_id = _UUID(db.save_graph_node(group_node))
                db.save_graph_edge(GraphEdge(
                    source_id=parent_id,
                    target_id=group_actual_id,
                    relation=EdgeRelation.EXECUTES,
                    session_ids=[sid],
                    event_ids=[eid],
                ))

                # Create individual process node
                short_label = cmd[:60] + ("..." if len(cmd) > 60 else "")
                cmd_node = GraphNode(
                    node_type=NodeType.PROCESS,
                    label=short_label,
                    value=cmd,
                    session_ids=[sid],
                    event_ids=[eid],
                )
                cmd_actual_id = _UUID(db.save_graph_node(cmd_node))
                process_actual_ids.append(cmd_actual_id)
                db.save_graph_edge(GraphEdge(
                    source_id=group_actual_id,
                    target_id=cmd_actual_id,
                    relation=EdgeRelation.EXECUTES,
                    session_ids=[sid],
                    event_ids=[eid],
                ))

                # ── Data-flow: process → file edges ───────────────
                for ref in extract_command_file_refs(cmd):
                    file_label = os.path.basename(ref.path) or ref.path
                    file_node = GraphNode(
                        node_type=NodeType.FILE,
                        label=file_label,
                        value=ref.path,
                        session_ids=[sid],
                        event_ids=[eid],
                    )
                    file_actual_id = _UUID(db.save_graph_node(file_node))

                    if ref.role == "writes":
                        rel = EdgeRelation.WRITES
                    elif ref.role == "executes":
                        rel = EdgeRelation.EXECUTES
                    else:
                        rel = EdgeRelation.READS

                    db.save_graph_edge(GraphEdge(
                        source_id=cmd_actual_id,
                        target_id=file_actual_id,
                        relation=rel,
                        session_ids=[sid],
                        event_ids=[eid],
                    ))

            # ── 5) URL/domain nodes ──────────────────────────────────
            # If processes exist, connect URL to the process that made the
            # network call (creates Session → Tool → Process → URL chains).
            # Otherwise connect to tool/session.
            for url in event.urls:
                try:
                    parsed = urlparse(url)
                    domain = parsed.hostname or url
                except Exception:
                    domain = url

                domain_node = GraphNode(
                    node_type=NodeType.URL,
                    label=domain,
                    value=url,
                    session_ids=[sid],
                    event_ids=[eid],
                )
                domain_actual_id = _UUID(db.save_graph_node(domain_node))

                if process_actual_ids:
                    for pid in process_actual_ids:
                        db.save_graph_edge(GraphEdge(
                            source_id=pid,
                            target_id=domain_actual_id,
                            relation=EdgeRelation.CONNECTS_TO,
                            session_ids=[sid],
                            event_ids=[eid],
                        ))
                else:
                    db.save_graph_edge(GraphEdge(
                        source_id=parent_id,
                        target_id=domain_actual_id,
                        relation=EdgeRelation.CONNECTS_TO,
                        session_ids=[sid],
                        event_ids=[eid],
                    ))

        except Exception as e:
            logger.error(f"Failed to build graph for event {event.id}: {e}")

    def _serialize_event(self, event: Event) -> dict[str, Any]:
        """Serialize an Event for JSON broadcast / API responses."""
        return {
            "id": str(event.id),
            "session_id": event.session_id,
            "timestamp": event.timestamp.isoformat(),
            "hook_type": event.hook_type,
            "tool_name": event.tool_name,
            "tool_input": event.tool_input,
            "tool_result": event.tool_result,
            "category": event.category.value if hasattr(event.category, "value") else str(event.category),
            "severity": event.severity.value if hasattr(event.severity, "value") else str(event.severity),
            "file_paths": event.file_paths,
            "commands": event.commands,
            "urls": event.urls,
            "ip_addresses": event.ip_addresses,
            "processed": event.processed,
            "enriched": event.enriched,
        }

    def _serialize_alert(self, alert: Alert) -> dict[str, Any]:
        """Serialize an Alert for JSON broadcast / API responses."""
        return {
            "id": str(alert.id),
            "session_id": alert.session_id,
            "created_at": alert.created_at.isoformat(),
            "updated_at": alert.updated_at.isoformat(),
            "title": alert.title,
            "description": alert.description,
            "severity": alert.severity.value if hasattr(alert.severity, "value") else str(alert.severity),
            "category": alert.category.value if hasattr(alert.category, "value") else str(alert.category),
            "status": alert.status.value if hasattr(alert.status, "value") else str(alert.status),
            "policy_id": str(alert.policy_id) if alert.policy_id else None,
            "policy_name": alert.metadata.get("policy_name"),
            "event_ids": [str(eid) for eid in alert.event_ids],
            "evidence": [
                {"event_id": str(e.event_id), "description": e.description, "data": e.data}
                for e in alert.evidence
            ],
            "action_taken": alert.action_taken,
            "blocked": alert.blocked,
            "tags": alert.tags,
            "metadata": alert.metadata,
        }

    async def _broadcast_event(self, event: Event) -> None:
        """Broadcast event to WebSocket clients."""
        try:
            from agentsleak.api.websocket import broadcast_event as _broadcast_event
            await _broadcast_event(self._serialize_event(event))
        except Exception as exc:
            logger.debug("Broadcast event failed: %s", exc)

    async def _broadcast_alert(self, alert: Alert) -> None:
        """Broadcast alert to WebSocket clients."""
        try:
            from agentsleak.api.websocket import broadcast_alert as _broadcast_alert
            await _broadcast_alert(self._serialize_alert(alert))
        except Exception as exc:
            logger.debug("Broadcast alert failed: %s", exc)

    def _event_to_dict(self, event: Event) -> dict[str, Any]:
        """Convert event to dictionary for policy matching."""
        raw = event.raw_payload or {}
        return {
            "id": str(event.id),
            "session_id": event.session_id,
            "hook_type": event.hook_type,
            "tool_name": event.tool_name,
            "tool_input": event.tool_input or {},
            "tool_result": event.tool_result or {},
            "category": event.category.value,
            "severity": event.severity.value,
            "file_paths": event.file_paths,
            "commands": event.commands,
            "urls": event.urls,
            "ip_addresses": event.ip_addresses,
            # Expose raw payload fields for policy matching
            "permission_mode": raw.get("permission_mode"),
            "query": raw.get("query"),
            "transcript_path": raw.get("transcript_path"),
            "session_cwd": raw.get("session_cwd") or raw.get("cwd"),
            "parent_session_id": raw.get("parent_session_id"),
        }


# Global engine instance
_engine: Engine | None = None


def get_engine() -> Engine:
    """Get the global engine instance."""
    global _engine
    if _engine is None:
        _engine = Engine()
    return _engine


def set_engine(engine: Engine) -> None:
    """Set the global engine instance."""
    global _engine
    _engine = engine
