/*
Target selection and the lock (doc 07, doc 12). The selected target is the lock: the HUD boxes
it, solves the gun for it and points a red arrow at it from the frame edge while it is off
screen; aim assist and bots use the same rules. Only what the radar paints can be locked
(radar.ts): inside the aircraft's radar cone and range.

- With no lock, the painted aircraft nearest the nose inside ACQUIRE_CONE is locked on its own.
- The next-target action (T) steps to the next painted aircraft by angle off the nose, wrapping.
  Locking another drops the old lock at once.
- A lock is kept while the target stays inside the radar cone and range. Outside them a timer
  runs, and the lock drops once it reaches `lockGraceSeconds`: turn the nose back before then
  and the lock holds. It drops at once when the target dies.

The radar cone stands in for "off screen": the lock lives in the simulation (replays, aim assist,
bots), and the screen belongs to the camera, which the simulation never sees.

The selected missile's seeker then locks on to the same target over time (seeker.ts).
*/
import type { AircraftState } from '../state/WorldState'
import { bearing, insideRadar, radarContacts, radarOf } from './radar'
import { createSeekerState, type SeekerState } from './seeker'

export { bearing } from './radar'

/** Provisional values, waiting on playtest. */
export const targetingRules = {
  acquireConeDeg: 30,
  lockGraceSeconds: 3,
} as const

export interface TargetingState {
  targetId: string | null
  /** Seconds the locked target has spent outside the radar cone or range. */
  outside: number
  /** The selected missile's lock-on to the same target (seeker.ts). */
  seeker: SeekerState
}
export const createTargetingState = (slot = 0): TargetingState => ({ targetId: null, outside: 0, seeker: createSeekerState(slot) })

/** Aircraft the shooter could lock: painted by its radar, nearest the nose first. */
export function candidates(shooter: AircraftState, aircraft: readonly AircraftState[]) {
  return radarContacts(shooter, aircraft, null).filter(contact => contact.painted)
}

/** One tick of selection for `shooter`. `next` is true when the pilot pressed next-target this tick. */
export function stepTargeting(shooter: AircraftState, aircraft: readonly AircraftState[], next: boolean, dt: number) {
  const state = shooter.targeting
  const current = aircraft.find(entity => entity.id === state.targetId && entity.alive)
  if (current) {
    const { angle, range } = bearing(shooter, current)
    state.outside = insideRadar(radarOf(shooter.aircraftId), angle, range) ? 0 : state.outside + dt
    // A hair under the grace: 180 ticks of 1/60 s sum to just below 3 s in floating point.
    if (state.outside >= targetingRules.lockGraceSeconds - 1e-9) drop(state)
  } else drop(state)
  const options = candidates(shooter, aircraft)
  if (next && options.length > 0) {
    const index = options.findIndex(option => option.entity.id === state.targetId)
    state.targetId = options[(index + 1) % options.length].entity.id
    state.outside = 0
  } else if (state.targetId === null) {
    const nearest = options.find(option => option.angle <= targetingRules.acquireConeDeg)
    if (nearest) state.targetId = nearest.entity.id
  }
}
function drop(state: TargetingState) { state.targetId = null; state.outside = 0 }
