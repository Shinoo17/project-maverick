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

type VectorCommand = Pick<PilotCommand, 'pitch' | 'roll'> & Partial<Pick<PilotCommand, 'yaw'>>

/** Requested allocation, separate from actuator travel and never used as actual thrust. */
export function tvcTargets(command: VectorCommand, authority: number, p: ThrustVectoringProfile = f22TvcProfile) {
  const pitch = clamp(command.pitch, -1, 1) * p.maxAngle * authority
  const differential = (clamp(command.roll, -1, 1) * p.rollGain + clamp(command.yaw ?? 0, -1, 1) * p.yawGain) * authority
  // +roll banks right: port exhaust DOWN lifts the port wing, starboard exhaust
  // UP lowers the starboard wing. Thus differential signs follow body-axis torque.
  return { left: clamp(pitch - differential, -p.maxAngle, p.maxAngle), right: clamp(pitch + differential, -p.maxAngle, p.maxAngle) }
}

/** Runs at the fixed flight step, including neutral input. No high-AoA enable gate. */
export function stepThrustVectoring(state: AircraftState, command: VectorCommand, dt: number, airspeed: number, aoa: number) {
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

/** Unit thrust direction in body axes; exhaust points the opposite way. */
export function nozzleDirection(angleDeg: number, side: 'left' | 'right', p: ThrustVectoringProfile) {
  const angle = clamp(angleDeg, -p.maxAngle, p.maxAngle) * Math.PI / 180
  const cant = p.cantDeg * Math.PI / 180
  return { x: Math.cos(angle), y: -Math.sin(angle) * Math.cos(cant),
    z: (side === 'left' ? 1 : -1) * Math.sin(angle) * Math.sin(cant) }
}

/** Sum two thrust vectors and r × F moments. Thrust here is acceleration (F/m). */
export function thrustForces(tvc: ThrustVectoringState, thrust: number, p: ThrustVectoringProfile = f22TvcProfile) {
  const engine = Math.max(0, thrust) / 2
  const acceleration: Vec3 = { x: 0, y: 0, z: 0 }
  const torquePerMass: Vec3 = { x: 0, y: 0, z: 0 }
  for (const [side, z] of [['left', -p.spacing], ['right', p.spacing]] as const) {
    const direction = nozzleDirection(tvc[side], side, p)
    const fx = engine * direction.x, fy = engine * direction.y, fz = engine * direction.z
    acceleration.x += fx; acceleration.y += fy; acceleration.z += fz
    // Straight-thrust mounting moments are already canceled by the arcade trim.
    // Keep the incremental moments, including differential axial-thrust yaw.
    const dx = fx - engine
    torquePerMass.x += p.height * fz - z * fy
    torquePerMass.y += z * dx - p.pivotX * fz
    torquePerMass.z += p.pivotX * fy - p.height * dx
  }
  return { acceleration, torquePerMass, angularAcceleration: {
    pitch: torquePerMass.z / p.inertia.pitch,
    roll: torquePerMass.x / p.inertia.roll,
    yaw: -torquePerMass.y / p.inertia.yaw,
  } }
}

/** Full-travel geometry capacity (rad/s²), independent of input and actuator position.
 * Opposed travel couples yaw and roll: these ceilings are not additive budgets.
 * Observation only in Phase 0; the flight step does not consume this helper.
 */
export function tvcCapacity(profile: ThrustVectoringProfile | null, thrust: number) {
  if (!profile) return { pitch: 0, yaw: 0, roll: 0 }
  const at = (left: number, right: number) => thrustForces({ left, right, authority: 1 }, thrust, profile).angularAcceleration
  const a = profile.maxAngle
  const together = [at(a, a), at(-a, -a)]
  const opposed = [at(a, -a), at(-a, a)]
  return {
    pitch: Math.max(...together.map(value => Math.abs(value.pitch))),
    yaw: Math.max(...opposed.map(value => Math.abs(value.yaw))),
    roll: Math.max(...opposed.map(value => Math.abs(value.roll))),
  }
}

// Compatibility exports for the original F-22 fixtures. Runtime uses explicit profiles.
export { tvcAuthority as f22TvcAuthority, tvcTargets as f22TvcTargets, thrustForces as f22ThrustForces }
