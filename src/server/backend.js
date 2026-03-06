import { join } from 'path'
import { homedir } from 'os'
import {
  readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync,
  rmSync, statSync, unlinkSync, openSync, closeSync
} from 'fs'
import { execSync } from 'child_process'

export class AgentTeamsBackend {
  constructor(config = {}) {
    this.claudePath = config.claudePath || 'claude'
    this.teamsRoot = config.teamsRoot || join(homedir(), '.claude', 'teams')
    this.tasksRoot = config.tasksRoot || join(homedir(), '.claude', 'tasks')
    this.dockerEnabled = config.dockerEnabled ?? false
    this.dockerImage = config.dockerImage || 'colony-sandbox'
    this.claudeAuthDir = config.claudeAuthDir || join(homedir(), '.claude')
    this.projectsRoot = config.projectsRoot || '/workspace'
    this.containerMemory = config.containerMemory || '4g'
    this.containerCpus = config.containerCpus || '2'
    this.networkIsolation = config.networkIsolation ?? false
  }

  // ===== DOCKER CONTAINER LIFECYCLE =====

  _containerName(teamName) {
    return `colony_${teamName}`
  }

  ensureContainer(teamName) {
    if (!this.dockerEnabled) return
    const name = this._containerName(teamName)

    // Check if already running
    try {
      const state = execSync(
        `docker inspect -f '{{.State.Running}}' ${JSON.stringify(name)} 2>/dev/null`,
        { encoding: 'utf-8' }
      ).trim()
      if (state === 'true') {
        this._ensureContainerOnboarding(name)
        return
      }
    } catch { /* container doesn't exist */ }

    // Remove stopped container if exists
    try { execSync(`docker rm -f ${JSON.stringify(name)} 2>/dev/null`) } catch {}

    // Build docker run args
    const args = [
      'docker', 'run', '-d',
      '--name', name,
      '-v', `${this.claudeAuthDir}:/home/agent/.claude`,
      '-v', `${join(homedir(), '.claude.json')}:/home/agent/.claude.json`,
      '-e', 'NPM_CONFIG_IGNORE_SCRIPTS=true',
      '-e', 'NPM_CONFIG_AUDIT_LEVEL=critical',
      '-e', 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1',
      `--memory=${this.containerMemory}`,
      `--cpus=${this.containerCpus}`,
      '--cap-drop=ALL',
      '--cap-add=DAC_OVERRIDE',
      '--security-opt=no-new-privileges',
    ]

    if (this.networkIsolation) {
      args.push('--network=none')
    }

    args.push(this.dockerImage)

    execSync(args.map(a => a.includes(' ') ? JSON.stringify(a) : a).join(' '))
    console.log(`[docker] Started container: ${name}`)
    this._ensureContainerOnboarding(name)
  }

  // Copy host's .claude.json into container so Claude Code skips onboarding/theme picker
  _ensureContainerOnboarding(containerName) {
    try {
      const hostFile = join(homedir(), '.claude.json')
      execSync(`docker cp ${JSON.stringify(hostFile)} ${JSON.stringify(containerName + ':/home/agent/.claude.json')}`, { timeout: 5000 })
    } catch { /* ignore */ }
  }

  stopContainer(teamName) {
    if (!this.dockerEnabled) return
    const name = this._containerName(teamName)
    try {
      execSync(`docker stop ${JSON.stringify(name)} && docker rm ${JSON.stringify(name)}`)
      console.log(`[docker] Stopped container: ${name}`)
    } catch {}
  }

  isContainerRunning(teamName) {
    if (!this.dockerEnabled) return true  // passthrough when docker disabled
    const name = this._containerName(teamName)
    try {
      const state = execSync(
        `docker inspect -f '{{.State.Running}}' ${JSON.stringify(name)} 2>/dev/null`,
        { encoding: 'utf-8' }
      ).trim()
      return state === 'true'
    } catch { return false }
  }

  // Execute a command, routing through docker exec when enabled
  _exec(teamName, cmd, options = {}) {
    if (this.dockerEnabled && teamName) {
      const container = this._containerName(teamName)
      const dockerArgs = ['docker', 'exec']
      if (options.interactive) dockerArgs.push('-it')
      dockerArgs.push(container)
      // cmd may be a string; wrap in bash -c for compound commands
      const fullCmd = `${dockerArgs.join(' ')} bash -c ${JSON.stringify(cmd)}`
      return execSync(fullCmd, {
        encoding: options.encoding,
        timeout: options.timeout
      })
    }
    return execSync(cmd, { encoding: options.encoding, timeout: options.timeout })
  }

  // Parse teamName from a tmux session name (colony_{team}_{member})
  // Both team and member names can contain underscores, so match against known teams
  _teamFromTmuxName(sessionName) {
    if (!sessionName.startsWith('colony_')) return null
    const rest = sessionName.slice(7) // strip "colony_"
    // Try matching against known team names (longest first to avoid partial matches)
    try {
      const teams = readdirSync(this.teamsRoot)
        .filter(d => existsSync(join(this.teamsRoot, d, 'config.json')))
        .sort((a, b) => b.length - a.length) // longest first
      for (const team of teams) {
        if (rest.startsWith(team + '_')) return team
      }
    } catch { /* teams dir may not exist */ }
    // Fallback: first segment (works for simple names without underscores)
    const m = rest.match(/^([^_]+)/)
    return m ? m[1] : null
  }

  // ===== TMUX SESSION MANAGEMENT =====

  // Tmux session naming: colony_{teamName}_{memberName}
  _tmuxName(teamName, memberName) {
    return `colony_${teamName}_${memberName}`
  }

  // Spawn a new Claude Code interactive session in tmux
  spawnTmuxSession(sessionName, prompt = null, options = {}) {
    const teamName = options.teamName || this._teamFromTmuxName(sessionName)

    // Use 'claude' in Docker (resolved via container PATH) vs host absolute path
    const claudeBin = (this.dockerEnabled && teamName) ? 'claude' : this.claudePath
    let claudeCmd = claudeBin + ' --dangerously-skip-permissions'
    if (options.resumeSessionId) {
      // Sanitize session ID to prevent injection (alphanumeric + hyphens only)
      const safeId = String(options.resumeSessionId).replace(/[^a-zA-Z0-9_-]/g, '')
      if (safeId) claudeCmd += ` --resume ${safeId}`
    }
    if (prompt && !options.resumeSessionId) {
      // Escape for shell
      const escaped = prompt.replace(/'/g, "'\\''")
      claudeCmd += ` '${escaped}'`
    }

    // Set Agent Teams env var in the tmux session
    const envPrefix = 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1'
    const fullCmd = `${envPrefix} ${claudeCmd}`

    // Escape session name for tmux
    const safeSession = sessionName.replace(/'/g, "'\\''")
    const safeCmd = fullCmd.replace(/'/g, "'\\''")
    // Session auto-destroys when claude exits (no lingering shell)
    // Use ; for set-option so failures don't abort the spawn (defaults are already off)
    const tmuxCmds = `tmux new-session -d -s '${safeSession}' '${safeCmd}'; tmux set-option -t '${safeSession}' remain-on-exit off 2>/dev/null; tmux set-option -t '${safeSession}' destroy-unattached off 2>/dev/null`

    if (this.dockerEnabled && teamName) {
      this.ensureContainer(teamName)
      this._exec(teamName, tmuxCmds)
    } else {
      execSync(tmuxCmds)
    }
    console.log(`[tmux] Spawned session: ${sessionName}`)
  }

  // Send a message to a running tmux session (type into it)
  sendToTmuxSession(sessionName, message, options = {}) {
    const teamName = options.teamName || this._teamFromTmuxName(sessionName)
    const safeSession = sessionName.replace(/'/g, "'\\''")

    if (this.dockerEnabled && teamName) {
      // Pipe message into container via base64 to avoid shell escaping issues
      const container = this._containerName(teamName)
      const b64 = Buffer.from(message).toString('base64')
      const innerCmd = `echo '${b64}' | base64 -d > /tmp/msg_$$ && tmux load-buffer /tmp/msg_$$ \\; paste-buffer -t '${safeSession}' \\; send-keys -t '${safeSession}' Enter && rm -f /tmp/msg_$$`
      execSync(`docker exec ${JSON.stringify(container)} bash -c ${JSON.stringify(innerCmd)}`)
      return
    }

    // Host-based: write temp file, load-buffer, paste-buffer
    const tmpFile = `/tmp/colony_msg_${Date.now()}`
    writeFileSync(tmpFile, message)
    try {
      execSync(`tmux load-buffer '${tmpFile}' \\; paste-buffer -t '${safeSession}' \\; send-keys -t '${safeSession}' Enter`)
    } finally {
      try { unlinkSync(tmpFile) } catch { /* ignore */ }
    }
  }

  // Capture recent output from tmux pane
  captureTmuxOutput(sessionName, lines = 200, options = {}) {
    const teamName = options.teamName || this._teamFromTmuxName(sessionName)
    try {
      const safeSession = sessionName.replace(/'/g, "'\\''")
      const cmd = `tmux capture-pane -t '${safeSession}' -p -S -${lines}`
      return this._exec(teamName, cmd, { encoding: 'utf-8', timeout: 5000 })
    } catch {
      return null
    }
  }

  // Check if a tmux session exists
  isTmuxSessionAlive(sessionName, options = {}) {
    const teamName = options.teamName || this._teamFromTmuxName(sessionName)
    try {
      const safeSession = sessionName.replace(/'/g, "'\\''")
      const cmd = `tmux has-session -t '${safeSession}' 2>/dev/null`
      this._exec(teamName, cmd)
      return true
    } catch {
      return false
    }
  }

  // Kill a tmux session
  killTmuxSession(sessionName, options = {}) {
    const teamName = options.teamName || this._teamFromTmuxName(sessionName)
    try {
      const safeSession = sessionName.replace(/'/g, "'\\''")
      const cmd = `tmux kill-session -t '${safeSession}'`
      this._exec(teamName, cmd)
      console.log(`[tmux] Killed session: ${sessionName}`)
      return true
    } catch {
      return false
    }
  }

  // List all colony tmux sessions
  // When docker is enabled and teamName given, list sessions inside that container
  listTmuxSessions(teamName = null) {
    const cmd = 'tmux list-sessions -F "#{session_name}" 2>/dev/null'
    try {
      if (this.dockerEnabled && teamName) {
        if (!this.isContainerRunning(teamName)) return []
        const output = this._exec(teamName, cmd, { encoding: 'utf-8', timeout: 5000 })
        return output.trim().split('\n').filter(s => s.startsWith('colony_'))
      }
      const output = execSync(cmd, { encoding: 'utf-8', timeout: 5000 })
      return output.trim().split('\n').filter(s => s.startsWith('colony_'))
    } catch {
      return []
    }
  }

  // ===== PERSISTENT SESSION MAP =====
  // Stored at ~/.claude/teams/{teamName}/sessions.json
  // Maps member names to tmux session names + Claude session IDs

  _getSessionMap(teamName) {
    const mapPath = join(this.teamsRoot, teamName, 'sessions.json')
    try {
      if (!existsSync(mapPath)) return {}
      return JSON.parse(readFileSync(mapPath, 'utf-8'))
    } catch {
      return {}
    }
  }

  _saveSessionMap(teamName, map) {
    const mapPath = join(this.teamsRoot, teamName, 'sessions.json')
    try {
      writeFileSync(mapPath, JSON.stringify(map, null, 2))
    } catch (e) {
      console.error(`[session-map] Failed to save for ${teamName}:`, e.message)
    }
  }

  // On startup: reconcile session map with live tmux sessions
  reassociateSessions(teamName) {
    const map = this._getSessionMap(teamName)
    const liveSessions = this.listTmuxSessions(teamName)
    let changed = false

    for (const [member, info] of Object.entries(map)) {
      if (!info.tmuxSession) continue
      const alive = liveSessions.includes(info.tmuxSession)
      if (info.alive !== alive) {
        info.alive = alive
        changed = true
      }
    }

    if (changed) this._saveSessionMap(teamName, map)
    return map
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

    // Start Docker container for this team if enabled
    this.ensureContainer(teamName)

    return { name: teamName, path: teamDir }
  }

  deleteTeam(teamName) {
    const teamDir = join(this.teamsRoot, teamName)
    const taskDir = join(this.tasksRoot, teamName)

    // Kill all tmux sessions for this team
    try {
      const members = this.getTeammates(teamName)
      for (const m of members) {
        this.stopTeammate(teamName, m.name)
      }
    } catch { /* ignore cleanup errors */ }

    // Stop and remove Docker container for this team
    this.stopContainer(teamName)

    if (existsSync(teamDir)) rmSync(teamDir, { recursive: true })
    if (existsSync(taskDir)) rmSync(taskDir, { recursive: true })
  }

  // ===== TEAMMATE MANAGEMENT =====

  getTeammates(teamName) {
    const config = this.getTeamConfig(teamName)
    if (!config?.members) return []

    const tasks = this.getTasksForTeam(teamName)
    const sessionMap = this._getSessionMap(teamName)
    const liveSessions = this.listTmuxSessions(teamName)

    return config.members.map(member => {
      const sInfo = sessionMap[member.name] || {}
      const tmuxName = sInfo.tmuxSession || this._tmuxName(teamName, member.name)
      const alive = liveSessions.includes(tmuxName)
      const inProgressTask = tasks.find(t => t.owner === member.name && t.status === 'in_progress')

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

      return {
        name: member.name,
        rig: teamName,
        agentId: member.agentId || null,
        agentType: member.agentType || 'general-purpose',
        status,
        issue,
        assignedAt,
        sessionAlive: alive,
        tmuxSession: tmuxName,
        claudeSessionId: sInfo.claudeSessionId || null,
        resumable: !alive && !!sInfo.claudeSessionId,
        tokensUsed: 0,
        costUsd: 0,
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

    const tmuxName = this._tmuxName(teamName, name)

    // Kill existing tmux session if any
    if (this.isTmuxSessionAlive(tmuxName, { teamName })) {
      this.killTmuxSession(tmuxName, { teamName })
    }

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

    // Record in session map
    const map = this._getSessionMap(teamName)
    map[name] = {
      tmuxSession: tmuxName,
      claudeSessionId: map[name]?.claudeSessionId || null,
      startedAt: new Date().toISOString(),
      alive: false  // Not yet spawned a tmux session — will be set true when work starts
    }
    this._saveSessionMap(teamName, map)

    return { name, tmuxSession: tmuxName }
  }

  stopTeammate(teamName, name) {
    const tmuxName = this._tmuxName(teamName, name)
    return this.killTmuxSession(tmuxName, { teamName })
  }

  isTeammateAlive(teamName, name) {
    const tmuxName = this._tmuxName(teamName, name)
    return this.isTmuxSessionAlive(tmuxName, { teamName })
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

  // Fully dismiss a teammate: kill tmux, fail tasks, remove from config + session map
  dismissTeammate(teamName, name) {
    // Kill tmux session
    this.stopTeammate(teamName, name)

    // Mark any in_progress tasks as failed
    const tasks = this.getTasksForTeam(teamName)
    for (const task of tasks) {
      if (task.owner === name && task.status === 'in_progress') {
        this.updateTask(teamName, task.id, {
          status: 'completed',
          completedAt: new Date().toISOString(),
          failReason: 'dismissed'
        })
      }
    }

    // Remove from session map
    const sessionMap = this._getSessionMap(teamName)
    delete sessionMap[name]
    this._saveSessionMap(teamName, sessionMap)

    // Remove from team config
    this.removeTeammate(teamName, name)

    return true
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

  // ===== SESSION I/O (tmux-based) =====

  sendToSession(teamName, name, msg) {
    const tmuxName = this._tmuxName(teamName, name)

    // If no tmux session exists, spawn one with this message as the initial prompt
    if (!this.isTmuxSessionAlive(tmuxName, { teamName })) {
      // Check session map for resumable session
      const sessionMap = this._getSessionMap(teamName)
      const sInfo = sessionMap[name] || {}

      this.spawnTmuxSession(tmuxName, msg, {
        teamName,
        resumeSessionId: sInfo.claudeSessionId || null
      })

      // Update session map
      sessionMap[name] = {
        ...sInfo,
        tmuxSession: tmuxName,
        startedAt: new Date().toISOString(),
        alive: true
      }
      this._saveSessionMap(teamName, sessionMap)
      return true
    }

    // Session already running — type the message into it
    this.sendToTmuxSession(tmuxName, msg, { teamName })
    return true
  }

  captureOutput(teamName, name, lines = 200) {
    const tmuxName = this._tmuxName(teamName, name)
    return this.captureTmuxOutput(tmuxName, lines, { teamName })
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

  startEmperor(teamName, cwd = null) {
    const tmuxName = this._tmuxName(teamName, 'emperor')

    if (this.isTmuxSessionAlive(tmuxName, { teamName })) {
      return true  // Already running
    }

    // Check for resumable session
    const sessionMap = this._getSessionMap(teamName)
    const sInfo = sessionMap.emperor || {}

    // Build the claude command with all features enabled
    const claudeBin = this.dockerEnabled ? 'claude' : this.claudePath
    let claudeCmd = claudeBin + ' --dangerously-skip-permissions --verbose'
    if (sInfo.claudeSessionId) {
      const safeId = String(sInfo.claudeSessionId).replace(/[^a-zA-Z0-9_-]/g, '')
      if (safeId) claudeCmd += ` --resume ${safeId}`
    }

    const envPrefix = 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1'
    const fullCmd = `${envPrefix} ${claudeCmd}`
    const safeSession = tmuxName.replace(/'/g, "'\\''")
    const safeCmd = fullCmd.replace(/'/g, "'\\''")
    const tmuxCmds = `tmux new-session -d -s '${safeSession}' '${safeCmd}'; tmux set-option -t '${safeSession}' remain-on-exit off 2>/dev/null; tmux set-option -t '${safeSession}' destroy-unattached off 2>/dev/null`

    if (this.dockerEnabled) {
      this.ensureContainer(teamName)
      this._exec(teamName, tmuxCmds)
    } else {
      execSync(tmuxCmds)
    }
    console.log(`[tmux] Started Emperor session: ${tmuxName}`)

    // Record in session map
    sessionMap.emperor = {
      ...sInfo,
      tmuxSession: tmuxName,
      startedAt: new Date().toISOString(),
      alive: true
    }
    this._saveSessionMap(teamName, sessionMap)

    // Register emperor in team config if not present
    const config = this.getTeamConfig(teamName) || { members: [] }
    if (!config.members.find(m => m.name === 'emperor')) {
      config.members.push({
        name: 'emperor',
        agentId: `${teamName}-emperor-${Date.now()}`,
        agentType: 'emperor'
      })
      const teamDir = join(this.teamsRoot, teamName)
      writeFileSync(join(teamDir, 'config.json'), JSON.stringify(config, null, 2))
    }

    return true
  }

  sendToEmperor(teamName, msg, emperorName = 'Tiberius Claudius') {
    const tmuxName = this._tmuxName(teamName, 'emperor')

    if (!this.isTmuxSessionAlive(tmuxName, { teamName })) {
      return false
    }

    // Check if this is the first message (no claudeSessionId yet means fresh session)
    const sessionMap = this._getSessionMap(teamName)
    const sInfo = sessionMap.emperor || {}
    const isFirstMessage = !sInfo.claudeSessionId && !sInfo.firstMessageSent

    if (isFirstMessage) {
      // First message includes context
      const teams = this.listTeams()
      const teamSummary = teams.map(t => {
        const config = this.getTeamConfig(t.name)
        const members = config?.members?.map(m => m.name).join(', ') || 'none'
        return `  - ${t.name}: members=[${members}]`
      }).join('\n')

      const context = [
        `You are ${emperorName}, the Emperor — colony coordinator for Penguin Colony.`,
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

      this.sendToTmuxSession(tmuxName, context, { teamName })

      // Mark first message sent
      sInfo.firstMessageSent = true
      sessionMap.emperor = sInfo
      this._saveSessionMap(teamName, sessionMap)
    } else {
      this.sendToTmuxSession(tmuxName, msg, { teamName })
    }

    return true
  }

  captureEmperor(teamName, lines = 200) {
    return this.captureOutput(teamName, 'emperor', lines)
  }

  isEmperorAlive(teamName) {
    return this.isTeammateAlive(teamName, 'emperor')
  }

  // Resume a dead session using its saved Claude session ID
  resumeSession(teamName, name) {
    const sessionMap = this._getSessionMap(teamName)
    const sInfo = sessionMap[name]
    if (!sInfo?.claudeSessionId) return false

    const tmuxName = sInfo.tmuxSession || this._tmuxName(teamName, name)

    // Kill existing if somehow alive
    if (this.isTmuxSessionAlive(tmuxName, { teamName })) {
      this.killTmuxSession(tmuxName, { teamName })
    }

    this.spawnTmuxSession(tmuxName, null, { teamName, resumeSessionId: sInfo.claudeSessionId })

    sInfo.alive = true
    sInfo.tmuxSession = tmuxName
    sInfo.startedAt = new Date().toISOString()
    this._saveSessionMap(teamName, sessionMap)
    return true
  }

  // Backward compat aliases
  startLead(teamName, cwd) { return this.startEmperor(teamName, cwd) }
  sendToLead(teamName, msg) { return this.sendToEmperor(teamName, msg) }
  captureLead(teamName, lines) { return this.captureEmperor(teamName, lines) }
  isLeadAlive(teamName) { return this.isEmperorAlive(teamName) }
}
