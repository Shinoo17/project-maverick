import type { AircraftState, Vec3 } from '../state/WorldState'
import { clamp } from './speed'
import type { AeroAxes } from './profileTypes'
import { f22TvcProfile, getFlightProfile, type ThrustVectoringProfile } from './profile'

/** Degrees, positive = exhaust up / tail force down / nose up. Simulation-owned. */
export interface ThrustVectoringState { left: number; right: number; authority: number }
export const createThrustVectoringState = (): ThrustVectoringState => ({ left: 0, right: 0, authority: 0 })
export { f22TvcProfile } from './profile'
type VectorCommand = { pitch: number; roll: number; yaw?: number }

/** Legacy input mixer for hangar/exhaust previews only. Flight uses solveTvcAngles. */
export function tvcTargets(command: VectorCommand, authority: number, p: ThrustVectoringProfile = f22TvcProfile) {
  const pitch = clamp(command.pitch, -1, 1) * p.maxAngle * authority
  const differential = (clamp(command.roll, -1, 1) * p.rollGain + clamp(command.yaw ?? 0, -1, 1) * p.yawGain) * authority
  // +roll banks right: port exhaust DOWN lifts the port wing, starboard exhaust
  // UP lowers the starboard wing. Thus differential signs follow body-axis torque.
  return { left: clamp(pitch - differential, -p.maxAngle, p.maxAngle), right: clamp(pitch + differential, -p.maxAngle, p.maxAngle) }
}

/** Actuator follows allocator angles only. No phase, input or speed authority. */
export function stepThrustVectoring(state: AircraftState, targets: { left: number; right: number }, dt: number) {
  const p = getFlightProfile(state.aircraftId).thrustVectoring
  if (!p || !state.alive || dt <= 0) return
  const tvc = state.thrustVectoring
  tvc.authority = Math.max(Math.abs(targets.left), Math.abs(targets.right)) / p.maxAngle
  for (const side of ['left', 'right'] as const) {
    const change = (clamp(targets[side], -p.maxAngle, p.maxAngle) - tvc[side]) * (1 - Math.exp(-p.actuatorResponse * dt))
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
export function geometryCapacity(profile: ThrustVectoringProfile | null, thrust: number) {
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
export { tvcTargets as f22TvcTargets, thrustForces as f22ThrustForces }

export interface DirectionalCapacity { positive: AeroAxes; negative: AeroAxes }
const zero = (): AeroAxes => ({ pitch: 0, yaw: 0, roll: 0 })

/** One scalar scales angular moments only; translation always uses actual thrust. */
export function poweredThrustForces(angles: { left: number; right: number }, thrust: number, p: ThrustVectoringProfile) {
  const force = thrustForces({ ...angles, authority: 1 }, thrust, p)
  for (const axis of ['pitch', 'yaw', 'roll'] as const) force.angularAcceleration[axis] *= p.gain
  return force
}

/** Exact extrema of A sin(theta) + B (cos(theta)-1) over nozzle travel. */
function travelExtrema(a: number, b: number, limit: number) {
  const angles = [-limit, 0, limit]
  const critical = Math.atan2(a, b)
  for (let k = -2; k <= 2; k++) {
    const angle = critical + k * Math.PI
    if (angle >= -limit && angle <= limit) angles.push(angle)
  }
  const values = angles.map(angle => a * Math.sin(angle) + b * (Math.cos(angle) - 1))
  return { min: Math.min(...values), max: Math.max(...values) }
}

/** E1/E3: commanded capacities and full-travel physical moment bounds are distinct.
 * Per-axis capacities are not a simultaneously reachable 3-axis actuator box.
 * Cant=0 has no commanded yaw, but its axial-thrust coupled yaw is bounded here.
 * The bound is analytic, covers intermediate travel, and reads no command/angle.
 */
export function tvcMomentCapacity(p: ThrustVectoringProfile | null, thrust: number) {
  const commanded: DirectionalCapacity = { positive: zero(), negative: zero() }
  const moments: DirectionalCapacity = { positive: zero(), negative: zero() }
  if (!p || thrust <= 0) return { commanded, moments }
  const e = thrust / 2, cant = p.cantDeg * Math.PI / 180, limit = p.maxAngle * Math.PI / 180
  for (const side of [-1, 1]) {
    const z = side * p.spacing, directionZ = -side * Math.sin(cant)
    const coefficients = {
      pitch: [-p.pivotX * e * Math.cos(cant) / p.inertia.pitch, -p.height * e / p.inertia.pitch],
      yaw: [p.pivotX * e * directionZ / p.inertia.yaw, -z * e / p.inertia.yaw],
      roll: [e * (p.height * directionZ + z * Math.cos(cant)) / p.inertia.roll, 0],
    }
    for (const axis of ['pitch', 'yaw', 'roll'] as const) {
      const [a, b] = coefficients[axis], extrema = travelExtrema(a, b, limit)
      moments.positive[axis] += Math.max(0, extrema.max) * p.gain
      moments.negative[axis] += Math.max(0, -extrema.min) * p.gain
    }
  }
  const at = (left: number, right: number) => poweredThrustForces({ left, right }, thrust, p).angularAcceleration
  for (const axis of ['pitch', 'yaw', 'roll'] as const) {
    const poses = axis === 'pitch' ? [at(p.maxAngle, p.maxAngle), at(-p.maxAngle, -p.maxAngle)]
      : [at(-p.maxAngle, p.maxAngle), at(p.maxAngle, -p.maxAngle)]
    commanded.positive[axis] = Math.max(0, ...poses.map(pose => pose[axis]))
    commanded.negative[axis] = Math.max(0, ...poses.map(pose => -pose[axis]))
  }
  if (p.cantDeg === 0) commanded.positive.yaw = commanded.negative.yaw = 0
  return { commanded, moments }
}

/** Deterministic two-actuator least-squares inversion. The target is always a
 * reachable pair of angles; independent yaw/roll reservations cannot be added.
 * Unachievable demand stays unmet and cross-axis moments remain visible.
 */
export function solveTvcAngles(request: AeroAxes, thrust: number, p: ThrustVectoringProfile | null) {
  if (!p || thrust <= 0 || Object.values(request).every(value => value === 0)) return { left: 0, right: 0 }
  const capacity = tvcMomentCapacity(p, thrust).commanded
  const scale = (axis: keyof AeroAxes) => Math.max(capacity.positive[axis], capacity.negative[axis], 1e-6)
  const weight = (axis: keyof AeroAxes) => axis === 'yaw' && p.cantDeg === 0 ? 0 : 1 / scale(axis) ** 2
  const at = (left: number, right: number) => poweredThrustForces({ left, right }, thrust, p).angularAcceleration
  const cost = (value: AeroAxes) => (['pitch', 'yaw', 'roll'] as const).reduce((sum, axis) => sum + (value[axis] - request[axis]) ** 2 * weight(axis), 0)
  let left = 0, right = 0
  for (let iteration = 0; iteration < 10; iteration++) {
    const value = at(left, right), h = 0.001
    // Central derivatives stay usable even at travel limits.
    const l0 = Math.max(-p.maxAngle, left - h), l1 = Math.min(p.maxAngle, left + h)
    const r0 = Math.max(-p.maxAngle, right - h), r1 = Math.min(p.maxAngle, right + h)
    const lowL = at(l0, right), highL = at(l1, right), lowR = at(left, r0), highR = at(left, r1)
    let aa = 1e-10, ab = 0, bb = 1e-10, ar = 0, br = 0
    for (const axis of ['pitch', 'yaw', 'roll'] as const) {
      const a = (highL[axis] - lowL[axis]) / (l1 - l0), b = (highR[axis] - lowR[axis]) / (r1 - r0)
      const w = weight(axis), residual = request[axis] - value[axis]
      aa += w * a * a; ab += w * a * b; bb += w * b * b
      ar += w * a * residual; br += w * b * residual
    }
    const determinant = aa * bb - ab * ab
    const dl = (ar * bb - br * ab) / determinant, dr = (br * aa - ar * ab) / determinant
    const oldCost = cost(value)
    let improved = false
    for (const fraction of [1, 0.5, 0.25, 0.125]) {
      const l = clamp(left + dl * fraction, -p.maxAngle, p.maxAngle), r = clamp(right + dr * fraction, -p.maxAngle, p.maxAngle)
      if (cost(at(l, r)) < oldCost) { left = l; right = r; improved = true; break }
    }
    if (!improved) break
  }
  return { left, right }
}

/** Compact command-capacity summary. Directional allocation uses tvcMomentCapacity. */
export function tvcCapacity(p: ThrustVectoringProfile | null, thrust: number): AeroAxes {
  const { commanded } = tvcMomentCapacity(p, thrust)
  return { pitch: Math.max(commanded.positive.pitch, commanded.negative.pitch),
    yaw: Math.max(commanded.positive.yaw, commanded.negative.yaw),
    roll: Math.max(commanded.positive.roll, commanded.negative.roll) }
}
