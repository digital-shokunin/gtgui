import express from 'express'
import cors from 'cors'
import { createServer } from 'http'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs'
import { spawn, execSync } from 'child_process'
import pty from 'node-pty'
import { setupAuth, getSessionMiddleware, requireAuth, DEV_MODE } from './src/server/auth.js'
import { MultiplayerServer } from './src/server/multiplayer.js'
import { AgentTeamsBackend } from './src/server/backend.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const app = express()
app.set('trust proxy', 1)
const httpServer = createServer(app)

// CORS: restrict origins in production, allow all in dev
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : (DEV_MODE ? true : false)  // false = same-origin only when not configured

app.use(cors({
  origin: ALLOWED_ORIGINS,
  credentials: true
}))

// Only parse JSON for API routes
app.use('/api', express.json({ limit: '1mb' }))
app.use('/auth', express.json())

// Setup authentication
const sessionMiddleware = getSessionMiddleware()
app.use(sessionMiddleware)
const { users: authUsers } = setupAuth(app)

// Require auth on all API routes except public ones
const PUBLIC_API = ['/config', '/me', '/github/webhook', '/status']
app.use('/api', (req, res, next) => {
  if (PUBLIC_API.includes(req.path)) return next()
  requireAuth(req, res, next)
})

// Setup multiplayer WebSocket
const multiplayer = new MultiplayerServer(httpServer, sessionMiddleware)

// ===== Penguin species names for agents =====
const KING_PENGUIN = 'king'  // Lead agent name — always spawned first
const PENGUIN_NAMES = [
  'gentoo', 'adelie', 'chinstrap', 'macaroni',
  'rockhopper', 'magellanic', 'humboldt', 'galapagos', 'african',
  'royal', 'snares', 'fiordland', 'erect_crested', 'yellow_eyed',
  'little_blue', 'fairy'
]

function getNextPenguinName(teamName) {
  const existing = Object.keys(backend._getSessionMap(teamName))
  // First agent in a project is always the king (lead)
  if (!existing.includes(KING_PENGUIN)) return KING_PENGUIN
  for (const name of PENGUIN_NAMES) {
    if (!existing.includes(name)) return name
  }
  return `penguin_${Date.now()}`
}

// ===== NEW: Agent Teams Backend =====
const GTGUI_DATA = process.env.GTGUI_DATA || join(process.env.HOME, '.gtgui')
mkdirSync(GTGUI_DATA, { recursive: true })

// Settings storage
const SETTINGS_FILE = join(GTGUI_DATA, 'settings.json')
const DEFAULT_SETTINGS = {
  stuckTokenThreshold: 25000,
  stuckTimeThreshold: 1800000,     // 30 minutes in ms
  warningTokenThreshold: 20000,
  warningTimeThreshold: 1440000,   // 24 minutes
  enableSounds: true,
  enableNotifications: true,
  tokenCostRate: 0.003,
  emperorName: 'Tiberius Claudius',  // Default Emperor name — user can change
  dockerEnabled: false,              // Toggle Docker sandboxing per team
  dockerImage: 'colony-sandbox',     // Docker image for agent containers
  containerMemory: '',                // Memory limit per container (blank = auto-detect)
  containerCpus: '',                  // CPU limit per container (blank = auto-detect)
  networkIsolation: false            // If true, containers have no network access
}

// ===== ACTIVITY FEED =====
const ACTIVITY_FEED_FILE = join(GTGUI_DATA, 'activity_feed.json')
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

  if (activityFeed.length > MAX_FEED_EVENTS) {
    activityFeed = activityFeed.slice(0, MAX_FEED_EVENTS)
  }

  saveActivityFeed()
  multiplayer.broadcastFeedEvent(event)

  return event
}

loadActivityFeed()

// ===== TASK QUEUE =====
const TASK_QUEUE_FILE = join(GTGUI_DATA, 'task_queue.json')
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
    writeFileSync(TASK_QUEUE_FILE, JSON.stringify(taskQueue, null, 2))
  } catch (e) {
    console.error('Failed to save task queue:', e.message)
  }
}

loadTaskQueue()

// ===== COST TRACKING =====
const COST_FILE = join(GTGUI_DATA, 'cost_history.json')
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
    writeFileSync(COST_FILE, JSON.stringify(costHistory, null, 2))
  } catch (e) {
    console.error('Failed to save cost history:', e.message)
  }
}

function recordTokenUsage(agent, project, tokens) {
  const today = new Date().toISOString().split('T')[0]

  if (!costHistory.daily[today]) costHistory.daily[today] = 0
  costHistory.daily[today] += tokens

  if (!costHistory.byAgent[agent]) costHistory.byAgent[agent] = { total: 0, daily: {} }
  costHistory.byAgent[agent].total += tokens
  if (!costHistory.byAgent[agent].daily[today]) costHistory.byAgent[agent].daily[today] = 0
  costHistory.byAgent[agent].daily[today] += tokens

  if (!costHistory.byProject[project]) costHistory.byProject[project] = { total: 0, daily: {} }
  costHistory.byProject[project].total += tokens
  if (!costHistory.byProject[project].daily[today]) costHistory.byProject[project].daily[today] = 0
  costHistory.byProject[project].daily[today] += tokens

  saveCostHistory()
}

loadCostHistory()

// Load settings
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

function saveSettings(settings) {
  try {
    writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2))
    return true
  } catch (e) {
    console.error('Failed to save settings:', e.message)
    return false
  }
}

let currentSettings = loadSettings()

const backend = new AgentTeamsBackend({
  claudePath: process.env.CLAUDE_PATH || 'claude',
  teamsRoot: process.env.TEAMS_ROOT,
  tasksRoot: process.env.TASKS_ROOT,
  dockerEnabled: currentSettings.dockerEnabled || false,
  dockerImage: currentSettings.dockerImage || 'colony-sandbox',
  containerMemory: currentSettings.containerMemory || '',
  containerCpus: currentSettings.containerCpus || '',
  networkIsolation: currentSettings.networkIsolation || false,
})

// ===== STARTUP: Reassociate tmux sessions + detect zombies =====
console.log('[startup] Reassociating tmux sessions...')
for (const team of backend.listTeams()) {
  const sessionMap = backend.reassociateSessions(team.name)

  // Reset tasks whose session is dead
  const tasks = backend.getTasksForTeam(team.name)
  for (const task of tasks) {
    if (task.status === 'in_progress' && task.owner) {
      const sInfo = sessionMap[task.owner]
      const alive = sInfo?.alive
      if (!alive) {
        backend.updateTask(team.name, task.id, {
          status: 'pending',
          owner: null,
          interruptReason: 'session_dead',
          previousOwner: task.owner,
          resumableSessionId: sInfo?.claudeSessionId || null
        })
        console.log(`[startup] Reset task "${task.subject}" (owner ${task.owner} session dead)`)
      }
    }
  }

  // Ensure every project has at least one agent with a live tmux session
  // (emperor is a separate entity, not counted as a regular agent)
  const teammates = backend.getTeammates(team.name).filter(t => t.name !== 'emperor')
  const hasLiveAgent = teammates.some(t => backend.isTeammateAlive(team.name, t.name))
  if (!hasLiveAgent) {
    // First, try to resume an existing agent with a saved Claude session ID
    const sessionMap = backend._getSessionMap(team.name)
    const resumable = teammates
      .map(t => ({ name: t.name, sInfo: sessionMap[t.name] }))
      .filter(t => t.sInfo?.claudeSessionId && !t.sInfo?.alive)
      .sort((a, b) => (b.sInfo.startedAt || '').localeCompare(a.sInfo.startedAt || ''))

    if (resumable.length > 0) {
      const agent = resumable[0]
      try {
        backend.resumeSession(team.name, agent.name)
        console.log(`[startup] Resumed session for "${agent.name}" in project "${team.name}" (session: ${agent.sInfo.claudeSessionId})`)
      } catch (e) {
        console.error(`[startup] Failed to resume ${agent.name} for ${team.name}:`, e.message)
      }
    } else {
      // No resumable sessions — spawn a fresh lead agent
      const primaryName = KING_PENGUIN
      try {
        backend.spawnTeammate(team.name, primaryName)
        const tmuxName = backend._tmuxName(team.name, primaryName)
        if (!backend.isTmuxSessionAlive(tmuxName, { teamName: team.name })) {
          backend.spawnTmuxSession(tmuxName, null, { teamName: team.name })
          const map = backend._getSessionMap(team.name)
          map[primaryName] = { ...map[primaryName], alive: true }
          backend._saveSessionMap(team.name, map)
        }
        console.log(`[startup] Auto-spawned ${primaryName} for project "${team.name}"`)
      } catch (e) {
        console.error(`[startup] Failed to auto-spawn agent for ${team.name}:`, e.message)
      }
    }
  }
}

// ===== STUCK DETECTION =====
const alertedStuckAgents = new Set()

function checkStuckTeammates() {
  const alerts = backend.checkStuck(currentSettings)
  const currentStuck = new Set()

  for (const alert of alerts) {
    const key = `${alert.rig}/${alert.agent}`
    currentStuck.add(key)

    if (alertedStuckAgents.has(key)) continue
    alertedStuckAgents.add(key)

    multiplayer.broadcastNotification({
      type: 'stuck',
      agent: alert.agent,
      rig: alert.rig,
      message: alert.type === 'session_dead'
        ? `${alert.agent} session died while working on: ${alert.task || 'task'}`
        : `${alert.agent} appears stuck on: ${alert.task || 'task'}`
    })

    addActivityEvent('agent_stuck', {
      agent: alert.agent,
      rig: alert.rig,
      reason: alert.type
    })
  }

  for (const key of alertedStuckAgents) {
    if (!currentStuck.has(key)) alertedStuckAgents.delete(key)
  }
}

setInterval(checkStuckTeammates, 30000)

// ===== HELPER: Parse agent ID =====
// New format: "teamName/memberName" (no more /polecats/)
// Also handles legacy "teamName/polecats/memberName" for backwards compat
function parseAgentId(agentId) {
  const parts = agentId.split('/')
  // Validate all parts are safe (alphanumeric + underscores only) to prevent path traversal
  if (!parts.every(p => SAFE_NAME.test(p))) {
    return { teamName: null, memberName: null, invalid: true }
  }
  if (parts.length >= 3 && parts[1] === 'polecats') {
    // Legacy format: rig/polecats/name
    return { teamName: parts[0], memberName: parts[2] }
  } else if (parts.length === 2) {
    // New format: team/name
    return { teamName: parts[0], memberName: parts[1] }
  } else {
    // Just a name — search all teams
    const name = parts[0]
    for (const team of backend.listTeams()) {
      const teammates = backend.getTeammates(team.name)
      if (teammates.find(t => t.name === name)) {
        return { teamName: team.name, memberName: name }
      }
    }
    return { teamName: null, memberName: name }
  }
}

// ===== INPUT VALIDATION =====
const SAFE_NAME = /^[a-zA-Z0-9_]+$/

// Validate :name params (team names, template IDs, etc.) — block path traversal
app.param('name', (req, res, next, value) => {
  if (!SAFE_NAME.test(value)) {
    return res.status(400).json({ error: 'Invalid name — alphanumeric and underscores only' })
  }
  next()
})

// Validate agent IDs in parseAgentId (used by /api/agents/:id routes)
// Task queue, PR, and template :id params allow hyphens (in-memory, no path risk)

// ===== API ENDPOINTS =====

// GET /api/config
app.get('/api/config', (req, res) => {
  res.json({
    production: !DEV_MODE,
    version: '2.0.0'
  })
})

// GET /api/status - Overall status (same response shape for frontend compat)
app.get('/api/status', (req, res) => {
  const status = {}

  const teams = backend.listTeams()
  status.rigs = teams

  status.polecats = []
  let activeTasks = 0
  for (const team of teams) {
    const teammates = backend.getTeammates(team.name).filter(t => t.name !== 'emperor')
    status.polecats.push(...teammates)
    const tasks = backend.getTasksForTeam(team.name)
    activeTasks += tasks.filter(t => t.status === 'in_progress').length
  }

  status.activeTasks = activeTasks
  status.tokens = 0
  status.openIssues = status.polecats.filter(p => p.status === 'stuck').length

  multiplayer.broadcastStateUpdate(status)
  res.json(status)
})

// GET /api/rigs - List all teams (kept as /rigs for frontend compat)
app.get('/api/rigs', (req, res) => {
  const teams = backend.listTeams()
  res.json(teams)
})

// POST /api/rigs - Create a new team
app.post('/api/rigs', (req, res) => {
  const { name } = req.body
  if (!name) {
    return res.status(400).json({ error: 'Team name required' })
  }

  if (!/^[a-zA-Z0-9_]+$/.test(name)) {
    return res.status(400).json({ error: 'Invalid team name. Use alphanumeric or underscores only.' })
  }

  try {
    backend.createTeam(name)

    multiplayer.broadcastStateUpdate({ event: 'rig:created', rig: name })
    addActivityEvent('project_created', { project: name }, req.session?.passport?.user)

    res.json({ success: true, name })
  } catch (e) {
    console.error('Failed to create team:', e.message)
    res.status(500).json({ error: 'Failed to create team' })
  }
})

// DELETE /api/rigs/:name - Delete a team
app.delete('/api/rigs/:name', (req, res) => {
  const { name } = req.params

  try {
    backend.deleteTeam(name)
    multiplayer.broadcastStateUpdate({ event: 'rig:deleted', rig: name })
    res.json({ success: true, deleted: name })
  } catch (e) {
    console.error('Failed to delete team:', e.message)
    res.status(500).json({ error: 'Failed to delete team' })
  }
})

// POST /api/rigs/:name/clone - Clone a repo into the project workspace
app.post('/api/rigs/:name/clone', (req, res) => {
  const { name } = req.params
  const { repoUrl } = req.body

  if (!repoUrl) {
    return res.status(400).json({ error: 'repoUrl required' })
  }

  // Basic URL validation
  if (!/^https?:\/\/.+/.test(repoUrl)) {
    return res.status(400).json({ error: 'Invalid repo URL — must start with http(s)://' })
  }

  try {
    backend.cloneRepo(name, repoUrl)
    addActivityEvent('repo_cloned', { project: name, repoUrl }, req.session?.passport?.user)
    res.json({ success: true, project: name, repoUrl })
  } catch (e) {
    console.error('Failed to clone repo:', e.message)
    res.status(500).json({ error: `Clone failed: ${e.message}` })
  }
})

// POST /api/rigs/:name/polecats - Spawn a new teammate
app.post('/api/rigs/:name/polecats', (req, res) => {
  const { name } = req.params
  const { polecatName, cwd } = req.body

  const memberName = polecatName || getNextPenguinName(name)

  if (!/^[a-zA-Z0-9_]+$/.test(memberName)) {
    return res.status(400).json({ error: 'Invalid agent name. Use alphanumeric or underscores only.' })
  }

  try {
    const result = backend.spawnTeammate(name, memberName, cwd || null)

    multiplayer.broadcastStateUpdate({ event: 'polecat:spawned', rig: name, polecat: memberName })
    addActivityEvent('agent_spawned', { agent: memberName, rig: name }, req.session?.passport?.user)

    res.json({ success: true, name: memberName })
  } catch (e) {
    console.error('Failed to spawn teammate:', e.message)
    res.status(500).json({ error: 'Failed to spawn agent' })
  }
})

// GET /api/rigs/:name/polecats - Get teammates for a team
app.get('/api/rigs/:name/polecats', (req, res) => {
  // Emperor has its own UI — filter from agent list
  const teammates = backend.getTeammates(req.params.name).filter(t => t.name !== 'emperor')
  res.json(teammates)
})

// POST /api/sling - Assign work to agent
app.post('/api/sling', (req, res) => {
  const { agent, issue } = req.body
  if (!agent || !issue) {
    return res.status(400).json({ error: 'Missing agent or issue' })
  }

  const { teamName, memberName } = parseAgentId(agent)

  if (!teamName) {
    return res.status(404).json({ error: 'Agent not found in any team' })
  }

  // Ensure session is alive; start one if not
  if (!backend.isTeammateAlive(teamName, memberName)) {
    try {
      backend.spawnTeammate(teamName, memberName)
    } catch (e) {
      return res.status(500).json({ error: 'Failed to start agent session' })
    }
  }

  // Create an Agent Teams task and assign it
  const task = backend.createTask(teamName, {
    subject: issue,
    description: issue,
    owner: memberName,
    activeForm: `Working on: ${issue}`
  })

  // Send task to the agent session
  backend.sendToSession(teamName, memberName, issue)

  multiplayer.broadcastStateUpdate({
    event: 'polecat:working',
    rig: teamName,
    polecat: memberName,
    issue
  })

  addActivityEvent('task_assigned', {
    task: issue,
    agent: memberName,
    rig: teamName
  }, req.session?.passport?.user)

  res.json({ success: true, message: `Assigned "${issue}" to ${memberName}`, taskId: task.id })
})

// POST /api/agents/:id/complete - Mark task as complete
app.post('/api/agents/:id/complete', (req, res) => {
  const { teamName, memberName } = parseAgentId(req.params.id)

  if (!teamName) {
    return res.status(404).json({ error: 'Agent not found' })
  }

  // Find and complete the in-progress task
  const currentTask = backend.getTeammateCurrentTask(teamName, memberName)
  let completedTask = null

  if (currentTask) {
    backend.completeTask(teamName, currentTask.id)
    completedTask = currentTask.subject
  }

  multiplayer.broadcastStateUpdate({
    event: 'polecat:completed',
    rig: teamName,
    polecat: memberName,
    task: completedTask
  })

  multiplayer.broadcastNotification({
    type: 'success',
    message: `${memberName} completed: ${completedTask || 'task'}`,
    agent: memberName,
    rig: teamName
  })

  addActivityEvent('task_completed', {
    task: completedTask || 'task',
    agent: memberName,
    rig: teamName
  }, req.session?.passport?.user)

  res.json({ success: true, agent: memberName, completedTask })
})

// POST /api/agents/:id/reassign - Reassign work
app.post('/api/agents/:id/reassign', (req, res) => {
  const { newAgent, rig: targetRig } = req.body
  const oldAgentId = req.params.id

  if (!newAgent) {
    return res.status(400).json({ error: 'New agent ID required' })
  }

  const { teamName: oldTeam, memberName: oldMember } = parseAgentId(oldAgentId)
  if (!oldTeam) {
    return res.status(404).json({ error: 'Old agent not found' })
  }

  // Get old agent's current task
  const currentTask = backend.getTeammateCurrentTask(oldTeam, oldMember)
  if (!currentTask) {
    return res.status(400).json({ error: 'Old agent has no task to reassign' })
  }

  const task = currentTask.subject

  // Complete old task
  backend.completeTask(oldTeam, currentTask.id)

  // Parse new agent
  const { teamName: newTeam, memberName: newMember } = parseAgentId(newAgent)
  const resolvedTeam = newTeam || targetRig || oldTeam

  // Ensure new agent session is alive
  if (!backend.isTeammateAlive(resolvedTeam, newMember)) {
    try {
      backend.spawnTeammate(resolvedTeam, newMember)
    } catch (e) {
      return res.status(500).json({ error: `Failed to start session for ${newMember}` })
    }
  }

  // Create new task and assign
  const newTask = backend.createTask(resolvedTeam, {
    subject: task,
    description: task,
    owner: newMember,
    activeForm: `Working on: ${task}`
  })

  // Send task to agent session
  backend.sendToSession(resolvedTeam, newMember, task)

  multiplayer.broadcastStateUpdate({
    event: 'polecat:reassigned',
    from: { rig: oldTeam, polecat: oldMember },
    to: { rig: resolvedTeam, polecat: newMember },
    task
  })

  multiplayer.broadcastNotification({
    type: 'info',
    message: `Task reassigned from ${oldMember} to ${newMember}`,
    agent: newMember,
    rig: resolvedTeam
  })

  addActivityEvent('task_reassigned', {
    task,
    fromAgent: oldMember,
    toAgent: newMember,
    rig: resolvedTeam
  }, req.session?.passport?.user)

  res.json({
    success: true,
    message: `Reassigned "${task}" from ${oldMember} to ${newMember}`,
    oldAgent: { rig: oldTeam, polecat: oldMember, status: 'idle' },
    newAgent: { rig: resolvedTeam, polecat: newMember, status: 'working', task }
  })
})

// POST /api/agents/:id/stop - Stop agent
app.post('/api/agents/:id/stop', (req, res) => {
  const { teamName, memberName } = parseAgentId(req.params.id)

  if (!teamName) {
    return res.status(404).json({ error: 'Agent not found' })
  }

  const success = backend.stopTeammate(teamName, memberName)
  res.json({ success })
})

// POST /api/agents/:id/dismiss - Fully remove agent (stop, fail tasks, remove from config)
app.post('/api/agents/:id/dismiss', (req, res) => {
  const { teamName, memberName } = parseAgentId(req.params.id)

  if (!teamName) {
    return res.status(404).json({ error: 'Agent not found' })
  }

  const success = backend.dismissTeammate(teamName, memberName)

  // Clear from stuck alert dedup set
  alertedStuckAgents.delete(`${teamName}/${memberName}`)

  addActivityEvent('agent_dismissed', {
    agent: memberName,
    rig: teamName
  }, req.session?.passport?.user)

  res.json({ success })
})

// GET /api/agents/:id/hook - Get agent's current task/status
app.get('/api/agents/:id/hook', (req, res) => {
  const { teamName, memberName } = parseAgentId(req.params.id)

  if (!teamName) {
    return res.json({ hook: null, status: 'unknown' })
  }

  const currentTask = backend.getTeammateCurrentTask(teamName, memberName)

  if (currentTask) {
    const elapsed = currentTask.fileModifiedAt
      ? Date.now() - currentTask.fileModifiedAt
      : 0
    const alive = backend.isTeammateAlive(teamName, memberName)

    res.json({
      hook: currentTask.subject,
      status: (!alive && currentTask.status === 'in_progress') ? 'stuck' : currentTask.status === 'in_progress' ? 'working' : currentTask.status,
      assignedAt: currentTask.createdAt,
      progress: 0,
      tokensUsed: 0,
      costUsd: 0,
      stuckReason: !alive ? 'session_dead' : null,
      stuckAt: null,
      completedTask: null,
      completedAt: null,
      sessionAlive: alive,
      resumable: !alive
    })
  } else {
    // Check for most recently completed task
    const tasks = backend.getTasksForTeam(teamName)
    const completedTasks = tasks
      .filter(t => t.owner === memberName && t.status === 'completed')
      .sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''))

    if (completedTasks.length > 0) {
      res.json({
        hook: null,
        status: 'idle',
        completedTask: completedTasks[0].subject,
        completedAt: completedTasks[0].completedAt,
        progress: 0,
        tokensUsed: 0
      })
    } else {
      res.json({ hook: null, status: 'idle' })
    }
  }
})

// GET /api/agents/:id/logs - Get captured session output
app.get('/api/agents/:id/logs', (req, res) => {
  const { teamName, memberName } = parseAgentId(req.params.id)
  const lines = parseInt(req.query.lines) || 100

  if (!teamName) {
    return res.status(404).json({ error: 'Agent not found', logs: '', sessionActive: false })
  }

  const captured = backend.captureOutput(teamName, memberName, lines)
  const sessionActive = backend.isTeammateAlive(teamName, memberName)
  const currentTask = backend.getTeammateCurrentTask(teamName, memberName)

  res.json({
    logs: captured || '(No session output available)',
    sessionActive,
    status: currentTask ? 'working' : 'idle',
    task: currentTask?.subject || null,
    tokensUsed: 0,
    costUsd: 0,
    rig: teamName,
    polecat: memberName
  })
})

// GET /api/agents/:id/logs/stream - SSE stream of live session output (tmux polling)
app.get('/api/agents/:id/logs/stream', (req, res) => {
  const { teamName, memberName } = parseAgentId(req.params.id)

  if (!teamName) {
    res.status(404).json({ error: 'Agent not found' })
    return
  }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  // Send initial captured output
  const initial = backend.captureOutput(teamName, memberName, 200)
  if (initial) {
    res.write(`data: ${JSON.stringify({ type: 'initial', logs: initial, sessionActive: true })}\n\n`)
  }

  // Poll tmux capture-pane every 2 seconds, send diffs as SSE events
  let lastOutput = initial || ''
  const interval = setInterval(() => {
    try {
      const current = backend.captureOutput(teamName, memberName) || ''
      if (current !== lastOutput) {
        const newContent = current.length > lastOutput.length ? current.slice(lastOutput.length) : current
        res.write(`data: ${JSON.stringify({ type: 'text_delta', text: newContent })}\n\n`)
        lastOutput = current
      }
    } catch { /* ignore errors during polling */ }
  }, 2000)

  req.on('close', () => {
    clearInterval(interval)
  })
})

// POST /api/agents/:id/message - Send follow-up message to agent's tmux session
app.post('/api/agents/:id/message', (req, res) => {
  const { teamName, memberName } = parseAgentId(req.params.id)
  const { message } = req.body

  if (!teamName) {
    return res.status(404).json({ error: 'Agent not found' })
  }
  if (!message) {
    return res.status(400).json({ error: 'Message required' })
  }

  const sessionMap = backend._getSessionMap(teamName)
  const tmuxName = sessionMap[memberName]?.tmuxSession || backend._tmuxName(teamName, memberName)

  if (!backend.isTmuxSessionAlive(tmuxName, { teamName })) {
    return res.status(400).json({ error: 'Agent session not running' })
  }

  backend.sendToTmuxSession(tmuxName, message, { teamName })
  res.json({ success: true })
})

// POST /api/agents/:id/resume - Resume a dead session using saved Claude session ID
app.post('/api/agents/:id/resume', (req, res) => {
  const { teamName, memberName } = parseAgentId(req.params.id)

  if (!teamName) {
    return res.status(404).json({ error: 'Agent not found' })
  }

  const success = backend.resumeSession(teamName, memberName)
  if (success) {
    addActivityEvent('agent_resumed', { agent: memberName, rig: teamName }, req.session?.passport?.user)
    res.json({ success: true, message: `Resumed session for ${memberName}` })
  } else {
    res.status(400).json({ error: 'No resumable session found' })
  }
})

// ===== DOCKER STATUS =====

app.get('/api/docker/status', (req, res) => {
  const teams = backend.listTeams()
  const containers = {}
  for (const team of teams) {
    containers[team.name] = {
      name: backend._containerName(team.name),
      running: backend.isContainerRunning(team.name)
    }
  }
  res.json({
    enabled: backend.dockerEnabled,
    image: backend.dockerImage,
    networkIsolation: backend.networkIsolation,
    containers
  })
})

// ===== SETTINGS =====

app.get('/api/settings', (req, res) => {
  res.json(currentSettings)
})

app.post('/api/settings', (req, res) => {
  const newSettings = { ...currentSettings, ...req.body }

  if (newSettings.stuckTokenThreshold < 1000) newSettings.stuckTokenThreshold = 1000
  if (newSettings.stuckTokenThreshold > 500000) newSettings.stuckTokenThreshold = 500000
  if (newSettings.stuckTimeThreshold < 60000) newSettings.stuckTimeThreshold = 60000
  if (newSettings.stuckTimeThreshold > 7200000) newSettings.stuckTimeThreshold = 7200000

  newSettings.warningTokenThreshold = Math.round(newSettings.stuckTokenThreshold * 0.8)
  newSettings.warningTimeThreshold = Math.round(newSettings.stuckTimeThreshold * 0.8)

  if (saveSettings(newSettings)) {
    currentSettings = newSettings
    // Propagate Docker settings changes to backend
    backend.dockerEnabled = currentSettings.dockerEnabled || false
    backend.dockerImage = currentSettings.dockerImage || 'colony-sandbox'
    backend.containerMemory = currentSettings.containerMemory || ''
    backend.containerCpus = currentSettings.containerCpus || ''
    backend.networkIsolation = currentSettings.networkIsolation || false
    multiplayer.broadcastStateUpdate({ event: 'settings:updated', settings: currentSettings })
    res.json({ success: true, settings: currentSettings })
  } else {
    res.status(500).json({ error: 'Failed to save settings' })
  }
})

// ===== ACTIVITY FEED =====

app.get('/api/activity', (req, res) => {
  const { limit = 50, offset = 0, type, project, agent } = req.query

  let filtered = [...activityFeed]

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

  const start = parseInt(offset)
  const end = start + parseInt(limit)
  const paginated = filtered.slice(start, end)

  res.json({
    events: paginated,
    total: filtered.length,
    hasMore: end < filtered.length
  })
})

// ===== TASK QUEUE (GTGUI's own queue, separate from Agent Teams tasks) =====

app.get('/api/taskqueue', (req, res) => {
  const { project } = req.query
  let filtered = [...taskQueue]

  if (project) {
    filtered = filtered.filter(t => t.project === project)
  }

  const projectDepths = {}
  taskQueue.forEach(t => {
    if (!projectDepths[t.project]) projectDepths[t.project] = 0
    projectDepths[t.project]++
  })

  res.json({ tasks: filtered, total: taskQueue.length, projectDepths })
})

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

  addActivityEvent('task_queued', {
    task: task.title,
    project: task.project,
    taskId: task.id
  }, task.createdBy)

  multiplayer.broadcastTaskQueueUpdate(taskQueue)
  res.json({ success: true, task })
})

app.put('/api/taskqueue/:id', (req, res) => {
  const { id } = req.params
  const { priority, assignTo, status, position } = req.body

  const taskIndex = taskQueue.findIndex(t => t.id === id)
  if (taskIndex === -1) {
    return res.status(404).json({ error: 'Task not found' })
  }

  const task = taskQueue[taskIndex]

  if (priority !== undefined) task.priority = priority
  if (assignTo !== undefined) task.assignTo = assignTo
  if (status !== undefined) task.status = status

  if (position !== undefined && position !== taskIndex) {
    taskQueue.splice(taskIndex, 1)
    taskQueue.splice(position, 0, task)
  }

  saveTaskQueue()
  multiplayer.broadcastTaskQueueUpdate(taskQueue)
  res.json({ success: true, task })
})

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

// POST /api/taskqueue/:id/assign - Assign task from GTGUI queue to agent
app.post('/api/taskqueue/:id/assign', (req, res) => {
  const { id } = req.params
  const { agent, rig } = req.body

  const taskIndex = taskQueue.findIndex(t => t.id === id)
  if (taskIndex === -1) {
    return res.status(404).json({ error: 'Task not found' })
  }

  const queueTask = taskQueue[taskIndex]
  const targetTeam = rig || queueTask.project

  try {
    // Ensure session is alive
    if (!backend.isTeammateAlive(targetTeam, agent)) {
      backend.spawnTeammate(targetTeam, agent)
    }

    // Create Agent Teams task and assign
    const agentTask = backend.createTask(targetTeam, {
      subject: queueTask.title,
      description: queueTask.description || queueTask.title,
      owner: agent,
      activeForm: `Working on: ${queueTask.title}`
    })

    // Send task to agent session
    backend.sendToSession(targetTeam, agent, queueTask.title)

    // Remove from GTGUI queue
    taskQueue.splice(taskIndex, 1)
    saveTaskQueue()

    addActivityEvent('task_assigned', {
      task: queueTask.title,
      agent,
      rig: targetTeam,
      taskId: queueTask.id
    })

    multiplayer.broadcastStateUpdate({
      event: 'polecat:working',
      rig: targetTeam,
      polecat: agent,
      issue: queueTask.title
    })

    multiplayer.broadcastTaskQueueUpdate(taskQueue)
    res.json({ success: true, assigned: { agent, task: queueTask.title } })
  } catch (e) {
    res.status(500).json({ error: 'Failed to assign task: ' + e.message })
  }
})

// ===== COST DASHBOARD =====

app.get('/api/costs', (req, res) => {
  res.json(costHistory)
})

app.get('/api/costs/dashboard', (req, res) => {
  const today = new Date()
  const todayStr = today.toISOString().split('T')[0]

  let todayTokens = costHistory.daily[todayStr] || 0
  let weekTokens = 0
  let monthTokens = 0

  const sparklineData = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const dateStr = d.toISOString().split('T')[0]
    const tokens = costHistory.daily[dateStr] || 0
    sparklineData.push({ date: dateStr, tokens })
    weekTokens += tokens
  }

  for (let i = 29; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const dateStr = d.toISOString().split('T')[0]
    monthTokens += costHistory.daily[dateStr] || 0
  }

  const rate = currentSettings.tokenCostRate || 0.003

  const byProject = Object.entries(costHistory.byProject || {}).map(([name, data]) => ({
    name, tokens: data.total, cost: (data.total / 1000) * rate
  })).sort((a, b) => b.tokens - a.tokens)

  const byAgent = Object.entries(costHistory.byAgent || {}).map(([name, data]) => ({
    name, tokens: data.total, cost: (data.total / 1000) * rate
  })).sort((a, b) => b.tokens - a.tokens)

  res.json({
    today: { tokens: todayTokens, cost: (todayTokens / 1000) * rate },
    week: { tokens: weekTokens, cost: (weekTokens / 1000) * rate },
    month: { tokens: monthTokens, cost: (monthTokens / 1000) * rate },
    sparkline: sparklineData,
    byProject,
    byAgent,
    rate,
    budgetAlert: currentSettings.budgetLimit ? monthTokens > currentSettings.budgetLimit * 0.8 : false
  })
})

app.post('/api/costs/record', (req, res) => {
  const { agent, project, tokens } = req.body

  if (!agent || !project || !tokens) {
    return res.status(400).json({ error: 'Missing agent, project, or tokens' })
  }

  recordTokenUsage(agent, project, parseInt(tokens))
  multiplayer.broadcastCostUpdate({ agent, project, tokens })

  res.json({ success: true })
})

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

// ===== GITHUB INTEGRATION =====

const GITHUB_PRS_FILE = join(GTGUI_DATA, 'github_prs.json')
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
    writeFileSync(GITHUB_PRS_FILE, JSON.stringify(githubPRs, null, 2))
  } catch (e) {
    console.error('Failed to save GitHub PRs:', e.message)
  }
}

loadGitHubPRs()

app.get('/api/github/prs', (req, res) => {
  const { project, agent, status } = req.query
  let filtered = [...githubPRs]

  if (project) filtered = filtered.filter(pr => pr.project === project)
  if (agent) filtered = filtered.filter(pr => pr.agent === agent)
  if (status) filtered = filtered.filter(pr => pr.status === status)

  res.json({
    prs: filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
    total: filtered.length
  })
})

app.post('/api/github/prs', (req, res) => {
  const { url, title, agent, project, status = 'open', isDraft = false, commits = 0, changedFiles = 0 } = req.body

  if (!url || !title) {
    return res.status(400).json({ error: 'URL and title required' })
  }

  const prMatch = url.match(/\/pull\/(\d+)/)
  const prNumber = prMatch ? prMatch[1] : null

  const pr = {
    id: `pr-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    url, number: prNumber, title,
    agent: agent || null, project: project || 'unknown',
    status, isDraft, commits, changedFiles,
    ciStatus: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }

  githubPRs.unshift(pr)
  saveGitHubPRs()

  addActivityEvent('pr_created', { pr: title, url, agent, project }, agent)
  multiplayer.broadcastStateUpdate({ event: 'github:pr_created', pr })

  res.json({ success: true, pr })
})

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

  if (status === 'merged') {
    addActivityEvent('pr_merged', { pr: pr.title, url: pr.url, agent: pr.agent, project: pr.project })
  }

  multiplayer.broadcastStateUpdate({ event: 'github:pr_updated', pr })
  res.json({ success: true, pr })
})

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

app.post('/api/github/webhook', (req, res) => {
  const event = req.headers['x-github-event']
  const payload = req.body

  if (event === 'pull_request') {
    const prUrl = payload.pull_request?.html_url
    const prStatus = payload.action

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

// ===== BATCH OPERATIONS =====

app.post('/api/batch/stop', (req, res) => {
  const { agents } = req.body

  if (!agents || !Array.isArray(agents) || agents.length === 0) {
    return res.status(400).json({ error: 'Agents array required' })
  }

  const results = []
  for (const agentId of agents) {
    const { teamName, memberName } = parseAgentId(agentId)
    if (teamName) {
      const success = backend.stopTeammate(teamName, memberName)
      results.push({ agent: agentId, success })
    } else {
      results.push({ agent: agentId, success: false, error: 'Agent not found' })
    }
  }

  addActivityEvent('batch_stop', {
    count: results.filter(r => r.success).length,
    agents
  }, req.session?.passport?.user)

  multiplayer.broadcastStateUpdate({ event: 'batch:stop', results })
  res.json({ success: true, results })
})

app.post('/api/batch/complete', (req, res) => {
  const { agents } = req.body

  if (!agents || !Array.isArray(agents) || agents.length === 0) {
    return res.status(400).json({ error: 'Agents array required' })
  }

  const results = []
  for (const agentId of agents) {
    const { teamName, memberName } = parseAgentId(agentId)
    if (teamName) {
      const currentTask = backend.getTeammateCurrentTask(teamName, memberName)
      if (currentTask) {
        backend.completeTask(teamName, currentTask.id)
        results.push({ agent: agentId, success: true })
      } else {
        results.push({ agent: agentId, success: true }) // Already idle
      }
    } else {
      results.push({ agent: agentId, success: false, error: 'Agent not found' })
    }
  }

  addActivityEvent('batch_complete', {
    count: results.filter(r => r.success).length,
    agents
  }, req.session?.passport?.user)

  multiplayer.broadcastStateUpdate({ event: 'batch:complete', results })
  res.json({ success: true, results })
})

app.post('/api/batch/spawn', (req, res) => {
  const { rig, count = 1, prefix = 'agent' } = req.body

  if (!rig) {
    return res.status(400).json({ error: 'Team name required' })
  }

  if (!/^[a-zA-Z0-9_]+$/.test(prefix)) {
    return res.status(400).json({ error: 'Invalid prefix. Use alphanumeric or underscores only.' })
  }

  const results = []

  for (let i = 0; i < Math.min(count, 10); i++) {
    try {
      const name = `${prefix}_${Date.now()}_${i}`
      backend.spawnTeammate(rig, name)
      results.push({ name, success: true })

      multiplayer.broadcastStateUpdate({ event: 'polecat:spawned', rig, polecat: name })
    } catch (e) {
      results.push({ name: `${prefix}_${i}`, success: false, error: e.message })
    }
  }

  addActivityEvent('batch_spawn', {
    count: results.filter(r => r.success).length,
    rig,
    agents: results.filter(r => r.success).map(r => r.name)
  }, req.session?.passport?.user)

  res.json({ success: true, results })
})

// ===== PROJECT TEMPLATES =====

const TEMPLATES_FILE = join(GTGUI_DATA, 'templates.json')
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
    writeFileSync(TEMPLATES_FILE, JSON.stringify(projectTemplates, null, 2))
  } catch (e) {
    console.error('Failed to save templates:', e.message)
  }
}

loadTemplates()

app.get('/api/templates', (req, res) => {
  res.json({ templates: projectTemplates })
})

app.post('/api/templates', (req, res) => {
  const { name, description, defaultAgentCount = 1, taskTypes = [] } = req.body

  if (!name) {
    return res.status(400).json({ error: 'Template name required' })
  }

  const template = {
    id: `tpl-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    name,
    description: description || '',
    defaultAgentCount,
    taskTypes,
    createdAt: new Date().toISOString(),
    createdBy: req.session?.passport?.user || 'anonymous'
  }

  projectTemplates.push(template)
  saveTemplates()

  res.json({ success: true, template })
})

app.post('/api/templates/:id/create', (req, res) => {
  const { id } = req.params
  const { projectName } = req.body

  const template = projectTemplates.find(t => t.id === id)
  if (!template) {
    return res.status(404).json({ error: 'Template not found' })
  }

  if (!projectName) {
    return res.status(400).json({ error: 'Project name required' })
  }

  if (!/^[a-zA-Z0-9_]+$/.test(projectName)) {
    return res.status(400).json({ error: 'Invalid project name. Use alphanumeric or underscores only.' })
  }

  try {
    backend.createTeam(projectName)

    const teammates = []
    for (let i = 0; i < template.defaultAgentCount; i++) {
      const name = i === 0 ? KING_PENGUIN : (PENGUIN_NAMES[i - 1] || `penguin_${i}`)
      try {
        backend.spawnTeammate(projectName, name)
        teammates.push(name)
      } catch { /* ignore individual spawn failures */ }
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
      polecats: teammates
    })
  } catch (e) {
    res.status(500).json({ error: 'Failed to create project: ' + e.message })
  }
})

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

// ===== OPERATIONS DASHBOARD (simplified — no refinery/witness) =====

app.get('/api/operations', (req, res) => {
  const teams = backend.listTeams()
  const rigDetails = teams.map(team => {
    const teammates = backend.getTeammates(team.name)
    const tasks = backend.getTasksForTeam(team.name)

    return {
      name: team.name,
      polecat_count: teammates.length,
      polecats: teammates.map(t => ({ name: t.name, status: t.status })),
      tasks: {
        pending: tasks.filter(t => t.status === 'pending').length,
        in_progress: tasks.filter(t => t.status === 'in_progress').length,
        completed: tasks.filter(t => t.status === 'completed').length,
        total: tasks.length
      }
    }
  })

  const totalPolecats = rigDetails.reduce((sum, r) => sum + r.polecat_count, 0)

  res.json({
    town: {
      name: 'Agent Teams',
      summary: {
        rig_count: teams.length,
        polecat_count: totalPolecats
      }
    },
    agents: [],
    rigs: rigDetails,
    costs: costHistory
  })
})

// ===== NEW: Agent Teams Task endpoints =====

app.get('/api/teams/:name/tasks', (req, res) => {
  const tasks = backend.getTasksForTeam(req.params.name)
  res.json({ tasks })
})

app.post('/api/teams/:name/tasks', (req, res) => {
  const { subject, description, owner, activeForm } = req.body

  if (!subject) {
    return res.status(400).json({ error: 'Task subject required' })
  }

  const task = backend.createTask(req.params.name, { subject, description, owner, activeForm })
  res.json({ success: true, task })
})

// ===== EMPEROR (formerly Mayor / Team Lead) =====

app.post('/api/emperor/start', (req, res) => {
  // Check which team to start emperor for
  const teams = backend.listTeams()
  const teamName = req.body?.team || (teams.length > 0 ? teams[0].name : null)

  if (!teamName) {
    // No teams exist yet — create a default
    backend.createTeam('default')
  }

  const resolvedTeam = teamName || 'default'

  if (backend.isEmperorAlive(resolvedTeam)) {
    return res.json({ success: true, already_running: true })
  }

  try {
    backend.startEmperor(resolvedTeam)
    addActivityEvent('emperor_started', {}, req.session?.passport?.user)
    res.json({ success: true })
  } catch (e) {
    console.error('Failed to start Emperor:', e.message)
    res.status(500).json({ error: 'Failed to start Emperor session' })
  }
})

app.get('/api/emperor/status', (req, res) => {
  const teams = backend.listTeams()
  let running = false
  let teamName = null

  for (const team of teams) {
    if (backend.isEmperorAlive(team.name)) {
      running = true
      teamName = team.name
      break
    }
  }

  res.json({ running, team: teamName, emperorName: currentSettings.emperorName || 'Tiberius Claudius' })
})

app.post('/api/emperor/message', (req, res) => {
  const { message, team } = req.body
  if (!message) {
    return res.status(400).json({ error: 'Message required' })
  }

  // Find the team with active emperor
  const teams = backend.listTeams()
  const targetTeam = team || teams.find(t => backend.isEmperorAlive(t.name))?.name

  if (!targetTeam) {
    return res.status(400).json({ error: 'No active Emperor session found' })
  }

  const currentSettings = loadSettings()
  const success = backend.sendToEmperor(targetTeam, message, currentSettings.emperorName || 'Tiberius Claudius')
  if (success) {
    res.json({ success: true })
  } else {
    res.status(500).json({ error: 'Failed to send message to Emperor' })
  }
})

app.get('/api/emperor/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  // Find team with active emperor
  const teams = backend.listTeams()
  const teamName = teams.find(t => backend.isEmperorAlive(t.name))?.name

  if (!teamName) {
    res.write(`data: ${JSON.stringify({ type: 'text_delta', text: '(Emperor not running)' })}\n\n`)
    return
  }

  // Send initial captured output (skip raw terminal noise like theme picker)
  const initial = backend.captureEmperor(teamName)
  if (initial) {
    // Filter: only send if it looks like actual Claude conversation output
    // (not the first-run theme picker or startup ASCII art)
    const cleaned = initial.replace(/[\s\n\r]/g, '')
    const isNoise = cleaned.includes('Choosethetextstyle') || cleaned.includes('Syntaxhighlighting') || cleaned.length < 10
    if (!isNoise) {
      res.write(`data: ${JSON.stringify({ type: 'initial', content: initial })}\n\n`)
    }
  }

  // Poll tmux capture-pane every 2 seconds
  let lastOutput = initial || ''
  const interval = setInterval(() => {
    try {
      const current = backend.captureEmperor(teamName) || ''
      if (current !== lastOutput) {
        // Filter noise (theme picker, startup art)
        const cleaned = current.replace(/[\s\n\r]/g, '')
        const isNoise = cleaned.includes('Choosethetextstyle') || cleaned.includes('Syntaxhighlighting')
        if (!isNoise) {
          const newContent = current.length > lastOutput.length ? current.slice(lastOutput.length) : current
          res.write(`data: ${JSON.stringify({ type: 'text_delta', text: newContent })}\n\n`)
        }
        lastOutput = current
      }
    } catch { /* ignore */ }
  }, 2000)

  req.on('close', () => {
    clearInterval(interval)
  })
})

// Backward compat redirects for /api/mayor/* → /api/emperor/*
app.post('/api/mayor/start', (req, res) => res.redirect(307, '/api/emperor/start'))
app.get('/api/mayor/status', (req, res) => res.redirect('/api/emperor/status'))
app.post('/api/mayor/message', (req, res) => res.redirect(307, '/api/emperor/message'))
app.get('/api/mayor/stream', (req, res) => res.redirect('/api/emperor/stream'))

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

// ===== TERMINAL WebSocket: tmux attach bridge via socket.io =====
const terminalNs = multiplayer.io.of('/terminal')

terminalNs.use((socket, next) => {
  // Apply session middleware to parse cookies (same pattern as multiplayer namespace)
  sessionMiddleware(socket.request, {}, next)
})
terminalNs.use((socket, next) => {
  const session = socket.request.session
  if (session?.passport?.user || DEV_MODE) {
    next()
  } else {
    console.error('[terminal] Auth rejected — no passport user in session')
    next(new Error('Authentication required'))
  }
})

terminalNs.on('connection', (socket) => {
  console.log(`[terminal] Client connected: ${socket.id}`)
  let tmuxProc = null
  let currentSession = null
  let currentTeam = null

  socket.on('attach', (data) => {
    const { sessionName } = data
    if (!sessionName || !/^colony_[a-zA-Z0-9_]+$/.test(sessionName)) {
      socket.emit('error', { message: 'Invalid session name' })
      return
    }

    // Parse teamName from session name for Docker routing
    const teamName = backend._teamFromTmuxName(sessionName)

    // Check session exists
    if (!backend.isTmuxSessionAlive(sessionName, { teamName })) {
      socket.emit('error', { message: 'Session not found or not running' })
      return
    }

    // Kill any existing attach process
    if (tmuxProc) {
      try { tmuxProc.kill() } catch { /* ignore */ }
    }

    const cols = (data.cols || 120) - 1  // -1 to prevent right-edge clipping (e.g. tmux date)
    const rows = data.rows || 40
    const safeSession = sessionName.replace(/'/g, "'\\''")
    const isDocker = backend.dockerEnabled && teamName

    // Both modes use node-pty for proper PTY with resize support.
    // Docker mode: stty raw -echo on outer PTY prevents double line-discipline
    // interference (buffering, echo, space eating) before exec'ing docker.
    let cmd, args
    if (isDocker) {
      const container = backend._containerName(teamName)
      cmd = 'sh'
      args = ['-c', `stty raw -echo; exec docker exec -it -e TERM=xterm-256color -e LANG=en_US.UTF-8 -e LC_ALL=en_US.UTF-8 -e COLUMNS=${cols} -e LINES=${rows} ${container} tmux attach-session -t '${safeSession}'`]
    } else {
      cmd = 'tmux'
      args = ['attach-session', '-t', sessionName]
    }

    const proc = pty.spawn(cmd, args, {
      name: 'xterm-256color',
      cols,
      rows,
      env: { ...process.env, TERM: 'xterm-256color' }
    })

    tmuxProc = proc
    console.log(`[terminal] Attached to ${sessionName} (PID ${proc.pid}, ${cols}x${rows})${isDocker ? ' [docker]' : ''}`)

    proc.onData((d) => socket.emit('output', d))
    proc.onExit(({ exitCode }) => {
      console.log(`[terminal] tmux attach exited (code ${exitCode})`)
      socket.emit('exit', { code: exitCode })
      tmuxProc = null
    })

    currentSession = sessionName
    currentTeam = teamName

    // Force tmux to resize after attach (belt and suspenders with COLUMNS/LINES)
    if (isDocker) {
      setTimeout(() => {
        try {
          const container = backend._containerName(teamName)
          execSync(`docker exec ${container} tmux resize-window -t '${safeSession}' -x ${cols} -y ${rows}`, { timeout: 3000 })
        } catch { /* ignore */ }
      }, 500)
    }

    socket.emit('attached', { sessionName })
  })

  socket.on('input', (data) => {
    if (tmuxProc) {
      tmuxProc.write(data)
    }
  })

  socket.on('resize', (data) => {
    if (data.cols && data.rows && tmuxProc) {
      try {
        const c = parseInt(data.cols) - 1  // -1 to prevent right-edge clipping
        const r = parseInt(data.rows)
        tmuxProc.resize(c, r)
        // Also resize tmux window inside Docker container
        if (currentTeam && backend.dockerEnabled) {
          const container = backend._containerName(currentTeam)
          const safeSession = currentSession.replace(/'/g, "'\\''")
          execSync(`docker exec ${container} tmux resize-window -t '${safeSession}' -x ${c} -y ${r}`, { timeout: 3000 })
        }
      } catch { /* ignore */ }
    }
  })

  socket.on('disconnect', () => {
    console.log(`[terminal] Client disconnected: ${socket.id}`)
    if (tmuxProc) {
      // Detach cleanly — send tmux detach key (Ctrl-B d by default, but we just kill)
      try { tmuxProc.kill() } catch { /* ignore */ }
      tmuxProc = null
    }
    // Invalidate activity cache so next status poll re-checks this session
    if (currentSession && currentTeam) {
      backend.invalidateTmuxActivityCache(currentSession, currentTeam)
    }
  })
})

const PORT = process.env.PORT || 8080
httpServer.listen(PORT, () => {
  console.log(`GTGUI server running at http://localhost:${PORT}`)
  console.log(`Data directory: ${GTGUI_DATA}`)
  console.log(`Teams root: ${backend.teamsRoot}`)
  console.log(`Tasks root: ${backend.tasksRoot}`)
  console.log(`WebSocket enabled for multiplayer + terminal`)
  if (!process.env.GITHUB_CLIENT_ID) {
    console.log(`GitHub OAuth: Not configured (dev mode enabled)`)
  } else {
    console.log(`GitHub OAuth: Configured`)
  }
})
