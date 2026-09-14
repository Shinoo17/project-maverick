import type { PilotCommand } from '../runtime/commands'
import type { AircraftState, Vec3 } from '../state/WorldState'
import { clamp } from './speed'
import { f22TvcProfile, getFlightProfile, type ThrustVectoringProfile } from './profile'

/** Degrees, positive = exhaust up / tail force down / nose up. Simulation-owned. */
export interface ThrustVectoringState { left: number; right: number; authority: number }
export const createThrustVectoringState = (): ThrustVectoringState => ({ left: 0, right: 0, authority: 0 })
export { f22TvcProfile } from './profile'
const smooth = (value: number) => { const t = clamp(value, 0, 1); return t * t * (3 - 2 * t) }

export function tvcAuthority(airspeed: number, aoa: number, phase: AircraftState['maneuver']['phase']) {
  const slow = 1 - smooth((airspeed - 55) / 145)
  const highAlpha = smooth((Math.abs(aoa) - 8) / 57)
  const maneuver = phase === 'active' ? 1 : phase === 'recovery' ? .55 : 0
  return .08 + .92 * Math.max(slow, highAlpha, maneuver)
}

/** Requested allocation, separate from actuator travel and never used as actual thrust. */
export function tvcTargets(command: Pick<PilotCommand, 'pitch' | 'roll'>, authority: number, p: ThrustVectoringProfile = f22TvcProfile) {
  const pitch = clamp(command.pitch, -1, 1) * p.maxAngle * authority
  const roll = clamp(command.roll, -1, 1) * p.rollGain * authority
  // +roll banks right: port exhaust DOWN lifts the port wing, starboard exhaust
  // UP lowers the starboard wing. Thus differential signs follow body-axis torque.
  return { left: clamp(pitch - roll, -p.maxAngle, p.maxAngle), right: clamp(pitch + roll, -p.maxAngle, p.maxAngle) }
}

/** Runs at the fixed flight step, including neutral input. No high-AoA enable gate. */
export function stepThrustVectoring(state: AircraftState, command: Pick<PilotCommand, 'pitch' | 'roll'>, dt: number, airspeed: number, aoa: number) {
  const p = getFlightProfile(state.aircraftId).thrustVectoring
  if (!p || !state.alive || dt <= 0) return
  const tvc = state.thrustVectoring
  tvc.authority += (tvcAuthority(airspeed, aoa, state.maneuver.phase) - tvc.authority) * (1 - Math.exp(-p.authorityResponse * dt))
  const targets = tvcTargets(command, tvc.authority, p)
  for (const side of ['left', 'right'] as const) {
    const change = (targets[side] - tvc[side]) * (1 - Math.exp(-p.actuatorResponse * dt))
    tvc[side] = clamp(tvc[side] + clamp(change, -p.actuatorRate * dt, p.actuatorRate * dt), -p.maxAngle, p.maxAngle)
  }
}

/** Sum two thrust vectors and r × F moments. Thrust here is acceleration (F/m). */
export function thrustForces(tvc: ThrustVectoringState, thrust: number, p: ThrustVectoringProfile = f22TvcProfile) {
  const engine = Math.max(0, thrust) / 2
  const acceleration: Vec3 = { x: 0, y: 0, z: 0 }
  const torquePerMass: Vec3 = { x: 0, y: 0, z: 0 }
  for (const [side, z] of [['left', -p.spacing], ['right', p.spacing]] as const) {
    const angle = clamp(tvc[side], -p.maxAngle, p.maxAngle) * Math.PI / 180
    const fx = engine * Math.cos(angle), fy = -engine * Math.sin(angle)
    acceleration.x += fx; acceleration.y += fy
    // Straight-thrust mounting moments are already canceled by the arcade trim.
    // Keep the incremental moments, including differential axial-thrust yaw.
    const dx = fx - engine
    torquePerMass.x -= z * fy
    torquePerMass.y += z * dx
    torquePerMass.z += p.pivotX * fy - p.height * dx
  }
  return { acceleration, torquePerMass, angularAcceleration: {
    pitch: torquePerMass.z / p.inertia.pitch,
    roll: torquePerMass.x / p.inertia.roll,
    yaw: -torquePerMass.y / p.inertia.yaw,
  } }
}

// Compatibility exports for the original F-22 fixtures. Runtime uses explicit profiles.
export { tvcAuthority as f22TvcAuthority, tvcTargets as f22TvcTargets, thrustForces as f22ThrustForces }
