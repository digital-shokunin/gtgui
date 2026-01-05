# Gas Town UI

Age of Empires-style browser GUI for Gas Town multi-agent orchestration.

## Features

- **Isometric map view** - Your town rendered as an RTS game
- **Unit management** - Polecats displayed as selectable units with status indicators
- **Buildings** - Mayor HQ, Refinery, Rigs, Barracks
- **AoE-style HUD** - Resource bar, minimap, command panel
- **Real-time updates** - Polls Gas Town for state changes
- **Command integration** - Sling work, send mail, view hooks

## Quick Start

```bash
# Install dependencies
npm install

# Development mode (hot reload)
npm run dev

# Production build
npm run build

# Start production server (connects to local Gas Town)
npm run server
```

Open http://localhost:3000 in your browser.

## Controls

| Input | Action |
|-------|--------|
| **WASD / Arrows** | Pan camera |
| **Mouse wheel** | Zoom |
| **Right-drag** | Pan camera |
| **Left-click** | Select unit |
| **Left-drag** | Box select |
| **Right-click** | Issue command |

## Architecture

```
gastown-ui/
├── src/
│   ├── main.js           # Phaser game config
│   ├── scenes/
│   │   ├── BootScene.js  # Asset loading, sprite generation
│   │   ├── GameScene.js  # Isometric map, units, buildings
│   │   └── UIScene.js    # HUD overlay (resources, minimap, commands)
│   └── api/
│       └── GasTownAPI.js # REST client for server
├── server.js             # Express server bridging to gt CLI
└── public/assets/        # Static assets (sprites, tiles, audio)
```

## API Server

The server bridges browser requests to `gt` CLI commands:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/status` | GET | Overall town status |
| `/api/rigs` | GET | List rigs |
| `/api/rigs/:name/polecats` | GET | Polecats for a rig |
| `/api/convoys` | GET | List convoys |
| `/api/sling` | POST | Sling work to agent |
| `/api/mail/send` | POST | Send mail |
| `/api/agents/:id/hook` | GET | Agent's current hook |
| `/api/agents/:id/stop` | POST | Emergency stop |
| `/api/feed` | GET | SSE activity feed |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 8080 | Server port |
| `GT_PATH` | `~/go/bin/gt` | Path to gt binary |
| `TOWN_ROOT` | `~/gt` | Gas Town workspace root |

## Status Indicators

**Units:**
- 🔵 Blue - Idle polecat
- 🟢 Green - Working polecat
- 🔴 Red - Stuck/error
- 🟡 Gold - Mayor
- 🟣 Purple - Deacon
- 🟠 Orange - Refinery

**Buildings:**
- Town Hall - Mayor HQ (central command)
- Refinery - Merge queue processor
- Barracks - Polecat spawner
- Rig - Project workspace
