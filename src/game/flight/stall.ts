import { Quaternion, Vector3 } from 'three'
import type { StallProfile } from './profileTypes'
import type { AircraftState } from '../state/WorldState'
import { arcadeSpeed } from './speedLimits'

export type StallCause = 'none' | 'speed' | 'aoa' | 'speed+aoa'
export interface StallState {
  /** 0 = normal, 1 = fully stalled. Remains nonzero while recovering. */
  severity: number
  /** Unmet thresholds; none with nonzero severity means recovery is underway. */
  cause: StallCause
  /** Signed incidence sampled at the start of the flight step, in degrees. */
  aoaDeg: number
}
export const createStallState = (): StallState => ({ severity: 0, cause: 'none', aoaDeg: 0 })

/** Body +X forward, +Y up. Sideways flow is not pitch AoA; reverse flow is ±180°. */
export function angleOfAttack(state: Pick<AircraftState, 'velocity' | 'orientation'>) {
  const bodyVelocity = new Vector3().copy(state.velocity)
    .applyQuaternion(new Quaternion().copy(state.orientation).invert())
  return Math.hypot(bodyVelocity.x, bodyVelocity.y) < 0.001
    ? 0 : Math.atan2(-bodyVelocity.y, bodyVelocity.x) * 180 / Math.PI || 0
}

/** Fixed-step, deterministic, no maneuver/aircraft-name special cases. */
export function stepStall(state: AircraftState, profile: StallProfile, speed: number, dt: number) {
  if (dt <= 0 || !state.alive) return
  const stall = state.stall
  stall.aoaDeg = angleOfAttack(state)
  const speedKph = arcadeSpeed(speed)
  const recovering = stall.severity > 0
  const lowSpeed = speedKph < (recovering ? profile.recoverySpeedKph : profile.stallSpeedKph)
  const highAoa = Math.abs(stall.aoaDeg) > (recovering ? profile.recoveryAoaDeg : profile.criticalAoaDeg)
  if (lowSpeed && highAoa) stall.cause = 'speed+aoa'
  else if (lowSpeed) stall.cause = 'speed'
  else if (highAoa) stall.cause = 'aoa'
  else stall.cause = 'none'
  stall.severity = stall.cause === 'none'
    ? Math.max(0, stall.severity - dt / profile.recoverySeconds)
    : Math.min(1, stall.severity + dt / profile.entrySeconds)
}
