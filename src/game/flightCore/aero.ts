import { MathUtils, Quaternion, Vector3 } from 'three'
import type { Quat, Vec3 } from '../state/WorldState'
import { simulationSpeed } from '../flight/speedLimits'
import type { CoreProfile } from './profile'

export const GRAVITY = 9.81
const DEG = Math.PI / 180

/** The air at one pose. Angles in degrees; they lose meaning near rest (confidence 2 → 10 m/s). */
export interface Air {
  airspeed: number
  /** Signed pitch-plane alpha, positive with the nose above the path. */
  alphaDeg: number
  /** Signed sideslip, positive with the path to the right of the nose. */
  betaDeg: number
  /** Unsigned nose–velocity angle. */
  incidenceDeg: number
  confidence: number
}

export function observeAir(orientation: Quat, velocity: Vec3): Air {
  const v = new Vector3().copy(velocity), airspeed = v.length()
  if (airspeed < 0.001) return { airspeed, alphaDeg: 0, betaDeg: 0, incidenceDeg: 0, confidence: 0 }
  const body = v.applyQuaternion(new Quaternion().copy(orientation).invert())
  return {
    airspeed,
    alphaDeg: Math.hypot(body.x, body.y) < 0.001 ? 0 : Math.atan2(-body.y, body.x) / DEG,
    betaDeg: Math.atan2(body.z, Math.hypot(body.x, body.y)) / DEG,
    incidenceDeg: Math.acos(MathUtils.clamp(body.x / airspeed, -1, 1)) / DEG,
    confidence: MathUtils.smoothstep(airspeed, 2, 10),
  }
}

/** Lift and drag per V² (m⁻¹): the scale at which CLmax lift is the G limit at corner speed. */
export const aeroScale = (p: CoreProfile) => p.gLimit * GRAVITY / (p.clMax * simulationSpeed(p.cornerSpeedKph) ** 2)

/*
Lift coefficient over the whole circle. Attached: slope clAlpha at zero, a smooth cap of clMax
at alphaCritDeg (a cubic with zero slope there). Past the stall it blends over 15° into a flat
plate, clPost·sin 2α, which is zero at 90° and reverses for a tail-first flow.
*/
export function liftCoefficient(alphaDeg: number, p: CoreProfile): number {
  const a = Math.abs(alphaDeg), sign = Math.sign(alphaDeg)
  const plate = p.clPost * Math.sin(2 * a * DEG)
  if (a <= p.alphaCritDeg) {
    const x = a / p.alphaCritDeg, s = MathUtils.clamp(p.clAlpha * p.alphaCritDeg * DEG / p.clMax, 1, 3)
    return sign * p.clMax * (s * x + (3 - 2 * s) * x * x + (s - 2) * x * x * x)
  }
  return sign * MathUtils.lerp(p.clMax, plate, MathUtils.smoothstep(a, p.alphaCritDeg, p.alphaCritDeg + 15))
}

/** dCL/dα per radian at alpha, never below a fifth of clAlpha (it feeds the G limit's divisor). */
export function liftSlope(alphaDeg: number, p: CoreProfile): number {
  const h = 0.5
  return Math.max((liftCoefficient(alphaDeg + h, p) - liftCoefficient(alphaDeg - h, p)) / (2 * h * DEG), 0.2 * p.clAlpha)
}

/** The lift and side directions at a pose: unit vectors normal to the path, from the body's up
 * and right. Either may be zero where it has no meaning (the path along that body axis). */
export function flowAxes(up: Vector3, right: Vector3, path: Vector3) {
  const lift = up.clone().addScaledVector(path, -up.dot(path))
  if (lift.lengthSq() > 1e-10) lift.normalize(); else lift.set(0, 0, 0)
  const side = right.clone().addScaledVector(path, -right.dot(path)).addScaledVector(lift, -right.dot(lift))
  if (side.lengthSq() > 1e-10) side.normalize(); else side.set(0, 0, 0)
  return { lift, side }
}
