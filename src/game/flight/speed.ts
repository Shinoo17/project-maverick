import type { AircraftState } from '../state/WorldState'
import type { PilotCommand } from '../runtime/commands'
import type { FlightProfile } from './profileTypes'
import type { SpeedLimits } from './speedLimits'
import { getFlightProfile } from './profile'

export { arcadeSpeed } from './speedLimits'
export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const AFTERBURNER_ACCELERATION = 38

/** Higher configured speeds need enough thrust to overcome their base drag. */
export function dryThrustLimit(p: FlightProfile, limits: SpeedLimits) {
  return Math.max(p.maxThrust, p.drag * limits.topSpeedMps ** 2 + p.acceleration)
}

export function stepSpeed(state: AircraftState, command: PilotCommand, dt: number, speed: number) {
  const p = getFlightProfile(state.aircraftId).flight
  const m = state.maneuver
  const limits = state.speedLimits
  const topSpeed = m.burnerActive ? limits.afterburnerTopSpeedMps : limits.topSpeedMps
  const requested = command.airbrake ? 0 : command.speedAdjust
  const response = requested === 0 ? p.releaseResponse : p.driveResponse
  state.speedDrive += (requested - state.speedDrive) * (1 - Math.exp(-response * dt))
  if (requested === 0 && Math.abs(state.speedDrive) < 0.002) state.speedDrive = 0

  // W/S retain their direct acceleration and short release tail. Afterburner
  // supplies its own acceleration above the normal powered limit.
  const drive = state.speedDrive >= 0
    ? Math.min(state.speedDrive * p.acceleration, Math.max(0, limits.topSpeedMps - speed) / dt)
    : -Math.min(-state.speedDrive * p.deceleration, Math.max(0, speed - p.minPoweredMps) / dt)
  const boost = m.burnerActive ? AFTERBURNER_ACCELERATION : 0
  const acceleration = Math.min(Math.max(0, drive) + boost, Math.max(0, topSpeed - speed) / dt)
  const trim = p.drag * speed * speed
  const dryThrust = dryThrustLimit(p, limits)
  const maxThrust = m.burnerActive
    ? Math.max(dryThrust * 1.6, p.drag * topSpeed ** 2 + AFTERBURNER_ACCELERATION)
    : dryThrust
  const thrust = command.airbrake ? 0 : clamp(trim + acceleration, 0, maxThrust)

  // Shed overspeed gradually (including after burner cutoff), never clamp velocity.
  // Gravity, turning losses and PSM still act independently in stepFlight.
  const excess = Math.max(0, speed - topSpeed)
  const overspeedBraking = Math.min(excess * p.releaseResponse, p.deceleration, excess / dt)
  state.enginePower = thrust / dryThrust
  return { thrust, braking: Math.max(m.airbrake * 30, Math.max(0, -drive), overspeedBraking) }
}
