/*
The weapons column as a list of slots, one per card (WeaponPanel.tsx): the gun, every missile
station in the seeker's selection order (1–4 of them), then the countermeasure dispensers.

Each slot carries its own state: what is left, how full its card is (gun heat, the dispensers'
wait), whether a press now would fire it and, if not, why. The panel draws it from telemetry;
FlightPage reads the same slots from the live world to decide which card a refused press belongs
to, so what the card shows and what the press does never disagree.
*/
import { getAircraft } from '../../content/aircraft'
import { gunStation, missileStations, type WeaponDefinition, type WeaponKind, type WeaponStation } from '../../content/weapons'
import { burstCooldown } from '../../game/combat/countermeasures'
import { missileSelectActions, type FlightAction } from '../../game/input/keyBindings'
import { WORLD_STEP } from '../../game/runtime/clock'
import type { AircraftState } from '../../game/state/WorldState'

// The warning band starts where a release locks the gun (GunProfile.lockHeat; 80% for every gun so far).
const HEAT_WARNING = 0.8

/** Why a press is refused: nothing left, a wait that will end (gun heat, launch interval,
 * dispensers between bursts), or no seeker lock. */
export type Refusal = 'empty' | 'wait' | 'nolock'
export type GunHeat = 'ready' | 'hot' | 'cooling' | 'overheat'
export type MissileRow = { station: WeaponStation; weapon: WeaponDefinition }

export interface WeaponSlot {
  /** Stable for the flight: the station id, or 'countermeasures'. */
  id: string
  kind: WeaponKind | 'countermeasure'
  /** The gun's and missiles' weapon; none for the dispensers. */
  weapon: WeaponDefinition | null
  /** Rounds, missiles or bursts left, and the most it holds. */
  count: number
  capacity: number
  /** The press that fires it. */
  fire: FlightAction
  /** Missiles: the one the seeker has selected. The gun and dispensers are always live. */
  selected: boolean
  /** The key that selects this missile; missiles in the first four slots only. */
  select: FlightAction | null
  /** Why a press now would be refused; null when it would fire. Only the selected missile can wait or lack a lock. */
  blocked: Refusal | null
  /** The share of the card filled: gun heat, or the dispensers' wait still to run. 0 for missiles. */
  fill: number
  /** Gun only: its heat state, and rounds fired so far (a rising count spins the barrels). */
  heat?: GunHeat
  shots?: number
}

/**
 * The column's slots for `state` on world `tick`. Without a state every station reads full and
 * live; without a tick nothing waits. `missiles` replaces the aircraft's own stations (preview).
 */
export function weaponSlots(aircraftId: string, state: AircraftState | null, tick?: number, missiles: readonly MissileRow[] = missileStations(getAircraft(aircraftId))): WeaponSlot[] {
  const definition = getAircraft(aircraftId)
  const count = (station: WeaponStation) => state ? state.stores.filter(store => store.stationId === station.id).reduce((sum, store) => sum + store.count, 0) : station.capacity

  const gun = gunStation(definition), g = state?.gun
  const heat: GunHeat = g?.overheated ? 'overheat' : g?.cooling ? 'cooling' : (g?.heat ?? 0) > HEAT_WARNING ? 'hot' : 'ready'
  const slots: WeaponSlot[] = [{
    id: gun.station.id, kind: 'gun', weapon: gun.weapon, count: count(gun.station), capacity: gun.station.capacity, fire: 'fireGun',
    selected: true, select: null, blocked: heat === 'overheat' || heat === 'cooling' ? 'wait' : null, fill: g?.heat ?? 0, heat, shots: g?.shots ?? 0,
  }]

  // The same checks, in the same order, as the runtime's launch (GameRuntime stepGuns): empty, the
  // aircraft-wide launch interval, then the lock. The seeker drops a lock on a dead target itself.
  const seeker = state?.targeting.seeker
  missiles.forEach((row, index) => {
    const left = count(row.station), selected = index === (seeker?.slot ?? 0)
    const blocked = left === 0 ? 'empty'
      : !selected || !state ? null
      : tick !== undefined && tick < state.launchReadyTick ? 'wait'
      : !seeker!.locked ? 'nolock' : null
    slots.push({
      id: row.station.id, kind: row.weapon.kind, weapon: row.weapon, count: left, capacity: row.station.capacity, fire: 'fireMissile',
      selected, select: missileSelectActions[index] ?? null, blocked, fill: 0,
    })
  })

  const bursts = state?.countermeasures.bursts ?? definition.countermeasures.bursts
  const wait = bursts > 0 && state && tick !== undefined ? burstCooldown(state.countermeasures, tick, WORLD_STEP) : 0
  slots.push({
    id: 'countermeasures', kind: 'countermeasure', weapon: null, count: bursts, capacity: definition.countermeasures.bursts, fire: 'countermeasure',
    selected: true, select: null, blocked: bursts === 0 ? 'empty' : wait > 0 ? 'wait' : null, fill: wait,
  })
  return slots
}

/** The slot a press of `action` would fire: the gun, the selected missile or the dispensers. */
export const pressedSlot = (slots: readonly WeaponSlot[], action: FlightAction) => slots.find(slot => slot.fire === action && slot.selected) ?? null
