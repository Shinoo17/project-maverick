import { MathUtils } from 'three'
import type { AirflowState } from './airflow'
export { angleOfAttack } from './airflow'
import type { StallProfile } from './profileTypes'
import type { AircraftState } from '../state/WorldState'
import { arcadeSpeed } from './speedLimits'

export type StallCause = 'none' | 'speed' | 'aoa' | 'speed+aoa'
export interface StallState {
  /** Continuous separation memory: 0 = attached, 1 = fully separated. */
  severity: number
  /** Presentation only. Never used to select physics or smoothing rates. */
  cause: StallCause
  /** Signed pitch-plane alpha sampled at the START of the flight step, in degrees. */
  aoaDeg: number
}
export const createStallState = (): StallState => ({ severity: 0, cause: 'none', aoaDeg: 0 })

/** Continuous airflow/low-speed separation target, independent of labels/input.
 * The old pitch-alpha/speed pairs describe smooth bands; memory is time smoothing.
 * Keep pitch alpha separate from the unsigned-incidence highAoa envelope (Rev. 3 M4).
 * Low-speed loss of lift/control is retained without inventing aerodynamic force at q=0.
 */
export function separationTarget(flow: AirflowState, profile: StallProfile) {
  const lowSpeed = 1 - MathUtils.smoothstep(arcadeSpeed(flow.airspeed), profile.stallSpeedKph, profile.separationAttachedSpeedKph)
  const alpha = MathUtils.smoothstep(Math.abs(flow.alphaDeg), profile.separationAttachedAoaDeg, profile.criticalAoaDeg) * flow.confidence
  return { lowSpeed, alpha, target: Math.max(lowSpeed, alpha) }
}

export function stepStall(state: AircraftState, profile: StallProfile, flow: AirflowState, dt: number) {
  if (dt <= 0 || !state.alive) return
  const stall = state.stall
  const { lowSpeed, alpha, target } = separationTarget(flow, profile)
  stall.aoaDeg = flow.alphaDeg
  const seconds = target > stall.severity ? profile.separationEntrySeconds : profile.separationRecoverySeconds
  stall.severity += (target - stall.severity) * (1 - Math.exp(-dt / seconds))
  // Labels observe the continuous factors, never feed the solver.
  stall.cause = lowSpeed > 0 && alpha > 0 ? 'speed+aoa' : lowSpeed > 0 ? 'speed' : alpha > 0 ? 'aoa' : 'none'
}
