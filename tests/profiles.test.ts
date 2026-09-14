import { describe, expect, it } from 'vitest'
import { aircraft } from '../src/content/aircraft'
import type { AircraftDefinition } from '../src/content/schemas'
import { validateAircraft, validateSession } from '../src/content/validate'
import { availableWeapons, fullArmament, weaponStations } from '../src/content/weapons'
import { flightProfiles, getFlightProfile, validateFlightProfile } from '../src/game/flight/profile'
import { GameRuntime } from '../src/game/runtime/GameRuntime'
import { neutralCommand } from '../src/game/runtime/commands'
import { runFlightReplay } from '../src/game/playground/replay'
import { parseSettings } from '../src/platform/storage'
import { getExhaustProfile } from '../src/render/exhaust/profile'
import { getVaporProfile } from '../src/render/vapor/profile'

describe('aircraft profiles', () => {
  it('flies an added aircraft through existing profiles without name-based behavior', () => {
    const extra: AircraftDefinition = { ...aircraft[1], id: 'future-airframe', designation: 'Test aircraft' }
    const registry = aircraft as AircraftDefinition[]
    registry.push(extra)
    try {
      validateAircraft(registry)
      const runtime = new GameRuntime({ mode: 'playground', aircraftIds: ['su57', extra.id] })
      runtime.start()
      for (let tick = 0; tick < 90; tick++) runtime.advance(1 / 60, (tick, id) => ({ ...neutralCommand(tick, id), pitch: .3, roll: .2, speedAdjust: 1 }))
      const [original, added] = runtime.snapshot().aircraft
      expect(added.velocity).toEqual(original.velocity)
      expect(added.orientation).toEqual(original.orientation)
      expect(added.position.x - original.position.x).toBeCloseTo(40)
      expect(getExhaustProfile(extra.id)).toEqual(getExhaustProfile('su57'))
      expect(getVaporProfile(extra.id)).toEqual(getVaporProfile('su57'))
      expect(availableWeapons(extra)).toEqual(availableWeapons(aircraft[1]))
    } finally { registry.pop() }
  })
  it('uses different flight tuning for different aircraft', () => {
    const runtime = new GameRuntime({ mode: 'playground', aircraftIds: ['f22', 'su57'] })
    runtime.start()
    for (let tick = 0; tick < 120; tick++) runtime.advance(1 / 60, (tick, id) => ({ ...neutralCommand(tick, id), speedAdjust: 1 }))
    const [f22, su57] = runtime.snapshot().aircraft
    expect(f22.velocity.x).toBeGreaterThan(su57.velocity.x)
    expect(getFlightProfile('su57').maneuver.yawRate).toBeGreaterThan(getFlightProfile('f22').maneuver.yawRate)
  })
  it('disables PSM through capability data', () => {
    const profile = flightProfiles['felon-agility'], previous = profile.maneuver
    profile.maneuver = { ...previous, psmEnabled: false }
    try {
      const runtime = new GameRuntime({ mode: 'playground', aircraftIds: ['su57'] })
      runtime.reset('cobra'); runtime.start()
      runtime.advance(1 / 60, (tick, id) => ({ ...neutralCommand(tick, id), psmArm: true, pitch: 1 }))
      expect(runtime.snapshot().aircraft[0].maneuver.phase).toBe('normal')
      expect(runtime.snapshot().aircraft[0].maneuver.blocked).toBe('unsupported')
    } finally { profile.maneuver = previous }
  })
  it('rejects broken profile references and nonfinite tuning', () => {
    expect(() => validateAircraft([{ ...aircraft[0], flightProfileId: 'missing' } as unknown as AircraftDefinition])).toThrow('flightProfileId')
    const profile = structuredClone(getFlightProfile('f22'))
    profile.flight.acceleration = NaN
    expect(() => validateFlightProfile(profile)).toThrow('flightProfile.flight.acceleration')
  })
})

describe('full aircraft armament', () => {
  it('fills every supported station for every aircraft, including guns and radar missiles', () => {
    expect(fullArmament(aircraft[0])).toEqual([
      { stationId: 'gun', weaponId: 'm61a2', count: 1 },
      { stationId: 'side-bays', weaponId: 'aim9', count: 2 },
      { stationId: 'main-bays', weaponId: 'aim120', count: 6 },
    ])
    expect(fullArmament(aircraft[1])).toEqual([
      { stationId: 'gun', weaponId: 'su57-cannon', count: 1 },
      { stationId: 'short-range', weaponId: 'training-ir', count: 2 },
      { stationId: 'medium-range', weaponId: 'training-radar', count: 4 },
    ])
    for (const definition of aircraft) {
      const runtime = new GameRuntime({ mode: 'playground', aircraftIds: [definition.id] })
      expect(runtime.snapshot().aircraft[0].stores).toEqual(fullArmament(definition))
    }
  })
  it('rejects unknown weapons, repeated stations and invalid capacities', () => {
    const original = weaponStations.f22
    try {
      for (const capacity of [0, -1, 1.5, Infinity]) {
        weaponStations.f22 = [{ ...original[0], capacity }]
        expect(() => validateAircraft([aircraft[0]])).toThrow('stations.capacity')
      }
      weaponStations.f22 = [{ ...original[0], weaponId: 'missing' }]
      expect(() => validateAircraft([aircraft[0]])).toThrow('weaponId')
      weaponStations.f22 = [original[0], original[0]]
      expect(() => validateAircraft([aircraft[0]])).toThrow('stations.id')
      expect(() => validateSession({ mode: 'playground', aircraftIds: ['missing'] })).toThrow('session.aircraftIds')
    } finally { weaponStations.f22 = original }
  })
  it('keeps inventories independent across aircraft, snapshots and resets', () => {
    const runtime = new GameRuntime({ mode: 'playground', aircraftIds: ['f22', 'f22', 'su57'] })
    const snapshot = runtime.snapshot()
    expect(snapshot.aircraft.map(state => state.stores.map(store => store.count))).toEqual([[1, 2, 6], [1, 2, 6], [1, 2, 4]])
    snapshot.aircraft[0].stores[0].count = 99
    expect(snapshot.aircraft[1].stores[0].count).toBe(1)
    expect(runtime.snapshot().aircraft[0].stores[0].count).toBe(1)
    const armament = fullArmament(aircraft[0]); armament[0].count = 0
    expect(fullArmament(aircraft[0])[0].count).toBe(1)
    runtime.reset()
    expect(runtime.snapshot().aircraft.map(state => state.stores.map(store => store.count))).toEqual([[1, 2, 6], [1, 2, 6], [1, 2, 4]])
  })
  it('ignores retired preset fields in settings and sessions and exports clean replays', () => {
    const settings = parseSettings(JSON.stringify({ version: 1, aircraftId: 'su57', locale: 'en', loadoutByAircraft: { f22: 'f22-guns', su57: 'su57-guns' } }))
    expect(settings).toEqual({ version: 1, aircraftId: 'su57', locale: 'en' })
    const config = { mode: 'playground' as const, aircraftIds: ['su57'], loadoutIds: ['su57-guns'] }
    const runtime = new GameRuntime(config)
    expect(runtime.snapshot().aircraft[0].stores).toEqual(fullArmament(aircraft[1]))
    expect(runtime.snapshot().aircraft[0]).not.toHaveProperty('loadoutId')
    runtime.start(); runtime.advance(1 / 60)
    const replay = runtime.exportReplay()
    expect(replay.config).not.toHaveProperty('loadoutIds')
    expect(runFlightReplay(replay)).toEqual(runtime.snapshot())
    const legacyReplay = { ...replay, config }
    expect(runFlightReplay(legacyReplay)).toEqual(runtime.snapshot())
  })
})
