# AgentsLeak Threat Model

## Scope

AgentsLeak monitors AI coding agents (Claude Code, Cursor) by intercepting tool-use events through hooks, classifying them, and generating real-time alerts for suspicious behavior.

**In scope:** Detecting credential theft, data exfiltration, unauthorized command execution, reverse shells, download-and-execute chains, reconnaissance, persistence installation, scope violations, and multi-step attack sequences by AI agents.

**Out of scope:** Protecting against kernel-level exploits, hardware attacks, compromised operating systems, or attacks that occur entirely outside the agent's tool-use boundary (e.g., a compromised LLM provider returning malicious model weights).

---

## Threat Actors

| Actor | Motivation | Access Level |
|-------|-----------|--------------|
| **AI Agent (primary)** | Prompt injection or emergent behavior causing the agent to steal data, install persistence, or execute malicious commands | Full tool-use permissions granted by the user |
| **Malicious Prompt Injector** | External content (files, web pages, API responses) containing injected instructions that redirect the agent | Indirect — operates through the agent |
| **Compromised MCP Server** | Malicious MCP tool provider returning harmful tool schemas or results | Influences agent behavior through tool definitions |
| **Insider / Malicious User** | Developer with legitimate access who uses the agent as a proxy for unauthorized actions | Direct access to endpoint |

---

## Agent Attack Scenarios

### 1. Credential Theft
The agent reads sensitive files (`.env`, `.aws/credentials`, SSH keys, API tokens) and transmits their contents to an external server.

**Detection:** File path pattern matching on sensitive paths + behavioral sequence detection (read sensitive file -> network access within time window). Risk scoring elevates SSH keys, cloud credentials, and `.env` files.

### 2. Data Exfiltration
The agent reads proprietary code or data, encodes it (base64, tar, gzip), and uploads it via curl, wget, or Python requests.

**Detection:** Sequence rule SEQ-EXFIL-001 (sensitive file read -> network POST) and SEQ-EXFIL-002 (encode/archive -> network transmission). Risk scoring for curl with `-F`/`--data`/`--upload-file` flags referencing files.

### 3. Reverse Shells
The agent opens a reverse shell to an attacker-controlled server using netcat, bash `/dev/tcp`, socat, or interpreter one-liners.

**Detection:** Command pattern matching for `/dev/tcp/`, `nc -e`, `mkfifo | nc`, `socat exec:`, Python/Node/Ruby socket patterns. Risk score weight: 25 (highest tier).

### 4. Download and Execute
The agent downloads a script from an external URL and executes it (`curl | bash`, `wget -O /tmp/x && chmod +x /tmp/x && /tmp/x`).

**Detection:** Sequence rule SEQ-EXEC-001 (download file -> execute file within 2 minutes). Pattern matching for `curl|bash` pipes. Risk score weight: 20.

### 5. Scope Violations
The agent accesses files or systems outside its intended working directory, reads unrelated projects, or modifies system configuration.

**Detection:** Policy conditions with `starts_with` on file paths to enforce directory boundaries. Session CWD tracking to detect out-of-scope access.

### 6. Reconnaissance and Privilege Escalation
The agent reads system files (`/etc/passwd`, `/proc/self/environ`, `/etc/sudoers`) to understand the environment, then attempts privilege escalation.

**Detection:** Sequence rule SEQ-RECON-001 (system file read -> sudo/chmod/chown within 10 minutes). File pattern matching for `/etc/shadow`, `/proc/` paths.

### 7. Persistence Installation
The agent creates a script and installs it into a persistence location (crontab, systemd unit, shell profile, launchd plist).

**Detection:** Sequence rule SEQ-PERSIST-001 (write script file -> write to persistence location within 10 minutes).

### 8. Supply Chain Attacks
The agent installs malicious packages (`pip install`, `npm install`) or modifies `package.json`/`requirements.txt` to add backdoored dependencies.

**Detection:** Command severity classification for `pip install`, `npm install` (MEDIUM). Policy conditions can restrict specific package names.

---

## AgentsLeak Self-Defense

What happens when the agent targets AgentsLeak itself?

### Agent reads/modifies AgentsLeak config or rules
- **Vector:** Agent reads `~/.agentsleak/config.env` or modifies `~/.agentsleak/rules/` to disable detection.
- **Detection:** File path monitoring flags access to `~/.agentsleak/` paths. A policy can be configured to BLOCK writes to `~/.agentsleak/`.
- **Mitigation:** Default file patterns include `.agentsleak` in sensitive path detection.

### Agent kills the AgentsLeak process
- **Vector:** Agent runs `kill`, `pkill agentsleak`, or `lsof -i :3827 | kill`.
- **Detection:** Command pattern matching detects `kill` commands. Process monitoring is possible via policies.
- **Residual risk:** If the process is killed, hooks fail-open by design. This is an acknowledged tradeoff — fail-open ensures the agent doesn't get permanently stuck, but it means a successful kill disables monitoring. **Mitigation:** Process supervision (systemd, launchd) can auto-restart AgentsLeak.

### Agent bypasses hooks entirely
- **Vector:** Agent modifies Claude Code's `settings.json` or Cursor's `hooks.json` to remove AgentsLeak hooks.
- **Detection:** This requires a file write to `~/.claude/settings.json` or `~/.cursor/hooks.json`, which is captured as a tool-use event before it happens (PreToolUse). A BLOCK policy on these paths prevents modification.
- **Mitigation:** Configure block policies for hook configuration files.

### Agent tampers with the database
- **Vector:** Agent directly modifies `~/.agentsleak/data.db` to delete evidence.
- **Detection:** File path monitoring flags SQLite database access. A BLOCK policy prevents writes to the database file.
- **Mitigation:** Block policies on `~/.agentsleak/data.db`. Future: append-only audit log.

### Agent floods events to overwhelm detection
- **Vector:** Agent generates thousands of benign events to push suspicious events out of sliding windows or exhaust resources.
- **Detection:** Event volume anomalies can be detected (future work).
- **Residual risk:** Current implementation has fixed-size session buffers (500 events). Flooding can evict older events from sequence detection windows.
- **Mitigation (future):** Rate limiting per session, anomaly detection for event volume spikes.

### Agent uses encoding/obfuscation to evade regex
- **Vector:** Agent splits commands across variables (`A=cu; B=rl; $A$B`), uses hex encoding, heredocs, or eval chains.
- **Detection:** Current regex patterns catch many common evasion techniques (eval, base64, command substitution) but cannot cover all shell obfuscation.
- **Residual risk:** This is a known limitation. See [ROADMAP.md](ROADMAP.md) for AST parsing and semantic analysis plans.

---

## Architecture Security Properties

| Property | Description |
|----------|-------------|
| **Synchronous blocking** | PreToolUse hooks are evaluated synchronously — the agent cannot proceed until AgentsLeak responds. Dangerous actions are blocked before execution. |
| **Fail-open design** | If the collector is unreachable, hooks return permissive defaults. This prevents AgentsLeak failures from blocking legitimate work, but means monitoring is not guaranteed. |
| **Local-only binding** | Server binds to `127.0.0.1` by default — not accessible from the network. |
| **No secrets in transit** | Hooks communicate with the collector over localhost HTTP. No credentials traverse the network. |
| **Bearer token auth** | Dashboard API endpoints are protected by `AGENTSLEAK_DASHBOARD_TOKEN` when configured. |
| **Collector auth** | Hook endpoints can require `AGENTSLEAK_API_KEY` header to prevent unauthorized event injection. |

---

## Known Limitations

1. **Regex-only detection** — Pattern matching cannot catch sophisticated obfuscation (variable expansion, string splitting, encoding chains, aliasing, heredocs). See ROADMAP.md.
2. **SQLite single-writer** — SQLite's WAL mode handles concurrent reads well, but write throughput is limited. Fine for single-machine monitoring, not for multi-collector deployments.
3. **No TLS between hook and collector** — Communication is localhost-only, so TLS is unnecessary in the standard deployment. If deployed across machines, TLS should be added.
4. **Fail-open is a double-edged sword** — Ensures usability but means monitoring can be silently disabled if the collector crashes or is killed.
5. **No integrity verification** — Hook scripts are not signed. An attacker with file system access could replace them with no-ops.
6. **Session buffer overflow** — Sequence detection uses fixed-size sliding windows. An attacker generating enough events can push malicious steps out of the window.

---

## Mitigations and Hardening Checklist

- [x] API key authentication for collector endpoints (`AGENTSLEAK_API_KEY`)
- [x] Bearer token authentication for dashboard (`AGENTSLEAK_DASHBOARD_TOKEN`)
- [x] Behavioral sequence detection for multi-step attacks
- [x] Risk scoring with weighted signals across files, commands, URLs, IPs
- [x] Default block policies for critical paths
- [ ] Rule signing to prevent unauthorized policy modification (future)
- [ ] Encrypted database at rest (future)
- [ ] Append-only audit log (future)
- [ ] Process watchdog / auto-restart (deploy with systemd/launchd)
- [ ] AST parsing for shell commands (future — see ROADMAP.md)
- [ ] Anomaly detection for event volume spikes (future)
