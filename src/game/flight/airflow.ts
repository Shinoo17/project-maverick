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
  /** Phase 1 compatibility only. Preserve the old arithmetic and zero-speed
   * conventions until a deliberate physics change; new consumers use the fields above.
   * PSM used a normalized path above 0.01 m/s; telemetry used the raw velocity
   * (Vector3.angleTo returns 90° for a zero vector). These are not signed alpha.
   */
  legacy: { psmIncidenceRad: number; telemetryIncidenceDeg: number }
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

/** Exact legacy end-of-step geometry, including 90° for a zero velocity vector.
 * Reuse the integrator's existing vectors without allocating a full observation.
 * Retire with AirflowState.legacy in Phase 2; neither input is mutated.
 */
export function legacyTelemetryIncidenceDeg(forward: Vector3, velocity: Vector3) {
  return forward.angleTo(velocity) * 180 / Math.PI
}

/** Observe exactly the supplied pose. Call before integration for physics and
 * after integration for telemetry; never cache across those two boundaries.
 */
export function observeAirflow(state: FlowState, profile: Pick<AircraftFlightProfile, 'aero'>): AirflowState {
  const velocity = new Vector3().copy(state.velocity)
  const airspeed = velocity.length()
  const orientation = new Quaternion().copy(state.orientation)
  const forward = new Vector3(1, 0, 0).applyQuaternion(orientation)
  const body = velocity.clone().applyQuaternion(orientation.invert())
  const flow = airspeed < 0.001 ? 0 : MathUtils.clamp(body.x / airspeed, -1, 1)
  const legacyPath = airspeed > 0.01 ? velocity.clone().normalize() : forward.clone()
  return {
    airspeed,
    alphaDeg: pitchIncidence(body),
    betaDeg: airspeed < 0.001 ? 0 : Math.atan2(body.z, Math.hypot(body.x, body.y)) * 180 / Math.PI,
    incidenceDeg: airspeed < 0.001 ? 0 : Math.acos(flow) * 180 / Math.PI,
    dynamicPressure: (airspeed / profile.aero.referenceSpeedMps) ** 2,
    forwardFlow: Math.max(0, flow),
    reverseFlow: Math.max(0, -flow),
    confidence: MathUtils.smoothstep(airspeed, 2, 10),
    legacy: {
      psmIncidenceRad: forward.angleTo(legacyPath),
      telemetryIncidenceDeg: legacyTelemetryIncidenceDeg(forward, velocity),
    },
  }
}
