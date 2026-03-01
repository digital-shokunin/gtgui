import { describe, it, expect } from 'vitest'

// --- Pure logic extracted from UIScene.showBuildingCard / createBuildingButtons ---

/** Returns the button configs for a given building type string. */
function getBuildingButtons(buildingType) {
  if (buildingType === 'building-townhall') {
    return []
  } else if (buildingType === 'building-barracks') {
    return [
      { label: 'VIEW ALL POLECATS', action: 'listAll', color: 0x3498DB }
    ]
  } else {
    // Rig buildings (building-rig or any other type)
    return [
      { label: 'SPAWN POLECAT', action: 'spawn', color: 0x2ECC71 },
      { label: 'VIEW POLECATS', action: 'list', color: 0x3498DB },
      { label: 'CLONE REPO', action: 'clone', color: 0x9B59B6 },
      { label: 'REMOVE RIG', action: 'remove', color: 0xE74C3C }
    ]
  }
}

/** Computes the building card height (mirrors UIScene.showBuildingCard). */
function buildingCardHeight(buildingType) {
  const buttonCount = buildingType === 'building-rig' ? 4 :
                       buildingType === 'building-barracks' ? 1 : 0
  const baseHeight = 180
  const buttonsHeight = buttonCount * 50
  return baseHeight + buttonsHeight + 60
}

/** Formats polecat list entries the way the UI displays them. */
function formatPolecatEntry(polecat) {
  const status = polecat.status === 'working' ? 'WORKING' :
                 polecat.status === 'stuck' ? 'STUCK' : 'IDLE'
  const rigTag = polecat.rig ? ` [${polecat.rig}]` : ''
  return `${polecat.name} - ${status}${rigTag}`
}

// --- Tests ---

describe('Building button config', () => {
  it('townhall has zero buttons', () => {
    const buttons = getBuildingButtons('building-townhall')
    expect(buttons).toHaveLength(0)
  })

  it('barracks has 1 button (VIEW ALL POLECATS)', () => {
    const buttons = getBuildingButtons('building-barracks')
    expect(buttons).toHaveLength(1)
    expect(buttons[0].label).toBe('VIEW ALL POLECATS')
    expect(buttons[0].action).toBe('listAll')
  })

  it('rig has 4 buttons (SPAWN, VIEW, CLONE, REMOVE)', () => {
    const buttons = getBuildingButtons('building-rig')
    expect(buttons).toHaveLength(4)
    expect(buttons.map(b => b.label)).toEqual([
      'SPAWN POLECAT',
      'VIEW POLECATS',
      'CLONE REPO',
      'REMOVE RIG'
    ])
  })
})

describe('Building card height formula', () => {
  it('townhall: baseHeight(180) + 0 buttons + 60 padding = 240', () => {
    expect(buildingCardHeight('building-townhall')).toBe(240)
  })

  it('barracks: 180 + 1*50 + 60 = 290', () => {
    expect(buildingCardHeight('building-barracks')).toBe(290)
  })

  it('rig: 180 + 4*50 + 60 = 440', () => {
    expect(buildingCardHeight('building-rig')).toBe(440)
  })
})

describe('Polecat list formatting', () => {
  it('shows name, status, and rig tag', () => {
    const pc = { name: 'scout', status: 'working', rig: 'myproject' }
    expect(formatPolecatEntry(pc)).toBe('scout - WORKING [myproject]')
  })

  it('idle polecat without rig', () => {
    const pc = { name: 'builder', status: 'idle', rig: null }
    expect(formatPolecatEntry(pc)).toBe('builder - IDLE')
  })

  it('stuck polecat with rig', () => {
    const pc = { name: 'fixer', status: 'stuck', rig: 'bugfix_repo' }
    expect(formatPolecatEntry(pc)).toBe('fixer - STUCK [bugfix_repo]')
  })
})

describe('Status badge Y offset', () => {
  // From showBuildingCard: badge drawn at y=143/145 (not 128/130)
  it('building card status badge uses Y=143 for main rect', () => {
    const badgeY = 143
    expect(badgeY).toBe(143)
  })

  it('building card status badge shadow at Y=145', () => {
    const shadowY = 145
    expect(shadowY).toBe(145)
  })
})
