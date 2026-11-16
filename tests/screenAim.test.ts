import { describe, expect, it } from 'vitest'
import { PerspectiveCamera, Quaternion, Vector3 } from 'three'
import { GameRuntime } from '../src/game/runtime/GameRuntime'
import { FlightInput } from '../src/game/input/FlightInput'
import { cursorRay, INSTRUCTOR } from '../src/game/control/Instructor'
import { defaultMouseSettings, type AimMode } from '../src/game/control/mouseSettings'
import { drawnReticle, gunMountOf } from '../src/game/combat/gunSolution'

/*
Mouse steering (Settings › Controls › Mouse steering), both flown by the instructor
(src/game/control/Instructor.ts, from the feat/p4-gun-duel branch):

- Screen position: the × is a place on the window and the gun reticle is flown under it. The
  camera follows the nose, so a × held off the reticle keeps the jet turning until it is brought
  back.
- Aim point (world): the same hand movement is one turn onto a point, and then straight flight.
*/
const W = 1280, H = 720
const forwardOf = (q: { x: number; y: number; z: number; w: number }) => new Vector3(1, 0, 0).applyQuaternion(new Quaternion(q.x, q.y, q.z, q.w))
const bankOf = (o: { x: number; y: number; z: number; w: number }) => {
  const q = new Quaternion(o.x, o.y, o.z, o.w), right = new Vector3(0, 0, 1).applyQuaternion(q), up = new Vector3(0, 1, 0).applyQuaternion(q)
  return Math.atan2(-right.y, up.y) * 180 / Math.PI
}
/** Heading in degrees, growing to the left. */
const headingOf = (q: { x: number; y: number; z: number; w: number }) => { const f = forwardOf(q); return Math.atan2(-f.z, f.x) * 180 / Math.PI }

function session(aimMode: AimMode) {
  const runtime = new GameRuntime({ mode: 'playground', mapId: 'flat-range', aircraftIds: ['f22'], flightCore: 'arcade' })
  runtime.start()
  const input = new FlightInput({ ...defaultMouseSettings, aimMode }), view = new PerspectiveCamera(62, W / H, 0.5, 14000)
  input.setViewport(W, H)
  let turned = 0, heading = 0
  const commands: { pitch: number; roll: number; yaw: number }[] = []
  /** Flies `seconds` with a horizon-level chase view 25 m behind the nose. Returns the degrees turned left meanwhile. */
  const fly = (seconds: number) => {
    const from = turned
    for (let i = 0; i < Math.round(seconds * 60); i++) runtime.advance(1 / 60, (tick, id) => {
      const live = runtime.snapshot().aircraft[0], nose = forwardOf(live.orientation), at = new Vector3(live.position.x, live.position.y, live.position.z)
      view.position.copy(at).addScaledVector(nose, -25).add(new Vector3(0, 4, 0))
      view.up.set(0, 1, 0); view.lookAt(view.position.clone().add(nose)); view.updateMatrixWorld()
      input.pose = live; input.setView(view)
      input.cursorRay = input.screenAim ? cursorRay(view, input.cursor.px, input.cursor.py, W, H, live.position) : null
      const now = headingOf(live.orientation)
      turned += ((now - heading + 540) % 360) - 180; heading = now
      const command = input.command(tick, id, 'mouse')
      commands.push({ pitch: command.pitch, roll: command.roll, yaw: command.yaw })
      return command
    })
    return turned - from
  }
  return { runtime, input, fly, view, commands }
}

describe('screen steering', () => {
  it('keeps turning toward a × held off the reticle, and flies straight and level once it is brought back', () => {
    const { input, fly, runtime } = session('screen')
    fly(0.3)
    input.move(-250, 0)
    expect(input.cursor.px).toBe(-250)
    expect(fly(4)).toBeGreaterThan(40)
    // Still turning, still banked: the camera follows the nose, so the × is never caught up with.
    expect(fly(2)).toBeGreaterThan(15)
    expect(Math.abs(bankOf(runtime.snapshot().aircraft[0].orientation))).toBeGreaterThan(30)
    expect(input.cursor.px).toBe(-250)
    // Brought back: the hand moved against the bank, so the wings come level.
    input.move(250, 0)
    fly(3)
    expect(Math.abs(fly(2))).toBeLessThan(2)
    expect(Math.abs(bankOf(runtime.snapshot().aircraft[0].orientation))).toBeLessThan(3)
  })

  it('turns harder the further the × is held off', () => {
    const near = session('screen'), far = session('screen')
    near.fly(0.3); far.fly(0.3)
    near.input.move(-60, 0); far.input.move(-300, 0)
    near.fly(2); far.fly(2)
    const slow = near.fly(2), fast = far.fly(2)
    expect(slow).toBeGreaterThan(2)
    expect(fast).toBeGreaterThan(slow * 1.5)
  })

  it('aims the nose that puts the gun reticle under the ×', () => {
    const { input, fly, runtime, view } = session('screen')
    fly(0.3)
    input.move(140, -90)
    fly(1 / 60)
    // Turn the jet as it stood at that command onto the aim: the reticle the HUD draws is then under the ×.
    const mount = gunMountOf('f22'), state = input.pose!, q = new Quaternion(state.orientation.x, state.orientation.y, state.orientation.z, state.orientation.w)
    // The flight path comes round with the nose, so both are turned.
    const swing = new Quaternion().setFromUnitVectors(forwardOf(state.orientation), input.aim.direction), turned = swing.clone().multiply(q)
    const path = new Vector3(state.velocity.x, state.velocity.y, state.velocity.z).applyQuaternion(swing)
    const reticle = drawnReticle({ ...state, orientation: { x: turned.x, y: turned.y, z: turned.z, w: turned.w }, velocity: { x: path.x, y: path.y, z: path.z } }, mount, null).reticle
    const at = new Vector3(reticle.x, reticle.y, reticle.z).project(view)
    expect(Math.abs(at.x * W / 2 - 140)).toBeLessThan(3); expect(Math.abs(-at.y * H / 2 + 90)).toBeLessThan(3)
    void runtime
  })

  it('the × stays on the window', () => {
    const { input, fly } = session('screen')
    fly(0.3)
    input.move(-5000, 5000)
    expect(input.cursor).toEqual({ px: -W / 2, py: H / 2 })
  })

  it('under world aim the same movement is one turn onto the point', () => {
    const { input, fly } = session('world')
    fly(0.3)
    input.move(-250, 0)
    const first = fly(4)
    expect(first).toBeGreaterThan(14); expect(first).toBeLessThan(21)
    expect(Math.abs(fly(2))).toBeLessThan(1)
  })
})

describe('the instructor', () => {
  for (const mode of ['world', 'screen'] as const) it(`never slams the stick (${mode})`, () => {
    const { input, fly, commands } = session(mode)
    fly(0.3)
    input.move(-300, -80)
    fly(2)
    input.move(500, 160)
    fly(2)
    let worst = 0
    for (let i = 1; i < commands.length; i++) for (const axis of ['pitch', 'roll', 'yaw'] as const) worst = Math.max(worst, Math.abs(commands[i][axis] - commands[i - 1][axis]))
    // Every axis slews: no more than `slew` full deflections a second.
    expect(worst).toBeLessThanOrEqual(INSTRUCTOR.slew / 60 + 1e-9)
  })

  it('arrives on a world aim and settles without hunting', () => {
    const { input, fly, runtime } = session('world')
    fly(0.3)
    input.move(-400, -150)
    fly(5)
    const errors: number[] = []
    for (let i = 0; i < 60; i++) { fly(1 / 60); errors.push(input.aim.direction.angleTo(forwardOf(runtime.snapshot().aircraft[0].orientation)) * 180 / Math.PI) }
    expect(Math.max(...errors)).toBeLessThan(2)
    expect(Math.max(...errors) - Math.min(...errors)).toBeLessThan(0.5)
  })
})

describe('the instructor: direct or banked', () => {
  const run = (pixels: number) => {
    const { input, fly, runtime, commands } = session('world')
    fly(0.3)
    const from = commands.length
    input.move(-pixels, 0)
    let bank = 0
    for (let i = 0; i < 180; i++) { fly(1 / 60); bank = Math.max(bank, Math.abs(bankOf(runtime.snapshot().aircraft[0].orientation))) }
    const flown = commands.slice(from)
    const most = (axis: 'pitch' | 'roll' | 'yaw') => Math.max(...flown.map(c => Math.abs(c[axis])))
    const off = input.aim.direction.angleTo(forwardOf(runtime.snapshot().aircraft[0].orientation)) * 180 / Math.PI
    return { bank, roll: most('roll'), yaw: most('yaw'), pitch: most('pitch'), off }
  }

  it('a small drag to the side is flown on the rudder: no roll, no pull', () => {
    // 60 px: 4.2° of aim, inside INSTRUCTOR.directDeg.
    const small = run(60)
    expect(small.yaw).toBeGreaterThan(0.2)
    expect(small.roll).toBeLessThan(0.03)
    expect(small.pitch).toBeLessThan(0.1)
    expect(small.bank).toBeLessThan(1)
    expect(small.off).toBeLessThan(0.5)
  })

  it('a large drag still banks and pulls', () => {
    const large = run(500)
    expect(large.bank).toBeGreaterThan(40)
    expect(large.pitch).toBeGreaterThan(0.5)
  })
})

describe('the instructor: the bank is kept', () => {
  const bankNow = (runtime: GameRuntime) => bankOf(runtime.snapshot().aircraft[0].orientation)

  it('ends a turn still banked, and levels when the aim is put a little the other way', () => {
    const { input, fly, runtime } = session('world')
    fly(0.3)
    // Far to the right: a banked turn.
    input.move(600, 0)
    fly(4)
    expect(input.aim.direction.angleTo(forwardOf(runtime.snapshot().aircraft[0].orientation)) * 180 / Math.PI).toBeLessThan(2)
    const arrived = bankNow(runtime)
    expect(arrived).toBeGreaterThan(30)
    // Hands off: it stays banked, nose on the aim.
    fly(3)
    expect(bankNow(runtime)).toBeGreaterThan(arrived - 5)
    expect(input.aim.direction.angleTo(forwardOf(runtime.snapshot().aircraft[0].orientation)) * 180 / Math.PI).toBeLessThan(2)
    // 30 px back to the left (2.1°): the wings roll level.
    input.move(-30, 0)
    fly(2.5)
    expect(Math.abs(bankNow(runtime))).toBeLessThan(3)
  })

  it('never levels a bank set on the roll keys', () => {
    const { input, fly, runtime } = session('world')
    fly(0.3)
    input.press('KeyD')
    fly(0.5)
    input.held.delete('KeyD')
    fly(0.5)
    const set = bankNow(runtime)
    expect(Math.abs(set)).toBeGreaterThan(20)
    fly(3)
    expect(Math.abs(bankNow(runtime) - set)).toBeLessThan(5)
  })

  it('nor when the mouse then makes a small correction against that bank', () => {
    // A knife edge rolled on the keys to pass a gap, then 30 px (2.1°) of correction toward the high wing.
    const { input, fly, runtime, commands } = session('world')
    fly(0.3)
    input.press('KeyD')
    fly(0.55)
    input.held.delete('KeyD')
    fly(1.2)
    const set = bankNow(runtime)
    expect(set).toBeGreaterThan(80)
    const from = commands.length
    for (let i = 0; i < 6; i++) { input.move(-5, 0); fly(1 / 60) }
    fly(2.5)
    expect(Math.max(...commands.slice(from).map(c => Math.abs(c.roll)))).toBeLessThan(0.05)
    expect(Math.abs(bankNow(runtime) - set)).toBeLessThan(3)
    expect(input.aim.direction.angleTo(forwardOf(runtime.snapshot().aircraft[0].orientation)) * 180 / Math.PI).toBeLessThan(1.5)
    // A turn past the direct range is the instructor's bank again, and that one the hand may level.
    input.move(600, 0)
    fly(4)
    expect(bankNow(runtime)).toBeGreaterThan(30)
    input.move(-30, 0)
    fly(2.5)
    expect(Math.abs(bankNow(runtime))).toBeLessThan(3)
  })
})

describe('screen steering: the × after a re-sync', () => {
  it('starts on the gun reticle as the camera draws it, not on the middle of the window', () => {
    const { input, fly, view, runtime } = session('screen')
    fly(0.3)
    input.settleCursor(view)
    const state = runtime.snapshot().aircraft[0]
    const at = drawnReticle(state, gunMountOf('f22'), null).reticle
    const drawn = new Vector3(at.x, at.y, at.z).project(view)
    expect(Math.abs(input.cursor.px - drawn.x * W / 2)).toBeLessThan(1.5)
    expect(Math.abs(input.cursor.py + drawn.y * H / 2)).toBeLessThan(1.5)
    // The view sits above the jet, so the reticle shows under the middle.
    expect(input.cursor.py).toBeGreaterThan(1)
    // Once only: the hand owns the × from then on.
    input.move(40, 0)
    const held = { ...input.cursor }
    input.settleCursor(view)
    expect(input.cursor).toEqual(held)
  })
})

describe('screen steering: at rest', () => {
  it('hands off with the × on the reticle the jet holds its course, no creep', () => {
    const { input, fly, view, runtime } = session('screen')
    fly(0.3)
    input.settleCursor(view)
    const pitchOf = () => Math.asin(forwardOf(runtime.snapshot().aircraft[0].orientation).y) * 180 / Math.PI
    const from = pitchOf()
    const turned = fly(8)
    expect(Math.abs(pitchOf() - from)).toBeLessThan(0.5)
    expect(Math.abs(turned)).toBeLessThan(0.5)
  })

  it('and a pixel or two off the reticle is not a turn that never ends', () => {
    const { input, fly, view } = session('screen')
    fly(0.3)
    input.settleCursor(view)
    input.move(2, 0)
    // 2 px is 0.19° of aim, inside the rest (FlightInput REST_DEG): a quarter of the turn that offset alone asks for.
    expect(Math.abs(fly(8))).toBeLessThan(2.5)
  })
})

describe('the instructor: a sweep of the hand', () => {
  /** Drags the mouse left at `rate` degrees of aim a second. Returns when the bank first passed 10°, or -1. */
  const drag = (rate: number, seconds: number) => {
    const { input, fly, runtime } = session('world')
    fly(0.3)
    let banked = -1
    for (let i = 0; i < seconds * 60; i++) {
      input.move(-rate / 0.07 / 60, 0)
      fly(1 / 60)
      if (banked < 0 && Math.abs(bankOf(runtime.snapshot().aircraft[0].orientation)) > 10) banked = (i + 1) / 60
    }
    return { banked, off: input.aim.direction.angleTo(forwardOf(runtime.snapshot().aircraft[0].orientation)) * 180 / Math.PI, input, fly, runtime }
  }

  it('faster than the rudder can follow banks at once, and is caught up with', () => {
    const swept = drag(30, 2)
    // Without the sweep the bank waited for the error: 0.88 s, and the nose was still 7.6° behind at 2 s.
    expect(swept.banked).toBeGreaterThan(0)
    expect(swept.banked).toBeLessThan(0.7)
    expect(swept.off).toBeLessThan(3)
    // The hand stops: the bank the turn ended with is kept.
    const bank = bankOf(swept.runtime.snapshot().aircraft[0].orientation)
    swept.fly(2)
    expect(Math.abs(bankOf(swept.runtime.snapshot().aircraft[0].orientation) - bank)).toBeLessThan(5)
  })

  it('one the rudder can follow stays flat, wings level', () => {
    const slow = drag(18, 3)
    expect(slow.banked).toBe(-1)
    expect(slow.off).toBeLessThan(8)
  })
})

describe('the instructor: at a held bank', () => {
  it('a small move up or down, even a little diagonal, is flown on the rudder with the bank kept', () => {
    for (const [dx, dy] of [[0, -100], [0, 100], [-20, -100], [20, 100]] as const) {
      const { input, fly, runtime, commands } = session('world')
      fly(0.3)
      input.move(600, 0)
      fly(4)
      const bank = bankOf(runtime.snapshot().aircraft[0].orientation)
      expect(bank).toBeGreaterThan(70)
      const from = commands.length
      // 100 px: 7° of aim, across the wings at this bank.
      input.move(dx, dy)
      fly(2)
      const flown = commands.slice(from)
      expect(Math.max(...flown.map(c => Math.abs(c.yaw)))).toBeGreaterThan(0.5)
      expect(Math.max(...flown.map(c => Math.abs(c.roll)))).toBeLessThan(0.05)
      expect(Math.abs(bankOf(runtime.snapshot().aircraft[0].orientation) - bank)).toBeLessThan(3)
      expect(input.aim.direction.angleTo(forwardOf(runtime.snapshot().aircraft[0].orientation)) * 180 / Math.PI).toBeLessThan(1.5)
    }
  })
})

describe('the instructor: a moderate aim on the belly side', () => {
  for (const bankKey of [0, 0.35, 0.7] as const) it(`is pushed to, pitch down alone, with no roll (roll key held ${bankKey} s first)`, () => {
    const { input, fly, runtime, commands } = session('world')
    fly(0.3)
    if (bankKey) { input.press('KeyD'); fly(bankKey); input.held.delete('KeyD'); fly(0.8) }
    const state = runtime.snapshot().aircraft[0], bank = bankOf(state.orientation)
    // 18° toward the belly: about the right wing, nose down.
    const q = new Quaternion(state.orientation.x, state.orientation.y, state.orientation.z, state.orientation.w)
    input.mixer.aim.dir.copy(forwardOf(state.orientation)).applyAxisAngle(new Vector3(0, 0, 1).applyQuaternion(q), -18 * Math.PI / 180)
    const from = commands.length
    fly(2.5)
    const flown = commands.slice(from)
    expect(Math.min(...flown.map(c => c.pitch))).toBeLessThan(-0.4)
    expect(Math.max(...flown.map(c => Math.abs(c.roll)))).toBeLessThan(0.05)
    expect(Math.abs(bankOf(runtime.snapshot().aircraft[0].orientation) - bank)).toBeLessThan(4)
    expect(input.aim.direction.angleTo(forwardOf(runtime.snapshot().aircraft[0].orientation)) * 180 / Math.PI).toBeLessThan(2)
  })

  it('a far one still rolls over to pull', () => {
    const { input, fly, runtime, commands } = session('world')
    fly(0.3)
    const state = runtime.snapshot().aircraft[0]
    input.mixer.aim.dir.copy(forwardOf(state.orientation)).applyAxisAngle(new Vector3(0, 0, 1), -60 * Math.PI / 180)
    const from = commands.length
    fly(1)
    expect(Math.max(...commands.slice(from).map(c => Math.abs(c.roll)))).toBeGreaterThan(0.5)
  })
})
