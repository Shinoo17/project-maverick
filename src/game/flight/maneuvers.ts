import type { AircraftState } from '../state/WorldState'
import type { PilotCommand } from '../runtime/commands'

export { maneuverProfile } from './profile'
/** Burner/airbrake actuation and end-of-step observations. No PSM phase, entry
 * envelope or maneuver trigger: high-AoA flight emerges from the continuous envelope. */
export interface ManeuverState {
  airbrake: number
  burner: number; burnerActive: boolean; burnerLocked: boolean; burnerRest: number
  /** Canonical unsigned nose/path incidence at END of step, not signed pitch alpha. */
  alpha: number
  g: number; pathRate: number; drag: number
}
export function createManeuverState(): ManeuverState {
  return { airbrake: 0, burner: 1, burnerActive: false, burnerLocked: false, burnerRest: 0,
    alpha: 0, g: 1, pathRate: 0, drag: 0 }
}
export function stepManeuvers(state: AircraftState, command: PilotCommand, dt: number) {
  const m = state.maneuver
  m.airbrake += (+command.airbrake - m.airbrake) * (1 - Math.exp(-12 * dt))
}
