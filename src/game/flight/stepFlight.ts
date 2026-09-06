import { Quaternion, Vector3 } from 'three'
import type { AircraftState } from '../state/WorldState'
import type { PilotCommand } from '../runtime/commands'
import { trainingMap } from '../../content/maps'
import { flightProfile as p } from './profile'
import { clamp, stepSpeed } from './speed'

// Canonical body axes: +X forward, +Y up, +Z right. Positive pitch raises nose;
// positive roll banks right; positive yaw turns right. Only this module maps signs.
export function stepFlight(state: AircraftState, command: PilotCommand, dt: number) {
  if (!state.alive) return
  const velocity = new Vector3().copy(state.velocity)
  const speed = velocity.length()
  const { thrust, braking } = stepSpeed(state, command, dt, speed)
  const authority = clamp(speed / 90, 0.12, 1) * clamp(160 / Math.max(speed, 1), 0.6, 1)
  const blend = 1 - Math.exp(-p.rateResponse * dt)
  const rates = state.rates
  rates.pitch += (command.pitch * p.pitchRate * authority - rates.pitch) * blend
  rates.yaw += (command.yaw * p.yawRate * authority - rates.yaw) * blend
  rates.roll += (command.roll * p.rollRate * authority - rates.roll) * blend
  const angular = new Vector3(rates.roll, -rates.yaw, rates.pitch)
  const orientation = new Quaternion().copy(state.orientation)
  const angle = angular.length() * dt
  if (angle > 0) orientation.multiply(new Quaternion().setFromAxisAngle(angular.normalize(), angle)).normalize()
  state.orientation = { x: orientation.x, y: orientation.y, z: orientation.z, w: orientation.w }
  const forward = new Vector3(1, 0, 0).applyQuaternion(orientation)
  const path = speed > 0.001 ? velocity.clone().divideScalar(speed) : forward.clone()
  // Bounded lateral acceleration bends the path over time, preserving nose/path separation.
  const lateral = forward.clone().addScaledVector(path, -forward.dot(path)).multiplyScalar(speed * p.pathResponse * authority)
  if (lateral.length() > 55) lateral.setLength(55)
  const turnLoss = p.turnDrag * (rates.pitch ** 2 + rates.yaw ** 2)
  const drag = p.drag * speed * speed + turnLoss + Math.max(0, speed - 260) ** 2 * 0.02
  const force = forward.clone().multiplyScalar(thrust).add(lateral).addScaledVector(path, -drag - braking)
  // Arcade trim cancels cross-path gravity while retaining climb/descent energy cost.
  force.addScaledVector(path, -p.gravity * path.y)
  velocity.addScaledVector(force, dt)
  if (velocity.dot(path) < 0) velocity.addScaledVector(path, -velocity.dot(path))
  Object.assign(state.velocity, velocity)
  state.position.x += velocity.x * dt; state.position.y += velocity.y * dt; state.position.z += velocity.z * dt
  if (state.position.y <= 3) { state.position.y = 3; state.alive = false; state.stopReason = 'terrain' }
  if (Math.hypot(state.position.x, state.position.z) >= trainingMap.radius || state.position.y >= trainingMap.radius) {
    state.alive = false; state.stopReason = 'boundary'
  }
}
