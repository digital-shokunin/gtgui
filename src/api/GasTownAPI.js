export class GasTownAPI {
  constructor(baseUrl = '/api') {
    this.baseUrl = baseUrl
  }

  async request(endpoint, options = {}) {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      ...options
    })

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`)
    }

    return response.json()
  }

  // Get overall town status
  async getStatus() {
    return this.request('/status')
  }

  // Get list of teams (rigs)
  async getRigs() {
    return this.request('/rigs')
  }

  // Create a new team
  async createRig(name) {
    return this.request('/rigs', {
      method: 'POST',
      body: JSON.stringify({ name })
    })
  }

  // Clone a repo into a project workspace
  async cloneRepo(rigName, repoUrl) {
    return this.request(`/rigs/${encodeURIComponent(rigName)}/clone`, {
      method: 'POST',
      body: JSON.stringify({ repoUrl })
    })
  }

  // Spawn a teammate in a team
  async spawnPolecat(rigName, polecatName = null, cwd = null) {
    return this.request(`/rigs/${rigName}/polecats`, {
      method: 'POST',
      body: JSON.stringify({ polecatName, cwd })
    })
  }

  // Get teammates for a team
  async getPolecats(rigName) {
    return this.request(`/rigs/${rigName}/polecats`)
  }

  // Assign work to an agent
  async sling(agentId, issueId) {
    return this.request('/sling', {
      method: 'POST',
      body: JSON.stringify({ agent: agentId, issue: issueId })
    })
  }

  // Get agent's current hook
  async getHook(agentId) {
    return this.request(`/agents/${encodeURIComponent(agentId)}/hook`)
  }

  // Get agent session logs (captured terminal output)
  async getAgentLogs(agentId, lines = 100) {
    return this.request(`/agents/${encodeURIComponent(agentId)}/logs?lines=${lines}`)
  }

  // Open SSE stream for live log tailing
  openLogStream(agentId) {
    const encoded = encodeURIComponent(agentId)
    return new EventSource(`${this.baseUrl}/agents/${encoded}/logs/stream`)
  }

  // Emergency stop
  async stop(agentId) {
    return this.request(`/agents/${encodeURIComponent(agentId)}/stop`, { method: 'POST' })
  }

  // Fully dismiss agent (stop, fail tasks, remove from config)
  async dismiss(agentId) {
    return this.request(`/agents/${encodeURIComponent(agentId)}/dismiss`, { method: 'POST' })
  }

  // Get costs
  async getCosts() {
    return this.request('/costs')
  }

  // Get settings
  async getSettings() {
    return this.request('/settings')
  }

  // Update settings
  async updateSettings(settings) {
    return this.request('/settings', {
      method: 'POST',
      body: JSON.stringify(settings)
    })
  }

  // Reassign work from one agent to another
  async reassign(oldAgentId, newAgentId, rig = null) {
    return this.request(`/agents/${encodeURIComponent(oldAgentId)}/reassign`, {
      method: 'POST',
      body: JSON.stringify({ newAgent: newAgentId, rig })
    })
  }

  // Mark agent's task as complete
  async markComplete(agentId) {
    return this.request(`/agents/${encodeURIComponent(agentId)}/complete`, {
      method: 'POST'
    })
  }

  // Get Docker sandbox status
  async getDockerStatus() {
    return this.request('/docker/status')
  }

  // Pause a rig's container (docker stop, preserves state)
  async pauseRig(rigName) {
    return this.request(`/rigs/${encodeURIComponent(rigName)}/pause`, { method: 'POST' })
  }

  // Resume a paused rig's container (docker start + auto-resume sessions)
  async resumeRigContainer(rigName) {
    return this.request(`/rigs/${encodeURIComponent(rigName)}/resume-container`, { method: 'POST' })
  }

  // ===== ACTIVITY FEED =====

  async getActivityFeed(options = {}) {
    const params = new URLSearchParams()
    if (options.limit) params.append('limit', options.limit)
    if (options.offset) params.append('offset', options.offset)
    if (options.type) params.append('type', options.type)
    if (options.project) params.append('project', options.project)
    if (options.agent) params.append('agent', options.agent)
    return this.request(`/activity?${params.toString()}`)
  }

  // ===== TASK QUEUE =====

  async getTaskQueue(project = null) {
    const params = project ? `?project=${encodeURIComponent(project)}` : ''
    return this.request(`/taskqueue${params}`)
  }

  async addTask(task) {
    return this.request('/taskqueue', {
      method: 'POST',
      body: JSON.stringify(task)
    })
  }

  async updateTask(taskId, updates) {
    return this.request(`/taskqueue/${encodeURIComponent(taskId)}`, {
      method: 'PUT',
      body: JSON.stringify(updates)
    })
  }

  async removeTask(taskId) {
    return this.request(`/taskqueue/${encodeURIComponent(taskId)}`, {
      method: 'DELETE'
    })
  }

  async assignTask(taskId, agent, rig = null) {
    return this.request(`/taskqueue/${encodeURIComponent(taskId)}/assign`, {
      method: 'POST',
      body: JSON.stringify({ agent, rig })
    })
  }

  // ===== COST DASHBOARD =====

  async getCostDashboard() {
    return this.request('/costs/dashboard')
  }

  async recordCost(agent, project, tokens) {
    return this.request('/costs/record', {
      method: 'POST',
      body: JSON.stringify({ agent, project, tokens })
    })
  }

  getCostExportUrl(from, to) {
    const params = new URLSearchParams()
    if (from) params.append('from', from)
    if (to) params.append('to', to)
    return `${this.baseUrl}/costs/export?${params.toString()}`
  }

  // ===== GITHUB INTEGRATION =====

  async getGitHubPRs(options = {}) {
    const params = new URLSearchParams()
    if (options.project) params.append('project', options.project)
    if (options.agent) params.append('agent', options.agent)
    if (options.status) params.append('status', options.status)
    return this.request(`/github/prs?${params.toString()}`)
  }

  async trackPR(prData) {
    return this.request('/github/prs', {
      method: 'POST',
      body: JSON.stringify(prData)
    })
  }

  async updatePR(prId, updates) {
    return this.request(`/github/prs/${encodeURIComponent(prId)}`, {
      method: 'PUT',
      body: JSON.stringify(updates)
    })
  }

  async removePR(prId) {
    return this.request(`/github/prs/${encodeURIComponent(prId)}`, {
      method: 'DELETE'
    })
  }

  // ===== BATCH OPERATIONS =====

  async batchStop(agents) {
    return this.request('/batch/stop', {
      method: 'POST',
      body: JSON.stringify({ agents })
    })
  }

  async batchComplete(agents) {
    return this.request('/batch/complete', {
      method: 'POST',
      body: JSON.stringify({ agents })
    })
  }

  async batchSpawn(rig, count, prefix = 'agent') {
    return this.request('/batch/spawn', {
      method: 'POST',
      body: JSON.stringify({ rig, count, prefix })
    })
  }

  // ===== PROJECT TEMPLATES =====

  async getTemplates() {
    return this.request('/templates')
  }

  async createTemplate(templateData) {
    return this.request('/templates', {
      method: 'POST',
      body: JSON.stringify(templateData)
    })
  }

  async createFromTemplate(templateId, projectName) {
    return this.request(`/templates/${encodeURIComponent(templateId)}/create`, {
      method: 'POST',
      body: JSON.stringify({ projectName })
    })
  }

  async deleteTemplate(templateId) {
    return this.request(`/templates/${encodeURIComponent(templateId)}`, {
      method: 'DELETE'
    })
  }

  // ===== EMPEROR =====

  async startEmperor() {
    return this.request('/emperor/start', { method: 'POST' })
  }

  async getEmperorStatus() {
    return this.request('/emperor/status')
  }

  async sendEmperorMessage(message) {
    return this.request('/emperor/message', {
      method: 'POST',
      body: JSON.stringify({ message })
    })
  }

  openEmperorStream() {
    return new EventSource(`${this.baseUrl}/emperor/stream`, { withCredentials: true })
  }

  // ===== OPERATIONS DASHBOARD =====

  async getOperations() {
    return this.request('/operations')
  }

  // ===== AGENT TEAMS TASKS (NEW) =====

  async getTeamTasks(teamName) {
    return this.request(`/teams/${encodeURIComponent(teamName)}/tasks`)
  }

  async createTeamTask(teamName, task) {
    return this.request(`/teams/${encodeURIComponent(teamName)}/tasks`, {
      method: 'POST',
      body: JSON.stringify(task)
    })
  }

  // ===== AGENT MESSAGING =====

  // Send a follow-up message to an agent's tmux session
  async sendAgentMessage(agentId, message) {
    return this.request(`/agents/${encodeURIComponent(agentId)}/message`, {
      method: 'POST',
      body: JSON.stringify({ message })
    })
  }

  // Resume a dead agent session using its saved Claude session ID
  async resumeAgent(agentId) {
    return this.request(`/agents/${encodeURIComponent(agentId)}/resume`, {
      method: 'POST'
    })
  }
}
