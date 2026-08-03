"""Honeytoken detection for AgentsLeak.

Honeytokens are decoy secrets planted on the host that a legitimate agent has
no reason to touch: a fake ``.env.decoy``, a bogus ``AKIA…`` AWS key, an
``id_rsa_backup`` that opens nothing. Any access — reading a decoy path, or a
decoy value surfacing in a command, URL, or skill arg — is a **zero-false-
positive** critical signal. A benign agent never references a trap it was never
told about, so there is nothing to tune and no noise to suppress. It catches
both prompt-injected agents and insider-style misbehavior, and (unlike a
heuristic) it can block with confidence.

The default set below is enough to be useful out of the box; deployments can add
their own via ``~/.agentsleak/honeytokens.json`` (or ``AGENTSLEAK_HONEYTOKENS``):

    [
      {"id": "ht-prod-db", "kind": "value", "pattern": "postgres://decoy:...",
       "label": "Decoy production DB URL"},
      {"id": "ht-vault", "kind": "path", "pattern": "secrets/vault_prod\\.json",
       "label": "Decoy production vault"}
    ]
"""

from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass
from pathlib import Path

from agentsleak.models.events import Event

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Honeytoken:
    """A single decoy.

    - ``kind == "path"``: ``pattern`` is a regex matched against file paths the
      event touches (including paths named inside a command, e.g. ``cat
      .env.decoy``).
    - ``kind == "value"``: ``pattern`` is a literal secret value; a hit is any
      appearance of it in a path, command, URL, or skill arg (covers reading,
      encoding, or exfiltrating the decoy).
    """

    id: str
    kind: str  # "path" | "value"
    pattern: str
    label: str


@dataclass(frozen=True)
class HoneytokenHit:
    """A matched honeytoken and the evidence that tripped it."""

    token: Honeytoken
    matched: str  # the concrete string that matched
    where: str  # "file_path" | "command" | "url" | "args"


# Decoys chosen to look irresistible to an attacker and impossible to hit by
# accident. Paths use ``.decoy``/``_backup`` siblings so they never collide with
# a real file; the AWS key is a syntactically valid but non-functional AKIA id.
DEFAULT_HONEYTOKENS: tuple[Honeytoken, ...] = (
    Honeytoken("ht-env-decoy", "path", r"\.env\.decoy(?:$|[^\w])", "Decoy .env secrets file"),
    Honeytoken("ht-ssh-backup", "path", r"id_rsa_backup", "Decoy SSH private key"),
    Honeytoken("ht-aws-decoy", "path", r"\.aws/credentials\.decoy", "Decoy AWS credentials file"),
    Honeytoken("ht-vault-prod", "path", r"secrets?/vault[_-]?prod\.json", "Decoy production vault"),
    Honeytoken("ht-aws-key", "value", "AKIAHONEYTOKEN0DECOY42X", "Decoy AWS access key id"),
)


def load_honeytokens() -> list[Honeytoken]:
    """Return the active honeytoken set: defaults plus any user-defined tokens.

    User tokens come from ``AGENTSLEAK_HONEYTOKENS`` (a path) or, by default,
    ``~/.agentsleak/honeytokens.json``. A malformed file is logged and ignored
    rather than failing startup — a broken config must never disable detection.
    """
    tokens = list(DEFAULT_HONEYTOKENS)

    path_str = os.environ.get("AGENTSLEAK_HONEYTOKENS")
    path = Path(path_str) if path_str else Path.home() / ".agentsleak" / "honeytokens.json"
    if not path.is_file():
        return tokens

    try:
        raw = json.loads(path.read_text())
        for entry in raw:
            kind = entry.get("kind")
            if kind not in ("path", "value"):
                logger.warning("Skipping honeytoken with invalid kind: %r", entry)
                continue
            tokens.append(
                Honeytoken(
                    id=str(entry.get("id") or f"ht-user-{len(tokens)}"),
                    kind=kind,
                    pattern=str(entry["pattern"]),
                    label=str(entry.get("label") or "User-defined honeytoken"),
                )
            )
    except (OSError, ValueError, KeyError, TypeError) as exc:
        logger.warning("Failed to load honeytokens from %s: %s", path, exc)

    return tokens


def _searchable(event: Event) -> tuple[list[str], list[str], list[str], str | None]:
    """Pull the strings an event might reference a honeytoken through.

    Returns (paths, commands, urls, args). Draws from both the enriched
    ``file_paths``/``commands``/``urls`` and the raw ``tool_input`` so detection
    works whether or not enrichment has run yet.
    """
    tool_input = event.tool_input or {}

    paths = list(event.file_paths or [])
    direct_path = tool_input.get("file_path") or tool_input.get("path")
    if isinstance(direct_path, str):
        paths.append(direct_path)

    commands = list(event.commands or [])
    direct_cmd = tool_input.get("command")
    if isinstance(direct_cmd, str):
        commands.append(direct_cmd)

    urls = list(event.urls or [])
    direct_url = tool_input.get("url")
    if isinstance(direct_url, str):
        urls.append(direct_url)

    args = tool_input.get("args")
    args = args if isinstance(args, str) else None

    return paths, commands, urls, args


def detect_honeytoken(event: Event, tokens: list[Honeytoken]) -> HoneytokenHit | None:
    """Return the first honeytoken this event touches, or ``None``.

    Path tokens match file paths *and* paths named inside commands (so
    ``cat ~/.env.decoy`` trips the same trap as ``Read``). Value tokens match
    anywhere the secret could leak: path, command, URL, or skill arg.
    """
    paths, commands, urls, args = _searchable(event)

    for token in tokens:
        if token.kind == "path":
            for path in paths:
                if re.search(token.pattern, path, re.IGNORECASE):
                    return HoneytokenHit(token, path, "file_path")
            for cmd in commands:
                if re.search(token.pattern, cmd, re.IGNORECASE):
                    return HoneytokenHit(token, cmd, "command")
        else:  # value — a literal secret, matched verbatim anywhere
            value = token.pattern
            for path in paths:
                if value in path:
                    return HoneytokenHit(token, path, "file_path")
            for cmd in commands:
                if value in cmd:
                    return HoneytokenHit(token, cmd, "command")
            for url in urls:
                if value in url:
                    return HoneytokenHit(token, url, "url")
            if args and value in args:
                return HoneytokenHit(token, args, "args")

    return None
