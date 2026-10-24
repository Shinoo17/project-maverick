import { describe, expect, it } from 'vitest'
import { PerspectiveCamera, Quaternion, Vector3 } from 'three'
import { GameRuntime } from '../src/game/runtime/GameRuntime'
import { FlightInput } from '../src/game/input/FlightInput'
import { defaultMouseSettings, parseMouseSettings, type MouseSettings } from '../src/game/input/mouseStick'
import { createMouseAim, cursorRay, markOnScreen, stepAim } from '../src/game/input/mouseAim'
import { createGunnery, lockOf } from '../src/render/gunneryFrame'
import { assistRange, cursorDraw, type AimAssistLevel } from '../src/game/combat/aimAssist'
import type { TargetDroneMode } from '../src/game/playground/dronePath'
import { defaultReticle } from '../src/game/combat/gunSolution'
import { screenFrame } from '../src/game/input/mouseStick'
import { bankAbout } from '../src/game/camera/cameraRoll'
import { aimMagnet } from '../src/game/combat/aimAssist'
import { gunMountOf, solveGun } from '../src/game/combat/gunSolution'
import { WORLD_STEP, FLIGHT_STEP } from '../src/game/runtime/clock'
import { psmShareOf } from '../src/game/camera/cameraRoll'
import { FlightCamera } from '../src/render/FlightCamera'
import { createAircraft, runScenario } from '../benchmarks/flight/harness'
import { trackLeadRun } from '../benchmarks/flight/aimTrack'
import type { PracticePreset } from '../src/game/playground/practice'
import type { CameraSettings } from '../src/game/camera/cameraSettings'
import type { AircraftState } from '../src/game/state/WorldState'
import { observeAirflow } from '../src/game/flight/airflow'
import { getFlightProfile } from '../src/game/flight/profile'

/* Mouse aim (src/game/input/mouseAim.ts): the mouse turns an aim, an instructor flies the nose
   to it, and post-stall stays the pilot's with the Phase 7 shot untouched. */
const aimSettings: MouseSettings = { ...defaultMouseSettings, mode: 'aim', aimAssist: 'off' }
const noseOf = (state: AircraftState) => new Vector3(1, 0, 0).applyQuaternion(new Quaternion().copy(state.orientation))

interface Flight { reached: number; overshoot: number; final: number; pushed: boolean; firstPitch: number }
/** Flies `seconds` with the aim put `yawDeg` right and `pitchDeg` up of the nose on the first tick. */
function fly(preset: PracticePreset, yawDeg: number, pitchDeg: number, seconds = 5): Flight {
  const runtime = new GameRuntime({ mode: 'playground', aircraftIds: ['f22'] })
  runtime.reset(preset); runtime.start()
  const input = new FlightInput(aimSettings); input.engage()
  const result: Flight = { reached: -1, overshoot: 0, final: 0, pushed: false, firstPitch: 0 }
  let placed = false
  for (let frame = 0; frame < 60 * seconds; frame++) runtime.advance(1 / 60, (tick, id) => {
    const state = runtime.snapshot().aircraft[0]
    input.pose = state
    const command = input.command(tick, id, 'mouse')
    if (!placed && input.aim.synced) {
      placed = true
      const wing = new Vector3(0, 0, 1).applyQuaternion(new Quaternion().copy(state.orientation))
      input.aim.direction.applyAxisAngle(wing, pitchDeg * Math.PI / 180).applyAxisAngle(new Vector3(0, 1, 0), -yawDeg * Math.PI / 180).normalize()
      input.aim.previous.copy(input.aim.direction)
    } else if (placed && result.firstPitch === 0) result.firstPitch = command.pitch
    result.pushed ||= input.aim.pushing
    const error = noseOf(state).angleTo(input.aim.direction) * 180 / Math.PI
    if (result.reached < 0 && error < 2) result.reached = tick * WORLD_STEP
    if (result.reached >= 0) result.overshoot = Math.max(result.overshoot, error)
    result.final = error
    return command
  })
  runtime.dispose()
  return result
}

describe('mouse aim', () => {
  it('is the default mouse mode and survives a save', () => {
    expect(defaultMouseSettings.mode).toBe('aim')
    expect(parseMouseSettings({ mode: 'aim' }).mode).toBe('aim')
    expect(parseMouseSettings({ mode: 'relative' }).mode).toBe('relative')
    expect(parseMouseSettings({ mode: 'spin' }).mode).toBe('aim')
  })

  it('flies the nose onto the aim from every side without overshoot or a limit cycle', () => {
    const cases: [string, PracticePreset, number, number, number][] = [
      ['right 90°', 'free', 90, 0, 3],
      ['up 45°', 'free', 0, 45, 2],
      ['behind 150°', 'highG', 150, 0, 4],
      ['right 10°', 'free', 10, 0, 2],
      ['right 90° at 380 km/h', 'cobra', 90, 0, 3],
    ]
    for (const [name, preset, yaw, pitch, within] of cases) {
      const flight = fly(preset, yaw, pitch)
      expect(flight.reached, name).toBeGreaterThan(0)
      expect(flight.reached, name).toBeLessThan(within)
      expect(flight.overshoot, name).toBeLessThan(2.5)
      expect(flight.final, name).toBeLessThan(0.3)
    }
  })

  it('pushes to an aim a little under the nose and rolls to pull for one far under it', () => {
    const near = fly('highG', 0, -20, 2)
    expect(near.pushed).toBe(true)
    expect(near.firstPitch).toBeLessThan(0)
    expect(near.reached).toBeLessThan(1.2)
    const far = fly('highG', 0, -60, 3.5)
    expect(far.pushed).toBe(false)
    expect(far.reached).toBeGreaterThan(0)
  })

  it('tracks a circling drone without the lag of a wings-level band', () => {
    const runtime = new GameRuntime({ mode: 'playground', aircraftIds: ['f22'], targetDrone: 'circle' })
    runtime.reset('free'); runtime.start()
    const input = new FlightInput(aimSettings); input.engage()
    let samples = 0, total = 0, worst = 0
    for (let frame = 0; frame < 60 * 25; frame++) runtime.advance(1 / 60, (tick, id) => {
      const world = runtime.snapshot(), state = world.aircraft[0], drone = world.aircraft.find(entity => entity.id !== state.id)!
      input.pose = state
      // A steady hand: the cursor sits on the drone.
      if (input.aim.synced) input.aim.direction.copy(drone.position).sub(state.position).normalize()
      const command = input.command(tick, id, 'mouse')
      if (tick * WORLD_STEP > 10) {
        const error = noseOf(state).angleTo(input.aim.direction) * 180 / Math.PI
        samples++; total += error; worst = Math.max(worst, error)
      }
      return command
    })
    runtime.dispose()
    expect(total / samples).toBeLessThan(1.2)
    expect(worst).toBeLessThan(2)
  })

  it('hands every axis to a held key, settles the aim onto the nose, and matches the keyboard', () => {
    const runtime = new GameRuntime({ mode: 'playground', aircraftIds: ['f22'] })
    runtime.reset('free'); runtime.start()
    const aim = new FlightInput(aimSettings), keys = new FlightInput(aimSettings)
    aim.engage(); aim.pose = keys.pose = runtime.snapshot().aircraft[0]
    aim.command(0, 'a', 'mouse')
    aim.aim.direction.applyAxisAngle(new Vector3(0, 1, 0), -1)
    for (const input of [aim, keys]) input.press('ArrowUp')
    for (let tick = 1; tick <= 60; tick++) {
      const flown = aim.command(tick, 'a', 'mouse'), keyboard = keys.command(tick, 'a', 'keyboard')
      expect([flown.pitch, flown.roll, flown.yaw]).toEqual([keyboard.pitch, keyboard.roll, keyboard.yaw])
      expect(aim.aim.share).toBe(0)
    }
    // Half a second at the key settle puts the aim within a few degrees of the nose, without a snap.
    expect(noseOf(aim.pose!).angleTo(aim.aim.direction) * 180 / Math.PI).toBeLessThan(1)
    runtime.dispose()
  })

  it('hands over to the stick in post-stall: the instructor is gone past 35° of incidence', () => {
    const trace = runScenario('cobra', 'f22')
    const deep = trace.samples.find(sample => psmShareOf(sample.state) >= 1)!
    const aim = createMouseAim()
    stepAim(aim, deep.state, 0, false); stepAim(aim, deep.state, 1, false)
    expect(aim.share).toBeLessThan(0.01)
    const cruise = createAircraft('f22')
    stepAim(aim, cruise, 2, false)
    expect(aim.share).toBeCloseTo(1, 6)
  })

  /*
  Hands-off recovery: hands off in post-stall for ~1 s and the instructor recovers to level
  flight. Compared with the relative stick left alone (the jet's own exit), it must leave the
  first moments of the exit alone and recover sooner, or at least higher.
  */
  it('recovers from post-stall by itself once the hands are off, without spoiling the exit', () => {
    type Step = [seconds: number, keys: string[]]
    const fly = (preset: PracticePreset, steps: Step[], mode: MouseSettings['mode']) => {
      const runtime = new GameRuntime({ mode: 'playground', aircraftIds: ['f22'] })
      runtime.reset(preset); runtime.start()
      const input = new FlightInput({ ...aimSettings, mode }); input.setViewport(1000, 1000); input.engage()
      const release = steps.reduce((total, [seconds]) => total + seconds, 0)
      const result = { exitPeak: 0, recovered: -1, lowest: Infinity }
      for (let frame = 0; frame < 60 * (release + 12); frame++) {
        const t = frame / 60
        let start = 0, keys: string[] = []
        for (const [seconds, held] of steps) { if (t < start + seconds) { keys = held; break } start += seconds }
        input.held.clear(); for (const key of keys) input.held.add(key)
        runtime.advance(1 / 60, (tick, id) => {
          const state = runtime.snapshot().aircraft[0]
          input.pose = state
          const incidence = observeAirflow(state, getFlightProfile('f22')).incidenceDeg
          if (t >= release && t < release + 0.6) result.exitPeak = Math.max(result.exitPeak, incidence)
          if (t >= release) result.recovered = incidence < 15 ? (result.recovered < 0 ? t - release : result.recovered) : -1
          result.lowest = Math.min(result.lowest, state.position.y)
          return input.command(tick, id, 'mouse')
        })
      }
      runtime.dispose()
      return result
    }
    const cases: [string, PracticePreset, Step[]][] = [
      ['Cobra', 'cobra', [[1, ['Space', 'ArrowUp']]]],
      ['Kulbit', 'cobra', [[3, ['Space', 'ArrowUp']]]],
      // The deep stall found in the browser: speed bled off, then a short Cobra.
      ['bled Cobra', 'free', [[2.5, ['KeyS']], [0.3, ['Space']], [1.2, ['Space', 'ArrowUp']]]],
    ]
    for (const [name, preset, steps] of cases) {
      const aimed = fly(preset, steps, 'aim'), alone = fly(preset, steps, 'relative')
      expect(aimed.exitPeak, name).toBeCloseTo(alone.exitPeak, -1)
      expect(aimed.recovered, name).toBeGreaterThan(0)
      expect(aimed.recovered, name).toBeLessThan(11)
      expect(aimed.recovered < alone.recovered || aimed.lowest > alone.lowest, name).toBe(true)
    }
  }, 30_000)

  it('flies the same commands at 30, 60 and 144 FPS', () => {
    const run = (fps: number) => {
      const runtime = new GameRuntime({ mode: 'playground', aircraftIds: ['f22'] })
      runtime.reset('free'); runtime.start()
      const input = new FlightInput(aimSettings); input.engage()
      let placed = false
      for (let frame = 0; frame < 3 * fps; frame++) runtime.advance(1 / fps, (tick, id) => {
        input.pose = runtime.snapshot().aircraft[0]
        const command = input.command(tick, id, 'mouse')
        if (!placed && input.aim.synced) { placed = true; input.aim.direction.applyAxisAngle(new Vector3(0, 1, 0), -1.2) }
        return command
      })
      const result = { snapshot: runtime.snapshot(), replay: runtime.exportReplay() }
      runtime.dispose()
      return result
    }
    const at60 = run(60)
    expect(run(30)).toEqual(at60)
    expect(run(144)).toEqual(at60)
  })

  it('assist draws the aim toward the solution inside the cone and lets go outside it', () => {
    const shooter = createAircraft('f22'), target = createAircraft('su57'), mount = gunMountOf('f22')
    shooter.position = { x: 0, y: 1000, z: 0 }; shooter.velocity = { x: 150, y: 0, z: 0 }
    target.id = 'drone'; target.position = { x: 500, y: 1000, z: 20 }; target.velocity = { x: 150, y: 0, z: 0 }
    const solution = solveGun(shooter, mount, target)!
    const want = new Vector3(solution.aim.x, solution.aim.y, solution.aim.z).normalize()
    const aim = noseOf(shooter)
    const before = aim.angleTo(want)
    expect(aimMagnet('standard', shooter, target, mount, aim, WORLD_STEP)).toBe(true)
    expect(aim.angleTo(want)).toBeLessThan(before)
    const away = noseOf(shooter).applyAxisAngle(new Vector3(0, 1, 0), 0.5)
    expect(aimMagnet('standard', shooter, target, mount, away, WORLD_STEP)).toBe(false)
    expect(aimMagnet('off', shooter, target, mount, noseOf(shooter), WORLD_STEP)).toBe(false)
  })
})

/* Screen-locked mouse aim ('cursor'): the × roams the window like the positional stick, and the
   instructor flies the nose toward the direction it points at. */
describe('screen-locked mouse aim', () => {
  interface Sample { t: number; heading: number; elevation: number; bank: number; altitude: number; noseX: number }
  /** Holds the × at (x, y) of the half-window for `hold` seconds, then puts it back in the middle. */
  function hold(x: number, y: number, holdSeconds: number, seconds: number, fps = 60) {
    const runtime = new GameRuntime({ mode: 'playground', aircraftIds: ['f22'] })
    runtime.reset('highG'); runtime.start()
    const input = new FlightInput({ ...aimSettings, mode: 'cursor' }); input.setViewport(1000, 1000); input.engage()
    const reach = input.gate.halfWidth
    input.move(x * reach, -y * reach)
    const samples: Sample[] = []
    let unwrapped = 0, last = 0
    for (let frame = 0; frame < fps * seconds; frame++) {
      if (frame === Math.round(fps * holdSeconds)) input.move(-x * reach, y * reach)
      runtime.advance(1 / fps, (tick, id) => {
        const state = runtime.snapshot().aircraft[0]
        input.pose = state
        input.cursorFrame = screenFrame(state, { roll: 'horizon', horizonStyle: 'dynamic' })
        const q = new Quaternion().copy(state.orientation), nose = new Vector3(1, 0, 0).applyQuaternion(q)
        const heading = Math.atan2(nose.z, nose.x) * 180 / Math.PI
        unwrapped += ((heading - last + 540) % 360) - 180; last = heading
        samples.push({ t: tick * WORLD_STEP, heading: unwrapped, elevation: Math.asin(nose.y) * 180 / Math.PI,
          bank: bankAbout(nose, new Vector3(0, 1, 0).applyQuaternion(q)) * 180 / Math.PI, altitude: state.position.y, noseX: nose.x })
        return input.command(tick, id, 'mouse')
      })
    }
    const result = { samples, snapshot: runtime.snapshot(), replay: runtime.exportReplay() }
    runtime.dispose()
    return result
  }
  const at = (samples: Sample[], t: number) => samples.reduce((best, sample) => Math.abs(sample.t - t) < Math.abs(best.t - t) ? sample : best)

  it('is a mouse mode that survives a save', () => {
    expect(parseMouseSettings({ mode: 'cursor' }).mode).toBe('cursor')
  })

  it('flies toward where the × points: off to the right it keeps turning level, back in the middle it stops', () => {
    const { samples } = hold(0.15, 0, 6, 9)
    const rate = (at(samples, 5).heading - at(samples, 2).heading) / 3
    expect(rate).toBeGreaterThan(6)
    for (const sample of samples.filter(sample => sample.t > 1 && sample.t < 6)) {
      expect(Math.abs(sample.altitude - 900)).toBeLessThan(25)
      expect(sample.bank).toBeGreaterThan(55); expect(sample.bank).toBeLessThan(85)
    }
    const settled = at(samples, 8.5)
    expect(Math.abs(settled.bank)).toBeLessThan(3)
    expect(Math.abs(settled.heading - at(samples, 7.5).heading)).toBeLessThan(1)
  })

  it('turns harder the further out the × sits, up to the edge of the window', () => {
    const rate = (x: number) => { const samples = hold(x, 0, 6, 6).samples; return (at(samples, 5).heading - at(samples, 2).heading) / 3 }
    const gentle = rate(0.15), half = rate(0.5), edge = rate(1)
    expect(half).toBeGreaterThan(gentle * 2)
    expect(edge).toBeGreaterThan(half)
  })

  it('points the nose up while the × is above the middle, and holds it there once it is back', () => {
    const { samples } = hold(0, 0.3, 2, 5)
    expect(at(samples, 2).elevation).toBeGreaterThan(30)
    expect(Math.abs(at(samples, 4.5).elevation - at(samples, 3).elevation)).toBeLessThan(6)
    expect(Math.abs(at(samples, 4.5).bank)).toBeLessThan(3)
  })

  it('flies the same at 30, 60 and 144 FPS', () => {
    const run = (fps: number) => { const { snapshot, replay } = hold(0.4, 0.2, 2, 3, fps); return { snapshot, replay } }
    const at60 = run(60)
    expect(run(30)).toEqual(at60)
    expect(run(144)).toEqual(at60)
  })
})

/* Cursor mode through the rendered camera: the × is where the gun aims (the reticle). */
describe('screen-locked mouse aim through the camera', () => {
  const W = 1600, H = 900
  /** Flies cursor mode the way FlightScene does: camera after each frame, the ray from it. `place`
   * returns the × in pixels from the middle, given the camera and the aircraft. */
  function fly(seconds: number, place: (camera: PerspectiveCamera, state: AircraftState, frame: number) => { x: number; y: number } | null) {
    const runtime = new GameRuntime({ mode: 'playground', aircraftIds: ['f22'] })
    runtime.reset('highG'); runtime.start()
    const input = new FlightInput({ ...aimSettings, mode: 'cursor' }); input.setViewport(W, H); input.engage()
    const rig = new FlightCamera(), camera = new PerspectiveCamera(56, W / H, 0.5, 14000), mount = gunMountOf('f22')
    const view: CameraSettings = { roll: 'horizon', horizonStyle: 'balanced' }
    const pixel = (point: { x: number; y: number; z: number }) => {
      const p = new Vector3(point.x, point.y, point.z).project(camera)
      return { x: p.x * W / 2, y: -p.y * H / 2 }
    }
    const trace: { reticle: { x: number; y: number }; cursor: { x: number; y: number }; heading: number; bank: number }[] = []
    let state = runtime.snapshot().aircraft[0]
    for (let frame = 0; frame < 60 * seconds; frame++) {
      rig.update(camera, state, view, 1 / 60); camera.updateMatrixWorld()
      const want = place(camera, state, frame)
      if (want) { input.move(want.x - input.stick.px, want.y - input.stick.py) }
      input.cursorRay = cursorRay(camera, input.stick.px, input.stick.py, W, H, state.position)
      const q = new Quaternion().copy(state.orientation), nose = new Vector3(1, 0, 0).applyQuaternion(q)
      trace.push({ reticle: pixel(defaultReticle(state, mount)), cursor: { x: input.stick.px, y: input.stick.py },
        heading: Math.atan2(nose.z, nose.x) * 180 / Math.PI, bank: bankAbout(nose, new Vector3(0, 1, 0).applyQuaternion(q)) * 180 / Math.PI })
      runtime.advance(1 / 60, (tick, id) => {
        const live = runtime.snapshot().aircraft[0]
        input.pose = live
        input.cursorFrame = screenFrame(live, { roll: 'horizon', horizonStyle: 'dynamic' })
        return input.command(tick, id, 'mouse')
      })
      state = runtime.snapshot().aircraft[0]
    }
    runtime.dispose()
    return trace
  }

  it('flies straight with the × on the reticle: the × and the drawn reticle are the same point', () => {
    let start: { x: number; y: number } | null = null
    const trace = fly(4, (camera, state, frame) => {
      if (frame === 0) { const p = new Vector3().copy(defaultReticle(state, gunMountOf('f22')) as Vector3).project(camera); start = { x: p.x * W / 2, y: -p.y * H / 2 } }
      return frame === 0 ? start : null
    })
    // At the middle of the screen the × would be ~4° off the reticle; on it, nothing moves.
    expect(Math.abs(trace[0].reticle.y)).toBeGreaterThan(30)
    expect(Math.abs(trace.at(-1)!.heading - trace[0].heading)).toBeLessThan(1)
    for (const sample of trace.slice(60)) {
      expect(Math.abs(sample.bank)).toBeLessThan(2)
      expect(Math.hypot(sample.reticle.x - sample.cursor.x, sample.reticle.y - sample.cursor.y)).toBeLessThan(4)
    }
  })

  it('brings the reticle onto a point the × is kept on', () => {
    // A fixed point in the world 25° right of the spawn heading and a little up, held under the × by hand.
    let goal: Vector3 | null = null
    const trace = fly(6, (camera, state) => {
      if (!goal) {
        const nose = new Vector3(1, 0, 0).applyQuaternion(new Quaternion().copy(state.orientation))
        goal = nose.applyAxisAngle(new Vector3(0, 1, 0), -25 * Math.PI / 180).multiplyScalar(2000).add(new Vector3(0, 60, 0)).add(state.position as Vector3)
      }
      const p = goal.clone().project(camera)
      return { x: p.x * W / 2, y: -p.y * H / 2 }
    })
    const last = trace.slice(-60)
    for (const sample of last) expect(Math.hypot(sample.reticle.x - sample.cursor.x, sample.reticle.y - sample.cursor.y)).toBeLessThan(10)
    expect(Math.abs(trace.at(-1)!.bank)).toBeLessThan(5)
  })

  it('keeps turning while the × is held to one side of the reticle', () => {
    const trace = fly(5, (camera, state, frame) => {
      if (frame !== 0) return null
      const p = new Vector3().copy(defaultReticle(state, gunMountOf('f22')) as Vector3).project(camera)
      return { x: p.x * W / 2 + 200, y: -p.y * H / 2 }
    })
    const rate = (trace[60 * 4].heading - trace[60 * 2].heading) / 2
    expect(rate).toBeGreaterThan(8)
  })
})

describe('mouse aim camera', () => {
  const views: CameraSettings[] = [{ roll: 'horizon', horizonStyle: 'balanced' }, { roll: 'horizon', horizonStyle: 'dynamic' }, { roll: 'aircraft', horizonStyle: 'balanced' }]
  const newCamera = () => new PerspectiveCamera(69, 16 / 9, 0.5, 14000)

  it('looks along the aim in cruise', () => {
    const state = createAircraft('f22')
    state.position = { x: 0, y: 3000, z: 0 }; state.velocity = { x: 150, y: 0, z: 0 }
    const rig = new FlightCamera(), camera = newCamera()
    rig.aim = new Vector3(1, 0, 0).applyAxisAngle(new Vector3(0, 1, 0), -0.6)
    for (let frame = 0; frame < 240; frame++) rig.update(camera, state, views[0], 1 / 60)
    const look = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion)
    look.y = 0
    expect(look.normalize().angleTo(new Vector3(rig.aim.x, 0, rig.aim.z).normalize())).toBeLessThan(0.05)
  })

  /*
  The PSM shot is the Phase 7 shot whatever the aim was, frame for frame. The hard case is over
  the top of a Kulbit or a reversal, where the level horizon rolls back from inverted and which
  way it rolls is a knife edge: FlightCamera carries that horizon on the look without the aim
  (`noseLook`), so an aim thrown 60° off before the entry cannot tip it.
  */
  it('leaves the PSM shot untouched through live tracks, and swings back to it without a whip', () => {
    const fly = (name: 'cobra' | 'kulbit' | 'tailSlide' | 'reversal180', view: CameraSettings, offset: number) => {
      const trace = runScenario(name, 'f22')
      const reference = newCamera(), referenceRig = new FlightCamera()
      const camera = newCamera(), rig = new FlightCamera()
      // Flown the way FlightInput flies it while a key is held: the aim settles onto the nose.
      const aim = createMouseAim()
      stepAim(aim, trace.samples[0].state, 0, true)
      aim.direction.applyAxisAngle(new Vector3(0, 1, 0), -offset)
      const result = { compared: 0, angle: 0, distance: 0, look: 0, fastest: 0, referenceFastest: 0 }
      let heldFor = 0
      for (let i = 0; i < trace.samples.length; i += 2) {
        const state = trace.samples[i].state
        stepAim(aim, state, Math.round(i * FLIGHT_STEP / WORLD_STEP), true)
        rig.aim = aim.direction
        heldFor = psmShareOf(state) >= 1 ? heldFor + 2 * FLIGHT_STEP : 0
        const last = camera.quaternion.clone(), lastReference = reference.quaternion.clone()
        referenceRig.update(reference, state, view, 2 * FLIGHT_STEP)
        rig.update(camera, state, view, 2 * FLIGHT_STEP)
        const rate = (from: Quaternion, to: Quaternion) => from.angleTo(to) / (2 * FLIGHT_STEP) * 180 / Math.PI
        if (i > 0) { result.fastest = Math.max(result.fastest, rate(last, camera.quaternion)); result.referenceFastest = Math.max(result.referenceFastest, rate(lastReference, reference.quaternion)) }
        if (heldFor < 1) continue
        result.compared++
        result.angle = Math.max(result.angle, camera.quaternion.angleTo(reference.quaternion))
        result.distance = Math.max(result.distance, camera.position.distanceTo(reference.position))
        const look = (c: PerspectiveCamera) => new Vector3(0, 0, -1).applyQuaternion(c.quaternion)
        result.look = Math.max(result.look, Math.abs(look(camera).y - look(reference).y))
      }
      return result
    }
    for (const view of views) {
      for (const name of ['cobra', 'kulbit', 'tailSlide', 'reversal180'] as const) {
        for (const offset of [0, Math.PI / 3]) {
          const flown = fly(name, view, offset), label = `${name} ${view.roll} ${view.horizonStyle} aim ${offset.toFixed(2)}`
          if (name !== 'reversal180') expect(flown.compared, label).toBeGreaterThan(0)
          expect(flown.angle, label).toBeLessThan(0.01)
          expect(flown.distance, label).toBeLessThan(0.1)
          // The swing from the aim back to the nose is eased, never a whip: no faster than the look's
          // own rate limit (240°/s), or than the manoeuvre already turns the reference camera.
          expect(flown.fastest, label).toBeLessThan(Math.max(260, flown.referenceFastest + 10))
        }
      }
    }
  }, 30_000)
})

/* Screen-locked aim assist (23 Oct 2026): the × is drawn onto the lead marker, harder while
   firing, and the drawn reticle is the one the × aims, so × on lead is reticle on lead. */
describe('screen-locked aim assist', () => {
  const W = 1600, H = 900
  interface Frame { cursorToLead: number; reticleToLead: number; lock: string; onSolution: boolean; leadToTarget: number; assisting: boolean; range: number }
  /** Flies cursor mode the way FlightScene does, against a still drone 1,300 m ahead. Frames are
   * kept from when the drone comes into the gun's reach (a lead marker, about 1,000 m, ~2.5 s in);
   * `hand` moves the × each of them (pixels), given the lead marker on screen; null leaves it be. */
  type Hand = (lead: { x: number; y: number }, cursor: { x: number; y: number }, frame: number, target: { x: number; y: number }, range: number) => { x: number; y: number } | null
  function duel(level: AimAssistLevel, seconds: number, hand: Hand, fire = false, drone: TargetDroneMode = 'still') {
    const runtime = new GameRuntime({ mode: 'playground', aircraftIds: ['f22'], targetDrone: drone })
    runtime.reset('free'); runtime.start()
    const input = new FlightInput({ ...aimSettings, mode: 'cursor', aimAssist: level }); input.setViewport(W, H); input.engage()
    input.mouseGun = fire
    const rig = new FlightCamera(), camera = new PerspectiveCamera(56, W / H, 0.5, 14000), gunnery = createGunnery('f22')
    const frames: Frame[] = []
    let before = runtime.snapshot(), now = before, assisting = false
    for (let frame = 0; frame < 60 * seconds; frame++) {
      const state = now.aircraft[0]
      rig.update(camera, state, { roll: 'horizon', horizonStyle: 'balanced' }, 1 / 60); camera.updateMatrixWorld()
      input.setLens(camera.fov)
      let marks = gunnery.update(before, now, 1, { id: state.id, targetId: state.targeting.targetId, position: state.position, orientation: state.orientation, velocity: state.velocity }, [], assisting)
      const lead = marks.lead ? markOnScreen(camera, marks.lead, input.stick, W, H) : null
      const pixel = (p: { x: number; y: number; z: number }) => { const v = new Vector3(p.x, p.y, p.z).project(camera); return { x: v.x * W / 2, y: -v.y * H / 2 } }
      // Out of reach the hand keeps the × on the drone, as a pilot closing on it would.
      const want = lead && marks.target ? hand(lead.point, { x: input.stick.px, y: input.stick.py }, frames.length, pixel(marks.target.position), marks.target.range) : marks.target ? pixel(marks.target.position) : null
      if (want) input.move(want.x - input.stick.px, want.y - input.stick.py)
      const after = lead && markOnScreen(camera, marks.lead!, input.stick, W, H)
      const body = after && marks.target ? markOnScreen(camera, marks.target.position, input.stick, W, H) : null
      assisting = input.drawCursor(after && after.point, after?.errorDeg ?? Infinity, body?.errorDeg ?? Infinity, 1 / 60, marks.target?.range ?? Infinity)
      marks = { ...marks, assist: assisting }; marks.lock = lockOf(marks)
      if (marks.lead && marks.reticle) {
        const l = pixel(marks.lead), r = pixel(marks.reticle)
        const t = pixel(marks.target!.position)
        frames.push({ cursorToLead: Math.hypot(l.x - input.stick.px, l.y - input.stick.py), reticleToLead: Math.hypot(l.x - r.x, l.y - r.y), lock: marks.lock, onSolution: marks.onSolution,
          leadToTarget: Math.hypot(l.x - t.x, l.y - t.y), assisting, range: marks.target!.range })
      }
      input.cursorRay = cursorRay(camera, input.stick.px, input.stick.py, W, H, state.position)
      runtime.advance(1 / 60, (tick, id) => {
        before = runtime.snapshot()
        const live = before.aircraft[0]
        input.pose = live
        input.target = before.aircraft.find(entity => entity.id === live.targeting.targetId) ?? null
        input.cursorFrame = screenFrame(live, { roll: 'horizon', horizonStyle: 'dynamic' })
        return input.command(tick, id, 'mouse')
      })
      now = runtime.snapshot()
    }
    runtime.dispose()
    return frames
  }
  // The hand puts the × 3° (50 px) off the lead once, then lets go.
  // The hand keeps the × on the lead until the target is inside the assist's full range (800 m),
  // then puts it off the lead once and lets go.
  const offLead = (): Hand => {
    let moved = false
    return (lead, _cursor, _frame, _target, range) => {
      if (range > assistRange[0]) return lead
      if (moved) return null
      moved = true
      return { x: lead.x + 40, y: lead.y - 30 }
    }
  }
  /** Frames from the hand letting go, inside 800 m. */
  const fromRelease = (frames: Frame[]) => frames.slice(frames.findIndex(frame => frame.range <= assistRange[0]) + 1)

  it('is not dead in cursor mode: it draws the × onto the lead, and off it does nothing', () => {
    const drawn = fromRelease(duel('standard', 6.5, offLead())), alone = fromRelease(duel('off', 6.5, offLead()))
    expect(drawn.at(-1)!.cursorToLead).toBeLessThan(6)
    expect(alone.at(-1)!.cursorToLead).toBeGreaterThan(30)
    expect(drawn.some(frame => frame.lock === 'captured')).toBe(true)
    expect(alone.every(frame => frame.lock !== 'captured')).toBe(true)
  })

  it('puts the drawn reticle on the lead when the × is on it, bullet drop included', () => {
    const frames = duel('off', 6, lead => lead)
    for (const frame of frames.slice(-60)) expect(frame.reticleToLead).toBeLessThan(5)
    expect(frames.slice(-60).every(frame => frame.onSolution)).toBe(true)
    // In range by the end (about 500 m): locked, the red the HUD draws.
    expect(frames.at(-1)!.range).toBeLessThan(800)
    expect(frames.at(-1)!.lock).toBe('locked')
  })

  it('draws harder while the trigger is held', () => {
    const settled = (frames: Frame[]) => frames.findIndex(frame => frame.cursorToLead < 4)
    const idle = settled(fromRelease(duel('standard', 6, offLead()))), firing = settled(fromRelease(duel('standard', 6, offLead(), true)))
    expect(firing).toBeGreaterThan(0)
    expect(firing).toBeLessThan(idle * 0.6)
  })

  it('gives way to a hand that moves the × away, even while firing', () => {
    // From on the lead, the hand sweeps right at 600 px/s for 2.5 s (the drone spawns inside the gun's reach).
    const frames = duel('standard', 2.5, (lead, cursor, frame) => frame === 0 ? lead : { x: cursor.x + 10, y: cursor.y }, true)
    expect(frames.at(-1)!.cursorToLead).toBeGreaterThan(150)
  })

  it('captures a × on the target itself while firing, where a crossing target puts the lead outside the cone', () => {
    // A 250 m/s crossing target: the lead ~12° off the airframe, outside the standard 8° cone.
    expect(cursorDraw('standard', 12, 0.5, 1 / 60, false, 0, 500)).toBe(0)
    expect(cursorDraw('standard', 12, 0.5, 1 / 60, true, 0, 500)).toBeGreaterThan(0)
    // And neither near: nothing.
    expect(cursorDraw('standard', 12, 9, 1 / 60, true, 0, 500)).toBe(0)
  })

  it('keeps the reticle on a crossing target\'s lead with the × on it: red, not just amber', () => {
    // Without the lead's turn fed forward the nose trailed a 150 m/s crossing target by ~7°.
    const slow = trackLeadRun('crossing150'), fast = trackLeadRun('crossing250')
    expect(slow.meanErrorDeg).toBeLessThan(0.8)
    expect(slow.onSolutionShare).toBeGreaterThan(0.9)
    expect(fast.onSolutionShare).toBeGreaterThan(0.35)
  })

  it('keeps the × on the same direction through a change of lens', () => {
    const input = new FlightInput({ ...aimSettings, mode: 'cursor' }); input.setViewport(W, H); input.engage()
    input.move(300, -120)
    const angle = (fov: number) => { const focal = H / 2 / Math.tan(fov * Math.PI / 360); return [Math.atan2(input.stick.px, focal), Math.atan2(-input.stick.py, focal)] }
    input.setLens(56)
    const wide = angle(56)
    input.setLens(40)
    const zoomed = angle(40)
    expect(zoomed[0]).toBeCloseTo(wide[0], 6); expect(zoomed[1]).toBeCloseTo(wide[1], 6)
  })
})
