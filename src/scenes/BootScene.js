import Phaser from 'phaser'

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' })
  }

  preload() {
    // Show loading bar
    const width = this.cameras.main.width
    const height = this.cameras.main.height

    const progressBar = this.add.graphics()
    const progressBox = this.add.graphics()
    progressBox.fillStyle(0x222222, 0.8)
    progressBox.fillRect(width/2 - 160, height/2 - 25, 320, 50)

    const loadingText = this.add.text(width/2, height/2 - 50, 'Loading Gas Town...', {
      font: '16px monospace',
      fill: '#d4a373'
    }).setOrigin(0.5)

    this.load.on('progress', (value) => {
      progressBar.clear()
      progressBar.fillStyle(0xd4a373, 1)
      progressBar.fillRect(width/2 - 150, height/2 - 15, 300 * value, 30)
    })
  }

  create() {
    // Generate all sprites procedurally (AoE pixel art style)
    this.generateSprites()
    this.scene.start('GameScene')
  }

  generateSprites() {
    // Isometric tile (grass)
    this.generateIsoTile('tile-grass', 0x4a7c59, 0x3d6b4a)
    this.generateIsoTile('tile-dirt', 0x8b7355, 0x6b5344)
    this.generateIsoTile('tile-stone', 0x696969, 0x505050)

    // Buildings
    this.generateBuilding('building-townhall', 0xd4a373, 0xa67c52, 64, 48) // Mayor HQ
    this.generateBuilding('building-refinery', 0x8b4513, 0x5c2e0d, 48, 40)
    this.generateBuilding('building-barracks', 0x4a5568, 0x2d3748, 40, 32) // Polecats spawn
    this.generateBuilding('building-rig', 0x718096, 0x4a5568, 36, 28)

    // Units (polecats)
    this.generateUnit('unit-polecat-idle', 0x3182ce, 0x2c5282)
    this.generateUnit('unit-polecat-working', 0x38a169, 0x276749)
    this.generateUnit('unit-polecat-stuck', 0xe53e3e, 0x9b2c2c)
    this.generateUnit('unit-mayor', 0xd69e2e, 0xb7791f)
    this.generateUnit('unit-deacon', 0x805ad5, 0x6b46c1)
    this.generateUnit('unit-refinery', 0xdd6b20, 0xc05621)

    // Selection ring
    this.generateSelectionRing()

    // Resource icons
    this.generateResourceIcon('icon-tokens', 0xffd700)
    this.generateResourceIcon('icon-issues', 0x48bb78)
    this.generateResourceIcon('icon-convoys', 0x4299e1)
  }

  generateIsoTile(key, topColor, sideColor) {
    const g = this.make.graphics({ x: 0, y: 0, add: false })
    const w = 64, h = 32

    // Diamond shape (isometric tile)
    g.fillStyle(topColor, 1)
    g.beginPath()
    g.moveTo(w/2, 0)
    g.lineTo(w, h/2)
    g.lineTo(w/2, h)
    g.lineTo(0, h/2)
    g.closePath()
    g.fillPath()

    // Subtle grid lines
    g.lineStyle(1, sideColor, 0.3)
    g.strokePath()

    g.generateTexture(key, w, h)
    g.destroy()
  }

  generateBuilding(key, roofColor, wallColor, width, height) {
    const g = this.make.graphics({ x: 0, y: 0, add: false })

    // Isometric building
    const w = width, h = height
    const baseH = h * 0.4
    const roofH = h * 0.6

    // Left wall
    g.fillStyle(wallColor, 1)
    g.beginPath()
    g.moveTo(0, roofH)
    g.lineTo(w/2, roofH + baseH/2)
    g.lineTo(w/2, h)
    g.lineTo(0, h - baseH/2)
    g.closePath()
    g.fillPath()

    // Right wall (lighter)
    g.fillStyle(Phaser.Display.Color.IntegerToColor(wallColor).lighten(20).color, 1)
    g.beginPath()
    g.moveTo(w, roofH)
    g.lineTo(w/2, roofH + baseH/2)
    g.lineTo(w/2, h)
    g.lineTo(w, h - baseH/2)
    g.closePath()
    g.fillPath()

    // Roof
    g.fillStyle(roofColor, 1)
    g.beginPath()
    g.moveTo(w/2, 0)
    g.lineTo(w, roofH)
    g.lineTo(w/2, roofH + baseH/2)
    g.lineTo(0, roofH)
    g.closePath()
    g.fillPath()

    // Door
    g.fillStyle(0x2d2d2d, 1)
    g.fillRect(w/2 - 4, h - 12, 8, 10)

    g.generateTexture(key, w, h)
    g.destroy()
  }

  generateUnit(key, bodyColor, shadowColor) {
    const g = this.make.graphics({ x: 0, y: 0, add: false })
    const size = 16

    // Shadow
    g.fillStyle(0x000000, 0.3)
    g.fillEllipse(size/2, size - 2, 10, 4)

    // Body (simple humanoid)
    g.fillStyle(bodyColor, 1)
    g.fillCircle(size/2, 5, 4) // Head
    g.fillRect(size/2 - 3, 8, 6, 6) // Body

    // Outline
    g.lineStyle(1, shadowColor, 1)
    g.strokeCircle(size/2, 5, 4)

    g.generateTexture(key, size, size)
    g.destroy()
  }

  generateSelectionRing() {
    const g = this.make.graphics({ x: 0, y: 0, add: false })
    const size = 24

    g.lineStyle(2, 0x00ff00, 1)
    g.strokeEllipse(size/2, size/2, 20, 10)

    g.generateTexture('selection-ring', size, size)
    g.destroy()
  }

  generateResourceIcon(key, color) {
    const g = this.make.graphics({ x: 0, y: 0, add: false })
    const size = 16

    g.fillStyle(color, 1)
    g.fillCircle(size/2, size/2, 6)
    g.lineStyle(1, 0xffffff, 0.5)
    g.strokeCircle(size/2, size/2, 6)

    g.generateTexture(key, size, size)
    g.destroy()
  }
}
