import type { PilotCommand } from '../runtime/commands'
import type { AeroAxes, AircraftFlightProfile } from './profileTypes'
import type { AirflowState } from './airflow'
import type { EnvelopeFactors } from './envelope'
import { clamp } from './speed'

/** Body-rate demand and dissipative neutral smoothing. No engine/TVC capability. */
export function requestControl(command: PilotCommand, rates: AeroAxes, flow: AirflowState,
  envelope: EnvelopeFactors, profile: AircraftFlightProfile, highG: number, dt: number) {
  const p = profile.flight
  const speedAuthority = Math.min(flow.airspeed / profile.aero.referenceSpeedMps, 1) * clamp(profile.aero.highSpeedMps / Math.max(flow.airspeed, 1), 0.6, 1)
  const normalLimit = p.turnAcceleration * speedAuthority * (1 + highG * 0.6)
  const closedTurnBudget = normalLimit / Math.max(flow.airspeed, 1) * p.turnRateReserve
  const incidencePermission = Math.sqrt(envelope.alphaLimitDeg / Math.max(profile.aero.alphaNormalDeg, 1))
  const ratePermission = speedAuthority + (incidencePermission - speedAuthority) * envelope.limiterOpen
  const target = { pitch: command.pitch * p.pitchRate * ratePermission * (1 + highG * (profile.maneuver.highGRate - 1)),
    yaw: command.yaw * p.yawRate * ratePermission * (1 + highG * 0.4),
    roll: command.roll * p.rollRate * (speedAuthority + (1 - speedAuthority) * envelope.limiterOpen) }
  const requestedTurn = Math.hypot(command.pitch * p.pitchRate * speedAuthority, command.yaw * p.yawRate * speedAuthority)
  const closedScale = requestedTurn > 0 ? Math.min(1, closedTurnBudget / requestedTurn) : 1
  const permission = closedScale + (1 - closedScale) * envelope.limiterOpen
  target.pitch *= permission; target.yaw *= permission
  // A closed limiter still permits the deliberately small low-q floor target.
  for (const axis of ['pitch', 'yaw', 'roll'] as const) {
    const input = command[axis]
    if (Math.abs(target[axis]) < Math.abs(input) * profile.arcadeControlFloor.maxRate[axis]) target[axis] = input * profile.arcadeControlFloor.maxRate[axis]
    if (axis === 'roll') continue
    const incidence = axis === 'pitch' ? flow.alphaDeg : -flow.betaDeg
    if (input * incidence > 0) target[axis] *= clamp((envelope.alphaLimitDeg - Math.abs(incidence)) / 5, 0, 1)
  }
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
  return { request, servoDamping, normalLimit, speedAuthority, saturationRatio: requestedTurn / Math.max(closedTurnBudget, 1e-9) }
}
