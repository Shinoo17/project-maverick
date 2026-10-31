import { describe, expect, it } from 'vitest'
import { approachGain, closestApproach, dopplerRate, explosionSound, nextPop, softenRate } from '../src/render/audio/flightSound'

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

  it('softens a shift towards no shift by the share given', () => {
    expect(softenRate(2, 0.3)).toBeCloseTo(1.3, 6)
    expect(softenRate(0.5, 0.3)).toBeCloseTo(0.85, 6)
    expect(softenRate(1, 0.3)).toBe(1)
    expect(softenRate(2, 1)).toBe(2)
  })

  it('swells a passing missile from faint to full on the pass', () => {
    expect(approachGain(2.5)).toBeCloseTo(0.04, 6)
    expect(approachGain(0.5)).toBeCloseTo(0.3, 6)
    expect(approachGain(0)).toBeCloseTo(1, 6)
    // Further ahead than the lead stays faint; every step nearer is louder.
    expect(approachGain(5)).toBeCloseTo(0.04, 6)
    for (let ahead = 2.5; ahead > 0.05; ahead -= 0.05) expect(approachGain(ahead - 0.05)).toBeGreaterThan(approachGain(ahead))
  })

  it('finds when and how near a crossing passes', () => {
    const pass = closestApproach(at(-600, 100, 0), at(300))
    expect(pass.time).toBeCloseTo(2, 6)
    expect(pass.distance).toBeCloseTo(100, 6)
    // Already past: the time is negative, so no fly-by is due.
    expect(closestApproach(at(600, 100, 0), at(300)).time).toBeLessThan(0)
    expect(closestApproach(at(0, 50, 0), still).time).toBe(Infinity)
  })

  it('picks the missile burst recording by distance, near to far', () => {
    expect(explosionSound(0)).toBe('explosionNear')
    expect(explosionSound(599)).toBe('explosionNear')
    expect(explosionSound(600)).toBe('explosionMid')
    expect(explosionSound(1999)).toBe('explosionMid')
    expect(explosionSound(2000)).toBe('explosionFar')
    expect(explosionSound(20000)).toBe('explosionFar')
  })
  it('never plays the same flare pop twice running', () => {
    for (let last = 0; last < 6; last++) for (let r = 0; r < 1; r += 0.01) {
      const pop = nextPop(last, 6, r)
      expect(pop).not.toBe(last)
      expect(pop).toBeGreaterThanOrEqual(0)
      expect(pop).toBeLessThan(6)
    }
    // Every other pop can come next.
    expect(new Set(Array.from({ length: 100 }, (_, i) => nextPop(2, 6, i / 100))).size).toBe(5)
    expect(nextPop(-1, 6, 0.99)).toBe(5)
  })
})
