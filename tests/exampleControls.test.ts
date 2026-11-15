import { describe, expect, it } from 'vitest'
import { PerspectiveCamera, Quaternion, Vector3 } from 'three'
import { GameRuntime } from '../src/game/runtime/GameRuntime'
import { WORLD_STEP } from '../src/game/runtime/clock'
import { neutralCommand } from '../src/game/runtime/commands'
import type { AircraftState } from '../src/game/state/WorldState'
import { FlightInput, type InputPreset } from '../src/game/input/FlightInput'
import { StateAircraft, toExampleFrame } from '../src/game/control/controlAircraft'
import { parseMouseSettings, defaultMouseSettings } from '../src/game/control/mouseSettings'
import { availableRates } from '../src/game/flightCore/rotation'
import { coreProfileOf } from '../src/game/flightCore/profile'
import { GRAVITY } from '../src/game/flightCore/aero'
import { defaultBindings, parseKeyboardSettings } from '../src/game/input/keyBindings'
import { defaultCameraSettings, nextCameraSettings, parseCameraSettings } from '../src/game/camera/cameraSettings'
import { ArcadeCamera } from '../src/render/ArcadeCamera'

/*
The controls ported from example/flight-control (src/game/control/, FlightInput, ArcadeCamera):
the frame adapter, the progressive keyboard, mouse aim on the new flight core, the PSM virtual
stick, the camera, and the saved-settings migrations.
*/
const forwardOf = (q: { x: number; y: number; z: number; w: number }) => new Vector3(1, 0, 0).applyQuaternion(new Quaternion(q.x, q.y, q.z, q.w))

function newCore(aircraft = 'f22') {
  const runtime = new GameRuntime({ mode: 'playground', mapId: 'flat-range', aircraftIds: [aircraft as 'f22'], flightCore: 'new' })
  runtime.start()
  return runtime
}

/** Flies `seconds` at 60 Hz with the input in `preset`, the pose refreshed per tick as the flight scene does. */
function fly(runtime: GameRuntime, input: FlightInput, seconds: number, preset: InputPreset = 'mouse', each?: (state: AircraftState, tick: number) => void) {
  for (let i = 0; i < Math.round(seconds / WORLD_STEP); i++) runtime.advance(WORLD_STEP, (tick, id) => {
    const live = runtime.snapshot().aircraft[0]
    input.pose = live
    each?.(live, tick)
    return input.command(tick, id, preset)
  })
  return runtime.snapshot().aircraft[0]
}

describe('frame adapter', () => {
  it('turns the project body frame (+X forward) into the example frame (+Z forward) and relabels rates', () => {
    const q = new Quaternion().setFromAxisAngle(new Vector3(0.3, 0.8, -0.5).normalize(), 1.1)
    const example = toExampleFrame(q)
    expect(new Vector3(0, 0, 1).applyQuaternion(example).distanceTo(new Vector3(1, 0, 0).applyQuaternion(q))).toBeLessThan(1e-9)
    expect(new Vector3(0, 1, 0).applyQuaternion(example).distanceTo(new Vector3(0, 1, 0).applyQuaternion(q))).toBeLessThan(1e-9)
    // Example left (+X) is project right (+Z) negated.
    expect(new Vector3(1, 0, 0).applyQuaternion(example).distanceTo(new Vector3(0, 0, -1).applyQuaternion(q))).toBeLessThan(1e-9)
    const state = newCore().snapshot().aircraft[0]
    state.rates = { pitch: 0.1, yaw: 0.2, roll: 0.3 }
    const aircraft = new StateAircraft().read(state)
    expect(aircraft.rates.toArray()).toEqual([0.1, 0.2, 0.3])
  })

  it('divides by the core\'s own available rates, pitch capped by the G limit', () => {
    const state = newCore().snapshot().aircraft[0], p = coreProfileOf('f22')
    for (const speed of [60, 150, 300, 500]) {
      state.velocity = { x: speed, y: 0, z: 0 }
      const limits = new StateAircraft().read(state).rateLimits()
      const { available } = availableRates(speed, 0, p)
      expect(limits.y).toBeCloseTo(available.yaw, 12)
      expect(limits.z).toBeCloseTo(available.roll, 12)
      expect(limits.x).toBeCloseTo(Math.min(available.pitch, p.gLimit * GRAVITY / speed), 12)
    }
  })
})

describe('progressive keyboard', () => {
  it('builds a held key up over time, decays it on release, and steps once per command tick', () => {
    const input = new FlightInput()
    input.press('ArrowUp')
    const first = input.command(0, 'a', 'keyboard').pitch
    expect(first).toBeGreaterThan(0); expect(first).toBeLessThan(0.1)
    // Asked again within the same tick, the axis does not move.
    expect(input.command(0, 'a', 'keyboard').pitch).toBe(first)
    let pitch = first
    for (let tick = 1; tick < 60; tick++) pitch = input.command(tick, 'a', 'keyboard').pitch
    expect(pitch).toBe(1)
    input.held.delete('ArrowUp')
    let tick = 60
    for (; pitch > 0 && tick < 200; tick++) pitch = input.command(tick, 'a', 'keyboard').pitch
    expect(pitch).toBe(0); expect(tick).toBeLessThan(120)
  })

  it('rolls on A/D and ←/→, yaws on Q/E, and holds speed with W/S released', () => {
    const roll = (code: string) => { const input = new FlightInput(); input.press(code); let c = input.command(0, 'a', 'keyboard'); for (let t = 1; t < 60; t++) c = input.command(t, 'a', 'keyboard'); return c }
    expect(roll('KeyD').roll).toBe(1); expect(roll('ArrowRight').roll).toBe(1)
    expect(roll('KeyA').roll).toBe(-1); expect(roll('ArrowLeft').roll).toBe(-1)
    expect(roll('KeyE').yaw).toBe(1); expect(roll('KeyQ').yaw).toBe(-1)
    expect(roll('KeyW').speedAdjust).toBe(1); expect(roll('KeyS').speedAdjust).toBe(-1)
    expect(new FlightInput().command(0, 'a', 'keyboard')).toEqual(neutralCommand(0, 'a'))
  })

  it('replays the same flight at 30, 60 and 144 FPS', () => {
    const run = (fps: number) => {
      const runtime = newCore(), input = new FlightInput()
      for (let frame = 0; frame < fps * 3; frame++) runtime.advance(1 / fps, (tick, id) => {
        input.pose = runtime.snapshot().aircraft[0]
        if (tick === 10) input.press('ArrowUp')
        if (tick === 70) { input.held.delete('ArrowUp'); input.press('KeyD') }
        if (tick === 120) input.held.delete('KeyD')
        return input.command(tick, id, 'mouse')
      })
      return runtime.snapshot()
    }
    const at60 = run(60)
    expect(run(30)).toEqual(at60); expect(run(144)).toEqual(at60)
  })
})

describe('mouse aim on the new core', () => {
  /** Puts the aim `yawDeg` right and `pitchDeg` up of the nose, after the first tick synced it. */
  function aimOff(state: AircraftState, yawDeg: number, pitchDeg: number) {
    const q = new Quaternion().copy(state.orientation)
    const up = new Vector3(0, 1, 0).applyQuaternion(q), right = new Vector3(0, 0, 1).applyQuaternion(q)
    return forwardOf(state.orientation).applyAxisAngle(up, -yawDeg * Math.PI / 180).applyAxisAngle(right, pitchDeg * Math.PI / 180).normalize()
  }

  for (const [yaw, pitch, limit] of [[30, 10, 'limited'], [-50, -5, 'limited'], [120, 0, 'free']] as const) {
    it(`flies the nose onto an aim ${yaw}° right, ${pitch}° up (${limit}) and settles there`, () => {
      const runtime = newCore(), input = new FlightInput({ ...defaultMouseSettings, aimLimit: limit })
      let aim: Vector3 | null = null
      const errors: number[] = []
      fly(runtime, input, 6, 'mouse', (state, tick) => {
        if (tick === 2) { aim = aimOff(state, yaw, pitch); input.mixer.aim.dir.copy(aim) }
        if (aim) errors.push(forwardOf(state.orientation).angleTo(aim) * 180 / Math.PI)
      })
      const last = errors.slice(-60)
      expect(Math.max(...last)).toBeLessThan(3)
      // Settled, not hunting: the last second barely moves.
      expect(Math.max(...last) - Math.min(...last)).toBeLessThan(1)
    })
  }

  it('hands an axis to a held key and drags the aim along with the nose', () => {
    const runtime = newCore(), input = new FlightInput()
    fly(runtime, input, 0.2)
    input.press('ArrowUp')
    const state = fly(runtime, input, 1)
    expect(input.lastCommand!.pitch).toBeGreaterThan(0.9)
    // The aim rode on the nose, so releasing the key leaves nothing to spring back to.
    expect(input.aim.direction.angleTo(forwardOf(state.orientation)) * 180 / Math.PI).toBeLessThan(2)
  })

  it('turns the mouse into a virtual stick while Space is held: up pulls, centre holds', () => {
    const runtime = newCore(), input = new FlightInput()
    const view = new PerspectiveCamera(62, 16 / 9, 0.5, 14000)
    view.position.set(-30, 1004, 0); view.lookAt(1000, 1000, 0); view.updateMatrixWorld()
    input.setView(view); input.setViewport(1600, 900)
    fly(runtime, input, 0.2)
    input.press('Space')
    fly(runtime, input, 1 / 60)
    input.move(0, -300)
    expect(input.virtualStick).not.toBeNull()
    fly(runtime, input, 0.1)
    expect(input.lastCommand!.pitch).toBeGreaterThan(0.3)
    expect(input.lastCommand!.psm).toBe(true)
    input.held.delete('Space')
    fly(runtime, input, 1 / 60)
    expect(input.virtualStick).toBeNull()
  })
})

describe('arcade chase camera', () => {
  const settle = (mode: 'aircraft' | 'horizon' | 'aim', state: AircraftState, aim: Vector3 | null = null) => {
    const rig = new ArcadeCamera(), camera = new PerspectiveCamera(56, 16 / 9, 0.5, 14000)
    rig.aim = aim
    for (let i = 0; i < 240; i++) rig.update(camera, state, { ...defaultCameraSettings, mode }, 1 / 60)
    camera.updateMatrixWorld()
    return { rig, camera }
  }
  const level = () => { const state = newCore().snapshot().aircraft[0]; state.position = { x: 0, y: 1000, z: 0 }; state.velocity = { x: 200, y: 0, z: 0 }; state.orientation = { x: 0, y: 0, z: 0, w: 1 }; return state }

  it('sits behind and above the jet, looking along its nose, in every mode', () => {
    for (const mode of ['aircraft', 'horizon', 'aim'] as const) {
      const state = level(), { camera, rig } = settle(mode, state, mode === 'aim' ? new Vector3(1, 0, 0) : null)
      const toJet = new Vector3().copy(state.position as Vector3).sub(camera.position)
      expect(toJet.x).toBeGreaterThan(5)
      expect(camera.position.y).toBeGreaterThan(state.position.y)
      expect(new Vector3(0, 0, -1).applyQuaternion(camera.quaternion).x).toBeGreaterThan(0.95)
      expect(rig.chase.angleTo(camera.quaternion)).toBeLessThan(0.02)
    }
  })

  it('rolls with the jet in Aircraft lock and keeps the horizon in Horizon lock', () => {
    const banked = () => { const state = level(); const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 3); state.orientation = { x: q.x, y: q.y, z: q.z, w: q.w }; return state }
    const upOf = (camera: PerspectiveCamera) => new Vector3(0, 1, 0).applyQuaternion(camera.quaternion)
    expect(upOf(settle('aircraft', banked()).camera).y).toBeCloseTo(Math.cos(Math.PI / 3), 1)
    expect(upOf(settle('horizon', banked()).camera).y).toBeGreaterThan(0.85)
  })

  it('never writes the state it reads', () => {
    const state = level(), before = structuredClone(state)
    settle('aim', state, new Vector3(0.9, 0.3, 0.3).normalize())
    expect(state).toEqual(before)
  })
})

describe('saved settings', () => {
  it('cycles Aircraft lock → Horizon lock → Aim lock and repairs bad values', () => {
    expect(defaultCameraSettings.mode).toBe('aim')
    expect(nextCameraSettings({ ...defaultCameraSettings, mode: 'aircraft' })).toMatchObject({ mode: 'horizon', roll: 'horizon' })
    expect(nextCameraSettings({ ...defaultCameraSettings, mode: 'horizon' }).mode).toBe('aim')
    expect(nextCameraSettings({ ...defaultCameraSettings, mode: 'aim' })).toMatchObject({ mode: 'aircraft', roll: 'aircraft' })
    // A save from before the port (no mode) starts on the default.
    expect(parseCameraSettings({ roll: 'aircraft', horizonStyle: 'dynamic' })).toEqual({ mode: 'aim', roll: 'horizon', horizonStyle: 'dynamic' })
    expect(parseCameraSettings({ mode: 'spin' })).toEqual(defaultCameraSettings)
  })

  it('reads an old mouse save as the defaults plus what still applies', () => {
    expect(parseMouseSettings({ mode: 'stick', frame: 'horizon', xAxis: 'yaw', sensitivity: 1.5, invertPitch: true, aimAssist: 'strong' }))
      .toEqual({ sensitivity: 1.5, invertPitch: true, aimLimit: 'limited', aimAssist: 'strong' })
    expect(parseMouseSettings({ aimLimit: 'free' }).aimLimit).toBe('free')
  })

  it('migrates bindings to version 3: the coordinated turn keys become the second roll keys', () => {
    const v2 = parseKeyboardSettings({ bindingsVersion: 2, bindings: { ...defaultBindings, rollLeft: ['KeyA', null], rollRight: ['KeyD', null], turnLeft: ['ArrowLeft', null], turnRight: ['ArrowRight', null] } })
    expect(v2.bindingsVersion).toBe(3)
    expect(v2.bindings.rollLeft).toEqual(['KeyA', 'ArrowLeft']); expect(v2.bindings.rollRight).toEqual(['KeyD', 'ArrowRight'])
    expect(v2.bindings.inputMode).toEqual(['KeyM', null]); expect(v2.bindings.aimLimit).toEqual(['KeyG', null])
    // A turn key the player moved elsewhere is not taken.
    const moved = parseKeyboardSettings({ bindingsVersion: 2, bindings: { ...defaultBindings, rollLeft: ['KeyA', null], turnLeft: ['KeyZ', null], countermeasure: ['ArrowLeft', null] } })
    expect(moved.bindings.rollLeft).toEqual(['KeyA', 'KeyZ']); expect(moved.bindings.countermeasure[0]).toBe('ArrowLeft')
    // A version 1 save gets the arrows back as roll keys.
    expect(parseKeyboardSettings({ bindings: { rollLeft: ['KeyA', 'ArrowLeft'], rollRight: ['KeyD', 'ArrowRight'], airbrake: ['Space', null] } }).bindings.rollLeft).toEqual(['KeyA', 'ArrowLeft'])
  })
})
