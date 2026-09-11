import { Quaternion, Vector3 } from 'three'
import type { AircraftState } from '../state/WorldState'
import type { PilotCommand } from '../runtime/commands'
import { clamp } from './speed'

// Arcade assist tuning, shared by both experimental airframes until P3 profiles.
export const maneuverProfile = {
  entryMin: 65, entryMax: 115, minAltitude: 150,
  pitchRate: 2.6, yawRate: 1.6, rollRate: 2.1, maxRotation: Math.PI * 2, activeSeconds: 3, cooldown: 4,
  highGRate: 1.4, highGDrag: 2, burnerSeconds: 6, burnerRecharge: 12,
  // Keep PSM airflow independent of normal-flight grip tuning.
  pathResponse: 1.5, activeGrip: 0.08, recoveryGrip: 2.5,
  recoveryAcceleration: 70,
} as const
export type PsmPhase = 'normal' | 'armed' | 'active' | 'recovery' | 'cooldown'
export type PsmBlock = 'none' | 'altitude' | 'speed'
export interface ManeuverState {
  phase: PsmPhase; timer: number; rotation: number; stable: number; cooldown: number
  blocked: PsmBlock; entrySpeed: number; exitSpeed: number
  peakAlpha: number; completed: number; highG: number; airbrake: number
  burner: number; burnerActive: boolean; burnerLocked: boolean; burnerRest: number
  alpha: number; g: number; pathRate: number; drag: number
}
export function createManeuverState(): ManeuverState {
  return { phase: 'normal', timer: 0, rotation: 0, stable: 0, cooldown: 0,
    blocked: 'none', entrySpeed: 0, exitSpeed: 0, peakAlpha: 0, completed: 0, highG: 0,
    airbrake: 0, burner: 1, burnerActive: false, burnerLocked: false, burnerRest: 0,
    alpha: 0, g: 1, pathRate: 0, drag: 0 }
}
export function stepManeuvers(state: AircraftState, command: PilotCommand, dt: number, speed: number) {
  const m = state.maneuver, p = maneuverProfile
  const q = new Quaternion().copy(state.orientation)
  const forward = new Vector3(1, 0, 0).applyQuaternion(q)
  const path = speed > 0.01 ? new Vector3().copy(state.velocity).normalize() : forward.clone()
  const alpha = forward.angleTo(path)
  // C is an envelope modifier, never a maneuver trigger. No automatic braking,
  // pitch-up, target pose, or nose alignment: the pilot owns all three axes.
  const eligible = state.position.y >= p.minAltitude && speed >= p.entryMin && speed <= p.entryMax
  m.blocked = state.position.y < p.minAltitude ? 'altitude' : speed < p.entryMin || speed > p.entryMax ? 'speed' : 'none'
  if (m.phase === 'cooldown') {
    m.cooldown = Math.max(0, m.cooldown - dt)
    if (m.cooldown === 0 && !command.psmArm) m.phase = 'normal'
  } else if (m.phase === 'normal' && command.psmArm && eligible) {
    m.phase = 'armed'
  }
  if (m.phase === 'armed') {
    if (!command.psmArm || !eligible) m.phase = 'normal'
    else if (Math.hypot(command.pitch, command.yaw) > 0.35) {
      m.phase = 'active'; m.timer = 0; m.rotation = 0; m.peakAlpha = 0
      m.entrySpeed = speed; m.exitSpeed = 0; m.stable = 0
    }
  }
  if (m.phase === 'active') {
    m.timer += dt; m.peakAlpha = Math.max(m.peakAlpha, alpha * 180 / Math.PI)
    if (!command.psmArm || m.timer >= p.activeSeconds || m.rotation >= p.maxRotation || speed < 25 || state.position.y < 80) {
      m.phase = 'recovery'; m.timer = 0; m.stable = 0; m.exitSpeed = speed
    }
  }
  if (m.phase === 'recovery') {
    m.timer += dt
    m.stable = alpha < 0.3 && speed > 60 ? m.stable + dt : 0
    if (m.stable >= 0.3 || m.timer > 6) {
      if (m.stable >= 0.3 && m.peakAlpha >= 70) m.completed++
      m.phase = 'cooldown'; m.cooldown = p.cooldown
    }
  }
  const assisted = m.phase === 'active' || m.phase === 'recovery'
  const highGTarget = !assisted && m.phase !== 'armed' && command.highG && Math.hypot(command.pitch, command.yaw) > 0.35
    ? clamp((speed - 75) / 15, 0, 1) * clamp((190 - speed) / 15, 0, 1) : 0
  m.highG += (highGTarget - m.highG) * (1 - Math.exp(-6 * dt))
  const brake = command.airbrake
  m.airbrake += (+brake - m.airbrake) * (1 - Math.exp(-12 * dt))
  m.burnerActive = command.afterburner && !brake && m.airbrake < 0.1 && m.phase !== 'active' && m.phase !== 'armed'
    && !(m.phase === 'recovery' && alpha > 0.5) && !m.burnerLocked && m.burner > 0
  if (m.burnerActive) {
    m.burner = Math.max(0, m.burner - dt / p.burnerSeconds); m.burnerRest = 0
    if (m.burner === 0) m.burnerLocked = true
  } else {
    m.burnerRest += dt
    if (m.burnerRest > 1) m.burner = Math.min(1, m.burner + dt / p.burnerRecharge)
    if (m.burner >= 0.25) m.burnerLocked = false
  }
  // Rate authority remains available at low airflow. Recovery follows the
  // pilot's chosen heading by bending velocity, never by turning the nose back.
  const vectorAuthority = clamp(speed / 60, 0.45, 1)
  const recoveryScale = m.phase === 'recovery' ? 0.65 : 1
  return { alpha, assisted, brake,
    pitch: assisted ? command.pitch * p.pitchRate * vectorAuthority * recoveryScale : null,
    yaw: assisted ? command.yaw * p.yawRate * vectorAuthority * recoveryScale : null,
    roll: assisted ? command.roll * p.rollRate * vectorAuthority : null }
}
