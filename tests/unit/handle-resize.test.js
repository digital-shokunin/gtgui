import { describe, it, expect } from 'vitest'

// --- Pure resize positioning logic extracted from UIScene.handleResize ---

/** Returns repositioned coordinates for all edge-anchored UI elements. */
function computeResizePositions(width, height) {
  return {
    topBar: { x: 10, width: width - 20, height: 50 },
    townName: { x: width - 30, y: 18 },
    statusText: { x: width - 30, y: 40 },
    usersContainer: { x: width - 255, y: 33 },
    settingsBtn: { x: width - 210, y: 33 },
    costDashboard: { x: width - 50 },
    githubPanel: { x: width - 100 },
    notificationContainer: { x: width - 320 },
    villageNav: { y: height - 200 },
    newProjectBtn: { y: height - 65 },
    taskQueue: { y: height - 40 },
  }
}

/** Returns recalculated minimap coordinates for a given viewport size. */
function computeMinimapPosition(width, height, minimapSize = 160, padding = 15) {
  const minimapX = width - minimapSize - padding
  const minimapY = height - minimapSize - padding
  return {
    minimapX,
    minimapY,
    bgRect: { x: minimapX - 10, y: minimapY - 30, w: minimapSize + 20, h: minimapSize + 40 },
    labelPos: { x: minimapX + minimapSize / 2, y: minimapY - 18 },
  }
}

// --- Tests ---

describe('handleResize position calculations', () => {
  it('positions top-right elements relative to width', () => {
    const pos = computeResizePositions(1200, 800)
    expect(pos.costDashboard.x).toBe(1150)
    expect(pos.githubPanel.x).toBe(1100)
    expect(pos.notificationContainer.x).toBe(880)
    expect(pos.townName.x).toBe(1170)
    expect(pos.statusText.x).toBe(1170)
  })

  it('positions bottom-anchored elements relative to height', () => {
    const pos = computeResizePositions(1200, 800)
    expect(pos.villageNav.y).toBe(600)
    expect(pos.newProjectBtn.y).toBe(735)
    expect(pos.taskQueue.y).toBe(760)
  })

  it('top bar stretches to fill width', () => {
    const pos = computeResizePositions(1000, 600)
    expect(pos.topBar.width).toBe(980)
  })

  it('handles small viewport without negative coordinates', () => {
    const pos = computeResizePositions(400, 300)
    // All X positions should still be valid (may overlap but not negative)
    expect(pos.costDashboard.x).toBe(350)
    expect(pos.githubPanel.x).toBe(300)
    expect(pos.notificationContainer.x).toBe(80)
    expect(pos.villageNav.y).toBe(100)
    expect(pos.newProjectBtn.y).toBe(235)
    expect(pos.taskQueue.y).toBe(260)
  })

  it('handles large viewport', () => {
    const pos = computeResizePositions(2560, 1440)
    expect(pos.costDashboard.x).toBe(2510)
    expect(pos.villageNav.y).toBe(1240)
    expect(pos.taskQueue.y).toBe(1400)
  })
})

describe('Minimap repositioning', () => {
  it('anchors minimap to bottom-right corner', () => {
    const m = computeMinimapPosition(1200, 800)
    expect(m.minimapX).toBe(1025) // 1200 - 160 - 15
    expect(m.minimapY).toBe(625)  // 800 - 160 - 15
  })

  it('computes background rect with 10px padding and 30px header', () => {
    const m = computeMinimapPosition(1200, 800)
    expect(m.bgRect.x).toBe(1015)  // minimapX - 10
    expect(m.bgRect.y).toBe(595)   // minimapY - 30
    expect(m.bgRect.w).toBe(180)   // 160 + 20
    expect(m.bgRect.h).toBe(200)   // 160 + 40
  })

  it('centers label above minimap area', () => {
    const m = computeMinimapPosition(1200, 800)
    expect(m.labelPos.x).toBe(1105) // minimapX + 160/2
    expect(m.labelPos.y).toBe(607)  // minimapY - 18
  })

  it('repositions correctly after shrink', () => {
    const m = computeMinimapPosition(600, 400)
    expect(m.minimapX).toBe(425) // 600 - 160 - 15
    expect(m.minimapY).toBe(225) // 400 - 160 - 15
    expect(m.labelPos.x).toBe(505) // 425 + 80
  })

  it('uses custom minimap size if provided', () => {
    const m = computeMinimapPosition(1200, 800, 200, 20)
    expect(m.minimapX).toBe(980) // 1200 - 200 - 20
    expect(m.minimapY).toBe(580) // 800 - 200 - 20
  })
})
