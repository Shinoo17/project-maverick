import { describe, expect, it } from 'vitest'
import { Bone, Group, Object3D, PerspectiveCamera, Quaternion, Vector3 } from 'three'
import { createFlightRig } from '../src/render/aircraft/flightRig'
import { GameRuntime } from '../src/game/runtime/GameRuntime'
import { neutralCommand, type PilotCommand } from '../src/game/runtime/commands'
import { FlightInput } from '../src/game/input/FlightInput'
import { FlightCamera } from '../src/render/FlightCamera'
import { stepFlight } from '../src/game/flight/stepFlight'
import { en } from '../src/locales/en'
import { th } from '../src/locales/th'
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
  it('changes target by 30 m/s in one second, retains it on release, and spools actual speed', () => {
    const runtime = run(60, 1, () => ({ speedAdjust: 1 }))
    const state = runtime.snapshot().aircraft[0]
    expect(state.targetSpeedMps).toBeCloseTo(160)
    expect(Math.hypot(...Object.values(state.velocity))).toBeLessThan(160)
    for (let i = 0; i < 60; i++) runtime.advance(1 / 60)
    expect(runtime.snapshot().aircraft[0].targetSpeedMps).toBeCloseTo(160)
    expect(run(60, 8, () => ({ speedAdjust: 1 })).snapshot().aircraft[0].targetSpeedMps).toBe(200)
    expect(run(60, 8, () => ({ speedAdjust: -1 })).snapshot().aircraft[0].targetSpeedMps).toBe(65)
  })
  it('maps canonical axes correctly and preserves nose/path separation', () => {
    const pitch = run(60, 1, () => ({ pitch: 1 })).snapshot().aircraft[0]
    const forward = new Vector3(1, 0, 0).applyQuaternion(new Quaternion().copy(pitch.orientation))
    expect(forward.y).toBeGreaterThan(0.3)
    expect(forward.angleTo(new Vector3().copy(pitch.velocity))).toBeGreaterThan(0.1)
    expect(pitch.position.y).toBeGreaterThan(400)
    const yaw = run(60, 1, () => ({ yaw: 1 })).snapshot().aircraft[0]
    expect(yaw.position.z).toBeGreaterThan(0)
    const roll = run(60, 1, () => ({ roll: 1 })).snapshot().aircraft[0]
    const right = new Vector3(0, 0, 1).applyQuaternion(new Quaternion().copy(roll.orientation))
    expect(right.y).toBeLessThan(0)
  })
  it('loses speed in a climb and gives airbrake priority without changing the target', () => {
    const straight = run(60, 2).snapshot().aircraft[0], climb = run(60, 2, () => ({ pitch: 0.6 })).snapshot().aircraft[0]
    const magnitude = (s: typeof straight) => new Vector3().copy(s.velocity).length()
    expect(magnitude(climb)).toBeLessThan(magnitude(straight))
    const brake = run(60, 2, () => ({ airbrake: true, afterburner: true })).snapshot().aircraft[0]
    expect(magnitude(brake)).toBeLessThan(100); expect(brake.targetSpeedMps).toBe(130)
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
    createFlightRig(model)(state)
    expect(bone.quaternion.angleTo(new Quaternion())).toBeGreaterThan(0.1)
    expect(other.children[0].quaternion.toArray()).toEqual([0, 0, 0, 1])
    expect(state).toEqual(before)
  })
  it('returns to upright horizon after crossing vertical and settling inverted', () => {
    const state = make().snapshot().aircraft[0], camera = new PerspectiveCamera(), rig = new FlightCamera()
    for (let i = 0; i <= 960; i++) {
      const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.min(i, 360) * Math.PI / 360)
      state.orientation = { x: q.x, y: q.y, z: q.z, w: q.w }
      rig.update(camera, state, 'horizon', 1 / 60)
    }
    expect(new Vector3(0, 1, 0).applyQuaternion(camera.quaternion).y).toBeGreaterThan(0.95)
  })
  it('camera modes never mutate the aircraft and remain finite through vertical flight', () => {
    const state = make().snapshot().aircraft[0], camera = new PerspectiveCamera()
    for (const mode of ['horizon', 'aircraft'] as const) {
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
describe('input and locales', () => {
  it('cancels opposite keys, overrides mouse and clears held/stick state', () => {
    const input = new FlightInput(); input.move(240, -240)
    expect(Math.hypot(input.stick.x, input.stick.y)).toBeCloseTo(1)
    input.held.add('ArrowUp'); input.held.add('ArrowDown'); input.held.add('KeyA'); input.held.add('KeyD'); input.held.add('KeyW'); input.held.add('KeyS')
    const command = input.command(0, 'aircraft-1', 'mouse')
    expect([command.pitch, command.roll, command.speedAdjust]).toEqual([0, 0, 0])
    input.clear(); expect(input.command(0, 'aircraft-1', 'mouse')).toEqual(neutralCommand(0, 'aircraft-1'))
  })
  it('uses the same axes for keyboard-only and keyboard overrides in mouse preset', () => {
    const input = new FlightInput(); input.held.add('ArrowUp'); input.held.add('KeyD'); input.held.add('KeyW')
    expect(input.command(1, 'a', 'mouse')).toEqual(input.command(1, 'a', 'keyboard'))
  })
  it('ships matching nonempty Thai and English keys and placeholders', () => {
    expect(Object.keys(th).sort()).toEqual(Object.keys(en).sort())
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(th[key].trim()).not.toBe(''); expect(th[key].match(/\{\{.*?\}\}/g)).toEqual(en[key].match(/\{\{.*?\}\}/g))
    }
  })
})
