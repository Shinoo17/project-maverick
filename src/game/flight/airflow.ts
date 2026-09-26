import { MathUtils, Quaternion, Vector3 } from 'three'
import type { AircraftState } from '../state/WorldState'
import type { AircraftFlightProfile } from './profileTypes'

type FlowState = Pick<AircraftState, 'velocity' | 'orientation'>

/** Measured flow only. No control authority, gameplay gates or mutable memory. */
export interface AirflowState {
  airspeed: number
  alphaDeg: number
  betaDeg: number
  incidenceDeg: number
  /** Dimensionless normalized q = (airspeed / referenceSpeedMps)², unclamped.
   * Not pressure in Pa (½ρv²). Authority/energy coefficients must use this normalization.
   */
  dynamicPressure: number
  forwardFlow: number
  reverseFlow: number
  /** Angles lose meaning near rest: smoothstep from 2 to 10 m/s. */
  confidence: number

}

function pitchIncidence(body: Vector3) {
  return Math.hypot(body.x, body.y) < 0.001
    ? 0 : Math.atan2(-body.y, body.x) * 180 / Math.PI || 0
}

/** Compatibility API for existing callers; the signed-alpha formula lives here. */
export function angleOfAttack(state: FlowState) {
  return pitchIncidence(new Vector3().copy(state.velocity)
    .applyQuaternion(new Quaternion().copy(state.orientation).invert()))
}

/** Observe exactly the supplied pose. Call before integration for physics and
 * after integration for telemetry; never cache across those two boundaries.
 */
export function observeAirflow(state: FlowState, profile: Pick<AircraftFlightProfile, 'aero'>): AirflowState {
  const velocity = new Vector3().copy(state.velocity)
  const airspeed = velocity.length()
  const orientation = new Quaternion().copy(state.orientation)
  const body = velocity.clone().applyQuaternion(orientation.invert())
  const flow = airspeed < 0.001 ? 0 : MathUtils.clamp(body.x / airspeed, -1, 1)
  return {
    airspeed,
    alphaDeg: pitchIncidence(body),
    betaDeg: airspeed < 0.001 ? 0 : Math.atan2(body.z, Math.hypot(body.x, body.y)) * 180 / Math.PI,
    incidenceDeg: airspeed < 0.001 ? 0 : Math.acos(flow) * 180 / Math.PI,
    dynamicPressure: (airspeed / profile.aero.referenceSpeedMps) ** 2,
    forwardFlow: Math.max(0, flow),
    reverseFlow: Math.max(0, -flow),
    confidence: MathUtils.smoothstep(airspeed, 2, 10),
  }
}
