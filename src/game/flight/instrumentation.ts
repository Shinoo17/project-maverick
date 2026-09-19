import type { AircraftState } from '../state/WorldState'
import { getFlightProfile } from './profile'
import { observeAirflow } from './airflow'
import { interpretEnvelope } from './envelope'
import { clamp, dryThrustLimit } from './speed'
import { tvcCapacity } from './thrustVectoring'

/** End-of-step observation. Never writes state or supplies flight authority.
 * Angles at zero speed are reported as zero; beta is signed toward body +Z.
 * Legacy ceilings are before turn-budget / High-G scaling, in rad/s. They are
 * NOT the physical aero / TVC / floor allocation proposed for Phase 3.
 */
export function flightInstrumentation(state: AircraftState) {
  const p = getFlightProfile(state.aircraftId)
  const airflow = observeAirflow(state, p)
  const { airspeed, alphaDeg, betaDeg, incidenceDeg } = airflow
  const actualThrust = state.enginePower * dryThrustLimit(p.flight, state.speedLimits)
  const surfaceControl = 1 - state.stall.severity * (1 - p.stall.controlAuthority)
  const poweredBlend = state.maneuver.blend * state.maneuver.controlAuthority
  const surface = clamp(p.aero.highSpeedMps / Math.max(airspeed, 1), 0.6, 1) * surfaceControl * (1 - poweredBlend)
  const rates = (pitch: number, yaw: number, roll: number, factor: number) => ({ pitch: pitch * factor, yaw: yaw * factor, roll: roll * factor })
  const surfaceRates = (factor: number) => rates(p.flight.pitchRate, p.flight.yawRate, p.flight.rollRate, factor * surface)
  return {
    airspeed,
    alphaDeg, betaDeg, incidenceDeg,
    dynamicPressureProxy: airflow.dynamicPressure,
    airflow,
    lastStep: state.flightForces ?? null,
    envelope: interpretEnvelope(state, airflow, p),
    actualThrust,
    tvcCapacity: tvcCapacity(p.thrustVectoring, actualThrust),
    legacy: {
      aeroRate: surfaceRates(Math.min(airspeed / p.aero.referenceSpeedMps, 1)),
      floorRate: surfaceRates(Math.max(0, 0.12 - airspeed / p.aero.referenceSpeedMps)),
      poweredRate: rates(p.maneuver.pitchRate, p.maneuver.yawRate, p.maneuver.rollRate, poweredBlend),
      surfaceControl, poweredBlend,
      separationProxy: state.stall.severity,
      limiterProxy: state.maneuver.blend,
    },
  }
}
