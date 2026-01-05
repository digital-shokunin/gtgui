import Phaser from 'phaser'

export class UIScene extends Phaser.Scene {
  constructor() {
    super({ key: 'UIScene' })
  }

  init(data) {
    this.gameScene = data.gameScene
  }

  create() {
    // Create UI containers
    this.createResourceBar()
    this.createMinimap()
    this.createCommandPanel()
    this.createTooltip()

    // Listen for game events
    if (this.gameScene) {
      this.gameScene.events.on('selectionChanged', this.updateSelection, this)
      this.gameScene.events.on('showTooltip', this.showTooltip, this)
      this.gameScene.events.on('hideTooltip', this.hideTooltip, this)
      this.gameScene.events.on('stateUpdated', this.updateResources, this)
    }

    // Handle resize
    this.scale.on('resize', this.handleResize, this)
  }

  createResourceBar() {
    const width = this.cameras.main.width

    // Top bar background
    this.topBar = this.add.graphics()
    this.topBar.fillStyle(0x1a1a2e, 0.95)
    this.topBar.fillRect(0, 0, width, 40)
    this.topBar.lineStyle(2, 0xd4a373, 1)
    this.topBar.lineBetween(0, 40, width, 40)

    // Resource displays (AoE style)
    this.resources = {
      tokens: { icon: 'icon-tokens', value: 0, x: 20 },
      issues: { icon: 'icon-issues', value: 0, x: 150 },
      convoys: { icon: 'icon-convoys', value: 0, x: 280 }
    }

    Object.entries(this.resources).forEach(([key, res]) => {
      res.iconSprite = this.add.image(res.x, 20, res.icon)
      res.text = this.add.text(res.x + 20, 12, `${key}: ${res.value}`, {
        font: '14px monospace',
        fill: '#d4a373'
      })
    })

    // Town name
    this.townName = this.add.text(width - 20, 12, 'GAS TOWN', {
      font: 'bold 16px monospace',
      fill: '#d4a373'
    }).setOrigin(1, 0)

    // Time/status
    this.statusText = this.add.text(width - 20, 28, 'All systems nominal', {
      font: '10px monospace',
      fill: '#48bb78'
    }).setOrigin(1, 0)
  }

  createMinimap() {
    const minimapSize = 150
    const padding = 10
    const x = this.cameras.main.width - minimapSize - padding
    const y = this.cameras.main.height - minimapSize - padding

    // Minimap background
    this.minimapBg = this.add.graphics()
    this.minimapBg.fillStyle(0x1a1a2e, 0.9)
    this.minimapBg.fillRect(x - 5, y - 5, minimapSize + 10, minimapSize + 10)
    this.minimapBg.lineStyle(2, 0xd4a373, 1)
    this.minimapBg.strokeRect(x - 5, y - 5, minimapSize + 10, minimapSize + 10)

    // Minimap terrain (simplified)
    this.minimap = this.add.graphics()
    this.minimap.fillStyle(0x4a7c59, 1)
    this.minimap.fillRect(x, y, minimapSize, minimapSize)

    // Buildings on minimap
    this.minimapMarkers = this.add.graphics()
    this.minimapMarkers.fillStyle(0xd4a373, 1)
    this.minimapMarkers.fillRect(x + 75, y + 75, 6, 6) // Town center

    // Viewport indicator
    this.viewportIndicator = this.add.graphics()
    this.viewportIndicator.lineStyle(1, 0xffffff, 0.8)
    this.viewportIndicator.strokeRect(x + 60, y + 60, 30, 20)

    // Label
    this.add.text(x + minimapSize/2, y - 15, 'MAP', {
      font: '10px monospace',
      fill: '#d4a373'
    }).setOrigin(0.5, 0)
  }

  createCommandPanel() {
    const panelWidth = 250
    const panelHeight = 200
    const x = this.cameras.main.width - panelWidth - 10
    const y = this.cameras.main.height - panelHeight - 170 // Above minimap

    // Panel background
    this.commandPanel = this.add.graphics()
    this.commandPanel.fillStyle(0x1a1a2e, 0.95)
    this.commandPanel.fillRect(x, y, panelWidth, panelHeight)
    this.commandPanel.lineStyle(2, 0xd4a373, 1)
    this.commandPanel.strokeRect(x, y, panelWidth, panelHeight)

    // Panel title
    this.panelTitle = this.add.text(x + panelWidth/2, y + 10, 'COMMANDS', {
      font: 'bold 12px monospace',
      fill: '#d4a373'
    }).setOrigin(0.5, 0)

    // Selection info
    this.selectionInfo = this.add.text(x + 10, y + 35, 'No selection', {
      font: '11px monospace',
      fill: '#a0aec0'
    })

    // Command buttons container
    this.commandButtons = []
    this.buttonContainer = this.add.container(x + 10, y + 70)

    // Default buttons (will update based on selection)
    this.createCommandButtons([
      { label: 'SLING WORK', action: 'sling', color: 0x48bb78 },
      { label: 'VIEW HOOK', action: 'hook', color: 0x4299e1 },
      { label: 'MAIL', action: 'mail', color: 0xd69e2e },
      { label: 'STOP', action: 'stop', color: 0xe53e3e }
    ])
  }

  createCommandButtons(buttons) {
    // Clear existing
    this.buttonContainer.removeAll(true)
    this.commandButtons = []

    const buttonWidth = 110
    const buttonHeight = 28
    const spacing = 5

    buttons.forEach((btn, i) => {
      const col = i % 2
      const row = Math.floor(i / 2)
      const bx = col * (buttonWidth + spacing)
      const by = row * (buttonHeight + spacing)

      const bg = this.add.graphics()
      bg.fillStyle(btn.color, 0.3)
      bg.fillRect(bx, by, buttonWidth, buttonHeight)
      bg.lineStyle(1, btn.color, 1)
      bg.strokeRect(bx, by, buttonWidth, buttonHeight)

      const text = this.add.text(bx + buttonWidth/2, by + buttonHeight/2, btn.label, {
        font: '10px monospace',
        fill: '#ffffff'
      }).setOrigin(0.5)

      // Interactive zone
      const zone = this.add.zone(bx + buttonWidth/2, by + buttonHeight/2, buttonWidth, buttonHeight)
      zone.setInteractive({ useHandCursor: true })

      zone.on('pointerover', () => {
        bg.clear()
        bg.fillStyle(btn.color, 0.6)
        bg.fillRect(bx, by, buttonWidth, buttonHeight)
        bg.lineStyle(2, btn.color, 1)
        bg.strokeRect(bx, by, buttonWidth, buttonHeight)
      })

      zone.on('pointerout', () => {
        bg.clear()
        bg.fillStyle(btn.color, 0.3)
        bg.fillRect(bx, by, buttonWidth, buttonHeight)
        bg.lineStyle(1, btn.color, 1)
        bg.strokeRect(bx, by, buttonWidth, buttonHeight)
      })

      zone.on('pointerdown', () => {
        this.executeCommand(btn.action)
      })

      this.buttonContainer.add([bg, text, zone])
      this.commandButtons.push({ bg, text, zone, action: btn.action })
    })
  }

  createTooltip() {
    this.tooltip = this.add.container(0, 0)
    this.tooltip.setVisible(false)

    const bg = this.add.graphics()
    bg.fillStyle(0x1a1a2e, 0.95)
    bg.fillRoundedRect(0, 0, 150, 50, 5)
    bg.lineStyle(1, 0xd4a373, 1)
    bg.strokeRoundedRect(0, 0, 150, 50, 5)

    this.tooltipText = this.add.text(10, 8, '', {
      font: '11px monospace',
      fill: '#ffffff',
      wordWrap: { width: 130 }
    })

    this.tooltip.add([bg, this.tooltipText])
  }

  showTooltip(data) {
    let text = data.name
    if (data.status) text += `\nStatus: ${data.status}`
    if (data.type) text += `\nType: ${data.type}`

    this.tooltipText.setText(text)
    this.tooltip.setPosition(data.x + 20, data.y - 60)
    this.tooltip.setVisible(true)
  }

  hideTooltip() {
    this.tooltip.setVisible(false)
  }

  updateSelection(units) {
    if (units.length === 0) {
      this.selectionInfo.setText('No selection')
      this.panelTitle.setText('COMMANDS')
    } else if (units.length === 1) {
      const unit = units[0]
      this.selectionInfo.setText(`${unit.unitName}\nStatus: ${unit.status}`)
      this.panelTitle.setText(unit.unitName.toUpperCase())
    } else {
      this.selectionInfo.setText(`${units.length} units selected`)
      this.panelTitle.setText('GROUP')
    }
  }

  updateResources(state) {
    if (state.tokens !== undefined) {
      this.resources.tokens.text.setText(`Tokens: ${state.tokens}`)
    }
    if (state.openIssues !== undefined) {
      this.resources.issues.text.setText(`Issues: ${state.openIssues}`)
    }
    if (state.activeConvoys !== undefined) {
      this.resources.convoys.text.setText(`Convoys: ${state.activeConvoys}`)
    }
  }

  executeCommand(action) {
    console.log('Executing command:', action)
    // In real implementation, call gt commands via API
    switch(action) {
      case 'sling':
        this.showCommandDialog('Sling Work', 'Enter issue ID:')
        break
      case 'hook':
        // Show current hook
        break
      case 'mail':
        this.showCommandDialog('Send Mail', 'Message:')
        break
      case 'stop':
        // Emergency stop
        break
    }
  }

  showCommandDialog(title, prompt) {
    // Simple dialog (would be more elaborate in full version)
    const result = window.prompt(`${title}\n${prompt}`)
    if (result) {
      console.log(`${title}: ${result}`)
    }
  }

  handleResize(gameSize) {
    const width = gameSize.width
    const height = gameSize.height

    // Reposition UI elements
    if (this.topBar) {
      this.topBar.clear()
      this.topBar.fillStyle(0x1a1a2e, 0.95)
      this.topBar.fillRect(0, 0, width, 40)
      this.topBar.lineStyle(2, 0xd4a373, 1)
      this.topBar.lineBetween(0, 40, width, 40)
    }

    if (this.townName) {
      this.townName.setPosition(width - 20, 12)
    }

    if (this.statusText) {
      this.statusText.setPosition(width - 20, 28)
    }
  }
}
