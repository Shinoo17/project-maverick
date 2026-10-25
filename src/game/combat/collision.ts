/*
Swept collision for fast projectiles.

A bullet moves several metres per step, farther than an aircraft is thick, so
testing only its end position would let it pass through (tunnelling). Instead
each step tests the whole segment start→end and reports the earliest impact as a
fraction `t` of the segment (0 = start, 1 = end).

Moving targets: the segment is moved into the target's body frame at both ends
of the step (start pose for the start point, end pose for the end point). This
is the bullet's path relative to the target, so a target that flies into the
bullet is hit and one that flies away is missed, without sub-stepping.

Pure functions, no renderer: the runtime passes poses it took at the start and
end of its tick.
*/
import { Quaternion, Vector3 } from 'three'
import type { HitShape } from '../../content/hitboxes'
import type { Quat, Vec3 } from '../state/WorldState'

export interface Pose { position: Vec3; orientation: Quat }
export interface CollisionTarget {
  id: string
  shapes: readonly HitShape[]
  /** Pose at the start of the step. */
  from: Pose
  /** Pose at the end of the step; the same as `from` for a target that holds still. */
  to: Pose
  /** Optional bounding radius around the body origin (see `boundingRadius`); a path that stays
   * outside it is rejected before the shapes are tested. */
  radius?: number
}
export type SegmentHit =
  | { kind: 'aircraft'; entityId: string; t: number; point: Vec3 }
  | { kind: 'ground'; t: number; point: Vec3 }

const EPSILON = 1e-9

/** First entry of segment start→end into a sphere, as a fraction of the segment, or null. */
function sphereEntry(start: Vector3, delta: Vector3, center: Vector3, radius: number) {
  const offset = start.clone().sub(center)
  const c = offset.lengthSq() - radius * radius
  if (c <= 0) return 0
  const a = delta.lengthSq(), b = offset.dot(delta)
  if (a < EPSILON || b >= 0) return null
  const h = b * b - a * c
  if (h < 0) return null
  return (-b - Math.sqrt(h)) / a
}

/** First entry of segment start→end into a capsule, or null. */
export function capsuleEntry(start: Vector3, end: Vector3, from: Vector3, to: Vector3, radius: number) {
  const delta = end.clone().sub(start), axis = to.clone().sub(from)
  const axisSq = axis.lengthSq()
  // Starting inside: the closest point on the axis is within the radius.
  const along = axisSq < EPSILON ? 0 : Math.min(1, Math.max(0, start.clone().sub(from).dot(axis) / axisSq))
  if (start.distanceToSquared(from.clone().addScaledVector(axis, along)) <= radius * radius) return 0
  // A capsule is a cylinder plus a sphere at each end; the earliest entry into any part is the entry.
  const candidates = [sphereEntry(start, delta, from, radius), sphereEntry(start, delta, to, radius)]
  if (axisSq >= EPSILON) {
    // Side of the infinite cylinder, kept only where it lies between the two ends.
    const offset = start.clone().sub(from)
    const axisDelta = axis.dot(delta), axisOffset = axis.dot(offset)
    const a = axisSq * delta.lengthSq() - axisDelta * axisDelta
    const b = axisSq * offset.dot(delta) - axisOffset * axisDelta
    const c = axisSq * offset.lengthSq() - axisOffset * axisOffset - radius * radius * axisSq
    const h = b * b - a * c
    if (a > EPSILON && h >= 0) {
      const t = (-b - Math.sqrt(h)) / a
      const y = axisOffset + t * axisDelta
      if (y > 0 && y < axisSq) candidates.push(t)
    }
  }
  const hits = candidates.filter((t): t is number => t !== null && t >= 0 && t <= 1)
  return hits.length ? Math.min(...hits) : null
}

/** First entry of segment start→end into an axis-aligned box, or null (slab test). */
export function boxEntry(start: Vector3, end: Vector3, center: Vector3, half: Vector3) {
  let enter = 0, exit = 1
  for (const axis of ['x', 'y', 'z'] as const) {
    const origin = start[axis] - center[axis], delta = end[axis] - start[axis]
    if (Math.abs(delta) < EPSILON) {
      // Parallel to this pair of faces: inside the slab for the whole segment, or never.
      if (Math.abs(origin) > half[axis]) return null
      continue
    }
    let near = (-half[axis] - origin) / delta, far = (half[axis] - origin) / delta
    if (near > far) [near, far] = [far, near]
    enter = Math.max(enter, near); exit = Math.min(exit, far)
    if (enter > exit) return null
  }
  return enter
}

/** First entry of a body-frame segment into any of the shapes, or null. */
export function shapesEntry(start: Vector3, end: Vector3, shapes: readonly HitShape[]) {
  let best: number | null = null
  for (const shape of shapes) {
    const t = shape.kind === 'capsule'
      ? capsuleEntry(start, end, new Vector3(...shape.from), new Vector3(...shape.to), shape.radius)
      : boxEntry(start, end, new Vector3(...shape.center), new Vector3(...shape.half))
    if (t !== null && (best === null || t < best)) best = t
  }
  return best
}

/** Moves a world point into a body frame. */
function toBody(point: Vec3, pose: Pose) {
  const inverse = new Quaternion(pose.orientation.x, pose.orientation.y, pose.orientation.z, pose.orientation.w).invert()
  return new Vector3(point.x - pose.position.x, point.y - pose.position.y, point.z - pose.position.z).applyQuaternion(inverse)
}

/** Radius of a sphere at the body origin that holds every shape. */
export function boundingRadius(shapes: readonly HitShape[]) {
  let radius = 0
  for (const shape of shapes) {
    if (shape.kind === 'capsule') radius = Math.max(radius, Math.hypot(...shape.from) + shape.radius, Math.hypot(...shape.to) + shape.radius)
    else radius = Math.max(radius, Math.hypot(Math.abs(shape.center[0]) + shape.half[0], Math.abs(shape.center[1]) + shape.half[1], Math.abs(shape.center[2]) + shape.half[2]))
  }
  return radius
}

/** Closest distance from the origin to the segment a→b. */
function originDistance(a: Vector3, b: Vector3) {
  const delta = b.clone().sub(a)
  const lengthSq = delta.lengthSq()
  const t = lengthSq < EPSILON ? 0 : Math.min(1, Math.max(0, -a.dot(delta) / lengthSq))
  return a.clone().addScaledVector(delta, t).length()
}

/** Where the segment start→end first enters a target, as a fraction of the segment, or null. */
export function targetEntry(start: Vec3, end: Vec3, target: CollisionTarget) {
  const from = toBody(start, target.from), to = toBody(end, target.to)
  if (target.radius !== undefined && originDistance(from, to) > target.radius) return null
  return shapesEntry(from, to, target.shapes)
}

/**
 * Earliest impact of the segment start→end with the ground plane or any target.
 * `ignoreId` skips the shooter (its own aircraft), so a round leaving the muzzle does not hit it.
 */
export function castSegment(start: Vec3, end: Vec3, world: { groundY: number; targets: readonly CollisionTarget[]; ignoreId?: string }): SegmentHit | null {
  const at = (t: number): Vec3 => ({ x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t, z: start.z + (end.z - start.z) * t })
  let best: SegmentHit | null = null
  if (start.y <= world.groundY) best = { kind: 'ground', t: 0, point: at(0) }
  else if (end.y < world.groundY) {
    const t = (start.y - world.groundY) / (start.y - end.y)
    best = { kind: 'ground', t, point: at(t) }
  }
  for (const target of world.targets) {
    if (target.id === world.ignoreId) continue
    const t = targetEntry(start, end, target)
    // Ties go to the earlier entry in the list, so the result never depends on float noise.
    if (t !== null && (best === null || t < best.t)) best = { kind: 'aircraft', entityId: target.id, t, point: at(t) }
  }
  return best
}
