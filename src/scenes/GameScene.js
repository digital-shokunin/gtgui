import Phaser from 'phaser'
import { GasTownAPI } from '../api/GasTownAPI.js'

export class GameScene extends Phaser.Scene {
  constructor() {
    super({ key: 'GameScene' })
    this.api = new GasTownAPI()
    this.units = new Map()
    this.buildings = new Map()
    this.selectedUnits = []
    this.mapWidth = 20
    this.mapHeight = 20
    this.tileWidth = 64
    this.tileHeight = 32
  }

  create() {
    // Camera controls
    this.cameras.main.setZoom(1.5)
    this.setupCameraControls()

    // Create isometric map
    this.createMap()

    // Create building layer
    this.buildingLayer = this.add.container(0, 0)

    // Create unit layer (above buildings)
    this.unitLayer = this.add.container(0, 0)

    // Selection box
    this.selectionBox = this.add.graphics()
    this.selectionStart = null

    // Input handlers
    this.setupInput()

    // Load initial state
    this.loadTownState()

    // Start UI scene in parallel
    this.scene.launch('UIScene', { gameScene: this })

    // Poll for updates
    this.time.addEvent({
      delay: 3000,
      callback: () => this.refreshState(),
      loop: true
    })
  }

  setupCameraControls() {
    // WASD / Arrow keys for panning
    this.cursors = this.input.keyboard.createCursorKeys()
    this.wasd = this.input.keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D
    })

    // Mouse drag to pan
    this.input.on('pointermove', (pointer) => {
      if (pointer.isDown && pointer.button === 2) {
        this.cameras.main.scrollX -= (pointer.x - pointer.prevPosition.x) / this.cameras.main.zoom
        this.cameras.main.scrollY -= (pointer.y - pointer.prevPosition.y) / this.cameras.main.zoom
      }
    })

    // Scroll to zoom
    this.input.on('wheel', (pointer, gameObjects, deltaX, deltaY) => {
      const zoom = this.cameras.main.zoom
      const newZoom = Phaser.Math.Clamp(zoom - deltaY * 0.001, 0.5, 3)
      this.cameras.main.setZoom(newZoom)
    })

    // Center camera on town
    const centerX = this.mapWidth * this.tileWidth / 2
    const centerY = this.mapHeight * this.tileHeight / 2
    this.cameras.main.centerOn(centerX, centerY)
  }

  createMap() {
    this.mapLayer = this.add.container(0, 0)

    for (let y = 0; y < this.mapHeight; y++) {
      for (let x = 0; x < this.mapWidth; x++) {
        const isoX = (x - y) * this.tileWidth / 2
        const isoY = (x + y) * this.tileHeight / 2

        // Varied terrain
        let tileKey = 'tile-grass'
        const noise = Math.sin(x * 0.5) * Math.cos(y * 0.7)
        if (noise > 0.5) tileKey = 'tile-dirt'
        if (noise < -0.7) tileKey = 'tile-stone'

        const tile = this.add.image(isoX, isoY, tileKey)
        tile.setOrigin(0.5, 0.5)
        tile.setInteractive()
        tile.gridX = x
        tile.gridY = y

        // Hover effect
        tile.on('pointerover', () => tile.setTint(0xaaaaaa))
        tile.on('pointerout', () => tile.clearTint())

        this.mapLayer.add(tile)
      }
    }

    // Offset to center
    this.mapLayer.x = this.cameras.main.width / 2
    this.mapLayer.y = 100
  }

  setupInput() {
    // Left click to select
    this.input.on('pointerdown', (pointer) => {
      if (pointer.button === 0) {
        this.selectionStart = { x: pointer.worldX, y: pointer.worldY }
      }
    })

    // Drag selection box
    this.input.on('pointermove', (pointer) => {
      if (this.selectionStart && pointer.isDown && pointer.button === 0) {
        this.drawSelectionBox(pointer.worldX, pointer.worldY)
      }
    })

    // Release to finalize selection
    this.input.on('pointerup', (pointer) => {
      if (pointer.button === 0 && this.selectionStart) {
        this.finalizeSelection(pointer.worldX, pointer.worldY)
        this.selectionBox.clear()
        this.selectionStart = null
      }
    })

    // Right click to issue command
    this.input.on('pointerdown', (pointer) => {
      if (pointer.button === 2 && this.selectedUnits.length > 0) {
        this.issueCommand(pointer.worldX, pointer.worldY)
      }
    })

    // Prevent context menu
    this.game.canvas.addEventListener('contextmenu', (e) => e.preventDefault())
  }

  drawSelectionBox(endX, endY) {
    this.selectionBox.clear()
    this.selectionBox.lineStyle(2, 0x00ff00, 1)
    this.selectionBox.fillStyle(0x00ff00, 0.1)

    const x = Math.min(this.selectionStart.x, endX)
    const y = Math.min(this.selectionStart.y, endY)
    const w = Math.abs(endX - this.selectionStart.x)
    const h = Math.abs(endY - this.selectionStart.y)

    this.selectionBox.fillRect(x, y, w, h)
    this.selectionBox.strokeRect(x, y, w, h)
  }

  finalizeSelection(endX, endY) {
    // Clear previous selection
    this.selectedUnits.forEach(u => u.deselect())
    this.selectedUnits = []

    const rect = new Phaser.Geom.Rectangle(
      Math.min(this.selectionStart.x, endX),
      Math.min(this.selectionStart.y, endY),
      Math.abs(endX - this.selectionStart.x),
      Math.abs(endY - this.selectionStart.y)
    )

    // If it's a click (small rect), select single unit under cursor
    if (rect.width < 5 && rect.height < 5) {
      this.units.forEach(unit => {
        const worldPos = this.unitLayer.getWorldTransformMatrix().transformPoint(unit.x, unit.y)
        if (Phaser.Geom.Rectangle.Contains(
          new Phaser.Geom.Rectangle(endX - 10, endY - 10, 20, 20),
          worldPos.x, worldPos.y
        )) {
          this.selectedUnits.push(unit)
          unit.select()
        }
      })
    } else {
      // Box selection
      this.units.forEach(unit => {
        const worldPos = this.unitLayer.getWorldTransformMatrix().transformPoint(unit.x, unit.y)
        if (Phaser.Geom.Rectangle.Contains(rect, worldPos.x, worldPos.y)) {
          this.selectedUnits.push(unit)
          unit.select()
        }
      })
    }

    // Emit event for UI
    this.events.emit('selectionChanged', this.selectedUnits)
  }

  issueCommand(worldX, worldY) {
    // Find what was clicked (tile position)
    // For now, just move units there
    this.selectedUnits.forEach(unit => {
      unit.moveTo(worldX, worldY)
    })
  }

  async loadTownState() {
    try {
      const state = await this.api.getStatus()
      this.updateFromState(state)
    } catch (e) {
      console.warn('Could not load town state:', e)
      // Create demo state
      this.createDemoState()
    }
  }

  createDemoState() {
    // Town Hall (Mayor HQ) - center
    this.addBuilding('townhall', 'Mayor HQ', 10, 10, 'building-townhall')

    // Refinery
    this.addBuilding('refinery', 'Refinery', 7, 8, 'building-refinery')

    // Rig buildings
    this.addBuilding('rig-tribetown', 'tribetown', 12, 7, 'building-rig')

    // Barracks (polecat spawner)
    this.addBuilding('barracks', 'Barracks', 8, 12, 'building-barracks')

    // Demo polecats
    this.addUnit('mayor', 'Mayor', 10, 9, 'unit-mayor', 'idle')
    this.addUnit('deacon', 'Deacon', 9, 10, 'unit-deacon', 'idle')
    this.addUnit('polecat-1', 'goose', 13, 8, 'unit-polecat-working', 'working')
    this.addUnit('polecat-2', 'nux', 14, 9, 'unit-polecat-idle', 'idle')
    this.addUnit('refinery-agent', 'Refinery', 7, 9, 'unit-refinery', 'idle')
  }

  updateFromState(state) {
    // Update from real Gas Town data
    if (state.rigs) {
      state.rigs.forEach((rig, i) => {
        this.addBuilding(`rig-${rig.name}`, rig.name, 12 + i * 2, 7, 'building-rig')
      })
    }

    if (state.polecats) {
      state.polecats.forEach((pc, i) => {
        const status = pc.status === 'working' ? 'unit-polecat-working' :
                       pc.status === 'stuck' ? 'unit-polecat-stuck' : 'unit-polecat-idle'
        this.addUnit(`polecat-${pc.name}`, pc.name, 13 + i, 8 + i, status, pc.status)
      })
    }
  }

  addBuilding(id, name, gridX, gridY, spriteKey) {
    const { x, y } = this.gridToIso(gridX, gridY)

    const building = this.add.image(x, y, spriteKey)
    building.setOrigin(0.5, 1)
    building.id = id
    building.buildingName = name
    building.gridX = gridX
    building.gridY = gridY
    building.setInteractive()

    // Hover tooltip
    building.on('pointerover', () => {
      building.setTint(0xcccccc)
      this.events.emit('showTooltip', { name, type: 'building', x: building.x, y: building.y })
    })
    building.on('pointerout', () => {
      building.clearTint()
      this.events.emit('hideTooltip')
    })

    this.buildingLayer.add(building)
    this.buildings.set(id, building)

    // Sort by Y for proper overlap
    this.buildingLayer.sort('y')
  }

  addUnit(id, name, gridX, gridY, spriteKey, status) {
    const { x, y } = this.gridToIso(gridX, gridY)

    const unit = this.add.container(x, y)
    const sprite = this.add.image(0, 0, spriteKey)
    sprite.setOrigin(0.5, 1)

    const selectionRing = this.add.image(0, 2, 'selection-ring')
    selectionRing.setOrigin(0.5, 0.5)
    selectionRing.setVisible(false)

    unit.add([selectionRing, sprite])
    unit.sprite = sprite
    unit.selectionRing = selectionRing
    unit.id = id
    unit.unitName = name
    unit.status = status
    unit.gridX = gridX
    unit.gridY = gridY

    // Selection methods
    unit.select = () => {
      selectionRing.setVisible(true)
    }
    unit.deselect = () => {
      selectionRing.setVisible(false)
    }

    // Movement
    unit.moveTo = (worldX, worldY) => {
      this.tweens.add({
        targets: unit,
        x: worldX,
        y: worldY,
        duration: 500,
        ease: 'Power2'
      })
    }

    // Make interactive
    sprite.setInteractive()
    sprite.on('pointerover', () => {
      sprite.setTint(0xaaaaff)
      this.events.emit('showTooltip', { name, type: 'unit', status, x: unit.x, y: unit.y - 20 })
    })
    sprite.on('pointerout', () => {
      sprite.clearTint()
      this.events.emit('hideTooltip')
    })

    this.unitLayer.add(unit)
    this.units.set(id, unit)

    // Idle animation (slight bob)
    if (status === 'idle') {
      this.tweens.add({
        targets: sprite,
        y: -2,
        duration: 1000,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut'
      })
    }

    // Working animation (faster movement)
    if (status === 'working') {
      this.tweens.add({
        targets: sprite,
        scaleX: 1.1,
        scaleY: 0.9,
        duration: 300,
        yoyo: true,
        repeat: -1
      })
    }

    // Sort units by Y
    this.unitLayer.sort('y')
  }

  gridToIso(gridX, gridY) {
    const offsetX = this.mapLayer.x
    const offsetY = this.mapLayer.y
    return {
      x: offsetX + (gridX - gridY) * this.tileWidth / 2,
      y: offsetY + (gridX + gridY) * this.tileHeight / 2
    }
  }

  update() {
    // Camera movement
    const camSpeed = 10 / this.cameras.main.zoom
    if (this.cursors.left.isDown || this.wasd.left.isDown) {
      this.cameras.main.scrollX -= camSpeed
    }
    if (this.cursors.right.isDown || this.wasd.right.isDown) {
      this.cameras.main.scrollX += camSpeed
    }
    if (this.cursors.up.isDown || this.wasd.up.isDown) {
      this.cameras.main.scrollY -= camSpeed
    }
    if (this.cursors.down.isDown || this.wasd.down.isDown) {
      this.cameras.main.scrollY += camSpeed
    }
  }

  async refreshState() {
    try {
      const state = await this.api.getStatus()
      // Update unit states
      if (state.polecats) {
        state.polecats.forEach(pc => {
          const unit = this.units.get(`polecat-${pc.name}`)
          if (unit) {
            unit.status = pc.status
            // Update sprite based on status
            const newKey = pc.status === 'working' ? 'unit-polecat-working' :
                          pc.status === 'stuck' ? 'unit-polecat-stuck' : 'unit-polecat-idle'
            unit.sprite.setTexture(newKey)
          }
        })
      }
      this.events.emit('stateUpdated', state)
    } catch (e) {
      // Silently fail on refresh
    }
  }
}
