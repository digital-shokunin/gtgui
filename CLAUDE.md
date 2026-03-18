# Club Penguin Colony (GTGUI)

Phaser.js Club Penguin-style isometric UI for managing Claude Code agent teams running on a remote server.

## Architecture
- **Frontend**: Phaser.js game engine + xterm.js terminal emulator, built with Vite
- **Backend**: Express.js + Socket.io (multiplayer + `/terminal` namespace for tmux bridge)
- **Sessions**: tmux-native — agents run as interactive Claude Code sessions in tmux panes
- **Session Map**: `~/.claude/teams/{team}/sessions.json` — maps members to tmux sessions + Claude session IDs
- **Auth**: passport-github2 OAuth, restricted via `ALLOWED_GITHUB_USERS` env var
- **No in-memory session state** — server restart doesn't lose sessions (tmux persists)
- **Repo**: digital-shokunin/gtgui

## Deployment
- Target: secunit server at 104.131.174.110
- Deploy: `rsync -avz --exclude node_modules --exclude .git . claude@secunit.droplets.digital-shokunin.net:/opt/gtgui/`
- After deploy: `ssh secunit sudo systemctl restart gtgui.service`
- Systemd services: `gtgui.service` (port 8080), `gt-dolt.service` (port 3307)
- PATH must include `/home/claude/go/bin` for gt/bd subprocesses

## Development Rules
- Run `npx vite build` before committing — catch build errors early
- Run Docker Playwright tests before PR: `docker compose -f docker-compose.test.yml up`
- xterm.js is code-split into a separate Vite chunk — don't bundle it into main
- GPG commits require Yubikey — confirm before committing

## Gas Town Integration
- `mayor/`, `deacon/` = system dirs (filter from rig list)
- Rigs detected by presence of `polecats/` subdirectory
- gt rejects hyphens, dots, spaces in rig names (underscores OK)
- Claude bypass warning: auto-accepted via tmux send-keys Down+Enter

## Container / Colony Details
- Image: `colony-sandbox` — `claude` user (uid 1000), writable `/workspace`
- Per-project host mounts: `~/projects/{teamName}` → `/workspace/{teamName}`
- Resource limits: 364MB / 0.25 CPUs on 2GB/1CPU box (auto-detected)
- Auto-update disabled: `CLAUDE_CODE_DISABLE_AUTO_UPDATE=1`

## Known Pain Points
- CSS alignment issues are recurring — use flexbox/grid consistently, test with long agent names
- Status badges can overflow containers — always verify with multiple states visible
- tmux sessions must match the terminal window size exactly
- SSH connections to secunit go stale — before deploying or running remote commands, check with `ssh -O check secunit 2>&1` and re-establish if needed (`ssh -O exit secunit 2>/dev/null; ssh -fN secunit`). Always do this proactively after idle periods.
