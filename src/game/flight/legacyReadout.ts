import type { AircraftState } from '../state/WorldState'
import type { BurnerStatus, FlightPose, FlightReadout } from './readout'
import { getFlightProfile } from './profile'
import { observeAirflow } from './airflow'
import { envelopeLabel, interpretEnvelope } from './envelope'
import { arcadeSpeed } from './speedLimits'

function burnerStatus(m: AircraftState['maneuver']): BurnerStatus {
  if (m.burnerActive) return 'engaged'
  if (m.burnerLocked) return 'depleted'
  if (m.burner < 1 && m.burnerRest > 1) return 'recharging'
  return 'ready'
}

/** The legacy core's readout: its stored step observations passed through, and the airflow and
 * envelope observed at the pose exactly as its consumers observed them before FR0. */
export function legacyReadout(state: AircraftState, pose?: FlightPose): FlightReadout {
  const profile = getFlightProfile(state.aircraftId), m = state.maneuver
  const orientation = pose?.orientation ?? state.orientation, velocity = pose?.velocity ?? state.velocity
  const airflow = observeAirflow({ orientation, velocity }, profile)
  const envelope = interpretEnvelope(state, airflow, profile)
  return {
    noseVelocityDeg: m.alpha, g: m.g, pathRateDeg: m.pathRate, power: state.enginePower,
    burner: { active: m.burnerActive, status: burnerStatus(m), reserve: m.burner, seconds: m.burner * profile.maneuver.burnerSeconds },
    airbrake: m.airbrake, psmAuthority: state.limiterOpen,
    nozzle: profile.thrustVectoring ? { left: state.thrustVectoring.left, right: state.thrustVectoring.right } : null,
    postStall: state.stall.severity,
    gAllowance: state.flightForces?.envelope.gAllowance ?? 1,
    airspeed: airflow.airspeed, hudSpeed: arcadeSpeed(Math.hypot(velocity.x, velocity.y, velocity.z)),
    alphaDeg: airflow.alphaDeg, betaDeg: airflow.betaDeg, incidenceDeg: airflow.incidenceDeg, angleConfidence: airflow.confidence,
    highAoa: envelope.highAoa, regime: envelopeLabel(envelope, state.intent.activity), alphaLimitDeg: envelope.alphaLimitDeg,
    alphaBandDeg: { normal: profile.aero.alphaNormalDeg, critical: profile.aero.alphaCriticalDeg, max: profile.aero.maxControllableAlphaDeg },
  }
}
