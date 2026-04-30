# Colony Sandbox Security Design

## Overview

Colony agents run as Claude Code sessions inside Docker containers on secunit.
The isolation model prevents agents from modifying global configuration,
reading other projects' data, or exfiltrating credentials — while still
allowing them to function autonomously.

## Container Runtime Hardening

```
--cap-drop=ALL                    # Drop all Linux capabilities
--cap-add=DAC_OVERRIDE            # Only add back file permission override
--security-opt=no-new-privileges  # Block setuid/setgid escalation
--memory=364m --cpus=0.25         # Resource limits (auto-detected from host)
```

Containers run as `claude` (uid 1000) matching the host user for volume
permission alignment. No root access inside containers.

## Mount Isolation Model

```
MOUNT                                          MODE    PURPOSE
─────────────────────────────────────────────────────────────────────
~/.claude/                                     ro      Global config base
  ├── .credentials.json (from tmpdir)          ro      Per-container decrypted creds
  ├── CLAUDE.md                                ro      Agent instructions (immutable)
  ├── settings.json                            ro      Hooks + config (immutable)
  ├── hooks/                                   ro      Hook scripts
  ├── projects/ (tmpfs overlay)                rw      EMPTY — hides all project data
  │   └── {encoded-cwd}/                       rw      THIS project's conversations only
  ├── teams/ (tmpfs overlay)                   rw      EMPTY — hides all team data
  │   └── {teamName}/                          rw      THIS team's session map only
  └── agent-status/                            rw      Status signal files (shared)
~/projects/{teamName}                          rw      Project workspace files
/tmp/gtgui-tmux/{container}/                   rw      Tmux socket (mode 0700)
```

### Why tmpfs overlays?

Docker bind mounts can't exclude specific subdirectories from a parent mount.
A read-only mount of `~/.claude/` exposes ALL subdirectories (including other
projects' conversations) for reading. The tmpfs overlay pattern:

1. Mount `~/.claude/` as read-only (base layer — everything visible but immutable)
2. Mount tmpfs over `projects/` and `teams/` (hides ALL shared data)
3. Bind-mount only THIS project's subdirectory into the empty tmpfs

Result: agents can only see their own conversations and team config.

## Credential Management

### SOPS + age Encryption

Credentials are encrypted at rest using SOPS with age keys:

```
~/.claude/.credentials.json.enc    # Encrypted (on disk)
~/.claude/age-key.txt              # Decryption key (mode 0600)
/tmp/gtgui-creds/{container}/      # Decrypted per-container (tmpdir)
```

On container creation:
1. Backend decrypts `.credentials.json.enc` using the age key
2. Plaintext written to `/tmp/gtgui-creds/{container}/` (cleaned on reboot)
3. File bind-mounted into container as `~/.claude/.credentials.json:ro`

Agents can READ credentials (needed for API auth) but cannot MODIFY them.

### Environment Variable Credentials

Secrets that agents need programmatically (not via Claude Code's auth):
- `GH_TOKEN` / `GITHUB_TOKEN` — GitHub PAT passed via `-e` flag
- Git credential helper configured to use `$GH_TOKEN`

Env vars are NOT included in Claude's prompt context, so even if a token
value contained prompt injection text, it wouldn't be interpreted.

## Prompt Injection Prevention

### CLAUDE.md Protection

`~/.claude/CLAUDE.md` is mounted read-only. A compromised agent cannot
modify global instructions that affect all other agents. This prevents:
- Instruction injection ("ignore all prior instructions...")
- Credential exfiltration instructions
- Behavioral modification across projects

### Path Denial (Defense in Depth)

`settings.json` includes `permissions.deny` rules:
```json
{
  "permissions": {
    "deny": [
      "~/.claude/.credentials.json",
      "~/.claude/settings.json",
      "~/.ssh",
      "~/.gh_token",
      "/etc/shadow",
      "/etc/sudoers"
    ]
  }
}
```

Even with `bypassPermissions: true`, Claude Code won't read/write denied paths.

## Supply Chain Hardening

Environment variables set in the container (inspired by Trail of Bits guidance):

```
NPM_CONFIG_IGNORE_SCRIPTS=true      # Block npm postinstall scripts
NPM_CONFIG_AUDIT_LEVEL=critical     # Flag critical vulnerabilities
PIP_REQUIRE_HASHES=true             # Require hash-pinned Python packages
PIP_NO_CACHE_DIR=true               # No cached pip packages
CLAUDE_CODE_DISABLE_AUTO_UPDATE=1   # Pin Claude Code version to image
```

## Status Signaling

Agents signal status via a Claude Code `Notification` hook (`idle_prompt`
matcher) that touches `~/.claude/agent-status/{tmux_session_name}`. The
backend stats this file to determine if an agent needs attention — no
screen scraping or JSONL parsing required for the primary signal.

## Network

- Default: full network access (agents need API + git access)
- Optional: `--network=none` for full network isolation (configurable)

## What's NOT Isolated

- `agent-status/` is shared across all containers (by design — backend reads it)
- All containers use the same `GH_TOKEN` (same GitHub permissions)
- Container-to-container network traffic is possible (same Docker bridge)
- The age decryption key is on the host filesystem (root or claude user access)
