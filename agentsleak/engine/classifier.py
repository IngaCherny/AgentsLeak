"""Event classification logic for AgentsLeak."""

from __future__ import annotations

import re

from agentsleak.models.events import Event, EventCategory, Severity

# Tool name to category mappings
TOOL_CATEGORY_MAP: dict[str, EventCategory] = {
    # File reading tools
    "Read": EventCategory.FILE_READ,
    "read_file": EventCategory.FILE_READ,
    "cat": EventCategory.FILE_READ,
    "head": EventCategory.FILE_READ,
    "tail": EventCategory.FILE_READ,
    "Glob": EventCategory.FILE_READ,
    "Grep": EventCategory.FILE_READ,

    # File writing tools
    "Write": EventCategory.FILE_WRITE,
    "Edit": EventCategory.FILE_WRITE,
    "write_file": EventCategory.FILE_WRITE,
    "NotebookEdit": EventCategory.FILE_WRITE,

    # Command execution tools
    "Bash": EventCategory.COMMAND_EXEC,
    "bash": EventCategory.COMMAND_EXEC,
    "execute_command": EventCategory.COMMAND_EXEC,
    "shell": EventCategory.COMMAND_EXEC,

    # Network access tools
    "WebFetch": EventCategory.NETWORK_ACCESS,
    "WebSearch": EventCategory.NETWORK_ACCESS,
    "fetch": EventCategory.NETWORK_ACCESS,
    "curl": EventCategory.NETWORK_ACCESS,
    "http": EventCategory.NETWORK_ACCESS,

    # Subagent tools
    "Task": EventCategory.SUBAGENT_SPAWN,
    "dispatch_agent": EventCategory.SUBAGENT_SPAWN,

    # Agent workflow / task management tools
    "TaskCreate": EventCategory.SESSION_LIFECYCLE,
    "TaskUpdate": EventCategory.SESSION_LIFECYCLE,
    "TaskList": EventCategory.SESSION_LIFECYCLE,
    "TaskGet": EventCategory.SESSION_LIFECYCLE,
    "TaskStop": EventCategory.SESSION_LIFECYCLE,
    "TodoWrite": EventCategory.SESSION_LIFECYCLE,
    "TodoRead": EventCategory.SESSION_LIFECYCLE,

    # Other agent tools
    "AskUserQuestion": EventCategory.SESSION_LIFECYCLE,
    "Skill": EventCategory.SESSION_LIFECYCLE,
    "EnterPlanMode": EventCategory.SESSION_LIFECYCLE,
    "ExitPlanMode": EventCategory.SESSION_LIFECYCLE,
}

# Patterns for command analysis
DANGEROUS_COMMAND_PATTERNS: list[tuple[str, Severity]] = [
    # Critical commands
    (r"rm\s+-rf\s+/", Severity.CRITICAL),
    (r":(){ :|:& };:", Severity.CRITICAL),  # Fork bomb
    (r"mkfs\.", Severity.CRITICAL),
    (r"dd\s+if=.*of=/dev/", Severity.CRITICAL),
    (r"chmod\s+-R\s+777\s+/", Severity.CRITICAL),

    # High severity
    (r"curl.*\|\s*(bash|sh)", Severity.HIGH),
    (r"wget.*\|\s*(bash|sh)", Severity.HIGH),
    (r"rm\s+-rf", Severity.HIGH),
    (r"sudo\s+", Severity.HIGH),
    (r"chmod\s+[0-7]*7[0-7]*", Severity.HIGH),
    (r"chown\s+-R", Severity.HIGH),
    (r"nc\s+-.*-e", Severity.HIGH),  # Netcat with execute
    (r"python.*-c.*socket", Severity.HIGH),
    (r"base64\s+-d.*\|", Severity.HIGH),

    # Evasion-resistant patterns
    (r"python[23]?\s+-c\s+.*(?:import\s+(?:requests|urllib|http|socket)|urlopen|urlretrieve)", Severity.HIGH),
    (r"node\s+-e\s+.*(?:require\s*\(\s*['\"](?:http|https|net|child_process)|fetch\s*\()", Severity.HIGH),
    (r"ruby\s+-e\s+.*(?:Net::HTTP|TCPSocket|open-uri|URI\.open)", Severity.HIGH),
    (r"perl\s+-e\s+.*(?:LWP|IO::Socket|Net::HTTP)", Severity.HIGH),
    (r"base64.*(?:\.env|\.pem|\.key|credential|secret|password|ssh)", Severity.HIGH),
    (r"openssl\s+(?:enc|base64).*(?:\.env|\.pem|\.key)", Severity.HIGH),
    (r"xxd.*(?:\.env|\.pem|\.key|credential)", Severity.HIGH),
    (r"\$\(.*(?:curl|wget|base64|cat\s+.*\.env)", Severity.HIGH),  # Command substitution evasion
    (r"eval\s+.*(?:curl|wget|base64|\\x)", Severity.HIGH),  # eval-based evasion
    (r"echo\s+[A-Za-z0-9+/=]{20,}\s*\|\s*base64\s+-d", Severity.HIGH),  # base64 blob decode + pipe

    # Medium severity
    (r"curl\s+", Severity.MEDIUM),
    (r"wget\s+", Severity.MEDIUM),
    (r"git\s+clone", Severity.MEDIUM),
    (r"pip\s+install", Severity.MEDIUM),
    (r"npm\s+install", Severity.MEDIUM),
    (r"ssh\s+", Severity.MEDIUM),
    (r"scp\s+", Severity.MEDIUM),

    # Low severity
    (r"git\s+", Severity.LOW),
    (r"ls\s+", Severity.INFO),
    (r"pwd", Severity.INFO),
    (r"echo\s+", Severity.INFO),
]

# Sensitive file patterns
SENSITIVE_FILE_PATTERNS: list[tuple[str, Severity]] = [
    # Critical
    (r"/etc/passwd", Severity.HIGH),
    (r"/etc/shadow", Severity.CRITICAL),
    (r"\.ssh/.*", Severity.HIGH),
    (r"id_rsa", Severity.CRITICAL),
    (r"id_ed25519", Severity.CRITICAL),
    (r"\.aws/credentials", Severity.CRITICAL),
    (r"\.env", Severity.HIGH),
    (r"\.netrc", Severity.HIGH),
    (r"\.pgpass", Severity.HIGH),

    # High
    (r"\.git/config", Severity.MEDIUM),
    (r"password", Severity.MEDIUM),
    (r"secret", Severity.MEDIUM),
    (r"token", Severity.MEDIUM),
    (r"api.?key", Severity.MEDIUM),

    # Medium
    (r"\.bashrc", Severity.LOW),
    (r"\.zshrc", Severity.LOW),
    (r"\.profile", Severity.LOW),
]


def classify_event(event: Event) -> EventCategory:
    """Classify an event into a category based on tool and input.

    Args:
        event: The event to classify

    Returns:
        The event category
    """
    tool_name = event.tool_name

    # Direct tool mapping
    if tool_name and tool_name in TOOL_CATEGORY_MAP:
        return TOOL_CATEGORY_MAP[tool_name]

    # Check tool input for hints
    tool_input = event.tool_input or {}

    # File operations detection
    if "file_path" in tool_input or "path" in tool_input:
        # Check if it's a write operation
        if "content" in tool_input or "new_string" in tool_input:
            return EventCategory.FILE_WRITE
        return EventCategory.FILE_READ

    # Command detection
    if "command" in tool_input:
        command = tool_input.get("command", "")
        if _is_network_command(command):
            return EventCategory.NETWORK_ACCESS
        return EventCategory.COMMAND_EXEC

    # URL detection
    if "url" in tool_input:
        return EventCategory.NETWORK_ACCESS

    # Session lifecycle
    if event.hook_type in ("SessionStart", "SessionEnd", "PermissionRequest", "UserPromptSubmit"):
        return EventCategory.SESSION_LIFECYCLE

    # Subagent detection
    if event.hook_type in ("SubagentStart", "SubagentStop"):
        return EventCategory.SUBAGENT_SPAWN

    return EventCategory.UNKNOWN


def compute_severity(event: Event) -> Severity:
    """Compute the severity level for an event.

    Args:
        event: The event to evaluate

    Returns:
        The severity level
    """
    max_severity = Severity.INFO
    tool_input = event.tool_input or {}

    # Check command patterns
    if event.category == EventCategory.COMMAND_EXEC:
        command = tool_input.get("command", "")
        for pattern, severity in DANGEROUS_COMMAND_PATTERNS:
            if re.search(pattern, command, re.IGNORECASE):
                max_severity = _max_severity(max_severity, severity)

    # Check file patterns
    file_paths = event.file_paths or []
    file_path = tool_input.get("file_path") or tool_input.get("path")
    if file_path:
        file_paths = [file_path] + file_paths

    for path in file_paths:
        for pattern, severity in SENSITIVE_FILE_PATTERNS:
            if re.search(pattern, path, re.IGNORECASE):
                max_severity = _max_severity(max_severity, severity)

    # Network operations get at least LOW severity
    if event.category == EventCategory.NETWORK_ACCESS:
        max_severity = _max_severity(max_severity, Severity.LOW)

    # Subagent spawning gets at least MEDIUM severity
    if event.category == EventCategory.SUBAGENT_SPAWN:
        max_severity = _max_severity(max_severity, Severity.MEDIUM)

    return max_severity


def _is_network_command(command: str) -> bool:
    """Check if a bash command involves network operations."""
    network_commands = [
        "curl", "wget", "ssh", "scp", "rsync", "nc", "netcat",
        "ping", "traceroute", "dig", "nslookup", "host",
        "ftp", "sftp", "telnet",
    ]
    command_lower = command.lower()
    return any(cmd in command_lower for cmd in network_commands)


def _max_severity(a: Severity, b: Severity) -> Severity:
    """Return the higher severity level."""
    severity_order = {
        Severity.INFO: 0,
        Severity.LOW: 1,
        Severity.MEDIUM: 2,
        Severity.HIGH: 3,
        Severity.CRITICAL: 4,
    }
    return a if severity_order[a] >= severity_order[b] else b


def extract_file_paths(event: Event) -> list[str]:
    """Extract file paths from an event."""
    paths: list[str] = []
    tool_input = event.tool_input or {}

    # Direct file path fields
    for field in ["file_path", "path", "notebook_path"]:
        if field in tool_input:
            paths.append(tool_input[field])

    # Glob patterns
    if "pattern" in tool_input and event.tool_name == "Glob":
        paths.append(tool_input["pattern"])

    # Command analysis for file paths
    if "command" in tool_input:
        command = tool_input["command"]
        # Simple extraction of paths from commands
        # This is a basic implementation - could be more sophisticated
        path_pattern = r'(?:^|\s)(/[^\s;|&><]+|\.?\.?/[^\s;|&><]+)'
        matches = re.findall(path_pattern, command)
        paths.extend(matches)

    return list(set(paths))  # Deduplicate


def extract_commands(event: Event) -> list[str]:
    """Extract commands from an event."""
    commands: list[str] = []
    tool_input = event.tool_input or {}

    if "command" in tool_input:
        commands.append(tool_input["command"])

    return commands


def extract_urls(event: Event) -> list[str]:
    """Extract URLs from an event."""
    urls: list[str] = []
    tool_input = event.tool_input or {}

    if "url" in tool_input:
        urls.append(tool_input["url"])

    # Extract URLs from commands
    if "command" in tool_input:
        command = tool_input["command"]
        url_pattern = r'https?://[^\s"\'>]+'
        matches = re.findall(url_pattern, command)
        urls.extend(matches)

    return list(set(urls))


class CommandFileRef:
    """A file referenced by a command, with its role (read or write)."""

    __slots__ = ("path", "role")

    def __init__(self, path: str, role: str) -> None:
        self.path = path          # absolute or relative file path
        self.role = role          # "writes" | "reads" | "executes"


def extract_command_file_refs(command: str) -> list[CommandFileRef]:
    """Parse a shell command to discover files it reads from or writes to.

    This enables graph edges like:
        process ──writes──▶ file    (curl -o output.sh)
        process ──reads──▶  file    (cat config.json | ...)
        process ──executes──▶ file  (bash script.sh, python run.py)

    Returns a list of CommandFileRef with path and role.
    """
    refs: list[CommandFileRef] = []
    seen: set[tuple[str, str]] = set()

    def _add(path: str, role: str) -> None:
        key = (path, role)
        if key not in seen:
            seen.add(key)
            refs.append(CommandFileRef(path, role))

    # ── Output / write patterns ────────────────────────────────────
    # curl/wget -o/-O <file>
    for m in re.finditer(r'(?:curl|wget)\s+.*?(?:-o|-O|--output[= ])\s*(\S+)', command):
        _add(m.group(1), "writes")

    # Shell output redirection:  > file, >> file, 2> file, &> file
    for m in re.finditer(r'(?:\d|&)?>>?\s*([^\s;|&]+)', command):
        path = m.group(1)
        if not path.startswith('-') and not path.startswith('/dev/'):
            _add(path, "writes")

    # tee <file>
    for m in re.finditer(r'tee\s+(?:-a\s+)?(\S+)', command):
        _add(m.group(1), "writes")

    # cp/mv <src> <dest>  — dest is written
    for m in re.finditer(r'(?:cp|mv)\s+(?:-\w+\s+)*(\S+)\s+(\S+)', command):
        _add(m.group(1), "reads")
        _add(m.group(2), "writes")

    # ── Execution patterns ─────────────────────────────────────────
    # bash/sh/zsh/python/node/ruby/perl <file>
    for m in re.finditer(
        r'(?:^|[;|&]\s*)(?:bash|sh|zsh|python3?|node|ruby|perl)\s+([^\s;|&-]\S*)',
        command,
    ):
        _add(m.group(1), "executes")

    # ./<file> or /path/to/script (executable invocation)
    for m in re.finditer(r'(?:^|[;|&]\s*)(\./[^\s;|&]+)', command):
        _add(m.group(1), "executes")

    # source / . <file>
    for m in re.finditer(r'(?:source|\.)\s+([^\s;|&]+)', command):
        _add(m.group(1), "executes")

    # chmod +x <file>  — marks file as executable (intent to execute)
    for m in re.finditer(r'chmod\s+\+x\s+(\S+)', command):
        _add(m.group(1), "executes")

    # ── Read/input patterns ────────────────────────────────────────
    # cat/less/more/head/tail <file>
    for m in re.finditer(
        r'(?:cat|less|more|head|tail|sort|wc|md5sum|sha256sum)\s+(?:-\w+\s+)*([^\s;|&-]\S*)',
        command,
    ):
        _add(m.group(1), "reads")

    # Input redirection:  < file
    for m in re.finditer(r'<\s*([^\s;|&]+)', command):
        path = m.group(1)
        if not path.startswith('<'):  # skip heredoc <<
            _add(path, "reads")

    # curl -d @file (data from file)
    for m in re.finditer(r'-d\s+@(\S+)', command):
        _add(m.group(1), "reads")

    return refs


def extract_ip_addresses(event: Event) -> list[str]:
    """Extract IP addresses from an event."""
    ip_addresses: list[str] = []
    tool_input = event.tool_input or {}

    # IPv4 pattern
    ipv4_pattern = r'\b(?:\d{1,3}\.){3}\d{1,3}\b'

    # Check command
    if "command" in tool_input:
        matches = re.findall(ipv4_pattern, tool_input["command"])
        ip_addresses.extend(matches)

    # Check URL
    if "url" in tool_input:
        matches = re.findall(ipv4_pattern, tool_input["url"])
        ip_addresses.extend(matches)

    return list(set(ip_addresses))
