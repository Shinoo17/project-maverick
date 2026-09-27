import { describe, expect, it } from 'vitest'
import { getAircraft } from '../src/content/aircraft'
import { firstOperation } from '../src/content/campaign/firstOperation'
import { missionStatus, nextMission } from '../src/content/campaign/missionStatus'
import type { MissionDefinition, OperationDefinition } from '../src/content/campaign/types'
import { validateOperation } from '../src/content/campaign/validateOperation'
import { canPlayPve, getMap, pveMaps } from '../src/content/maps'
import { performanceBars, statRanges, toPercent } from '../src/features/hangar/performance'
import { flightProfiles } from '../src/game/flight/profile'
import { completedMissions, parseCampaignProgress } from '../src/platform/campaignProgress'
import { defaultPveSetup, parsePveSetup, parseSettings } from '../src/platform/storage'

const mission = (id: string, requires: string[] = [], extra: Partial<MissionDefinition> = {}): MissionDefinition => ({
  ...firstOperation.missions[0], id, code: id.toUpperCase(), requires, availability: 'ready', ...extra,
})
const operation = (missions: MissionDefinition[]): OperationDefinition => ({ id: 'test-op', name: { en: 'Test', th: 'ทดสอบ' }, missions })

describe('campaign mission status', () => {
  it('checks PLANNED first, then COMPLETE, AVAILABLE and LOCKED', () => {
    const done = new Set(['a'])
    expect(missionStatus(mission('a', [], { availability: 'planned' }), done)).toBe('planned')
    expect(missionStatus(mission('a'), done)).toBe('complete')
    expect(missionStatus(mission('b', ['a']), done)).toBe('available')
    expect(missionStatus(mission('c', ['a', 'b']), done)).toBe('locked')
  })
  it('starts the mock operation with only M01 available', () => {
    const none = new Set<string>()
    const statuses = firstOperation.missions.map(item => [item.code, missionStatus(item, none)])
    expect(statuses).toEqual([['M01', 'available'], ['M02', 'planned'], ['M03', 'planned'], ['M04', 'planned'], ['M05', 'planned'], ['M06', 'locked']])
    expect(nextMission(firstOperation.missions, none)?.code).toBe('M01')
  })
})

describe('campaign content validation', () => {
  it('accepts the mock operation', () => {
    expect(() => validateOperation(firstOperation)).not.toThrow()
  })
  it('rejects unknown requires, cycles, missing start missions and unknown maps', () => {
    expect(() => validateOperation(operation([mission('a'), mission('b', ['missing'])]))).toThrow('unknown mission "missing"')
    expect(() => validateOperation(operation([mission('a'), mission('b', ['c']), mission('c', ['b'])]))).toThrow('cycle')
    expect(() => validateOperation(operation([mission('a', ['b']), mission('b', ['a'])]))).toThrow('starting mission')
    expect(() => validateOperation(operation([mission('a', [], { mapId: 'nowhere' })]))).toThrow('unknown map')
    expect(() => validateOperation(operation([mission('a'), mission('a')]))).toThrow('duplicate')
  })
})

describe('campaign progress storage', () => {
  it('returns empty progress for broken or foreign data', () => {
    for (const raw of [null, '{', '[]', '{"schemaVersion":2,"operations":{}}', '{"schemaVersion":1,"operations":[]}']) {
      expect(parseCampaignProgress(raw)).toEqual({ schemaVersion: 1, operations: {} })
    }
  })
  it('keeps well-formed entries and drops broken ones', () => {
    const progress = parseCampaignProgress(JSON.stringify({ schemaVersion: 1, operations: {
      'op-first-light': { completed: { 'm01-border-patrol': { firstClearedAt: '2026-09-27T10:00:00Z' }, broken: { firstClearedAt: 5 } } },
      junk: 'x',
    } }))
    expect([...completedMissions(progress, 'op-first-light')]).toEqual(['m01-border-patrol'])
    expect(progress.operations).not.toHaveProperty('junk')
  })
})

describe('menu settings', () => {
  it('falls back per field for a broken PVE setup', () => {
    expect(parsePveSetup('nope')).toEqual(defaultPveSetup)
    expect(parsePveSetup({ modeId: 'ffa', mapId: 'moon', teamSize: 9, difficulty: 'insane', allyAircraft: ['xyz'], enemyAircraft: ['f22'] }))
      .toEqual({ ...defaultPveSetup, enemyAircraft: ['f22', defaultPveSetup.enemyAircraft[1]] })
    // Campaign-only maps are not PVE maps.
    expect(parsePveSetup({ mapId: 'open-sea' }).mapId).toBe('flat-range')
  })
  it('reads the selected mode and callsign with safe defaults', () => {
    const stored = parseSettings(JSON.stringify({ version: 1, selectedMode: 'campaign', callsign: '  GHOST 2-1  ', pveSetup: { modeId: 'ctf', teamSize: 2 } }))
    expect(stored.selectedMode).toBe('campaign')
    expect(stored.callsign).toBe('GHOST 2-1')
    expect(stored.pveSetup).toMatchObject({ modeId: 'ctf', teamSize: 2, mapId: 'flat-range' })
    const junk = parseSettings(JSON.stringify({ version: 1, selectedMode: 'duel', callsign: 42 }))
    expect(junk.selectedMode).toBe('pve')
    expect(junk.callsign).toBe('VIPER 1-1')
  })
})

describe('PVE maps', () => {
  it('lists three maps; only the Flat Training Range can start, and only for TDM', () => {
    expect(pveMaps.map(map => map.id)).toEqual(['flat-range', 'mountains', 'coastal'])
    expect(canPlayPve(getMap('flat-range'), 'tdm')).toBe(true)
    expect(canPlayPve(getMap('flat-range'), 'control-point')).toBe(false)
    expect(canPlayPve(getMap('mountains'), 'tdm')).toBe(false)
  })
})

describe('hangar performance bars', () => {
  it('maps values onto 0–100 and clamps them', () => {
    expect(toPercent(900, statRanges.speed)).toBe(0)
    expect(toPercent(1250, statRanges.speed)).toBe(50)
    expect(toPercent(5000, statRanges.speed)).toBe(100)
  })
  it('follows the flight profile instead of fixed numbers', () => {
    const f22 = getAircraft('f22')
    const profile = flightProfiles[f22.flightProfileId]
    const before = performanceBars(f22).find(bar => bar.label === 'statAcceleration')!.value
    const original = profile.flight.acceleration
    try {
      profile.flight.acceleration = original + 3
      expect(performanceBars(f22).find(bar => bar.label === 'statAcceleration')!.value).toBe(before + 20)
    } finally { profile.flight.acceleration = original }
  })
  it('shows the Su-57 thrust vectoring as stronger post-stall than the F-22', () => {
    const postStall = (id: string) => performanceBars(getAircraft(id)).find(bar => bar.label === 'statPostStall')!.value
    expect(postStall('su57')).toBeGreaterThan(postStall('f22'))
  })
})
