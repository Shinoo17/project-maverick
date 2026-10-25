import { describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { boxEntry, capsuleEntry, castSegment, targetEntry, type CollisionTarget, type Pose } from '../src/game/combat/collision'
import { hitboxes, type HitShape } from '../src/content/hitboxes'

const v = (x: number, y: number, z: number) => new Vector3(x, y, z)
const still = (x: number, y = 0, z = 0): Pose => ({ position: { x, y, z }, orientation: { x: 0, y: 0, z: 0, w: 1 } })
const ball: HitShape[] = [{ kind: 'capsule', from: [0, 0, 0], to: [0, 0, 0], radius: 1 }]
const target = (id: string, from: Pose, to: Pose = from, shapes: readonly HitShape[] = ball): CollisionTarget => ({ id, shapes, from, to })

describe('capsule entry', () => {
  const from = v(-5, 0, 0), to = v(5, 0, 0)
  it('hits the side where the segment crosses the radius', () => {
    expect(capsuleEntry(v(0, 10, 0), v(0, -10, 0), from, to, 1)).toBeCloseTo(9 / 20)
  })
  it('hits an end cap along the axis', () => {
    expect(capsuleEntry(v(20, 0, 0), v(0, 0, 0), from, to, 1)).toBeCloseTo(14 / 20)
  })
  it('misses beside the capsule and short of it', () => {
    expect(capsuleEntry(v(0, 10, 1.5), v(0, -10, 1.5), from, to, 1)).toBeNull()
    expect(capsuleEntry(v(0, 10, 0), v(0, 2, 0), from, to, 1)).toBeNull()
  })
  it('reports 0 for a segment that starts inside, including a zero-length one', () => {
    expect(capsuleEntry(v(1, 0.5, 0), v(1, 10, 0), from, to, 1)).toBe(0)
    expect(capsuleEntry(v(1, 0.5, 0), v(1, 0.5, 0), from, to, 1)).toBe(0)
    expect(capsuleEntry(v(1, 5, 0), v(1, 5, 0), from, to, 1)).toBeNull()
  })
  it('treats a zero-length axis as a sphere', () => {
    expect(capsuleEntry(v(0, 0, -4), v(0, 0, 4), v(0, 0, 0), v(0, 0, 0), 2)).toBeCloseTo(2 / 8)
  })
})

describe('box entry', () => {
  const center = v(0, 0, 0), half = v(3, 0.5, 2)
  it('hits the first face crossed', () => {
    expect(boxEntry(v(-10, 0, 0), v(10, 0, 0), center, half)).toBeCloseTo(7 / 20)
    expect(boxEntry(v(0, 10, 0), v(0, -10, 0), center, half)).toBeCloseTo(9.5 / 20)
  })
  it('handles a segment parallel to a pair of faces', () => {
    expect(boxEntry(v(-10, 0.2, 1), v(10, 0.2, 1), center, half)).toBeCloseTo(7 / 20)
    expect(boxEntry(v(-10, 0.8, 1), v(10, 0.8, 1), center, half)).toBeNull()
  })
  it('reports 0 inside and misses past the corner', () => {
    expect(boxEntry(v(1, 0, 0), v(20, 0, 0), center, half)).toBe(0)
    expect(boxEntry(v(-10, 0, 10), v(10, 0, 3), center, half)).toBeNull()
  })
})

describe('swept segment against aircraft', () => {
  it('catches a fast round that would pass between two point samples (no tunnelling)', () => {
    // 1,000 m/s over one 1/120 s flight step moves 8.3 m, more than the F-22 fuselage is thick.
    const raptor = target('raptor', still(0), still(0), hitboxes.f22)
    const start = { x: 1, y: -1.1, z: -4.2 }, end = { x: 1, y: -1.1, z: 4.13 }
    expect(targetEntry(start, start, raptor)).toBeNull()
    expect(targetEntry(end, end, raptor)).toBeNull()
    expect(targetEntry(start, end, raptor)).not.toBeNull()
  })
  it('tests the path relative to a moving target', () => {
    // The round crosses x = 0; the target flies from x = -10 to +10 during the same step.
    const crossing = target('mover', still(-10), still(10))
    expect(targetEntry({ x: 0, y: 5, z: 0 }, { x: 0, y: -5, z: 0 }, crossing)).toBeCloseTo(0.5 - 1 / Math.hypot(20, 10))
    // A target that leaves before the round arrives is missed, although the round passes where it started.
    const leaving = target('leaver', still(0), still(30))
    expect(targetEntry({ x: 0, y: 5, z: 0 }, { x: 0, y: -5, z: 0 }, leaving)).toBeNull()
    // A target that flies into the round's end point is hit, although the round never passes where it started.
    const arriving = target('arriver', still(-30), still(0))
    expect(targetEntry({ x: 0, y: 5, z: 0 }, { x: 0, y: -0.5, z: 0 }, arriving)).not.toBeNull()
  })
  it('follows the target orientation', () => {
    // Rolled 90°, the wing of a 13.6 m span stands vertical: a vertical probe 6 m out now misses.
    const level = target('level', still(0), still(0), hitboxes.f22)
    const rolled: Pose = { position: { x: 0, y: 0, z: 0 }, orientation: (({ x, y, z, w }) => ({ x, y, z, w }))(new Quaternion().setFromAxisAngle(v(1, 0, 0), -Math.PI / 2)) }
    const probe = [{ x: -4.9, y: 20, z: 6 }, { x: -4.9, y: -20, z: 6 }] as const
    expect(targetEntry(probe[0], probe[1], level)).not.toBeNull()
    expect(targetEntry(probe[0], probe[1], target('rolled', rolled, rolled, hitboxes.f22))).toBeNull()
  })
})

describe('castSegment', () => {
  const world = (targets: CollisionTarget[], ignoreId?: string) => ({ groundY: 0, targets, ignoreId })
  it('returns the earliest of two aircraft in line', () => {
    const hit = castSegment({ x: 0, y: 100, z: 0 }, { x: 100, y: 100, z: 0 }, world([target('far', still(60, 100)), target('near', still(30, 100))]))
    expect(hit).toMatchObject({ kind: 'aircraft', entityId: 'near' })
    expect(hit?.point.x).toBeCloseTo(29)
  })
  it('stops at the ground before an aircraft behind it', () => {
    const hit = castSegment({ x: 0, y: 10, z: 0 }, { x: 40, y: -10, z: 0 }, world([target('behind', still(35, -7.5))]))
    expect(hit).toMatchObject({ kind: 'ground' })
    expect(hit?.t).toBeCloseTo(0.5)
  })
  it('ignores the shooter and passes through empty sky', () => {
    const shooter = target('shooter', still(0, 100))
    expect(castSegment({ x: 0, y: 100, z: 0 }, { x: 50, y: 100, z: 0 }, world([shooter], 'shooter'))).toBeNull()
    expect(castSegment({ x: 0, y: 100, z: 0 }, { x: 50, y: 100, z: 0 }, world([shooter]))).toMatchObject({ entityId: 'shooter', t: 0 })
  })
})
