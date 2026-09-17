import { Quaternion, Vector3 } from 'three'
import type { AircraftState } from '../state/WorldState'
import { getFlightProfile } from './profile'
import { angleOfAttack } from './stall'
import { clamp, dryThrustLimit } from './speed'
import { tvcCapacity } from './thrustVectoring'

/** End-of-step observation. Never writes state or supplies flight authority.
 * Angles at zero speed are reported as zero; beta is signed toward body +Z.
 * Legacy ceilings are before turn-budget / High-G scaling, in rad/s. They are
 * NOT the physical aero / TVC / floor allocation proposed for Phase 3.
 */
export function flightInstrumentation(state: AircraftState) {
  const p = getFlightProfile(state.aircraftId)
  const body = new Vector3().copy(state.velocity)
  const airspeed = body.length()
  body.applyQuaternion(new Quaternion().copy(state.orientation).invert())
  const actualThrust = state.enginePower * dryThrustLimit(p.flight, state.speedLimits)
  const surfaceControl = 1 - state.stall.severity * (1 - p.stall.controlAuthority)
  const poweredBlend = state.maneuver.blend * state.maneuver.controlAuthority
  const surface = clamp(160 / Math.max(airspeed, 1), 0.6, 1) * surfaceControl * (1 - poweredBlend)
  const rates = (pitch: number, yaw: number, roll: number, factor: number) => ({ pitch: pitch * factor, yaw: yaw * factor, roll: roll * factor })
  const surfaceRates = (factor: number) => rates(p.flight.pitchRate, p.flight.yawRate, p.flight.rollRate, factor * surface)
  return {
    airspeed,
    alphaDeg: angleOfAttack(state),
    betaDeg: airspeed < 0.001 ? 0 : Math.atan2(body.z, Math.hypot(body.x, body.y)) * 180 / Math.PI,
    incidenceDeg: airspeed < 0.001 ? 0 : Math.acos(clamp(body.x / airspeed, -1, 1)) * 180 / Math.PI,
    dynamicPressureProxy: (airspeed / 90) ** 2,
    actualThrust,
    tvcCapacity: tvcCapacity(p.thrustVectoring, actualThrust),
    legacy: {
      aeroRate: surfaceRates(Math.min(airspeed / 90, 1)),
      floorRate: surfaceRates(Math.max(0, 0.12 - airspeed / 90)),
      poweredRate: rates(p.maneuver.pitchRate, p.maneuver.yawRate, p.maneuver.rollRate, poweredBlend),
      surfaceControl, poweredBlend,
      separationProxy: state.stall.severity,
      limiterProxy: state.maneuver.blend,
    },
  }
}
