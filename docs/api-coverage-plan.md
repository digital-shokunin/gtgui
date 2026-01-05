# Gas Town UI - API Coverage Plan

## Current State vs Required Workflows

### Core Gas Town Workflows (from docs)

1. **Convoy Management** (Primary Dashboard)
   - `gt convoy list` - Main view
   - `gt convoy status <id>` - Details
   - `gt convoy create "name" <issues...>` - Create tracking

2. **Work Dispatch**
   - `gt sling <issue> <rig>` - Assign work to polecat

3. **Communication**
   - `gt mail inbox` - Check messages
   - `gt mail read <id>` - Read message
   - `gt mail send <addr> -s "..." -m "..."` - Send
   - `gt nudge <agent> "message"` - Direct to tmux

4. **Escalation**
   - `gt escalate "message"` - Standard
   - `gt escalate -s CRITICAL "msg"` - Severity levels
   - `gt escalate --type decision "question"` - Decision requests

5. **Session Management**
   - `gt start` - Start daemon + Mayor
   - `gt shutdown` - Graceful stop
   - `gt agents` - List all sessions
   - `gt peek <agent>` - View agent output
   - `gt hook` - What's on hook

6. **Health & Diagnostics**
   - `gt doctor` - Health check
   - `gt status` - Town overview
   - `gt costs` - Running costs

---

## API Coverage Audit

| Workflow | gt Command | API Endpoint | Status |
|----------|------------|--------------|--------|
| **Convoy** | | | |
| List convoys | `gt convoy list` | GET /api/convoys | ✅ |
| Convoy details | `gt convoy status <id>` | GET /api/convoys/:id | ✅ |
| Create convoy | `gt convoy create` | POST /api/convoys | ❌ MISSING |
| **Work Dispatch** | | | |
| Sling work | `gt sling <issue> <rig>` | POST /api/sling | ⚠️ WRONG SYNTAX |
| **Communication** | | | |
| Send mail | `gt mail send` | POST /api/mail/send | ✅ |
| Check inbox | `gt mail inbox` | GET /api/mail/inbox | ❌ MISSING |
| Read mail | `gt mail read <id>` | GET /api/mail/:id | ❌ MISSING |
| Nudge agent | `gt nudge` | POST /api/nudge | ❌ MISSING |
| **Escalation** | | | |
| Escalate | `gt escalate` | POST /api/escalate | ❌ MISSING |
| List escalations | - | GET /api/escalations | ❌ MISSING |
| **Sessions** | | | |
| Start town | `gt start` | POST /api/town/start | ❌ MISSING |
| Shutdown | `gt shutdown` | POST /api/town/shutdown | ❌ MISSING |
| List agents | `gt agents` | GET /api/agents | ❌ MISSING |
| Peek agent | `gt peek <agent>` | GET /api/agents/:id/peek | ❌ MISSING |
| Agent hook | `gt hook` | GET /api/agents/:id/hook | ✅ |
| Stop agent | `gt stop` | POST /api/agents/:id/stop | ✅ |
| **Diagnostics** | | | |
| Doctor | `gt doctor` | GET /api/doctor | ❌ MISSING |
| Status | `gt status` | GET /api/status | ⚠️ PARTIAL |
| Costs | `gt costs` | GET /api/costs | ✅ |
| Feed | `gt feed` | GET /api/feed (SSE) | ✅ |
| **Issues (bd)** | | | |
| List issues | `bd list` | GET /api/issues | ❌ MISSING |
| Create issue | `bd create` | POST /api/issues | ❌ MISSING |

---

## Priority Implementation Order

### P0 - Core Tutorial Flow (Required for tutorial)
1. ✅ GET /api/convoys - List convoys
2. ❌ POST /api/convoys - Create convoy
3. ⚠️ POST /api/sling - Fix syntax
4. ❌ GET /api/agents - List agents/sessions
5. ❌ GET /api/doctor - Health check

### P1 - Communication (Essential for coordination)
6. ❌ GET /api/mail/inbox - Check messages
7. ❌ GET /api/mail/:id - Read message
8. ❌ POST /api/nudge - Direct message

### P2 - Escalation (For stuck workflows)
9. ❌ POST /api/escalate - Create escalation
10. ❌ GET /api/escalations - List pending

### P3 - Full Management
11. ❌ POST /api/town/start
12. ❌ POST /api/town/shutdown
13. ❌ GET /api/agents/:id/peek
14. ❌ GET /api/issues
15. ❌ POST /api/issues

---

## Tutorial Flow Design

### Stage 1: "Your First Convoy"
1. Show empty town state
2. User clicks "Create Convoy" → calls POST /api/convoys
3. System creates convoy, shows on map as "rally point"
4. Tutorial highlights the new convoy marker

### Stage 2: "Dispatch a Worker"
1. Show available issues (from bd list)
2. User drags issue to convoy OR clicks "Sling Work"
3. System spawns polecat, shows unit on map
4. Polecat animates to work location

### Stage 3: "Monitor Progress"
1. Show convoy dashboard view
2. Real-time updates via SSE feed
3. Unit status changes (idle → working)
4. Progress bar fills as issues close

### Stage 4: "Handle Escalation"
1. Simulate stuck worker
2. Show escalation notification
3. User resolves decision
4. Work resumes

### Stage 5: "Convoy Lands"
1. All issues complete
2. Convoy closes automatically
3. Celebration animation
4. "You're ready to command Gas Town!"

---

## Sling Command Fix

Current (WRONG):
```javascript
gt(`sling ${issue} --to ${agent}`)
```

Correct:
```javascript
gt(`sling ${issue} ${rig}`)
```

The `gt sling` command takes:
- `<issue>` - The issue ID to assign
- `<rig>` - The rig name (project) to dispatch to

Gas Town automatically picks an available polecat in that rig.
