/*
Target selection for the gun (doc 07, doc 12). Selecting a target is not a lock: it only
tells the HUD which aircraft to box and to compute the gun solution for. Bots will use the
same rules.

- With no target, the aircraft nearest the nose inside ACQUIRE_CONE and ACQUIRE_RANGE is
  picked on its own.
- A selected target is kept while it is alive and within KEEP_RANGE. It is dropped once it
  has stayed outside KEEP_CONE for KEEP_GRACE_SECONDS, or at once when it dies.
- The next-target action (T) steps to the next candidate by angle off the nose, wrapping.

There are no teams yet, so every other live aircraft is a candidate. Friendly aircraft
must be left out here once teams exist (doc 07, IFF).
*/
import { Quaternion, Vector3 } from 'three'
import type { AircraftState } from '../state/WorldState'

/** Provisional values, waiting on playtest. The circle drone flies 3 km out, so acquire reaches past it. */
export const targetingRules = {
  acquireConeDeg: 30,
  acquireRange: 3500,
  keepConeDeg: 60,
  keepRange: 4500,
  keepGraceSeconds: 1,
} as const

export interface TargetingState {
  targetId: string | null
  /** Seconds the selected target has spent outside the keep cone. */
  outside: number
}
export const createTargetingState = (): TargetingState => ({ targetId: null, outside: 0 })

const nose = new Vector3(), toTarget = new Vector3(), turn = new Quaternion()
/** Angle off the nose in degrees and distance in metres, from `shooter` to `target`. */
export function bearing(shooter: AircraftState, target: AircraftState) {
  const { x, y, z, w } = shooter.orientation
  nose.set(1, 0, 0).applyQuaternion(turn.set(x, y, z, w))
  toTarget.set(target.position.x - shooter.position.x, target.position.y - shooter.position.y, target.position.z - shooter.position.z)
  const range = toTarget.length()
  const angle = range > 1e-6 ? nose.angleTo(toTarget) * 180 / Math.PI : 0
  return { angle, range }
}

/** Live aircraft the shooter could pick, nearest the nose first. */
export function candidates(shooter: AircraftState, aircraft: readonly AircraftState[]) {
  return aircraft
    .filter(entity => entity.id !== shooter.id && entity.alive)
    .map(entity => ({ entity, ...bearing(shooter, entity) }))
    .filter(({ angle, range }) => angle <= targetingRules.acquireConeDeg && range <= targetingRules.acquireRange)
    .sort((a, b) => a.angle - b.angle || (a.entity.id < b.entity.id ? -1 : 1))
}

/** One tick of selection for `shooter`. `next` is true when the pilot pressed next-target this tick. */
export function stepTargeting(shooter: AircraftState, aircraft: readonly AircraftState[], next: boolean, dt: number) {
  const state = shooter.targeting
  const current = aircraft.find(entity => entity.id === state.targetId && entity.alive)
  if (current) {
    const { angle, range } = bearing(shooter, current)
    state.outside = angle > targetingRules.keepConeDeg ? state.outside + dt : 0
    if (range > targetingRules.keepRange || state.outside >= targetingRules.keepGraceSeconds) drop(state)
  } else drop(state)
  const options = candidates(shooter, aircraft)
  if (next && options.length > 0) {
    const index = options.findIndex(option => option.entity.id === state.targetId)
    state.targetId = options[(index + 1) % options.length].entity.id
    state.outside = 0
  } else if (state.targetId === null && options.length > 0) state.targetId = options[0].entity.id
}
function drop(state: TargetingState) { state.targetId = null; state.outside = 0 }
