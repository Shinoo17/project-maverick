import { describe, expect, it } from 'vitest'
import { PerspectiveCamera, Quaternion, Vector3 } from 'three'
import { createAircraft, runScenario, runTrack } from '../benchmarks/flight/harness'
import { driftSpawn } from '../benchmarks/flight/jetDrift'
import { FLIGHT_STEP } from '../src/game/runtime/clock'
import { FlightCamera } from '../src/render/FlightCamera'
import { screenFrame } from '../src/game/input/mouseStick'
import { BALANCED_TILT, driftShareOf, psmShareOf } from '../src/game/camera/cameraRoll'
import { defaultCameraSettings, nextCameraSettings, parseCameraSettings, type CameraSettings } from '../src/game/camera/cameraSettings'
import { parseSettings } from '../src/platform/storage'
import type { AircraftState } from '../src/game/state/WorldState'

const BALANCED: CameraSettings = { roll: 'horizon', horizonStyle: 'balanced' }
const DYNAMIC: CameraSettings = { roll: 'horizon', horizonStyle: 'dynamic' }
const AIRCRAFT: CameraSettings = { roll: 'aircraft', horizonStyle: 'balanced' }
const every = [BALANCED, DYNAMIC, AIRCRAFT]

/** Level flight along +X; the nose is banked about itself, then pitched up by `incidenceDeg`. */
function seeded(incidenceDeg: number, bankDeg = 0, speed = 150) {
  const state = createAircraft('f22')
  state.position = { x: 0, y: 3000, z: 0 }
  state.velocity = { x: speed, y: 0, z: 0 }
  pose(state, incidenceDeg, bankDeg)
  return state
}
function pose(state: AircraftState, incidenceDeg: number, bankDeg: number) {
  const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), bankDeg * Math.PI / 180)
    .premultiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), incidenceDeg * Math.PI / 180))
  state.orientation = { x: q.x, y: q.y, z: q.z, w: q.w }
}
const newCamera = () => new PerspectiveCamera(69, 16 / 9, 0.5, 14000)
const bodyUp = (state: AircraftState) => new Vector3(0, 1, 0).applyQuaternion(new Quaternion().copy(state.orientation))
const nose = (state: AircraftState) => new Vector3(1, 0, 0).applyQuaternion(new Quaternion().copy(state.orientation))
const viewOf = (camera: PerspectiveCamera) => new Vector3(0, 0, -1).applyQuaternion(camera.quaternion)
/** Camera roll away from the level horizon, radians. */
const tiltOf = (camera: PerspectiveCamera) => {
  const up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion), look = viewOf(camera)
  return up.angleTo(new Vector3(0, 1, 0).addScaledVector(look, -look.y).normalize())
}

describe('camera settings', () => {
  it('defaults to Horizon locked + Balanced and repairs bad values field by field', () => {
    expect(defaultCameraSettings).toEqual(BALANCED)
    expect(parseCameraSettings(undefined)).toEqual(BALANCED)
    expect(parseCameraSettings({ roll: 'spin', horizonStyle: 'wobble' })).toEqual(BALANCED)
    expect(parseCameraSettings({ roll: 'aircraft', horizonStyle: 'dynamic' })).toEqual({ roll: 'aircraft', horizonStyle: 'dynamic' })
    // Saves from the three-style version map onto the new pair.
    expect(parseCameraSettings({ roll: 'dynamic', horizonLock: false })).toEqual(DYNAMIC)
    expect(parseCameraSettings({ roll: 'roll' })).toEqual(AIRCRAFT)
    // A save from before camera settings existed reads as the default.
    expect(parseSettings(JSON.stringify({ version: 1, aircraftId: 'f22' })).camera).toEqual(BALANCED)
  })
  it('V cycles Balanced → Dynamic → Aircraft locked → Balanced', () => {
    expect(nextCameraSettings(BALANCED)).toEqual(DYNAMIC)
    expect(nextCameraSettings(DYNAMIC).roll).toBe('aircraft')
    expect(nextCameraSettings(AIRCRAFT)).toEqual(BALANCED)
  })
})

describe('camera styles', () => {
  it('leave the PSM shot untouched: at full handover every camera is the same', () => {
    for (const [incidence, bank] of [[60, 0], [60, 90], [90, 45], [120, 180]]) {
      const settle = (view: CameraSettings) => {
        const state = seeded(incidence, bank), camera = newCamera(), rig = new FlightCamera()
        for (let frame = 0; frame < 300; frame++) rig.update(camera, state, view, 1 / 60)
        return camera
      }
      const reference = settle(DYNAMIC)
      for (const view of every) {
        const camera = settle(view)
        expect(camera.position.distanceTo(reference.position)).toBeLessThan(0.05)
        expect(camera.quaternion.angleTo(reference.quaternion)).toBeLessThan(0.005)
        expect(camera.fov).toBeCloseTo(reference.fov, 3)
      }
    }
  })

  it('match through live PSM tracks once handed over, tail slide included', () => {
    for (const name of ['tailSlide', 'kulbit', 'cobra', 'reversal180'] as const) {
      const trace = runScenario(name, 'f22')
      const reference = newCamera(), referenceRig = new FlightCamera()
      const cameras = every.map(view => ({ view, camera: newCamera(), rig: new FlightCamera() }))
      let worstAngle = 0, worstDistance = 0, heldFor = 0, compared = 0
      for (let i = 0; i < trace.samples.length; i += 2) {
        const state = trace.samples[i].state
        // Seconds spent past the top of the handoff band; compare once the boom and lens have settled (1 s).
        heldFor = psmShareOf(state) >= 1 ? heldFor + 2 * FLIGHT_STEP : 0
        referenceRig.update(reference, state, DYNAMIC, 2 * FLIGHT_STEP)
        for (const entry of cameras) {
          entry.rig.update(entry.camera, state, entry.view, 2 * FLIGHT_STEP)
          if (heldFor < 1) continue
          compared++
          worstAngle = Math.max(worstAngle, entry.camera.quaternion.angleTo(reference.quaternion))
          worstDistance = Math.max(worstDistance, entry.camera.position.distanceTo(reference.position))
        }
      }
      expect(compared, name).toBeGreaterThan(0)
      expect(worstAngle, name).toBeLessThan(0.01)
      expect(worstDistance, name).toBeLessThan(0.1)
    }
  })

  it('Dynamic keeps the horizon level and the top of the airframe in view through a 360° roll at 240°/s', () => {
    const state = seeded(0), camera = newCamera(), rig = new FlightCamera()
    for (let frame = 0; frame < 60; frame++) rig.update(camera, state, DYNAMIC, 1 / 60)
    let worstTop = 1, worstTilt = 0
    for (let frame = 0; frame <= 90; frame++) {
      pose(state, 0, frame * 4)
      rig.update(camera, state, DYNAMIC, 1 / 60)
      const offset = camera.position.clone().sub(new Vector3().copy(state.position))
      // Which side of the wings the camera is on, 1 = straight above the canopy.
      const n = new Vector3(1, 0, 0), across = offset.clone().addScaledVector(n, -offset.dot(n)).normalize()
      worstTop = Math.min(worstTop, across.dot(bodyUp(state)))
      worstTilt = Math.max(worstTilt, tiltOf(camera))
    }
    // cos 60°: the camera never falls more than 60° off the canopy side, so the top stays in view.
    expect(worstTop).toBeGreaterThan(0.5)
    expect(worstTilt).toBeLessThan(0.03)
  })

  it('Dynamic points the nose at the centre of the screen and swings the jet around it', () => {
    const state = seeded(0, 90), camera = newCamera(), rig = new FlightCamera()
    for (let frame = 0; frame < 300; frame++) rig.update(camera, state, DYNAMIC, 1 / 60)
    camera.updateMatrixWorld()
    const far = new Vector3().copy(state.position).addScaledVector(new Vector3(1, 0, 0), 400).project(camera)
    expect(Math.hypot(far.x, far.y)).toBeLessThan(0.02)
    // At knife edge the camera sits out on the canopy side, so the jet appears beside the centre
    // rather than below it.
    const jet = new Vector3().copy(state.position).project(camera)
    expect(Math.abs(jet.x)).toBeGreaterThan(Math.abs(jet.y))
  })

  it('Balanced tilts 15° at knife edge and never snaps through a full roll', () => {
    const knife = seeded(0, 90), camera = newCamera(), rig = new FlightCamera()
    for (let frame = 0; frame < 300; frame++) rig.update(camera, knife, BALANCED, 1 / 60)
    expect(Math.abs(tiltOf(camera) - BALANCED_TILT)).toBeLessThan(0.03)
    const state = seeded(0), rolling = newCamera(), rollRig = new FlightCamera()
    let last: Quaternion | null = null
    for (let frame = 0; frame <= 180; frame++) {
      pose(state, 0, frame * 2)
      rollRig.update(rolling, state, BALANCED, 1 / 60)
      if (last) expect(last.angleTo(rolling.quaternion)).toBeLessThan(0.05)
      last = rolling.quaternion.clone()
    }
  })

  it('hands over to the level PSM shot smoothly while inverted, in every camera', () => {
    for (const view of every) {
      const state = seeded(0, 180), camera = newCamera(), rig = new FlightCamera()
      for (let frame = 0; frame < 60; frame++) rig.update(camera, state, view, 1 / 60)
      let last: Quaternion | null = null
      // An inverted pull: incidence rises through the whole handoff band and back down.
      for (let frame = 0; frame <= 360; frame++) {
        pose(state, 40 * Math.sin(Math.PI * frame / 360), 180)
        rig.update(camera, state, view, 1 / 60)
        expect(camera.quaternion.toArray().every(Number.isFinite)).toBe(true)
        if (last) expect(last.angleTo(camera.quaternion)).toBeLessThan(0.1)
        last = camera.quaternion.clone()
      }
    }
  })
})

describe('Aircraft locked through a jet drift', () => {
  const knifeSpawn = () => {
    const state = driftSpawn('f22', 500), q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2)
    state.orientation = { x: q.x, y: q.y, z: q.z, w: q.w }
    return state
  }
  const drifts = () => [
    ['yaw drift', runTrack(driftSpawn('f22', 450), 3, () => ({ yaw: 1, airbrake: true }))],
    ['banked drift', runTrack(knifeSpawn(), 3, () => ({ pitch: 1, airbrake: true }))],
  ] as const

  it('follows the nose and the airframe roll, while Horizon locked hands over to the path shot', () => {
    for (const [name, trace] of drifts()) {
      const run = (view: CameraSettings) => {
        const camera = newCamera(), rig = new FlightCamera(), off: number[] = [], roll: number[] = []
        for (let i = 0; i < trace.samples.length; i += 2) {
          const state = trace.samples[i].state
          rig.update(camera, state, view, 2 * FLIGHT_STEP)
          // Well inside the drift, and far enough into the PSM band that Horizon locked has handed over.
          if (driftShareOf(state) < 0.9 || psmShareOf(state) < 0.5) continue
          off.push(viewOf(camera).angleTo(nose(state)))
          const up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion), look = viewOf(camera)
          const body = bodyUp(state).addScaledVector(look, -bodyUp(state).dot(look)).normalize()
          roll.push(up.angleTo(body))
        }
        const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length
        return { frames: off.length, off: mean(off), roll: mean(roll) }
      }
      const aircraft = run(AIRCRAFT), horizon = run(BALANCED)
      expect(aircraft.frames, name).toBeGreaterThan(20)
      // On the nose (within the lag), and well nearer it than the path-following PSM shot.
      expect(aircraft.off, name).toBeLessThan(0.35)
      expect(aircraft.off, name).toBeLessThan(horizon.off * 0.6)
      // Rolled with the airframe (within the aim lift and lag).
      expect(aircraft.roll, name).toBeLessThan(0.3)
    }
  })

  it('adds the full drift lag by ~15° incidence, and none in ordinary hard turns or other cameras', () => {
    const knife = runTrack(knifeSpawn(), 3, () => ({ pitch: 1, speedAdjust: -1 }))
    for (const [name, trace] of [...drifts(), ['banked S-pull drift', knife] as const]) {
      const rig = new FlightCamera(), horizonRig = new FlightCamera(), camera = newCamera(), lags: number[] = []
      for (let i = 0; i < trace.samples.length; i += 2) {
        const state = trace.samples[i].state
        rig.update(camera, state, AIRCRAFT, 2 * FLIGHT_STEP)
        horizonRig.update(newCamera(), state, BALANCED, 2 * FLIGHT_STEP)
        expect(horizonRig.driftLag).toBe(0)
        const airflowIncidence = new Vector3().copy(state.velocity).angleTo(nose(state)) * 180 / Math.PI
        if (driftShareOf(state) > 0.95 && airflowIncidence > 16) lags.push(rig.driftLag)
      }
      expect(lags.length, name).toBeGreaterThan(20)
      // Mean, not minimum: the smoothed weights take a moment to catch a fast entry.
      expect(lags.reduce((sum, lag) => sum + lag, 0) / lags.length, name).toBeGreaterThan(0.85)
    }
    for (const name of ['hardTurn900', 'fullStick500'] as const) {
      const trace = runScenario(name, 'f22'), rig = new FlightCamera(), camera = newCamera()
      for (const sample of trace.samples) { rig.update(camera, sample.state, AIRCRAFT, FLIGHT_STEP); expect(rig.driftLag, name).toBe(0) }
    }
  })

  it('reads zero drift in vertical-plane moves, so they keep the PSM shot', () => {
    for (const name of ['cobra', 'kulbit', 'tailSlide', 'reversal180', 'psmIntent450'] as const) {
      const trace = runScenario(name, 'f22')
      expect(Math.max(...trace.samples.map(sample => driftShareOf(sample.state))), name).toBe(0)
    }
  })
})

describe('stick frame per camera', () => {
  it('matches what each camera leaves on screen, and blends to level with the PSM share', () => {
    const banked = seeded(0, 90), half = Math.PI / 2
    expect(screenFrame(banked, AIRCRAFT)).toEqual({ angle: 0, blend: 1 })
    expect(Math.abs(screenFrame(banked, DYNAMIC).angle)).toBeCloseTo(half, 3)
    expect(Math.abs(screenFrame(banked, BALANCED).angle)).toBeCloseTo(half - BALANCED_TILT, 3)
    // At full PSM share (nose 60° up, no drift) every camera reads like the level horizon.
    const drifting = seeded(60, 90)
    for (const view of every) {
      const frame = screenFrame(drifting, view), level = screenFrame(drifting, DYNAMIC)
      expect(frame.angle).toBeCloseTo(level.angle, 5)
      expect(frame.blend).toBeCloseTo(level.blend, 5)
    }
  })
})
