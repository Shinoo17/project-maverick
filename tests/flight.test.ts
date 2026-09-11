import { describe, expect, it } from 'vitest'
import { Bone, Group, Object3D, PerspectiveCamera, Quaternion, Vector3 } from 'three'
import { createFlightRig } from '../src/render/aircraft/flightRig'
import { GameRuntime } from '../src/game/runtime/GameRuntime'
import { neutralCommand, type PilotCommand } from '../src/game/runtime/commands'
import { FlightInput } from '../src/game/input/FlightInput'
import { FlightCamera } from '../src/render/FlightCamera'
import { MOUSE_STICK, createMouseStick, engageStick, moveStick, readStickAxes, screenFrame, stickGate } from '../src/game/input/mouseStick'
import type { CameraRollMode } from '../src/render/FlightCamera'
import type { AircraftState } from '../src/game/state/WorldState'
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
  it('accelerates and decelerates directly, coasts briefly on release, then holds the reached speed', () => {
    for (const sign of [1, -1]) {
      const runtime = run(60, 1, () => ({ speedAdjust: sign }))
      const speed = () => new Vector3().copy(runtime.snapshot().aircraft[0].velocity).length()
      const held = speed()
      expect((held - 130) * sign).toBeGreaterThan(18)
      for (let i = 0; i < 120; i++) runtime.advance(1 / 60)
      const settled = speed()
      expect((settled - held) * sign).toBeGreaterThan(1)
      expect((settled - held) * sign).toBeLessThan(5)
      for (let i = 0; i < 120; i++) runtime.advance(1 / 60)
      expect(speed()).toBeCloseTo(settled, 6)
      expect(runtime.snapshot().aircraft[0].speedDrive).toBe(0)
    }
    expect(new Vector3().copy(run(60, 8, () => ({ speedAdjust: 1 })).snapshot().aircraft[0].velocity).length()).toBeCloseTo(200)
    expect(new Vector3().copy(run(60, 8, () => ({ speedAdjust: -1 })).snapshot().aircraft[0].velocity).length()).toBeCloseTo(65)
  })
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
  it('loses speed in a climb and gives airbrake priority over acceleration', () => {
    const straight = run(60, 2).snapshot().aircraft[0], climb = run(60, 2, () => ({ pitch: 0.6 })).snapshot().aircraft[0]
    const magnitude = (s: typeof straight) => new Vector3().copy(s.velocity).length()
    expect(magnitude(climb)).toBeLessThan(magnitude(straight))
    const brake = run(60, 2, () => ({ airbrake: true, afterburner: true, speedAdjust: 1 })).snapshot().aircraft[0]
    expect(magnitude(brake)).toBeLessThan(100); expect(brake.enginePower).toBe(0)
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
    const input = new FlightInput(); input.setViewport(1000, 1000); input.engage(); input.move(4000, -4000)
    // Clamped to the corner of the gate, and the shaping saturates everything past one
    // radius, so a diagonal shove arrives at full deflection still pointing where it was sent.
    expect([input.stick.px, input.stick.py]).toEqual([500, -500])
    const shove = input.command(0, 'aircraft-1', 'mouse')
    expect(Math.hypot(shove.pitch, shove.roll)).toBeCloseTo(1)
    expect(shove.roll).toBeCloseTo(shove.pitch)
    input.engage()
    input.held.add('ArrowUp'); input.held.add('ArrowDown'); input.held.add('KeyA'); input.held.add('KeyD'); input.held.add('KeyW'); input.held.add('KeyS')
    const command = input.command(0, 'aircraft-1', 'mouse')
    expect([command.pitch, command.roll, command.speedAdjust]).toEqual([0, 0, 0])
    input.clear(); expect(input.stick.live).toBe(false)
    expect(input.command(0, 'aircraft-1', 'mouse')).toEqual(neutralCommand(0, 'aircraft-1'))
  })
  it('uses the same axes for keyboard-only and keyboard overrides in mouse preset', () => {
    const input = new FlightInput(); input.held.add('ArrowUp'); input.held.add('KeyD'); input.held.add('KeyW')
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
  const radius = input.gate.radius
  input.move(aim.x * radius - input.stick.px, -aim.y * radius - input.stick.py)
}
function flyMouse(state: AircraftState, aim: (seconds: number) => { x: number; y: number }, seconds: number, mode: CameraRollMode = 'horizon') {
  const input = new FlightInput(), rig = new FlightCamera(), camera = new PerspectiveCamera()
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
  it('is the window itself, with full deflection on the shorter side', () => {
    // A wide window: the pointer reaches the left and right edges, and full deflection is
    // reached at the top and bottom ones, with the sides as room to point rather than travel.
    const wide = stickGate(1600, 900)
    expect(wide.halfWidth).toBe(800); expect(wide.halfHeight).toBe(450)
    expect(wide.radius).toBe(450)
    expect(stickGate(0, NaN)).toEqual({ halfWidth: 0.5, halfHeight: 0.5, radius: 0.5 })
    // A resized window re-clamps what is held rather than stranding it outside a smaller gate.
    const input = new FlightInput(); input.setViewport(1600, 900); input.engage()
    input.move(2000, 0)
    expect(input.stick.px).toBe(800)
    input.setViewport(800, 900)
    expect(input.stick.px).toBe(400)
    expect(input.stick.x).toBeCloseTo(1)
  })
  it('has a soft middle and a squared curve, and only reads while live', () => {
    const stick = createMouseStick()
    expect(readStickAxes(stick)).toBeNull()
    engageStick(stick)
    expect(readStickAxes(stick)).toEqual({ pitch: 0, roll: 0 })
    const gate = stickGate(1000, 1000), radius = gate.radius
    expect(radius).toBe(500)
    // Inside the dead zone nothing is commanded; a positional stick has one neutral and the
    // dead zone is what makes it a place rather than a point.
    moveStick(stick, radius * MOUSE_STICK.deadZone * 0.9, 0, gate)
    expect(readStickAxes(stick)).toEqual({ pitch: 0, roll: 0 })
    // Squared response: half the gate is a quarter of the deflection, near enough.
    moveStick(stick, radius * 0.5 - stick.px, 0, gate)
    expect(readStickAxes(stick)!.roll).toBeCloseTo(((0.5 - MOUSE_STICK.deadZone) / (1 - MOUSE_STICK.deadZone)) ** 2)
    moveStick(stick, radius - stick.px, 0, gate)
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
  /*
  A window is not square, so the gate is not either: the pointer reaches the left and right
  edges of a wide one, and everything past the shorter side's half is already full stick.
  Pinned because the shaping divides by the raw length, which now runs over 1 out there —
  the deflection has to saturate and keep its direction rather than overshoot or fold.
  */
  it('lets the pointer roam a wide window, at full deflection past the shorter side', () => {
    const input = new FlightInput(); input.setViewport(1600, 900); input.engage()
    input.move(2000, 0)
    expect(input.stick.px).toBe(800)
    expect(input.stick.x).toBeCloseTo(800 / 450)
    const wide = input.command(0, 'a', 'mouse')
    expect(wide.roll).toBeCloseTo(1); expect(wide.pitch).toBeCloseTo(0)
    // The corner is full deflection too, pointing at the corner rather than folded back.
    input.move(0, -2000)
    expect([input.stick.px, input.stick.py]).toEqual([800, -450])
    const corner = input.command(1, 'a', 'mouse')
    expect(Math.hypot(corner.pitch, corner.roll)).toBeCloseTo(1)
    expect(corner.roll / corner.pitch).toBeCloseTo(800 / 450)
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
      const level = screenFrame(state, 'horizon')
      expect(Math.abs(level.angle)).toBeCloseTo(Math.abs(bank))
      expect(level.blend).toBe(1)
      // Riding the whole bank leaves nothing rotated on screen: the raw body stick.
      expect(screenFrame(state, 'aircraft')).toEqual({ angle: 0, blend: 1 })
    }
    // Straight down there is no level frame at all, so the frame is the identity and the
    // stick is simply the body stick.
    const vertical = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -Math.PI / 2)
    state.orientation = { x: vertical.x, y: vertical.y, z: vertical.z, w: vertical.w }
    expect(screenFrame(state, 'horizon').angle).toBe(0)
    // Just outside the cone the correction is partial rather than absent.
    const steep = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -1.4)
    state.orientation = { x: steep.x, y: steep.y, z: steep.z, w: steep.w }
    const partial = screenFrame(state, 'horizon')
    expect(partial.blend).toBeGreaterThan(0); expect(partial.blend).toBeLessThan(1)
  })
})

describe('mouse flight', () => {
  it('puts the nose down for a straight pull down, and keeps the wings there', () => {
    const { state } = flyMouse(make().snapshot().aircraft[0], () => ({ x: 0, y: -1 }), 1)
    const { up, nose } = attitude(state)
    expect(nose.y).toBeLessThan(-0.5)
    expect(state.position.y).toBeLessThan(395)
    expect(up.y).toBeGreaterThan(0.6)
    expect(Math.abs(state.rates.roll)).toBeLessThan(0.05)
  })
  it('still goes down for a pull down while inverted, by commanding pitch up', () => {
    const { state } = flyMouse(inverted(make().snapshot().aircraft[0]), () => ({ x: 0, y: -1 }), 1)
    expect(state.rates.pitch).toBeGreaterThan(0.5)
    expect(attitude(state).nose.y).toBeLessThan(-0.5)
    expect(state.position.y).toBeLessThan(395)
    // Nothing asked it to roll, so it is descending on its back: the correction turned the
    // pull into elevator the other way rather than rolling the aircraft upright first.
    expect(attitude(state).up.y).toBeLessThan(-0.6)
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
      const input = new FlightInput(), rig = new FlightCamera(), camera = new PerspectiveCamera()
      input.setViewport(1000, 1000); input.engage()
      for (let i = 0; i < 9 * 120; i++) {
        place(input, circle(i / 120, sign))
        rig.update(camera, state, 'horizon', 1 / 120)
        input.screen = screenFrame(state, 'horizon')
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
  Held straight down the aircraft ends up in a steady steep dive rather than looping: once
  the nose is down there is no further "down" to point at, so the correction blends away at
  the pole and the command settles to neutral. Pinned here because the alternative — an
  uncorrected pull that keeps looping, or a scaled angle that finds a knife edge — are both
  things this control deliberately does not do.
  */
  it('settles into a steady dive when the pull is held through the vertical', () => {
    const state = make().snapshot().aircraft[0]
    // High enough that the dive cannot reach the ground and end the test early.
    state.position.y = 4000
    const input = new FlightInput(), rig = new FlightCamera(), camera = new PerspectiveCamera()
    input.setViewport(1000, 1000); input.engage()
    let steepest = 0
    for (let i = 0; i < 8 * 120; i++) {
      place(input, { x: 0, y: -1 })
      rig.update(camera, state, 'horizon', 1 / 120)
      input.screen = screenFrame(state, 'horizon')
      const before = new Quaternion().copy(state.orientation)
      stepFlight(state, input.command(i, state.id, 'mouse'), 1 / 120)
      const after = new Quaternion().copy(state.orientation)
      expect(before.clone().invert().multiply(after).angleTo(new Quaternion())).toBeLessThan(0.025)
      const nose = new Vector3(1, 0, 0).applyQuaternion(after)
      steepest = Math.min(steepest, nose.y)
      // The nose never comes back up, and it never rolls off into a barrel.
      if (i > 240) { expect(nose.y).toBeLessThan(-0.85); expect(Math.abs(state.rates.roll)).toBeLessThan(0.05) }
    }
    expect(steepest).toBeLessThan(-0.95)
    // Settled, not chattering across the pole.
    expect(Math.abs(state.rates.pitch)).toBeLessThan(0.05)
    expect(state.alive).toBe(true)
  })
  it('settles on the bank the pointer angle asks for instead of rolling on', () => {
    const knife = flyMouse(make().snapshot().aircraft[0], () => ({ x: 1, y: 0 }), 6)
    expect(Math.abs(knife.state.rates.roll)).toBeLessThan(0.05)
    expect(knife.bank).toBeCloseTo(Math.PI / 2, 1)
    // Tighter turns can already be returning by six seconds; measure the turn's
    // excursion rather than requiring the final point to stay far to the right.
    expect(knife.peakCrossTrack).toBeGreaterThan(150)
    // A pointer thirty degrees off the top of the gate is thirty degrees of bank.
    const shallow = flyMouse(make().snapshot().aircraft[0], () => ({ x: 0.6 * 0.5, y: 0.6 * Math.sqrt(3) / 2 }), 3)
    expect(Math.abs(shallow.state.rates.roll)).toBeLessThan(0.05)
    expect(shallow.bank).toBeCloseTo(Math.PI / 6, 1)
  })
  // Edge to edge is the mirrored bank, half a turn away. Pinned because the correction's sine
  // is zero exactly there: without the saturation the aircraft sits at its bank and pushes.
  // Direction pinned too — the hand went right, so the roll goes right, whatever side a
  // degree of bank happens to put the sine on.
  it('flies the half turn across the gate to the mirrored bank, on the side the hand went', () => {
    const state = make().snapshot().aircraft[0]
    // High enough that the roll cannot reach the ground and end the test early.
    state.position.y = 6000
    const settled = flyMouse(state, () => ({ x: -1, y: 0 }), 5)
    expect(settled.bank).toBeCloseTo(-Math.PI / 2, 1)
    expect(Math.abs(state.rates.roll)).toBeLessThan(0.05)
    const input = new FlightInput(), rig = new FlightCamera(), camera = new PerspectiveCamera()
    input.setViewport(1000, 1000); input.engage()
    let accumulated = 0
    for (let i = 0; i < 3 * 120; i++) {
      place(input, { x: 1, y: 0 })
      rig.update(camera, state, 'horizon', 1 / 120)
      input.screen = screenFrame(state, 'horizon')
      const before = new Quaternion().copy(state.orientation)
      stepFlight(state, input.command(i, state.id, 'mouse'), 1 / 120)
      const after = new Quaternion().copy(state.orientation)
      const delta = before.invert().multiply(after)
      accumulated += 2 * Math.atan2(delta.x, delta.w)
      // Rolling the way the hand went, until the mirrored bank is reached.
      if (i > 12 && i < 120) expect(state.rates.roll).toBeGreaterThan(0.3)
    }
    expect(accumulated).toBeGreaterThan(2.5)
    expect(screenFrame(state, 'horizon').angle).toBeCloseTo(Math.PI / 2, 1)
    expect(state.alive).toBe(true)
  })
  it('lets a held key outrank the stick on the axis it owns', () => {
    const input = new FlightInput(); input.setViewport(1000, 1000); input.engage()
    place(input, { x: 1, y: 1 })
    const free = input.command(0, 'a', 'mouse')
    expect(free.roll).toBeCloseTo(Math.SQRT1_2); expect(free.pitch).toBeCloseTo(Math.SQRT1_2)
    input.held.add('KeyA')
    const held = input.command(1, 'a', 'mouse')
    expect(held.roll).toBe(-1)
    expect(held.pitch).toBeCloseTo(free.pitch)
    expect(input.command(2, 'a', 'keyboard').pitch).toBe(0)
  })
  it('flies the same path whatever the render rate refreshes the camera at', () => {
    const results = [30, 60, 144].map(fps => {
      const input = new FlightInput(), rig = new FlightCamera(), camera = new PerspectiveCamera()
      input.setViewport(1000, 1000); input.engage()
      const runtime = make(); runtime.start()
      for (let i = 0; i < fps * 8; i++) {
        place(input, circle(i / fps, 1))
        runtime.advance(1 / fps, (tick, id) => {
          const live = runtime.snapshot().aircraft[0]
          input.screen = screenFrame(live, 'horizon')
          return input.command(tick, id, 'mouse')
        })
        rig.update(camera, runtime.snapshot().aircraft[0], 'horizon', 1 / fps)
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
