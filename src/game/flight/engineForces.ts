import { Vector3 } from 'three'

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
  floorMps: number, dt: number) {
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
  return { velocity: result, thrustWork, dragWork, controlPathRate: controlPath.angle / dt, controlPathCap: controlPath.maxRate, uncappedControlPathRate: controlPath.uncappedRate, pathCapActive: controlPath.capActive, longitudinalZeroCrossing: poweredSpeed < 0 }
}
