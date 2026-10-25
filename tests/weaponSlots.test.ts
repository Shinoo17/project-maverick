import { describe, expect, it } from 'vitest'
import { getAircraft } from '../src/content/aircraft'
import { gunStation, missileStations } from '../src/content/weapons'
import { startBurst } from '../src/game/combat/countermeasures'
import { WORLD_STEP } from '../src/game/runtime/clock'
import { GameRuntime } from '../src/game/runtime/GameRuntime'
import type { AircraftState } from '../src/game/state/WorldState'
import { pressedSlot, weaponSlots, type MissileRow } from '../src/features/flight/weaponSlots'

const jet = (): AircraftState => new GameRuntime({ mode: 'playground', aircraftIds: ['f22'] }).snapshot().aircraft[0]
const byId = (state: AircraftState | null, tick?: number, missiles?: MissileRow[]) => Object.fromEntries(weaponSlots('f22', state, tick, missiles).map(slot => [slot.id, slot]))
const gunId = gunStation(getAircraft('f22')).station.id
const [ir, radar] = missileStations(getAircraft('f22')).map(row => row.station.id)

describe('weapon slots', () => {
  it('lists the gun, the missiles short range first, then the dispensers, by station id', () => {
    const slots = weaponSlots('f22', jet(), 0)
    expect(slots.map(slot => slot.id)).toEqual([gunId, ir, radar, 'countermeasures'])
    expect(slots.map(slot => slot.kind)).toEqual(['gun', 'ir', 'radar', 'countermeasure'])
    expect(slots.map(slot => slot.select)).toEqual([null, 'selectMissile1', 'selectMissile2', null])
  })

  it('reads full and live without a state', () => {
    for (const slot of weaponSlots('f22', null)) {
      expect(slot.count).toBe(slot.capacity)
      expect(slot.blocked).toBeNull()
    }
  })

  it('refuses only the selected missile for a wait or a missing lock', () => {
    const state = jet()
    expect(byId(state, 0)[ir].blocked).toBe('nolock')
    expect(byId(state, 0)[radar].blocked).toBeNull()
    state.targeting.seeker.locked = true
    expect(byId(state, 0)[ir].blocked).toBeNull()
    state.launchReadyTick = 30
    expect(byId(state, 10)[ir].blocked).toBe('wait')
    expect(byId(state, 10)[radar].blocked).toBeNull()
    state.targeting.seeker.slot = 1
    expect(byId(state, 10)[ir].blocked).toBeNull()
    expect(byId(state, 10)[radar].blocked).toBe('wait')
  })

  it('marks an empty missile empty whether or not it is selected', () => {
    const state = jet()
    state.stores = state.stores.map(store => store.stationId === radar ? { ...store, count: 0 } : store)
    expect(byId(state, 0)[radar]).toMatchObject({ count: 0, blocked: 'empty', selected: false })
    state.targeting.seeker.slot = 1
    expect(byId(state, 0)[radar]).toMatchObject({ blocked: 'empty', selected: true })
  })

  it('gives the gun its heat and the dispensers their own wait', () => {
    const state = jet()
    state.gun.heat = 0.9; state.gun.overheated = true
    expect(byId(state, 0)[gunId]).toMatchObject({ heat: 'overheat', blocked: 'wait', fill: 0.9 })
    expect(startBurst(state.countermeasures, 100, WORLD_STEP)).toBe(true)
    const waiting = byId(state, 100).countermeasures
    expect(waiting.blocked).toBe('wait')
    expect(waiting.fill).toBeGreaterThan(0.9)
    const ready = Math.ceil(state.countermeasures.readyTick)
    expect(byId(state, ready).countermeasures).toMatchObject({ blocked: null, fill: 0 })
    state.countermeasures.bursts = 0
    expect(byId(state, ready).countermeasures.blocked).toBe('empty')
  })

  it('carries one to four missile slots, each with its own select key', () => {
    const own = missileStations(getAircraft('f22'))
    const four = [0, 1, 2, 3].map(index => index < own.length ? own[index] : { ...own[index % own.length], station: { ...own[index % own.length].station, id: `extra-${index}` } })
    const slots = weaponSlots('f22', null, undefined, four).filter(slot => slot.fire === 'fireMissile')
    expect(slots.map(slot => slot.select)).toEqual(['selectMissile1', 'selectMissile2', 'selectMissile3', 'selectMissile4'])
    expect(new Set(slots.map(slot => slot.id)).size).toBe(4)
    expect(weaponSlots('f22', null, undefined, [own[0]]).filter(slot => slot.fire === 'fireMissile')).toHaveLength(1)
  })

  it('finds the slot a press fires: the gun, the selected missile, the dispensers', () => {
    const state = jet()
    state.targeting.seeker.slot = 1
    const slots = weaponSlots('f22', state, 0)
    expect(pressedSlot(slots, 'fireGun')?.id).toBe(gunId)
    expect(pressedSlot(slots, 'fireMissile')?.id).toBe(radar)
    expect(pressedSlot(slots, 'countermeasure')?.id).toBe('countermeasures')
    expect(pressedSlot(slots, 'nextTarget')).toBeNull()
  })
})
