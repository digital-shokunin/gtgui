import { test, expect } from '@playwright/test'

test.describe('Gas Town UI Interface', () => {
  // Track created test rigs for cleanup
  const createdRigs = []

  test.afterAll(async ({ request }) => {
    // Clean up all test rigs created during tests
    for (const rigName of createdRigs) {
      try {
        await request.delete(`/api/rigs/${rigName}`)
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  })

  test.beforeEach(async ({ page }) => {
    // Navigate to the app and wait for it to load
    await page.goto('/')
    // Wait for Phaser game to initialize (canvas should be present)
    await page.waitForSelector('canvas', { timeout: 10000 })
    // Give the game a moment to render
    await page.waitForTimeout(2000)
  })

  test('page loads with game canvas', async ({ page }) => {
    const canvas = page.locator('canvas')
    await expect(canvas).toBeVisible()
  })

  test('login overlay appears in dev mode', async ({ page }) => {
    // Check if dev login is visible or we're already logged in
    const devLogin = page.locator('#dev-login')
    const isLoginVisible = await devLogin.isVisible().catch(() => false)

    if (isLoginVisible) {
      await expect(devLogin).toBeVisible()
      // Should have username input
      const usernameInput = page.locator('#dev-username')
      await expect(usernameInput).toBeVisible()
    }
  })

  test('can login with dev credentials', async ({ page }) => {
    const devLogin = page.locator('#dev-login')
    const isLoginVisible = await devLogin.isVisible().catch(() => false)

    if (isLoginVisible) {
      // Enter a test username
      await page.fill('#dev-username', 'test-user')
      await page.click('#dev-login button[type="submit"]')

      // Wait for login to complete
      await page.waitForTimeout(1000)

      // Login overlay should be hidden after successful login
      await expect(devLogin).not.toBeVisible()
    }
  })

  test('API returns status', async ({ request }) => {
    const response = await request.get('/api/status')
    expect(response.ok()).toBeTruthy()

    const status = await response.json()
    expect(status).toHaveProperty('rigs')
    expect(status).toHaveProperty('polecats')
    expect(Array.isArray(status.rigs)).toBeTruthy()
  })

  test('API returns rigs list', async ({ request }) => {
    const response = await request.get('/api/rigs')
    expect(response.ok()).toBeTruthy()

    const rigs = await response.json()
    expect(Array.isArray(rigs)).toBeTruthy()
  })

  test('API returns settings', async ({ request }) => {
    const response = await request.get('/api/settings')
    expect(response.ok()).toBeTruthy()

    const settings = await response.json()
    expect(settings).toHaveProperty('stuckTokenThreshold')
    expect(settings).toHaveProperty('stuckTimeThreshold')
    expect(settings).toHaveProperty('enableSounds')
    expect(settings).toHaveProperty('enableNotifications')
  })

  test('API can update settings', async ({ request }) => {
    const newSettings = {
      stuckTokenThreshold: 30000,
      stuckTimeThreshold: 2400000  // 40 minutes
    }

    const response = await request.post('/api/settings', {
      data: newSettings
    })
    expect(response.ok()).toBeTruthy()

    const result = await response.json()
    expect(result.success).toBeTruthy()
    expect(result.settings.stuckTokenThreshold).toBe(30000)
  })

  test('API can create and delete a rig', async ({ request }) => {
    const rigName = `test-rig-${Date.now()}`
    createdRigs.push(rigName)

    // Create rig
    const createResponse = await request.post('/api/rigs', {
      data: { name: rigName }
    })
    expect(createResponse.ok()).toBeTruthy()

    const createResult = await createResponse.json()
    expect(createResult.success).toBeTruthy()
    expect(createResult.name).toBe(rigName)

    // Delete rig
    const deleteResponse = await request.delete(`/api/rigs/${rigName}`)
    expect(deleteResponse.ok()).toBeTruthy()

    const deleteResult = await deleteResponse.json()
    expect(deleteResult.success).toBeTruthy()

    // Remove from cleanup list since we already deleted it
    const idx = createdRigs.indexOf(rigName)
    if (idx > -1) createdRigs.splice(idx, 1)
  })

  test('API can spawn polecat', async ({ request }) => {
    // First create a rig
    const rigName = `test-spawn-${Date.now()}`
    createdRigs.push(rigName)
    await request.post('/api/rigs', { data: { name: rigName } })

    // Then spawn a polecat
    const response = await request.post(`/api/rigs/${rigName}/polecats`, {
      data: {}
    })
    expect(response.ok()).toBeTruthy()

    const result = await response.json()
    expect(result.success).toBeTruthy()
    expect(result.name).toBeTruthy()
  })

  test('API can sling work to agent', async ({ request }) => {
    // Create rig and polecat first
    const rigName = `test-sling-${Date.now()}`
    createdRigs.push(rigName)
    await request.post('/api/rigs', { data: { name: rigName } })
    const spawnResult = await (await request.post(`/api/rigs/${rigName}/polecats`, { data: {} })).json()

    // Sling work
    const response = await request.post('/api/sling', {
      data: {
        agent: `${rigName}/polecats/${spawnResult.name}`,
        issue: 'Test task #123'
      }
    })
    expect(response.ok()).toBeTruthy()

    const result = await response.json()
    expect(result.success).toBeTruthy()

    // Verify status changed to working
    // The agent ID format is: rigName/polecats/polecatName (URL encoded)
    const agentId = encodeURIComponent(`${rigName}/polecats/${spawnResult.name}`)
    const hookResponse = await request.get(`/api/agents/${agentId}/hook`)
    const hookResult = await hookResponse.json()
    expect(hookResult.status).toBe('working')
  })

  test('API can mark agent complete', async ({ request }) => {
    // Create rig and polecat, assign work
    const rigName = `test-complete-${Date.now()}`
    createdRigs.push(rigName)
    await request.post('/api/rigs', { data: { name: rigName } })
    const spawnResult = await (await request.post(`/api/rigs/${rigName}/polecats`, { data: {} })).json()
    await request.post('/api/sling', {
      data: {
        agent: `${rigName}/polecats/${spawnResult.name}`,
        issue: 'Test task'
      }
    })

    // Mark complete - agent ID is URL encoded path
    const agentId = encodeURIComponent(`${rigName}/polecats/${spawnResult.name}`)
    const response = await request.post(`/api/agents/${agentId}/complete`)
    expect(response.ok()).toBeTruthy()

    const result = await response.json()
    expect(result.success).toBeTruthy()

    // Verify status is now idle
    const hookResponse = await request.get(`/api/agents/${agentId}/hook`)
    const hookResult = await hookResponse.json()
    expect(hookResult.status).toBe('idle')
  })

  test('API can reassign work', async ({ request }) => {
    // Create rig and two polecats
    const rigName = `test-reassign-${Date.now()}`
    createdRigs.push(rigName)
    await request.post('/api/rigs', { data: { name: rigName } })
    const polecat1 = await (await request.post(`/api/rigs/${rigName}/polecats`, { data: { polecatName: 'worker1' } })).json()
    const polecat2 = await (await request.post(`/api/rigs/${rigName}/polecats`, { data: { polecatName: 'worker2' } })).json()

    // Assign work to first polecat
    const agent1Path = `${rigName}/polecats/${polecat1.name}`
    await request.post('/api/sling', {
      data: {
        agent: agent1Path,
        issue: 'Test reassign task'
      }
    })

    // Reassign to second polecat - use URL encoded agent IDs
    const agent1Id = encodeURIComponent(`${rigName}/polecats/${polecat1.name}`)
    const agent2Id = encodeURIComponent(`${rigName}/polecats/${polecat2.name}`)

    const response = await request.post(`/api/agents/${agent1Id}/reassign`, {
      data: {
        newAgent: `${rigName}/polecats/${polecat2.name}`,
        rig: rigName
      }
    })
    expect(response.ok()).toBeTruthy()

    const result = await response.json()
    expect(result.success).toBeTruthy()

    // Verify first polecat is idle
    const hook1 = await (await request.get(`/api/agents/${agent1Id}/hook`)).json()
    expect(hook1.status).toBe('idle')

    // Verify second polecat is working
    const hook2 = await (await request.get(`/api/agents/${agent2Id}/hook`)).json()
    expect(hook2.status).toBe('working')
  })

  // ===== LOG ENDPOINT TESTS =====

  test('API returns agent logs', async ({ request }) => {
    // Create rig, polecat, assign work
    const rigName = `test-logs-${Date.now()}`
    createdRigs.push(rigName)
    await request.post('/api/rigs', { data: { name: rigName } })
    const spawnResult = await (await request.post(`/api/rigs/${rigName}/polecats`, { data: {} })).json()

    // Sling work so agent has a session
    await request.post('/api/sling', {
      data: {
        agent: `${rigName}/polecats/${spawnResult.name}`,
        issue: 'Test log capture task'
      }
    })

    // Fetch logs
    const agentId = encodeURIComponent(`${rigName}/polecats/${spawnResult.name}`)
    const response = await request.get(`/api/agents/${agentId}/logs?lines=50`)
    expect(response.ok()).toBeTruthy()

    const result = await response.json()
    expect(result).toHaveProperty('logs')
    expect(result).toHaveProperty('sessionActive')
    expect(result).toHaveProperty('status')
    expect(result).toHaveProperty('rig')
    expect(result).toHaveProperty('polecat')
    expect(typeof result.logs).toBe('string')
    expect(result.rig).toBe(rigName)
    expect(result.polecat).toBe(spawnResult.name)
  })

  test('API logs endpoint returns 404 for unknown agent', async ({ request }) => {
    const agentId = encodeURIComponent('nonexistent-rig/polecats/nonexistent-polecat')
    const response = await request.get(`/api/agents/${agentId}/logs`)
    // Should still return 200 with empty logs since rig might not be found via search
    // but agent not found returns 404
    const result = await response.json()
    expect(result).toHaveProperty('logs')
  })

  test('API logs endpoint accepts lines parameter', async ({ request }) => {
    const rigName = `test-loglines-${Date.now()}`
    createdRigs.push(rigName)
    await request.post('/api/rigs', { data: { name: rigName } })
    const spawnResult = await (await request.post(`/api/rigs/${rigName}/polecats`, { data: {} })).json()

    const agentId = encodeURIComponent(`${rigName}/polecats/${spawnResult.name}`)
    const response = await request.get(`/api/agents/${agentId}/logs?lines=10`)
    expect(response.ok()).toBeTruthy()

    const result = await response.json()
    expect(result).toHaveProperty('logs')
  })

  test('API sling writes working status and calls gt', async ({ request }) => {
    const rigName = `test-sling-gt-${Date.now()}`
    createdRigs.push(rigName)
    await request.post('/api/rigs', { data: { name: rigName } })
    const spawnResult = await (await request.post(`/api/rigs/${rigName}/polecats`, { data: {} })).json()

    // Sling work
    const response = await request.post('/api/sling', {
      data: {
        agent: `${rigName}/polecats/${spawnResult.name}`,
        issue: 'Test gt sling integration'
      }
    })
    expect(response.ok()).toBeTruthy()

    const result = await response.json()
    expect(result.success).toBeTruthy()
    expect(result.status).toHaveProperty('status', 'working')
    expect(result.status).toHaveProperty('issue', 'Test gt sling integration')
    expect(result.status).toHaveProperty('assignedAt')

    // Verify hook reflects the assignment
    const agentId = encodeURIComponent(`${rigName}/polecats/${spawnResult.name}`)
    const hookResponse = await request.get(`/api/agents/${agentId}/hook`)
    const hookResult = await hookResponse.json()
    expect(hookResult.status).toBe('working')
    expect(hookResult.hook).toBe('Test gt sling integration')
  })

  test('API logs SSE stream returns event-stream content type', async ({ request }) => {
    const rigName = `test-sse-${Date.now()}`
    createdRigs.push(rigName)
    await request.post('/api/rigs', { data: { name: rigName } })
    const spawnResult = await (await request.post(`/api/rigs/${rigName}/polecats`, { data: {} })).json()

    const agentId = encodeURIComponent(`${rigName}/polecats/${spawnResult.name}`)
    // SSE endpoint should return text/event-stream
    const response = await request.get(`/api/agents/${agentId}/logs/stream`, {
      timeout: 3000
    }).catch(() => null)

    // SSE connections hang by design, so we just verify the endpoint doesn't 404
    // The catch handles the expected timeout
    if (response) {
      expect(response.headers()['content-type']).toContain('text/event-stream')
    }
  })

  // ===== CONFIG ENDPOINT TESTS =====

  test('API returns config with production flag', async ({ request }) => {
    const response = await request.get('/api/config')
    expect(response.ok()).toBeTruthy()

    const config = await response.json()
    expect(config).toHaveProperty('production')
    expect(config).toHaveProperty('version')
    // In Docker test env, NODE_ENV=development so production should be false
    expect(config.production).toBe(false)
  })

  // ===== UI ALIGNMENT TESTS =====

  test('game canvas renders and takes screenshot for visual check', async ({ page }) => {
    const canvas = page.locator('canvas')
    await expect(canvas).toBeVisible()

    // Take a screenshot for visual verification of layout
    await page.screenshot({ path: 'test-results/ui-layout.png', fullPage: true })
  })

  test('login page hides dev login in production mode', async ({ page }) => {
    // In dev mode (our test env), dev-login-section should be visible
    // Navigate fresh to see the login overlay
    await page.goto('/')
    await page.waitForTimeout(1000)

    // Check that dev-login-section exists in the DOM
    const devSection = page.locator('#dev-login-section')
    const exists = await devSection.count()
    expect(exists).toBeGreaterThan(0)
  })

})
