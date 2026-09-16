import { Quaternion, Vector3 } from 'three'
import type { AircraftState } from '../../game/state/WorldState'

const degrees = 180 / Math.PI
export const wrapHeading = (value: number) => (value % 360 + 360) % 360

export function flightWarning(state: AircraftState | null) {
  if (!state || !state.alive) return null
  if (Math.hypot(state.position.x, state.position.z) > 6500 || state.position.y > 6500) return 'boundaryWarning'
  if (state.position.y < 100) return 'lowAltitude'
  // High incidence is intentional during a manual PSM. Keep terrain warnings,
  // but give recovery advice only once the pilot releases the maneuver.
  if (state.maneuver.phase === 'active') return null
  if (state.stall.severity > 0.1) return state.stall.cause === 'none' ? 'hudStallRecovering' : 'hudStall'
  return Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z) < 60 ? 'hudLowEnergy' : null
}

// Range convention: +X is north, +Z east, +Y up. Read the nose, not velocity
// (the two deliberately separate in PSM). Positive bank means right wing down.
export function flightAttitude(orientation: AircraftState['orientation']) {
  const q = new Quaternion().copy(orientation).normalize()
  const nose = new Vector3(1, 0, 0).applyQuaternion(q)
  const up = new Vector3(0, 1, 0).applyQuaternion(q)
  const right = new Vector3(0, 0, 1).applyQuaternion(q)
  const horizontal = Math.hypot(nose.x, nose.z)
  return {
    pitch: Math.atan2(nose.y, horizontal) * degrees,
    // Heading and bank have no unique value when pointing exactly vertical.
    heading: horizontal < 1e-5 ? null : wrapHeading(Math.atan2(nose.z, nose.x) * degrees),
    bank: horizontal < 1e-5 ? null : Math.atan2(-right.y, up.y) * degrees,
  }
}

export function burnerStatus(state: AircraftState | null) {
  if (!state) return 'hudWaiting'
  const m = state.maneuver
  if (m.burnerActive) return 'hudBurnerActive'
  if (m.burnerLocked) return 'hudBurnerLocked'
  if (m.burner < 1 && m.burnerRest > 1) return 'recharging'
  return 'hudBurnerReady'
}
