import { describe, expect, it } from 'vitest'
import { CloudSideTransition } from '../src/render/vapor/CloudSideTransition'

const fade = .45
describe('cloud side changes across signed incidence', () => {
  it('fades the old side out gradually in either reversal direction', () => {
    for (const sign of [-1, 1]) {
      const side = new CloudSideTransition()
      const start = side.update(sign * 21, 0, fade)
      const next = side.update(-sign * 21, 1 / 60, fade)
      expect(Math.abs(next - start)).toBeLessThan(.06)
      expect(next).toBeGreaterThan(0)
      expect(next).toBeLessThan(1)
      let previous = next
      for (let frame = 0; frame < 120; frame++) {
        const value = side.update(-sign * 21, 1 / 60, fade)
        expect((value - previous) * sign).toBeLessThanOrEqual(0)
        expect(value).toBeGreaterThanOrEqual(0)
        expect(value).toBeLessThanOrEqual(1)
        previous = value
      }
      expect(previous).toBeCloseTo(sign > 0 ? 0 : 1, 2)
    }
  })

  it('does not flicker between sides on small zero-crossing jitter', () => {
    const side = new CloudSideTransition()
    side.update(0, 0, fade)
    for (let frame = 0; frame < 240; frame++) {
      const previous = side.upperWeight
      const next = side.update(frame % 2 ? -.1 : .1, 1 / 60, fade)
      expect(Math.abs(next - previous)).toBeLessThan(.003)
      expect(next).toBeGreaterThan(.49)
      expect(next).toBeLessThan(.51)
    }
  })

  it('is continuous across the old -1 degree switch', () => {
    const upper = new CloudSideTransition().update(-.999, 0, fade)
    const lower = new CloudSideTransition().update(-1.001, 0, fade)
    expect(Math.abs(upper - lower)).toBeLessThan(.001)
  })

  it('preserves progress when interrupted, freezes on pause and clears on reset', () => {
    const side = new CloudSideTransition()
    side.update(21, 0, fade)
    const midway = side.update(-21, .2, fade)
    expect(side.update(21, 0, fade)).toBe(midway)
    const reverseAgain = side.update(21, 1 / 60, fade)
    expect(reverseAgain).toBeGreaterThan(midway)
    expect(reverseAgain - midway).toBeLessThan(.06)
    side.reset()
    expect(side.update(-21, 0, fade)).toBe(0)
  })

  it('gives the same blend for equal simulation time at different render rates', () => {
    const sample = (hz: number) => {
      const side = new CloudSideTransition()
      side.update(21, 0, fade)
      for (let i = 0; i < hz / 2; i++) side.update(-21, 1 / hz, fade)
      return side.upperWeight
    }
    expect(sample(30)).toBeCloseTo(sample(60), 12)
    expect(sample(144)).toBeCloseTo(sample(60), 12)
  })
})
