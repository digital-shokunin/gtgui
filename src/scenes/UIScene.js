import Phaser from 'phaser'
import { GasTownAPI } from '../api/GasTownAPI.js'

export class UIScene extends Phaser.Scene {
  constructor() {
    super({ key: 'UIScene' })
    this.api = new GasTownAPI()
  }

  init(data) {
    this.gameScene = data.gameScene
  }

  create() {
    // Initialize user presence tracking
    this.userWatchers = new Map() // agentId -> Set of userIds watching
    this.userStatuses = new Map() // userId -> status
    this.connectedUsers = []

    // Create UI containers (Club Penguin style!)
    this.createResourceBar()
    this.createMinimap()
    this.createCommandPanel()
    this.createTooltip()
    this.createNewProjectButton()
    this.createNotificationArea()
    this.createSettingsButton()

    // Initialize settings from localStorage
    this.loadSettings()

    // Listen for game events
    if (this.gameScene) {
      this.gameScene.events.on('selectionChanged', this.updateSelection, this)
      this.gameScene.events.on('showTooltip', this.showTooltip, this)
      this.gameScene.events.on('hideTooltip', this.hideTooltip, this)
      this.gameScene.events.on('stateUpdated', this.updateResources, this)
      this.gameScene.events.on('multiplayerConnected', this.onMultiplayerConnected, this)
      this.gameScene.events.on('usersUpdated', this.updateConnectedUsers, this)
      this.gameScene.events.on('buildingClicked', this.onBuildingClicked, this)
      this.gameScene.events.on('mayorClicked', this.openMayorChat, this)
      this.gameScene.events.on('enduranceClicked', this.showEnduranceStory, this)
    }

    // Create Mayor chat panel (hidden initially)
    this.createMayorChatPanel()

    // Create village navigator
    this.createVillageNavigator()

    // Create team productivity panels
    this.createActivityFeed()
    this.createTaskQueuePanel()
    this.createCostDashboardPanel()
    this.createAgentOutputViewer()
    this.createGitHubPanel()

    // Listen for new villages
    if (this.gameScene) {
      this.gameScene.events.on('villageAdded', this.updateVillageNavigator, this)
    }

    // Handle resize
    this.scale.on('resize', this.handleResize, this)

    // Initialize notification sounds
    this.initNotificationSounds()
  }

  // ===== NOTIFICATION SYSTEM =====

  createNotificationArea() {
    // Notification container - top right corner
    this.notifications = []
    this.notificationContainer = this.add.container(this.cameras.main.width - 320, 70)
    this.notificationContainer.setDepth(950)
  }

  showNotification(type, title, message, agentData = null) {
    const notifWidth = 300
    const notifHeight = 80
    const yOffset = this.notifications.length * (notifHeight + 10)

    const notif = this.add.container(0, yOffset)
    notif.setAlpha(0)
    notif.setX(320)  // Start off-screen

    // Background colors by type
    const colors = {
      success: { bg: 0x2ECC71, icon: '✓' },
      warning: { bg: 0xF39C12, icon: '⚠' },
      error: { bg: 0xE74C3C, icon: '!' },
      info: { bg: 0x3498DB, icon: 'i' },
      stuck: { bg: 0xE74C3C, icon: '⚠' }
    }
    const color = colors[type] || colors.info

    // Card background
    const bg = this.add.graphics()
    // Shadow
    bg.fillStyle(0x000000, 0.25)
    bg.fillRoundedRect(4, 4, notifWidth, notifHeight, 14)
    // Main
    bg.fillStyle(0xFFFFFF, 0.98)
    bg.fillRoundedRect(0, 0, notifWidth, notifHeight, 14)
    // Left accent bar
    bg.fillStyle(color.bg, 1)
    bg.fillRoundedRect(0, 0, 8, notifHeight, { tl: 14, tr: 0, bl: 14, br: 0 })
    // Border
    bg.lineStyle(2, color.bg, 0.8)
    bg.strokeRoundedRect(0, 0, notifWidth, notifHeight, 14)

    // Icon circle
    const iconBg = this.add.graphics()
    iconBg.fillStyle(color.bg, 0.15)
    iconBg.fillCircle(30, notifHeight/2, 18)
    iconBg.fillStyle(color.bg, 1)
    iconBg.fillCircle(30, notifHeight/2, 14)

    const iconText = this.add.text(30, notifHeight/2, color.icon, {
      font: 'bold 14px Fredoka',
      fill: '#FFFFFF'
    }).setOrigin(0.5)

    // Title
    const titleText = this.add.text(55, 14, title, {
      font: 'bold 14px Fredoka',
      fill: '#333333'
    })

    // Message
    const msgText = this.add.text(55, 34, message, {
      font: '12px Fredoka',
      fill: '#666666',
      wordWrap: { width: notifWidth - 70 }
    })

    // Close button
    const closeBtn = this.add.text(notifWidth - 20, 10, '×', {
      font: 'bold 18px Fredoka',
      fill: '#999999'
    }).setOrigin(0.5)
    closeBtn.setInteractive({ useHandCursor: true })
    closeBtn.on('pointerover', () => closeBtn.setStyle({ fill: '#E74C3C' }))
    closeBtn.on('pointerout', () => closeBtn.setStyle({ fill: '#999999' }))
    closeBtn.on('pointerdown', () => this.dismissNotification(notif))

    // Click to view agent
    if (agentData) {
      const clickZone = this.add.zone(notifWidth/2, notifHeight/2, notifWidth - 40, notifHeight)
      clickZone.setInteractive({ useHandCursor: true })
      clickZone.on('pointerdown', () => {
        this.dismissNotification(notif)
        // Navigate to agent
        if (this.gameScene && agentData.rig && agentData.agent) {
          this.gameScene.panToVillage(agentData.rig)
        }
      })
      notif.add(clickZone)
    }

    notif.add([bg, iconBg, iconText, titleText, msgText, closeBtn])
    this.notificationContainer.add(notif)
    this.notifications.push(notif)

    // Animate in
    this.tweens.add({
      targets: notif,
      x: 0,
      alpha: 1,
      duration: 300,
      ease: 'Back.easeOut'
    })

    // Play sound
    this.playNotificationSound(type)

    // Auto-dismiss after 8 seconds
    this.time.delayedCall(8000, () => {
      if (notif.active) {
        this.dismissNotification(notif)
      }
    })
  }

  dismissNotification(notif) {
    const index = this.notifications.indexOf(notif)
    if (index === -1) return

    this.tweens.add({
      targets: notif,
      x: 320,
      alpha: 0,
      duration: 200,
      ease: 'Back.easeIn',
      onComplete: () => {
        notif.destroy()
        this.notifications.splice(index, 1)
        // Reposition remaining notifications
        this.notifications.forEach((n, i) => {
          this.tweens.add({
            targets: n,
            y: i * 90,
            duration: 200,
            ease: 'Sine.easeOut'
          })
        })
      }
    })
  }

  initNotificationSounds() {
    // Use Web Audio API to create simple notification sounds
    try {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)()
      this.soundsEnabled = true
    } catch (e) {
      console.warn('Web Audio not available')
      this.soundsEnabled = false
    }
  }

  playNotificationSound(type) {
    if (!this.soundsEnabled || !this.audioCtx || !this.settings?.enableSounds) return

    const ctx = this.audioCtx
    const now = ctx.currentTime

    // Resume audio context if suspended
    if (ctx.state === 'suspended') {
      ctx.resume()
    }

    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)

    gain.gain.setValueAtTime(0.15, now)

    switch (type) {
      case 'success':
        // Cheerful ascending tone
        osc.frequency.setValueAtTime(523, now)  // C5
        osc.frequency.setValueAtTime(659, now + 0.1)  // E5
        osc.frequency.setValueAtTime(784, now + 0.2)  // G5
        gain.gain.exponentialDecayTo = 0.01
        gain.gain.setValueAtTime(0.15, now)
        gain.gain.linearRampToValueAtTime(0.01, now + 0.4)
        osc.start(now)
        osc.stop(now + 0.4)
        break

      case 'warning':
      case 'stuck':
        // Warning double beep
        osc.frequency.setValueAtTime(440, now)  // A4
        gain.gain.setValueAtTime(0.15, now)
        gain.gain.linearRampToValueAtTime(0.01, now + 0.15)
        gain.gain.setValueAtTime(0.15, now + 0.2)
        gain.gain.linearRampToValueAtTime(0.01, now + 0.35)
        osc.start(now)
        osc.stop(now + 0.4)
        break

      case 'error':
        // Low warning tone
        osc.frequency.setValueAtTime(220, now)  // A3
        osc.type = 'sawtooth'
        gain.gain.setValueAtTime(0.1, now)
        gain.gain.linearRampToValueAtTime(0.01, now + 0.5)
        osc.start(now)
        osc.stop(now + 0.5)
        break

      default:
        // Info pop
        osc.frequency.setValueAtTime(880, now)  // A5
        gain.gain.setValueAtTime(0.1, now)
        gain.gain.linearRampToValueAtTime(0.01, now + 0.15)
        osc.start(now)
        osc.stop(now + 0.15)
    }
  }

  // ===== SETTINGS PANEL =====

  loadSettings() {
    try {
      const saved = localStorage.getItem('gtgui_settings')
      this.settings = saved ? JSON.parse(saved) : {
        stuckTokenThreshold: 25000,
        stuckTimeThreshold: 1800000,  // 30 min
        enableSounds: true,
        enableNotifications: true
      }
    } catch (e) {
      this.settings = {
        stuckTokenThreshold: 25000,
        stuckTimeThreshold: 1800000,
        enableSounds: true,
        enableNotifications: true
      }
    }
  }

  saveSettings() {
    localStorage.setItem('gtgui_settings', JSON.stringify(this.settings))
    // Also update server
    this.api.updateSettings(this.settings).catch(e => console.warn('Failed to sync settings:', e))
  }

  createSettingsButton() {
    const width = this.cameras.main.width

    // Gear icon button in top bar (left of town name, right of Online indicator)
    const btnX = width - 235
    const btnY = 33

    this.settingsBtn = this.add.container(btnX, btnY)

    const bg = this.add.graphics()
    bg.fillStyle(0xFFFFFF, 0.2)
    bg.fillCircle(0, 0, 16)

    const icon = this.add.text(0, 0, '⚙', {
      font: '18px Fredoka',
      fill: '#FFFFFF'
    }).setOrigin(0.5)

    const zone = this.add.zone(0, 0, 32, 32)
    zone.setInteractive({ useHandCursor: true })

    zone.on('pointerover', () => {
      bg.clear()
      bg.fillStyle(0xFFFFFF, 0.35)
      bg.fillCircle(0, 0, 18)
      this.tweens.add({
        targets: icon,
        angle: 90,
        duration: 300,
        ease: 'Sine.easeOut'
      })
    })

    zone.on('pointerout', () => {
      bg.clear()
      bg.fillStyle(0xFFFFFF, 0.2)
      bg.fillCircle(0, 0, 16)
      this.tweens.add({
        targets: icon,
        angle: 0,
        duration: 300,
        ease: 'Sine.easeOut'
      })
    })

    zone.on('pointerup', () => this.showSettingsPanel())

    this.settingsBtn.add([bg, icon, zone])
  }

  showSettingsPanel() {
    const width = this.cameras.main.width
    const height = this.cameras.main.height
    const panelWidth = 400
    const panelHeight = 500

    this.settingsPanel = this.add.container(width/2, height/2)
    this.settingsPanel.setDepth(1500)

    // Backdrop
    const backdrop = this.add.graphics()
    backdrop.fillStyle(0x000000, 0.6)
    backdrop.fillRect(-width/2, -height/2, width, height)
    backdrop.setInteractive(new Phaser.Geom.Rectangle(-width/2, -height/2, width, height), Phaser.Geom.Rectangle.Contains)

    // Panel
    const panel = this.add.graphics()
    this.drawGlossyPanel(panel, -panelWidth/2, -panelHeight/2, panelWidth, panelHeight, 0x0077B6, 20)

    // White content area
    panel.fillStyle(0xFFFFFF, 0.98)
    panel.fillRoundedRect(-panelWidth/2 + 10, -panelHeight/2 + 60, panelWidth - 20, panelHeight - 80, 12)

    // Title
    const title = this.add.text(0, -panelHeight/2 + 30, 'SETTINGS', {
      font: 'bold 22px Fredoka',
      fill: '#FFFFFF',
      stroke: '#005588',
      strokeThickness: 2
    }).setOrigin(0.5)

    // Close button
    const closeBtn = this.add.text(panelWidth/2 - 25, -panelHeight/2 + 25, '×', {
      font: 'bold 24px Fredoka',
      fill: '#FFFFFF'
    }).setOrigin(0.5)
    closeBtn.setInteractive({ useHandCursor: true })
    closeBtn.on('pointerup', () => {
      this.settingsPanel.destroy()
      this.settingsPanel = null
    })

    this.settingsPanel.add([backdrop, panel, title, closeBtn])

    // Settings items
    let yPos = -panelHeight/2 + 90

    // Token threshold slider
    this.addSettingSlider('Token Limit', 'stuckTokenThreshold', 5000, 100000, yPos, 'tokens')
    yPos += 70

    // Time threshold slider
    this.addSettingSlider('Time Limit', 'stuckTimeThreshold', 300000, 7200000, yPos, 'time')
    yPos += 70

    // Sound toggle
    this.addSettingToggle('Notification Sounds', 'enableSounds', yPos)
    yPos += 50

    // Notification toggle
    this.addSettingToggle('Show Notifications', 'enableNotifications', yPos)
    yPos += 50

    // Divider line
    const divider = this.add.graphics()
    divider.lineStyle(2, 0xE0E0E0, 1)
    divider.lineBetween(-panelWidth/2 + 25, yPos, panelWidth/2 - 25, yPos)
    this.settingsPanel.add(divider)
    yPos += 20

    // Debug section header
    const debugHeader = this.add.text(0, yPos, '🦭 DEBUG TOOLS', {
      font: 'bold 14px Fredoka',
      fill: '#E67E22'
    }).setOrigin(0.5)
    this.settingsPanel.add(debugHeader)
    yPos += 35

    // Simulate Stuck button
    const stuckBtn = this.add.graphics()
    this.drawButton(stuckBtn, -150, yPos, 140, 40, 0xE67E22, true)
    const stuckText = this.add.text(-80, yPos + 20, 'SEA LION', {
      font: 'bold 14px Fredoka',
      fill: '#FFFFFF'
    }).setOrigin(0.5)
    const stuckZone = this.add.zone(-80, yPos + 20, 140, 40)
    stuckZone.setInteractive({ useHandCursor: true })
    stuckZone.on('pointerup', () => {
      this.settingsPanel.destroy()
      this.settingsPanel = null
      this.showSimulateStuckPicker()
    })
    this.settingsPanel.add([stuckBtn, stuckText, stuckZone])

    // Save button
    yPos += 60
    const saveBtn = this.add.graphics()
    this.drawButton(saveBtn, -80, yPos, 160, 44, 0x2ECC71, true)
    const saveText = this.add.text(0, yPos + 22, 'SAVE', {
      font: 'bold 16px Fredoka',
      fill: '#FFFFFF'
    }).setOrigin(0.5)
    const saveZone = this.add.zone(0, yPos + 22, 160, 44)
    saveZone.setInteractive({ useHandCursor: true })
    saveZone.on('pointerup', () => {
      this.saveSettings()
      this.showNotification('success', 'Settings Saved', 'Your preferences have been updated')
      this.settingsPanel.destroy()
      this.settingsPanel = null
    })

    this.settingsPanel.add([saveBtn, saveText, saveZone])

    // Animate in
    this.settingsPanel.setScale(0.8)
    this.settingsPanel.setAlpha(0)
    this.tweens.add({
      targets: this.settingsPanel,
      scale: 1,
      alpha: 1,
      duration: 200,
      ease: 'Back.easeOut'
    })
  }

  addSettingSlider(label, key, min, max, y, format) {
    const sliderWidth = 280
    const x = -sliderWidth/2

    // Label
    const labelText = this.add.text(x, y, label, {
      font: 'bold 14px Fredoka',
      fill: '#333333'
    })

    // Current value
    const formatValue = (val) => {
      if (format === 'time') {
        const mins = Math.round(val / 60000)
        return mins < 60 ? `${mins} min` : `${(mins/60).toFixed(1)} hr`
      }
      return val.toLocaleString()
    }

    const valueText = this.add.text(sliderWidth/2 + 10, y, formatValue(this.settings[key]), {
      font: 'bold 14px Fredoka',
      fill: '#0077B6'
    }).setOrigin(1, 0)

    // Slider track
    const track = this.add.graphics()
    track.fillStyle(0xE0E0E0, 1)
    track.fillRoundedRect(x, y + 25, sliderWidth, 12, 6)

    // Slider fill
    const fill = this.add.graphics()
    const ratio = (this.settings[key] - min) / (max - min)
    fill.fillStyle(0x0077B6, 1)
    fill.fillRoundedRect(x, y + 25, sliderWidth * ratio, 12, 6)

    // Slider thumb
    const thumb = this.add.graphics()
    thumb.fillStyle(0xFFFFFF, 1)
    thumb.fillCircle(x + sliderWidth * ratio, y + 31, 10)
    thumb.lineStyle(2, 0x0077B6, 1)
    thumb.strokeCircle(x + sliderWidth * ratio, y + 31, 10)

    // Interaction zone
    const zone = this.add.zone(0, y + 31, sliderWidth + 40, 30)
    zone.setInteractive({ useHandCursor: true, draggable: true })

    zone.on('drag', (pointer, dragX) => {
      const localX = dragX - x
      const clampedX = Math.max(0, Math.min(sliderWidth, localX))
      const newRatio = clampedX / sliderWidth
      const newValue = Math.round(min + (max - min) * newRatio)

      this.settings[key] = newValue
      valueText.setText(formatValue(newValue))

      fill.clear()
      fill.fillStyle(0x0077B6, 1)
      fill.fillRoundedRect(x, y + 25, sliderWidth * newRatio, 12, 6)

      thumb.clear()
      thumb.fillStyle(0xFFFFFF, 1)
      thumb.fillCircle(x + clampedX, y + 31, 10)
      thumb.lineStyle(2, 0x0077B6, 1)
      thumb.strokeCircle(x + clampedX, y + 31, 10)
    })

    this.settingsPanel.add([labelText, valueText, track, fill, thumb, zone])
  }

  addSettingToggle(label, key, y) {
    const x = -140

    // Label
    const labelText = this.add.text(x, y + 8, label, {
      font: 'bold 14px Fredoka',
      fill: '#333333'
    })

    // Toggle switch
    const toggle = this.add.graphics()
    const drawToggle = () => {
      toggle.clear()
      if (this.settings[key]) {
        toggle.fillStyle(0x2ECC71, 1)
        toggle.fillRoundedRect(100, y + 5, 50, 26, 13)
        toggle.fillStyle(0xFFFFFF, 1)
        toggle.fillCircle(137, y + 18, 10)
      } else {
        toggle.fillStyle(0xCCCCCC, 1)
        toggle.fillRoundedRect(100, y + 5, 50, 26, 13)
        toggle.fillStyle(0xFFFFFF, 1)
        toggle.fillCircle(113, y + 18, 10)
      }
    }
    drawToggle()

    const zone = this.add.zone(125, y + 18, 60, 30)
    zone.setInteractive({ useHandCursor: true })
    zone.on('pointerup', () => {
      this.settings[key] = !this.settings[key]
      drawToggle()
    })

    this.settingsPanel.add([labelText, toggle, zone])
  }

  // Helper to darken a color
  darkenColor(color, amount) {
    const c = Phaser.Display.Color.ValueToColor(color)
    return Phaser.Display.Color.GetColor(
      Math.max(0, c.red - amount),
      Math.max(0, c.green - amount),
      Math.max(0, c.blue - amount)
    )
  }

  // Draw glossy gradient panel
  drawGlossyPanel(graphics, x, y, width, height, color, cornerRadius = 15) {
    // Shadow
    graphics.fillStyle(0x000000, 0.25)
    graphics.fillRoundedRect(x + 3, y + 3, width, height, cornerRadius)

    // Main panel (darker bottom)
    const darkColor = this.darkenColor(color, 30)
    graphics.fillStyle(darkColor, 0.95)
    graphics.fillRoundedRect(x, y, width, height, cornerRadius)

    // Top gradient (lighter)
    graphics.fillStyle(color, 0.98)
    graphics.fillRoundedRect(x, y, width, height * 0.6, { tl: cornerRadius, tr: cornerRadius, bl: 0, br: 0 })

    // Inner highlight (glossy effect)
    graphics.fillStyle(0xFFFFFF, 0.15)
    graphics.fillRoundedRect(x + 3, y + 3, width - 6, height * 0.35, { tl: cornerRadius - 2, tr: cornerRadius - 2, bl: 0, br: 0 })

    // Border
    graphics.lineStyle(2, 0xFFFFFF, 0.6)
    graphics.strokeRoundedRect(x, y, width, height, cornerRadius)

    // Inner shadow line
    graphics.lineStyle(1, 0x000000, 0.1)
    graphics.strokeRoundedRect(x + 2, y + 2, width - 4, height - 4, cornerRadius - 2)
  }

  createResourceBar() {
    const width = this.cameras.main.width

    // Top bar background - glossy icy blue
    this.topBar = this.add.graphics()
    this.drawGlossyPanel(this.topBar, 10, 8, width - 20, 50, 0x0077B6, 14)

    // Resource displays (Club Penguin style - coins, fish, stamps)
    // Left-aligned with fixed positions in header bar
    this.resources = {
      tokens: { icon: 'icon-tokens', value: 0, x: 45, label: 'Coins', displayValue: 0 },
      issues: { icon: 'icon-issues', value: 0, x: 200, label: 'Fish', displayValue: 0 },
      convoys: { icon: 'icon-convoys', value: 0, x: 355, label: 'Stamps', displayValue: 0 }
    }

    Object.entries(this.resources).forEach(([key, res]) => {
      // Icon with glow container
      const iconContainer = this.add.container(res.x, 33)

      // Icon glow
      const glow = this.add.graphics()
      glow.fillStyle(0xFFFFFF, 0.2)
      glow.fillCircle(0, 0, 20)
      iconContainer.add(glow)

      res.iconSprite = this.add.image(0, 0, res.icon).setScale(0.9)
      iconContainer.add(res.iconSprite)

      res.text = this.add.text(res.x + 28, 22, `${res.label}: ${res.value}`, {
        font: 'bold 16px Fredoka',
        fill: '#FFFFFF',
        stroke: '#005588',
        strokeThickness: 3
      })

      // Hover effect on icon
      const hitZone = this.add.zone(res.x, 33, 50, 40).setInteractive()
      hitZone.on('pointerover', () => {
        this.tweens.add({
          targets: res.iconSprite,
          scale: 1.1,
          duration: 100,
          ease: 'Back.easeOut'
        })
        glow.clear()
        glow.fillStyle(0xFFFFFF, 0.4)
        glow.fillCircle(0, 0, 22)
      })
      hitZone.on('pointerout', () => {
        this.tweens.add({
          targets: res.iconSprite,
          scale: 0.9,
          duration: 100,
          ease: 'Sine.easeOut'
        })
        glow.clear()
        glow.fillStyle(0xFFFFFF, 0.2)
        glow.fillCircle(0, 0, 20)
      })
    })

    // Town name with penguin flair
    this.townName = this.add.text(width - 30, 18, 'PENGUIN TOWN', {
      font: 'bold 20px Fredoka',
      fill: '#FFFFFF',
      stroke: '#005588',
      strokeThickness: 4
    }).setOrigin(1, 0)

    // Status text
    this.statusText = this.add.text(width - 30, 40, 'Waddle on!', {
      font: '13px Fredoka',
      fill: '#B0E0E6'
    }).setOrigin(1, 0)

    // Connected users indicator
    this.createUsersIndicator()

    // Mini status bar (agent summary)
    this.createMiniStatusBar()
  }

  createMiniStatusBar() {
    // Position between resources and users indicator
    this.miniStatusBar = this.add.container(480, 33)

    // Status counts
    this.miniStatusText = this.add.text(0, 0, '', {
      font: '12px Fredoka',
      fill: '#B0E0E6'
    }).setOrigin(0, 0.5)

    this.miniStatusBar.add(this.miniStatusText)

    // Update periodically
    this.time.addEvent({
      delay: 5000,
      callback: this.updateMiniStatusBar,
      callbackScope: this,
      loop: true
    })
  }

  updateMiniStatusBar() {
    const unitsMap = this.gameScene?.units
    const units = unitsMap ? Array.from(unitsMap.values()) : []
    const working = units.filter(u => u.status === 'working').length
    const stuck = units.filter(u => u.status === 'stuck').length
    const idle = units.filter(u => u.status === 'idle').length

    let text = ''
    if (working > 0) text += `${working} working`
    if (stuck > 0) text += (text ? ' | ' : '') + `${stuck} stuck`
    if (idle > 0) text += (text ? ' | ' : '') + `${idle} idle`

    if (!text) text = 'No agents'

    this.miniStatusText.setText(text)

    // Highlight if any stuck — use bright yellow with stroke for contrast on blue header
    if (stuck > 0) {
      this.miniStatusText.setStyle({ fill: '#FFD700', stroke: '#CC0000', strokeThickness: 2 })
    } else {
      this.miniStatusText.setStyle({ fill: '#B0E0E6', stroke: '#005588', strokeThickness: 0 })
    }
  }

  // Animate resource counter
  animateResourceCounter(res, newValue) {
    if (res.displayValue === newValue) return

    const startValue = res.displayValue
    const diff = newValue - startValue

    this.tweens.addCounter({
      from: 0,
      to: 1,
      duration: 500,
      ease: 'Quad.easeOut',
      onUpdate: (tween) => {
        const current = Math.round(startValue + diff * tween.getValue())
        res.displayValue = current
        res.text.setText(`${res.label}: ${current}`)
      },
      onComplete: () => {
        res.displayValue = newValue
        res.text.setText(`${res.label}: ${newValue}`)
        // Pop effect
        this.tweens.add({
          targets: res.iconSprite,
          scale: { from: 1.2, to: 0.9 },
          duration: 150,
          ease: 'Back.easeOut'
        })
      }
    })
  }

  createUsersIndicator() {
    const width = this.cameras.main.width

    // Users container (positioned to the left of settings gear, vertically centered in header)
    this.usersContainer = this.add.container(width - 290, 33)

    // "Online:" label
    this.usersLabel = this.add.text(0, 0, 'Online:', {
      font: 'bold 12px Fredoka',
      fill: '#B0E0E6'
    }).setOrigin(1, 0.5)

    // User dots container (will show colored dots for each user)
    this.userDots = this.add.container(10, 0)

    this.usersContainer.add([this.usersLabel, this.userDots])

    // Initially hidden until multiplayer connects
    this.usersContainer.setVisible(false)
  }

  onMultiplayerConnected(multiplayer) {
    this.multiplayer = multiplayer
    this.usersContainer.setVisible(true)
    this.statusText.setText('Connected!')

    // Show self as first user
    this.updateConnectedUsers([])

    // Listen for server notifications
    if (multiplayer.socket) {
      multiplayer.socket.on('notification', (data) => {
        if (!this.settings?.enableNotifications) return

        const { type, message, agent, rig } = data
        let title = 'Notification'

        switch (type) {
          case 'stuck':
            title = 'Agent Stuck!'
            break
          case 'warning':
            title = 'Warning'
            break
          case 'success':
            title = 'Task Complete'
            break
          case 'info':
            title = 'Update'
            break
          case 'error':
            title = 'Error'
            break
        }

        this.showNotification(type, title, message, { agent, rig })

        // Also add to Mayor chat if open
        if (this.mayorChat?.visible && type === 'stuck') {
          this.addMayorMessage('mayor', `Alert: ${agent} in ${rig} needs help! ${message}`)
        }
      })

      // Listen for state updates
      multiplayer.socket.on('state:update', (data) => {
        if (data.data?.event === 'polecat:completed') {
          this.showNotification('success', 'Task Complete',
            `${data.data.polecat} finished: ${data.data.task || 'task'}`,
            { agent: data.data.polecat, rig: data.data.rig })
        }
      })

      // Listen for activity feed events
      multiplayer.socket.on('feed:event', (event) => {
        this.addFeedEvent(event)
      })

      // Listen for task queue updates
      multiplayer.socket.on('taskqueue:update', (queue) => {
        if (this.queuePanel?.visible) {
          this.renderTaskQueue(queue)
        }
        this.queueToggleText?.setText(`📥 QUEUE (${queue.length})`)
      })

      // Listen for cost updates
      multiplayer.socket.on('costs:update', (data) => {
        if (this.costPanel?.visible) {
          this.loadCostDashboard()
        }
      })

      // Listen for GitHub PR updates
      multiplayer.socket.on('state:update', (data) => {
        if (data.data?.event?.startsWith('github:')) {
          if (this.githubPanelContent?.visible) {
            this.loadGitHubPRs()
          }
        }
      })

      // Listen for user watching agent changes
      multiplayer.socket.on('user:watching', (data) => {
        this.updateUserWatching(data.userId, data.agentId)
      })

      // Listen for user status changes
      multiplayer.socket.on('user:status', (data) => {
        this.updateUserStatus(data.userId, data.status)
      })
    }

    // Initialize watchers map
    this.userWatchers = new Map() // agentId -> Set of userIds watching
    this.userStatuses = new Map() // userId -> status
  }

  updateUserWatching(userId, agentId) {
    // Remove from previous watched agent
    for (const [agent, watchers] of this.userWatchers) {
      watchers.delete(userId)
      if (watchers.size === 0) {
        this.userWatchers.delete(agent)
      }
    }

    // Add to new watched agent
    if (agentId) {
      if (!this.userWatchers.has(agentId)) {
        this.userWatchers.set(agentId, new Set())
      }
      this.userWatchers.get(agentId).add(userId)
    }

    // Update selection card if showing watched agent
    if (this.selectedUnit && this.selectionCard?.visible) {
      this.updateWatchingIndicator()
    }
  }

  updateUserStatus(userId, status) {
    this.userStatuses.set(userId, status)
    // Refresh user dots to show new status
    if (this.connectedUsers) {
      this.updateConnectedUsers(this.connectedUsers)
    }
  }

  updateConnectedUsers(users) {
    this.connectedUsers = users // Store for status updates
    // Clear existing dots
    this.userDots.removeAll(true)

    // Add self dot (always first, with a special indicator)
    const selfDot = this.add.graphics()
    selfDot.fillStyle(0xFFFFFF, 1)
    selfDot.fillCircle(0, 0, 8)
    selfDot.lineStyle(2, 0x2ECC71, 1)
    selfDot.strokeCircle(0, 0, 8)
    // Pulse animation
    this.tweens.add({
      targets: selfDot,
      scaleX: { from: 1, to: 1.2 },
      scaleY: { from: 1, to: 1.2 },
      duration: 1000,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    })
    this.userDots.add(selfDot)

    // Add dots for other users with status indicators
    users.forEach((user, i) => {
      const colorHex = parseInt(user.color.hex.replace('#', ''), 16)
      const xPos = 20 + i * 24 // Slightly more spacing for status ring
      const dot = this.add.graphics()

      // Draw status ring first (behind the dot)
      const status = this.userStatuses.get(user.id) || user.status || 'active'
      let statusRingColor
      switch (status) {
        case 'away':
          statusRingColor = 0xF39C12 // Orange for away
          break
        case 'busy':
          statusRingColor = 0xE74C3C // Red for busy
          break
        default:
          statusRingColor = 0x2ECC71 // Green for active
      }

      // Outer status ring
      dot.lineStyle(3, statusRingColor, 1)
      dot.strokeCircle(xPos, 0, 10)

      // User color dot
      dot.fillStyle(colorHex, 1)
      dot.fillCircle(xPos, 0, 7)

      // Inner highlight
      dot.fillStyle(0xFFFFFF, 0.3)
      dot.fillCircle(xPos - 2, -2, 3)

      // Tooltip on hover
      const hitArea = this.add.zone(xPos, 0, 22, 22)
      hitArea.setInteractive()
      hitArea.on('pointerover', () => {
        this.showUserTooltip(user, hitArea.x, hitArea.y)
      })
      hitArea.on('pointerout', () => {
        this.hideUserTooltip()
      })

      this.userDots.add([dot, hitArea])
    })

    // Update count in status
    const count = users.length + 1
    this.statusText.setText(`${count} penguin${count !== 1 ? 's' : ''} online`)
  }

  showUserTooltip(user, x, y) {
    if (!this.userTooltip) {
      this.userTooltip = this.add.container(0, 0)
      const bg = this.add.graphics()
      this.userTooltipBg = bg
      this.drawGlossyPanel(bg, 0, 0, 130, 50, 0xFFFFFF, 8)
      this.userTooltipText = this.add.text(65, 14, '', {
        font: 'bold 12px Fredoka',
        fill: '#0077B6'
      }).setOrigin(0.5)
      this.userTooltipStatus = this.add.text(65, 32, '', {
        font: '10px Fredoka',
        fill: '#666666'
      }).setOrigin(0.5)
      this.userTooltip.add([bg, this.userTooltipText, this.userTooltipStatus])
    }

    this.userTooltipText.setText(user.name)

    // Show status and watching info
    const status = this.userStatuses.get(user.id) || user.status || 'active'
    let statusText = status.charAt(0).toUpperCase() + status.slice(1)
    if (user.watching) {
      statusText += ` • Watching ${user.watching}`
    }
    this.userTooltipStatus.setText(statusText)
    this.userTooltip.setPosition(x - 55, y + 25)
    this.userTooltip.setVisible(true)
  }

  hideUserTooltip() {
    if (this.userTooltip) {
      this.userTooltip.setVisible(false)
    }
  }

  createMinimap() {
    const minimapSize = 160
    const padding = 15
    const x = this.cameras.main.width - minimapSize - padding
    const y = this.cameras.main.height - minimapSize - padding

    // Minimap frame - glossy style
    this.minimapBg = this.add.graphics()
    this.drawGlossyPanel(this.minimapBg, x - 10, y - 30, minimapSize + 20, minimapSize + 40, 0x0077B6, 14)

    // Minimap terrain (snowy) with inner shadow
    this.minimap = this.add.graphics()
    // Inner shadow
    this.minimap.fillStyle(0x5BA3C6, 0.5)
    this.minimap.fillRoundedRect(x + 2, y + 2, minimapSize - 4, minimapSize - 4, 8)
    // Main area
    this.minimap.fillStyle(0xE8F4FC, 1)
    this.minimap.fillRoundedRect(x, y, minimapSize, minimapSize, 8)

    // Snow texture pattern
    this.minimap.fillStyle(0xFFFFFF, 0.6)
    for (let i = 0; i < 30; i++) {
      this.minimap.fillCircle(
        x + Math.random() * minimapSize,
        y + Math.random() * minimapSize,
        1.5
      )
    }

    // Buildings on minimap (colorful dots with glow)
    this.minimapMarkers = this.add.graphics()
    // Ski lodge
    this.minimapMarkers.fillStyle(0x8B4513, 0.3)
    this.minimapMarkers.fillCircle(x + 80, y + 80, 10)
    this.minimapMarkers.fillStyle(0x8B4513, 1)
    this.minimapMarkers.fillCircle(x + 80, y + 80, 6)
    // Coffee shop
    this.minimapMarkers.fillStyle(0xD2691E, 0.3)
    this.minimapMarkers.fillCircle(x + 50, y + 60, 8)
    this.minimapMarkers.fillStyle(0xD2691E, 1)
    this.minimapMarkers.fillCircle(x + 50, y + 60, 5)
    // Pet shop
    this.minimapMarkers.fillStyle(0x9B59B6, 0.3)
    this.minimapMarkers.fillCircle(x + 110, y + 100, 8)
    this.minimapMarkers.fillStyle(0x9B59B6, 1)
    this.minimapMarkers.fillCircle(x + 110, y + 100, 5)
    // Igloo
    this.minimapMarkers.fillStyle(0xFFFFFF, 0.5)
    this.minimapMarkers.fillCircle(x + 130, y + 50, 8)
    this.minimapMarkers.fillStyle(0xFFFFFF, 1)
    this.minimapMarkers.fillCircle(x + 130, y + 50, 5)
    this.minimapMarkers.lineStyle(1, 0x87CEEB, 1)
    this.minimapMarkers.strokeCircle(x + 130, y + 50, 5)

    // Viewport indicator with glow
    this.viewportIndicator = this.add.graphics()
    this.viewportIndicator.fillStyle(0xFF6B35, 0.2)
    this.viewportIndicator.fillRoundedRect(x + 50, y + 50, 50, 40, 4)
    this.viewportIndicator.lineStyle(2, 0xFF6B35, 0.9)
    this.viewportIndicator.strokeRoundedRect(x + 50, y + 50, 50, 40, 4)

    // Label with icon
    this.add.text(x + minimapSize/2, y - 18, 'MAP', {
      font: 'bold 15px Fredoka',
      fill: '#FFFFFF',
      stroke: '#005588',
      strokeThickness: 2
    }).setOrigin(0.5, 0)
  }

  createCommandPanel() {
    // Selection card - Club Penguin player card style with frosted glass effect
    // Initially hidden, shown when something is selected
    // Centered on screen
    this._cardWidth = 220
    this._currentCardHeight = 300
    const centerX = (this.cameras.main.width - this._cardWidth) / 2
    const centerY = (this.cameras.main.height - this._currentCardHeight) / 2
    this.selectionCard = this.add.container(centerX, centerY)
    this.selectionCard.setVisible(false)
    this.selectionCard.setAlpha(0)
    this.selectionCard.setDepth(800)

    // Card background with frosted glass effect (stored for dynamic redraw)
    this._cardBg = this.add.graphics()
    const cardBg = this._cardBg
    const cardWidth = this._cardWidth
    const cardHeight = this._currentCardHeight

    // Draw initial card background
    this._redrawCardBg(cardHeight)

    // Avatar circle background with gradient
    const avatarBg = this.add.graphics()
    avatarBg.fillStyle(0x87CEEB, 0.5)
    avatarBg.fillCircle(cardWidth/2, 55, 42)
    avatarBg.fillStyle(0xFFFFFF, 1)
    avatarBg.fillCircle(cardWidth/2, 55, 38)
    avatarBg.lineStyle(4, 0x0077B6, 1)
    avatarBg.strokeCircle(cardWidth/2, 55, 38)
    // Inner ring
    avatarBg.lineStyle(2, 0x87CEEB, 0.5)
    avatarBg.strokeCircle(cardWidth/2, 55, 32)

    // Avatar sprite (will be updated when selected)
    this.cardAvatar = this.add.image(cardWidth/2, 55, 'unit-polecat-idle')
    this.cardAvatar.setScale(0.8)

    // Name with better typography
    this.cardName = this.add.text(cardWidth/2, 105, 'Penguin', {
      font: 'bold 20px Fredoka',
      fill: '#0077B6'
    }).setOrigin(0.5, 0)

    // Status badge background
    this.cardStatusBg = this.add.graphics()
    this.cardStatus = this.add.text(cardWidth/2, 132, 'IDLE', {
      font: 'bold 13px Fredoka',
      fill: '#FFFFFF'
    }).setOrigin(0.5, 0)

    // Action buttons container
    this.cardButtons = this.add.container(12, 165)

    // Close button with hover effect
    const closeBtnBg = this.add.graphics()
    closeBtnBg.fillStyle(0xFF6B6B, 0.8)
    closeBtnBg.fillCircle(cardWidth - 18, 18, 14)
    closeBtnBg.fillStyle(0xFFFFFF, 0.3)
    closeBtnBg.fillCircle(cardWidth - 20, 16, 6)

    const closeBtn = this.add.text(cardWidth - 18, 18, 'X', {
      font: 'bold 14px Fredoka',
      fill: '#FFFFFF'
    }).setOrigin(0.5)

    const closeZone = this.add.zone(cardWidth - 18, 18, 28, 28).setInteractive({ useHandCursor: true })
    closeZone.on('pointerover', () => {
      closeBtnBg.clear()
      closeBtnBg.fillStyle(0xFF4444, 1)
      closeBtnBg.fillCircle(cardWidth - 18, 18, 15)
      closeBtnBg.fillStyle(0xFFFFFF, 0.3)
      closeBtnBg.fillCircle(cardWidth - 20, 16, 6)
    })
    closeZone.on('pointerout', () => {
      closeBtnBg.clear()
      closeBtnBg.fillStyle(0xFF6B6B, 0.8)
      closeBtnBg.fillCircle(cardWidth - 18, 18, 14)
      closeBtnBg.fillStyle(0xFFFFFF, 0.3)
      closeBtnBg.fillCircle(cardWidth - 20, 16, 6)
    })
    closeZone.on('pointerdown', () => this.hideSelectionCard())

    this.selectionCard.add([cardBg, avatarBg, this.cardAvatar, this.cardName,
                           this.cardStatusBg, this.cardStatus, this.cardButtons,
                           closeBtnBg, closeBtn, closeZone])

    // Keep old panel reference for compatibility
    this.commandPanel = this.add.graphics()
    this.panelTitle = this.add.text(0, 0, '').setVisible(false)
    this.selectionInfo = this.add.text(0, 0, '').setVisible(false)
    this.buttonContainer = this.add.container(0, 0).setVisible(false)
  }

  // Redraw the card background at a given height
  _redrawCardBg(cardHeight) {
    const cardWidth = this._cardWidth
    this._currentCardHeight = cardHeight
    this._cardBg.clear()

    // Outer glow
    this._cardBg.fillStyle(0x87CEEB, 0.3)
    this._cardBg.fillRoundedRect(-5, -5, cardWidth + 10, cardHeight + 10, 24)
    // Shadow
    this._cardBg.fillStyle(0x000000, 0.25)
    this._cardBg.fillRoundedRect(5, 5, cardWidth, cardHeight, 22)
    // Main card - frosted white
    this._cardBg.fillStyle(0xFFFFFF, 0.95)
    this._cardBg.fillRoundedRect(0, 0, cardWidth, cardHeight, 22)
    // Blue header gradient
    this._cardBg.fillStyle(0x005588, 1)
    this._cardBg.fillRoundedRect(0, 0, cardWidth, 70, { tl: 22, tr: 22, bl: 0, br: 0 })
    this._cardBg.fillStyle(0x0077B6, 0.9)
    this._cardBg.fillRoundedRect(0, 0, cardWidth, 45, { tl: 22, tr: 22, bl: 0, br: 0 })
    // Header shine
    this._cardBg.fillStyle(0xFFFFFF, 0.15)
    this._cardBg.fillRoundedRect(4, 4, cardWidth - 8, 20, { tl: 18, tr: 18, bl: 0, br: 0 })
    // Border
    this._cardBg.lineStyle(3, 0x0077B6, 1)
    this._cardBg.strokeRoundedRect(0, 0, cardWidth, cardHeight, 22)
  }

  showSelectionCard(unit) {
    this.selectedUnit = unit
    this.selectionCard.setVisible(true)

    const cardWidth = this._cardWidth
    const status = unit.status || 'idle'

    // Compute dynamic card height based on status
    const baseHeight = 160  // header + avatar + name + badge + padding
    const hasProgress = (status === 'working' || status === 'stuck')
    const progressHeight = hasProgress ? 55 : 0
    const buttonCount = status === 'idle' ? 2 : (status === 'working' ? 3 : 4)
    const buttonsHeight = buttonCount * 50
    const watchingHeight = 25  // reserve space even if no watchers (avoids jitter)
    const cardHeight = baseHeight + progressHeight + buttonsHeight + watchingHeight + 15

    // Redraw card background at computed height
    this._redrawCardBg(cardHeight)

    // Re-center card on screen
    const screenWidth = this.cameras.main.width
    const screenHeight = this.cameras.main.height
    const centerX = (screenWidth - cardWidth) / 2
    const centerY = (screenHeight - cardHeight) / 2
    this.selectionCard.setPosition(centerX, centerY)

    // Animated entry - scale up from center
    this.selectionCard.setScale(0.8)
    this.selectionCard.setAlpha(0)
    this.tweens.add({
      targets: this.selectionCard,
      scale: 1,
      alpha: 1,
      duration: 200,
      ease: 'Back.easeOut'
    })

    // Update avatar with bounce
    const spriteKey = unit.sprite?.texture?.key || 'unit-polecat-idle'
    this.cardAvatar.setTexture(spriteKey)
    this.cardAvatar.setScale(0)
    this.tweens.add({
      targets: this.cardAvatar,
      scale: 0.8,
      duration: 300,
      delay: 100,
      ease: 'Back.easeOut'
    })

    // Update name
    this.cardName.setText(unit.unitName || 'Unknown')

    // Update status badge
    this.cardStatusBg.clear()

    let statusColor, statusText
    switch(status) {
      case 'working':
        statusColor = 0x2ECC71
        statusText = 'WORKING'
        break
      case 'stuck':
        statusColor = 0xE74C3C
        statusText = 'NEEDS HELP!'
        break
      default:
        statusColor = 0x3498DB
        statusText = 'IDLE'
    }

    // Set text FIRST so we can measure its width for the badge
    this.cardStatus.setText(statusText)

    const textWidth = this.cardStatus.width + 24
    // Badge with gradient
    const darkStatus = this.darkenColor(statusColor, 40)
    this.cardStatusBg.fillStyle(darkStatus, 1)
    this.cardStatusBg.fillRoundedRect(110 - textWidth/2, 130, textWidth, 24, 12)
    this.cardStatusBg.fillStyle(statusColor, 1)
    this.cardStatusBg.fillRoundedRect(110 - textWidth/2, 128, textWidth, 22, 11)
    // Shine
    this.cardStatusBg.fillStyle(0xFFFFFF, 0.25)
    this.cardStatusBg.fillRoundedRect(110 - textWidth/2 + 3, 130, textWidth - 6, 8, { tl: 8, tr: 8, bl: 0, br: 0 })

    // Clear previous progress info
    if (this.cardProgressContainer) {
      this.cardProgressContainer.destroy()
    }

    // Show progress info for working/stuck units
    if (hasProgress) {
      this.showCardProgress(unit)
    }

    // Position buttons dynamically below progress (or below badge if no progress)
    const buttonsY = baseHeight + progressHeight
    this.cardButtons.setY(buttonsY)

    // Create contextual action buttons
    this.createCardButtons(status)

    // Update watching indicator (positioned at bottom of dynamic card)
    this.updateWatchingIndicator()

    // Emit watching event to server
    if (this.multiplayer?.socket) {
      this.multiplayer.socket.emit('watching', { agentId: unit.id })
    }

    this.statusText.setText(`Selected: ${unit.unitName}`)
  }

  updateWatchingIndicator() {
    // Remove previous watching indicator
    if (this.watchingIndicator) {
      this.watchingIndicator.destroy()
      this.watchingIndicator = null
    }

    if (!this.selectedUnit || !this.selectionCard?.visible) return

    const agentId = this.selectedUnit.id
    const watchers = this.userWatchers.get(agentId)

    if (watchers && watchers.size > 0) {
      // Create watching indicator at bottom of dynamic card
      this.watchingIndicator = this.add.container(110, this._currentCardHeight - 20)

      // Background pill
      const bg = this.add.graphics()
      const watcherCount = watchers.size
      const text = `👁 ${watcherCount} watching`
      const pillWidth = 90

      bg.fillStyle(0x9B59B6, 0.9)
      bg.fillRoundedRect(-pillWidth/2, -10, pillWidth, 20, 10)

      // Text
      const watchText = this.add.text(0, 0, text, {
        font: 'bold 10px Fredoka',
        fill: '#FFFFFF'
      }).setOrigin(0.5)

      this.watchingIndicator.add([bg, watchText])
      this.selectionCard.add(this.watchingIndicator)
    }
  }

  showCardProgress(unit) {
    const cardWidth = this._cardWidth

    this.cardProgressContainer = this.add.container(0, 160)

    // Progress bar background
    const progressBg = this.add.graphics()
    progressBg.fillStyle(0xE0E0E0, 1)
    progressBg.fillRoundedRect(15, 0, cardWidth - 30, 14, 7)

    // Progress bar fill
    const progress = unit.progress || 0
    const progressFill = this.add.graphics()
    if (progress > 0) {
      progressFill.fillStyle(0x2ECC71, 1)
      progressFill.fillRoundedRect(15, 0, Math.max(14, (cardWidth - 30) * (progress / 100)), 14, 7)
    }

    // Progress text
    const progressText = this.add.text(cardWidth/2, 7, `${progress}%`, {
      font: 'bold 10px Fredoka',
      fill: progress > 50 ? '#FFFFFF' : '#333333'
    }).setOrigin(0.5)

    // Time elapsed
    let timeText = ''
    if (unit.assignedAt) {
      const elapsed = Date.now() - new Date(unit.assignedAt).getTime()
      const mins = Math.round(elapsed / 60000)
      timeText = mins < 60 ? `${mins}m` : `${Math.round(mins/60)}h ${mins%60}m`
    }

    const timeLabel = this.add.text(15, 20, `⏱ ${timeText || '--'}`, {
      font: '11px Fredoka',
      fill: '#666666'
    })

    // Token usage
    const tokens = unit.tokensUsed || 0
    const tokenLabel = this.add.text(cardWidth - 15, 20, `🪙 ${tokens.toLocaleString()}`, {
      font: '11px Fredoka',
      fill: '#666666'
    }).setOrigin(1, 0)

    // Task preview
    if (unit.issue || unit.task) {
      const taskText = (unit.issue || unit.task || '').substring(0, 30)
      const taskLabel = this.add.text(cardWidth/2, 38, taskText + (taskText.length >= 30 ? '...' : ''), {
        font: '10px Fredoka',
        fill: '#999999'
      }).setOrigin(0.5, 0)
      this.cardProgressContainer.add(taskLabel)
    }

    this.cardProgressContainer.add([progressBg, progressFill, progressText, timeLabel, tokenLabel])
    this.selectionCard.add(this.cardProgressContainer)
  }

  createCardButtons(status) {
    this.cardButtons.removeAll(true)

    const buttonWidth = 196
    const buttonHeight = 40
    let buttons = []

    // Different buttons based on status
    if (status === 'idle') {
      buttons = [
        { label: 'ASSIGN WORK', action: 'sling', color: 0x2ECC71, icon: '>' },
        { label: 'SEND MESSAGE', action: 'mail', color: 0x9B59B6, icon: '@' }
      ]
    } else if (status === 'working') {
      buttons = [
        { label: 'VIEW OUTPUT', action: 'output', color: 0x3498DB, icon: '📄' },
        { label: 'TEST STUCK', action: 'teststuck', color: 0xE67E22, icon: '🦭' },
        { label: 'STOP WORK', action: 'stop', color: 0xE74C3C, icon: '!' }
      ]
    } else if (status === 'stuck') {
      buttons = [
        { label: 'VIEW OUTPUT', action: 'output', color: 0xE74C3C, icon: '📄' },
        { label: 'REASSIGN WORK', action: 'reassign', color: 0xF39C12, icon: '↻' },
        { label: 'MARK COMPLETE', action: 'complete', color: 0x2ECC71, icon: '✓' },
        { label: 'STOP', action: 'stop', color: 0x95A5A6, icon: 'X' }
      ]
    }

    buttons.forEach((btn, i) => {
      const y = i * (buttonHeight + 10)
      const darkColor = this.darkenColor(btn.color, 50)

      const bg = this.add.graphics()

      // Default button state
      const drawButton = (pressed = false, hover = false) => {
        bg.clear()
        const yOffset = pressed ? 2 : 0

        // Shadow
        if (!pressed) {
          bg.fillStyle(0x000000, 0.2)
          bg.fillRoundedRect(2, y + 3, buttonWidth - 4, buttonHeight, 12)
        }

        // Main button
        bg.fillStyle(darkColor, 1)
        bg.fillRoundedRect(0, y + yOffset + 2, buttonWidth, buttonHeight - 2, 12)
        bg.fillStyle(hover ? btn.color : this.darkenColor(btn.color, 10), 1)
        bg.fillRoundedRect(0, y + yOffset, buttonWidth, buttonHeight - 2, 12)

        // Top highlight (glossy)
        bg.fillStyle(0xFFFFFF, pressed ? 0.2 : 0.35)
        bg.fillRoundedRect(3, y + yOffset + 3, buttonWidth - 6, buttonHeight * 0.35, { tl: 10, tr: 10, bl: 0, br: 0 })

        // Border
        bg.lineStyle(1, 0xFFFFFF, 0.3)
        bg.strokeRoundedRect(0, y + yOffset, buttonWidth, buttonHeight - 2, 12)
      }

      drawButton()

      const text = this.add.text(buttonWidth/2, y + buttonHeight/2 - 1, btn.label, {
        font: 'bold 14px Fredoka',
        fill: '#FFFFFF',
        stroke: '#00000033',
        strokeThickness: 1
      }).setOrigin(0.5)

      const zone = this.add.zone(buttonWidth/2, y + buttonHeight/2, buttonWidth, buttonHeight)
      zone.setInteractive({ useHandCursor: true })

      zone.on('pointerover', () => {
        drawButton(false, true)
        this.tweens.add({
          targets: [bg, text],
          y: '-=2',
          duration: 80,
          ease: 'Sine.easeOut'
        })
      })

      zone.on('pointerout', () => {
        drawButton(false, false)
        this.tweens.add({
          targets: [bg, text],
          y: '+=2',
          duration: 80,
          ease: 'Sine.easeOut'
        })
      })

      zone.on('pointerdown', () => {
        drawButton(true, true)
        text.setY(y + buttonHeight/2 + 1)
      })

      zone.on('pointerup', () => {
        drawButton(false, true)
        text.setY(y + buttonHeight/2 - 1)
        this.executeCommand(btn.action)
      })

      this.cardButtons.add([bg, text, zone])
    })
  }

  hideSelectionCard() {
    // Animated exit - scale down to center
    this.tweens.add({
      targets: this.selectionCard,
      scale: 0.8,
      alpha: 0,
      duration: 150,
      ease: 'Back.easeIn',
      onComplete: () => {
        this.selectionCard.setVisible(false)
        this.selectionCard.setScale(1)
      }
    })

    // Clear watching indicator
    if (this.watchingIndicator) {
      this.watchingIndicator.destroy()
      this.watchingIndicator = null
    }

    // Emit watching null to server
    if (this.multiplayer?.socket) {
      this.multiplayer.socket.emit('watching', { agentId: null })
    }

    this.selectedUnit = null
    // Clear selection in game scene
    if (this.gameScene) {
      this.gameScene.selectedUnits.forEach(u => u.deselect())
      this.gameScene.selectedUnits = []
    }
    this.statusText.setText('Click a penguin!')
  }

  showBuildingCard(building) {
    // Reuse selection card for buildings
    this.selectionCard.setVisible(true)
    this.selectedUnit = null
    this.selectedBuilding = building

    // Animated entry
    this.selectionCard.setX(-200)
    this.selectionCard.setAlpha(0)
    this.tweens.add({
      targets: this.selectionCard,
      x: 20,
      alpha: 1,
      duration: 250,
      ease: 'Back.easeOut'
    })

    // Update avatar to building sprite
    this.cardAvatar.setTexture(building.type)
    this.cardAvatar.setScale(0)
    this.tweens.add({
      targets: this.cardAvatar,
      scale: 0.6,
      duration: 300,
      delay: 100,
      ease: 'Back.easeOut'
    })

    // Update name
    this.cardName.setText(building.name)

    // Status for building
    this.cardStatusBg.clear()
    this.cardStatusBg.fillStyle(0x6B3510, 1)
    this.cardStatusBg.fillRoundedRect(55, 130, 100, 24, 12)
    this.cardStatusBg.fillStyle(0x8B4513, 1)
    this.cardStatusBg.fillRoundedRect(55, 128, 100, 22, 11)
    this.cardStatusBg.fillStyle(0xFFFFFF, 0.25)
    this.cardStatusBg.fillRoundedRect(58, 130, 94, 8, { tl: 8, tr: 8, bl: 0, br: 0 })
    this.cardStatus.setText('BUILDING')

    // Building-specific buttons
    this.createBuildingButtons(building)

    this.statusText.setText(`Viewing: ${building.name}`)
  }

  createBuildingButtons(building) {
    this.cardButtons.removeAll(true)

    const buttonWidth = 196
    const buttonHeight = 40

    const buttons = [
      { label: 'SPAWN POLECAT', action: 'spawn', color: 0x2ECC71 },
      { label: 'VIEW POLECATS', action: 'list', color: 0x3498DB }
    ]

    // Add clone button for rigs
    if (building.type === 'building-rig') {
      buttons.push({ label: 'CLONE REPO', action: 'clone', color: 0x9B59B6 })
    }

    buttons.forEach((btn, i) => {
      const y = i * (buttonHeight + 10)
      const darkColor = this.darkenColor(btn.color, 50)

      const bg = this.add.graphics()

      const drawButton = (pressed = false, hover = false) => {
        bg.clear()
        const yOffset = pressed ? 2 : 0

        if (!pressed) {
          bg.fillStyle(0x000000, 0.2)
          bg.fillRoundedRect(2, y + 3, buttonWidth - 4, buttonHeight, 12)
        }

        bg.fillStyle(darkColor, 1)
        bg.fillRoundedRect(0, y + yOffset + 2, buttonWidth, buttonHeight - 2, 12)
        bg.fillStyle(hover ? btn.color : this.darkenColor(btn.color, 10), 1)
        bg.fillRoundedRect(0, y + yOffset, buttonWidth, buttonHeight - 2, 12)

        bg.fillStyle(0xFFFFFF, pressed ? 0.2 : 0.35)
        bg.fillRoundedRect(3, y + yOffset + 3, buttonWidth - 6, buttonHeight * 0.35, { tl: 10, tr: 10, bl: 0, br: 0 })

        bg.lineStyle(1, 0xFFFFFF, 0.3)
        bg.strokeRoundedRect(0, y + yOffset, buttonWidth, buttonHeight - 2, 12)
      }

      drawButton()

      const text = this.add.text(buttonWidth/2, y + buttonHeight/2 - 1, btn.label, {
        font: 'bold 14px Fredoka',
        fill: '#FFFFFF'
      }).setOrigin(0.5)

      const zone = this.add.zone(buttonWidth/2, y + buttonHeight/2, buttonWidth, buttonHeight)
      zone.setInteractive({ useHandCursor: true })

      zone.on('pointerover', () => drawButton(false, true))
      zone.on('pointerout', () => drawButton(false, false))
      zone.on('pointerdown', () => {
        drawButton(true, true)
        text.setY(y + buttonHeight/2 + 1)
      })
      zone.on('pointerup', () => {
        drawButton(false, true)
        text.setY(y + buttonHeight/2 - 1)
        this.executeBuildingCommand(btn.action, building)
      })

      this.cardButtons.add([bg, text, zone])
    })
  }

  async executeBuildingCommand(action, building) {
    const rigName = building.name

    switch(action) {
      case 'spawn':
        try {
          this.statusText.setText('Spawning polecat...')
          const result = await this.api.spawnPolecat(rigName)
          this.statusText.setText(`Spawned: ${result.name}`)
          await this.showModal({
            title: 'POLECAT SPAWNED!',
            message: `New polecat "${result.name}" is ready to work!`,
            showCancel: false
          })
          if (this.gameScene) this.gameScene.refreshState()
        } catch(e) {
          this.statusText.setText('Spawn failed')
          await this.showModal({
            title: 'SPAWN FAILED',
            message: e.message,
            showCancel: false
          })
        }
        break
      case 'list':
        try {
          const polecats = await this.api.getPolecats(rigName)
          const list = polecats.length > 0
            ? polecats.map(p => `• ${p.name} (${p.status})`).join('\n')
            : 'No polecats yet'
          await this.showModal({
            title: `POLECATS IN ${rigName.toUpperCase()}`,
            message: list,
            showCancel: false
          })
        } catch(e) {
          await this.showModal({
            title: 'ERROR',
            message: e.message,
            showCancel: false
          })
        }
        break
      case 'clone':
        const repo = await this.showModal({
          title: 'CLONE REPO',
          message: `Clone a repository into ${rigName}`,
          inputType: 'text',
          placeholder: 'https://github.com/user/repo'
        })
        if (repo && repo.trim()) {
          try {
            this.statusText.setText('Cloning...')
            await this.api.cloneRepo(rigName, repo)
            this.statusText.setText('Cloned!')
            await this.showModal({
              title: 'SUCCESS!',
              message: `Cloned ${repo} into ${rigName}`,
              showCancel: false
            })
          } catch(e) {
            this.statusText.setText('Clone failed')
            await this.showModal({
              title: 'CLONE FAILED',
              message: e.message,
              showCancel: false
            })
          }
        }
        break
    }
  }

  drawButton(graphics, x, y, width, height, color, raised = false) {
    const darkColor = this.darkenColor(color, 50)

    // Shadow
    if (raised) {
      graphics.fillStyle(0x000000, 0.25)
      graphics.fillRoundedRect(x + 2, y + 4, width, height, 12)
    }

    // Base
    graphics.fillStyle(darkColor, 1)
    graphics.fillRoundedRect(x, y + 2, width, height, 12)

    // Main button
    graphics.fillStyle(color, 1)
    graphics.fillRoundedRect(x, y, width, height, 12)

    // Top highlight (glossy)
    graphics.fillStyle(0xFFFFFF, 0.35)
    graphics.fillRoundedRect(x + 3, y + 3, width - 6, height * 0.35, { tl: 10, tr: 10, bl: 0, br: 0 })

    // Border
    graphics.lineStyle(1, 0xFFFFFF, 0.3)
    graphics.strokeRoundedRect(x, y, width, height, 12)
  }

  createTooltip() {
    this.tooltip = this.add.container(0, 0)
    this.tooltip.setVisible(false)

    const bg = this.add.graphics()

    // Frosted glass tooltip
    bg.fillStyle(0x000000, 0.15)
    bg.fillRoundedRect(4, 4, 170, 65, 12)
    bg.fillStyle(0xFFFFFF, 0.95)
    bg.fillRoundedRect(0, 0, 170, 65, 12)
    bg.fillStyle(0xF8FCFF, 0.8)
    bg.fillRoundedRect(2, 2, 166, 30, { tl: 10, tr: 10, bl: 0, br: 0 })
    bg.lineStyle(2, 0x0077B6, 0.8)
    bg.strokeRoundedRect(0, 0, 170, 65, 12)

    this.tooltipText = this.add.text(14, 12, '', {
      font: 'bold 13px Fredoka',
      fill: '#0077B6',
      wordWrap: { width: 150 }
    })

    this.tooltip.add([bg, this.tooltipText])
  }

  showTooltip(data) {
    let text = data.name
    if (data.status) text += `\nStatus: ${data.status}`
    if (data.type) text += `\nType: ${data.type}`

    this.tooltipText.setText(text)
    this.tooltip.setPosition(data.x + 25, data.y - 80)
    this.tooltip.setVisible(true)

    // Fade in
    this.tooltip.setAlpha(0)
    this.tweens.add({
      targets: this.tooltip,
      alpha: 1,
      duration: 100
    })
  }

  hideTooltip() {
    this.tooltip.setVisible(false)
  }

  updateSelection(units) {
    if (units.length === 0) {
      this.hideSelectionCard()
      this.hideBatchPanel()
    } else if (units.length === 1) {
      this.hideBatchPanel()
      this.showSelectionCard(units[0])
    } else {
      // Multiple selection - show batch panel
      this.hideSelectionCard()
      this.showBatchPanel(units)
      this.statusText.setText(`${units.length} penguins selected`)
    }
  }

  onBuildingClicked(building) {
    this.showBuildingCard(building)
  }

  updateResources(state) {
    if (state.tokens !== undefined) {
      this.animateResourceCounter(this.resources.tokens, state.tokens)
    }
    if (state.openIssues !== undefined) {
      this.animateResourceCounter(this.resources.issues, state.openIssues)
    }
    if (state.activeConvoys !== undefined) {
      this.animateResourceCounter(this.resources.convoys, state.activeConvoys)
    }
  }

  executeCommand(action) {
    // Get selected unit from card
    const unit = this.selectedUnit

    if (!unit) {
      window.alert('Select a penguin first!')
      return
    }

    // Build proper agent path for API calls: rig/polecats/polecatName
    // unit.id is "polecat-{name}" (game ID), unit.unitName is the raw polecat name
    const polecatName = unit.unitName || unit.id
    const agentId = unit.rig ? `${unit.rig}/polecats/${polecatName}` : polecatName
    console.log('Executing command:', action, 'on', agentId)

    switch(action) {
      case 'sling':
        this.doSling(agentId)
        break
      case 'hook':
        this.doViewHook(agentId)
        break
      case 'mail':
        this.doSendMail(agentId)
        break
      case 'stop':
        this.doStop(agentId)
        break
      case 'reassign':
        this.doReassign(agentId, unit)
        break
      case 'complete':
        this.doMarkComplete(agentId)
        break
      case 'teststuck':
        this.doTestStuck(agentId)
        break
      case 'output':
        this.showAgentOutput(agentId, unit.rig)
        break
    }
  }

  async doTestStuck(agentId) {
    const confirm = await this.showModal({
      title: 'TEST SEA LION',
      message: `Simulate ${agentId} getting stuck?\n\nThis will trigger the sea lion attack animation!`,
      showCancel: true
    })
    if (!confirm) return

    try {
      this.statusText.setText('Simulating stuck...')
      await this.api.simulateStuck(agentId)
      this.statusText.setText('Sea lion incoming!')

      // Refresh to trigger the animation
      if (this.gameScene) {
        this.gameScene.refreshState()
      }
      this.hideSelectionCard()
    } catch (e) {
      this.statusText.setText('Simulation failed')
      await this.showModal({
        title: 'ERROR',
        message: e.message,
        showCancel: false
      })
    }
  }

  async showSimulateStuckPicker() {
    // Fetch all polecats from all rigs
    try {
      const status = await this.api.getStatus()
      const polecats = status.polecats || []

      if (polecats.length === 0) {
        await this.showModal({
          title: 'NO POLECATS',
          message: 'Spawn some polecats first to test the sea lion attack!',
          showCancel: false
        })
        return
      }

      // Show picker modal
      const width = this.cameras.main.width
      const height = this.cameras.main.height
      const panelWidth = 350
      const panelHeight = Math.min(400, 150 + polecats.length * 55)

      const picker = this.add.container(width/2, height/2)
      picker.setDepth(1500)

      // Backdrop
      const backdrop = this.add.graphics()
      backdrop.fillStyle(0x000000, 0.6)
      backdrop.fillRect(-width/2, -height/2, width, height)
      backdrop.setInteractive(new Phaser.Geom.Rectangle(-width/2, -height/2, width, height), Phaser.Geom.Rectangle.Contains)
      backdrop.on('pointerup', () => {
        picker.destroy()
      })

      // Panel
      const panel = this.add.graphics()
      this.drawGlossyPanel(panel, -panelWidth/2, -panelHeight/2, panelWidth, panelHeight, 0xE67E22, 20)
      panel.fillStyle(0xFFFFFF, 0.98)
      panel.fillRoundedRect(-panelWidth/2 + 10, -panelHeight/2 + 60, panelWidth - 20, panelHeight - 80, 12)

      // Title
      const title = this.add.text(0, -panelHeight/2 + 30, '🦭 SUMMON SEA LION', {
        font: 'bold 18px Fredoka',
        fill: '#FFFFFF',
        stroke: '#C0392B',
        strokeThickness: 2
      }).setOrigin(0.5)

      // Subtitle
      const subtitle = this.add.text(0, -panelHeight/2 + 75, 'Pick a polecat to test stuck detection:', {
        font: '12px Fredoka',
        fill: '#666666'
      }).setOrigin(0.5)

      picker.add([backdrop, panel, title, subtitle])

      // List polecats
      let yPos = -panelHeight/2 + 105
      for (const polecat of polecats) {
        const statusIcon = polecat.status === 'working' ? '🔨' : polecat.status === 'stuck' ? '❌' : '💤'
        const statusColor = polecat.status === 'working' ? 0x2ECC71 : polecat.status === 'stuck' ? 0xE74C3C : 0x95A5A6

        // Row background
        const rowBg = this.add.graphics()
        rowBg.fillStyle(0xF8F8F8, 1)
        rowBg.fillRoundedRect(-panelWidth/2 + 20, yPos, panelWidth - 40, 45, 8)

        // Status badge
        const badge = this.add.graphics()
        badge.fillStyle(statusColor, 1)
        badge.fillRoundedRect(-panelWidth/2 + 28, yPos + 8, 8, 29, 4)

        // Polecat name
        const name = this.add.text(-panelWidth/2 + 48, yPos + 10, `${statusIcon} ${polecat.name}`, {
          font: 'bold 13px Fredoka',
          fill: '#333333'
        })

        // Rig name
        const rigLabel = this.add.text(-panelWidth/2 + 48, yPos + 28, `in ${polecat.rig || 'unknown'}`, {
          font: '11px Fredoka',
          fill: '#888888'
        })

        // Attack button
        const attackBtn = this.add.graphics()
        this.drawButton(attackBtn, panelWidth/2 - 90, yPos + 5, 55, 35, 0xE74C3C, true)
        const attackText = this.add.text(panelWidth/2 - 62, yPos + 22, '🦭', {
          font: '18px Fredoka'
        }).setOrigin(0.5)
        const attackZone = this.add.zone(panelWidth/2 - 62, yPos + 22, 55, 35)
        attackZone.setInteractive({ useHandCursor: true })
        attackZone.on('pointerup', async () => {
          picker.destroy()
          const agentId = `${polecat.rig}/polecats/${polecat.name}`
          await this.doTestStuckDirect(agentId)
        })

        picker.add([rowBg, badge, name, rigLabel, attackBtn, attackText, attackZone])
        yPos += 55
      }

      // Animate in
      picker.setScale(0.8)
      picker.setAlpha(0)
      this.tweens.add({
        targets: picker,
        scale: 1,
        alpha: 1,
        duration: 200,
        ease: 'Back.easeOut'
      })

    } catch (e) {
      await this.showModal({
        title: 'ERROR',
        message: 'Failed to load polecats: ' + e.message,
        showCancel: false
      })
    }
  }

  async doTestStuckDirect(agentId) {
    try {
      this.statusText.setText('Summoning sea lion...')

      // Extract polecat name from agentId (format: rigName/polecats/polecatName)
      const parts = agentId.split('/')
      const polecatName = parts[parts.length - 1]

      // Find the unit directly and play animation
      if (this.gameScene) {
        const unit = this.gameScene.units.get(`polecat-${polecatName}`)
        if (unit) {
          this.playNotificationSound('stuck')
          this.gameScene.playSeaLionAttack(unit)
          this.statusText.setText('Sea lion incoming!')

          // Also update the server status
          this.api.simulateStuck(agentId).catch(() => {})
        } else {
          this.statusText.setText('Polecat not found in game')
        }
      }
    } catch (e) {
      this.statusText.setText('Simulation failed')
      await this.showModal({
        title: 'ERROR',
        message: e.message,
        showCancel: false
      })
    }
  }

  async doSling(agentId) {
    const issueId = await this.showModal({
      title: 'ASSIGN WORK',
      message: `Sling work to ${agentId}`,
      inputType: 'text',
      placeholder: '#123 or issue URL'
    })
    if (!issueId) return

    try {
      this.statusText.setText('Slinging...')
      await this.api.sling(agentId, issueId.replace('#', ''))
      this.statusText.setText(`Slung ${issueId} to ${agentId}!`)
      await this.showModal({
        title: 'WORK ASSIGNED!',
        message: `Successfully slung ${issueId} to ${agentId}`,
        showCancel: false
      })
    } catch (e) {
      this.statusText.setText('Sling failed')
      await this.showModal({
        title: 'SLING FAILED',
        message: e.message,
        showCancel: false
      })
    }
  }

  async doViewHook(agentId) {
    try {
      this.statusText.setText('Loading progress...')
      const result = await this.api.getHook(agentId)

      let message = ''
      let title = 'POLECAT STATUS'

      if (result.status === 'stuck') {
        title = 'POLECAT NEEDS HELP!'
        message += `Task: ${result.hook || 'Unknown task'}\n\n`
        message += `Status: STUCK\n`

        if (result.stuckReason === 'tokens') {
          message += `Reason: Exceeded token limit\n`
          message += `Tokens used: ${(result.tokensUsed || 0).toLocaleString()}\n`
        } else if (result.stuckReason === 'time') {
          message += `Reason: Task running too long\n`
        } else {
          message += `Reason: ${result.stuckReason || 'Unknown'}\n`
        }

        if (result.stuckAt) {
          const stuckTime = new Date(result.stuckAt)
          const minsAgo = Math.round((Date.now() - stuckTime.getTime()) / 60000)
          message += `Stuck for: ${minsAgo} minutes\n`
        }

        message += `\nOptions: Reassign work or mark complete.`

      } else if (result.hook) {
        title = 'POLECAT PROGRESS'
        message += `Task: ${result.hook}\n\n`
        message += `Status: ${result.status || 'unknown'}\n`

        if (result.assignedAt) {
          const assigned = new Date(result.assignedAt)
          const elapsed = Math.round((Date.now() - assigned.getTime()) / 60000)
          message += `Working for: ${elapsed} minutes\n`
        }

        if (result.tokensUsed) {
          message += `Tokens used: ${result.tokensUsed.toLocaleString()}\n`
        }

        if (result.progress !== undefined) {
          message += `Progress: ${result.progress}%`
        }

      } else if (result.completedTask) {
        title = 'POLECAT IDLE'
        message += `Last completed: ${result.completedTask}\n`
        if (result.completedAt) {
          const completed = new Date(result.completedAt)
          message += `Completed: ${completed.toLocaleString()}\n`
        }
        message += `\nReady for new work!`

      } else {
        title = 'POLECAT IDLE'
        message = 'No active task - polecat is ready for work!'
      }

      this.statusText.setText('Status loaded')
      await this.showModal({
        title: title,
        message: message,
        showCancel: false
      })
    } catch (e) {
      this.statusText.setText('Failed to load status')
      await this.showModal({
        title: 'STATUS ERROR',
        message: e.message,
        showCancel: false
      })
    }
  }

  async doSendMail(agentId) {
    const message = await this.showModal({
      title: 'SEND MESSAGE',
      message: `Send a message to ${agentId}`,
      inputType: 'text',
      placeholder: 'Type your message...'
    })
    if (!message) return

    const subject = await this.showModal({
      title: 'SUBJECT',
      message: 'Enter subject (optional)',
      inputType: 'text',
      placeholder: 'Subject line...'
    }) || ''

    try {
      this.statusText.setText('Sending mail...')
      await this.api.sendMail(agentId, subject, message)
      this.statusText.setText('Mail sent!')
      await this.showModal({
        title: 'MESSAGE SENT!',
        message: `Your message was delivered to ${agentId}`,
        showCancel: false
      })
    } catch (e) {
      this.statusText.setText('Mail failed')
      await this.showModal({
        title: 'SEND FAILED',
        message: e.message,
        showCancel: false
      })
    }
  }

  async doStop(agentId) {
    const confirm = await this.showModal({
      title: 'EMERGENCY STOP',
      message: `Stop ${agentId}?\n\nThis will halt the agent immediately.`,
      showCancel: true
    })
    if (!confirm) return

    try {
      this.statusText.setText('Stopping...')
      await this.api.stop(agentId)
      this.statusText.setText(`${agentId} stopped!`)
      await this.showModal({
        title: 'STOPPED',
        message: `${agentId} has been stopped`,
        showCancel: false
      })
    } catch (e) {
      this.statusText.setText('Stop failed')
      await this.showModal({
        title: 'STOP FAILED',
        message: e.message,
        showCancel: false
      })
    }
  }

  async doReassign(agentId, unit) {
    // Find the rig this polecat belongs to
    const rigName = unit.rig || this.findRigForAgent(agentId)

    if (!rigName) {
      await this.showModal({
        title: 'ERROR',
        message: 'Could not find project for this agent',
        showCancel: false
      })
      return
    }

    try {
      // Get all polecats in the same rig
      const polecats = await this.api.getPolecats(rigName)
      const idlePolecats = polecats.filter(p => p.status === 'idle' && p.name !== unit.unitName)

      // Show polecat picker
      const choice = await this.showReassignPicker(idlePolecats, rigName)

      if (!choice) return

      this.statusText.setText('Reassigning...')

      if (choice === 'spawn_new') {
        // Spawn a new polecat and assign to it
        const newPolecat = await this.api.spawnPolecat(rigName)
        if (this.gameScene) {
          this.gameScene.addPolecatToVillage(rigName, newPolecat.name)
        }
        await this.api.reassign(agentId, `${rigName}/polecats/${newPolecat.name}`, rigName)
        this.showNotification('success', 'Task Reassigned',
          `Spawned ${newPolecat.name} and reassigned task`,
          { agent: newPolecat.name, rig: rigName })
      } else {
        // Reassign to existing polecat
        await this.api.reassign(agentId, `${rigName}/polecats/${choice}`, rigName)
        this.showNotification('success', 'Task Reassigned',
          `Task moved to ${choice}`,
          { agent: choice, rig: rigName })
      }

      this.statusText.setText('Reassigned!')

      if (this.gameScene) {
        this.gameScene.refreshState()
      }
      this.hideSelectionCard()

    } catch (e) {
      this.statusText.setText('Reassign failed')
      await this.showModal({
        title: 'REASSIGN FAILED',
        message: e.message,
        showCancel: false
      })
    }
  }

  findRigForAgent(agentId) {
    // Try to extract rig from agent ID (format: rig/polecats/name)
    const parts = agentId.split('/')
    if (parts.length >= 3) return parts[0]

    // Search villages for this agent
    const villages = this.gameScene?.villages || []
    for (const v of villages) {
      if (v.polecats?.includes(agentId)) {
        return v.name
      }
    }
    return null
  }

  async showReassignPicker(idlePolecats, rigName) {
    return new Promise((resolve) => {
      const width = this.cameras.main.width
      const height = this.cameras.main.height
      const modalWidth = 320
      const modalHeight = 300 + Math.min(idlePolecats.length, 4) * 45

      this.reassignModal = this.add.container(width/2, height/2)
      this.reassignModal.setDepth(1500)

      // Backdrop
      const backdrop = this.add.graphics()
      backdrop.fillStyle(0x000000, 0.6)
      backdrop.fillRect(-width/2, -height/2, width, height)
      backdrop.setInteractive(new Phaser.Geom.Rectangle(-width/2, -height/2, width, height), Phaser.Geom.Rectangle.Contains)

      // Panel
      const panel = this.add.graphics()
      this.drawGlossyPanel(panel, -modalWidth/2, -modalHeight/2, modalWidth, modalHeight, 0xF39C12, 18)
      panel.fillStyle(0xFFFFFF, 0.98)
      panel.fillRoundedRect(-modalWidth/2 + 10, -modalHeight/2 + 55, modalWidth - 20, modalHeight - 70, 10)

      // Title
      const title = this.add.text(0, -modalHeight/2 + 28, 'REASSIGN TASK', {
        font: 'bold 18px Fredoka',
        fill: '#FFFFFF'
      }).setOrigin(0.5)

      const subtitle = this.add.text(0, -modalHeight/2 + 75, 'Choose a polecat to take over:', {
        font: '13px Fredoka',
        fill: '#666666'
      }).setOrigin(0.5)

      this.reassignModal.add([backdrop, panel, title, subtitle])

      let yPos = -modalHeight/2 + 100

      // Cleanup function
      const cleanup = () => {
        this.reassignModal.destroy()
        this.reassignModal = null
      }

      // Idle polecats
      if (idlePolecats.length === 0) {
        const noIdle = this.add.text(0, yPos + 20, 'No idle polecats available', {
          font: '12px Fredoka',
          fill: '#999999'
        }).setOrigin(0.5)
        this.reassignModal.add(noIdle)
        yPos += 50
      } else {
        idlePolecats.slice(0, 4).forEach((p, i) => {
          const btn = this.add.graphics()
          this.drawButton(btn, -modalWidth/2 + 20, yPos, modalWidth - 40, 38, 0x3498DB, true)
          const btnText = this.add.text(0, yPos + 19, p.name, {
            font: 'bold 13px Fredoka',
            fill: '#FFFFFF'
          }).setOrigin(0.5)
          const btnZone = this.add.zone(0, yPos + 19, modalWidth - 40, 38)
          btnZone.setInteractive({ useHandCursor: true })
          btnZone.on('pointerdown', () => {
            cleanup()
            resolve(p.name)
          })
          this.reassignModal.add([btn, btnText, btnZone])
          yPos += 45
        })
      }

      // Spawn new button
      yPos += 10
      const spawnBtn = this.add.graphics()
      this.drawButton(spawnBtn, -modalWidth/2 + 20, yPos, modalWidth - 40, 38, 0x2ECC71, true)
      const spawnText = this.add.text(0, yPos + 19, '+ SPAWN NEW POLECAT', {
        font: 'bold 13px Fredoka',
        fill: '#FFFFFF'
      }).setOrigin(0.5)
      const spawnZone = this.add.zone(0, yPos + 19, modalWidth - 40, 38)
      spawnZone.setInteractive({ useHandCursor: true })
      spawnZone.on('pointerdown', () => {
        cleanup()
        resolve('spawn_new')
      })
      this.reassignModal.add([spawnBtn, spawnText, spawnZone])

      // Cancel button
      yPos += 55
      const cancelBtn = this.add.graphics()
      this.drawButton(cancelBtn, -modalWidth/2 + 20, yPos, modalWidth - 40, 38, 0x95A5A6, true)
      const cancelText = this.add.text(0, yPos + 19, 'CANCEL', {
        font: 'bold 13px Fredoka',
        fill: '#FFFFFF'
      }).setOrigin(0.5)
      const cancelZone = this.add.zone(0, yPos + 19, modalWidth - 40, 38)
      cancelZone.setInteractive({ useHandCursor: true })
      cancelZone.on('pointerdown', () => {
        cleanup()
        resolve(null)
      })
      this.reassignModal.add([cancelBtn, cancelText, cancelZone])

      // Animate in
      this.reassignModal.setScale(0.8)
      this.reassignModal.setAlpha(0)
      this.tweens.add({
        targets: this.reassignModal,
        scale: 1,
        alpha: 1,
        duration: 200,
        ease: 'Back.easeOut'
      })
    })
  }

  async doMarkComplete(agentId) {
    const confirm = await this.showModal({
      title: 'MARK COMPLETE',
      message: `Mark ${agentId}'s task as complete?\n\nThis will set the polecat to idle.`,
      showCancel: true
    })
    if (!confirm) return

    try {
      this.statusText.setText('Completing...')
      await this.api.markComplete(agentId)
      this.statusText.setText(`${agentId} task complete!`)

      // Show celebration
      this.showCompletionCelebration()

      this.showNotification('success', 'Task Completed!',
        `${agentId} is now idle and ready for more work`)

      if (this.gameScene) {
        this.gameScene.refreshState()
      }
      this.hideSelectionCard()

    } catch (e) {
      this.statusText.setText('Failed to complete')
      await this.showModal({
        title: 'COMPLETION FAILED',
        message: e.message,
        showCancel: false
      })
    }
  }

  showCompletionCelebration() {
    // Create confetti particles
    const width = this.cameras.main.width
    const height = this.cameras.main.height
    const colors = [0xFF6B6B, 0x4ECDC4, 0xFFE66D, 0x95E1D3, 0xF38181, 0xAA96DA]

    for (let i = 0; i < 50; i++) {
      const x = width * 0.3 + Math.random() * width * 0.4
      const y = -20

      const confetti = this.add.graphics()
      const color = colors[Math.floor(Math.random() * colors.length)]
      confetti.fillStyle(color, 1)

      if (Math.random() > 0.5) {
        confetti.fillRect(0, 0, 8, 12)
      } else {
        confetti.fillCircle(0, 0, 5)
      }

      confetti.setPosition(x, y)
      confetti.setDepth(2000)

      this.tweens.add({
        targets: confetti,
        y: height + 50,
        x: x + (Math.random() - 0.5) * 200,
        angle: Math.random() * 720,
        duration: 2000 + Math.random() * 1000,
        delay: Math.random() * 500,
        ease: 'Quad.easeIn',
        onComplete: () => confetti.destroy()
      })
    }

    // Play celebration sound
    this.playNotificationSound('success')
  }

  // Mayor Chat Panel
  createMayorChatPanel() {
    const width = this.cameras.main.width
    const height = this.cameras.main.height
    const panelWidth = 360
    const panelHeight = 450

    this.mayorChat = this.add.container(width - panelWidth - 20, 70)
    this.mayorChat.setVisible(false)
    this.mayorChat.setDepth(900)

    // Panel background
    const bg = this.add.graphics()
    // Shadow
    bg.fillStyle(0x000000, 0.3)
    bg.fillRoundedRect(5, 5, panelWidth, panelHeight, 20)
    // Main panel
    bg.fillStyle(0xFFFFFF, 0.98)
    bg.fillRoundedRect(0, 0, panelWidth, panelHeight, 20)
    // Header
    bg.fillStyle(0x8B4513, 1)
    bg.fillRoundedRect(0, 0, panelWidth, 65, { tl: 20, tr: 20, bl: 0, br: 0 })
    bg.fillStyle(0x6B3510, 1)
    bg.fillRoundedRect(0, 45, panelWidth, 20, 0)
    // Header shine
    bg.fillStyle(0xFFFFFF, 0.15)
    bg.fillRoundedRect(4, 4, panelWidth - 8, 20, { tl: 16, tr: 16, bl: 0, br: 0 })
    // Border
    bg.lineStyle(3, 0x8B4513, 1)
    bg.strokeRoundedRect(0, 0, panelWidth, panelHeight, 20)

    // Mayor avatar
    const avatarBg = this.add.graphics()
    avatarBg.fillStyle(0xFFFFFF, 1)
    avatarBg.fillCircle(45, 35, 28)
    avatarBg.lineStyle(3, 0x6B3510, 1)
    avatarBg.strokeCircle(45, 35, 28)

    const mayorAvatar = this.add.image(45, 35, 'unit-mayor').setScale(0.6)

    // Title
    const title = this.add.text(85, 20, 'MAYOR', {
      font: 'bold 22px Fredoka',
      fill: '#FFFFFF',
      stroke: '#6B3510',
      strokeThickness: 2
    })

    const subtitle = this.add.text(85, 44, 'Town Manager', {
      font: '13px Fredoka',
      fill: '#D2B48C'
    })

    // Close button
    const closeBtn = this.add.graphics()
    closeBtn.fillStyle(0xFF6B6B, 0.9)
    closeBtn.fillCircle(panelWidth - 25, 25, 14)
    const closeX = this.add.text(panelWidth - 25, 25, '×', {
      font: 'bold 20px Fredoka',
      fill: '#FFFFFF'
    }).setOrigin(0.5)
    const closeZone = this.add.zone(panelWidth - 25, 25, 28, 28).setInteractive({ useHandCursor: true })
    closeZone.on('pointerdown', () => this.closeMayorChat())

    // Chat history area
    const chatBg = this.add.graphics()
    chatBg.fillStyle(0xF5F5F5, 1)
    chatBg.fillRoundedRect(12, 75, panelWidth - 24, panelHeight - 150, 12)

    // Chat messages container (will scroll)
    this.chatMessages = this.add.container(20, 85)
    this.chatHistory = []
    this.chatScrollY = 0

    // Input area background
    const inputBg = this.add.graphics()
    inputBg.fillStyle(0xE8F4FC, 1)
    inputBg.fillRoundedRect(12, panelHeight - 65, panelWidth - 80, 45, 10)
    inputBg.lineStyle(2, 0x0077B6, 0.5)
    inputBg.strokeRoundedRect(12, panelHeight - 65, panelWidth - 80, 45, 10)

    // Send button
    const sendBtn = this.add.graphics()
    this.drawButton(sendBtn, panelWidth - 60, panelHeight - 65, 48, 45, 0x2ECC71, true)
    const sendText = this.add.text(panelWidth - 36, panelHeight - 42, '➤', {
      font: 'bold 20px Fredoka',
      fill: '#FFFFFF'
    }).setOrigin(0.5)
    const sendZone = this.add.zone(panelWidth - 36, panelHeight - 42, 48, 45).setInteractive({ useHandCursor: true })
    sendZone.on('pointerdown', () => this.sendMayorMessage())

    this.mayorChat.add([bg, avatarBg, mayorAvatar, title, subtitle, closeBtn, closeX, closeZone,
                        chatBg, this.chatMessages, inputBg, sendBtn, sendText, sendZone])

    // Add welcome message
    this.addMayorMessage("mayor", "Welcome to Penguin Town! I'm the Mayor. I can help you:\n\n• Create new projects\n• Clone repos\n• Describe what you need built - I'll create tasks!\n• Assign issue numbers or full specs\n\nJust tell me what you need!")
  }

  openMayorChat() {
    this.mayorChat.setVisible(true)
    this.mayorChat.setAlpha(0)
    this.mayorChat.setX(this.cameras.main.width)

    this.tweens.add({
      targets: this.mayorChat,
      x: this.cameras.main.width - 380,
      alpha: 1,
      duration: 300,
      ease: 'Back.easeOut'
    })

    // Create DOM input for chat
    if (!this.chatInput) {
      this.chatInput = document.createElement('input')
      this.chatInput.type = 'text'
      this.chatInput.placeholder = 'Ask the Mayor...'
      this.chatInput.style.cssText = `
        position: fixed;
        right: 100px;
        top: ${70 + 450 - 60}px;
        width: 250px;
        height: 36px;
        padding: 0 8px;
        font-family: Fredoka, sans-serif;
        font-size: 14px;
        border: none;
        background: transparent;
        outline: none;
        color: #333;
      `
      document.body.appendChild(this.chatInput)

      this.chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && this.chatInput.value.trim()) {
          this.sendMayorMessage()
        }
      })

      // Prevent keyboard events from bubbling to Phaser
      this.chatInput.addEventListener('keydown', (e) => {
        e.stopPropagation()
      })
    }
    this.chatInput.style.display = 'block'
    this.chatInput.focus()
  }

  closeMayorChat() {
    this.tweens.add({
      targets: this.mayorChat,
      x: this.cameras.main.width + 50,
      alpha: 0,
      duration: 200,
      ease: 'Back.easeIn',
      onComplete: () => this.mayorChat.setVisible(false)
    })

    if (this.chatInput) {
      this.chatInput.style.display = 'none'
    }
  }

  addMayorMessage(sender, text) {
    const isUser = sender === 'user'
    const yPos = this.chatHistory.length * 70

    const msgContainer = this.add.container(0, yPos)

    // Message bubble
    const bubble = this.add.graphics()
    const bubbleWidth = 300
    const textObj = this.add.text(isUser ? bubbleWidth - 10 : 10, 8, text, {
      font: '13px Fredoka',
      fill: isUser ? '#FFFFFF' : '#333333',
      wordWrap: { width: bubbleWidth - 30 }
    })
    if (isUser) textObj.setOrigin(1, 0)

    const bubbleHeight = Math.max(40, textObj.height + 16)

    if (isUser) {
      bubble.fillStyle(0x0077B6, 1)
      bubble.fillRoundedRect(bubbleWidth - textObj.width - 24, 0, textObj.width + 20, bubbleHeight, 12)
    } else {
      bubble.fillStyle(0xE8E8E8, 1)
      bubble.fillRoundedRect(0, 0, textObj.width + 20, bubbleHeight, 12)
    }

    msgContainer.add([bubble, textObj])
    this.chatMessages.add(msgContainer)
    this.chatHistory.push({ sender, text })

    // Scroll to bottom
    const maxScroll = Math.max(0, (this.chatHistory.length * 70) - 280)
    this.chatMessages.y = 85 - maxScroll
  }

  async sendMayorMessage() {
    const text = this.chatInput?.value?.trim()
    if (!text) return

    this.chatInput.value = ''
    this.addMayorMessage('user', text)

    // Process the message
    await this.processMayorCommand(text)
  }

  async processMayorCommand(text) {
    const lower = text.toLowerCase()

    // Simple command parsing
    if (lower.includes('new project') || lower.includes('create project') || lower.includes('start project')) {
      this.addMayorMessage('mayor', "Great! Let's create a new project. What would you like to name it?")
      this.mayorState = 'awaiting_project_name'
      return
    }

    if (lower.includes('clone') && (lower.includes('github') || lower.includes('repo'))) {
      // Extract URL if present
      const urlMatch = text.match(/https?:\/\/[^\s]+|github\.com\/[^\s]+/)
      if (urlMatch) {
        const url = urlMatch[0].startsWith('http') ? urlMatch[0] : `https://${urlMatch[0]}`
        this.addMayorMessage('mayor', `I'll clone ${url} for you. What should I name this project?`)
        this.mayorState = 'awaiting_clone_name'
        this.pendingRepoUrl = url
        return
      }
      this.addMayorMessage('mayor', "Sure! What's the repository URL you'd like to clone?")
      this.mayorState = 'awaiting_repo_url'
      return
    }

    if (lower.includes('work on') || lower.includes('assign') || lower.includes('issue')) {
      const issueMatch = text.match(/#?(\d+)/)
      if (issueMatch) {
        // Auto-assign issue to a project and polecat
        this.pendingSpec = `Issue #${issueMatch[1]}`
        await this.autoAssignTask()
        return
      }
      this.addMayorMessage('mayor', "Which issue number would you like to assign? (e.g., #123)")
      this.mayorState = 'awaiting_issue_number'
      return
    }

    // Handle spec/task descriptions - look for action words or longer text
    if (lower.includes('build') || lower.includes('fix') || lower.includes('add') ||
        lower.includes('create') || lower.includes('implement') || lower.includes('update') ||
        lower.includes('make') || lower.includes('change') || lower.includes('write') ||
        text.length > 50) {
      // This looks like a spec - auto-assign it
      this.pendingSpec = text
      await this.autoAssignTask()
      return
    }

    if (lower.includes('spawn') || lower.includes('new polecat') || lower.includes('create polecat')) {
      this.addMayorMessage('mayor', "I'll spawn a new polecat. Which project should they join?")
      this.mayorState = 'awaiting_spawn_project'
      return
    }

    if (lower.includes('list') || lower.includes('show') || lower.includes('projects') || lower.includes('villages')) {
      const villages = this.gameScene?.villages || []
      if (villages.length === 0) {
        this.addMayorMessage('mayor', "No projects yet! Say 'new project' to create one.")
      } else {
        const list = villages.map(v => `• ${v.name} (${v.polecats?.length || 0} polecats)`).join('\n')
        this.addMayorMessage('mayor', `Here are your projects:\n\n${list}`)
      }
      return
    }

    if (lower.includes('help')) {
      this.addMayorMessage('mayor', "I can help you with:\n\n• 'New project' - Create a village\n• 'Clone [url]' - Import a repo\n• 'Assign #123' - Give issue work\n• Describe a task - I'll create & assign it!\n• 'Spawn polecat' - New worker\n• 'List projects' - See all villages\n• 'Status' - How are things going?\n\nTry: \"Build a login page with OAuth\"")
      return
    }

    if (lower.includes('status') || lower.includes('how are things') || lower.includes('how\'s it going') || lower.includes('what\'s happening')) {
      this.reportStatus()
      return
    }

    // Handle state-based responses
    if (this.mayorState === 'awaiting_project_name') {
      const name = text.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase()
      this.addMayorMessage('mayor', `Creating project "${name}"...`)
      try {
        await this.api.createRig(name)
        if (this.gameScene) {
          this.gameScene.addVillage(name)
        }
        this.addMayorMessage('mayor', `Done! "${name}" village is ready. Want me to clone a repo into it?`)
        this.currentProject = name
        this.mayorState = 'awaiting_clone_confirm'
      } catch (e) {
        this.addMayorMessage('mayor', `Oops! Failed to create project: ${e.message}`)
        this.mayorState = null
      }
      return
    }

    if (this.mayorState === 'awaiting_repo_url') {
      const url = text.startsWith('http') ? text : `https://${text}`
      this.addMayorMessage('mayor', "Got it! What should I name this project?")
      this.pendingRepoUrl = url
      this.mayorState = 'awaiting_clone_name'
      return
    }

    if (this.mayorState === 'awaiting_clone_name') {
      const name = text.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase()
      this.addMayorMessage('mayor', `Creating "${name}" and cloning the repo...`)
      try {
        await this.api.createRig(name)
        await this.api.cloneRepo(name, this.pendingRepoUrl)
        if (this.gameScene) {
          this.gameScene.addVillage(name, this.pendingRepoUrl)
        }
        this.addMayorMessage('mayor', `Success! "${name}" is set up with the repo. Shall I spawn a polecat to work on it?`)
        this.currentProject = name
        this.mayorState = 'awaiting_spawn_confirm'
      } catch (e) {
        this.addMayorMessage('mayor', `Failed: ${e.message}`)
        this.mayorState = null
      }
      return
    }

    if (this.mayorState === 'awaiting_clone_confirm') {
      if (lower.includes('yes') || lower.includes('sure') || lower.includes('ok')) {
        this.addMayorMessage('mayor', "What's the repo URL?")
        this.mayorState = 'awaiting_repo_for_existing'
      } else {
        this.addMayorMessage('mayor', "No problem! Let me know if you need anything else.")
        this.mayorState = null
      }
      return
    }

    if (this.mayorState === 'awaiting_repo_for_existing') {
      const url = text.startsWith('http') ? text : `https://${text}`
      this.addMayorMessage('mayor', `Cloning into "${this.currentProject}"...`)
      try {
        await this.api.cloneRepo(this.currentProject, url)
        this.addMayorMessage('mayor', "Cloned! Want me to spawn a polecat?")
        this.mayorState = 'awaiting_spawn_confirm'
      } catch (e) {
        this.addMayorMessage('mayor', `Clone failed: ${e.message}`)
        this.mayorState = null
      }
      return
    }

    if (this.mayorState === 'awaiting_spawn_confirm') {
      if (lower.includes('yes') || lower.includes('sure') || lower.includes('ok')) {
        this.addMayorMessage('mayor', "Spawning a polecat...")
        try {
          const result = await this.api.spawnPolecat(this.currentProject)
          if (this.gameScene) {
            this.gameScene.addPolecatToVillage(this.currentProject, result.name)
          }
          this.addMayorMessage('mayor', `${result.name} has joined "${this.currentProject}"! Just tell me what to build and I'll assign it.`)
          this.currentPolecat = result.name
          this.mayorState = null
        } catch (e) {
          this.addMayorMessage('mayor', `Spawn failed: ${e.message}`)
          this.mayorState = null
        }
      } else {
        this.addMayorMessage('mayor', "Alright! The project is ready whenever you need it.")
        this.mayorState = null
      }
      return
    }

    // Default response
    this.addMayorMessage('mayor', "I'm not sure what you mean. Try 'help' to see what I can do!")
    this.mayorState = null
  }

  // Report overall status
  async reportStatus() {
    try {
      const status = await this.api.getStatus()
      const polecats = status.polecats || []

      const working = polecats.filter(p => p.status === 'working')
      const stuck = polecats.filter(p => p.status === 'stuck')
      const idle = polecats.filter(p => p.status === 'idle')

      let message = ''

      if (polecats.length === 0) {
        message = "No polecats yet! Create a project and spawn some workers to get started."
      } else {
        message = `Town Status:\n\n`
        message += `• ${working.length} polecat${working.length !== 1 ? 's' : ''} working\n`
        message += `• ${idle.length} polecat${idle.length !== 1 ? 's' : ''} idle\n`

        if (stuck.length > 0) {
          message += `• ⚠️ ${stuck.length} polecat${stuck.length !== 1 ? 's' : ''} need help!\n\n`
          message += `Stuck agents:\n`
          stuck.forEach(p => {
            message += `  - ${p.name} in ${p.rig}\n`
          })
        }

        if (working.length > 0 && stuck.length === 0) {
          message += `\nEveryone's making good progress!`
        }
      }

      this.addMayorMessage('mayor', message)
    } catch (e) {
      this.addMayorMessage('mayor', `Couldn't get status: ${e.message}`)
    }
  }

  // Auto-assign a task to the best available project and polecat
  async autoAssignTask() {
    if (!this.pendingSpec) {
      this.addMayorMessage('mayor', "Something went wrong - no task to assign.")
      return
    }

    this.addMayorMessage('mayor', `Got it! I'll find someone to work on:\n"${this.pendingSpec.substring(0, 60)}${this.pendingSpec.length > 60 ? '...' : ''}"`)

    // Get projects from API (more reliable than gameScene)
    let projects = []
    try {
      const rigs = await this.api.getRigs()
      // Filter out system rigs
      projects = rigs.filter(r => !['mayor', 'deacon', 'refinery'].includes(r.name))
    } catch (e) {
      console.error('Failed to get rigs:', e)
    }

    // If no projects, create a default one
    if (projects.length === 0) {
      this.addMayorMessage('mayor', `No projects yet - creating one...`)
      try {
        const projectName = 'my-project'
        await this.api.createRig(projectName)
        if (this.gameScene) {
          this.gameScene.addVillage(projectName)
        }
        this.currentProject = projectName
        this.addMayorMessage('mayor', `Created project "${projectName}"!`)
      } catch (e) {
        this.addMayorMessage('mayor', `Failed to create project: ${e.message}`)
        this.mayorState = null
        this.pendingSpec = null
        return
      }
    } else if (projects.length === 1) {
      this.currentProject = projects[0].name
    } else {
      // Multiple projects - prefer currentProject if valid
      if (this.currentProject && projects.find(p => p.name === this.currentProject)) {
        // Keep current project
      } else {
        this.currentProject = projects[projects.length - 1].name
      }
    }

    this.addMayorMessage('mayor', `Using project "${this.currentProject}"...`)

    // Now find or spawn a polecat
    try {
      const polecats = await this.api.getPolecats(this.currentProject)

      // Find an idle polecat
      const idlePolecat = polecats.find(p => p.status === 'idle')

      if (idlePolecat) {
        this.currentPolecat = idlePolecat.name
        this.addMayorMessage('mayor', `Found idle polecat: ${idlePolecat.name}`)
      } else if (polecats.length === 0) {
        // No polecats - spawn one
        this.addMayorMessage('mayor', `No polecats yet - spawning one...`)
        const result = await this.api.spawnPolecat(this.currentProject)
        if (this.gameScene) {
          this.gameScene.addPolecatToVillage(this.currentProject, result.name)
        }
        this.currentPolecat = result.name
      } else {
        // All polecats busy - spawn another
        this.addMayorMessage('mayor', `All ${polecats.length} polecats busy - spawning another...`)
        const result = await this.api.spawnPolecat(this.currentProject)
        if (this.gameScene) {
          this.gameScene.addPolecatToVillage(this.currentProject, result.name)
        }
        this.currentPolecat = result.name
      }

      await this.slingSpecToPolecat()
    } catch (e) {
      this.addMayorMessage('mayor', `Error assigning task: ${e.message}`)
      this.mayorState = null
      this.pendingSpec = null
    }
  }

  // Helper to sling the pending spec to the current polecat
  async slingSpecToPolecat() {
    if (!this.pendingSpec || !this.currentPolecat || !this.currentProject) {
      this.addMayorMessage('mayor', "Something went wrong - missing task details. Please try again.")
      this.mayorState = null
      return
    }

    this.addMayorMessage('mayor', `Assigning task to ${this.currentPolecat}...\n\n"${this.pendingSpec.substring(0, 80)}${this.pendingSpec.length > 80 ? '...' : ''}"`)

    try {
      // Use the spec as the "issue" - the sling endpoint accepts any string
      await this.api.sling(
        `${this.currentProject}/polecats/${this.currentPolecat}`,
        this.pendingSpec
      )

      this.addMayorMessage('mayor', `${this.currentPolecat} is now working on your task!\n\nI'll let you know when they make progress or if they get stuck.`)

      if (this.gameScene) {
        this.gameScene.refreshState()
      }

      // Clear pending state
      this.pendingSpec = null
      this.currentPolecat = null
      this.currentProject = null
      this.mayorState = null

    } catch (e) {
      this.addMayorMessage('mayor', `Failed to assign task: ${e.message}\n\nTry again or check if the polecat is available.`)
      this.mayorState = null
    }
  }

  handleResize(gameSize) {
    const width = gameSize.width
    const height = gameSize.height

    // Reposition UI elements
    if (this.topBar) {
      this.topBar.clear()
      this.drawGlossyPanel(this.topBar, 10, 8, width - 20, 50, 0x0077B6, 14)
    }

    if (this.townName) {
      this.townName.setPosition(width - 30, 18)
    }

    if (this.statusText) {
      this.statusText.setPosition(width - 30, 40)
    }

    if (this.usersContainer) {
      this.usersContainer.setPosition(width - 290, 33)
    }

    if (this.settingsBtn) {
      this.settingsBtn.setPosition(width - 235, 33)
    }
  }

  createVillageNavigator() {
    // Village navigator - small panel to jump between villages
    const x = 20
    const y = this.cameras.main.height - 200
    const width = 150

    this.villageNav = this.add.container(x, y)
    this.villageNav.setDepth(100)

    // Background
    this.villageNavBg = this.add.graphics()
    this.villageNav.add(this.villageNavBg)

    // Title
    this.villageNavTitle = this.add.text(width/2, 12, 'VILLAGES', {
      font: 'bold 12px Fredoka',
      fill: '#FFFFFF',
      stroke: '#005588',
      strokeThickness: 2
    }).setOrigin(0.5, 0)
    this.villageNav.add(this.villageNavTitle)

    // Village buttons container
    this.villageButtons = this.add.container(0, 35)
    this.villageNav.add(this.villageButtons)

    this.updateVillageNavigator()
  }

  updateVillageNavigator() {
    const villages = this.gameScene?.villages || []
    const width = 150
    const buttonHeight = 32

    // Clear existing buttons
    this.villageButtons.removeAll(true)

    // Calculate panel height
    const panelHeight = 45 + villages.length * (buttonHeight + 5)

    // Redraw background
    this.villageNavBg.clear()
    this.drawGlossyPanel(this.villageNavBg, 0, 0, width, panelHeight, 0x0077B6, 12)

    // Add button for each village
    villages.forEach((village, i) => {
      const y = i * (buttonHeight + 5)

      const btn = this.add.graphics()
      const color = village.isHub ? 0x8B4513 : 0x2ECC71

      // Button background
      btn.fillStyle(this.darkenColor(color, 30), 1)
      btn.fillRoundedRect(8, y + 2, width - 16, buttonHeight - 2, 8)
      btn.fillStyle(color, 1)
      btn.fillRoundedRect(8, y, width - 16, buttonHeight - 2, 8)
      // Shine
      btn.fillStyle(0xFFFFFF, 0.2)
      btn.fillRoundedRect(10, y + 2, width - 20, 10, { tl: 6, tr: 6, bl: 0, br: 0 })

      // Status indicator dot (green=all idle, yellow=working, red=stuck)
      const statusDot = this.add.graphics()
      const villageStatus = this.getVillageStatus(village)
      const dotColor = villageStatus === 'stuck' ? 0xE74C3C :
                       villageStatus === 'working' ? 0xF39C12 : 0x2ECC71
      statusDot.fillStyle(0x000000, 0.3)
      statusDot.fillCircle(20, y + buttonHeight/2 + 1, 5)
      statusDot.fillStyle(dotColor, 1)
      statusDot.fillCircle(20, y + buttonHeight/2, 5)
      statusDot.fillStyle(0xFFFFFF, 0.4)
      statusDot.fillCircle(18, y + buttonHeight/2 - 2, 2)

      // Label (offset to make room for status dot)
      const label = this.add.text(width/2 + 5, y + buttonHeight/2 - 1, village.name, {
        font: 'bold 10px Fredoka',
        fill: '#FFFFFF'
      }).setOrigin(0.5)

      // Polecat count
      const count = this.add.text(width - 20, y + buttonHeight/2 - 1, `${village.polecats?.length || 0}`, {
        font: '10px Fredoka',
        fill: '#FFFFFF',
        backgroundColor: '#00000033',
        padding: { x: 4, y: 2 }
      }).setOrigin(1, 0.5)

      // Interaction
      const zone = this.add.zone(width/2, y + buttonHeight/2, width - 16, buttonHeight)
      zone.setInteractive({ useHandCursor: true })

      zone.on('pointerover', () => {
        btn.clear()
        btn.fillStyle(this.darkenColor(color, 10), 1)
        btn.fillRoundedRect(8, y + 2, width - 16, buttonHeight - 2, 8)
        btn.fillStyle(color, 1)
        btn.fillRoundedRect(8, y - 2, width - 16, buttonHeight - 2, 8)
        btn.fillStyle(0xFFFFFF, 0.3)
        btn.fillRoundedRect(10, y, width - 20, 10, { tl: 6, tr: 6, bl: 0, br: 0 })
        label.setY(y + buttonHeight/2 - 3)
        count.setY(y + buttonHeight/2 - 3)
      })

      zone.on('pointerout', () => {
        btn.clear()
        btn.fillStyle(this.darkenColor(color, 30), 1)
        btn.fillRoundedRect(8, y + 2, width - 16, buttonHeight - 2, 8)
        btn.fillStyle(color, 1)
        btn.fillRoundedRect(8, y, width - 16, buttonHeight - 2, 8)
        btn.fillStyle(0xFFFFFF, 0.2)
        btn.fillRoundedRect(10, y + 2, width - 20, 10, { tl: 6, tr: 6, bl: 0, br: 0 })
        label.setY(y + buttonHeight/2 - 1)
        count.setY(y + buttonHeight/2 - 1)
      })

      zone.on('pointerup', () => {
        if (this.gameScene) {
          this.gameScene.panToVillage(village.name)
        }
      })

      this.villageButtons.add([btn, statusDot, label, count, zone])
    })

    // Reposition the navigator based on new height
    this.villageNav.setY(this.cameras.main.height - panelHeight - 80)
  }

  getVillageStatus(village) {
    // Get all polecats in this village from game scene
    // units is a Map, so convert to array
    const unitsMap = this.gameScene?.units
    if (!unitsMap) return 'idle'

    const units = Array.from(unitsMap.values())
    const villagePolecats = units.filter(u =>
      village.polecats?.includes(u.unitName) || village.polecats?.includes(u.id)
    )

    if (villagePolecats.some(p => p.status === 'stuck')) return 'stuck'
    if (villagePolecats.some(p => p.status === 'working')) return 'working'
    return 'idle'
  }

  createNewProjectButton() {
    // "New Project" button in bottom left corner
    const x = 20
    const y = this.cameras.main.height - 65
    const width = 150
    const height = 48

    this.newProjectBtn = this.add.container(x, y)

    const bg = this.add.graphics()
    this.drawButton(bg, 0, 0, width, height, 0x9B59B6, true)

    const text = this.add.text(width/2, height/2, '+ NEW PROJECT', {
      font: 'bold 15px Fredoka',
      fill: '#FFFFFF',
      stroke: '#00000044',
      strokeThickness: 1
    }).setOrigin(0.5)

    const zone = this.add.zone(width/2, height/2, width, height)
    zone.setInteractive({ useHandCursor: true })

    zone.on('pointerover', () => {
      bg.clear()
      this.drawButton(bg, 0, -3, width, height, 0x8E44AD, true)
      text.setY(height/2 - 3)
    })

    zone.on('pointerout', () => {
      bg.clear()
      this.drawButton(bg, 0, 0, width, height, 0x9B59B6, true)
      text.setY(height/2)
    })

    zone.on('pointerdown', () => {
      bg.clear()
      this.drawButton(bg, 0, 2, width, height, 0x7D3C98, false)
      text.setY(height/2 + 2)
    })

    zone.on('pointerup', () => {
      bg.clear()
      this.drawButton(bg, 0, 0, width, height, 0x9B59B6, true)
      text.setY(height/2)
      this.showNewProjectDialog()
    })

    this.newProjectBtn.add([bg, text, zone])
  }

  // Club Penguin style modal dialog
  showModal(options) {
    return new Promise((resolve) => {
      const { title, message, placeholder, defaultValue, showCancel = true } = options
      const width = this.cameras.main.width
      const height = this.cameras.main.height
      const modalWidth = 380
      const modalHeight = options.inputType ? 240 : 180

      // Modal container
      this.modal = this.add.container(width/2, height/2)
      this.modal.setDepth(1500)

      // Backdrop
      const backdrop = this.add.graphics()
      backdrop.fillStyle(0x000000, 0.6)
      backdrop.fillRect(-width/2, -height/2, width, height)
      backdrop.setInteractive(new Phaser.Geom.Rectangle(-width/2, -height/2, width, height), Phaser.Geom.Rectangle.Contains)

      // Modal card
      const card = this.add.graphics()
      // Outer glow
      card.fillStyle(0x87CEEB, 0.5)
      card.fillRoundedRect(-modalWidth/2 - 6, -modalHeight/2 - 6, modalWidth + 12, modalHeight + 12, 24)
      // Shadow
      card.fillStyle(0x000000, 0.3)
      card.fillRoundedRect(-modalWidth/2 + 6, -modalHeight/2 + 6, modalWidth, modalHeight, 22)
      // Main card
      card.fillStyle(0xFFFFFF, 0.98)
      card.fillRoundedRect(-modalWidth/2, -modalHeight/2, modalWidth, modalHeight, 22)
      // Header
      card.fillStyle(0x0077B6, 1)
      card.fillRoundedRect(-modalWidth/2, -modalHeight/2, modalWidth, 55, { tl: 22, tr: 22, bl: 0, br: 0 })
      card.fillStyle(0x005588, 1)
      card.fillRoundedRect(-modalWidth/2, -modalHeight/2 + 35, modalWidth, 20, 0)
      // Header shine
      card.fillStyle(0xFFFFFF, 0.2)
      card.fillRoundedRect(-modalWidth/2 + 4, -modalHeight/2 + 4, modalWidth - 8, 18, { tl: 18, tr: 18, bl: 0, br: 0 })
      // Border
      card.lineStyle(3, 0x0077B6, 1)
      card.strokeRoundedRect(-modalWidth/2, -modalHeight/2, modalWidth, modalHeight, 22)

      // Title
      const titleText = this.add.text(0, -modalHeight/2 + 28, title, {
        font: 'bold 20px Fredoka',
        fill: '#FFFFFF',
        stroke: '#005588',
        strokeThickness: 2
      }).setOrigin(0.5)

      // Message
      const msgText = this.add.text(0, -modalHeight/2 + 75, message, {
        font: '14px Fredoka',
        fill: '#333333',
        align: 'center',
        wordWrap: { width: modalWidth - 40 }
      }).setOrigin(0.5, 0)

      this.modal.add([backdrop, card, titleText, msgText])

      let inputValue = defaultValue || ''

      // Input field if needed
      if (options.inputType) {
        const inputBg = this.add.graphics()
        inputBg.fillStyle(0xE8F4FC, 1)
        inputBg.fillRoundedRect(-modalWidth/2 + 20, -modalHeight/2 + 110, modalWidth - 40, 40, 10)
        inputBg.lineStyle(2, 0x0077B6, 0.5)
        inputBg.strokeRoundedRect(-modalWidth/2 + 20, -modalHeight/2 + 110, modalWidth - 40, 40, 10)

        // Use DOM input for text entry
        const inputEl = document.createElement('input')
        inputEl.type = 'text'
        inputEl.value = defaultValue || ''
        inputEl.placeholder = placeholder || ''
        inputEl.style.cssText = `
          position: fixed;
          left: ${width/2 - modalWidth/2 + 28}px;
          top: ${height/2 - modalHeight/2 + 115}px;
          width: ${modalWidth - 60}px;
          height: 30px;
          font-family: Fredoka, sans-serif;
          font-size: 16px;
          border: none;
          background: transparent;
          outline: none;
          color: #0077B6;
        `
        document.body.appendChild(inputEl)
        inputEl.focus()

        inputEl.addEventListener('input', (e) => {
          inputValue = e.target.value
        })

        inputEl.addEventListener('keypress', (e) => {
          if (e.key === 'Enter') {
            cleanup()
            resolve(inputValue)
          }
        })

        // Prevent keyboard events from bubbling to Phaser
        inputEl.addEventListener('keydown', (e) => {
          e.stopPropagation()
        })

        this.modal.inputEl = inputEl
        this.modal.add([inputBg])
      }

      // Buttons
      const btnY = modalHeight/2 - 45
      const btnWidth = showCancel ? 130 : 180
      const btnSpacing = showCancel ? 150 : 0

      const cleanup = () => {
        if (this.modal.inputEl) {
          this.modal.inputEl.remove()
        }
        this.modal.destroy()
        this.modal = null
      }

      // OK button
      const okBtn = this.add.graphics()
      this.drawButton(okBtn, showCancel ? 10 : -btnWidth/2, btnY - 18, btnWidth, 36, 0x2ECC71, true)
      const okText = this.add.text(showCancel ? 10 + btnWidth/2 : 0, btnY, 'OK', {
        font: 'bold 16px Fredoka',
        fill: '#FFFFFF'
      }).setOrigin(0.5)
      const okZone = this.add.zone(showCancel ? 10 + btnWidth/2 : 0, btnY, btnWidth, 36)
      okZone.setInteractive({ useHandCursor: true })
      okZone.on('pointerover', () => {
        okBtn.clear()
        this.drawButton(okBtn, showCancel ? 10 : -btnWidth/2, btnY - 20, btnWidth, 36, 0x27AE60, true)
        okText.setY(btnY - 2)
      })
      okZone.on('pointerout', () => {
        okBtn.clear()
        this.drawButton(okBtn, showCancel ? 10 : -btnWidth/2, btnY - 18, btnWidth, 36, 0x2ECC71, true)
        okText.setY(btnY)
      })
      okZone.on('pointerup', () => {
        cleanup()
        // Return inputValue for input modals, true for confirm modals
        resolve(options.inputType ? inputValue : true)
      })

      this.modal.add([okBtn, okText, okZone])

      // Cancel button
      if (showCancel) {
        const cancelBtn = this.add.graphics()
        this.drawButton(cancelBtn, -btnWidth - 10, btnY - 18, btnWidth, 36, 0x95A5A6, true)
        const cancelText = this.add.text(-btnWidth/2 - 10, btnY, 'Cancel', {
          font: 'bold 16px Fredoka',
          fill: '#FFFFFF'
        }).setOrigin(0.5)
        const cancelZone = this.add.zone(-btnWidth/2 - 10, btnY, btnWidth, 36)
        cancelZone.setInteractive({ useHandCursor: true })
        cancelZone.on('pointerover', () => {
          cancelBtn.clear()
          this.drawButton(cancelBtn, -btnWidth - 10, btnY - 20, btnWidth, 36, 0x7F8C8D, true)
          cancelText.setY(btnY - 2)
        })
        cancelZone.on('pointerout', () => {
          cancelBtn.clear()
          this.drawButton(cancelBtn, -btnWidth - 10, btnY - 18, btnWidth, 36, 0x95A5A6, true)
          cancelText.setY(btnY)
        })
        cancelZone.on('pointerup', () => {
          cleanup()
          resolve(null)
        })

        this.modal.add([cancelBtn, cancelText, cancelZone])
      }

      // Animate in
      this.modal.setScale(0.8)
      this.modal.setAlpha(0)
      this.tweens.add({
        targets: this.modal,
        scale: 1,
        alpha: 1,
        duration: 200,
        ease: 'Back.easeOut'
      })
    })
  }

  showProjectStartOptions() {
    return new Promise((resolve) => {
      const width = this.cameras.main.width
      const height = this.cameras.main.height
      const modalWidth = 340
      const modalHeight = 200

      const picker = this.add.container(width/2, height/2)
      picker.setDepth(1500)

      const backdrop = this.add.graphics()
      backdrop.fillStyle(0x000000, 0.6)
      backdrop.fillRect(-width/2, -height/2, width, height)
      backdrop.setInteractive(new Phaser.Geom.Rectangle(-width/2, -height/2, width, height), Phaser.Geom.Rectangle.Contains)
      backdrop.on('pointerup', () => {
        picker.destroy()
        resolve(null)
      })

      const panel = this.add.graphics()
      this.drawGlossyPanel(panel, -modalWidth/2, -modalHeight/2, modalWidth, modalHeight, 0x9B59B6, 18)
      panel.fillStyle(0xFFFFFF, 0.98)
      panel.fillRoundedRect(-modalWidth/2 + 10, -modalHeight/2 + 55, modalWidth - 20, modalHeight - 70, 10)

      const title = this.add.text(0, -modalHeight/2 + 28, 'NEW PROJECT', {
        font: 'bold 18px Fredoka',
        fill: '#FFFFFF'
      }).setOrigin(0.5)

      picker.add([backdrop, panel, title])

      // Fresh start button
      const freshBtn = this.add.graphics()
      this.drawButton(freshBtn, -modalWidth/2 + 20, -30, modalWidth - 40, 45, 0x2ECC71, true)
      const freshText = this.add.text(0, -7, 'START FRESH', {
        font: 'bold 14px Fredoka',
        fill: '#FFFFFF'
      }).setOrigin(0.5)
      const freshZone = this.add.zone(0, -7, modalWidth - 40, 45).setInteractive({ useHandCursor: true })
      freshZone.on('pointerup', () => {
        picker.destroy()
        resolve('fresh')
      })
      picker.add([freshBtn, freshText, freshZone])

      // Template button
      const templateBtn = this.add.graphics()
      this.drawButton(templateBtn, -modalWidth/2 + 20, 25, modalWidth - 40, 45, 0x3498DB, true)
      const templateText = this.add.text(0, 48, 'USE TEMPLATE', {
        font: 'bold 14px Fredoka',
        fill: '#FFFFFF'
      }).setOrigin(0.5)
      const templateZone = this.add.zone(0, 48, modalWidth - 40, 45).setInteractive({ useHandCursor: true })
      templateZone.on('pointerup', () => {
        picker.destroy()
        resolve('template')
      })
      picker.add([templateBtn, templateText, templateZone])

      picker.setScale(0.8)
      picker.setAlpha(0)
      this.tweens.add({
        targets: picker,
        scale: 1,
        alpha: 1,
        duration: 200,
        ease: 'Back.easeOut'
      })
    })
  }

  async showNewProjectDialog() {
    // First, show option to use template or start fresh
    const useTemplate = await this.showProjectStartOptions()
    if (useTemplate === 'template') {
      this.showTemplatesPanel()
      return
    }
    if (useTemplate === null) return

    const rigName = await this.showModal({
      title: 'NEW PROJECT',
      message: 'Step 1/3: Enter a name for your project rig',
      inputType: 'text',
      placeholder: 'e.g., my-project'
    })
    if (!rigName) return

    const repoUrl = await this.showModal({
      title: 'CLONE REPO',
      message: 'Step 2/3: Enter repository URL to clone\n(Leave blank to skip)',
      inputType: 'text',
      placeholder: 'https://github.com/user/repo'
    })

    const issueId = await this.showModal({
      title: 'ASSIGN WORK',
      message: 'Step 3/3: Enter issue to sling\n(Leave blank to skip)',
      inputType: 'text',
      placeholder: '#123'
    })

    this.createProject(rigName, repoUrl, issueId)
  }

  async createProject(rigName, repoUrl, issueId) {
    try {
      // Show loading state
      this.statusText.setText('Creating project...')

      // Step 1: Create rig
      await this.api.createRig(rigName)
      console.log(`Created rig: ${rigName}`)

      // Step 2: Clone repo if provided
      if (repoUrl && repoUrl.trim()) {
        await this.api.cloneRepo(rigName, repoUrl.trim())
        console.log(`Cloned repo: ${repoUrl}`)
      }

      // Step 3: Spawn a polecat
      const polecat = await this.api.spawnPolecat(rigName)
      console.log(`Spawned polecat: ${polecat.name}`)

      // Step 4: Sling issue if provided
      if (issueId) {
        const cleanIssue = issueId.replace('#', '')
        await this.api.sling(`${rigName}/polecats/${polecat.name}`, cleanIssue)
        console.log(`Slung issue: ${cleanIssue}`)
      }

      this.statusText.setText('Project created!')

      // Notify game scene to refresh and add new building
      if (this.gameScene) {
        this.gameScene.addBuilding(`rig-${rigName}`, rigName, 14, 8, 'building-rig')
        this.gameScene.refreshState()
      }

      await this.showModal({
        title: 'PROJECT CREATED!',
        message: `${rigName} is ready!\n\nPolecat "${polecat.name}" is standing by.`,
        showCancel: false
      })

    } catch (e) {
      console.error('Failed to create project:', e)
      this.statusText.setText('Failed to create project')
      await this.showModal({
        title: 'PROJECT FAILED',
        message: e.message,
        showCancel: false
      })
    }
  }

  // ===== ACTIVITY FEED / TIMELINE =====

  createActivityFeed() {
    const width = 280
    const height = this.cameras.main.height - 160
    const x = 10
    const y = 70

    this.activityFeed = this.add.container(x, y)
    this.activityFeed.setDepth(100)

    // Toggle button
    this.feedToggleBtn = this.add.container(0, 0)
    const toggleBg = this.add.graphics()
    toggleBg.fillStyle(0x0077B6, 0.9)
    toggleBg.fillRoundedRect(0, 0, 40, 40, 10)
    toggleBg.fillStyle(0xFFFFFF, 0.15)
    toggleBg.fillRoundedRect(2, 2, 36, 18, { tl: 8, tr: 8, bl: 0, br: 0 })
    const toggleIcon = this.add.text(20, 20, '📋', { font: '18px Fredoka' }).setOrigin(0.5)
    const toggleZone = this.add.zone(20, 20, 40, 40).setInteractive({ useHandCursor: true })
    toggleZone.on('pointerup', () => this.toggleActivityFeed())
    this.feedToggleBtn.add([toggleBg, toggleIcon, toggleZone])
    this.activityFeed.add(this.feedToggleBtn)

    // Feed panel (hidden initially)
    this.feedPanel = this.add.container(0, 0)
    this.feedPanel.setVisible(false)
    this.activityFeed.add(this.feedPanel)

    // Panel background
    const bg = this.add.graphics()
    this.drawGlossyPanel(bg, 0, 0, width, height, 0x0077B6, 16)
    bg.fillStyle(0xFFFFFF, 0.98)
    bg.fillRoundedRect(8, 50, width - 16, height - 60, 12)
    this.feedPanel.add(bg)

    // Title
    const title = this.add.text(width/2, 26, 'ACTIVITY FEED', {
      font: 'bold 16px Fredoka',
      fill: '#FFFFFF',
      stroke: '#005588',
      strokeThickness: 2
    }).setOrigin(0.5)
    this.feedPanel.add(title)

    // Filter buttons
    this.feedFilters = this.add.container(15, 55)
    const filters = [
      { label: 'All', type: null },
      { label: 'Tasks', type: 'task_assigned,task_completed,task_queued,task_reassigned' },
      { label: 'Agents', type: 'agent_spawned,agent_stuck' },
      { label: 'Projects', type: 'project_created,repo_cloned' }
    ]
    this.currentFeedFilter = null

    filters.forEach((f, i) => {
      const btnX = i * 62
      const btn = this.add.graphics()
      const isActive = this.currentFeedFilter === f.type
      btn.fillStyle(isActive ? 0x0077B6 : 0xE8F4FC, 1)
      btn.fillRoundedRect(btnX, 0, 58, 24, 6)
      const text = this.add.text(btnX + 29, 12, f.label, {
        font: 'bold 10px Fredoka',
        fill: isActive ? '#FFFFFF' : '#0077B6'
      }).setOrigin(0.5)
      const zone = this.add.zone(btnX + 29, 12, 58, 24).setInteractive({ useHandCursor: true })
      zone.on('pointerup', () => {
        this.currentFeedFilter = f.type
        this.loadActivityFeed()
        this.updateFeedFilters()
      })
      this.feedFilters.add([btn, text, zone])
      f.btn = btn
      f.text = text
    })
    this.feedFilterDefs = filters
    this.feedPanel.add(this.feedFilters)

    // Events list
    this.feedEventsContainer = this.add.container(15, 85)
    this.feedPanel.add(this.feedEventsContainer)
    this.feedEvents = []

    // Scrolling mask
    const maskShape = this.add.graphics()
    maskShape.fillStyle(0xFFFFFF)
    maskShape.fillRect(x + 8, y + 85, width - 16, height - 100)
    const mask = maskShape.createGeometryMask()
    maskShape.setVisible(false) // Hide the mask shape itself
    this.feedEventsContainer.setMask(mask)
    this.feedScrollY = 0

    // Close button
    const closeBtn = this.add.graphics()
    closeBtn.fillStyle(0xFF6B6B, 0.9)
    closeBtn.fillCircle(width - 18, 18, 12)
    const closeX = this.add.text(width - 18, 18, '×', {
      font: 'bold 16px Fredoka',
      fill: '#FFFFFF'
    }).setOrigin(0.5)
    const closeZone = this.add.zone(width - 18, 18, 24, 24).setInteractive({ useHandCursor: true })
    closeZone.on('pointerup', () => this.toggleActivityFeed())
    this.feedPanel.add([closeBtn, closeX, closeZone])

    // Load initial data
    this.loadActivityFeed()
  }

  toggleActivityFeed() {
    const isVisible = this.feedPanel.visible
    if (isVisible) {
      this.tweens.add({
        targets: this.feedPanel,
        x: -300,
        alpha: 0,
        duration: 200,
        ease: 'Back.easeIn',
        onComplete: () => this.feedPanel.setVisible(false)
      })
    } else {
      this.feedPanel.setVisible(true)
      this.feedPanel.setX(-300)
      this.feedPanel.setAlpha(0)
      this.tweens.add({
        targets: this.feedPanel,
        x: 0,
        alpha: 1,
        duration: 300,
        ease: 'Back.easeOut'
      })
      this.loadActivityFeed()
    }
  }

  updateFeedFilters() {
    this.feedFilterDefs.forEach(f => {
      const isActive = this.currentFeedFilter === f.type
      f.btn.clear()
      f.btn.fillStyle(isActive ? 0x0077B6 : 0xE8F4FC, 1)
      f.btn.fillRoundedRect(f.btn.x || 0, 0, 58, 24, 6)
      f.text.setStyle({ fill: isActive ? '#FFFFFF' : '#0077B6' })
    })
  }

  async loadActivityFeed() {
    try {
      const result = await this.api.getActivityFeed({
        limit: 50,
        type: this.currentFeedFilter
      })
      this.renderActivityFeed(result.events)
    } catch (e) {
      console.error('Failed to load activity feed:', e)
    }
  }

  renderActivityFeed(events) {
    this.feedEventsContainer.removeAll(true)
    this.feedEvents = []

    let yPos = 0
    events.forEach((event, i) => {
      const item = this.createFeedEvent(event, yPos)
      this.feedEventsContainer.add(item)
      this.feedEvents.push(item)
      yPos += 55
    })

    if (events.length === 0) {
      const empty = this.add.text(125, 50, 'No activity yet', {
        font: '13px Fredoka',
        fill: '#999999'
      }).setOrigin(0.5)
      this.feedEventsContainer.add(empty)
    }
  }

  createFeedEvent(event, y) {
    const container = this.add.container(0, y)
    const width = 250

    // Event type colors and icons
    const typeConfig = {
      task_assigned: { color: 0x2ECC71, icon: '📋' },
      task_completed: { color: 0x27AE60, icon: '✓' },
      task_queued: { color: 0x3498DB, icon: '📥' },
      task_reassigned: { color: 0xF39C12, icon: '↻' },
      agent_spawned: { color: 0x9B59B6, icon: '🐧' },
      agent_stuck: { color: 0xE74C3C, icon: '⚠' },
      project_created: { color: 0x8B4513, icon: '🏠' },
      repo_cloned: { color: 0x6C5CE7, icon: '📦' },
      pr_created: { color: 0x24292E, icon: '🐙' },
      pr_merged: { color: 0x9B59B6, icon: '🎉' }
    }

    const config = typeConfig[event.type] || { color: 0x95A5A6, icon: '•' }

    // Background
    const bg = this.add.graphics()
    bg.fillStyle(0xF8F8F8, 1)
    bg.fillRoundedRect(0, 0, width, 50, 8)
    bg.fillStyle(config.color, 1)
    bg.fillRoundedRect(0, 0, 5, 50, { tl: 8, tr: 0, bl: 8, br: 0 })

    // Icon
    const icon = this.add.text(20, 25, config.icon, {
      font: '16px Fredoka'
    }).setOrigin(0.5)

    // Title
    const title = this.formatEventTitle(event)
    const titleText = this.add.text(38, 10, title, {
      font: 'bold 11px Fredoka',
      fill: '#333333',
      wordWrap: { width: width - 50 }
    })

    // Timestamp
    const time = this.formatRelativeTime(event.timestamp)
    const timeText = this.add.text(38, 32, time, {
      font: '10px Fredoka',
      fill: '#999999'
    })

    // User
    if (event.user && event.user !== 'system') {
      const userText = this.add.text(width - 8, 32, event.user, {
        font: '10px Fredoka',
        fill: '#0077B6'
      }).setOrigin(1, 0)
      container.add(userText)
    }

    // Click to navigate
    const zone = this.add.zone(width/2, 25, width, 50).setInteractive({ useHandCursor: true })
    zone.on('pointerup', () => this.handleFeedEventClick(event))
    zone.on('pointerover', () => {
      bg.clear()
      bg.fillStyle(0xE8F4FC, 1)
      bg.fillRoundedRect(0, 0, width, 50, 8)
      bg.fillStyle(config.color, 1)
      bg.fillRoundedRect(0, 0, 5, 50, { tl: 8, tr: 0, bl: 8, br: 0 })
    })
    zone.on('pointerout', () => {
      bg.clear()
      bg.fillStyle(0xF8F8F8, 1)
      bg.fillRoundedRect(0, 0, width, 50, 8)
      bg.fillStyle(config.color, 1)
      bg.fillRoundedRect(0, 0, 5, 50, { tl: 8, tr: 0, bl: 8, br: 0 })
    })

    container.add([bg, icon, titleText, timeText, zone])
    return container
  }

  formatEventTitle(event) {
    switch (event.type) {
      case 'task_assigned':
        return `Task assigned to ${event.agent}`
      case 'task_completed':
        return `${event.agent} completed task`
      case 'task_queued':
        return `Task "${event.task}" queued`
      case 'task_reassigned':
        return `Task moved to ${event.toAgent}`
      case 'agent_spawned':
        return `Agent ${event.agent} spawned`
      case 'agent_stuck':
        return `${event.agent} needs help!`
      case 'project_created':
        return `Project "${event.project}" created`
      case 'repo_cloned':
        return `Repo cloned to ${event.project}`
      case 'pr_created':
        return `PR created: ${event.pr}`
      case 'pr_merged':
        return `PR merged: ${event.pr}`
      default:
        return event.type
    }
  }

  formatRelativeTime(timestamp) {
    const now = Date.now()
    const time = new Date(timestamp).getTime()
    const diff = now - time

    if (diff < 60000) return 'Just now'
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
    return `${Math.floor(diff / 86400000)}d ago`
  }

  handleFeedEventClick(event) {
    // Navigate to relevant agent/project
    if (event.rig && this.gameScene) {
      this.gameScene.panToVillage(event.rig)
    }
    if (event.agent) {
      this.statusText.setText(`Viewing: ${event.agent}`)
    }
  }

  addFeedEvent(event) {
    // Called via WebSocket when new events arrive
    if (this.feedPanel?.visible) {
      this.loadActivityFeed()
    }
  }

  // ===== TASK QUEUE / BACKLOG PANEL =====

  createTaskQueuePanel() {
    const panelHeight = 200
    const x = 200
    // Position container so toggle button sits at the very bottom edge
    // Toggle button is 40px tall, sits above the panel
    const screenHeight = this.cameras.main.height
    const y = screenHeight - 40  // Bottom of screen minus toggle height

    this.taskQueue = this.add.container(x, y)
    this.taskQueue.setDepth(100)
    this._queuePanelHeight = panelHeight

    // Toggle button — sits at container origin (bottom edge of screen)
    this.queueToggleBtn = this.add.container(0, 0)
    const toggleBg = this.add.graphics()
    toggleBg.fillStyle(0x3498DB, 0.9)
    toggleBg.fillRoundedRect(0, 0, 120, 40, { tl: 10, tr: 10, bl: 0, br: 0 })
    const toggleText = this.add.text(60, 20, '📥 QUEUE (0)', {
      font: 'bold 12px Fredoka',
      fill: '#FFFFFF'
    }).setOrigin(0.5)
    const toggleZone = this.add.zone(60, 20, 120, 40).setInteractive({ useHandCursor: true })
    toggleZone.on('pointerup', () => this.toggleTaskQueue())
    this.queueToggleBtn.add([toggleBg, toggleText, toggleZone])
    this.queueToggleText = toggleText
    this.taskQueue.add(this.queueToggleBtn)

    // Queue panel (hidden initially) — positioned above toggle button
    this.queuePanel = this.add.container(0, -panelHeight)
    this.queuePanel.setVisible(false)
    this.taskQueue.add(this.queuePanel)

    const width = this.cameras.main.width - 400

    // Panel background
    const bg = this.add.graphics()
    this.drawGlossyPanel(bg, 0, 0, width, panelHeight, 0x3498DB, 16)
    bg.fillStyle(0xFFFFFF, 0.98)
    bg.fillRoundedRect(8, 50, width - 16, panelHeight - 60, 12)
    this.queuePanel.add(bg)

    // Title
    const title = this.add.text(width/2, 26, 'TASK QUEUE', {
      font: 'bold 16px Fredoka',
      fill: '#FFFFFF',
      stroke: '#1A5276',
      strokeThickness: 2
    }).setOrigin(0.5)
    this.queuePanel.add(title)

    // Add task button
    const addBtn = this.add.graphics()
    this.drawButton(addBtn, width - 100, 8, 80, 32, 0x2ECC71, true)
    const addText = this.add.text(width - 60, 24, '+ ADD', {
      font: 'bold 12px Fredoka',
      fill: '#FFFFFF'
    }).setOrigin(0.5)
    const addZone = this.add.zone(width - 60, 24, 80, 32).setInteractive({ useHandCursor: true })
    addZone.on('pointerup', () => this.showAddTaskDialog())
    this.queuePanel.add([addBtn, addText, addZone])

    // Close button
    const closeBtn = this.add.graphics()
    closeBtn.fillStyle(0xFF6B6B, 0.9)
    closeBtn.fillCircle(width - 18, 48, 12)
    const closeX = this.add.text(width - 18, 48, '×', {
      font: 'bold 16px Fredoka',
      fill: '#FFFFFF'
    }).setOrigin(0.5)
    const closeZone = this.add.zone(width - 18, 48, 24, 24).setInteractive({ useHandCursor: true })
    closeZone.on('pointerup', () => this.toggleTaskQueue())
    this.queuePanel.add([closeBtn, closeX, closeZone])

    // Tasks container
    this.queueTasksContainer = this.add.container(15, 60)
    this.queuePanel.add(this.queueTasksContainer)
    this.queueTasks = []

    // Load initial data
    this.loadTaskQueue()
  }

  toggleTaskQueue() {
    const isVisible = this.queuePanel.visible
    const panelHeight = this._queuePanelHeight || 200
    if (isVisible) {
      // Close: slide panel down and toggle button back to bottom
      this.tweens.add({
        targets: this.queuePanel,
        y: 0,
        alpha: 0,
        duration: 200,
        ease: 'Back.easeIn',
        onComplete: () => this.queuePanel.setVisible(false)
      })
      this.tweens.add({
        targets: this.queueToggleBtn,
        y: 0,
        duration: 200,
        ease: 'Back.easeIn'
      })
    } else {
      // Open: slide panel up and toggle button rides up like a folder tab
      this.queuePanel.setVisible(true)
      this.queuePanel.setY(0)
      this.queuePanel.setAlpha(0)
      this.tweens.add({
        targets: this.queuePanel,
        y: -panelHeight,
        alpha: 1,
        duration: 300,
        ease: 'Back.easeOut'
      })
      this.tweens.add({
        targets: this.queueToggleBtn,
        y: -panelHeight,
        duration: 300,
        ease: 'Back.easeOut'
      })
      this.loadTaskQueue()
    }
  }

  async loadTaskQueue() {
    try {
      const result = await this.api.getTaskQueue()
      this.renderTaskQueue(result.tasks)
      this.queueToggleText.setText(`📥 QUEUE (${result.total})`)
    } catch (e) {
      console.error('Failed to load task queue:', e)
    }
  }

  renderTaskQueue(tasks) {
    this.queueTasksContainer.removeAll(true)
    this.queueTasks = []

    const cardWidth = 180
    const cardHeight = 120

    tasks.slice(0, 6).forEach((task, i) => {
      const x = (i % 4) * (cardWidth + 10)
      const y = Math.floor(i / 4) * (cardHeight + 10)
      const card = this.createTaskCard(task, x, y, cardWidth, cardHeight)
      this.queueTasksContainer.add(card)
      this.queueTasks.push(card)
    })

    if (tasks.length === 0) {
      const empty = this.add.text(200, 50, 'No tasks in queue\nAdd tasks or assign from here', {
        font: '14px Fredoka',
        fill: '#999999',
        align: 'center'
      }).setOrigin(0.5)
      this.queueTasksContainer.add(empty)
    }
  }

  createTaskCard(task, x, y, width, height) {
    const container = this.add.container(x, y)

    // Priority color
    const priorityColors = [0x95A5A6, 0x3498DB, 0xF39C12, 0xE74C3C]
    const color = priorityColors[Math.min(task.priority, 3)]

    // Card background
    const bg = this.add.graphics()
    bg.fillStyle(0xFFFFFF, 1)
    bg.fillRoundedRect(0, 0, width, height, 10)
    bg.lineStyle(2, color, 1)
    bg.strokeRoundedRect(0, 0, width, height, 10)
    bg.fillStyle(color, 1)
    bg.fillRoundedRect(0, 0, width, 6, { tl: 10, tr: 10, bl: 0, br: 0 })

    // Title
    const title = this.add.text(10, 15, task.title.substring(0, 25) + (task.title.length > 25 ? '...' : ''), {
      font: 'bold 12px Fredoka',
      fill: '#333333'
    })

    // Project badge
    const projectBadge = this.add.graphics()
    projectBadge.fillStyle(0xE8F4FC, 1)
    projectBadge.fillRoundedRect(10, 38, width - 20, 20, 5)
    const projectText = this.add.text(width/2, 48, task.project, {
      font: '10px Fredoka',
      fill: '#0077B6'
    }).setOrigin(0.5)

    // Assign button
    const assignBtn = this.add.graphics()
    this.drawButton(assignBtn, 10, height - 40, width - 20, 30, 0x2ECC71, true)
    const assignText = this.add.text(width/2, height - 25, 'ASSIGN', {
      font: 'bold 11px Fredoka',
      fill: '#FFFFFF'
    }).setOrigin(0.5)
    const assignZone = this.add.zone(width/2, height - 25, width - 20, 30).setInteractive({ useHandCursor: true })
    assignZone.on('pointerup', () => this.showAssignTaskDialog(task))

    // Drag handle (visual only for now)
    const handle = this.add.text(width - 15, 15, '⋮', {
      font: '16px Fredoka',
      fill: '#CCCCCC'
    }).setOrigin(0.5)

    container.add([bg, title, projectBadge, projectText, assignBtn, assignText, assignZone, handle])
    container.task = task

    return container
  }

  async showAddTaskDialog() {
    const title = await this.showModal({
      title: 'ADD TASK',
      message: 'Enter task description',
      inputType: 'text',
      placeholder: 'Fix the login bug...'
    })
    if (!title) return

    const project = await this.showModal({
      title: 'PROJECT',
      message: 'Which project? (Leave blank for default)',
      inputType: 'text',
      placeholder: 'project-name'
    })

    try {
      await this.api.addTask({
        title,
        project: project || 'default',
        priority: 0
      })
      this.loadTaskQueue()
      this.showNotification('success', 'Task Added', `"${title}" added to queue`)
    } catch (e) {
      this.showNotification('error', 'Failed', e.message)
    }
  }

  async showAssignTaskDialog(task) {
    // Get available polecats
    try {
      const status = await this.api.getStatus()
      const idlePolecats = status.polecats.filter(p => p.status === 'idle')

      if (idlePolecats.length === 0) {
        await this.showModal({
          title: 'NO IDLE AGENTS',
          message: 'No idle polecats available. Spawn a new one or wait for one to finish.',
          showCancel: false
        })
        return
      }

      // Show picker
      const choice = await this.showAgentPickerForTask(idlePolecats, task)
      if (!choice) return

      await this.api.assignTask(task.id, choice.agent, choice.rig)
      this.loadTaskQueue()
      this.showNotification('success', 'Task Assigned', `"${task.title}" assigned to ${choice.agent}`)
    } catch (e) {
      this.showNotification('error', 'Failed', e.message)
    }
  }

  showAgentPickerForTask(polecats, task) {
    return new Promise((resolve) => {
      const width = this.cameras.main.width
      const height = this.cameras.main.height
      const modalWidth = 320
      const modalHeight = 150 + Math.min(polecats.length, 5) * 45

      const picker = this.add.container(width/2, height/2)
      picker.setDepth(1500)

      const backdrop = this.add.graphics()
      backdrop.fillStyle(0x000000, 0.6)
      backdrop.fillRect(-width/2, -height/2, width, height)
      backdrop.setInteractive(new Phaser.Geom.Rectangle(-width/2, -height/2, width, height), Phaser.Geom.Rectangle.Contains)
      backdrop.on('pointerup', () => {
        picker.destroy()
        resolve(null)
      })

      const panel = this.add.graphics()
      this.drawGlossyPanel(panel, -modalWidth/2, -modalHeight/2, modalWidth, modalHeight, 0x2ECC71, 18)
      panel.fillStyle(0xFFFFFF, 0.98)
      panel.fillRoundedRect(-modalWidth/2 + 10, -modalHeight/2 + 55, modalWidth - 20, modalHeight - 70, 10)

      const title = this.add.text(0, -modalHeight/2 + 28, 'ASSIGN TO AGENT', {
        font: 'bold 18px Fredoka',
        fill: '#FFFFFF'
      }).setOrigin(0.5)

      picker.add([backdrop, panel, title])

      let yPos = -modalHeight/2 + 70
      polecats.slice(0, 5).forEach((p) => {
        const btn = this.add.graphics()
        this.drawButton(btn, -modalWidth/2 + 20, yPos, modalWidth - 40, 38, 0x3498DB, true)
        const btnText = this.add.text(0, yPos + 19, `${p.name} (${p.rig})`, {
          font: 'bold 12px Fredoka',
          fill: '#FFFFFF'
        }).setOrigin(0.5)
        const btnZone = this.add.zone(0, yPos + 19, modalWidth - 40, 38).setInteractive({ useHandCursor: true })
        btnZone.on('pointerup', () => {
          picker.destroy()
          resolve({ agent: p.name, rig: p.rig })
        })
        picker.add([btn, btnText, btnZone])
        yPos += 45
      })

      picker.setScale(0.8)
      picker.setAlpha(0)
      this.tweens.add({
        targets: picker,
        scale: 1,
        alpha: 1,
        duration: 200,
        ease: 'Back.easeOut'
      })
    })
  }

  // ===== COST DASHBOARD PANEL =====

  createCostDashboardPanel() {
    const width = 300
    const height = 400
    const screenWidth = this.cameras.main.width
    const x = screenWidth - 50
    const y = 65

    this.costDashboard = this.add.container(x, y)
    this.costDashboard.setDepth(100)

    // Toggle button (positioned near settings)
    this.costToggleBtn = this.add.container(0, 0)
    const toggleBg = this.add.graphics()
    toggleBg.fillStyle(0x27AE60, 0.9)
    toggleBg.fillRoundedRect(0, 0, 40, 40, 10)
    toggleBg.fillStyle(0xFFFFFF, 0.15)
    toggleBg.fillRoundedRect(2, 2, 36, 18, { tl: 8, tr: 8, bl: 0, br: 0 })
    const toggleIcon = this.add.text(20, 20, '💰', { font: '18px Fredoka' }).setOrigin(0.5)
    const toggleZone = this.add.zone(20, 20, 40, 40).setInteractive({ useHandCursor: true })
    toggleZone.on('pointerup', () => this.toggleCostDashboard())
    this.costToggleBtn.add([toggleBg, toggleIcon, toggleZone])
    this.costDashboard.add(this.costToggleBtn)

    // Dashboard panel (hidden initially) — expands left from toggle button
    this.costPanel = this.add.container(-width + 40, 50)
    this.costPanel.setVisible(false)
    this.costDashboard.add(this.costPanel)

    // Panel background
    const bg = this.add.graphics()
    this.drawGlossyPanel(bg, 0, 0, width, height, 0x27AE60, 16)
    bg.fillStyle(0xFFFFFF, 0.98)
    bg.fillRoundedRect(8, 50, width - 16, height - 60, 12)
    this.costPanel.add(bg)

    // Title
    const title = this.add.text(width/2, 26, 'COST DASHBOARD', {
      font: 'bold 16px Fredoka',
      fill: '#FFFFFF',
      stroke: '#1E8449',
      strokeThickness: 2
    }).setOrigin(0.5)
    this.costPanel.add(title)

    // Close button
    const closeBtn = this.add.graphics()
    closeBtn.fillStyle(0xFF6B6B, 0.9)
    closeBtn.fillCircle(width - 18, 18, 12)
    const closeX = this.add.text(width - 18, 18, '×', {
      font: 'bold 16px Fredoka',
      fill: '#FFFFFF'
    }).setOrigin(0.5)
    const closeZone = this.add.zone(width - 18, 18, 24, 24).setInteractive({ useHandCursor: true })
    closeZone.on('pointerup', () => this.toggleCostDashboard())
    this.costPanel.add([closeBtn, closeX, closeZone])

    // Stats container
    this.costStatsContainer = this.add.container(15, 60)
    this.costPanel.add(this.costStatsContainer)

    // Export button
    const exportBtn = this.add.graphics()
    this.drawButton(exportBtn, 10, height - 50, width - 20, 36, 0x3498DB, true)
    const exportText = this.add.text(width/2, height - 32, '📥 EXPORT CSV', {
      font: 'bold 12px Fredoka',
      fill: '#FFFFFF'
    }).setOrigin(0.5)
    const exportZone = this.add.zone(width/2, height - 32, width - 20, 36).setInteractive({ useHandCursor: true })
    exportZone.on('pointerup', () => this.exportCostCSV())
    this.costPanel.add([exportBtn, exportText, exportZone])

    // Load initial data
    this.loadCostDashboard()
  }

  toggleCostDashboard() {
    const panelOpenX = -260  // -width + 40, panel expands left
    const isVisible = this.costPanel.visible
    if (isVisible) {
      this.tweens.add({
        targets: this.costPanel,
        x: 50,
        alpha: 0,
        duration: 200,
        ease: 'Back.easeIn',
        onComplete: () => this.costPanel.setVisible(false)
      })
    } else {
      this.costPanel.setVisible(true)
      this.costPanel.setX(50)
      this.costPanel.setAlpha(0)
      this.tweens.add({
        targets: this.costPanel,
        x: panelOpenX,
        alpha: 1,
        duration: 300,
        ease: 'Back.easeOut'
      })
      this.loadCostDashboard()
    }
  }

  async loadCostDashboard() {
    try {
      const data = await this.api.getCostDashboard()
      this.renderCostDashboard(data)
    } catch (e) {
      console.error('Failed to load cost dashboard:', e)
    }
  }

  renderCostDashboard(data) {
    this.costStatsContainer.removeAll(true)

    const width = 270
    let yPos = 0

    // Today stat
    const todayCard = this.createStatCard('TODAY', data.today.tokens, data.today.cost, 0, yPos, width/3 - 5)
    const weekCard = this.createStatCard('WEEK', data.week.tokens, data.week.cost, width/3, yPos, width/3 - 5)
    const monthCard = this.createStatCard('MONTH', data.month.tokens, data.month.cost, width*2/3, yPos, width/3 - 5)
    this.costStatsContainer.add([todayCard, weekCard, monthCard])
    yPos += 75

    // Sparkline
    const sparkline = this.createSparkline(data.sparkline, 0, yPos, width, 50)
    this.costStatsContainer.add(sparkline)
    yPos += 65

    // By project
    const projectTitle = this.add.text(0, yPos, 'BY PROJECT', {
      font: 'bold 11px Fredoka',
      fill: '#666666'
    })
    this.costStatsContainer.add(projectTitle)
    yPos += 20

    data.byProject.slice(0, 3).forEach(p => {
      const row = this.createCostRow(p.name, p.tokens, p.cost, 0, yPos, width)
      this.costStatsContainer.add(row)
      yPos += 28
    })

    yPos += 10

    // By agent
    const agentTitle = this.add.text(0, yPos, 'BY AGENT', {
      font: 'bold 11px Fredoka',
      fill: '#666666'
    })
    this.costStatsContainer.add(agentTitle)
    yPos += 20

    data.byAgent.slice(0, 3).forEach(a => {
      const row = this.createCostRow(a.name, a.tokens, a.cost, 0, yPos, width)
      this.costStatsContainer.add(row)
      yPos += 28
    })

    // Budget alert
    if (data.budgetAlert) {
      yPos += 10
      const alert = this.add.text(width/2, yPos, '⚠ Approaching budget limit!', {
        font: 'bold 12px Fredoka',
        fill: '#E74C3C'
      }).setOrigin(0.5)
      this.costStatsContainer.add(alert)
    }
  }

  createStatCard(label, tokens, cost, x, y, width) {
    const container = this.add.container(x, y)

    const bg = this.add.graphics()
    bg.fillStyle(0xF8F8F8, 1)
    bg.fillRoundedRect(0, 0, width, 65, 8)

    const labelText = this.add.text(width/2, 10, label, {
      font: 'bold 10px Fredoka',
      fill: '#999999'
    }).setOrigin(0.5)

    const tokenText = this.add.text(width/2, 30, this.formatNumber(tokens), {
      font: 'bold 16px Fredoka',
      fill: '#333333'
    }).setOrigin(0.5)

    const costText = this.add.text(width/2, 50, `$${cost.toFixed(2)}`, {
      font: '11px Fredoka',
      fill: '#27AE60'
    }).setOrigin(0.5)

    container.add([bg, labelText, tokenText, costText])
    return container
  }

  createSparkline(data, x, y, width, height) {
    const container = this.add.container(x, y)

    const bg = this.add.graphics()
    bg.fillStyle(0xF8F8F8, 1)
    bg.fillRoundedRect(0, 0, width, height, 8)

    // Find max value for scaling
    const maxVal = Math.max(...data.map(d => d.tokens), 1)
    const stepX = width / (data.length - 1 || 1)

    // Draw line
    const line = this.add.graphics()
    line.lineStyle(2, 0x27AE60, 1)
    line.beginPath()

    data.forEach((d, i) => {
      const px = 5 + i * (width - 10) / (data.length - 1 || 1)
      const py = height - 5 - (d.tokens / maxVal) * (height - 15)
      if (i === 0) {
        line.moveTo(px, py)
      } else {
        line.lineTo(px, py)
      }
    })
    line.strokePath()

    // Draw dots
    data.forEach((d, i) => {
      const px = 5 + i * (width - 10) / (data.length - 1 || 1)
      const py = height - 5 - (d.tokens / maxVal) * (height - 15)
      line.fillStyle(0x27AE60, 1)
      line.fillCircle(px, py, 3)
    })

    container.add([bg, line])
    return container
  }

  createCostRow(name, tokens, cost, x, y, width) {
    const container = this.add.container(x, y)

    const nameText = this.add.text(0, 0, name.substring(0, 15) + (name.length > 15 ? '...' : ''), {
      font: '11px Fredoka',
      fill: '#333333'
    })

    const tokenText = this.add.text(width - 60, 0, this.formatNumber(tokens), {
      font: '11px Fredoka',
      fill: '#666666'
    }).setOrigin(1, 0)

    const costText = this.add.text(width, 0, `$${cost.toFixed(2)}`, {
      font: '11px Fredoka',
      fill: '#27AE60'
    }).setOrigin(1, 0)

    container.add([nameText, tokenText, costText])
    return container
  }

  formatNumber(num) {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`
    return num.toString()
  }

  exportCostCSV() {
    const url = this.api.getCostExportUrl()
    window.open(url, '_blank')
  }

  // ===== AGENT OUTPUT VIEWER =====

  createAgentOutputViewer() {
    // This modal is created on-demand when viewing output
    this.outputViewer = null
  }

  async showAgentOutput(agentId, rigName) {
    const width = this.cameras.main.width
    const height = this.cameras.main.height
    const modalWidth = Math.min(900, width - 60)
    const modalHeight = Math.min(600, height - 60)

    // Destroy existing viewer if open
    if (this.outputViewer) {
      if (this._logPollInterval) {
        clearInterval(this._logPollInterval)
        this._logPollInterval = null
      }
      this.outputViewer.destroy()
    }

    this.outputViewer = this.add.container(width/2, height/2)
    this.outputViewer.setDepth(1500)
    this._outputViewerAgentId = agentId

    // Backdrop
    const backdrop = this.add.graphics()
    backdrop.fillStyle(0x000000, 0.7)
    backdrop.fillRect(-width/2, -height/2, width, height)
    backdrop.setInteractive(new Phaser.Geom.Rectangle(-width/2, -height/2, width, height), Phaser.Geom.Rectangle.Contains)

    // Panel
    const panel = this.add.graphics()
    this.drawGlossyPanel(panel, -modalWidth/2, -modalHeight/2, modalWidth, modalHeight, 0x2C3E50, 20)
    panel.fillStyle(0x1E272E, 1)
    panel.fillRoundedRect(-modalWidth/2 + 10, -modalHeight/2 + 60, modalWidth - 20, modalHeight - 80, 12)

    // Title — truncate agent path if too long for modal
    const maxTitleLen = Math.floor((modalWidth - 200) / 10)
    const displayId = agentId.length > maxTitleLen ? '...' + agentId.slice(-maxTitleLen) : agentId
    const title = this.add.text(-modalWidth/2 + 20, -modalHeight/2 + 30, `AGENT OUTPUT: ${displayId}`, {
      font: 'bold 16px Fredoka',
      fill: '#FFFFFF',
      stroke: '#1A252F',
      strokeThickness: 2
    }).setOrigin(0, 0.5)

    // Session status indicator (far right of title bar)
    const sessionDot = this.add.graphics()
    const sessionLabel = this.add.text(modalWidth/2 - 60, -modalHeight/2 + 30, 'loading...', {
      font: '11px Fredoka',
      fill: '#7F8C8D'
    }).setOrigin(1, 0.5)

    // Close button
    const closeBtn = this.add.graphics()
    closeBtn.fillStyle(0xFF6B6B, 0.9)
    closeBtn.fillCircle(modalWidth/2 - 25, -modalHeight/2 + 25, 14)
    const closeX = this.add.text(modalWidth/2 - 25, -modalHeight/2 + 25, '\u00d7', {
      font: 'bold 18px Fredoka',
      fill: '#FFFFFF'
    }).setOrigin(0.5)
    const closeZone = this.add.zone(modalWidth/2 - 25, -modalHeight/2 + 25, 28, 28).setInteractive({ useHandCursor: true })
    closeZone.on('pointerup', () => {
      if (this._logPollInterval) {
        clearInterval(this._logPollInterval)
        this._logPollInterval = null
      }
      this.outputViewer.destroy()
      this.outputViewer = null
    })

    this.outputViewer.add([backdrop, panel, title, sessionDot, sessionLabel, closeBtn, closeX, closeZone])

    // Loading text
    const loading = this.add.text(0, 0, 'Loading logs...', {
      font: '14px Fredoka',
      fill: '#7F8C8D'
    }).setOrigin(0.5)
    this.outputViewer.add(loading)

    // Fetch agent logs + status
    try {
      const [logData, hookData] = await Promise.all([
        this.api.getAgentLogs(agentId),
        this.api.getHook(agentId)
      ])
      loading.destroy()

      // Update session indicator
      this._updateSessionIndicator(sessionDot, sessionLabel, logData.sessionActive)

      // Status header line
      const statusHeader = this.formatStatusHeader(hookData)
      const headerText = this.add.text(-modalWidth/2 + 25, -modalHeight/2 + 68, statusHeader, {
        font: '11px monospace',
        fill: '#F39C12',
        wordWrap: { width: modalWidth - 50 }
      })
      this.outputViewer.add(headerText)

      // Log text area — starts below the status header with enough space
      const headerHeight = headerText.height || 14
      const logAreaY = -modalHeight/2 + 72 + headerHeight + 8
      const logAreaHeight = modalHeight - (72 + headerHeight + 8) - 70
      const logContent = logData.logs || '(No session output available)'

      // Truncate to fit display (Phaser text has limits)
      const maxLines = Math.floor(logAreaHeight / 14)
      const logLines = logContent.split('\n')
      const displayedLines = logLines.slice(-maxLines).join('\n')

      const logText = this.add.text(-modalWidth/2 + 25, logAreaY, displayedLines, {
        font: '11px monospace',
        fill: '#2ECC71',
        wordWrap: { width: modalWidth - 50 }
      })
      this.outputViewer.add(logText)

      // Store reference for polling updates
      this._logText = logText
      this._logHeaderText = headerText
      this._logSessionDot = sessionDot
      this._logSessionLabel = sessionLabel
      this._logMaxLines = maxLines

      // Action buttons at bottom
      const btnY = modalHeight/2 - 45

      // Copy button
      const copyBtn = this.add.graphics()
      this.drawButton(copyBtn, -modalWidth/2 + 20, btnY, 120, 36, 0x3498DB, true)
      const copyText = this.add.text(-modalWidth/2 + 80, btnY + 18, 'COPY', {
        font: 'bold 12px Fredoka',
        fill: '#FFFFFF'
      }).setOrigin(0.5)
      const copyZone = this.add.zone(-modalWidth/2 + 80, btnY + 18, 120, 36).setInteractive({ useHandCursor: true })
      copyZone.on('pointerup', () => {
        navigator.clipboard.writeText(logContent)
        this.showNotification('success', 'Copied', 'Logs copied to clipboard')
      })
      this.outputViewer.add([copyBtn, copyText, copyZone])

      // Refresh button
      const refreshBtn = this.add.graphics()
      this.drawButton(refreshBtn, -modalWidth/2 + 150, btnY, 120, 36, 0x27AE60, true)
      const refreshText = this.add.text(-modalWidth/2 + 210, btnY + 18, 'REFRESH', {
        font: 'bold 12px Fredoka',
        fill: '#FFFFFF'
      }).setOrigin(0.5)
      const refreshZone = this.add.zone(-modalWidth/2 + 210, btnY + 18, 120, 36).setInteractive({ useHandCursor: true })
      refreshZone.on('pointerup', () => {
        this._refreshLogs(agentId)
      })
      this.outputViewer.add([refreshBtn, refreshText, refreshZone])

      // Start auto-refresh polling (every 3 seconds)
      this._logPollInterval = setInterval(() => {
        if (this.outputViewer && this._outputViewerAgentId === agentId) {
          this._refreshLogs(agentId)
        } else {
          clearInterval(this._logPollInterval)
          this._logPollInterval = null
        }
      }, 3000)

    } catch (e) {
      loading.setText(`Failed to load: ${e.message}`)
      loading.setStyle({ fill: '#E74C3C' })
    }

    // Animate in
    this.outputViewer.setScale(0.8)
    this.outputViewer.setAlpha(0)
    this.tweens.add({
      targets: this.outputViewer,
      scale: 1,
      alpha: 1,
      duration: 200,
      ease: 'Back.easeOut'
    })
  }

  async _refreshLogs(agentId) {
    try {
      const [logData, hookData] = await Promise.all([
        this.api.getAgentLogs(agentId),
        this.api.getHook(agentId)
      ])

      if (this._logText && this._logText.active) {
        const logLines = (logData.logs || '').split('\n')
        const displayedLines = logLines.slice(-this._logMaxLines).join('\n')
        this._logText.setText(displayedLines)
      }

      if (this._logHeaderText && this._logHeaderText.active) {
        this._logHeaderText.setText(this.formatStatusHeader(hookData))
      }

      if (this._logSessionDot && this._logSessionLabel) {
        this._updateSessionIndicator(this._logSessionDot, this._logSessionLabel, logData.sessionActive)
      }
    } catch (e) {
      // Silent fail on refresh — don't disrupt the UI
    }
  }

  _updateSessionIndicator(dot, label, isActive) {
    dot.clear()
    // Position dot just to the left of the label
    const dotX = label.x - label.width - 12
    const dotY = label.y
    if (isActive) {
      dot.fillStyle(0x2ECC71, 1)
      dot.fillCircle(dotX, dotY, 5)
      label.setText('SESSION LIVE')
      label.setStyle({ fill: '#2ECC71' })
    } else {
      dot.fillStyle(0xE74C3C, 1)
      dot.fillCircle(dotX, dotY, 5)
      label.setText('NO SESSION')
      label.setStyle({ fill: '#E74C3C' })
    }
  }

  formatStatusHeader(hookData) {
    const parts = []
    parts.push(`Status: ${hookData.status || 'unknown'}`)
    if (hookData.hook) parts.push(`Task: ${hookData.hook}`)
    if (hookData.tokensUsed) parts.push(`Tokens: ${hookData.tokensUsed.toLocaleString()}`)
    if (hookData.assignedAt) parts.push(`Since: ${new Date(hookData.assignedAt).toLocaleString()}`)
    if (hookData.stuckReason) parts.push(`STUCK: ${hookData.stuckReason}`)
    return parts.join('  |  ')
  }

  // ===== GITHUB INTEGRATION PANEL =====

  createGitHubPanel() {
    const width = 320
    const height = 450
    const screenWidth = this.cameras.main.width
    const x = screenWidth - 100
    const y = 65

    this.githubPanel = this.add.container(x, y)
    this.githubPanel.setDepth(100)

    // Toggle button
    this.githubToggleBtn = this.add.container(0, 0)
    const toggleBg = this.add.graphics()
    toggleBg.fillStyle(0x24292E, 0.9)
    toggleBg.fillRoundedRect(0, 0, 40, 40, 10)
    toggleBg.fillStyle(0xFFFFFF, 0.15)
    toggleBg.fillRoundedRect(2, 2, 36, 18, { tl: 8, tr: 8, bl: 0, br: 0 })
    const toggleIcon = this.add.text(20, 20, '🐙', { font: '18px Fredoka' }).setOrigin(0.5)
    const toggleZone = this.add.zone(20, 20, 40, 40).setInteractive({ useHandCursor: true })
    toggleZone.on('pointerup', () => this.toggleGitHubPanel())
    this.githubToggleBtn.add([toggleBg, toggleIcon, toggleZone])
    this.githubPanel.add(this.githubToggleBtn)

    // Panel (hidden initially) — expands to the left of toggle button
    this.githubPanelContent = this.add.container(-width + 40, 0)
    this.githubPanelContent.setVisible(false)
    this.githubPanel.add(this.githubPanelContent)

    // Panel background
    const bg = this.add.graphics()
    this.drawGlossyPanel(bg, 0, 0, width, height, 0x24292E, 16)
    bg.fillStyle(0xFFFFFF, 0.98)
    bg.fillRoundedRect(8, 50, width - 16, height - 60, 12)
    this.githubPanelContent.add(bg)

    // Title
    const title = this.add.text(width/2, 26, 'PULL REQUESTS', {
      font: 'bold 16px Fredoka',
      fill: '#FFFFFF',
      stroke: '#1A1F24',
      strokeThickness: 2
    }).setOrigin(0.5)
    this.githubPanelContent.add(title)

    // Filter tabs
    this.prFilters = this.add.container(15, 55)
    const filters = [
      { label: 'All', status: null },
      { label: 'Open', status: 'open' },
      { label: 'Merged', status: 'merged' },
      { label: 'Draft', status: 'draft' }
    ]
    this.currentPRFilter = null

    filters.forEach((f, i) => {
      const btnX = i * 72
      const btn = this.add.graphics()
      const isActive = this.currentPRFilter === f.status
      btn.fillStyle(isActive ? 0x24292E : 0xE8F4FC, 1)
      btn.fillRoundedRect(btnX, 0, 68, 24, 6)
      const text = this.add.text(btnX + 34, 12, f.label, {
        font: 'bold 10px Fredoka',
        fill: isActive ? '#FFFFFF' : '#24292E'
      }).setOrigin(0.5)
      const zone = this.add.zone(btnX + 34, 12, 68, 24).setInteractive({ useHandCursor: true })
      zone.on('pointerup', () => {
        this.currentPRFilter = f.status
        this.loadGitHubPRs()
        this.updatePRFilters()
      })
      this.prFilters.add([btn, text, zone])
      f.btn = btn
      f.text = text
    })
    this.prFilterDefs = filters
    this.githubPanelContent.add(this.prFilters)

    // Close button
    const closeBtn = this.add.graphics()
    closeBtn.fillStyle(0xFF6B6B, 0.9)
    closeBtn.fillCircle(width - 18, 18, 12)
    const closeX = this.add.text(width - 18, 18, '×', {
      font: 'bold 16px Fredoka',
      fill: '#FFFFFF'
    }).setOrigin(0.5)
    const closeZone = this.add.zone(width - 18, 18, 24, 24).setInteractive({ useHandCursor: true })
    closeZone.on('pointerup', () => this.toggleGitHubPanel())
    this.githubPanelContent.add([closeBtn, closeX, closeZone])

    // Track PR button
    const trackBtn = this.add.graphics()
    this.drawButton(trackBtn, 10, height - 50, width - 20, 36, 0x2ECC71, true)
    const trackText = this.add.text(width/2, height - 32, '+ TRACK PR', {
      font: 'bold 12px Fredoka',
      fill: '#FFFFFF'
    }).setOrigin(0.5)
    const trackZone = this.add.zone(width/2, height - 32, width - 20, 36).setInteractive({ useHandCursor: true })
    trackZone.on('pointerup', () => this.showTrackPRDialog())
    this.githubPanelContent.add([trackBtn, trackText, trackZone])

    // PRs container
    this.prListContainer = this.add.container(15, 85)
    this.githubPanelContent.add(this.prListContainer)
    this.prList = []

    // Scrolling mask
    const maskShape = this.add.graphics()
    maskShape.fillStyle(0xFFFFFF)
    maskShape.fillRect(x + 58, y + 85, width - 16, height - 150)
    const mask = maskShape.createGeometryMask()
    maskShape.setVisible(false) // Hide the mask shape itself
    this.prListContainer.setMask(mask)

    // Load initial data
    this.loadGitHubPRs()
  }

  toggleGitHubPanel() {
    const panelOpenX = -280  // -width + 40, panel expands left
    const isVisible = this.githubPanelContent.visible
    if (isVisible) {
      this.tweens.add({
        targets: this.githubPanelContent,
        x: 50,
        alpha: 0,
        duration: 200,
        ease: 'Back.easeIn',
        onComplete: () => this.githubPanelContent.setVisible(false)
      })
    } else {
      this.githubPanelContent.setVisible(true)
      this.githubPanelContent.setX(50)
      this.githubPanelContent.setAlpha(0)
      this.tweens.add({
        targets: this.githubPanelContent,
        x: panelOpenX,
        alpha: 1,
        duration: 300,
        ease: 'Back.easeOut'
      })
      this.loadGitHubPRs()
    }
  }

  updatePRFilters() {
    this.prFilterDefs.forEach((f, i) => {
      const isActive = this.currentPRFilter === f.status
      const btnX = i * 72
      f.btn.clear()
      f.btn.fillStyle(isActive ? 0x24292E : 0xE8F4FC, 1)
      f.btn.fillRoundedRect(btnX, 0, 68, 24, 6)
      f.text.setStyle({ fill: isActive ? '#FFFFFF' : '#24292E' })
    })
  }

  async loadGitHubPRs() {
    try {
      const result = await this.api.getGitHubPRs({
        status: this.currentPRFilter
      })
      this.renderGitHubPRs(result.prs)
    } catch (e) {
      console.error('Failed to load GitHub PRs:', e)
    }
  }

  renderGitHubPRs(prs) {
    this.prListContainer.removeAll(true)
    this.prList = []

    let yPos = 0
    prs.slice(0, 6).forEach((pr) => {
      const card = this.createPRCard(pr, yPos)
      this.prListContainer.add(card)
      this.prList.push(card)
      yPos += 75
    })

    if (prs.length === 0) {
      const empty = this.add.text(140, 80, 'No pull requests tracked\nClick "+ Track PR" to add one', {
        font: '13px Fredoka',
        fill: '#999999',
        align: 'center'
      }).setOrigin(0.5)
      this.prListContainer.add(empty)
    }
  }

  createPRCard(pr, y) {
    const container = this.add.container(0, y)
    const width = 290

    // Status colors
    const statusColors = {
      open: 0x2ECC71,
      merged: 0x9B59B6,
      closed: 0xE74C3C,
      draft: 0x95A5A6
    }
    const color = statusColors[pr.status] || statusColors.open

    // Card background
    const bg = this.add.graphics()
    bg.fillStyle(0xF8F8F8, 1)
    bg.fillRoundedRect(0, 0, width, 68, 10)
    bg.fillStyle(color, 1)
    bg.fillRoundedRect(0, 0, 5, 68, { tl: 10, tr: 0, bl: 10, br: 0 })

    // PR number
    const number = this.add.text(15, 8, `#${pr.number || '?'}`, {
      font: 'bold 11px Fredoka',
      fill: '#666666'
    })

    // Status badge
    const badge = this.add.graphics()
    badge.fillStyle(color, 0.2)
    badge.fillRoundedRect(width - 65, 5, 55, 18, 5)
    const badgeText = this.add.text(width - 37, 14, pr.isDraft ? 'DRAFT' : pr.status.toUpperCase(), {
      font: 'bold 8px Fredoka',
      fill: Phaser.Display.Color.ValueToColor(color).rgba.replace(/,1\)$/, ',1)')
    }).setOrigin(0.5)
    badgeText.setStyle({ fill: `#${color.toString(16).padStart(6, '0')}` })

    // Title
    const title = this.add.text(15, 24, pr.title.substring(0, 35) + (pr.title.length > 35 ? '...' : ''), {
      font: 'bold 11px Fredoka',
      fill: '#333333'
    })

    // Stats row
    const statsText = this.add.text(15, 45, `📝 ${pr.commits || 0} commits | 📄 ${pr.changedFiles || 0} files`, {
      font: '9px Fredoka',
      fill: '#999999'
    })

    // CI status indicator
    const ciColors = { pending: 0xF39C12, success: 0x2ECC71, failure: 0xE74C3C }
    const ciColor = ciColors[pr.ciStatus] || ciColors.pending
    const ciDot = this.add.graphics()
    ciDot.fillStyle(ciColor, 1)
    ciDot.fillCircle(width - 20, 50, 5)

    // Agent info
    if (pr.agent) {
      const agentText = this.add.text(width - 30, 45, `by ${pr.agent}`, {
        font: '9px Fredoka',
        fill: '#0077B6'
      }).setOrigin(1, 0)
      container.add(agentText)
    }

    // Click to open PR
    const zone = this.add.zone(width/2, 34, width, 68).setInteractive({ useHandCursor: true })
    zone.on('pointerup', () => {
      window.open(pr.url, '_blank')
    })
    zone.on('pointerover', () => {
      bg.clear()
      bg.fillStyle(0xE8F4FC, 1)
      bg.fillRoundedRect(0, 0, width, 68, 10)
      bg.fillStyle(color, 1)
      bg.fillRoundedRect(0, 0, 5, 68, { tl: 10, tr: 0, bl: 10, br: 0 })
    })
    zone.on('pointerout', () => {
      bg.clear()
      bg.fillStyle(0xF8F8F8, 1)
      bg.fillRoundedRect(0, 0, width, 68, 10)
      bg.fillStyle(color, 1)
      bg.fillRoundedRect(0, 0, 5, 68, { tl: 10, tr: 0, bl: 10, br: 0 })
    })

    container.add([bg, number, badge, badgeText, title, statsText, ciDot, zone])
    container.pr = pr

    return container
  }

  async showTrackPRDialog() {
    const url = await this.showModal({
      title: 'TRACK PR',
      message: 'Enter the GitHub PR URL',
      inputType: 'text',
      placeholder: 'https://github.com/user/repo/pull/123'
    })
    if (!url) return

    const title = await this.showModal({
      title: 'PR TITLE',
      message: 'Enter a title for this PR',
      inputType: 'text',
      placeholder: 'Fix the login bug'
    })
    if (!title) return

    try {
      await this.api.trackPR({
        url,
        title,
        project: 'default',
        status: 'open'
      })
      this.loadGitHubPRs()
      this.showNotification('success', 'PR Tracked', `Now tracking: ${title}`)
    } catch (e) {
      this.showNotification('error', 'Failed', e.message)
    }
  }

  // ===== BATCH OPERATIONS =====

  showBatchPanel(units) {
    this.selectedUnits = units

    if (!this.batchPanel) {
      this.createBatchPanel()
    }

    // Update count
    this.batchCountText.setText(`${units.length} agents selected`)

    // Show panel
    this.batchPanel.setVisible(true)
    this.batchPanel.setX(-250)
    this.batchPanel.setAlpha(0)

    const centerX = (this.cameras.main.width - 220) / 2
    const centerY = (this.cameras.main.height - 200) / 2
    this.batchPanel.setPosition(centerX, centerY)

    this.tweens.add({
      targets: this.batchPanel,
      alpha: 1,
      duration: 200,
      ease: 'Back.easeOut'
    })
  }

  hideBatchPanel() {
    if (this.batchPanel) {
      this.batchPanel.setVisible(false)
    }
  }

  createBatchPanel() {
    const width = 220
    const height = 250

    this.batchPanel = this.add.container(0, 0)
    this.batchPanel.setDepth(800)
    this.batchPanel.setVisible(false)

    // Card background
    const bg = this.add.graphics()
    bg.fillStyle(0x87CEEB, 0.3)
    bg.fillRoundedRect(-5, -5, width + 10, height + 10, 24)
    bg.fillStyle(0x000000, 0.25)
    bg.fillRoundedRect(5, 5, width, height, 22)
    bg.fillStyle(0xFFFFFF, 0.95)
    bg.fillRoundedRect(0, 0, width, height, 22)
    bg.fillStyle(0xF39C12, 1)
    bg.fillRoundedRect(0, 0, width, 55, { tl: 22, tr: 22, bl: 0, br: 0 })
    bg.fillStyle(0xE67E22, 1)
    bg.fillRoundedRect(0, 35, width, 20, 0)
    bg.lineStyle(3, 0xF39C12, 1)
    bg.strokeRoundedRect(0, 0, width, height, 22)

    // Title
    const title = this.add.text(width/2, 28, 'BATCH ACTIONS', {
      font: 'bold 18px Fredoka',
      fill: '#FFFFFF',
      stroke: '#C0392B',
      strokeThickness: 2
    }).setOrigin(0.5)

    // Count text
    this.batchCountText = this.add.text(width/2, 70, '0 agents selected', {
      font: 'bold 14px Fredoka',
      fill: '#666666'
    }).setOrigin(0.5)

    // Close button
    const closeBtn = this.add.graphics()
    closeBtn.fillStyle(0xFF6B6B, 0.8)
    closeBtn.fillCircle(width - 18, 18, 14)
    const closeX = this.add.text(width - 18, 18, 'X', {
      font: 'bold 14px Fredoka',
      fill: '#FFFFFF'
    }).setOrigin(0.5)
    const closeZone = this.add.zone(width - 18, 18, 28, 28).setInteractive({ useHandCursor: true })
    closeZone.on('pointerup', () => this.hideBatchPanel())

    this.batchPanel.add([bg, title, this.batchCountText, closeBtn, closeX, closeZone])

    // Batch action buttons
    const buttons = [
      { label: 'STOP ALL', action: 'stopAll', color: 0xE74C3C },
      { label: 'MARK ALL COMPLETE', action: 'completeAll', color: 0x2ECC71 },
      { label: 'DESELECT ALL', action: 'deselectAll', color: 0x95A5A6 }
    ]

    let yPos = 95
    buttons.forEach(btn => {
      const btnBg = this.add.graphics()
      this.drawButton(btnBg, 12, yPos, width - 24, 40, btn.color, true)
      const btnText = this.add.text(width/2, yPos + 20, btn.label, {
        font: 'bold 14px Fredoka',
        fill: '#FFFFFF'
      }).setOrigin(0.5)
      const btnZone = this.add.zone(width/2, yPos + 20, width - 24, 40).setInteractive({ useHandCursor: true })
      btnZone.on('pointerup', () => this.executeBatchAction(btn.action))
      this.batchPanel.add([btnBg, btnText, btnZone])
      yPos += 50
    })
  }

  async executeBatchAction(action) {
    if (!this.selectedUnits || this.selectedUnits.length === 0) return

    const agentIds = this.selectedUnits.map(u => u.id || `${u.rig}/polecats/${u.unitName}`)

    switch (action) {
      case 'stopAll':
        const confirmStop = await this.showModal({
          title: 'STOP ALL?',
          message: `Stop ${this.selectedUnits.length} agents?`,
          showCancel: true
        })
        if (!confirmStop) return

        try {
          await this.api.batchStop(agentIds)
          this.showNotification('success', 'Batch Stop', `Stopped ${agentIds.length} agents`)
          if (this.gameScene) this.gameScene.refreshState()
        } catch (e) {
          this.showNotification('error', 'Failed', e.message)
        }
        break

      case 'completeAll':
        const confirmComplete = await this.showModal({
          title: 'COMPLETE ALL?',
          message: `Mark ${this.selectedUnits.length} agents as complete?`,
          showCancel: true
        })
        if (!confirmComplete) return

        try {
          await this.api.batchComplete(agentIds)
          this.showNotification('success', 'Batch Complete', `Completed ${agentIds.length} agents`)
          if (this.gameScene) this.gameScene.refreshState()
        } catch (e) {
          this.showNotification('error', 'Failed', e.message)
        }
        break

      case 'deselectAll':
        if (this.gameScene) {
          this.gameScene.selectedUnits.forEach(u => u.deselect())
          this.gameScene.selectedUnits = []
        }
        break
    }

    this.hideBatchPanel()
  }

  // ===== PROJECT TEMPLATES =====

  async showTemplatesPanel() {
    const width = this.cameras.main.width
    const height = this.cameras.main.height
    const panelWidth = 400
    const panelHeight = 450

    const picker = this.add.container(width/2, height/2)
    picker.setDepth(1500)

    const backdrop = this.add.graphics()
    backdrop.fillStyle(0x000000, 0.6)
    backdrop.fillRect(-width/2, -height/2, width, height)
    backdrop.setInteractive(new Phaser.Geom.Rectangle(-width/2, -height/2, width, height), Phaser.Geom.Rectangle.Contains)
    backdrop.on('pointerup', () => picker.destroy())

    const panel = this.add.graphics()
    this.drawGlossyPanel(panel, -panelWidth/2, -panelHeight/2, panelWidth, panelHeight, 0x9B59B6, 20)
    panel.fillStyle(0xFFFFFF, 0.98)
    panel.fillRoundedRect(-panelWidth/2 + 10, -panelHeight/2 + 60, panelWidth - 20, panelHeight - 80, 12)

    const title = this.add.text(0, -panelHeight/2 + 30, 'PROJECT TEMPLATES', {
      font: 'bold 20px Fredoka',
      fill: '#FFFFFF',
      stroke: '#6C3483',
      strokeThickness: 2
    }).setOrigin(0.5)

    picker.add([backdrop, panel, title])

    // Load templates
    try {
      const result = await this.api.getTemplates()
      let yPos = -panelHeight/2 + 80

      if (result.templates.length === 0) {
        const empty = this.add.text(0, yPos + 50, 'No templates yet\nSave a project as template to get started', {
          font: '14px Fredoka',
          fill: '#999999',
          align: 'center'
        }).setOrigin(0.5)
        picker.add(empty)
      } else {
        result.templates.forEach(template => {
          const card = this.createTemplateCard(template, yPos, panelWidth, picker)
          yPos += 75
        })
      }

      // Create template button
      const createBtn = this.add.graphics()
      this.drawButton(createBtn, -panelWidth/2 + 20, panelHeight/2 - 60, panelWidth - 40, 40, 0x2ECC71, true)
      const createText = this.add.text(0, panelHeight/2 - 40, '+ CREATE TEMPLATE', {
        font: 'bold 14px Fredoka',
        fill: '#FFFFFF'
      }).setOrigin(0.5)
      const createZone = this.add.zone(0, panelHeight/2 - 40, panelWidth - 40, 40).setInteractive({ useHandCursor: true })
      createZone.on('pointerup', () => {
        picker.destroy()
        this.showCreateTemplateDialog()
      })
      picker.add([createBtn, createText, createZone])

    } catch (e) {
      const error = this.add.text(0, 0, `Failed to load templates: ${e.message}`, {
        font: '14px Fredoka',
        fill: '#E74C3C'
      }).setOrigin(0.5)
      picker.add(error)
    }

    picker.setScale(0.8)
    picker.setAlpha(0)
    this.tweens.add({
      targets: picker,
      scale: 1,
      alpha: 1,
      duration: 200,
      ease: 'Back.easeOut'
    })
  }

  createTemplateCard(template, y, panelWidth, picker) {
    const width = panelWidth - 40
    const container = this.add.container(-panelWidth/2 + 20, y)

    const bg = this.add.graphics()
    bg.fillStyle(0xF8F8F8, 1)
    bg.fillRoundedRect(0, 0, width, 65, 10)
    bg.fillStyle(0x9B59B6, 1)
    bg.fillRoundedRect(0, 0, 5, 65, { tl: 10, tr: 0, bl: 10, br: 0 })

    const name = this.add.text(15, 10, template.name, {
      font: 'bold 14px Fredoka',
      fill: '#333333'
    })

    const desc = this.add.text(15, 32, template.description || 'No description', {
      font: '11px Fredoka',
      fill: '#999999'
    })

    const stats = this.add.text(15, 48, `${template.defaultAgentCount} agents | ${template.repo ? 'Has repo' : 'No repo'}`, {
      font: '10px Fredoka',
      fill: '#666666'
    })

    // Use button
    const useBtn = this.add.graphics()
    this.drawButton(useBtn, width - 70, 15, 60, 35, 0x2ECC71, true)
    const useText = this.add.text(width - 40, 32, 'USE', {
      font: 'bold 12px Fredoka',
      fill: '#FFFFFF'
    }).setOrigin(0.5)
    const useZone = this.add.zone(width - 40, 32, 60, 35).setInteractive({ useHandCursor: true })
    useZone.on('pointerup', () => {
      picker.destroy()
      this.showUseTemplateDialog(template)
    })

    container.add([bg, name, desc, stats, useBtn, useText, useZone])
    picker.add(container)

    return container
  }

  async showCreateTemplateDialog() {
    const name = await this.showModal({
      title: 'TEMPLATE NAME',
      message: 'Enter a name for this template',
      inputType: 'text',
      placeholder: 'My project template'
    })
    if (!name) return

    const description = await this.showModal({
      title: 'DESCRIPTION',
      message: 'Add a description (optional)',
      inputType: 'text',
      placeholder: 'A template for...'
    }) || ''

    const agentCount = await this.showModal({
      title: 'DEFAULT AGENTS',
      message: 'How many agents to spawn by default?',
      inputType: 'text',
      placeholder: '1',
      defaultValue: '1'
    })

    try {
      await this.api.createTemplate({
        name,
        description,
        defaultAgentCount: parseInt(agentCount) || 1
      })
      this.showNotification('success', 'Template Created', `Template "${name}" saved`)
    } catch (e) {
      this.showNotification('error', 'Failed', e.message)
    }
  }

  async showUseTemplateDialog(template) {
    const projectName = await this.showModal({
      title: 'PROJECT NAME',
      message: `Create project from "${template.name}"`,
      inputType: 'text',
      placeholder: 'my-new-project'
    })
    if (!projectName) return

    try {
      this.statusText.setText('Creating project...')
      const result = await this.api.createFromTemplate(template.id, projectName)
      this.statusText.setText('Project created!')

      if (this.gameScene) {
        this.gameScene.addBuilding(`rig-${projectName}`, projectName, 14, 8, 'building-rig')
        this.gameScene.refreshState()
      }

      this.showNotification('success', 'Project Created', `${projectName} created from template`)
    } catch (e) {
      this.statusText.setText('Failed')
      this.showNotification('error', 'Failed', e.message)
    }
  }

  // ===== ENDURANCE EASTER EGG =====

  showEnduranceStory() {
    const width = this.cameras.main.width
    const height = this.cameras.main.height
    const modalWidth = 480
    const modalHeight = 400

    // Modal container
    this.enduranceModal = this.add.container(width/2, height/2)
    this.enduranceModal.setDepth(1500)
    this.enduranceModal.setAlpha(0)
    this.enduranceModal.setScale(0.8)

    // Backdrop
    const backdrop = this.add.graphics()
    backdrop.fillStyle(0x000000, 0.7)
    backdrop.fillRect(-width/2, -height/2, width, height)
    backdrop.setInteractive(new Phaser.Geom.Rectangle(-width/2, -height/2, width, height), Phaser.Geom.Rectangle.Contains)

    // Modal card with icy theme
    const card = this.add.graphics()
    // Outer ice glow
    card.fillStyle(0x87CEEB, 0.4)
    card.fillRoundedRect(-modalWidth/2 - 8, -modalHeight/2 - 8, modalWidth + 16, modalHeight + 16, 24)
    // Shadow
    card.fillStyle(0x1A3A4A, 0.5)
    card.fillRoundedRect(-modalWidth/2 + 8, -modalHeight/2 + 8, modalWidth, modalHeight, 22)
    // Main card (parchment/old paper look)
    card.fillStyle(0xF5E6D3, 0.98)
    card.fillRoundedRect(-modalWidth/2, -modalHeight/2, modalWidth, modalHeight, 22)
    // Header (dark Antarctic blue)
    card.fillStyle(0x1A3A4A, 1)
    card.fillRoundedRect(-modalWidth/2, -modalHeight/2, modalWidth, 65, { tl: 22, tr: 22, bl: 0, br: 0 })
    // Border
    card.lineStyle(3, 0x4A6A7A, 1)
    card.strokeRoundedRect(-modalWidth/2, -modalHeight/2, modalWidth, modalHeight, 22)

    // Ship icon in header
    const shipIcon = this.add.text(-modalWidth/2 + 30, -modalHeight/2 + 32, '🚢', {
      font: '28px Fredoka'
    }).setOrigin(0.5)

    // Title
    const titleText = this.add.text(20, -modalHeight/2 + 32, 'THE ENDURANCE', {
      font: 'bold 24px Fredoka',
      fill: '#FFFFFF',
      stroke: '#0A1A2A',
      strokeThickness: 2
    }).setOrigin(0.5)

    // Subtitle
    const subtitleText = this.add.text(0, -modalHeight/2 + 80, "Shackleton's Legendary Antarctic Expedition", {
      font: 'italic 14px Fredoka',
      fill: '#4A3A2A'
    }).setOrigin(0.5)

    // Story text
    const storyText = `In 1914, Sir Ernest Shackleton and his crew of 27 men set sail for Antarctica aboard the Endurance, hoping to make the first land crossing of the Antarctic continent.

Their ship became trapped in pack ice in the Weddell Sea and was slowly crushed over months. The crew camped on ice floes, then made a desperate 800-mile journey in small lifeboats to reach Elephant Island.

Shackleton and five others then sailed 800 miles across the world's most treacherous ocean in a 22-foot boat to South Georgia, where they crossed unmapped mountains to reach help.

Incredibly, not a single life was lost.

This is one of history's greatest survival stories.`

    const story = this.add.text(0, -modalHeight/2 + 105, storyText, {
      font: '13px Fredoka',
      fill: '#3A2A1A',
      align: 'center',
      wordWrap: { width: modalWidth - 50 },
      lineSpacing: 4
    }).setOrigin(0.5, 0)

    // Book recommendation
    const bookText = this.add.text(0, modalHeight/2 - 95, '📖 Read the incredible full story:', {
      font: 'bold 12px Fredoka',
      fill: '#4A3A2A'
    }).setOrigin(0.5)

    // Amazon link button
    const linkBtn = this.add.graphics()
    linkBtn.fillStyle(0xFF9900, 1) // Amazon orange
    linkBtn.fillRoundedRect(-100, modalHeight/2 - 75, 200, 36, 8)
    linkBtn.fillStyle(0xFFAA33, 0.4)
    linkBtn.fillRoundedRect(-98, modalHeight/2 - 73, 196, 16, { tl: 6, tr: 6, bl: 0, br: 0 })

    const linkText = this.add.text(0, modalHeight/2 - 57, 'ENDURANCE by Alfred Lansing', {
      font: 'bold 12px Fredoka',
      fill: '#FFFFFF'
    }).setOrigin(0.5)

    const linkZone = this.add.zone(0, modalHeight/2 - 57, 200, 36).setInteractive({ useHandCursor: true })
    linkZone.on('pointerup', () => {
      window.open('https://www.amazon.com/Endurance-Shackletons-Incredible-Alfred-Lansing/dp/0465062881/', '_blank')
    })
    linkZone.on('pointerover', () => {
      linkBtn.clear()
      linkBtn.fillStyle(0xFFAA33, 1)
      linkBtn.fillRoundedRect(-100, modalHeight/2 - 75, 200, 36, 8)
    })
    linkZone.on('pointerout', () => {
      linkBtn.clear()
      linkBtn.fillStyle(0xFF9900, 1)
      linkBtn.fillRoundedRect(-100, modalHeight/2 - 75, 200, 36, 8)
      linkBtn.fillStyle(0xFFAA33, 0.4)
      linkBtn.fillRoundedRect(-98, modalHeight/2 - 73, 196, 16, { tl: 6, tr: 6, bl: 0, br: 0 })
    })

    // Close button
    const closeBtn = this.add.graphics()
    closeBtn.fillStyle(0xE74C3C, 1)
    closeBtn.fillCircle(modalWidth/2 - 25, -modalHeight/2 + 25, 16)
    closeBtn.fillStyle(0xFF6B6B, 0.5)
    closeBtn.fillCircle(modalWidth/2 - 27, -modalHeight/2 + 23, 8)

    const closeX = this.add.text(modalWidth/2 - 25, -modalHeight/2 + 25, '×', {
      font: 'bold 22px Fredoka',
      fill: '#FFFFFF'
    }).setOrigin(0.5)

    const closeZone = this.add.zone(modalWidth/2 - 25, -modalHeight/2 + 25, 32, 32).setInteractive({ useHandCursor: true })
    closeZone.on('pointerup', () => {
      this.tweens.add({
        targets: this.enduranceModal,
        alpha: 0,
        scale: 0.8,
        duration: 200,
        ease: 'Back.easeIn',
        onComplete: () => {
          this.enduranceModal.destroy()
          this.enduranceModal = null
        }
      })
    })

    // Click backdrop to close
    backdrop.on('pointerup', () => {
      closeZone.emit('pointerup')
    })

    this.enduranceModal.add([
      backdrop, card, shipIcon, titleText, subtitleText, story,
      bookText, linkBtn, linkText, linkZone,
      closeBtn, closeX, closeZone
    ])

    // Animate in
    this.tweens.add({
      targets: this.enduranceModal,
      alpha: 1,
      scale: 1,
      duration: 300,
      ease: 'Back.easeOut'
    })
  }

}
