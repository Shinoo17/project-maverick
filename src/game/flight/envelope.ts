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

/** Continuous observations plus Phase 3 debug limiter permission. Legacy path
 * recovery weights remain until Phase 4/5; none of these fields grant authority. */
export function interpretEnvelope(
  state: Pick<AircraftState, 'stall' | 'maneuver' | 'limiterOpen'>,
  airflow: AirflowState,
  profile: AircraftFlightProfile,
): EnvelopeFactors {
  const { stall, maneuver } = state
  return {
    highAoa: MathUtils.smoothstep(airflow.incidenceDeg, profile.aero.alphaNormalDeg, profile.aero.alphaCriticalDeg) * airflow.confidence,
    separation: stall.severity,
    intent: 0,
    limiterOpen: state.limiterOpen,
    alphaLimitDeg: profile.aero.alphaNormalDeg + (profile.aero.maxControllableAlphaDeg - profile.aero.alphaNormalDeg) * state.limiterOpen,
    gAllowance: 1 + maneuver.highG * 0.6,
    stabilityAssist: 1 - maneuver.blend,
    recoveryAssist: maneuver.phase === 'recovery' ? 1 - maneuver.blend : 0,
  }
}
