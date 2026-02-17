# GTGUI Deployment Guide

Deploy the Gas Town GUI (GTGUI) — a Phaser.js multiplayer dashboard for managing Gastown agent swarms.

## Prerequisites

- **Server**: Ubuntu/Debian Linux (tested on Ubuntu 22.04, DigitalOcean droplet)
- **Node.js**: v20+ (`apt install nodejs npm` or use nvm)
- **Go**: 1.24+ (for building `gt` and `beads`)
- **tmux**: 3.0+ (`apt install tmux`)
- **Git**: 2.0+
- **Caddy**: v2 (reverse proxy + automatic HTTPS)
- **GitHub OAuth App**: Create at https://github.com/settings/developers

## 1. Server Setup

```bash
# Create service user
sudo useradd -m -s /bin/bash claude
sudo usermod -aG sudo claude
su - claude

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install tmux
sudo apt install -y tmux

# Install Go (for gt/beads)
wget https://go.dev/dl/go1.24.2.linux-amd64.tar.gz
sudo tar -C /usr/local -xzf go1.24.2.linux-amd64.tar.gz
echo 'export PATH=$PATH:/usr/local/go/bin:$HOME/go/bin' >> ~/.bashrc
source ~/.bashrc
```

## 2. Install Gastown (gt + beads)

```bash
# Clone and build gastown
git clone https://github.com/steveyegge/gastown.git ~/gastown-src
cd ~/gastown-src
make build
# This installs gt and bd (beads) to ~/go/bin/

# Verify
gt --version
bd --version

# Initialize a Gas Town workspace
mkdir -p ~/gt
cd ~/gt
git init
gt init  # or manually create the workspace structure
```

## 3. Install GTGUI

```bash
# Clone the repo
sudo mkdir -p /opt/gtgui
sudo chown claude:claude /opt/gtgui
git clone https://github.com/digital-shokunin/gtgui.git /opt/gtgui
cd /opt/gtgui

# Install dependencies
npm ci

# Build frontend
npm run build
```

## 4. GitHub OAuth App

1. Go to https://github.com/settings/developers
2. Click "New OAuth App"
3. Set:
   - **Application name**: Gas Town GUI
   - **Homepage URL**: `https://your-domain.example.com`
   - **Authorization callback URL**: `https://your-domain.example.com/auth/github/callback`
4. Note the **Client ID** and generate a **Client Secret**

## 5. Systemd Service

Create `/etc/systemd/system/gtgui.service`:

```ini
[Unit]
Description=Gas Town GUI (GTGUI)
After=network.target

[Service]
Type=simple
User=claude
Group=claude
WorkingDirectory=/opt/gtgui
Environment=PORT=8080
Environment=PATH=/home/claude/go/bin:/home/claude/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Environment=GT_PATH=/home/claude/go/bin/gt
Environment=TOWN_ROOT=/home/claude/gt
Environment=NODE_ENV=production
Environment=GITHUB_CLIENT_ID=<your-client-id>
Environment=GITHUB_CLIENT_SECRET=<your-client-secret>
Environment=CALLBACK_URL=https://your-domain.example.com/auth/github/callback
Environment=SESSION_SECRET=<generate-with-openssl-rand-hex-32>
Environment=ALLOWED_GITHUB_USERS=<comma-separated-github-usernames>
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

**Important environment variables:**

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (default: 8080) |
| `GT_PATH` | Yes | Absolute path to `gt` binary |
| `TOWN_ROOT` | Yes | Path to Gas Town workspace (default: `~/gt`) |
| `NODE_ENV` | Yes | Set to `production` to disable dev login |
| `GITHUB_CLIENT_ID` | Yes | GitHub OAuth app client ID |
| `GITHUB_CLIENT_SECRET` | Yes | GitHub OAuth app client secret |
| `CALLBACK_URL` | Yes | Full OAuth callback URL |
| `SESSION_SECRET` | Yes | Random secret for session cookies |
| `ALLOWED_GITHUB_USERS` | No | Comma-separated GitHub usernames. Empty = allow all |
| `PATH` | Yes | Must include directories containing `gt` and `bd` binaries |

Generate a session secret:
```bash
openssl rand -hex 32
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable gtgui
sudo systemctl start gtgui
sudo systemctl status gtgui
```

## 6. Caddy Reverse Proxy

Install Caddy:
```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy
```

Configure `/etc/caddy/Caddyfile`:
```
your-domain.example.com {
    reverse_proxy localhost:8080
}
```

```bash
sudo systemctl reload caddy
```

Caddy automatically provisions HTTPS via Let's Encrypt.

## 7. Register Rigs

Rigs are projects that polecats (worker agents) can be assigned to. Register them either via the GTGUI "New Project" button or CLI:

```bash
cd ~/gt
gt rig add my-project git@github.com:user/repo.git
gt rig add another-project https://github.com/user/other-repo.git
```

Verify:
```bash
gt rig list
```

**Without registered rigs, `gt sling` cannot dispatch work to polecats.**

## 8. Verify Deployment

```bash
# Check service is running
systemctl is-active gtgui

# Check logs
journalctl -u gtgui -f

# Test API
curl -s http://localhost:8080/api/status | jq .
curl -s http://localhost:8080/api/rigs | jq .

# Check gt can find bd
GT_PATH=/home/claude/go/bin/gt
PATH=/home/claude/go/bin:$PATH $GT_PATH rig list
```

Visit `https://your-domain.example.com` and sign in with GitHub.

## Running Tests

Tests use Docker + Playwright:

```bash
cd /opt/gtgui
docker compose -f docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from test
```

This spins up a containerized GTGUI with a mock `gt` binary and runs 20 Playwright tests.

## Updating

```bash
cd /opt/gtgui
git pull
npm ci
npm run build
sudo systemctl restart gtgui
```

## Troubleshooting

### "No rigs configured" / polecats stuck with no session
- Run `gt rig list` — if empty, register rigs with `gt rig add`
- Check `~/gt/mayor/rigs.json` — should have entries

### gt/bd commands not found by service
- Ensure `PATH` in systemd service includes `/home/claude/go/bin`
- Run `sudo systemctl daemon-reload && sudo systemctl restart gtgui`

### GitHub OAuth login denied
- Check `ALLOWED_GITHUB_USERS` in systemd service
- Usernames are case-insensitive, comma-separated
- Empty value = allow all GitHub users

### tmux sessions not starting
- Verify tmux is installed: `tmux -V`
- Check gt can start sessions: `cd ~/gt && gt session start <rig>/<polecat>`
- Check journal logs: `journalctl -u gtgui -n 50`

### Cookie/session issues behind reverse proxy
- Ensure `app.set('trust proxy', 1)` is in server.js
- Caddy handles TLS termination; Express needs to trust the proxy for secure cookies
