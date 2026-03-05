import { join } from 'path'
import { homedir } from 'os'
import {
  readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync,
  rmSync, statSync, unlinkSync, openSync, closeSync
} from 'fs'
import { spawn } from 'child_process'
import { createInterface } from 'readline'

export class AgentTeamsBackend {
  constructor(config = {}) {
    this.claudePath = config.claudePath || 'claude'
    this.teamsRoot = config.teamsRoot || join(homedir(), '.claude', 'teams')
    this.tasksRoot = config.tasksRoot || join(homedir(), '.claude', 'tasks')

    // Session registry: sessionKey → SessionState
    this.sessions = new Map()
  }

  _sessionKey(teamName, name) {
    return `${teamName}/${name}`
  }

  _createSessionState(type) {
    return {
      type,                        // 'cli'
      process: null,               // ChildProcess
      sessionId: null,             // Claude session ID for resume
      abortController: new AbortController(),
      messages: [],                // Rolling buffer (max 500)
      status: 'idle',             // 'running' | 'idle' | 'error'
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      lastActivity: Date.now(),
      streamListeners: new Set()
    }
  }

  // ===== TEAM MANAGEMENT =====

  listTeams() {
    try {
      if (!existsSync(this.teamsRoot)) return []
      return readdirSync(this.teamsRoot, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => ({
          name: d.name,
          path: join(this.teamsRoot, d.name)
        }))
    } catch {
      return []
    }
  }

  getTeamConfig(teamName) {
    const configPath = join(this.teamsRoot, teamName, 'config.json')
    try {
      if (!existsSync(configPath)) return null
      return JSON.parse(readFileSync(configPath, 'utf-8'))
    } catch {
      return null
    }
  }

  createTeam(teamName) {
    const teamDir = join(this.teamsRoot, teamName)
    const taskDir = join(this.tasksRoot, teamName)

    mkdirSync(teamDir, { recursive: true })
    mkdirSync(taskDir, { recursive: true })

    const config = { members: [] }
    writeFileSync(join(teamDir, 'config.json'), JSON.stringify(config, null, 2))

    return { name: teamName, path: teamDir }
  }

  deleteTeam(teamName) {
    const teamDir = join(this.teamsRoot, teamName)
    const taskDir = join(this.tasksRoot, teamName)

    // Stop all sessions for this team
    try {
      const members = this.getTeammates(teamName)
      for (const m of members) {
        this.stopTeammate(teamName, m.name)
      }
    } catch { /* ignore cleanup errors */ }

    if (existsSync(teamDir)) rmSync(teamDir, { recursive: true })
    if (existsSync(taskDir)) rmSync(taskDir, { recursive: true })
  }

  // ===== TEAMMATE MANAGEMENT =====

  getTeammates(teamName) {
    const config = this.getTeamConfig(teamName)
    if (!config?.members) return []

    const tasks = this.getTasksForTeam(teamName)

    return config.members.map(member => {
      const alive = this.isTeammateAlive(teamName, member.name)
      const memberTasks = tasks.filter(t => t.owner === member.name)
      const inProgressTask = memberTasks.find(t => t.status === 'in_progress')

      let status = 'idle'
      let issue = null
      let assignedAt = null

      if (inProgressTask) {
        status = 'working'
        issue = inProgressTask.subject
        assignedAt = inProgressTask.createdAt

        // Check if stuck by mtime
        if (inProgressTask.fileModifiedAt) {
          const elapsed = Date.now() - inProgressTask.fileModifiedAt
          if (elapsed > 1800000) { // 30 min default
            status = 'stuck'
          }
        }

        // If session is dead but task still in_progress, it's stuck
        if (!alive && status === 'working') {
          status = 'stuck'
        }
      }

      // Get cost from session if available
      const sessionCost = this.getSessionCost(teamName, member.name)

      return {
        name: member.name,
        rig: teamName,
        agentId: member.agentId || null,
        agentType: member.agentType || 'general-purpose',
        status,
        issue,
        assignedAt,
        sessionAlive: alive,
        tokensUsed: sessionCost.inputTokens + sessionCost.outputTokens,
        costUsd: sessionCost.costUsd,
        progress: 0
      }
    })
  }

  spawnTeammate(teamName, name, cwd = null) {
    // Ensure team exists
    const teamDir = join(this.teamsRoot, teamName)
    if (!existsSync(teamDir)) {
      this.createTeam(teamName)
    }

    const key = this._sessionKey(teamName, name)

    // Clean up existing session if any
    if (this.sessions.has(key)) {
      this._cleanupSession(key)
    }

    // Create session state (workers use CLI, deferred process start)
    const session = this._createSessionState('cli')
    if (cwd) session.cwd = cwd
    this.sessions.set(key, session)

    // Register in team config
    const config = this.getTeamConfig(teamName) || { members: [] }
    if (!config.members.find(m => m.name === name)) {
      config.members.push({
        name,
        agentId: `${teamName}-${name}-${Date.now()}`,
        agentType: 'general-purpose'
      })
      writeFileSync(join(teamDir, 'config.json'), JSON.stringify(config, null, 2))
    }

    return { name, sessionKey: key }
  }

  stopTeammate(teamName, name) {
    const key = this._sessionKey(teamName, name)
    return this._cleanupSession(key)
  }

  _cleanupSession(key) {
    const session = this.sessions.get(key)
    if (!session) return false

    try {
      if (session.process) {
        session.process.kill('SIGTERM')
      }
      session.abortController.abort()
    } catch { /* ignore */ }

    session.status = 'idle'
    session.streamListeners.clear()
    return true
  }

  isTeammateAlive(teamName, name) {
    const key = this._sessionKey(teamName, name)
    const session = this.sessions.get(key)
    if (!session) return false

    if (session.process) {
      return session.process.exitCode === null && !session.process.killed
    }

    // Session registered but no process yet (deferred start)
    return session.status === 'idle'
  }

  // Remove teammate from team config (does not kill session)
  removeTeammate(teamName, name) {
    const teamDir = join(this.teamsRoot, teamName)
    const configPath = join(teamDir, 'config.json')
    const config = this.getTeamConfig(teamName)
    if (!config) return

    config.members = config.members.filter(m => m.name !== name)
    writeFileSync(configPath, JSON.stringify(config, null, 2))
  }

  // ===== TASK MANAGEMENT =====

  getTasksForTeam(teamName) {
    const taskDir = join(this.tasksRoot, teamName)
    try {
      if (!existsSync(taskDir)) return []
      return readdirSync(taskDir)
        .filter(f => f.endsWith('.json') && f !== '.lock')
        .map(f => {
          try {
            const filePath = join(taskDir, f)
            const content = JSON.parse(readFileSync(filePath, 'utf-8'))
            const stat = statSync(filePath)
            return {
              ...content,
              fileModifiedAt: stat.mtimeMs
            }
          } catch {
            return null
          }
        })
        .filter(Boolean)
    } catch {
      return []
    }
  }

  _nextTaskId(teamName) {
    const tasks = this.getTasksForTeam(teamName)
    if (tasks.length === 0) return '1'
    const maxId = Math.max(...tasks.map(t => parseInt(t.id) || 0))
    return String(maxId + 1)
  }

  _lockTasks(teamName) {
    const lockPath = join(this.tasksRoot, teamName, '.lock')
    const staleThreshold = 5000 // 5 seconds

    // Check for stale lock
    if (existsSync(lockPath)) {
      try {
        const stat = statSync(lockPath)
        if (Date.now() - stat.mtimeMs > staleThreshold) {
          unlinkSync(lockPath)
        }
      } catch { /* ignore */ }
    }

    try {
      const fd = openSync(lockPath, 'wx')
      closeSync(fd)
      return true
    } catch {
      return false
    }
  }

  _unlockTasks(teamName) {
    const lockPath = join(this.tasksRoot, teamName, '.lock')
    try {
      if (existsSync(lockPath)) unlinkSync(lockPath)
    } catch { /* ignore */ }
  }

  createTask(teamName, { subject, description, owner, activeForm }) {
    const taskDir = join(this.tasksRoot, teamName)
    mkdirSync(taskDir, { recursive: true })

    const id = this._nextTaskId(teamName)
    const task = {
      id,
      subject: subject || '',
      description: description || '',
      activeForm: activeForm || subject || '',
      status: owner ? 'in_progress' : 'pending',
      owner: owner || null,
      blocks: [],
      blockedBy: [],
      createdAt: new Date().toISOString()
    }

    this._lockTasks(teamName)
    try {
      writeFileSync(join(taskDir, `${id}.json`), JSON.stringify(task, null, 2))
    } finally {
      this._unlockTasks(teamName)
    }

    return task
  }

  updateTask(teamName, taskId, updates) {
    const taskPath = join(this.tasksRoot, teamName, `${taskId}.json`)
    if (!existsSync(taskPath)) return null

    this._lockTasks(teamName)
    try {
      const task = JSON.parse(readFileSync(taskPath, 'utf-8'))
      Object.assign(task, updates)
      writeFileSync(taskPath, JSON.stringify(task, null, 2))
      return task
    } finally {
      this._unlockTasks(teamName)
    }
  }

  assignTask(teamName, taskId, memberName) {
    return this.updateTask(teamName, taskId, {
      owner: memberName,
      status: 'in_progress'
    })
  }

  completeTask(teamName, taskId) {
    return this.updateTask(teamName, taskId, {
      status: 'completed',
      completedAt: new Date().toISOString()
    })
  }

  deleteTask(teamName, taskId) {
    const taskPath = join(this.tasksRoot, teamName, `${taskId}.json`)
    try {
      if (existsSync(taskPath)) unlinkSync(taskPath)
      return true
    } catch {
      return false
    }
  }

  // Get the current in-progress task for a teammate
  getTeammateCurrentTask(teamName, memberName) {
    const tasks = this.getTasksForTeam(teamName)
    return tasks.find(t => t.owner === memberName && t.status === 'in_progress') || null
  }

  // ===== SESSION I/O =====

  sendToSession(teamName, name, msg) {
    const key = this._sessionKey(teamName, name)
    let session = this.sessions.get(key)

    if (!session) {
      // Auto-create session if not registered
      this.spawnTeammate(teamName, name)
      session = this.sessions.get(key)
    }

    return this._sendToCLISession(key, session, msg)
  }

  _sendToCLISession(key, session, msg) {
    // If an existing process is still running, kill it first
    if (session.process && session.process.exitCode === null) {
      session.process.kill('SIGTERM')
    }

    const args = ['-p', msg, '--output-format', 'stream-json', '--dangerously-skip-permissions']

    // Resume if we have a prior session ID
    if (session.sessionId) {
      args.push('--resume', session.sessionId)
    }

    if (session.cwd) {
      args.push('--add-dir', session.cwd)
    }

    try {
      const proc = spawn(this.claudePath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env }
      })

      session.process = proc
      session.status = 'running'
      session.lastActivity = Date.now()

      // Parse NDJSON from stdout
      this._processCliStream(key, session, proc)

      proc.on('exit', (code) => {
        session.status = code === 0 ? 'idle' : 'error'
        session.lastActivity = Date.now()
        // Notify listeners of completion
        this._notifyListeners(key, { type: 'session_end', code })
      })

      proc.on('error', (err) => {
        session.status = 'error'
        session.messages.push({ type: 'error', text: err.message, ts: Date.now() })
        this._notifyListeners(key, { type: 'error', text: err.message })
      })

      return true
    } catch (e) {
      session.status = 'error'
      return false
    }
  }

  _processCliStream(key, session, proc) {
    const rl = createInterface({ input: proc.stdout })

    rl.on('line', (line) => {
      try {
        const msg = JSON.parse(line)
        session.lastActivity = Date.now()

        // Extract session ID from init message
        if (msg.type === 'system' && msg.subtype === 'init') {
          session.sessionId = msg.session_id
        }

        // Accumulate text from assistant messages
        if (msg.type === 'assistant' && msg.message?.content) {
          for (const block of msg.message.content) {
            if (block.type === 'text') {
              this._addMessage(session, { type: 'text', text: block.text, ts: Date.now() })
              this._notifyListeners(key, { type: 'text_delta', text: block.text })
            }
          }
        }

        // Streaming partial text
        if (msg.type === 'stream_event' && msg.event?.delta?.type === 'text_delta') {
          const text = msg.event.delta.text
          this._addMessage(session, { type: 'text_delta', text, ts: Date.now() })
          this._notifyListeners(key, { type: 'text_delta', text })
        }

        // Tool progress
        if (msg.type === 'tool_progress') {
          this._notifyListeners(key, {
            type: 'tool_progress',
            tool: msg.tool_name,
            elapsed: msg.elapsed_time_seconds
          })
        }

        // Result with cost
        if (msg.type === 'result') {
          if (msg.total_cost_usd !== undefined) {
            session.costUsd = msg.total_cost_usd
          }
          if (msg.usage) {
            session.inputTokens = msg.usage.input_tokens || 0
            session.outputTokens = msg.usage.output_tokens || 0
          }
          const resultText = msg.result || ''
          this._addMessage(session, { type: 'result', text: resultText, ts: Date.now() })
          this._notifyListeners(key, {
            type: 'result',
            text: resultText,
            cost: { costUsd: session.costUsd, inputTokens: session.inputTokens, outputTokens: session.outputTokens }
          })
        }
      } catch {
        // Non-JSON line, ignore
      }
    })

    // Also capture stderr for diagnostics
    if (proc.stderr) {
      const errRl = createInterface({ input: proc.stderr })
      errRl.on('line', (line) => {
        this._addMessage(session, { type: 'stderr', text: line, ts: Date.now() })
      })
    }
  }

  _addMessage(session, msg) {
    session.messages.push(msg)
    if (session.messages.length > 500) {
      session.messages = session.messages.slice(-400)
    }
  }

  _notifyListeners(key, event) {
    const session = this.sessions.get(key)
    if (!session) return
    for (const listener of session.streamListeners) {
      try {
        listener(event)
      } catch { /* ignore listener errors */ }
    }
  }

  captureOutput(teamName, name, lines = 200) {
    const key = this._sessionKey(teamName, name)
    const session = this.sessions.get(key)
    if (!session) return null

    // Build text from stored messages
    const output = session.messages
      .slice(-lines)
      .map(m => {
        if (m.type === 'text' || m.type === 'text_delta' || m.type === 'result') return m.text
        if (m.type === 'stderr') return `[stderr] ${m.text}`
        if (m.type === 'error') return `[error] ${m.text}`
        return null
      })
      .filter(Boolean)
      .join('')

    return output || null
  }

  // ===== STREAM SUBSCRIPTIONS =====

  subscribeToStream(teamName, name, listener) {
    const key = this._sessionKey(teamName, name)
    const session = this.sessions.get(key)
    if (!session) return () => {}

    session.streamListeners.add(listener)

    // Return unsubscribe function
    return () => {
      session.streamListeners.delete(listener)
    }
  }

  getSessionCost(teamName, name) {
    const key = this._sessionKey(teamName, name)
    const session = this.sessions.get(key)
    if (!session) return { costUsd: 0, inputTokens: 0, outputTokens: 0 }

    return {
      costUsd: session.costUsd,
      inputTokens: session.inputTokens,
      outputTokens: session.outputTokens
    }
  }

  // ===== STUCK DETECTION =====

  checkStuck(settings = {}) {
    const stuckTimeThreshold = settings.stuckTimeThreshold || 1800000 // 30 min
    const alerts = []

    for (const team of this.listTeams()) {
      const tasks = this.getTasksForTeam(team.name)
      for (const task of tasks) {
        if (task.status !== 'in_progress' || !task.owner) continue

        const elapsed = Date.now() - (task.fileModifiedAt || Date.now())
        const alive = this.isTeammateAlive(team.name, task.owner)

        if (elapsed > stuckTimeThreshold || !alive) {
          alerts.push({
            type: !alive ? 'session_dead' : 'timeout',
            agent: task.owner,
            rig: team.name,
            task: task.subject,
            elapsed,
            sessionAlive: alive
          })
        }
      }
    }

    return alerts
  }

  // ===== EMPEROR (formerly Mayor / Team Lead) =====

  async startEmperor(teamName, cwd = null) {
    const key = this._sessionKey(teamName, 'emperor')

    // Clean up existing session
    if (this.sessions.has(key)) {
      this._cleanupSession(key)
    }

    const type = 'cli'
    const session = this._createSessionState(type)
    if (cwd) session.cwd = cwd
    this.sessions.set(key, session)

    return true
  }

  sendToEmperor(teamName, msg) {
    const key = this._sessionKey(teamName, 'emperor')
    const session = this.sessions.get(key)

    // Prepend context on first message (no prior session)
    if (session && !session.sessionId) {
      const teams = this.listTeams()
      const teamSummary = teams.map(t => {
        const config = this.getTeamConfig(t)
        const members = config?.members?.map(m => m.name).join(', ') || 'none'
        return `  - ${t}: members=[${members}]`
      }).join('\n')

      const context = [
        'You are the Emperor — the colony coordinator for Penguin Colony.',
        'You manage teams of Claude Code agents that work on software projects.',
        '',
        'Your capabilities:',
        '- Create teams/projects and assign tasks to agents',
        '- Monitor agent progress and reassign stuck work',
        '- Coordinate multi-agent workflows across colonies',
        '',
        'Environment:',
        `- Teams root: ${this.teamsRoot}`,
        `- Tasks root: ${this.tasksRoot}`,
        `- Active teams:\n${teamSummary || '  (none)'}`,
        '',
        'Respond concisely. The user interacts through a chat panel in a Club Penguin-style UI.',
        '',
        '---',
        '',
        'User message:',
        msg
      ].join('\n')

      return this.sendToSession(teamName, 'emperor', context)
    }

    return this.sendToSession(teamName, 'emperor', msg)
  }

  captureEmperor(teamName, lines = 200) {
    return this.captureOutput(teamName, 'emperor', lines)
  }

  isEmperorAlive(teamName) {
    return this.isTeammateAlive(teamName, 'emperor')
  }

  // Backward compat aliases
  startLead(teamName, cwd) { return this.startEmperor(teamName, cwd) }
  sendToLead(teamName, msg) { return this.sendToEmperor(teamName, msg) }
  captureLead(teamName, lines) { return this.captureEmperor(teamName, lines) }
  isLeadAlive(teamName) { return this.isEmperorAlive(teamName) }
}
