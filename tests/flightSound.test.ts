import { describe, expect, it } from 'vitest'
import { closestApproach, dopplerRate } from '../src/render/audio/flightSound'

const at = (x: number, y = 0, z = 0) => ({ x, y, z })
const still = at(0)

describe('flight sound placement', () => {
  it('raises the pitch of a closing source and lowers it once past', () => {
    expect(dopplerRate(at(-500), at(200), still, still)).toBeGreaterThan(1)
    expect(dopplerRate(at(500), at(200), still, still)).toBeLessThan(1)
    // The listener closing on a still source raises it too.
    expect(dopplerRate(at(500), still, still, at(200))).toBeGreaterThan(1)
    expect(dopplerRate(at(500), at(100, 0, 0), still, at(100, 0, 0))).toBeCloseTo(1, 6)
  })

  it('keeps the shift inside half to double speed, even at sound speed', () => {
    expect(dopplerRate(at(-500), at(1000), still, still)).toBe(2)
    expect(dopplerRate(at(500), at(1000), still, still)).toBe(0.5)
    expect(dopplerRate(still, at(200), still, still)).toBe(1)
  })

  it('finds when and how near a crossing passes', () => {
    const pass = closestApproach(at(-600, 100, 0), at(300))
    expect(pass.time).toBeCloseTo(2, 6)
    expect(pass.distance).toBeCloseTo(100, 6)
    // Already past: the time is negative, so no fly-by is due.
    expect(closestApproach(at(600, 100, 0), at(300)).time).toBeLessThan(0)
    expect(closestApproach(at(0, 50, 0), still).time).toBe(Infinity)
  })
})
