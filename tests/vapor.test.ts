import { describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { GameRuntime } from '../src/game/runtime/GameRuntime'
import { flightVaporConditions, vaporActivation } from '../src/render/vapor/conditions'
import { vortexAirflow, vortexProfile } from '../src/render/vapor/profile'
const conditions = (speed = 180, aoa = 21, g = 6.8, humidity = .78) => ({ speed, aoa, g, sideslip: 0, humidity })
describe('condensation flight coupling', () => {
  it('keeps a thin core while load, incidence and moisture increase its length', () => {
    const low = vortexProfile(conditions(180, 6, 2))
    for (const c of [conditions(180, 28, 2), conditions(180, 6, 8)]) {
      const high = vortexProfile(c)
      expect(high.length).toBeGreaterThan(low.length)
      expect(high.radius).toBeGreaterThan(low.radius)
      expect(high.radius).toBeLessThan(.12)
      expect(high.turbulence).toBeGreaterThan(low.turbulence)
    }
    expect(vortexProfile(conditions(180, 20, 6, .8)).length).toBeGreaterThan(vortexProfile(conditions(180, 20, 6, .4)).length)
  })
  it('aligns the straight core with downstream air including signed AoA and sideslip', () => {
    const state = new GameRuntime({ mode: 'playground', mapId: 'flat-range', aircraftIds: ['f22'] }).snapshot().aircraft[0]
    for (const velocity of [new Vector3(150, -35, 40), new Vector3(150, 35, -40), new Vector3(0, -100, 0)]) {
      state.velocity = velocity
      const flow = vortexAirflow(flightVaporConditions(state), new Vector3())
      expect(flow.distanceTo(velocity.clone().normalize().negate())).toBeLessThan(1e-8)
    }
  })
  it('dissolves at cruise, stationary high-alpha, and reversed airflow', () => {
    expect(vaporActivation(conditions(220, 3, 1))).toBe(0)
    expect(vaporActivation(conditions(0, 40, 9))).toBe(0)
    expect(vaporActivation(conditions(180, 160, 9))).toBe(0)
    expect(vaporActivation(conditions(180, 24, 6, .18))).toBe(0)
  })
  it('responds independently to airspeed, incidence and measured load', () => {
    expect(vaporActivation(conditions(180, 20, 2))).toBeGreaterThan(vaporActivation(conditions(65, 20, 2)))
    expect(vaporActivation(conditions(180, 20, 2))).toBeGreaterThan(vaporActivation(conditions(180, 6, 2)))
    expect(vaporActivation(conditions(180, 6, 7))).toBeGreaterThan(vaporActivation(conditions(180, 6, 2)))
    expect(vaporActivation(conditions(106, 38, 3.5))).toBeGreaterThan(.2)
    expect(vaporActivation(conditions(180, 20, 6, .8))).toBeGreaterThan(vaporActivation(conditions(180, 20, 6, .4)))
  })
  it('uses signed local incidence and remains invariant when the entire flight is rotated', () => {
    const state = new GameRuntime({ mode: 'playground', mapId: 'flat-range', aircraftIds: ['f22'] }).snapshot().aircraft[0]
    state.velocity = { x: 150, y: -50, z: 15 }
    const original = flightVaporConditions(state)
    expect(original.aoa).toBeCloseTo(18.43495, 4)
    const q = new Quaternion().setFromAxisAngle(new Vector3(1, 2, 3).normalize(), 2.1)
    state.orientation = q; state.velocity = new Vector3().copy(state.velocity).applyQuaternion(q)
    const rotated = flightVaporConditions(state)
    expect(rotated.speed).toBeCloseTo(original.speed, 8)
    expect(rotated.aoa).toBeCloseTo(original.aoa, 8)
    expect(rotated.sideslip).toBeCloseTo(original.sideslip, 8)
  })
  it('does not mistake sideslip for AoA or mutate simulation telemetry', () => {
    const state = new GameRuntime({ mode: 'playground', mapId: 'flat-range', aircraftIds: ['f22'] }).snapshot().aircraft[0]
    state.velocity = { x: 150, y: 0, z: 80 }; state.maneuver.alpha = 28
    const before = structuredClone(state), sample = flightVaporConditions(state)
    expect(sample.aoa).toBeCloseTo(0)
    expect(sample.sideslip).toBeGreaterThan(.4)
    expect(state).toEqual(before)
    state.velocity.y = 50
    expect(flightVaporConditions(state).aoa).toBeLessThan(0)
  })
})
