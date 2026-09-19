import { MathUtils } from 'three'
import type { AircraftState } from '../state/WorldState'
import type { AircraftFlightProfile } from './profileTypes'
import type { AirflowState } from './airflow'

/** Continuous flow factors; intent/limiter/recovery remain legacy observations. */
export interface EnvelopeFactors {
  /** Unsigned incidence, including sideslip, interpreted using the aero band. */
  highAoa: number
  separation: number
  intent: number
  limiterOpen: number
  alphaLimitDeg: number
  gAllowance: number
  stabilityAssist: number
  recoveryAssist: number
}

/** Separation and highAoa feed Phase 2 aero/neutral damping.
 * Reuse separation memory in stall.severity and legacy maneuver blend instead of adding a
 * second simulation clock. Intent is inactive, and alphaLimitDeg reports the
 * aero's normal incidence threshold (no max-controllable-alpha capability exists yet).
 * Assist fields describe legacy blend weights, not available authority.
 */
export function interpretEnvelope(
  state: Pick<AircraftState, 'stall' | 'maneuver'>,
  airflow: AirflowState,
  profile: AircraftFlightProfile,
): EnvelopeFactors {
  const { stall, maneuver } = state
  return {
    highAoa: MathUtils.smoothstep(airflow.incidenceDeg, profile.aero.alphaNormalDeg, profile.aero.alphaCriticalDeg) * airflow.confidence,
    separation: stall.severity,
    intent: 0,
    limiterOpen: maneuver.blend,
    alphaLimitDeg: profile.aero.alphaNormalDeg,
    gAllowance: 1 + maneuver.highG * 0.6,
    stabilityAssist: 1 - maneuver.blend,
    recoveryAssist: maneuver.phase === 'recovery' ? 1 - maneuver.blend : 0,
  }
}
