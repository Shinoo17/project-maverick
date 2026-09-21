import { Quaternion, Vector3 } from 'three'

/** Engine + lateral-force change of path direction. Longitudinal work is integrated by
 * stepFlight's shared energy guard, independent of this transverse rate cap.
 * The denominator cannot collapse during braking or at zero airspeed. */
export function controlledPathStep(path: Vector3, controlForce: Vector3, speed: number, floorMps: number, dt: number) {
  const transverse = controlForce.clone().addScaledVector(path, -controlForce.dot(path))
  const magnitude = transverse.length()
  const angle = Math.atan(magnitude * dt / Math.max(speed, floorMps))
  const direction = path.clone().multiplyScalar(Math.cos(angle))
  if (magnitude > 0) direction.addScaledVector(transverse, Math.sin(angle) / magnitude)
  return { direction, angle, maxRate: magnitude / Math.max(speed, floorMps), uncappedRate: speed > 0 ? magnitude / speed : null, capActive: magnitude > 0 && speed < floorMps }
}

/** Work ledger uses a midpoint speed for the longitudinal thrust/drag step.
 * Drag/braking can dissipate only the available kinetic energy. Gravity is
 * potential energy, not a source hidden in the direction normalization. */
export function integrateTranslation(velocity: Vector3, path: Vector3, engineForce: Vector3,
  lateral: Vector3, dragAndBrake: number, gravity: number, gravityBlend: number,
  floorMps: number, dt: number, brake?: DirectionalBrake) {
  const braked = brake ? directionalBrakeStep(velocity, brake, floorMps, dt) : null
  if (braked) {
    velocity = braked.velocity
    if (velocity.lengthSq() > 1e-16) path = velocity.clone().normalize()
  }
  const speed = velocity.length()
  const axialThrust = engineForce.dot(path)
  const net = axialThrust - dragAndBrake
  const stopTime = net < 0 ? Math.min(dt, speed / -net) : dt
  let poweredSpeed = Math.max(0, speed + net * dt)
  let distance = (speed + poweredSpeed) * stopTime / 2
  let dragDistance = distance
  // A longitudinal engine impulse may pass THROUGH zero speed. Drag may not.
  // This is a signed-speed crossing, not rotation by a transverse force; the
  // transverse heading cap is still applied independently below. Without this,
  // upward thrust can repeatedly erase one gravity step and trap a tail slide.
  if (stopTime < dt && axialThrust < -dragAndBrake) {
    poweredSpeed = (axialThrust + dragAndBrake) * (dt - stopTime)
    const reverseDistance = poweredSpeed * (dt - stopTime) / 2
    distance += reverseDistance; dragDistance -= reverseDistance
  }
  const thrustWork = axialThrust * distance
  const available = Math.max(0, speed * speed / 2 + thrustWork)
  const dragWork = Math.min(available, Math.max(0, dragAndBrake) * dragDistance)
  const energy = Math.max(0, available - dragWork)
  const controlPath = controlledPathStep(path, engineForce.clone().add(lateral), speed, floorMps, dt)
  const result = controlPath.direction.clone().multiplyScalar(poweredSpeed)
  // Along-path gravity always acts; cross-path gravity returns as lift fades.
  result.addScaledVector(path, -gravity * path.y * (1 - gravityBlend) * dt)
  result.y -= gravity * gravityBlend * dt
  const candidateSpeed = result.length()
  if (candidateSpeed > 0) {
    const direction = result.clone().divideScalar(candidateSpeed)
    // Position is integrated with this final velocity: solve K + delta U <= work.
    const gravityStep = gravity * direction.y * dt
    const allowedSpeed = Math.max(0, -gravityStep + Math.sqrt(gravityStep * gravityStep + 2 * energy))
    result.multiplyScalar(Math.min(1, allowedSpeed / candidateSpeed))
  }
  return { velocity: result, thrustWork, dragWork: dragWork + (braked?.work ?? 0), brakeWork: braked?.work ?? 0, brakeForce: braked?.force ?? new Vector3(), brakePathRate: braked?.pathRate ?? 0, brakePathCap: braked?.pathCap ?? 0, controlPathRate: controlPath.angle / dt, controlPathCap: controlPath.maxRate, uncappedControlPathRate: controlPath.uncappedRate, pathCapActive: controlPath.capActive, longitudinalZeroCrossing: poweredSpeed < 0 }
}

export interface DirectionalBrake {
  orientation: { x: number; y: number; z: number; w: number }
  forward: number
  crossflow: number
}
/** Dissipative split impulse: each body component decays exponentially, never
 * overshoots zero. The exact midpoint impulse work is the lost kinetic energy.
 * A speed floor bounds anisotropic direction change near rest. The engine step
 * subsequently uses this new direction, so both longitudinal and transverse
 * brake effects are included, without charging the same loss twice.
 */
export function directionalBrakeStep(velocity: Vector3, brake: DirectionalBrake, floorMps: number, dt: number) {
  const q = new Quaternion().copy(brake.orientation)
  const body = velocity.clone().applyQuaternion(q.clone().invert()), initial = body.clone()
  const denominator = Math.max(velocity.length(), floorMps)
  body.x *= Math.exp(-Math.max(0, brake.forward) * dt / denominator)
  const cross = Math.exp(-Math.max(0, brake.crossflow) * dt / denominator)
  body.y *= cross; body.z *= cross
  const impulse = body.clone().sub(initial)
  const work = Math.max(0, -impulse.dot(initial.clone().add(body).multiplyScalar(0.5)))
  const result = body.applyQuaternion(q)
  return { velocity: result, work, force: impulse.applyQuaternion(q).divideScalar(dt),
    pathCap: Math.abs(brake.forward - brake.crossflow) / (2 * denominator),
    pathRate: velocity.lengthSq() > 1e-16 && result.lengthSq() > 1e-16 ? Math.atan2(velocity.clone().cross(result).length(), velocity.dot(result)) / dt : 0 }
}
