import { describe, expect, it } from 'vitest'
import { allocate, axes, zeroAxes, type AllocationBudget } from '../src/game/flight/allocation'

const triple = (v: number) => ({ pitch: v, yaw: v, roll: v })
const budget = (aero: number, tvc: number): AllocationBudget => ({ physicalAero: triple(aero), tvc: triple(tvc), arcadeFloor: { acceleration: triple(0.3), maxRate: triple(0.2) } })
describe('allocation invariants', () => {
  it('I12/I14: bounds every signed share, conserves request and fills only the capacity gap', () => {
    for (const real of [0, 0.1, 0.3, 2]) for (const thrust of [0, 0.1, 3]) for (const demand of [-10, -0.1, 0, 0.1, 10]) {
      const b = budget(real, thrust), r = allocate(triple(demand), b, zeroAxes(), zeroAxes(), 1 / 120)
      for (const axis of axes) {
        expect(Math.abs(r.aero[axis])).toBeLessThanOrEqual(real)
        expect(Math.abs(r.tvc[axis])).toBeLessThanOrEqual(thrust)
        expect(Math.abs(r.floor[axis])).toBeLessThanOrEqual(Math.max(0, 0.3 - real - thrust))
        expect(r.aero[axis] + r.tvc[axis] + r.floor[axis] + r.unmet[axis]).toBeCloseTo(demand, 12)
        expect(Math.abs(r.aero[axis] + r.tvc[axis] + r.floor[axis])).toBeLessThanOrEqual(Math.abs(demand))
      }
    }
  })
  it('aero-first uses no TVC when aero suffices; participation uses the same total budget', () => {
    expect(allocate(triple(2), budget(3, 3), zeroAxes(), zeroAxes(), 1 / 120).tvc).toEqual(zeroAxes())
    const r = allocate(triple(2), budget(3, 3), triple(0.25), zeroAxes(), 1 / 120)
    expect(r.tvc).toEqual(triple(0.5)); expect(r.aero).toEqual(triple(1.5))
  })
  it('I14: floor cannot integrate beyond its ceiling, including near the boundary and reversals', () => {
    for (const sign of [-1, 1]) {
      const rates = triple(sign * 0.1999), b = budget(0, 0)
      for (let i = 0; i < 1200; i++) {
        const r = allocate(triple(sign * 10), b, zeroAxes(), rates, 1 / 120)
        for (const axis of axes) {
          rates[axis] += r.floor[axis] / 120
          expect(Math.abs(rates[axis])).toBeLessThanOrEqual(0.2 + 1e-12)
        }
      }
      expect(allocate(triple(sign), b, zeroAxes(), triple(sign), 1 / 120).floor).toEqual(triple(sign * 0))
      const reverse = allocate(triple(-sign), b, zeroAxes(), triple(sign), 1 / 120)
      expect(Math.sign(reverse.floor.pitch)).toBe(-sign)
    }
  })
})
