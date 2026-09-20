import type { AirflowState } from './airflow'
import type { AircraftState } from '../state/WorldState'
import type { PilotCommand } from '../runtime/commands'
import { clamp } from './speed'

import { getFlightProfile } from './profile'
export { maneuverProfile } from './profile'
export type PsmPhase = 'normal' | 'armed' | 'active' | 'recovery'
export type PsmBlock = 'none' | 'altitude' | 'speed' | 'unsupported'
export interface ManeuverState {
  phase: PsmPhase; timer: number; rotation: number; stable: number; blend: number
  blocked: PsmBlock; entrySpeed: number; exitSpeed: number
  peakAlpha: number; completed: number; highG: number; airbrake: number
  burner: number; burnerActive: boolean; burnerLocked: boolean; burnerRest: number
  /** Canonical unsigned nose/path incidence at END of step, not signed pitch alpha. */
  alpha: number
  g: number; pathRate: number; drag: number
}
export function createManeuverState(): ManeuverState {
  return { phase: 'normal', timer: 0, rotation: 0, stable: 0, blend: 0,
    blocked: 'none', entrySpeed: 0, exitSpeed: 0, peakAlpha: 0, completed: 0, highG: 0,
    airbrake: 0, burner: 1, burnerActive: false, burnerLocked: false, burnerRest: 0,
    alpha: 0, g: 1, pathRate: 0, drag: 0 }
}
/** Caller supplies flow from the start of this step, before pose/velocity integration. */
export function stepManeuvers(state: AircraftState, command: PilotCommand, dt: number, airflowStart: AirflowState) {
  const m = state.maneuver, p = getFlightProfile(state.aircraftId).maneuver
  const speed = airflowStart.airspeed
  const alpha = airflowStart.incidenceDeg * Math.PI / 180
  // C is an envelope modifier, never a maneuver trigger. No automatic braking,
  // pitch-up, target pose, or nose alignment: the pilot owns all three axes.
  const eligible = p.psmEnabled && state.position.y >= p.minAltitude && speed >= p.entryMin && speed <= p.entryMax
  m.blocked = !p.psmEnabled ? 'unsupported' : state.position.y < p.minAltitude ? 'altitude' : speed < p.entryMin || speed > p.entryMax ? 'speed' : 'none'
  if (m.phase === 'normal' && command.psmArm && eligible) m.phase = 'armed'
  if (m.phase === 'armed') {
    if (!command.psmArm || !eligible) m.phase = 'normal'
    else if (Math.hypot(command.pitch, command.yaw, command.roll) > 0.35) {
      m.phase = 'active'; m.timer = 0; m.rotation = 0; m.peakAlpha = 0
      m.entrySpeed = speed; m.exitSpeed = 0; m.stable = 0
    }
  }
  // Continue an unfinished maneuver without resetting its energy or blend.
  if (m.phase === 'recovery' && command.psmArm && eligible) m.phase = 'active'
  if (m.phase === 'active') {
    m.timer += dt; m.peakAlpha = Math.max(m.peakAlpha, alpha * 180 / Math.PI)
    if (!command.psmArm || !p.psmEnabled || speed > p.exitSpeed) {
      m.phase = 'recovery'; m.timer = 0; m.stable = 0; m.exitSpeed = speed
    }
  }
  const targetBlend = m.phase === 'active' ? 1 : 0
  m.blend += (targetBlend - m.blend) * (1 - Math.exp(-Math.log(100) * dt / p.blendSeconds))
  if (targetBlend === 0 && m.blend < 1e-9) m.blend = 0
  if (m.phase === 'recovery') {
    m.timer += dt
    m.stable = alpha < p.recoveryIncidenceRad && speed > p.recoverySpeedMps ? m.stable + dt : 0
    if (m.stable >= 0.3 && m.blend === 0) {
      if (m.peakAlpha >= 70) m.completed++
      m.phase = 'normal'
    }
  }
  const assisted = m.phase === 'active' || m.phase === 'recovery'
  const highGTarget = command.highG && Math.hypot(command.pitch, command.yaw) > 0.35
    ? clamp((speed - p.highGMinSpeedMps) / p.highGSpeedFadeMps, 0, 1) * clamp((p.highGMaxSpeedMps - speed) / p.highGSpeedFadeMps, 0, 1) : 0
  m.highG += (highGTarget - m.highG) * (1 - Math.exp(-6 * dt))
  const brake = command.airbrake
  m.airbrake += (+brake - m.airbrake) * (1 - Math.exp(-12 * dt))
  // Legacy comparison labels remain until Phase 6. No path, rate or thrust authority.
  return { alpha, assisted, brake }
}
