import { Quaternion, Vector3 } from 'three'
import type { AircraftState } from '../state/WorldState'
import type { PilotCommand } from '../runtime/commands'
import { trainingMap } from '../../content/maps'
import { flightProfile as p } from './profile'
import { stepManeuvers, maneuverProfile } from './maneuvers'
import { clamp, stepSpeed } from './speed'

// Canonical body axes: +X forward, +Y up, +Z right. Positive pitch raises nose;
// positive roll banks right; positive yaw turns right. Only this module maps signs.
export function stepFlight(state: AircraftState, command: PilotCommand, dt: number) {
  if (!state.alive) return
  const velocity = new Vector3().copy(state.velocity)
  const speed = velocity.length()
  const assist = stepManeuvers(state, command, dt, speed)
  const m = state.maneuver
  const { thrust, braking } = stepSpeed(state, { ...command, airbrake: assist.brake }, dt, speed)
  const authority = clamp(speed / 90, 0.12, 1) * clamp(160 / Math.max(speed, 1), 0.6, 1)
  const blend = 1 - Math.exp(-p.rateResponse * dt)
  const rates = state.rates
  rates.pitch += ((assist.pitch ?? command.pitch * p.pitchRate * authority * (1 + m.highG * (maneuverProfile.highGRate - 1))) - rates.pitch) * blend
  rates.yaw += ((assist.yaw ?? command.yaw * p.yawRate * authority * (1 + m.highG * 0.4)) - rates.yaw) * blend
  const rollTarget = assist.roll ?? command.roll * p.rollRate * authority
  const reversing = rollTarget * rates.roll < 0
  rates.roll += (rollTarget - rates.roll) * (reversing ? 1 - Math.exp(-p.rollReversalResponse * dt) : blend)
  if (m.phase === 'active') m.rotation += Math.hypot(rates.pitch, rates.yaw) * dt
  const angular = new Vector3(rates.roll, -rates.yaw, rates.pitch)
  const orientation = new Quaternion().copy(state.orientation)
  const angle = angular.length() * dt
  if (angle > 0) orientation.multiply(new Quaternion().setFromAxisAngle(angular.normalize(), angle)).normalize()
  state.orientation = { x: orientation.x, y: orientation.y, z: orientation.z, w: orientation.w }
  const forward = new Vector3(1, 0, 0).applyQuaternion(orientation)
  const path = speed > 0.001 ? velocity.clone().divideScalar(speed) : forward.clone()
  // Bounded lateral acceleration bends the path over time, preserving nose/path separation.
  const lateral = forward.clone().addScaledVector(path, -forward.dot(path))
  if (m.phase === 'recovery' && forward.dot(path) < -0.8) {
    // At a 180° nose reversal the projection is zero. Choose the aircraft's up
    // plane to continue bending airflow rather than stalling at the antipode.
    if (lateral.lengthSq() < 1e-8) lateral.set(0, 1, 0).applyQuaternion(orientation).addScaledVector(path, -new Vector3(0, 1, 0).applyQuaternion(orientation).dot(path))
    lateral.normalize()
  }
  lateral.multiplyScalar(speed * p.pathResponse * authority * (m.phase === 'active' ? 0.08 : m.phase === 'recovery' ? 2.5 : 1 + m.highG * 0.65))
  const lateralLimit = m.phase === 'recovery' ? 70 : 55 * (1 + m.highG * 0.6)
  if (lateral.length() > lateralLimit) lateral.setLength(lateralLimit)
  const turnLoss = p.turnDrag * (rates.pitch ** 2 + rates.yaw ** 2) * (1 + m.highG * (maneuverProfile.highGDrag - 1)) * (assist.assisted ? 0.55 : 1)
  const psmDrag = assist.assisted ? speed * speed * (Math.sin(assist.alpha) ** 2 + Math.max(0, -Math.cos(assist.alpha)) * 0.4) * 0.0025 : 0
  const drag = p.drag * speed * speed + turnLoss + psmDrag + Math.max(0, speed - 260) ** 2 * 0.02
  const force = forward.clone().multiplyScalar(thrust).add(lateral).addScaledVector(path, -drag - braking)
  // Arcade trim cancels cross-path gravity while retaining climb/descent energy cost.
  force.addScaledVector(path, -p.gravity * path.y)
  if (assist.assisted) force.y -= p.gravity * 0.5
  velocity.addScaledVector(force, dt)
  if (velocity.dot(path) < 0) velocity.addScaledVector(path, -velocity.dot(path))
  m.alpha = forward.angleTo(velocity) * 180 / Math.PI
  m.pathRate = speed > 1 && velocity.length() > 1 ? path.angleTo(velocity) / dt * 180 / Math.PI : 0
  m.g = Math.sqrt(1 + (speed * m.pathRate * Math.PI / 180 / p.gravity) ** 2)
  m.drag = drag + braking
  Object.assign(state.velocity, velocity)
  state.position.x += velocity.x * dt; state.position.y += velocity.y * dt; state.position.z += velocity.z * dt
  if (state.position.y <= 3) { state.position.y = 3; state.alive = false; state.stopReason = 'terrain' }
  if (Math.hypot(state.position.x, state.position.z) >= trainingMap.radius || state.position.y >= trainingMap.radius) {
    state.alive = false; state.stopReason = 'boundary'
  }
}
