import express from 'express'
import cors from 'cors'
import { createServer } from 'http'
import { execSync, exec } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs'
import { setupAuth, getSessionMiddleware } from './src/server/auth.js'
import { MultiplayerServer } from './src/server/multiplayer.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const app = express()
const httpServer = createServer(app)

app.use(cors({
  origin: true,
  credentials: true
}))

// Only parse JSON for API routes
app.use('/api', express.json({ limit: '1mb' }))
app.use('/auth', express.json())

// Setup authentication
const sessionMiddleware = getSessionMiddleware()
app.use(sessionMiddleware)
const { users: authUsers } = setupAuth(app)

// Setup multiplayer WebSocket
const multiplayer = new MultiplayerServer(httpServer, sessionMiddleware)

const GT_PATH = process.env.GT_PATH || '/opt/homebrew/bin/gt'
const TOWN_ROOT = process.env.TOWN_ROOT || `${process.env.HOME}/gt`

// Settings storage
const SETTINGS_FILE = join(TOWN_ROOT, 'settings.json')
const DEFAULT_SETTINGS = {
  stuckTokenThreshold: 25000,      // tokens before marked stuck
  stuckTimeThreshold: 1800000,     // 30 minutes in ms
  warningTokenThreshold: 20000,    // 80% - yellow warning
  warningTimeThreshold: 1440000,   // 24 minutes - 80%
  enableSounds: true,
  enableNotifications: true,
  tokenCostRate: 0.003             // $ per 1000 tokens (default Claude rate)
}

// ===== ACTIVITY FEED =====
const ACTIVITY_FEED_FILE = join(TOWN_ROOT, 'activity_feed.json')
const MAX_FEED_EVENTS = 100
let activityFeed = []

function loadActivityFeed() {
  try {
    if (existsSync(ACTIVITY_FEED_FILE)) {
      const content = readFileSync(ACTIVITY_FEED_FILE, 'utf-8')
      activityFeed = JSON.parse(content)
    }
  } catch (e) {
    console.error('Failed to load activity feed:', e.message)
    activityFeed = []
  }
}

function saveActivityFeed() {
  try {
    const dir = dirname(ACTIVITY_FEED_FILE)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(ACTIVITY_FEED_FILE, JSON.stringify(activityFeed, null, 2))
  } catch (e) {
    console.error('Failed to save activity feed:', e.message)
  }
}

function addActivityEvent(type, data, user = null) {
  const event = {
    id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    type,
    timestamp: new Date().toISOString(),
    user: user || 'system',
    ...data
  }

  activityFeed.unshift(event)

  // Keep only last MAX_FEED_EVENTS
  if (activityFeed.length > MAX_FEED_EVENTS) {
    activityFeed = activityFeed.slice(0, MAX_FEED_EVENTS)
  }

  saveActivityFeed()

  // Broadcast to all connected clients
  multiplayer.broadcastFeedEvent(event)

  return event
}

// Load activity feed on startup
loadActivityFeed()

// ===== TASK QUEUE =====
const TASK_QUEUE_FILE = join(TOWN_ROOT, 'task_queue.json')
let taskQueue = []

function loadTaskQueue() {
  try {
    if (existsSync(TASK_QUEUE_FILE)) {
      const content = readFileSync(TASK_QUEUE_FILE, 'utf-8')
      taskQueue = JSON.parse(content)
    }
  } catch (e) {
    console.error('Failed to load task queue:', e.message)
    taskQueue = []
  }
}

function saveTaskQueue() {
  try {
    const dir = dirname(TASK_QUEUE_FILE)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(TASK_QUEUE_FILE, JSON.stringify(taskQueue, null, 2))
  } catch (e) {
    console.error('Failed to save task queue:', e.message)
  }
}

// Load task queue on startup
loadTaskQueue()

// ===== COST TRACKING =====
const COST_FILE = join(TOWN_ROOT, 'cost_history.json')
let costHistory = { daily: {}, byAgent: {}, byProject: {} }

function loadCostHistory() {
  try {
    if (existsSync(COST_FILE)) {
      const content = readFileSync(COST_FILE, 'utf-8')
      costHistory = JSON.parse(content)
    }
  } catch (e) {
    console.error('Failed to load cost history:', e.message)
    costHistory = { daily: {}, byAgent: {}, byProject: {} }
  }
}

function saveCostHistory() {
  try {
    const dir = dirname(COST_FILE)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(COST_FILE, JSON.stringify(costHistory, null, 2))
  } catch (e) {
    console.error('Failed to save cost history:', e.message)
  }
}

function recordTokenUsage(agent, project, tokens) {
  const today = new Date().toISOString().split('T')[0]

  // Daily totals
  if (!costHistory.daily[today]) {
    costHistory.daily[today] = 0
  }
  costHistory.daily[today] += tokens

  // By agent
  if (!costHistory.byAgent[agent]) {
    costHistory.byAgent[agent] = { total: 0, daily: {} }
  }
  costHistory.byAgent[agent].total += tokens
  if (!costHistory.byAgent[agent].daily[today]) {
    costHistory.byAgent[agent].daily[today] = 0
  }
  costHistory.byAgent[agent].daily[today] += tokens

  // By project
  if (!costHistory.byProject[project]) {
    costHistory.byProject[project] = { total: 0, daily: {} }
  }
  costHistory.byProject[project].total += tokens
  if (!costHistory.byProject[project].daily[today]) {
    costHistory.byProject[project].daily[today] = 0
  }
  costHistory.byProject[project].daily[today] += tokens

  saveCostHistory()
}

// Load cost history on startup
loadCostHistory()

// Load settings from file or use defaults
function loadSettings() {
  try {
    if (existsSync(SETTINGS_FILE)) {
      const content = readFileSync(SETTINGS_FILE, 'utf-8')
      return { ...DEFAULT_SETTINGS, ...JSON.parse(content) }
    }
  } catch (e) {
    console.error('Failed to load settings:', e.message)
  }
  return { ...DEFAULT_SETTINGS }
}

// Save settings to file
function saveSettings(settings) {
  try {
    const dir = dirname(SETTINGS_FILE)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2))
    return true
  } catch (e) {
    console.error('Failed to save settings:', e.message)
    return false
  }
}

let currentSettings = loadSettings()

// Check for stuck agents based on token and time thresholds
function checkForStuckAgents() {
  const now = Date.now()
  const rigs = listRigs()
  const notifications = []

  for (const rig of rigs) {
    const polecatsPath = join(TOWN_ROOT, rig.name, 'polecats')

    try {
      const dirs = execSync(`ls -1 "${polecatsPath}" 2>/dev/null || true`, {
        encoding: 'utf-8'
      }).trim()

      if (!dirs) continue

      for (const name of dirs.split('\n').filter(Boolean)) {
        const statusFile = join(polecatsPath, name, 'status.json')

        try {
          if (!existsSync(statusFile)) continue

          const content = readFileSync(statusFile, 'utf-8')
          const status = JSON.parse(content)

          // Only check working agents
          if (status.status !== 'working') continue

          const assignedAt = status.assignedAt ? new Date(status.assignedAt).getTime() : now
          const elapsed = now - assignedAt
          const tokensUsed = status.tokensUsed || 0

          // Check if session is actually alive
          const sessionAlive = isSessionAlive(rig.name, name)

          // Check if either threshold exceeded, or session died
          const timeExceeded = elapsed > currentSettings.stuckTimeThreshold
          const tokensExceeded = tokensUsed > currentSettings.stuckTokenThreshold
          const sessionDead = !sessionAlive && elapsed > 10000  // Give 10s grace period for startup

          if (timeExceeded || tokensExceeded || sessionDead) {
            // Mark as stuck
            status.status = 'stuck'
            status.stuckReason = sessionDead ? 'session_dead' : (timeExceeded ? 'time' : 'tokens')
            status.stuckAt = new Date().toISOString()
            writeFileSync(statusFile, JSON.stringify(status, null, 2))

            notifications.push({
              type: 'stuck',
              agent: name,
              rig: rig.name,
              reason: status.stuckReason,
              elapsed,
              tokensUsed,
              message: sessionDead
                ? `${name} session died (no tmux session found)`
                : timeExceeded
                  ? `${name} has been working for over ${Math.round(elapsed / 60000)} minutes`
                  : `${name} has used over ${tokensUsed.toLocaleString()} tokens`
            })

            // Add to activity feed
            addActivityEvent('agent_stuck', {
              agent: name,
              rig: rig.name,
              reason: status.stuckReason,
              elapsed,
              tokensUsed
            })
          }
          // Check for warning thresholds (80%)
          else {
            const timeWarning = elapsed > currentSettings.warningTimeThreshold
            const tokenWarning = tokensUsed > currentSettings.warningTokenThreshold

            if ((timeWarning || tokenWarning) && !status.warningNotified) {
              status.warningNotified = true
              writeFileSync(statusFile, JSON.stringify(status, null, 2))

              notifications.push({
                type: 'warning',
                agent: name,
                rig: rig.name,
                elapsed,
                tokensUsed,
                message: `${name} is approaching limits (${Math.round(elapsed / 60000)}min / ${tokensUsed} tokens)`
              })
            }
          }
        } catch (e) {
          // Parse error, skip this polecat
        }
      }
    } catch (e) {
      // No polecats directory
    }
  }

  // Broadcast notifications
  for (const notification of notifications) {
    multiplayer.broadcastNotification(notification)
  }

  return notifications
}

// Run stuck detection every 30 seconds
setInterval(checkForStuckAgents, 30000)

// Helper to run gt commands
function gt(args, cwd = TOWN_ROOT) {
  try {
    const result = execSync(`${GT_PATH} ${args}`, {
      cwd,
      encoding: 'utf-8',
      timeout: 30000,
      shell: true,  // Use default shell
      env: { ...process.env, GT_TOWN_ROOT: TOWN_ROOT }
    })
    return result
  } catch (e) {
    console.error(`gt ${args} failed:`, e.message)
    return null
  }
}

// Parse agent ID string into { rigName, polecatName } — searches all rigs if needed
function parseAgentId(agentId) {
  const parts = agentId.split('/')
  let rigName, polecatName
  if (parts.length >= 3) {
    rigName = parts[0]
    polecatName = parts[parts.length - 1]
  } else {
    polecatName = agentId
    // Search all rigs for this polecat
    const rigs = listRigs()
    for (const rig of rigs) {
      const statusPath = join(TOWN_ROOT, rig.name, 'polecats', polecatName, 'status.json')
      if (existsSync(statusPath)) {
        rigName = rig.name
        break
      }
    }
  }
  return { rigName, polecatName }
}

// Check if a tmux session is alive for a given rig/polecat
function isSessionAlive(rigName, polecatName) {
  try {
    const result = gt(`session status ${rigName}/${polecatName} --json`)
    if (result) {
      const parsed = JSON.parse(result)
      return parsed.running === true || parsed.alive === true
    }
  } catch {
    // Fallback: check tmux directly
    try {
      execSync(`tmux has-session -t "${polecatName}" 2>/dev/null`, {
        encoding: 'utf-8',
        timeout: 5000,
        shell: true
      })
      return true
    } catch {
      return false
    }
  }
  return false
}

// Parse JSON output from gt commands
function gtJson(args, cwd = TOWN_ROOT) {
  const result = gt(`${args} --json`, cwd)
  if (!result) return null
  try {
    return JSON.parse(result)
  } catch {
    return null
  }
}

// Helper to list rigs from directory
function listRigs() {
  try {
    const dirs = execSync(`ls -1 "${TOWN_ROOT}" 2>/dev/null || true`, {
      encoding: 'utf-8'
    }).trim()

    if (!dirs) return []

    // Filter to only directories that look like rigs (not hidden, not special)
    const rigs = []
    for (const name of dirs.split('\n').filter(Boolean)) {
      if (name.startsWith('.') || name === 'plugins' || name === 'settings') continue
      const rigPath = join(TOWN_ROOT, name)
      try {
        const stat = execSync(`test -d "${rigPath}" && echo "dir" || echo "file"`, {
          encoding: 'utf-8'
        }).trim()
        if (stat === 'dir') {
          rigs.push({ name, path: rigPath })
        }
      } catch (e) {
        // Skip
      }
    }
    return rigs
  } catch (e) {
    return []
  }
}

// GET /api/config - Client configuration (production flag, etc.)
app.get('/api/config', (req, res) => {
  res.json({
    production: process.env.NODE_ENV === 'production',
    version: '1.0.0'
  })
})

// GET /api/status - Overall town status
app.get('/api/status', (req, res) => {
  const status = {}

  // Get rig list from directory
  const rigs = listRigs()
  status.rigs = rigs

  // Get convoy status (skip if gt doesn't support it)
  status.activeConvoys = 0
  status.convoys = []

  // Get polecats across all rigs
  status.polecats = []
  for (const rig of rigs) {
    const polecats = getPolecatsForRig(rig.name)
    status.polecats.push(...polecats)
  }

  // Placeholder for tokens (would come from costs)
  status.tokens = 0
  status.openIssues = status.polecats.filter(p => p.status === 'stuck').length

  // Broadcast state update to connected clients
  multiplayer.broadcastStateUpdate(status)

  res.json(status)
})

// GET /api/rigs - List all rigs
app.get('/api/rigs', (req, res) => {
  const rigs = listRigs()
  res.json(rigs)
})

// POST /api/rigs - Create a new rig
app.post('/api/rigs', (req, res) => {
  const { name } = req.body
  if (!name) {
    return res.status(400).json({ error: 'Rig name required' })
  }

  // Validate name (alphanumeric, dashes, underscores only)
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    return res.status(400).json({ error: 'Invalid rig name. Use alphanumeric, dashes, or underscores.' })
  }

  // Create rig directory (gt rig create doesn't exist, so we just mkdir)
  const rigPath = join(TOWN_ROOT, name)
  try {
    execSync(`mkdir -p "${rigPath}"`, { encoding: 'utf-8', shell: true })
    // Broadcast new rig to all connected users
    multiplayer.broadcastStateUpdate({ event: 'rig:created', rig: name })

    // Add to activity feed
    addActivityEvent('project_created', {
      project: name
    }, req.session?.passport?.user)

    res.json({ success: true, name })
  } catch (e) {
    console.error('Failed to create rig:', e.message)
    res.status(500).json({ error: 'Failed to create rig' })
  }
})

// POST /api/rigs/:name/clone - Clone a repo into a rig
app.post('/api/rigs/:name/clone', (req, res) => {
  const { name } = req.params
  const { repo, branch } = req.body

  if (!repo) {
    return res.status(400).json({ error: 'Repository URL required' })
  }

  // Extract repo name from URL for subdirectory
  const repoName = repo.split('/').pop().replace('.git', '') || 'repo'

  // Ensure rig directory exists
  const rigPath = join(TOWN_ROOT, name)
  const clonePath = join(rigPath, repoName)

  try {
    execSync(`mkdir -p "${rigPath}"`, { encoding: 'utf-8', shell: true })
  } catch (e) {
    console.error('Failed to create rig directory:', e.message)
    return res.status(500).json({ error: 'Failed to create rig directory' })
  }

  // Check if clone path already exists
  try {
    const exists = execSync(`test -d "${clonePath}" && echo "exists" || echo "no"`, {
      encoding: 'utf-8',
      shell: true
    }).trim()

    if (exists === 'exists') {
      // Directory exists - check if it's a git repo and pull instead
      try {
        execSync(`cd "${clonePath}" && git pull`, {
          encoding: 'utf-8',
          timeout: 60000,
          shell: true
        })
        multiplayer.broadcastStateUpdate({ event: 'repo:updated', rig: name, repo })
        return res.json({ success: true, repo, action: 'pulled' })
      } catch (pullErr) {
        // Pull failed, remove and re-clone
        execSync(`rm -rf "${clonePath}"`, { encoding: 'utf-8', shell: true })
      }
    }
  } catch (e) {
    // Directory doesn't exist, proceed with clone
  }

  // Try gt clone first, fallback to git clone
  const branchArg = branch ? `--branch ${branch}` : ''
  let result = gt(`clone ${repo} ${branchArg}`, rigPath)

  // Fallback to direct git clone if gt clone fails
  if (result === null) {
    try {
      const gitBranchArg = branch ? `-b ${branch}` : ''
      result = execSync(`git clone ${gitBranchArg} "${repo}"`, {
        cwd: rigPath,
        encoding: 'utf-8',
        timeout: 120000,  // 2 min timeout for large repos
        shell: true
      })
    } catch (e) {
      console.error('Git clone failed:', e.message)
      return res.status(500).json({ error: `Failed to clone: ${e.message}` })
    }
  }

  multiplayer.broadcastStateUpdate({ event: 'repo:cloned', rig: name, repo })

  // Add to activity feed
  addActivityEvent('repo_cloned', {
    project: name,
    repo
  }, req.session?.passport?.user)

  res.json({ success: true, repo })
})

// POST /api/rigs/:name/polecats - Spawn a new polecat in a rig
app.post('/api/rigs/:name/polecats', (req, res) => {
  const { name } = req.params
  const { polecatName } = req.body

  const pcName = polecatName || `polecat-${Date.now()}`
  const rigPath = join(TOWN_ROOT, name)
  const polecatPath = join(rigPath, 'polecats', pcName)

  // Create polecat directory (gt polecat spawn doesn't exist)
  try {
    // Create polecat directory and status file
    if (!existsSync(polecatPath)) {
      mkdirSync(polecatPath, { recursive: true })
    }
    const initialStatus = {
      status: 'idle',
      created: new Date().toISOString()
    }
    writeFileSync(join(polecatPath, 'status.json'), JSON.stringify(initialStatus, null, 2))
    multiplayer.broadcastStateUpdate({ event: 'polecat:spawned', rig: name, polecat: pcName })

    // Add to activity feed
    addActivityEvent('agent_spawned', {
      agent: pcName,
      rig: name
    }, req.session?.passport?.user)

    res.json({ success: true, name: pcName })
  } catch (e) {
    console.error('Failed to spawn polecat:', e.message)
    res.status(500).json({ error: 'Failed to spawn polecat' })
  }
})

// GET /api/rigs/:name/polecats - Get polecats for a rig
app.get('/api/rigs/:name/polecats', (req, res) => {
  const polecats = getPolecatsForRig(req.params.name)
  res.json(polecats)
})

// DELETE /api/rigs/:name - Delete a rig (for testing cleanup)
app.delete('/api/rigs/:name', (req, res) => {
  const { name } = req.params

  // Safety check - only allow deletion of test rigs
  if (!name.startsWith('test-')) {
    return res.status(403).json({ error: 'Can only delete test rigs (prefix: test-)' })
  }

  const rigPath = join(TOWN_ROOT, name)

  try {
    if (existsSync(rigPath)) {
      execSync(`rm -rf "${rigPath}"`, { encoding: 'utf-8', shell: true })
      multiplayer.broadcastStateUpdate({ event: 'rig:deleted', rig: name })
      res.json({ success: true, deleted: name })
    } else {
      res.status(404).json({ error: 'Rig not found' })
    }
  } catch (e) {
    console.error('Failed to delete rig:', e.message)
    res.status(500).json({ error: 'Failed to delete rig' })
  }
})

// GET /api/convoys - List convoys
app.get('/api/convoys', (req, res) => {
  const convoys = gtJson('convoy list --all') || []
  res.json(convoys)
})

// GET /api/convoys/:id - Convoy details
app.get('/api/convoys/:id', (req, res) => {
  const status = gtJson(`convoy status ${req.params.id}`)
  if (status) {
    res.json(status)
  } else {
    res.status(404).json({ error: 'Convoy not found' })
  }
})

// POST /api/sling - Sling work to agent (calls real gt sling to start Claude session)
app.post('/api/sling', (req, res) => {
  const { agent, issue } = req.body
  if (!agent || !issue) {
    return res.status(400).json({ error: 'Missing agent or issue' })
  }

  // Parse agent path (e.g., "rigname/polecats/polecatname" or just "polecatname")
  const parts = agent.split('/')
  let rigName, polecatName
  if (parts.length >= 3) {
    rigName = parts[0]
    polecatName = parts[parts.length - 1]
  } else {
    polecatName = agent
    rigName = 'default'
  }

  // Write status immediately so UI reflects the change
  const statusPath = join(TOWN_ROOT, rigName, 'polecats', polecatName, 'status.json')
  const statusDir = dirname(statusPath)
  if (!existsSync(statusDir)) {
    mkdirSync(statusDir, { recursive: true })
  }

  const status = {
    status: 'working',
    issue: issue,
    assignedAt: new Date().toISOString(),
    progress: 0
  }
  writeFileSync(statusPath, JSON.stringify(status, null, 2))

  // Call real gt sling to dispatch work and start a Claude session
  // gt sling handles: session start, convoy creation, Claude invocation, task injection
  // Escape the issue text for shell safety
  const escapedIssue = issue.replace(/"/g, '\\"').replace(/\$/g, '\\$')
  const slingResult = gt(`sling "${escapedIssue}" ${rigName}`)

  if (slingResult === null) {
    // gt sling failed — try starting a session directly as fallback
    console.warn(`gt sling failed for ${rigName}, attempting gt session start as fallback`)
    const sessionResult = gt(`session start ${rigName}/${polecatName}`)
    if (sessionResult === null) {
      console.error(`Both gt sling and gt session start failed for ${rigName}/${polecatName}`)
      // Status is already written, so UI shows "working" — mark the issue
      status.slingError = 'gt sling and session start both failed'
      writeFileSync(statusPath, JSON.stringify(status, null, 2))
    }
  }

  // Broadcast status update
  multiplayer.broadcastStateUpdate({
    event: 'polecat:working',
    rig: rigName,
    polecat: polecatName,
    issue: issue
  })

  // Add to activity feed
  addActivityEvent('task_assigned', {
    task: issue,
    agent: polecatName,
    rig: rigName
  }, req.session?.passport?.user)

  res.json({ success: true, message: `Assigned ${issue} to ${polecatName}`, status })
})

// POST /api/mail/send - Send mail
app.post('/api/mail/send', (req, res) => {
  const { to, subject, message } = req.body
  if (!to || !message) {
    return res.status(400).json({ error: 'Missing recipient or message' })
  }

  const subjectArg = subject ? `-s "${subject}"` : ''
  const result = gt(`mail send ${to} ${subjectArg} -m "${message}"`)
  if (result !== null) {
    res.json({ success: true })
  } else {
    res.status(500).json({ error: 'Mail send failed' })
  }
})

// GET /api/agents/:id/hook - Get agent's current task/status
app.get('/api/agents/:id/hook', (req, res) => {
  // Parse agent ID - could be "rig/polecats/name" or just "name"
  const agentId = req.params.id
  const parts = agentId.split('/')

  let rigName, polecatName
  if (parts.length >= 3) {
    rigName = parts[0]
    polecatName = parts[parts.length - 1]
  } else {
    polecatName = agentId
    // Search all rigs for this polecat
    const rigs = listRigs()
    for (const rig of rigs) {
      const statusPath = join(TOWN_ROOT, rig.name, 'polecats', polecatName, 'status.json')
      if (existsSync(statusPath)) {
        try {
          const content = readFileSync(statusPath, 'utf-8')
          const status = JSON.parse(content)
          res.json({
            hook: status.issue || status.task || null,
            status: status.status,
            assignedAt: status.assignedAt,
            progress: status.progress || 0
          })
          return
        } catch (e) {
          // Parse error, continue
        }
      }
    }
    res.json({ hook: null, status: 'unknown' })
    return
  }

  // Read status from file
  const statusPath = join(TOWN_ROOT, rigName, 'polecats', polecatName, 'status.json')
  if (existsSync(statusPath)) {
    try {
      const content = readFileSync(statusPath, 'utf-8')
      const status = JSON.parse(content)
      res.json({
        hook: status.issue || status.task || null,
        status: status.status,
        assignedAt: status.assignedAt,
        progress: status.progress || 0,
        tokensUsed: status.tokensUsed || 0,
        stuckReason: status.stuckReason || null,
        stuckAt: status.stuckAt || null,
        completedTask: status.completedTask || null,
        completedAt: status.completedAt || null
      })
    } catch (e) {
      res.json({ hook: null, status: 'idle' })
    }
  } else {
    res.json({ hook: null, status: 'idle' })
  }
})

// GET /api/agents/:id/logs - Get captured session output
app.get('/api/agents/:id/logs', (req, res) => {
  const { rigName, polecatName } = parseAgentId(req.params.id)
  const lines = parseInt(req.query.lines) || 100

  if (!rigName) {
    return res.status(404).json({ error: 'Agent not found', logs: '', sessionActive: false })
  }

  // Capture session output via gt session capture
  const captured = gt(`session capture ${rigName}/${polecatName} -n ${lines}`)
  const sessionActive = isSessionAlive(rigName, polecatName)

  // Also read status for context
  let status = {}
  const statusPath = join(TOWN_ROOT, rigName, 'polecats', polecatName, 'status.json')
  if (existsSync(statusPath)) {
    try {
      status = JSON.parse(readFileSync(statusPath, 'utf-8'))
    } catch { /* ignore */ }
  }

  res.json({
    logs: captured || '(No session output available)',
    sessionActive,
    status: status.status || 'unknown',
    task: status.issue || status.task || null,
    tokensUsed: status.tokensUsed || 0,
    rig: rigName,
    polecat: polecatName
  })
})

// GET /api/agents/:id/logs/stream - SSE stream of live session output
app.get('/api/agents/:id/logs/stream', (req, res) => {
  const { rigName, polecatName } = parseAgentId(req.params.id)

  if (!rigName) {
    res.status(404).json({ error: 'Agent not found' })
    return
  }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  let lastLength = 0

  const interval = setInterval(() => {
    try {
      const captured = gt(`session capture ${rigName}/${polecatName} -n 200`)
      if (captured && captured.length !== lastLength) {
        lastLength = captured.length
        res.write(`data: ${JSON.stringify({ logs: captured, sessionActive: true })}\n\n`)
      } else if (!captured || captured.trim() === '') {
        // Check if session is still alive
        const alive = isSessionAlive(rigName, polecatName)
        if (!alive) {
          res.write(`data: ${JSON.stringify({ logs: '(Session ended)', sessionActive: false })}\n\n`)
        }
      }
    } catch (e) {
      res.write(`data: ${JSON.stringify({ error: e.message, sessionActive: false })}\n\n`)
    }
  }, 2000)

  req.on('close', () => {
    clearInterval(interval)
  })
})

// POST /api/agents/:id/simulate-stuck - Simulate agent getting stuck (for testing)
app.post('/api/agents/:id/simulate-stuck', (req, res) => {
  const agentId = req.params.id
  const parts = agentId.split('/')

  let rigName, polecatName
  if (parts.length >= 3) {
    rigName = parts[0]
    polecatName = parts[parts.length - 1]
  } else {
    polecatName = agentId
    // Find the rig
    const rigs = listRigs()
    for (const r of rigs) {
      const statusPath = join(TOWN_ROOT, r.name, 'polecats', polecatName, 'status.json')
      if (existsSync(statusPath)) {
        rigName = r.name
        break
      }
    }
  }

  if (!rigName) {
    return res.status(404).json({ error: 'Agent not found' })
  }

  const statusPath = join(TOWN_ROOT, rigName, 'polecats', polecatName, 'status.json')

  try {
    let status = { status: 'idle' }
    if (existsSync(statusPath)) {
      const content = readFileSync(statusPath, 'utf-8')
      status = JSON.parse(content)
    }

    // Mark as stuck
    status.status = 'stuck'
    status.stuckReason = 'tokens'
    status.stuckAt = new Date().toISOString()
    status.tokensUsed = 25001  // Over the default threshold

    writeFileSync(statusPath, JSON.stringify(status, null, 2))

    multiplayer.broadcastStateUpdate({
      event: 'polecat:stuck',
      rig: rigName,
      polecat: polecatName,
      reason: 'tokens'
    })

    multiplayer.broadcastNotification({
      type: 'stuck',
      message: `${polecatName} exceeded token limit!`,
      agent: polecatName,
      rig: rigName
    })

    // Add to activity feed
    addActivityEvent('agent_stuck', {
      agent: polecatName,
      rig: rigName,
      reason: 'tokens'
    })

    res.json({ success: true, message: `${polecatName} is now stuck (simulated)` })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// POST /api/agents/:id/stop - Emergency stop
app.post('/api/agents/:id/stop', (req, res) => {
  const result = gt(`stop ${req.params.id}`)
  res.json({ success: result !== null })
})

// GET /api/costs - Get running costs
app.get('/api/costs', (req, res) => {
  const costs = gtJson('costs')
  res.json(costs || { total: 0, breakdown: [] })
})

// GET /api/settings - Get current settings
app.get('/api/settings', (req, res) => {
  res.json(currentSettings)
})

// POST /api/settings - Update settings
app.post('/api/settings', (req, res) => {
  const newSettings = { ...currentSettings, ...req.body }

  // Validate thresholds
  if (newSettings.stuckTokenThreshold < 1000) newSettings.stuckTokenThreshold = 1000
  if (newSettings.stuckTokenThreshold > 500000) newSettings.stuckTokenThreshold = 500000
  if (newSettings.stuckTimeThreshold < 60000) newSettings.stuckTimeThreshold = 60000  // Min 1 minute
  if (newSettings.stuckTimeThreshold > 7200000) newSettings.stuckTimeThreshold = 7200000  // Max 2 hours

  // Calculate warning thresholds as 80% of stuck thresholds
  newSettings.warningTokenThreshold = Math.round(newSettings.stuckTokenThreshold * 0.8)
  newSettings.warningTimeThreshold = Math.round(newSettings.stuckTimeThreshold * 0.8)

  if (saveSettings(newSettings)) {
    currentSettings = newSettings
    multiplayer.broadcastStateUpdate({ event: 'settings:updated', settings: currentSettings })
    res.json({ success: true, settings: currentSettings })
  } else {
    res.status(500).json({ error: 'Failed to save settings' })
  }
})

// POST /api/agents/:id/reassign - Reassign work to another agent
app.post('/api/agents/:id/reassign', (req, res) => {
  const { newAgent, rig: targetRig } = req.body
  const oldAgentId = req.params.id

  if (!newAgent) {
    return res.status(400).json({ error: 'New agent ID required' })
  }

  // Parse old agent ID
  const oldParts = oldAgentId.split('/')
  let oldRig, oldPolecat
  if (oldParts.length >= 3) {
    oldRig = oldParts[0]
    oldPolecat = oldParts[oldParts.length - 1]
  } else {
    oldPolecat = oldAgentId
    // Find the rig containing this polecat
    const rigs = listRigs()
    for (const r of rigs) {
      const statusPath = join(TOWN_ROOT, r.name, 'polecats', oldPolecat, 'status.json')
      if (existsSync(statusPath)) {
        oldRig = r.name
        break
      }
    }
  }

  if (!oldRig) {
    return res.status(404).json({ error: 'Old agent not found' })
  }

  // Read old agent's current task
  const oldStatusPath = join(TOWN_ROOT, oldRig, 'polecats', oldPolecat, 'status.json')
  let oldStatus
  try {
    const content = readFileSync(oldStatusPath, 'utf-8')
    oldStatus = JSON.parse(content)
  } catch (e) {
    return res.status(404).json({ error: 'Could not read old agent status' })
  }

  const task = oldStatus.issue || oldStatus.task
  if (!task) {
    return res.status(400).json({ error: 'Old agent has no task to reassign' })
  }

  // Parse new agent ID
  const newParts = newAgent.split('/')
  let newRig, newPolecat
  if (newParts.length >= 3) {
    newRig = newParts[0]
    newPolecat = newParts[newParts.length - 1]
  } else {
    newPolecat = newAgent
    newRig = targetRig || oldRig  // Default to same rig
  }

  // Update old agent to idle
  const newOldStatus = {
    status: 'idle',
    previousTask: task,
    reassignedAt: new Date().toISOString(),
    reassignedTo: newPolecat
  }
  writeFileSync(oldStatusPath, JSON.stringify(newOldStatus, null, 2))

  // Update new agent to working
  const newStatusPath = join(TOWN_ROOT, newRig, 'polecats', newPolecat, 'status.json')
  const newStatus = {
    status: 'working',
    issue: task,
    assignedAt: new Date().toISOString(),
    reassignedFrom: oldPolecat,
    progress: 0
  }

  try {
    const statusDir = dirname(newStatusPath)
    if (!existsSync(statusDir)) {
      mkdirSync(statusDir, { recursive: true })
    }
    writeFileSync(newStatusPath, JSON.stringify(newStatus, null, 2))
  } catch (e) {
    return res.status(500).json({ error: 'Failed to update new agent status' })
  }

  // Broadcast updates
  multiplayer.broadcastStateUpdate({
    event: 'polecat:reassigned',
    from: { rig: oldRig, polecat: oldPolecat },
    to: { rig: newRig, polecat: newPolecat },
    task
  })

  multiplayer.broadcastNotification({
    type: 'info',
    message: `Task reassigned from ${oldPolecat} to ${newPolecat}`,
    agent: newPolecat,
    rig: newRig
  })

  // Add to activity feed
  addActivityEvent('task_reassigned', {
    task,
    fromAgent: oldPolecat,
    toAgent: newPolecat,
    rig: newRig
  }, req.session?.passport?.user)

  res.json({
    success: true,
    message: `Reassigned "${task}" from ${oldPolecat} to ${newPolecat}`,
    oldAgent: { rig: oldRig, polecat: oldPolecat, status: 'idle' },
    newAgent: { rig: newRig, polecat: newPolecat, status: 'working', task }
  })
})

// POST /api/agents/:id/complete - Mark task as complete (manual override)
app.post('/api/agents/:id/complete', (req, res) => {
  const agentId = req.params.id

  // Parse agent ID
  const parts = agentId.split('/')
  let rigName, polecatName
  if (parts.length >= 3) {
    rigName = parts[0]
    polecatName = parts[parts.length - 1]
  } else {
    polecatName = agentId
    // Find the rig
    const rigs = listRigs()
    for (const r of rigs) {
      const statusPath = join(TOWN_ROOT, r.name, 'polecats', polecatName, 'status.json')
      if (existsSync(statusPath)) {
        rigName = r.name
        break
      }
    }
  }

  if (!rigName) {
    return res.status(404).json({ error: 'Agent not found' })
  }

  const statusPath = join(TOWN_ROOT, rigName, 'polecats', polecatName, 'status.json')

  try {
    const content = readFileSync(statusPath, 'utf-8')
    const oldStatus = JSON.parse(content)

    const newStatus = {
      status: 'idle',
      completedTask: oldStatus.issue || oldStatus.task,
      completedAt: new Date().toISOString(),
      created: oldStatus.created
    }

    writeFileSync(statusPath, JSON.stringify(newStatus, null, 2))

    multiplayer.broadcastStateUpdate({
      event: 'polecat:completed',
      rig: rigName,
      polecat: polecatName,
      task: oldStatus.issue
    })

    multiplayer.broadcastNotification({
      type: 'success',
      message: `${polecatName} completed: ${oldStatus.issue || 'task'}`,
      agent: polecatName,
      rig: rigName
    })

    // Add to activity feed
    addActivityEvent('task_completed', {
      task: oldStatus.issue || 'task',
      agent: polecatName,
      rig: rigName
    }, req.session?.passport?.user)

    res.json({ success: true, agent: polecatName, completedTask: oldStatus.issue })
  } catch (e) {
    res.status(500).json({ error: 'Failed to mark complete: ' + e.message })
  }
})

// ===== ACTIVITY FEED ENDPOINTS =====

// GET /api/activity - Get activity feed
app.get('/api/activity', (req, res) => {
  const { limit = 50, offset = 0, type, project, agent } = req.query

  let filtered = [...activityFeed]

  // Apply filters
  if (type) {
    const types = type.split(',')
    filtered = filtered.filter(e => types.includes(e.type))
  }
  if (project) {
    filtered = filtered.filter(e => e.rig === project || e.project === project)
  }
  if (agent) {
    filtered = filtered.filter(e => e.polecat === agent || e.agent === agent)
  }

  // Apply pagination
  const start = parseInt(offset)
  const end = start + parseInt(limit)
  const paginated = filtered.slice(start, end)

  res.json({
    events: paginated,
    total: filtered.length,
    hasMore: end < filtered.length
  })
})

// GET /api/feed - Live activity feed (SSE) - Legacy endpoint
app.get('/api/feed', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  // Poll gt feed and stream
  const interval = setInterval(() => {
    const feedLine = gt('feed --once 2>/dev/null') || ''
    if (feedLine.trim()) {
      res.write(`data: ${JSON.stringify({ event: feedLine.trim() })}\n\n`)
    }
  }, 1000)

  req.on('close', () => {
    clearInterval(interval)
  })
})

// ===== TASK QUEUE ENDPOINTS =====

// GET /api/taskqueue - Get task queue
app.get('/api/taskqueue', (req, res) => {
  const { project } = req.query
  let filtered = [...taskQueue]

  if (project) {
    filtered = filtered.filter(t => t.project === project)
  }

  // Group by project for queue depth
  const projectDepths = {}
  taskQueue.forEach(t => {
    if (!projectDepths[t.project]) projectDepths[t.project] = 0
    projectDepths[t.project]++
  })

  res.json({
    tasks: filtered,
    total: taskQueue.length,
    projectDepths
  })
})

// POST /api/taskqueue - Add task to queue
app.post('/api/taskqueue', (req, res) => {
  const { title, description, project, priority = 0, assignTo, autoAssign = false } = req.body

  if (!title) {
    return res.status(400).json({ error: 'Task title required' })
  }

  const task = {
    id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    title,
    description: description || '',
    project: project || 'default',
    priority,
    status: 'pending',
    assignTo: assignTo || null,
    autoAssign,
    createdAt: new Date().toISOString(),
    createdBy: req.session?.passport?.user || 'anonymous'
  }

  taskQueue.push(task)
  saveTaskQueue()

  // Add to activity feed
  addActivityEvent('task_queued', {
    task: task.title,
    project: task.project,
    taskId: task.id
  }, task.createdBy)

  multiplayer.broadcastTaskQueueUpdate(taskQueue)
  res.json({ success: true, task })
})

// PUT /api/taskqueue/:id - Update task (reorder, assign, etc.)
app.put('/api/taskqueue/:id', (req, res) => {
  const { id } = req.params
  const { priority, assignTo, status, position } = req.body

  const taskIndex = taskQueue.findIndex(t => t.id === id)
  if (taskIndex === -1) {
    return res.status(404).json({ error: 'Task not found' })
  }

  const task = taskQueue[taskIndex]

  // Update fields
  if (priority !== undefined) task.priority = priority
  if (assignTo !== undefined) task.assignTo = assignTo
  if (status !== undefined) task.status = status

  // Handle reordering
  if (position !== undefined && position !== taskIndex) {
    taskQueue.splice(taskIndex, 1)
    taskQueue.splice(position, 0, task)
  }

  saveTaskQueue()
  multiplayer.broadcastTaskQueueUpdate(taskQueue)
  res.json({ success: true, task })
})

// DELETE /api/taskqueue/:id - Remove task from queue
app.delete('/api/taskqueue/:id', (req, res) => {
  const { id } = req.params
  const taskIndex = taskQueue.findIndex(t => t.id === id)

  if (taskIndex === -1) {
    return res.status(404).json({ error: 'Task not found' })
  }

  const removed = taskQueue.splice(taskIndex, 1)[0]
  saveTaskQueue()
  multiplayer.broadcastTaskQueueUpdate(taskQueue)
  res.json({ success: true, removed })
})

// POST /api/taskqueue/:id/assign - Assign task from queue to agent
app.post('/api/taskqueue/:id/assign', (req, res) => {
  const { id } = req.params
  const { agent, rig } = req.body

  const taskIndex = taskQueue.findIndex(t => t.id === id)
  if (taskIndex === -1) {
    return res.status(404).json({ error: 'Task not found' })
  }

  const task = taskQueue[taskIndex]

  // Remove from queue
  taskQueue.splice(taskIndex, 1)
  saveTaskQueue()

  // Sling to agent
  const agentPath = `${rig || task.project}/polecats/${agent}`
  const statusPath = join(TOWN_ROOT, rig || task.project, 'polecats', agent, 'status.json')

  try {
    const status = {
      status: 'working',
      issue: task.title,
      description: task.description,
      assignedAt: new Date().toISOString(),
      progress: 0
    }
    const statusDir = dirname(statusPath)
    if (!existsSync(statusDir)) {
      mkdirSync(statusDir, { recursive: true })
    }
    writeFileSync(statusPath, JSON.stringify(status, null, 2))

    addActivityEvent('task_assigned', {
      task: task.title,
      agent: agent,
      rig: rig || task.project,
      taskId: task.id
    })

    multiplayer.broadcastStateUpdate({
      event: 'polecat:working',
      rig: rig || task.project,
      polecat: agent,
      issue: task.title
    })

    multiplayer.broadcastTaskQueueUpdate(taskQueue)
    res.json({ success: true, assigned: { agent, task: task.title } })
  } catch (e) {
    // Put task back in queue on failure
    taskQueue.splice(taskIndex, 0, task)
    saveTaskQueue()
    res.status(500).json({ error: 'Failed to assign task: ' + e.message })
  }
})

// ===== COST DASHBOARD ENDPOINTS =====

// GET /api/costs/dashboard - Get cost dashboard data
app.get('/api/costs/dashboard', (req, res) => {
  const today = new Date()
  const todayStr = today.toISOString().split('T')[0]

  // Calculate date ranges
  const weekAgo = new Date(today)
  weekAgo.setDate(weekAgo.getDate() - 7)
  const monthAgo = new Date(today)
  monthAgo.setDate(monthAgo.getDate() - 30)

  // Calculate totals
  let todayTokens = costHistory.daily[todayStr] || 0
  let weekTokens = 0
  let monthTokens = 0

  // Build daily data for sparkline (last 7 days)
  const sparklineData = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const dateStr = d.toISOString().split('T')[0]
    const tokens = costHistory.daily[dateStr] || 0
    sparklineData.push({ date: dateStr, tokens })
    weekTokens += tokens
  }

  // Calculate month total
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const dateStr = d.toISOString().split('T')[0]
    monthTokens += costHistory.daily[dateStr] || 0
  }

  // Get token cost rate from settings
  const rate = currentSettings.tokenCostRate || 0.003

  // Build breakdown by project
  const byProject = Object.entries(costHistory.byProject || {}).map(([name, data]) => ({
    name,
    tokens: data.total,
    cost: (data.total / 1000) * rate
  })).sort((a, b) => b.tokens - a.tokens)

  // Build breakdown by agent
  const byAgent = Object.entries(costHistory.byAgent || {}).map(([name, data]) => ({
    name,
    tokens: data.total,
    cost: (data.total / 1000) * rate
  })).sort((a, b) => b.tokens - a.tokens)

  res.json({
    today: {
      tokens: todayTokens,
      cost: (todayTokens / 1000) * rate
    },
    week: {
      tokens: weekTokens,
      cost: (weekTokens / 1000) * rate
    },
    month: {
      tokens: monthTokens,
      cost: (monthTokens / 1000) * rate
    },
    sparkline: sparklineData,
    byProject,
    byAgent,
    rate,
    budgetAlert: currentSettings.budgetLimit
      ? monthTokens > currentSettings.budgetLimit * 0.8
      : false
  })
})

// POST /api/costs/record - Record token usage (called by agents or hooks)
app.post('/api/costs/record', (req, res) => {
  const { agent, project, tokens } = req.body

  if (!agent || !project || !tokens) {
    return res.status(400).json({ error: 'Missing agent, project, or tokens' })
  }

  recordTokenUsage(agent, project, parseInt(tokens))
  multiplayer.broadcastCostUpdate({ agent, project, tokens })

  res.json({ success: true })
})

// GET /api/costs/export - Export cost data as CSV
app.get('/api/costs/export', (req, res) => {
  const { from, to } = req.query
  const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const toDate = to ? new Date(to) : new Date()

  const rate = currentSettings.tokenCostRate || 0.003

  let csv = 'Date,Tokens,Cost (USD)\n'

  const current = new Date(fromDate)
  while (current <= toDate) {
    const dateStr = current.toISOString().split('T')[0]
    const tokens = costHistory.daily[dateStr] || 0
    const cost = ((tokens / 1000) * rate).toFixed(4)
    csv += `${dateStr},${tokens},${cost}\n`
    current.setDate(current.getDate() + 1)
  }

  res.setHeader('Content-Type', 'text/csv')
  res.setHeader('Content-Disposition', `attachment; filename=costs-${fromDate.toISOString().split('T')[0]}-${toDate.toISOString().split('T')[0]}.csv`)
  res.send(csv)
})

// ===== GITHUB INTEGRATION ENDPOINTS =====

// GitHub PR tracking storage
const GITHUB_PRS_FILE = join(TOWN_ROOT, 'github_prs.json')
let githubPRs = []

function loadGitHubPRs() {
  try {
    if (existsSync(GITHUB_PRS_FILE)) {
      const content = readFileSync(GITHUB_PRS_FILE, 'utf-8')
      githubPRs = JSON.parse(content)
    }
  } catch (e) {
    console.error('Failed to load GitHub PRs:', e.message)
    githubPRs = []
  }
}

function saveGitHubPRs() {
  try {
    const dir = dirname(GITHUB_PRS_FILE)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(GITHUB_PRS_FILE, JSON.stringify(githubPRs, null, 2))
  } catch (e) {
    console.error('Failed to save GitHub PRs:', e.message)
  }
}

// Load GitHub PRs on startup
loadGitHubPRs()

// GET /api/github/prs - Get tracked PRs
app.get('/api/github/prs', (req, res) => {
  const { project, agent, status } = req.query
  let filtered = [...githubPRs]

  if (project) {
    filtered = filtered.filter(pr => pr.project === project)
  }
  if (agent) {
    filtered = filtered.filter(pr => pr.agent === agent)
  }
  if (status) {
    filtered = filtered.filter(pr => pr.status === status)
  }

  res.json({
    prs: filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
    total: filtered.length
  })
})

// POST /api/github/prs - Track a new PR (can be called by agents via hooks)
app.post('/api/github/prs', (req, res) => {
  const { url, title, agent, project, status = 'open', isDraft = false, commits = 0, changedFiles = 0 } = req.body

  if (!url || !title) {
    return res.status(400).json({ error: 'URL and title required' })
  }

  // Extract PR number from URL
  const prMatch = url.match(/\/pull\/(\d+)/)
  const prNumber = prMatch ? prMatch[1] : null

  const pr = {
    id: `pr-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    url,
    number: prNumber,
    title,
    agent: agent || null,
    project: project || 'unknown',
    status,
    isDraft,
    commits,
    changedFiles,
    ciStatus: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }

  githubPRs.unshift(pr)
  saveGitHubPRs()

  // Add to activity feed
  addActivityEvent('pr_created', {
    pr: title,
    url,
    agent,
    project
  }, agent)

  multiplayer.broadcastStateUpdate({ event: 'github:pr_created', pr })

  res.json({ success: true, pr })
})

// PUT /api/github/prs/:id - Update PR status
app.put('/api/github/prs/:id', (req, res) => {
  const { id } = req.params
  const { status, ciStatus, commits, changedFiles, isDraft } = req.body

  const prIndex = githubPRs.findIndex(pr => pr.id === id)
  if (prIndex === -1) {
    return res.status(404).json({ error: 'PR not found' })
  }

  const pr = githubPRs[prIndex]

  if (status !== undefined) pr.status = status
  if (ciStatus !== undefined) pr.ciStatus = ciStatus
  if (commits !== undefined) pr.commits = commits
  if (changedFiles !== undefined) pr.changedFiles = changedFiles
  if (isDraft !== undefined) pr.isDraft = isDraft
  pr.updatedAt = new Date().toISOString()

  saveGitHubPRs()

  // Add activity event for status changes
  if (status === 'merged') {
    addActivityEvent('pr_merged', {
      pr: pr.title,
      url: pr.url,
      agent: pr.agent,
      project: pr.project
    })
  }

  multiplayer.broadcastStateUpdate({ event: 'github:pr_updated', pr })

  res.json({ success: true, pr })
})

// DELETE /api/github/prs/:id - Remove PR tracking
app.delete('/api/github/prs/:id', (req, res) => {
  const { id } = req.params
  const prIndex = githubPRs.findIndex(pr => pr.id === id)

  if (prIndex === -1) {
    return res.status(404).json({ error: 'PR not found' })
  }

  const removed = githubPRs.splice(prIndex, 1)[0]
  saveGitHubPRs()

  res.json({ success: true, removed })
})

// POST /api/github/webhook - Webhook receiver for GitHub events
app.post('/api/github/webhook', (req, res) => {
  const event = req.headers['x-github-event']
  const payload = req.body

  if (event === 'pull_request') {
    const prUrl = payload.pull_request?.html_url
    const prStatus = payload.action

    // Find and update tracked PR
    const pr = githubPRs.find(p => p.url === prUrl)
    if (pr) {
      if (prStatus === 'closed' && payload.pull_request?.merged) {
        pr.status = 'merged'
      } else if (prStatus === 'closed') {
        pr.status = 'closed'
      } else if (prStatus === 'opened' || prStatus === 'reopened') {
        pr.status = 'open'
      }
      pr.isDraft = payload.pull_request?.draft || false
      pr.updatedAt = new Date().toISOString()
      saveGitHubPRs()

      multiplayer.broadcastStateUpdate({ event: 'github:pr_updated', pr })
    }
  }

  res.json({ received: true })
})

// ===== BATCH OPERATIONS ENDPOINTS =====

// POST /api/batch/stop - Stop multiple agents
app.post('/api/batch/stop', (req, res) => {
  const { agents } = req.body

  if (!agents || !Array.isArray(agents) || agents.length === 0) {
    return res.status(400).json({ error: 'Agents array required' })
  }

  const results = []
  for (const agentId of agents) {
    try {
      // Parse agent ID
      const parts = agentId.split('/')
      let rigName, polecatName
      if (parts.length >= 3) {
        rigName = parts[0]
        polecatName = parts[parts.length - 1]
      } else {
        polecatName = agentId
        // Find the rig
        const rigs = listRigs()
        for (const r of rigs) {
          const statusPath = join(TOWN_ROOT, r.name, 'polecats', polecatName, 'status.json')
          if (existsSync(statusPath)) {
            rigName = r.name
            break
          }
        }
      }

      if (rigName) {
        const statusPath = join(TOWN_ROOT, rigName, 'polecats', polecatName, 'status.json')
        if (existsSync(statusPath)) {
          const content = readFileSync(statusPath, 'utf-8')
          const status = JSON.parse(content)
          status.status = 'idle'
          status.stoppedAt = new Date().toISOString()
          writeFileSync(statusPath, JSON.stringify(status, null, 2))
          results.push({ agent: agentId, success: true })
        }
      }
    } catch (e) {
      results.push({ agent: agentId, success: false, error: e.message })
    }
  }

  addActivityEvent('batch_stop', {
    count: results.filter(r => r.success).length,
    agents: agents
  }, req.session?.passport?.user)

  multiplayer.broadcastStateUpdate({ event: 'batch:stop', results })
  res.json({ success: true, results })
})

// POST /api/batch/complete - Mark multiple agents as complete
app.post('/api/batch/complete', (req, res) => {
  const { agents } = req.body

  if (!agents || !Array.isArray(agents) || agents.length === 0) {
    return res.status(400).json({ error: 'Agents array required' })
  }

  const results = []
  for (const agentId of agents) {
    try {
      const parts = agentId.split('/')
      let rigName, polecatName
      if (parts.length >= 3) {
        rigName = parts[0]
        polecatName = parts[parts.length - 1]
      } else {
        polecatName = agentId
        const rigs = listRigs()
        for (const r of rigs) {
          const statusPath = join(TOWN_ROOT, r.name, 'polecats', polecatName, 'status.json')
          if (existsSync(statusPath)) {
            rigName = r.name
            break
          }
        }
      }

      if (rigName) {
        const statusPath = join(TOWN_ROOT, rigName, 'polecats', polecatName, 'status.json')
        if (existsSync(statusPath)) {
          const content = readFileSync(statusPath, 'utf-8')
          const oldStatus = JSON.parse(content)
          const newStatus = {
            status: 'idle',
            completedTask: oldStatus.issue || oldStatus.task,
            completedAt: new Date().toISOString(),
            created: oldStatus.created
          }
          writeFileSync(statusPath, JSON.stringify(newStatus, null, 2))
          results.push({ agent: agentId, success: true })
        }
      }
    } catch (e) {
      results.push({ agent: agentId, success: false, error: e.message })
    }
  }

  addActivityEvent('batch_complete', {
    count: results.filter(r => r.success).length,
    agents: agents
  }, req.session?.passport?.user)

  multiplayer.broadcastStateUpdate({ event: 'batch:complete', results })
  res.json({ success: true, results })
})

// POST /api/batch/spawn - Spawn multiple agents at once
app.post('/api/batch/spawn', (req, res) => {
  const { rig, count = 1, prefix = 'polecat' } = req.body

  if (!rig) {
    return res.status(400).json({ error: 'Rig name required' })
  }

  const results = []
  const rigPath = join(TOWN_ROOT, rig)

  for (let i = 0; i < Math.min(count, 10); i++) {  // Max 10 at once
    try {
      const pcName = `${prefix}-${Date.now()}-${i}`
      const polecatPath = join(rigPath, 'polecats', pcName)

      if (!existsSync(polecatPath)) {
        mkdirSync(polecatPath, { recursive: true })
      }

      const initialStatus = {
        status: 'idle',
        created: new Date().toISOString()
      }
      writeFileSync(join(polecatPath, 'status.json'), JSON.stringify(initialStatus, null, 2))
      results.push({ name: pcName, success: true })

      multiplayer.broadcastStateUpdate({ event: 'polecat:spawned', rig, polecat: pcName })
    } catch (e) {
      results.push({ name: `${prefix}-${i}`, success: false, error: e.message })
    }
  }

  addActivityEvent('batch_spawn', {
    count: results.filter(r => r.success).length,
    rig,
    agents: results.filter(r => r.success).map(r => r.name)
  }, req.session?.passport?.user)

  res.json({ success: true, results })
})

// ===== PROJECT TEMPLATES ENDPOINTS =====

const TEMPLATES_FILE = join(TOWN_ROOT, 'templates.json')
let projectTemplates = []

function loadTemplates() {
  try {
    if (existsSync(TEMPLATES_FILE)) {
      const content = readFileSync(TEMPLATES_FILE, 'utf-8')
      projectTemplates = JSON.parse(content)
    }
  } catch (e) {
    console.error('Failed to load templates:', e.message)
    projectTemplates = []
  }
}

function saveTemplates() {
  try {
    const dir = dirname(TEMPLATES_FILE)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(TEMPLATES_FILE, JSON.stringify(projectTemplates, null, 2))
  } catch (e) {
    console.error('Failed to save templates:', e.message)
  }
}

// Load templates on startup
loadTemplates()

// GET /api/templates - Get all templates
app.get('/api/templates', (req, res) => {
  res.json({ templates: projectTemplates })
})

// POST /api/templates - Create template from existing rig
app.post('/api/templates', (req, res) => {
  const { name, description, sourceRig, defaultAgentCount = 1, taskTypes = [] } = req.body

  if (!name) {
    return res.status(400).json({ error: 'Template name required' })
  }

  // Get repo info from source rig if provided
  let repo = null
  if (sourceRig) {
    const rigPath = join(TOWN_ROOT, sourceRig)
    try {
      // Try to find a git repo in the rig
      const dirs = execSync(`ls -1 "${rigPath}" 2>/dev/null || true`, { encoding: 'utf-8' }).trim()
      for (const dir of dirs.split('\n').filter(Boolean)) {
        const gitPath = join(rigPath, dir, '.git')
        if (existsSync(gitPath)) {
          try {
            repo = execSync(`cd "${join(rigPath, dir)}" && git remote get-url origin 2>/dev/null`, {
              encoding: 'utf-8'
            }).trim()
          } catch (e) { /* no remote */ }
          break
        }
      }
    } catch (e) { /* ignore */ }
  }

  const template = {
    id: `tpl-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    name,
    description: description || '',
    repo,
    defaultAgentCount,
    taskTypes,
    createdAt: new Date().toISOString(),
    createdBy: req.session?.passport?.user || 'anonymous'
  }

  projectTemplates.push(template)
  saveTemplates()

  res.json({ success: true, template })
})

// POST /api/templates/:id/create - Create project from template
app.post('/api/templates/:id/create', async (req, res) => {
  const { id } = req.params
  const { projectName } = req.body

  const template = projectTemplates.find(t => t.id === id)
  if (!template) {
    return res.status(404).json({ error: 'Template not found' })
  }

  if (!projectName) {
    return res.status(400).json({ error: 'Project name required' })
  }

  try {
    // Create the rig
    const rigPath = join(TOWN_ROOT, projectName)
    mkdirSync(rigPath, { recursive: true })

    // Clone repo if template has one
    if (template.repo) {
      try {
        execSync(`git clone "${template.repo}"`, {
          cwd: rigPath,
          encoding: 'utf-8',
          timeout: 120000
        })
      } catch (e) {
        console.error('Clone failed:', e.message)
      }
    }

    // Spawn polecats
    const polecats = []
    for (let i = 0; i < template.defaultAgentCount; i++) {
      const pcName = `polecat-${i + 1}`
      const polecatPath = join(rigPath, 'polecats', pcName)
      mkdirSync(polecatPath, { recursive: true })
      writeFileSync(join(polecatPath, 'status.json'), JSON.stringify({
        status: 'idle',
        created: new Date().toISOString()
      }, null, 2))
      polecats.push(pcName)
    }

    addActivityEvent('project_from_template', {
      project: projectName,
      template: template.name
    }, req.session?.passport?.user)

    multiplayer.broadcastStateUpdate({ event: 'rig:created', rig: projectName })

    res.json({
      success: true,
      project: projectName,
      template: template.name,
      polecats
    })
  } catch (e) {
    res.status(500).json({ error: 'Failed to create project: ' + e.message })
  }
})

// DELETE /api/templates/:id - Delete a template
app.delete('/api/templates/:id', (req, res) => {
  const { id } = req.params
  const index = projectTemplates.findIndex(t => t.id === id)

  if (index === -1) {
    return res.status(404).json({ error: 'Template not found' })
  }

  const removed = projectTemplates.splice(index, 1)[0]
  saveTemplates()

  res.json({ success: true, removed })
})

// Helper: Get polecats for a specific rig
function getPolecatsForRig(rigName) {
  const polecats = []
  const polecatsPath = join(TOWN_ROOT, rigName, 'polecats')

  try {
    // List polecat directories
    const dirs = execSync(`ls -1 "${polecatsPath}" 2>/dev/null || true`, {
      encoding: 'utf-8'
    }).trim()

    if (!dirs) return polecats

    for (const name of dirs.split('\n').filter(Boolean)) {
      const statusFile = join(polecatsPath, name, 'status.json')
      let status = { status: 'idle' }

      try {
        const content = execSync(`cat "${statusFile}" 2>/dev/null || echo '{}'`, {
          encoding: 'utf-8'
        })
        status = JSON.parse(content) || { status: 'idle' }
      } catch (e) {
        // No status file, default to idle
      }

      polecats.push({
        name,
        rig: rigName,
        status: status.status || 'idle',
        issue: status.issue || null,
        assignedAt: status.assignedAt || null,
        progress: status.progress || 0,
        tokensUsed: status.tokensUsed || 0,
        stuckReason: status.stuckReason || null,
        stuckAt: status.stuckAt || null,
        created: status.created || null
      })
    }
  } catch (e) {
    // No polecats directory
  }

  return polecats
}

// Static files
app.use(express.static(join(__dirname, 'dist')))

// Serve index.html for all other routes (SPA)
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'))
})

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err.message)
  res.status(500).json({ error: err.message })
})

const PORT = process.env.PORT || 8080
httpServer.listen(PORT, () => {
  console.log(`Gas Town UI server running at http://localhost:${PORT}`)
  console.log(`Town root: ${TOWN_ROOT}`)
  console.log(`GT binary: ${GT_PATH}`)
  console.log(`WebSocket enabled for multiplayer`)
  if (!process.env.GITHUB_CLIENT_ID) {
    console.log(`GitHub OAuth: Not configured (dev mode enabled)`)
  } else {
    console.log(`GitHub OAuth: Configured`)
  }
})
