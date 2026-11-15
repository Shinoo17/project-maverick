import { describe, expect, it } from 'vitest'
import { Bone, Group, Object3D, PerspectiveCamera, Quaternion, Vector3 } from 'three'
import { createFlightRig } from '../src/render/aircraft/flightRig'
import { GameRuntime } from '../src/game/runtime/GameRuntime'
import { neutralCommand, type PilotCommand } from '../src/game/runtime/commands'
import { FlightCamera } from '../src/render/FlightCamera'
import type { CameraSettings } from '../src/game/camera/cameraSettings'
import { stepFlight } from '../src/game/flight/stepFlight'
import { en } from '../src/locales/en'
import { th } from '../src/locales/th'

// The two pre-style modes: a level lens is Horizon locked Dynamic, riding the airframe is Aircraft locked.
const HORIZON: CameraSettings = { mode: 'horizon', roll: 'horizon', horizonStyle: 'dynamic' }
const AIRCRAFT: CameraSettings = { mode: 'aircraft', roll: 'aircraft', horizonStyle: 'balanced' }
const make = () => new GameRuntime({ mode: 'playground', mapId: 'flat-range', aircraftIds: ['f22'] })
function run(fps: number, seconds: number, track: (tick: number) => Partial<PilotCommand> = () => ({})) {
  const runtime = make(); runtime.start()
  for (let i = 0; i < fps * seconds; i++) runtime.advance(1 / fps, (tick, id) => ({ ...neutralCommand(tick, id), ...track(tick) }))
  return runtime
}
describe('P1 flight acceptance', () => {
  it('replays a changing command track identically at 30/60/144 FPS', () => {
    const track = (tick: number) => ({ speedAdjust: tick < 60 ? 1 : tick < 120 ? -1 : 0, pitch: tick > 150 && tick < 230 ? 0.4 : 0, roll: tick > 250 && tick < 310 ? 0.6 : 0, yaw: tick > 400 ? -0.2 : 0 })
    const results = [30, 60, 144].map(fps => run(fps, 10, track).snapshot())
    expect(results[0].tick).toBe(600); expect(results[1]).toEqual(results[0]); expect(results[2]).toEqual(results[0])
    expect(results[0].aircraft[0].alive).toBe(true)
  })
  // Instant-thrust numeric expectations moved to legacySpeed.report.ts for Phase 3 spool.
  it('maps canonical axes correctly and preserves nose/path separation', () => {
    const pitch = run(60, 1, () => ({ pitch: 1 })).snapshot().aircraft[0]
    const forward = new Vector3(1, 0, 0).applyQuaternion(new Quaternion().copy(pitch.orientation))
    expect(forward.y).toBeGreaterThan(0.3)
    const slip = forward.angleTo(new Vector3().copy(pitch.velocity))
    expect(slip).toBeGreaterThan(0.015)
    expect(slip).toBeLessThan(10 * Math.PI / 180)
    expect(pitch.position.y).toBeGreaterThan(400)
    const yaw = run(60, 1, () => ({ yaw: 1 })).snapshot().aircraft[0]
    expect(yaw.position.z).toBeGreaterThan(0)
    const roll = run(60, 1, () => ({ roll: 1 })).snapshot().aircraft[0]
    const right = new Vector3(0, 0, 1).applyQuaternion(new Quaternion().copy(roll.orientation))
    expect(right.y).toBeLessThan(0)
  })
  it('loses speed in a climb and lets airbrake oppose engine acceleration', () => {
    const straight = run(60, 2).snapshot().aircraft[0], climb = run(60, 2, () => ({ pitch: 0.6 })).snapshot().aircraft[0]
    const magnitude = (s: typeof straight) => new Vector3().copy(s.velocity).length()
    expect(magnitude(climb)).toBeLessThan(magnitude(straight))
    const brake = run(60, 2, () => ({ airbrake: true, afterburner: true, speedAdjust: 1 })).snapshot().aircraft[0]
    const powered = run(60, 2, () => ({ afterburner: true, speedAdjust: 1 })).snapshot().aircraft[0]
    expect(magnitude(brake)).toBeLessThan(magnitude(powered)); expect(brake.enginePower).toBeGreaterThan(0)
    const idleBrake = run(60, 2, () => ({ airbrake: true })).snapshot().aircraft[0]
    expect(magnitude(idleBrake)).toBeLessThan(100)
  })
  it('is finite at zero speed, stops on ground/boundary, and resets safely', () => {
    const runtime = make(), state = runtime.snapshot().aircraft[0]
    state.velocity = { x: 0, y: 0, z: 0 }
    for (let i = 0; i < 120; i++) stepFlight(state, neutralCommand(i, state.id), 1 / 120)
    expect(Object.values(state.velocity).every(Number.isFinite)).toBe(true)
    state.position.y = 1; stepFlight(state, neutralCommand(0, state.id), 1 / 120)
    expect(state.stopReason).toBe('terrain')
    const boundary = run(60, 63).snapshot().aircraft[0]
    expect(boundary.stopReason).toBe('boundary')
    runtime.start(); runtime.advance(0.05); runtime.pause(); const before = runtime.snapshot(); runtime.advance(40)
    expect(runtime.snapshot()).toEqual(before)
    runtime.reset(); expect(runtime.snapshot()).toEqual(make().snapshot())
  })
  it('drives cloned hinges from state without changing another aircraft', () => {
    const model = new Group(), bone = new Bone(), mesh = new Object3D()
    mesh.name = 'Wing_Aileron_L'; bone.add(mesh); model.add(bone)
    const other = model.clone(true), state = make().snapshot().aircraft[0]
    state.rates.roll = 1
    const before = structuredClone(state)
    createFlightRig(model, 'f22')(state, .3) // allow the presentation actuator to settle
    expect(bone.quaternion.angleTo(new Quaternion())).toBeGreaterThan(0.1)
    expect(other.children[0].quaternion.toArray()).toEqual([0, 0, 0, 1])
    expect(state).toEqual(before)
  })
  it('keeps the whole airframe in frame at a steady chase distance from rest to top speed', () => {
    // The flight model is normalised to 18.9 units on its longest axis; span and height are generous.
    const corners: Vector3[] = []
    for (const x of [-9.45, 9.45]) for (const y of [-3, 3]) for (const z of [-7.5, 7.5]) corners.push(new Vector3(x, y, z))
    const distances: number[] = []
    for (const view of [HORIZON, AIRCRAFT, { mode: 'horizon', roll: 'horizon', horizonStyle: 'balanced' }] satisfies CameraSettings[]) for (const speed of [0, 65, 200, 380]) {
      for (const aspect of [16 / 9, 4 / 3]) {
        const state = make().snapshot().aircraft[0], camera = new PerspectiveCamera(69, aspect, 0.5, 14000), rig = new FlightCamera()
        const q = new Quaternion().copy(state.orientation), forward = new Vector3(1, 0, 0).applyQuaternion(q)
        state.position = { x: 0, y: 1000, z: 0 }
        state.velocity = { x: forward.x * speed, y: forward.y * speed, z: forward.z * speed }
        for (let i = 0; i < 600; i++) {
          state.position = { x: state.position.x + state.velocity.x / 60, y: state.position.y + state.velocity.y / 60, z: state.position.z + state.velocity.z / 60 }
          rig.update(camera, state, view, 1 / 60)
        }
        camera.updateMatrixWorld()
        const origin = new Vector3().copy(state.position)
        for (const corner of corners) {
          const ndc = corner.clone().applyQuaternion(q).add(origin).project(camera)
          expect(Math.max(Math.abs(ndc.x), Math.abs(ndc.y))).toBeLessThan(0.95)
          expect(ndc.z).toBeLessThan(1)
        }
        if (aspect === 16 / 9 && view === HORIZON) distances.push(camera.position.distanceTo(origin))
      }
    }
    expect(distances[0]).toBeGreaterThan(22)
    expect(Math.max(...distances)).toBeLessThan(distances[0] + 4)
  })
  it('returns to upright horizon after crossing vertical and settling inverted', () => {
    const state = make().snapshot().aircraft[0], camera = new PerspectiveCamera(), rig = new FlightCamera()
    for (let i = 0; i <= 960; i++) {
      const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.min(i, 360) * Math.PI / 360)
      state.orientation = { x: q.x, y: q.y, z: q.z, w: q.w }
      // Attached flow along the nose: this case is about the vertical crossing. Since Phase 7 the
      // view runs down the flight path once decoupled, so a nose turned against a fixed velocity
      // would be testing reverse flow instead.
      const nose = new Vector3(1, 0, 0).applyQuaternion(q).multiplyScalar(100)
      state.velocity = { x: nose.x, y: nose.y, z: nose.z }
      rig.update(camera, state, HORIZON, 1 / 60)
    }
    expect(new Vector3(0, 1, 0).applyQuaternion(camera.quaternion).y).toBeGreaterThan(0.95)
  })
  it('camera modes never mutate the aircraft and remain finite through vertical flight', () => {
    const state = make().snapshot().aircraft[0], camera = new PerspectiveCamera()
    for (const mode of [HORIZON, AIRCRAFT, { mode: 'horizon', roll: 'horizon', horizonStyle: 'balanced' }] satisfies CameraSettings[]) {
      const rig = new FlightCamera()
      let last: Quaternion | null = null
      for (let i = 0; i <= 720; i++) {
        const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), i * Math.PI / 360)
        state.orientation = { x: q.x, y: q.y, z: q.z, w: q.w }
        const before = structuredClone(state)
        rig.update(camera, state, mode, 1 / 60)
        expect(state).toEqual(before)
        expect(camera.quaternion.toArray().every(Number.isFinite)).toBe(true)
        if (last) expect(last.angleTo(camera.quaternion)).toBeLessThan(0.2)
        last = camera.quaternion.clone()
      }
    }
  })
})
describe('locales', () => {
  it('ships matching nonempty Thai and English keys and placeholders', () => {
    expect(Object.keys(th).sort()).toEqual(Object.keys(en).sort())
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(th[key].trim()).not.toBe(''); expect(th[key].match(/\{\{.*?\}\}/g)).toEqual(en[key].match(/\{\{.*?\}\}/g))
    }
  })
})

describe('flight envelope', () => {
  it('retains speed-dependent control authority and stays finite through the vertical', () => {
    const samples = [30, 130, 240].map(speed => {
      const state = make().snapshot().aircraft[0]
      state.velocity.x = speed
      stepFlight(state, { ...neutralCommand(0, state.id), pitch: 1 }, 1 / 120)
      return state.rates.pitch
    })
    expect(samples[1]).toBeGreaterThan(samples[0]); expect(samples[1]).toBeGreaterThan(samples[2])
    const state = make().snapshot().aircraft[0]
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2)
    state.orientation = { x: q.x, y: q.y, z: q.z, w: q.w }
    for (let i = 0; i < 120; i++) stepFlight(state, { ...neutralCommand(i, state.id), roll: 1 }, 1 / 120)
    expect(Object.values(state.orientation).every(Number.isFinite)).toBe(true)
  })
  it('sanitises a malformed command before it reaches the model', () => {
    const invalid = run(60, 1, () => ({ pitch: NaN, roll: Infinity, yaw: -Infinity, speedAdjust: NaN })).snapshot().aircraft[0]
    expect(Object.values(invalid.velocity).every(Number.isFinite)).toBe(true)
    expect(Object.values(invalid.orientation).every(Number.isFinite)).toBe(true)
    expect(invalid.alive).toBe(true)
    const clamped = run(60, 1, () => ({ roll: 40 })).snapshot().aircraft[0]
    expect(clamped).toEqual(run(60, 1, () => ({ roll: 1 })).snapshot().aircraft[0])
  })
})
