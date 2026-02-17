export class GasTownAPI {
  constructor(baseUrl = '/api') {
    this.baseUrl = baseUrl
  }

  async request(endpoint, options = {}) {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
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

  // Get list of rigs
  async getRigs() {
    return this.request('/rigs')
  }

  // Create a new rig
  async createRig(name) {
    return this.request('/rigs', {
      method: 'POST',
      body: JSON.stringify({ name })
    })
  }

  // Clone a repo into a rig
  async cloneRepo(rigName, repo, branch = null) {
    return this.request(`/rigs/${rigName}/clone`, {
      method: 'POST',
      body: JSON.stringify({ repo, branch })
    })
  }

  // Spawn a polecat in a rig
  async spawnPolecat(rigName, polecatName = null) {
    return this.request(`/rigs/${rigName}/polecats`, {
      method: 'POST',
      body: JSON.stringify({ polecatName })
    })
  }

  // Get polecats for a rig
  async getPolecats(rigName) {
    return this.request(`/rigs/${rigName}/polecats`)
  }

  // Get convoy status
  async getConvoys() {
    return this.request('/convoys')
  }

  // Sling work to an agent
  async sling(agentId, issueId) {
    return this.request('/sling', {
      method: 'POST',
      body: JSON.stringify({ agent: agentId, issue: issueId })
    })
  }

  // Send mail
  async sendMail(to, subject, message) {
    return this.request('/mail/send', {
      method: 'POST',
      body: JSON.stringify({ to, subject, message })
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

  // Open SSE stream for live log tailing — returns EventSource
  openLogStream(agentId) {
    const encoded = encodeURIComponent(agentId)
    return new EventSource(`${this.baseUrl}/agents/${encoded}/logs/stream`)
  }

  // Emergency stop
  async stop(agentId) {
    return this.request(`/agents/${encodeURIComponent(agentId)}/stop`, { method: 'POST' })
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

  // Simulate agent getting stuck (for testing sea lion animation)
  async simulateStuck(agentId) {
    return this.request(`/agents/${encodeURIComponent(agentId)}/simulate-stuck`, {
      method: 'POST'
    })
  }

  // ===== ACTIVITY FEED =====

  // Get activity feed
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

  // Get task queue
  async getTaskQueue(project = null) {
    const params = project ? `?project=${encodeURIComponent(project)}` : ''
    return this.request(`/taskqueue${params}`)
  }

  // Add task to queue
  async addTask(task) {
    return this.request('/taskqueue', {
      method: 'POST',
      body: JSON.stringify(task)
    })
  }

  // Update task in queue
  async updateTask(taskId, updates) {
    return this.request(`/taskqueue/${encodeURIComponent(taskId)}`, {
      method: 'PUT',
      body: JSON.stringify(updates)
    })
  }

  // Remove task from queue
  async removeTask(taskId) {
    return this.request(`/taskqueue/${encodeURIComponent(taskId)}`, {
      method: 'DELETE'
    })
  }

  // Assign task from queue to agent
  async assignTask(taskId, agent, rig = null) {
    return this.request(`/taskqueue/${encodeURIComponent(taskId)}/assign`, {
      method: 'POST',
      body: JSON.stringify({ agent, rig })
    })
  }

  // ===== COST DASHBOARD =====

  // Get cost dashboard data
  async getCostDashboard() {
    return this.request('/costs/dashboard')
  }

  // Record token usage
  async recordCost(agent, project, tokens) {
    return this.request('/costs/record', {
      method: 'POST',
      body: JSON.stringify({ agent, project, tokens })
    })
  }

  // Export cost CSV
  getCostExportUrl(from, to) {
    const params = new URLSearchParams()
    if (from) params.append('from', from)
    if (to) params.append('to', to)
    return `${this.baseUrl}/costs/export?${params.toString()}`
  }

  // ===== GITHUB INTEGRATION =====

  // Get tracked PRs
  async getGitHubPRs(options = {}) {
    const params = new URLSearchParams()
    if (options.project) params.append('project', options.project)
    if (options.agent) params.append('agent', options.agent)
    if (options.status) params.append('status', options.status)
    return this.request(`/github/prs?${params.toString()}`)
  }

  // Track a new PR
  async trackPR(prData) {
    return this.request('/github/prs', {
      method: 'POST',
      body: JSON.stringify(prData)
    })
  }

  // Update PR status
  async updatePR(prId, updates) {
    return this.request(`/github/prs/${encodeURIComponent(prId)}`, {
      method: 'PUT',
      body: JSON.stringify(updates)
    })
  }

  // Remove PR tracking
  async removePR(prId) {
    return this.request(`/github/prs/${encodeURIComponent(prId)}`, {
      method: 'DELETE'
    })
  }

  // ===== BATCH OPERATIONS =====

  // Stop multiple agents
  async batchStop(agents) {
    return this.request('/batch/stop', {
      method: 'POST',
      body: JSON.stringify({ agents })
    })
  }

  // Mark multiple agents as complete
  async batchComplete(agents) {
    return this.request('/batch/complete', {
      method: 'POST',
      body: JSON.stringify({ agents })
    })
  }

  // Spawn multiple agents
  async batchSpawn(rig, count, prefix = 'polecat') {
    return this.request('/batch/spawn', {
      method: 'POST',
      body: JSON.stringify({ rig, count, prefix })
    })
  }

  // ===== PROJECT TEMPLATES =====

  // Get all templates
  async getTemplates() {
    return this.request('/templates')
  }

  // Create template from existing rig
  async createTemplate(templateData) {
    return this.request('/templates', {
      method: 'POST',
      body: JSON.stringify(templateData)
    })
  }

  // Create project from template
  async createFromTemplate(templateId, projectName) {
    return this.request(`/templates/${encodeURIComponent(templateId)}/create`, {
      method: 'POST',
      body: JSON.stringify({ projectName })
    })
  }

  // Delete template
  async deleteTemplate(templateId) {
    return this.request(`/templates/${encodeURIComponent(templateId)}`, {
      method: 'DELETE'
    })
  }
}
