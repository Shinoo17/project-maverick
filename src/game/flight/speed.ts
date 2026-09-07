import type { AircraftState } from '../state/WorldState'
import type { PilotCommand } from '../runtime/commands'
import { flightProfile as p } from './profile'
export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
export function stepSpeed(state: AircraftState, command: PilotCommand, dt: number, speed: number) {
  const m = state.maneuver
  const requested = command.airbrake ? 0 : command.speedAdjust
  const response = requested === 0 ? p.releaseResponse : p.driveResponse
  state.speedDrive += (requested - state.speedDrive) * (1 - Math.exp(-response * dt))
  if (requested === 0 && Math.abs(state.speedDrive) < 0.002) state.speedDrive = 0
  // W/S request acceleration, never a stored speed. Releasing either key leaves
  // only a short drive tail. Trim balances base drag at the current airspeed;
  // turns, climbs, airbrakes and overspeed still consume energy.
  const drive = state.speedDrive >= 0
    ? Math.min(state.speedDrive * p.acceleration, Math.max(0, p.maxPoweredMps - speed) / dt)
    : -Math.min(-state.speedDrive * p.deceleration, Math.max(0, speed - p.minPoweredMps) / dt)
  const trim = p.drag * speed * speed
  const thrust = command.airbrake ? 0 : clamp(trim + Math.max(0, drive) + (m.burnerActive ? 38 : 0), 0, p.maxThrust * (m.burnerActive ? 1.6 : 1))
  state.enginePower = thrust / p.maxThrust
  return { thrust, braking: Math.max(m.airbrake * 30, Math.max(0, -drive)) }
}
export const arcadeSpeed = (mps: number) => mps * 3.6 * 1.5
