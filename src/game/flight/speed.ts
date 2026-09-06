import type { AircraftState } from '../state/WorldState'
import type { PilotCommand } from '../runtime/commands'
import { flightProfile as p } from './profile'
export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
export function stepSpeed(state: AircraftState, command: PilotCommand, dt: number, speed: number) {
  state.targetSpeedMps = clamp(state.targetSpeedMps + command.speedAdjust * p.speedAdjustMps2 * dt, p.minTargetMps, p.maxTargetMps)
  const trim = p.drag * speed * speed / p.acceleration
  const requested = command.airbrake ? 0 : clamp(trim + (state.targetSpeedMps - speed) * 0.07, 0, 1)
  state.enginePower += clamp(requested - state.enginePower, -p.spoolRate * dt, p.spoolRate * dt)
}
export const arcadeSpeed = (mps: number) => mps * 3.6 * 1.5
