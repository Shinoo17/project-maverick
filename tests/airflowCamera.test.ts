import { expect, it } from 'vitest'
import { PerspectiveCamera, Quaternion, Vector3 } from 'three'
import { createAircraft, runScenario } from '../benchmarks/flight/harness'
import { FlightCamera, type CameraRollMode } from '../src/render/FlightCamera'
import { FLIGHT_STEP } from '../src/game/runtime/clock'
import { projectVelocityMarker } from '../src/features/flight/hudPainter'
import type { AircraftState } from '../src/game/state/WorldState'

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
  // Nose +X, path +Z (90° incidence). Phase 7 migration: the view used to sit 88% of the way to
  // the path by a plain lerp (z < -20). It now runs down the path, turned back toward the nose
  // by a residual, so it sits nearer the path than the nose.
  const decoupled = render(), look = new Vector3(0, 0, -1).applyQuaternion(decoupled.quaternion)
  expect(decoupled.position.z).toBeLessThan(-20)
  expect(look.angleTo(new Vector3(0, 0, 1))).toBeLessThan(look.angleTo(new Vector3(1, 0, 0)))
  expect(render(true).position.z).toBe(0)
  expect(render(true).fov).toBe(61)

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

/** Level flight along +X, nose pitched up by incidence in the vertical plane (alpha = incidence). */
function seeded(incidenceDeg: number, bankDeg = 0, speed = 100) {
  const state = createAircraft('f22')
  state.position = { x: 0, y: 3000, z: 0 }
  state.velocity = { x: speed, y: 0, z: 0 }
  const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), bankDeg * Math.PI / 180)
    .premultiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), incidenceDeg * Math.PI / 180))
  state.orientation = { x: q.x, y: q.y, z: q.z, w: q.w }
  return state
}
const settle = (state: AircraftState, mode: CameraRollMode = 'horizon', aspect = 16 / 9, frames = 240) => {
  const camera = new PerspectiveCamera(69, aspect, 0.5, 14000), rig = new FlightCamera()
  for (let frame = 0; frame < frames; frame++) rig.update(camera, state, mode, 1 / 60)
  camera.updateMatrixWorld()
  return camera
}
const nose = (state: AircraftState) => new Vector3(1, 0, 0).applyQuaternion(new Quaternion().copy(state.orientation))
const aboutNose = (state: AircraftState, vector: Vector3) => {
  const n = nose(state)
  return vector.clone().addScaledVector(n, -vector.dot(n)).normalize()
}
const cameraUp = (state: AircraftState, camera: PerspectiveCamera) => aboutNose(state, new Vector3(0, 1, 0).applyQuaternion(camera.quaternion))
const levelUp = (state: AircraftState) => aboutNose(state, new Vector3(0, 1, 0))
const bodyUp = (state: AircraftState) => new Vector3(0, 1, 0).applyQuaternion(new Quaternion().copy(state.orientation))

it('frames the airframe at 30/60/90/120/180 incidence and keeps the FPM in view at every incidence', () => {
  const corners: Vector3[] = []
  for (const x of [-9.45, 9.45]) for (const y of [-3, 3]) for (const z of [-7.5, 7.5]) corners.push(new Vector3(x, y, z))
  for (const aspect of [4 / 3, 16 / 9]) for (const incidence of [30, 60, 90, 120, 180]) {
    const state = seeded(incidence), before = structuredClone(state), camera = settle(state, 'horizon', aspect)
    const q = new Quaternion().copy(state.orientation), origin = new Vector3().copy(state.position)
    for (const corner of corners) {
      const ndc = corner.clone().applyQuaternion(q).add(origin).project(camera)
      expect(ndc.z).toBeGreaterThan(-1); expect(ndc.z).toBeLessThan(1)
      expect(Math.max(Math.abs(ndc.x), Math.abs(ndc.y))).toBeLessThan(1)
    }
    const width = 900 * aspect
    const pipper = projectVelocityMarker(camera, origin, nose(state).multiplyScalar(2), width, 900, 24)!
    const fpm = projectVelocityMarker(camera, origin, state.velocity, width, 900, 24)!
    // The view runs down the path: the FPM stays framed; the nose only while the drift is shallow.
    expect(fpm.onScreen).toBe(true)
    if (incidence <= 30) expect(pipper.onScreen).toBe(true)
    expect(state).toEqual(before)
  }
})

it('never flips the view through reverse flow (the 0.88 share crossed zero at 180°)', () => {
  for (const aircraftId of ['f22', 'su57']) {
    const trace = runScenario('tailSlide', aircraftId)
    const camera = new PerspectiveCamera(69, 16 / 9, 0.5, 14000), rig = new FlightCamera()
    let last: Quaternion | null = null
    for (let i = 0; i < trace.samples.length; i += 2) {
      rig.update(camera, trace.samples[i].state, 'horizon', 2 * FLIGHT_STEP)
      expect(camera.quaternion.toArray().every(Number.isFinite)).toBe(true)
      // 0.1 rad per 1/60 s is ~340°/s; the flip moved ~0.25 rad in one frame.
      if (last) expect(last.angleTo(camera.quaternion)).toBeLessThan(0.1)
      last = camera.quaternion.clone()
    }
  }
  // Sweep the path around the tail on both sides of 180°: continuous, never degenerate.
  let last: Quaternion | null = null
  const camera = new PerspectiveCamera(69, 16 / 9, 0.5, 14000), rig = new FlightCamera()
  for (let step = 0; step <= 240; step++) {
    const state = seeded(160 + step / 6)
    rig.update(camera, state, 'horizon', 1 / 60)
    // The look turns at most 4π/3 rad/s (0.07 rad per frame, plus slerp catch-up); a flip would be ~π.
    if (last) expect(last.angleTo(camera.quaternion)).toBeLessThan(0.1)
    last = camera.quaternion.clone()
  }
})

const viewUp = (camera: PerspectiveCamera) => {
  const view = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion)
  return { view, up: new Vector3(0, 1, 0).applyQuaternion(camera.quaternion), level: new Vector3(0, 1, 0).addScaledVector(view, -view.y).normalize() }
}

it('horizon mode holds the horizon at every AoA; aircraft mode rides the airframe', () => {
  for (const [incidence, bank] of [[0, 60], [60, 90], [60, 180], [120, 45]]) {
    const state = seeded(incidence, bank), before = structuredClone(state)
    const { up, level } = viewUp(settle(state))
    expect(up.angleTo(level)).toBeLessThan(0.02)
    const aircraft = viewUp(settle(state, 'aircraft')), body = bodyUp(state).addScaledVector(aircraft.view, -bodyUp(state).dot(aircraft.view))
    // The aim point sits a little above the look line, so allow a few degrees.
    if (body.lengthSq() > 0.05) expect(aircraft.up.angleTo(body.normalize())).toBeLessThan(0.15)
    expect(state).toEqual(before)
  }
  // Reduced motion holds it as well, on the nose.
  const drift = seeded(60, 90), camera = new PerspectiveCamera(69, 16 / 9, 0.5, 14000), rig = new FlightCamera()
  rig.update(camera, drift, 'horizon', 1 / 60, true)
  expect(cameraUp(drift, camera).angleTo(levelUp(drift))).toBeLessThan(0.02)
})

it('carries its up through a vertical path and rolls back to level no faster than π rad/s', () => {
  // Attached loop over the top: the view crosses vertical, then settles inverted-level.
  const state = seeded(0), camera = new PerspectiveCamera(69, 16 / 9, 0.5, 14000), rig = new FlightCamera()
  let last: Vector3 | null = null
  for (let frame = 0; frame <= 600; frame++) {
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.min(frame, 240) * Math.PI / 240)
    state.orientation = { x: q.x, y: q.y, z: q.z, w: q.w }
    const n = new Vector3(1, 0, 0).applyQuaternion(q).multiplyScalar(100)
    state.velocity = { x: n.x, y: n.y, z: n.z }
    rig.update(camera, state, 'horizon', 1 / 60)
    const { view, up } = viewUp(camera)
    expect(camera.quaternion.toArray().every(Number.isFinite)).toBe(true)
    if (last) expect(last.clone().addScaledVector(view, -last.dot(view)).normalize().angleTo(up)).toBeLessThanOrEqual(Math.PI / 60 + 1e-3)
    last = up
  }
  expect(viewUp(camera).up.angleTo(viewUp(camera).level)).toBeLessThan(0.05)
})
