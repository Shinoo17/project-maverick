import { describe, expect, it } from 'vitest'
import { Group, Object3D, Quaternion } from 'three'
import { GameRuntime } from '../src/game/runtime/GameRuntime'
import { getFlightProfile } from '../src/game/flight/profile'
import { createFlightRig } from '../src/render/aircraft/flightRig'

function fixture() {
  const model = new Group(), bone = new Group(), surface = new Object3D()
  surface.name = 'Wing_Aileron_L'; bone.add(surface); model.add(bone)
  const runtime = new GameRuntime({ mode: 'playground', aircraftIds: ['f22'] })
  const state = runtime.snapshot().aircraft[0]; runtime.dispose()
  return { bone, state, rig: createFlightRig(model, 'f22') }
}
const rollRate = getFlightProfile('f22').flight.rollRate
const degrees = (q: Quaternion) => q.angleTo(new Quaternion()) * 180 / Math.PI

describe('F-22 control surface response', () => {
  it('eases toward a commanded angle, reverses smoothly, and returns to rest on release', () => {
    const { bone, state, rig } = fixture()
    state.rates.roll = rollRate
    rig(state, 1 / 60)
    expect(degrees(bone.quaternion)).toBeGreaterThan(0)
    expect(degrees(bone.quaternion)).toBeLessThan(5)
    for (let i = 0; i < 60; i++) rig(state, 1 / 60)
    expect(degrees(bone.quaternion)).toBeCloseTo(25, 1)
    state.rates.roll = -rollRate
    rig(state, 1 / 60)
    expect(bone.quaternion.y).toBeGreaterThan(0)
    for (let i = 0; i < 60; i++) rig(state, 1 / 60)
    expect(bone.quaternion.y).toBeLessThan(0)
    state.rates.roll = 0
    for (let i = 0; i < 120; i++) rig(state, 1 / 60)
    expect(degrees(bone.quaternion)).toBeLessThan(.001)
  })
  it('matches at 30 and 144 fps and does not change simulation state', () => {
    const poses = [30, 144].map(fps => {
      const { bone, state, rig } = fixture()
      state.rates.roll = rollRate
      const before = structuredClone(state)
      for (let i = 0; i < fps / 2; i++) rig(state, 1 / fps)
      expect(state).toEqual(before)
      return bone.quaternion.clone()
    })
    expect(poses[0].angleTo(poses[1])).toBeLessThan(1e-7)
  })
  it('holds while paused, resets explicitly, and respects the deflection limit', () => {
    const { bone, state, rig } = fixture()
    state.rates.roll = rollRate
    rig(state, .1)
    const pose = bone.quaternion.clone()
    state.rates.roll = -rollRate
    rig(state, 0)
    expect(bone.quaternion.angleTo(pose)).toBeLessThan(1e-7)
    state.rates.roll = 0; rig(state, 0, true)
    expect(degrees(bone.quaternion)).toBe(0)
    state.rates.roll = rollRate * 10; rig(state, 0, true)
    expect(degrees(bone.quaternion)).toBeCloseTo(25)
  })
})
