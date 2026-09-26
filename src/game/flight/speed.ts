import type { AircraftState } from '../state/WorldState'
import type { PilotCommand } from '../runtime/commands'
import type { FlightProfile } from './profileTypes'
import type { SpeedLimits } from './speedLimits'
import { getFlightProfile } from './profile'

import { stepBurner, stepEngine } from './engine'

export { arcadeSpeed } from './speedLimits'
export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

/** Higher configured speeds need enough thrust to overcome their base drag. */
export function dryThrustLimit(p: FlightProfile, limits: SpeedLimits) {
  return Math.max(p.maxThrust, p.drag * limits.topSpeedMps ** 2 + p.acceleration)
}

export function stepSpeed(state: AircraftState, command: PilotCommand, dt: number, speed: number, maneuverIntent = 0) {
  const profile = getFlightProfile(state.aircraftId)
  const p = profile.flight
  stepBurner(state.maneuver, command.afterburner, profile.maneuver, dt)
  const m = state.maneuver
  const limits = state.speedLimits
  const topSpeed = m.burnerActive ? limits.afterburnerTopSpeedMps : limits.topSpeedMps
  const requested = command.speedAdjust
  const response = requested === 0 ? p.releaseResponse : p.driveResponse
  state.speedDrive += (requested - state.speedDrive) * (1 - Math.exp(-response * dt))
  if (requested === 0 && Math.abs(state.speedDrive) < 0.002) state.speedDrive = 0

  // W/S retain their direct acceleration and short release tail. Afterburner
  // supplies its own acceleration above the normal powered limit.
  const drive = state.speedDrive >= 0
    ? Math.min(state.speedDrive * p.acceleration, Math.max(0, limits.topSpeedMps - speed) / dt)
    : -Math.min(-state.speedDrive * p.deceleration, Math.max(0, speed - p.minPoweredMps) / dt)
  const boost = m.burnerActive ? p.afterburnerAcceleration : 0
  const acceleration = Math.min(Math.max(0, drive) + boost, Math.max(0, topSpeed - speed) / dt)
  const trim = p.drag * speed * speed
  const dryThrust = dryThrustLimit(p, limits)
  const maxThrust = m.burnerActive
    ? Math.max(dryThrust * 1.6, p.drag * topSpeed ** 2 + p.afterburnerAcceleration)
    : dryThrust
  // Bounded explicit pilot maneuver request, shared by translation and TVC.
  // Neither drag coefficients beyond base trim nor a speed error enter this term.
  // The axis weight reads stick shares only, so a yaw-only pedal can ask for less
  // than a pull (Phase 8 option B). No input history yet leaves it unweighted.
  const share = state.intent.axisShare, weights = p.controlPowerAxisWeight
  const shareSum = share.pitch + share.yaw + share.roll
  const axisWeight = shareSum > 0 ? (share.pitch * weights.pitch + share.yaw * weights.yaw + share.roll * weights.roll) / shareSum : 1
  const controlPower = p.controlPower * axisWeight * clamp(maneuverIntent, 0, 1)
  const dryRequest = Math.min(dryThrust, trim + Math.max(0, drive) + controlPower * dryThrust)
  const burnerRequest = Math.max(0, acceleration - Math.max(0, drive))
  const requestedPower = clamp(dryRequest + burnerRequest, 0, maxThrust) / dryThrust
  const thrust = stepEngine(state, requestedPower, dryThrust, profile.engine, dt)

  // Shed overspeed gradually (including after burner cutoff), never clamp velocity.
  // Gravity, turning losses and PSM still act independently in stepFlight.
  const excess = Math.max(0, speed - topSpeed)
  const overspeedBraking = Math.min(excess * p.releaseResponse, p.deceleration, excess / dt)
  const airbrake = m.airbrake * p.airbrakeDeceleration
  const isotropic = Math.max(Math.max(0, -drive), overspeedBraking)
  return { thrust, braking: Math.max(airbrake, isotropic),
    brakes: { forward: Math.max(airbrake, isotropic), crossflow: Math.max(airbrake * p.airbrakeCrossflow, isotropic) },
    power: { baseTrim: trim, drive: Math.max(0, drive), controlPower, controlThrust: controlPower * dryThrust,
      burner: burnerRequest, requestedPower, actualThrust: thrust },
    brakeSources: { airbrake, deceleration: Math.max(0, -drive), overspeed: overspeedBraking },
  }
}
