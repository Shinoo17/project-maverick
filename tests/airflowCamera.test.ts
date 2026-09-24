import { expect, it } from 'vitest'
import { PerspectiveCamera } from 'three'
import { createAircraft } from '../benchmarks/flight/harness'
import { FlightCamera } from '../src/render/FlightCamera'

it('shows actual decoupling from airflow alone and respects reduced motion', () => {
  const state = createAircraft('f22')
  state.position.y = 2000
  state.velocity = { x: 0, y: 0, z: 100 }
  const render = (reduced = false) => {
    const before = structuredClone(state), camera = new PerspectiveCamera(), rig = new FlightCamera()
    for (let frame = 0; frame < 180; frame++) rig.update(camera, state, 'horizon', 1 / 60, reduced)
    expect(state).toEqual(before)
    expect([...camera.position.toArray(), ...camera.quaternion.toArray()].every(Number.isFinite)).toBe(true)
    return camera
  }
  expect(render().position.z).toBeLessThan(-20)
  expect(render(true).position.z).toBe(0)

  // Unreliable incidence at 1 m/s does not turn on cinematic; no phase fallback remains.
  state.velocity.z = 1
  expect(render().position.z).toBe(0)
})

it('diagnostic framing checks projected subject corners at high incidence/aspect ratios without touching simulation', async () => {
  const { Box3, Quaternion, Vector3 } = await import('three')
  const { projectedAircraftBounds } = await import('../src/render/FlightCamera')
  const bounds = new Box3(new Vector3(-9.45, -2.5, -7), new Vector3(9.45, 2.5, 7))
  for (const aspect of [9 / 16, 4 / 3, 16 / 9, 21 / 9]) for (const degrees of [30, 60, 90, 120, 180]) for (const reduced of [false, true]) for (const mode of ['horizon', 'aircraft'] as const) {
    const state = createAircraft('f22'), q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), degrees * Math.PI / 180)
    state.orientation = { x: q.x, y: q.y, z: q.z, w: q.w }
    const before = structuredClone(state), camera = new PerspectiveCamera(61, aspect, 0.5, 14000), rig = new FlightCamera(true)
    rig.update(camera, state, mode, 1 / 60, reduced, bounds)
    const corners = []
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) corners.push(new Vector3(x, y, z).applyQuaternion(q).add(new Vector3().copy(state.position)))
    const result = projectedAircraftBounds(camera, corners)
    expect(result.depthValid).toBe(true); expect(result.extent).toBeLessThanOrEqual(0.82)
    expect(state).toEqual(before)
  }
})
