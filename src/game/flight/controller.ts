import type { PilotCommand } from '../runtime/commands'
import type { AeroAxes, AircraftFlightProfile } from './profileTypes'
import type { AirflowState } from './airflow'
import type { EnvelopeFactors } from './envelope'
import { clamp } from './speed'
import { arcadeSpeed } from './speedLimits'

const smoothstep = (value: number, min: number, max: number) => {
  const t = clamp((value - min) / (max - min), 0, 1)
  return t * t * (3 - 2 * t)
}

function turnRatePermission(speedAuthority: number, alphaLimitDeg: number, normalAlphaDeg: number, limiterOpen: number) {
  const incidencePermission = Math.sqrt(alphaLimitDeg / Math.max(normalAlphaDeg, 1))
  return speedAuthority + (incidencePermission - speedAuthority) * limiterOpen
}

/** Feedback against normal path support, before automatic G permission.
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
  demand: ReturnType<typeof measureControlDemand>,
  assist: { burnerActive: boolean; natural: Readonly<AeroAxes> } = { burnerActive: false, natural: { pitch: 0, yaw: 0, roll: 0 } }) {
  const p = profile.flight
  const { speedAuthority } = demand
  const normalLimit = demand.normalLimit * envelope.gAllowance
  const closedTurnBudget = demand.closedTurnBudget * envelope.gAllowance
  const hardTurn = envelope.hardTurnBlend
  const ratePermission = turnRatePermission(speedAuthority, envelope.alphaLimitDeg, profile.aero.alphaNormalDeg, envelope.limiterOpen)
  const target = { pitch: command.pitch * p.pitchRate * ratePermission * (1 + hardTurn * (profile.maneuver.highGRate - 1)),
    yaw: command.yaw * p.yawRate * ratePermission * (1 + hardTurn * 0.4),
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
  const request = { pitch: 0, yaw: 0, roll: 0 }, servoDamping = { ...request }, recoveryRequest = { ...request }
  // Recovery flies the same neutral servo once released. It takes over where neutral
  // damping fades with highAoa, so attached flight is unchanged. It steers along the
  // actual natural restoring + departure moment, so it never pushes against natural
  // recovery; where that moment is zero (a natural saddle) it only damps. Roll target is zero.
  // An engaged afterburner flies the path to the nose (slingshot exit), so recovery only
  // holds the nose. A held key with an empty reserve gives no thrust and no exception.
  const r = profile.recovery, recovery = envelope.recoveryAssist * envelope.highAoa
  const naturalNorm = Math.hypot(assist.natural.pitch, assist.natural.yaw)
  const band = p.commandedRateHoldSpeedKph
  const fade = p.commandedRateHoldIncidenceDeg
  // 'limiter' holds as the limiter opens and fades out between the incidence band's edges,
  // so past it the servo brakes the rate again (MR2 owner amendment of D1(b)).
  const scope = { speedBand: 1 - smoothstep(arcadeSpeed(flow.airspeed), band.full, band.zero),
    limiter: envelope.limiterOpen * (1 - smoothstep(flow.incidenceDeg, fade.full, fade.zero)), always: 1 }
  const noseRate = assist.burnerActive || naturalNorm === 0 ? 0 : r.noseRate / naturalNorm
  for (const axis of ['pitch', 'yaw', 'roll'] as const) {
    if (command[axis] === 0) {
      const neutral = (axis === 'roll' ? p.neutralRollResponse : p.neutralResponse) * (1 - envelope.highAoa)
      // One exponential for both responses: damping can never flip the rate sign.
      const blend = 1 - Math.exp(-(neutral + r.response * recovery) * dt)
      const goal = (axis === 'roll' ? 0 : assist.natural[axis]) * noseRate * recovery
      // Rate already turning toward the airflow, up to the goal, is left to natural
      // aero; only the excess or opposing part is damped.
      const useful = clamp(rates[axis], Math.min(0, goal), Math.max(0, goal))
      servoDamping[axis] = -(rates[axis] - useful) * blend / dt
      // The corrective drive is allocated from real aero/TVC only (no arcade floor):
      // no budget, no correction.
      if (recovery > 0) request[axis] = recoveryRequest[axis] = (goal - useful) * blend / dt
    } else {
      // RC4 (MR2): split the rate into the part counter-steered against the target and the
      // part along it. The counter part is damped at the counter response; the rest at the
      // rate response. The drive response blends between the two as the counter-steered
      // rate grows to counterResponseBlend of the target, so neither term steps where the
      // rate crosses zero. A zero blend width is the Phase 3 switch.
      const counterBlend = 1 - Math.exp(-(axis === 'roll' ? p.rollReversalResponse : p.counterResponse) * dt)
      const alongBlend = 1 - Math.exp(-p.rateResponse * dt)
      const counter = target[axis] * rates[axis] < 0 ? rates[axis] : 0
      const counterShare = counter === 0 ? 0 : p.counterResponseBlend > 0
        ? smoothstep(Math.abs(counter) / Math.max(Math.abs(target[axis]), 1e-9), 0, p.counterResponseBlend) : 1
      const driveBlend = alongBlend + (counterBlend - alongBlend) * counterShare
      // Separate the dissipative part of the existing first-order rate servo
      // from its powered drive. Only the drive needs positive authority.
      // With hold 0 a held stick cannot sustain an inherited rate once authority
      // disappears. A hold leaves the rate the pilot is commanding, between zero and the
      // target, to natural damping; excess rate and counter-steer are still damped. Where
      // the hold-0 drive is fully allocated the net response is identical for every hold.
      // High incidence is budget-limited at any speed, so each axis's hold is gated:
      // yaw by the pedal speed band (Phase 8); pitch by the open limiter, fading out between
      // 45° and 90° incidence so a held pull stops near the Cobra instead of tumbling and a
      // non-TVC airframe cannot carry an entry rate over the top (B19); roll always (MR2,
      // owner decision D1(b) and its amendment). A counter-steered rate has no held part,
      // so the hold only ever meets the along-target drive response.
      const held = scope[p.commandedRateHoldScope[axis]] * p.commandedRateHold[axis] * clamp(rates[axis], Math.min(0, target[axis]), Math.max(0, target[axis]))
      servoDamping[axis] = -(counter * counterBlend + (rates[axis] - counter - held) * alongBlend) / dt
      request[axis] = (target[axis] - held) * driveBlend / dt
    }
  }
  return { request, recoveryRequest, servoDamping, normalLimit, hardTurn }
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
