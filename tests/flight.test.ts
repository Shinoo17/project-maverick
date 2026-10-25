import { describe, expect, it } from 'vitest'
import { Bone, Group, Object3D, PerspectiveCamera, Quaternion, Vector3 } from 'three'
import { createFlightRig } from '../src/render/aircraft/flightRig'
import { GameRuntime } from '../src/game/runtime/GameRuntime'
import { neutralCommand, type PilotCommand } from '../src/game/runtime/commands'
import { FlightInput } from '../src/game/input/FlightInput'
import { positionalHorizon, settleStick } from './invariants/helpers'
import { FlightCamera } from '../src/render/FlightCamera'
import { MOUSE_POSITIONAL, MOUSE_STICK, defaultMouseSettings, createMouseStick, engageStick, moveDiscStick, moveStick, readPositionalAxes, readStickAxes, screenFrame, stickGate } from '../src/game/input/mouseStick'
import type { CameraSettings } from '../src/game/camera/cameraSettings'
import type { AircraftState } from '../src/game/state/WorldState'
import { stepFlight } from '../src/game/flight/stepFlight'
import { observeAirflow } from '../src/game/flight/airflow'
import { interpretEnvelope } from '../src/game/flight/envelope'
import { getFlightProfile } from '../src/game/flight/profile'
import { driftSpawn } from '../benchmarks/flight/jetDrift'
import { en } from '../src/locales/en'
import { th } from '../src/locales/th'

// The two pre-style modes: a level lens is Horizon locked Dynamic, riding the airframe is Aircraft locked.
const HORIZON: CameraSettings = { roll: 'horizon', horizonStyle: 'dynamic' }
const AIRCRAFT: CameraSettings = { roll: 'aircraft', horizonStyle: 'balanced' }
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
    for (const view of [HORIZON, AIRCRAFT, { roll: 'horizon', horizonStyle: 'balanced' }] satisfies CameraSettings[]) for (const speed of [0, 65, 200, 380]) {
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
    for (const mode of [HORIZON, AIRCRAFT, { roll: 'horizon', horizonStyle: 'balanced' }] satisfies CameraSettings[]) {
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
    const input = new FlightInput(positionalHorizon); input.setViewport(1000, 1000); input.engage(); input.move(4000, -4000)
    // Clamped to the disc by length, so a diagonal shove arrives at full deflection still
    // pointing where it was sent.
    expect(Math.hypot(input.stick.px, input.stick.py)).toBeCloseTo(input.stickRadius)
    expect(input.stick.px).toBeCloseTo(-input.stick.py)
    const shove = settleStick(input, 0, 8, 'aircraft-1')
    expect(Math.hypot(shove.pitch, shove.roll)).toBeCloseTo(1)
    expect(shove.roll).toBeCloseTo(shove.pitch)
    input.engage()
    input.held.add('ArrowUp'); input.held.add('ArrowDown'); input.held.add('KeyA'); input.held.add('KeyD'); input.held.add('KeyW'); input.held.add('KeyS')
    const command = input.command(8, 'aircraft-1', 'mouse')
    expect([command.pitch, command.roll, command.speedAdjust]).toEqual([0, 0, 0])
    input.clear(); expect(input.stick.live).toBe(false)
    expect(input.command(0, 'aircraft-1', 'mouse')).toEqual(neutralCommand(0, 'aircraft-1'))
  })
  it('uses the same axes for keyboard-only and keyboard overrides in mouse preset', () => {
    const input = new FlightInput(positionalHorizon); input.held.add('ArrowUp'); input.held.add('KeyD'); input.held.add('KeyW')
    expect(input.command(1, 'a', 'mouse')).toMatchObject(input.command(1, 'a', 'keyboard'))
  })
  it('ships matching nonempty Thai and English keys and placeholders', () => {
    expect(Object.keys(th).sort()).toEqual(Object.keys(en).sort())
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(th[key].trim()).not.toBe(''); expect(th[key].match(/\{\{.*?\}\}/g)).toEqual(en[key].match(/\{\{.*?\}\}/g))
    }
  })
})

/*
The pointer stick, end to end: a position inside the gate, turned into the airframe's frame
by how far the camera leaves the aircraft looking rotated, and flown.
*/
function place(input: FlightInput, aim: { x: number; y: number }) {
  const radius = input.stickRadius
  input.move(aim.x * radius - input.stick.px, -aim.y * radius - input.stick.py)
}
function flyMouse(state: AircraftState, aim: (seconds: number) => { x: number; y: number }, seconds: number, mode: CameraSettings = HORIZON) {
  const input = new FlightInput(positionalHorizon), rig = new FlightCamera(), camera = new PerspectiveCamera()
  let peakCrossTrack = 0
  input.setViewport(1000, 1000); input.engage()
  for (let i = 0; i < seconds * 120; i++) {
    place(input, aim(i / 120))
    rig.update(camera, state, mode, 1 / 120)
    input.screen = screenFrame(state, mode)
    stepFlight(state, input.command(i, state.id, 'mouse'), 1 / 120)
    peakCrossTrack = Math.max(peakCrossTrack, Math.abs(state.position.z))
  }
  return { state, bank: screenFrame(state, mode).angle, peakCrossTrack }
}
const attitude = (state: AircraftState) => {
  const q = new Quaternion().copy(state.orientation)
  return { up: new Vector3(0, 1, 0).applyQuaternion(q), nose: new Vector3(1, 0, 0).applyQuaternion(q) }
}
function inverted(state: AircraftState) {
  const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI)
  state.orientation = { x: q.x, y: q.y, z: q.z, w: q.w }
  return state
}
// One turn of the pointer around the gate. The stick has to keep turning to stay ahead of
// the bank it is producing, which is what makes a swirl a roll.
const circle = (seconds: number, sign: number, period = 3) => ({ x: sign * Math.sin(2 * Math.PI * seconds / period), y: Math.cos(2 * Math.PI * seconds / period) })

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

describe('positional mouse stick', () => {
  it('keeps the window-sized gate for the cursor', () => {
    const wide = stickGate(1600, 900)
    expect(wide.halfWidth).toBe(800); expect(wide.halfHeight).toBe(450)
    expect(wide.radius).toBe(450)
    expect(stickGate(0, NaN)).toEqual({ halfWidth: 0.5, halfHeight: 0.5, radius: 0.5 })
  })
  // Positional stick mode is example/F22's stick: a disc of 0.34 of the shorter side, divided
  // by the sensitivity, with the hand's motion unscaled.
  it('is a disc of 0.34 of the shorter side, shrunk by sensitivity', () => {
    const input = new FlightInput(positionalHorizon); input.setViewport(1600, 900); input.engage()
    expect(input.stickRadius).toBeCloseTo(0.34 * 900)
    input.move(2000, 0)
    expect(input.stick.px).toBeCloseTo(306); expect(input.stick.x).toBeCloseTo(1)
    // A resized window re-clamps what is held rather than stranding it outside a smaller disc.
    input.setViewport(1600, 600)
    expect(input.stick.px).toBeCloseTo(204)
    input.mouse.sensitivity = 2; input.engage()
    expect(input.stickRadius).toBeCloseTo(102)
    input.move(50, 0)
    expect(input.stick.px).toBe(50); expect(input.stick.x).toBeCloseTo(50 / 102)
    // Clamped by length: a diagonal shove keeps its direction and owes no travel back.
    input.move(3950, -4000)
    expect(Math.hypot(input.stick.px, input.stick.py)).toBeCloseTo(102)
    expect(input.stick.px).toBeCloseTo(-input.stick.py)
  })
  it('reads F22\'s dead zone and squared curve, and rate limits the command', () => {
    const stick = engageStick(createMouseStick()), radius = 340
    moveDiscStick(stick, radius * MOUSE_POSITIONAL.deadZone * 0.9, 0, radius)
    expect(readPositionalAxes(stick)).toEqual({ pitch: 0, roll: 0 })
    moveDiscStick(stick, radius * 0.5 - stick.px, 0, radius)
    expect(readPositionalAxes(stick)!.roll).toBeCloseTo(((0.5 - 0.12) / 0.88) ** 2)
    moveDiscStick(stick, 4000, 0, radius)
    expect(readPositionalAxes(stick)!.roll).toBe(1); expect(readPositionalAxes(stick)!.pitch).toBeCloseTo(0)
    // A plain rotation into the airframe's frame, with pitch inverted before it is turned.
    moveDiscStick(stick, -stick.px, -radius, radius)
    expect(readPositionalAxes(stick, { angle: Math.PI / 2, blend: 1 })!.roll).toBeCloseTo(-1)
    expect(readPositionalAxes(stick, { angle: Math.PI / 2, blend: 1 }, true)!.roll).toBeCloseTo(1)
    expect(readPositionalAxes(stick, { angle: Math.PI, blend: 1 })!.pitch).toBeCloseTo(-1)
    // Full incidence hands it back to body axes.
    expect(readPositionalAxes(stick, { angle: Math.PI, blend: 1 }, false, 1)!.pitch).toBeCloseTo(1)
    // The command walks to the reading once per command tick, as F22's smoothAxis does: the
    // first step out of exact neutral at the release rate (18/s in pitch), then 16/s.
    const input = new FlightInput(positionalHorizon); input.setViewport(1000, 1000); input.engage()
    input.move(0, -1000)
    expect(input.command(0, 'a', 'mouse').pitch).toBeCloseTo(18 / 60)
    expect(input.command(0, 'a', 'mouse').pitch).toBeCloseTo(18 / 60)
    expect(input.command(1, 'a', 'mouse').pitch).toBeCloseTo(34 / 60)
    expect(settleStick(input, 2).pitch).toBe(1)
    input.move(0, 1000)
    expect(input.command(10, 'a', 'mouse').pitch).toBeCloseTo(1 - 18 / 60)
  })
  // MR1 (docs/psm-maneuver-control-plan.md §4.2.3) reshaped the positional stick: curve 2 → 1.5,
  // dead zone 0.08 → 0.04, and full deflection at 0.7 of the gate radius (35% of the shorter
  // side). The assertions are the same ones, read from the shaping constants.
  it('has a soft middle and a shaped curve, and only reads while live', () => {
    const stick = createMouseStick()
    expect(readStickAxes(stick)).toBeNull()
    engageStick(stick)
    expect(readStickAxes(stick)).toEqual({ pitch: 0, roll: 0 })
    const gate = stickGate(1000, 1000), radius = gate.radius, reach = radius * MOUSE_STICK.reach
    expect(radius).toBe(500)
    // Inside the dead zone nothing is commanded; a positional stick has one neutral and the
    // dead zone is what makes it a place rather than a point.
    moveStick(stick, reach * MOUSE_STICK.deadZone * 0.9, 0, gate)
    expect(readStickAxes(stick)).toEqual({ pitch: 0, roll: 0 })
    // Half the reach is about a third of the deflection.
    moveStick(stick, reach * 0.5 - stick.px, 0, gate)
    expect(readStickAxes(stick)!.roll).toBeCloseTo(((0.5 - MOUSE_STICK.deadZone) / (1 - MOUSE_STICK.deadZone)) ** MOUSE_STICK.curve)
    expect(readStickAxes(stick)!.roll).toBeGreaterThan(0.3); expect(readStickAxes(stick)!.roll).toBeLessThan(0.35)
    moveStick(stick, reach - stick.px, 0, gate)
    expect(readStickAxes(stick)!.roll).toBeCloseTo(1)
    expect(readStickAxes(stick)!.pitch).toBeCloseTo(0)
    // A diagonal reaches full deflection at the same distance from the middle as a straight
    // pull — the shaping saturates past one radius — and the direction survives the corner.
    moveStick(stick, -stick.px, -stick.py, gate)
    moveStick(stick, 4000, -4000, gate)
    expect(stick.px).toBe(500); expect(stick.py).toBe(-500)
    const diagonal = readStickAxes(stick)!
    expect(Math.hypot(diagonal.pitch, diagonal.roll)).toBeCloseTo(1)
    expect(diagonal.pitch).toBeCloseTo(diagonal.roll)
    // A shove far outside owes no travel back beyond the gate itself: a corner is a diagonal
    // from the middle, and returning that diagonal re-centres it.
    moveStick(stick, -500, 500, gate)
    expect(Math.hypot(stick.x, stick.y)).toBeCloseTo(0)
    moveStick(stick, NaN, Infinity, gate)
    expect([stick.px, stick.py].every(Number.isFinite)).toBe(true)
  })
  it('turns the drawn vector into the airframe frame', () => {
    const stick = engageStick(createMouseStick())
    moveStick(stick, 0, -stickGate(1000, 1000).radius, stickGate(1000, 1000))
    // Wings level the screen is the airframe: up the screen is pitch up.
    expect(readStickAxes(stick, { angle: 0, blend: 1 })).toEqual({ pitch: 1, roll: 0 } as never)
    // Ninety degrees of bank and a pull up the screen is a pure roll back to level.
    expect(readStickAxes(stick, { angle: Math.PI / 2, blend: 1 })!.roll).toBeCloseTo(-1)
    expect(readStickAxes(stick, { angle: -Math.PI / 2, blend: 1 })!.roll).toBeCloseTo(1)
    // Inverted, up the screen is body pitch down, so down the screen still means down.
    expect(readStickAxes(stick, { angle: Math.PI, blend: 1 })!.pitch).toBeCloseTo(-1)
    // Blended out at the pole the two readings cancel, which is the aircraft holding what it
    // has rather than chattering across the branch cut.
    expect(readStickAxes(stick, { angle: Math.PI, blend: 0.5 })!.pitch).toBeCloseTo(0)
    expect(readStickAxes(stick, { angle: Math.PI, blend: 0 })!.pitch).toBeCloseTo(1)
  })
  it('reads the airframe bank the horizon camera leaves on screen', () => {
    const state = make().snapshot().aircraft[0]
    for (const bank of [0, 0.6, -0.6, Math.PI]) {
      const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), bank)
      state.orientation = { x: q.x, y: q.y, z: q.z, w: q.w }
      const level = screenFrame(state, HORIZON)
      expect(Math.abs(level.angle)).toBeCloseTo(Math.abs(bank))
      expect(level.blend).toBe(1)
      // Riding the whole bank leaves nothing rotated on screen: the raw body stick.
      expect(screenFrame(state, AIRCRAFT)).toEqual({ angle: 0, blend: 1 })
    }
    // Straight down there is no level frame at all, so the frame is the identity and the
    // stick is simply the body stick.
    const vertical = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -Math.PI / 2)
    state.orientation = { x: vertical.x, y: vertical.y, z: vertical.z, w: vertical.w }
    expect(screenFrame(state, HORIZON).angle).toBe(0)
    // Just outside the cone the correction is partial rather than absent.
    const steep = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -1.4)
    state.orientation = { x: steep.x, y: steep.y, z: steep.z, w: steep.w }
    const partial = screenFrame(state, HORIZON)
    expect(partial.blend).toBeGreaterThan(0); expect(partial.blend).toBeLessThan(1)
  })
})

describe('mouse flight', () => {
  it('puts the nose down for a straight pull down, and keeps the wings there', () => {
    const { state } = flyMouse(make().snapshot().aircraft[0], () => ({ x: 0, y: -1 }), 1)
    const { up, nose } = attitude(state)
    expect(nose.y).toBeLessThan(-0.5)
    expect(state.position.y).toBeLessThan(395)
    expect(up.y).toBeGreaterThan(0) // Upright; automatic G may deepen pitch.
    expect(Math.abs(state.rates.roll)).toBeLessThan(0.05)
  })
  it('still goes down for a pull down while inverted, by commanding pitch up', () => {
    const { state } = flyMouse(inverted(make().snapshot().aircraft[0]), () => ({ x: 0, y: -1 }), 1)
    expect(state.rates.pitch).toBeGreaterThan(0.5)
    expect(attitude(state).nose.y).toBeLessThan(-0.5)
    expect(state.position.y).toBeLessThan(395)
    // Nothing asked it to roll, so it is descending on its back: the correction turned the
    // pull into elevator the other way rather than rolling the aircraft upright first.
    expect(attitude(state).up.y).toBeLessThan(0) // Still inverted, independent of pitch depth.
    expect(Math.abs(state.rates.roll)).toBeLessThan(0.05)
  })
  it('rolls back to level when pointed at the top of the screen from a bank', () => {
    const state = make().snapshot().aircraft[0]
    const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2)
    state.orientation = { x: q.x, y: q.y, z: q.z, w: q.w }
    expect(flyMouse(state, () => ({ x: 0, y: 1 }), 1.2).state).toBe(state)
    expect(attitude(state).up.y).toBeGreaterThan(0.85)
  })
  it('completes repeated 360 rolls in either direction from a circling pointer', () => {
    for (const sign of [-1, 1]) {
      const state = make().snapshot().aircraft[0]
      let accumulated = 0, wentInverted = false
      const input = new FlightInput(positionalHorizon), rig = new FlightCamera(), camera = new PerspectiveCamera()
      input.setViewport(1000, 1000); input.engage()
      for (let i = 0; i < 9 * 120; i++) {
        place(input, circle(i / 120, sign))
        rig.update(camera, state, HORIZON, 1 / 120)
        input.screen = screenFrame(state, HORIZON)
        const before = new Quaternion().copy(state.orientation)
        stepFlight(state, input.command(i, state.id, 'mouse'), 1 / 120)
        const after = new Quaternion().copy(state.orientation)
        const delta = before.invert().multiply(after)
        accumulated += 2 * Math.atan2(delta.x, delta.w)
        if (new Vector3(0, 1, 0).applyQuaternion(after).y < -0.9) wentInverted = true
        expect(delta.angleTo(new Quaternion())).toBeLessThan(0.025)
      }
      expect(accumulated * sign).toBeGreaterThan(4 * Math.PI)
      expect(wentInverted).toBe(true)
      expect(state.alive).toBe(true)
      expect(Object.values(state.orientation).every(Number.isFinite)).toBe(true)
    }
  })
  // Lift-vector control: the roll command is zero exactly where the airframe's bank matches
  // the angle the pointer is held at, so a parked pointer is a bank angle, not a roll rate.
  // Full lateral deflection therefore settles on the knife edge and pulls.
  /*
  Held straight down or straight up the aircraft goes all the way round the loop (owner
  request, 23 Oct 2026). The level frame flips by half a turn as the nose passes the vertical
  and the stick adds that half turn back while the pointer stays where it is, so the pull
  stays the same pull. Before, the correction faded out at the pole, every pointer direction
  read as nothing there, and the jet fell on the vertical with no control at all.
  */
  it('loops all the way round when the pointer is held straight down or up', () => {
    for (const sign of [-1, 1]) {
      const state = make().snapshot().aircraft[0]
      state.position.y = 6000
      const input = new FlightInput(positionalHorizon), rig = new FlightCamera(), camera = new PerspectiveCamera()
      input.setViewport(1000, 1000); input.engage()
      let pitched = 0, rolled = 0
      for (let i = 0; i < 9 * 120; i++) {
        place(input, { x: 0, y: sign })
        rig.update(camera, state, HORIZON, 1 / 120)
        input.screen = screenFrame(state, HORIZON)
        const before = new Quaternion().copy(state.orientation)
        stepFlight(state, input.command(i, state.id, 'mouse'), 1 / 120)
        const delta = before.invert().multiply(new Quaternion().copy(state.orientation))
        pitched += 2 * Math.atan2(delta.z, delta.w); rolled += 2 * Math.atan2(delta.x, delta.w)
      }
      expect(pitched * sign).toBeGreaterThan(2 * Math.PI)
      expect(Math.abs(rolled)).toBeLessThan(0.1)
      expect(state.alive).toBe(true)
    }
  })
  /*
  Bringing a Cobra back (owner reports, 23 Oct 2026). Past 90° the push must stay a push: the
  level frame reads the jet inverted there, and dropping the half turn kept from the vertical
  as the pointer swung down read the push as a pull and hung the jet nose high. And a push held
  from post-stall stops the nose on the horizon rather than tumbling on below it
  (pushCapture.ts). Pinned at several Cobra depths, airbrake held and released.
  */
  function cobraThenPush(upTicks: number, keepBrake: boolean, after: (input: FlightInput, tick: number, elevation: number) => void = () => {}, seconds = 5) {
    const camera: CameraSettings = { roll: 'horizon', horizonStyle: 'balanced' }
    const state = driftSpawn('f22', 500), profile = getFlightProfile('f22')
    const input = new FlightInput({ ...defaultMouseSettings, mode: 'stick' }), rig = new FlightCamera(), lens = new PerspectiveCamera()
    input.setViewport(1000, 1000); input.engage(); input.press('Space')
    input.move(0, -input.stickRadius)
    const trace: { elevation: number; path: number; pitch: number; alpha: number; speed: number }[] = []
    for (let i = 0; i < upTicks + seconds * 120; i++) {
      const elevation = Math.asin(new Vector3(1, 0, 0).applyQuaternion(state.orientation as Quaternion).y) * 180 / Math.PI
      if (i === upTicks) { input.move(0, 2 * input.stickRadius); if (!keepBrake) input.held.delete('Space') }
      if (i >= upTicks) after(input, i - upTicks, elevation)
      rig.update(lens, state, camera, 1 / 120)
      input.highAoa = interpretEnvelope(state, observeAirflow(state, profile), profile).highAoa
      input.screen = screenFrame(state, camera); input.pose = state
      const command = input.command(i, state.id, 'mouse')
      stepFlight(state, command, 1 / 120)
      const speed = Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z)
      if (i >= upTicks) trace.push({ elevation, path: Math.asin(state.velocity.y / speed) * 180 / Math.PI, pitch: command.pitch, alpha: state.maneuver.alpha, speed: speed * 3.6 })
    }
    return { state, trace }
  }
  it('stops the nose on the horizon when a Cobra is pushed back', () => {
    for (const keepBrake of [true, false]) for (const upTicks of [130, 200, 260, 320]) {
      const { state, trace } = cobraThenPush(upTicks, keepBrake, undefined, 6)
      // The push stays a push until the capture eases it, and the nose never goes far below level.
      for (const sample of trace.slice(12, 60)) expect(sample.pitch).toBeLessThan(0)
      expect(Math.min(...trace.map(sample => sample.elevation))).toBeGreaterThan(-5)
      // Held on the horizon for the last two seconds.
      for (const sample of trace.slice(-240)) expect(Math.abs(sample.elevation)).toBeLessThan(5)
      expect(state.alive).toBe(true)
    }
  })
  it('follows a push below the horizon under throttle and holds the nose where the stick is centred', () => {
    for (const throttle of ['ShiftLeft', 'KeyW']) {
      let centred: number | null = null
      const { state, trace } = cobraThenPush(200, false, (input, tick, elevation) => {
        if (tick === 0) input.press(throttle)
        if (centred === null && tick > 30 && elevation < -20) { input.move(0, -input.stick.py); centred = elevation }
      }, 7)
      expect(centred).not.toBeNull()
      const end = trace.at(-1)!
      // The nose is back where it was let go, the path came round behind it, and the jet is
      // flying again with speed building.
      expect(Math.abs(end.elevation - centred!)).toBeLessThan(5)
      expect(Math.abs(end.path - end.elevation)).toBeLessThan(3)
      expect(end.alpha).toBeLessThan(3)
      expect(end.speed).toBeGreaterThan(300)
      expect(state.alive).toBe(true)
    }
  })
  it('levels and accelerates out of a Cobra on the throttle with the stick centred', () => {
    const { trace } = cobraThenPush(200, false, (input, tick) => {
      if (tick === 360) { input.move(0, -input.stick.py); input.press('ShiftLeft') }
    }, 7)
    const end = trace.at(-1)!
    expect(Math.abs(end.elevation)).toBeLessThan(6)
    expect(end.alpha).toBeLessThan(3)
    expect(end.speed).toBeGreaterThan(400)
  })
  it('still answers a side pointer on the vertical', () => {
    const state = make().snapshot().aircraft[0]
    state.position.y = 6000
    const down = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -Math.PI / 2)
    state.orientation = { x: down.x, y: down.y, z: down.z, w: down.w }
    const input = new FlightInput(positionalHorizon); input.setViewport(1000, 1000); input.engage()
    input.screen = screenFrame(state, HORIZON)
    place(input, { x: 1, y: 0 })
    expect(settleStick(input).roll).toBeCloseTo(1)
  })
  it('settles on the bank the pointer angle asks for instead of rolling on', () => {
    const knife = flyMouse(make().snapshot().aircraft[0], () => ({ x: 1, y: 0 }), 6)
    expect(Math.abs(knife.state.rates.roll)).toBeLessThan(0.05)
    expect(knife.bank).toBeCloseTo(Math.PI / 2, 1)
    // Tighter turns can already be returning by six seconds; measure the turn's
    // excursion rather than requiring the final point to stay far to the right.
    expect(knife.peakCrossTrack).toBeGreaterThan(150)
    // A pointer thirty degrees off the top of the gate is thirty degrees of bank. MR1 reshaped
    // the positional stick, so the pointer is placed where it commands the same deflection the
    // pre-MR1 test flew (0.6 of the gate at curve 2 and dead zone 0.08). A harder pull in the
    // horizon frame keeps rolling: that is RC5, and why the body frame is the default now.
    const deflection = ((0.6 - 0.08) / 0.92) ** 2
    const travel = MOUSE_POSITIONAL.deadZone + (1 - MOUSE_POSITIONAL.deadZone) * deflection ** (1 / MOUSE_POSITIONAL.curve)
    const shallow = flyMouse(make().snapshot().aircraft[0], () => ({ x: travel * 0.5, y: travel * Math.sqrt(3) / 2 }), 3)
    expect(Math.abs(shallow.state.rates.roll)).toBeLessThan(0.05)
    expect(shallow.bank).toBeCloseTo(Math.PI / 6, 1)
  })
  // The half turn edge to edge to the mirrored bank is gone with the F22 port: F22 turns the
  // drawn vector by a plain rotation, so a pointer thrown across the gate from a knife edge
  // is read as a push. Its unit reading is pinned in 'reads F22's dead zone and squared curve'.
  // The owner's report: with the default settings a pointer held right rolled for ever. The
  // positional stick reads the screen whatever the Stick frame says, so it banks right and holds.
  it('banks and holds for a pointer held right with the default settings and camera', () => {
    const state = make().snapshot().aircraft[0]
    state.position.y = 3000
    const camera: CameraSettings = { roll: 'horizon', horizonStyle: 'balanced' }
    const input = new FlightInput({ ...defaultMouseSettings, mode: 'stick' }), rig = new FlightCamera(), lens = new PerspectiveCamera()
    expect(input.mouse.frame).toBe('body')
    input.setViewport(1000, 1000); input.engage(); input.move(0.6 * input.stickRadius, 0)
    for (let i = 0; i < 6 * 120; i++) {
      rig.update(lens, state, camera, 1 / 120); input.screen = screenFrame(state, camera)
      stepFlight(state, input.command(i, state.id, 'mouse'), 1 / 120)
    }
    const bank = screenFrame(state, HORIZON).angle
    expect(bank).toBeGreaterThan(Math.PI / 3); expect(bank).toBeLessThan(2 * Math.PI / 3)
    expect(Math.abs(state.rates.roll)).toBeLessThan(0.1)
  })
  it('lets a held key outrank the stick on the axis it owns', () => {
    const input = new FlightInput(positionalHorizon); input.setViewport(1000, 1000); input.engage()
    place(input, { x: 1, y: 1 })
    const free = settleStick(input)
    expect(free.roll).toBeCloseTo(Math.SQRT1_2); expect(free.pitch).toBeCloseTo(Math.SQRT1_2)
    input.held.add('KeyA')
    const held = input.command(8, 'a', 'mouse')
    expect(held.roll).toBe(-1)
    expect(held.pitch).toBeCloseTo(free.pitch)
    expect(input.command(9, 'a', 'keyboard').pitch).toBe(0)
  })
  it('flies the same path whatever the render rate refreshes the camera at', () => {
    const results = [30, 60, 144].map(fps => {
      const input = new FlightInput(positionalHorizon), rig = new FlightCamera(), camera = new PerspectiveCamera()
      input.setViewport(1000, 1000); input.engage()
      const runtime = make(); runtime.start()
      for (let i = 0; i < fps * 8; i++) {
        place(input, circle(i / fps, 1))
        runtime.advance(1 / fps, (tick, id) => {
          const live = runtime.snapshot().aircraft[0]
          input.screen = screenFrame(live, HORIZON)
          return input.command(tick, id, 'mouse')
        })
        rig.update(camera, runtime.snapshot().aircraft[0], HORIZON, 1 / fps)
      }
      return runtime.snapshot().aircraft[0]
    })
    // Not bit-identical: the camera is a render-rate object, so the correction it publishes
    // differs slightly. Refreshing it per simulation tick is what keeps that a rounding
    // error rather than a control that answers differently at 30 fps than at 144.
    for (const sample of results.slice(1)) {
      expect(new Quaternion().copy(sample.orientation).angleTo(new Quaternion().copy(results[0].orientation))).toBeLessThan(0.15)
      expect(Math.abs(sample.position.y - results[0].position.y)).toBeLessThan(30)
    }
  })
})
