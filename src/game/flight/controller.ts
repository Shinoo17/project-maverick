import type { PilotCommand } from '../runtime/commands'
import type { AeroAxes, AircraftFlightProfile } from './profileTypes'
import type { AirflowState } from './airflow'
import type { EnvelopeFactors } from './envelope'
import { clamp } from './speed'

function turnRatePermission(speedAuthority: number, alphaLimitDeg: number, normalAlphaDeg: number, limiterOpen: number) {
  const incidencePermission = Math.sqrt(alphaLimitDeg / Math.max(normalAlphaDeg, 1))
  return speedAuthority + (incidencePermission - speedAuthority) * limiterOpen
}

/** Feedback against normal path support, before automatic or manual G permission.
 * Available path support falls continuously with q/separation. This is a rate
 * limit observation, not an engine/TVC capability read by PilotIntent. */
export function measureControlDemand(command: PilotCommand, flow: AirflowState, separation: number, profile: AircraftFlightProfile, limiterOpen = 0) {
  const p = profile.flight
  const speedAuthority = Math.min(flow.airspeed / profile.aero.referenceSpeedMps, 1) * clamp(profile.aero.highSpeedMps / Math.max(flow.airspeed, 1), 0.6, 1)
  const normalLimit = p.turnAcceleration * speedAuthority
  const lift = Math.min(1, flow.dynamicPressure) * flow.confidence
  const surfaceControl = lift * (1 - separation * (1 - profile.stall.controlAuthority))
  const closedTurnBudget = normalLimit * surfaceControl / Math.max(flow.airspeed, 1) * p.turnRateReserve
  // In stepFlight this is the preceding substep's limiter, deliberately observed
  // before stepEnvelope updates it to avoid circular saturation feedback.
  // G uses this feedback; low-energy breakout is independent of saturation.
  const alphaLimit = profile.aero.alphaNormalDeg + (profile.aero.maxControllableAlphaDeg - profile.aero.alphaNormalDeg) * limiterOpen
  const ratePermission = turnRatePermission(speedAuthority, alphaLimit, profile.aero.alphaNormalDeg, limiterOpen)
  const requestedTurn = Math.hypot(command.pitch * p.pitchRate, command.yaw * p.yawRate) * ratePermission
  return { speedAuthority, normalLimit, lift, surfaceControl, closedTurnBudget,
    saturationRatio: requestedTurn / Math.max(closedTurnBudget, 1e-9) }
}

/** Body-axis drive requests and dissipative smoothing. No nozzle state/geometry;
 * every positive drive goes through allocation. G and AoA are permission only.
 * Demand must be measured before stepping the limiter (one-substep feedback lag). */
export function requestControl(command: PilotCommand, rates: AeroAxes, flow: AirflowState,
  envelope: EnvelopeFactors, profile: AircraftFlightProfile, dt: number,
  demand: ReturnType<typeof measureControlDemand>) {
  const p = profile.flight
  const { speedAuthority } = demand
  const normalLimit = demand.normalLimit * envelope.gAllowance
  const closedTurnBudget = demand.closedTurnBudget * envelope.gAllowance
  const highG = envelope.hardTurnBlend
  const ratePermission = turnRatePermission(speedAuthority, envelope.alphaLimitDeg, profile.aero.alphaNormalDeg, envelope.limiterOpen)
  const target = { pitch: command.pitch * p.pitchRate * ratePermission * (1 + highG * (profile.maneuver.highGRate - 1)),
    yaw: command.yaw * p.yawRate * ratePermission * (1 + highG * 0.4),
    roll: command.roll * p.rollRate * (speedAuthority + (1 - speedAuthority) * envelope.limiterOpen) }
  const requestedTurn = Math.hypot(command.pitch * p.pitchRate * speedAuthority, command.yaw * p.yawRate * speedAuthority)
  const closedScale = requestedTurn > 0 ? Math.min(1, closedTurnBudget / requestedTurn) : 1
  const permission = closedScale + (1 - closedScale) * envelope.limiterOpen
  target.pitch *= permission; target.yaw *= permission
  // Low-speed intent remains usable with a closed limiter. This request tuning
  // is independent of the floor budget; allocation may leave it unmet.
  for (const axis of ['pitch', 'yaw', 'roll'] as const) {
    const input = command[axis]
    if (Math.abs(target[axis]) < Math.abs(input) * p.minRateTarget[axis]) target[axis] = input * p.minRateTarget[axis]
  }
  const limited = restrictIncidence(target, flow, envelope.alphaLimitDeg, dt)
  target.pitch = limited.pitch; target.yaw = limited.yaw
  const request = { pitch: 0, yaw: 0, roll: 0 }, servoDamping = { ...request }
  for (const axis of ['pitch', 'yaw', 'roll'] as const) {
    if (command[axis] === 0) {
      const response = (axis === 'roll' ? p.neutralRollResponse : p.neutralResponse) * (1 - envelope.highAoa)
      servoDamping[axis] = -rates[axis] * (1 - Math.exp(-response * dt)) / dt
    } else {
      const response = target[axis] * rates[axis] < 0 ? axis === 'roll' ? p.rollReversalResponse : p.counterResponse : p.rateResponse
      const blend = 1 - Math.exp(-response * dt)
      // Separate the dissipative part of the existing first-order rate servo
      // from its powered drive. Only target*response needs positive authority.
      // If authority disappears, a held stick cannot sustain an inherited PSM rate.
      servoDamping[axis] = -rates[axis] * blend / dt
      request[axis] = target[axis] * blend / dt
    }
  }
  return { request, servoDamping, normalLimit, highG }
}

/** Project only the outward component of the COMBINED requested nose rotation.
 * Inward motion and tangent cross-axis motion survive. A finite-step gradient
 * includes second-order curvature at 0/180°, without division by sin(incidence).
 * Roll stays a body-axis rotation and cannot rotate the nose by itself.
 */
export function restrictIncidence(target: AeroAxes, flow: AirflowState, limitDeg: number, dt: number): AeroAxes {
  if (flow.confidence === 0) return { ...target }
  const alpha = flow.alphaDeg * Math.PI / 180, beta = flow.betaDeg * Math.PI / 180
  const vx = Math.cos(alpha) * Math.cos(beta), vy = -Math.sin(alpha) * Math.cos(beta), vz = Math.sin(beta)
  const gp = -vy + 0.5 * (vx * target.pitch - target.roll * vz) * dt
  const gy = -vz + 0.5 * (vx * target.yaw + target.roll * vy) * dt
  const outward = target.pitch * gp + target.yaw * gy
  const allowed = clamp((limitDeg - flow.incidenceDeg) / 5, 0, 1)
  if (outward <= 0) return { ...target }
  // A binary active-axis mask jumps when a second input crosses zero. Weight
  // the projection continuously by squared requested travel instead: neutral axes stay
  // neutral, and infinitesimal cross-axis input cannot unlock full pitch/yaw.
  const travel = target.pitch ** 2 + target.yaw ** 2
  if (travel === 0) return { ...target }
  const wp = target.pitch ** 2 / travel, wy = target.yaw ** 2 / travel
  // Numerical tangent regularization, not an incidence permission deadband.
  const norm = wp * gp * gp + wy * gy * gy + 1e-12
  const scale = outward / norm * (1 - allowed) * flow.confidence
  const pitch = target.pitch - wp * gp * scale, yaw = target.yaw - wy * gy * scale
  // Weighted projection can increase Euclidean norm; permission never amplifies
  // total requested nose rate. This rescale preserves the correction direction.
  const rateScale = Math.min(1, Math.hypot(target.pitch, target.yaw) / Math.max(Math.hypot(pitch, yaw), 1e-20))
  return { pitch: pitch * rateScale, yaw: yaw * rateScale, roll: target.roll }
}
