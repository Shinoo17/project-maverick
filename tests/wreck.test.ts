import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { GROUND_Y } from '../src/game/combat/projectiles'
import { advanceWreck, createWreck, wreckFall } from '../src/render/vfx/wreck'

const level = { position: { x: 0, y: 400, z: 0 }, velocity: { x: 150, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } }
/** Steps a wreck in frames of `frame` seconds until it lands; returns its landing time and pose. */
function fall(frame: number, seed = 0) {
  const wreck = createWreck(level, 0, seed)
  let now = 0
  while (!advanceWreck(wreck, now += frame) && now < 60) { /* keep falling */ }
  return { now, wreck }
}

describe('falling wreck', () => {
  it('falls from 400 m to the ground in a few seconds and stops there', () => {
    const { wreck } = fall(1 / 60)
    expect(wreck.landed).toBe(true)
    expect(wreck.time).toBeGreaterThan(5)
    expect(wreck.time).toBeLessThan(9)
    expect(wreck.position.y).toBe(GROUND_Y + wreckFall.landing)
    // It carried on along its path while it fell.
    expect(wreck.position.x).toBeGreaterThan(400)
  })
  it('falls the same way at any frame rate', () => {
    const a = fall(1 / 30).wreck, b = fall(1 / 144).wreck
    expect(a.time).toBeCloseTo(b.time, 6)
    expect(a.position.distanceTo(b.position)).toBeLessThan(1e-6)
    expect(a.orientation.angleTo(b.orientation)).toBeLessThan(1e-6)
  })
  it('tumbles: rolls, either way by seed, and points its nose down the fall', () => {
    const wreck = createWreck(level, 0, 0), other = createWreck(level, 0, 1)
    advanceWreck(wreck, 3); advanceWreck(other, 3)
    const up = (q: typeof wreck.orientation) => new Vector3(0, 1, 0).applyQuaternion(q)
    expect(up(wreck.orientation).y).toBeLessThan(0.99)
    expect(Math.sign(up(wreck.orientation).z)).not.toBe(Math.sign(up(other.orientation).z))
    const nose = new Vector3(1, 0, 0).applyQuaternion(wreck.orientation)
    expect(nose.y).toBeLessThan(-0.2)
  })
})
