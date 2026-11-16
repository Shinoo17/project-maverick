import { describe, expect, it } from 'vitest'
import { PerspectiveCamera, Quaternion, Vector3 } from 'three'
import { coreAircraft } from '../benchmarks/flight/coreFeel'
import { neutralCommand, type PilotCommand } from '../src/game/runtime/commands'
import { FLIGHT_STEP } from '../src/game/runtime/clock'
import { stepCoreFlight } from '../src/game/flightCore/step'
import { readFlight } from '../src/game/flight/readout'
import { ChaseCamera, horizontalFov, verticalFov } from '../src/render/ChaseCamera'
import { CameraTrace } from '../src/render/cameraTrace'
import { Spring, springStep } from '../src/game/camera/spring'
import { CHASE_DRIFT, driftWeight, pathOffsetDeg } from '../src/game/camera/chaseBlend'
import { projectVelocityMarker } from '../src/features/flight/hudPainter'
import type { CameraSettings } from '../src/game/camera/cameraSettings'
import type { AircraftState } from '../src/game/state/WorldState'

/*
FR2: the rewrite's chase camera (src/render/ChaseCamera.ts).
Acceptance FC-13 (drift 30–60° heading offset: the side shows, the nose stays aimable, no flip
near 180°) and the camera part of FC-15 (no NaN, no flip near zero airspeed), plus the hard rules
of §5: the camera only reads, and its blend comes from the airframe, not from Space.
*/
const DEG = Math.PI / 180
const BALANCED: CameraSettings = { mode: 'horizon', roll: 'horizon', horizonStyle: 'balanced' }
const DYNAMIC: CameraSettings = { mode: 'horizon', roll: 'horizon', horizonStyle: 'dynamic' }
const AIRCRAFT: CameraSettings = { mode: 'aircraft', roll: 'aircraft', horizonStyle: 'balanced' }
const styles = [['balanced', BALANCED], ['dynamic', DYNAMIC], ['aircraft', AIRCRAFT]] as const
const WIDTH = 1600, HEIGHT = 900

interface Shot { look: Vector3; up: Vector3; position: Vector3; quaternion: Quaternion; fov: number; camera: PerspectiveCamera }
const lensOf = () => new PerspectiveCamera(56, WIDTH / HEIGHT, 0.5, 14000)
function shoot(rig: ChaseCamera, camera: PerspectiveCamera, state: AircraftState, view: CameraSettings, dt: number, reduced = false): Shot {
  rig.update(camera, state, view, dt, reduced)
  camera.updateMatrixWorld()
  return { look: new Vector3(0, 0, -1).applyQuaternion(camera.quaternion), up: new Vector3(0, 1, 0).applyQuaternion(camera.quaternion), position: camera.position.clone(), quaternion: camera.quaternion.clone(), fov: camera.fov, camera }
}
const noseOf = (s: AircraftState) => new Vector3(1, 0, 0).applyQuaternion(new Quaternion().copy(s.orientation))
const finiteShot = (shot: Shot) => [...shot.look.toArray(), ...shot.up.toArray(), ...shot.position.toArray(), shot.fov].every(Number.isFinite)
/** Tilt of the camera's up away from the level horizon about its own view (radians). */
const tiltOf = (shot: Shot) => shot.up.angleTo(new Vector3(0, 1, 0).addScaledVector(shot.look, -shot.look.y).normalize())

/** Flies `seconds` on the new core, rendering at `fps` from the pose interpolated between steps, as FlightScene does. */
function film(state: AircraftState, seconds: number, script: (t: number) => Partial<PilotCommand>, view: CameraSettings, fps = 60, each?: (shot: Shot, state: AircraftState, t: number) => void) {
  const rig = new ChaseCamera(), camera = lensOf(), trace = new CameraTrace()
  rig.trace = trace
  const steps = Math.round(seconds / FLIGHT_STEP)
  const history: AircraftState[] = [structuredClone(state)]
  for (let i = 0; i < steps; i++) { stepCoreFlight(state, { ...neutralCommand(i, state.id), ...script(i * FLIGHT_STEP) }, FLIGHT_STEP); history.push(structuredClone(state)) }
  const shots: Shot[] = []
  const frames = Math.floor(seconds * fps)
  for (let f = 0; f <= frames; f++) {
    const t = f / fps, i = Math.min(steps - 1, Math.floor(t / FLIGHT_STEP)), alpha = Math.min(1, t / FLIGHT_STEP - i)
    const a = history[i], b = history[i + 1]
    const pose: AircraftState = { ...b,
      position: new Vector3().copy(a.position).lerp(b.position as Vector3, alpha),
      orientation: new Quaternion().copy(a.orientation).slerp(new Quaternion().copy(b.orientation), alpha),
      velocity: new Vector3().copy(a.velocity).lerp(b.velocity as Vector3, alpha) }
    const shot = shoot(rig, camera, pose, view, f === 0 ? 0 : 1 / fps)
    shots.push({ ...shot, camera })
    each?.(shot, pose, t)
  }
  return { shots, trace, rig }
}
/** Largest frame-to-frame change of the look, the up and the whole view (degrees). */
function jumps(shots: Shot[]) {
  let look = 0, up = 0, view = 0
  for (let i = 1; i < shots.length; i++) {
    look = Math.max(look, shots[i].look.angleTo(shots[i - 1].look) / DEG)
    up = Math.max(up, shots[i].up.angleTo(shots[i - 1].up) / DEG)
    view = Math.max(view, shots[i].quaternion.angleTo(shots[i - 1].quaternion) / DEG)
  }
  return { look, up, view }
}
/** A level aircraft at `speed` flying +X, its nose yawed `headingDeg` off the path. */
function drifting(headingDeg: number, speed = 140) {
  const state = coreAircraft('f22', speed)
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), headingDeg * DEG)
  state.orientation = { x: q.x, y: q.y, z: q.z, w: q.w }
  state.velocity = { x: speed, y: 0, z: 0 }
  return state
}
// Scaled up as the HUD scales the nose: the marker drops anything shorter than 1.
const onScreen = (shot: Shot, state: AircraftState, direction: Vector3) =>
  projectVelocityMarker(shot.camera, state.position, direction.clone().setLength(2), WIDTH, HEIGHT, 24)?.onScreen === true
/** A full inside loop from level at 150 m/s on burner: pull until the nose comes back up to level, then let go. */
function looping(seconds = 15): [AircraftState, number, (t: number) => Partial<PilotCommand>] {
  const state = coreAircraft('f22', 150)
  let done = false
  return [state, seconds, t => {
    const nose = noseOf(state)
    if (t > 6 && nose.y > -0.02 && nose.x > 0) done = true
    return { pitch: done ? 0 : 1, speedAdjust: 1, afterburner: true }
  }]
}

describe('springs (game/camera/spring.ts)', () => {
  it('is exact for any split of the frame, never overshoots from rest, and holds still at dt 0', () => {
    const one = springStep(1, 0, 12, 0.1)
    let half = springStep(1, 0, 12, 0.05); half = springStep(half.offset, half.rate, 12, 0.05)
    expect(half.offset).toBeCloseTo(one.offset, 12); expect(half.rate).toBeCloseTo(one.rate, 12)
    let s = { offset: 1, rate: 0 }
    for (let i = 0; i < 400; i++) { s = springStep(s.offset, s.rate, 12, 1 / 144); expect(s.offset).toBeGreaterThanOrEqual(0) }
    expect(springStep(0.3, 2, 12, 0)).toEqual({ offset: 0.3, rate: 2 })
    // A long frame cannot blow it up.
    expect(Math.abs(springStep(1, 50, 30, 10).offset)).toBeLessThan(1e-6)
  })
  it('trails a ramp by its lag', () => {
    const spring = new Spring(0)
    for (let i = 0; i < 600; i++) spring.step((i + 1) / 120, 0.12, 1 / 120)
    // Less half a frame: the target is sampled at the end of each frame and held through it.
    expect(600 / 120 - spring.value).toBeCloseTo(0.12 - 0.5 / 120, 4)
  })
})

describe('chase blend (game/camera/chaseBlend.ts)', () => {
  it('counts sideslip and alpha past the limit only, and fades out toward reverse flow', () => {
    const at = (alphaDeg: number, betaDeg: number, incidenceDeg = Math.hypot(alphaDeg, betaDeg), confidence = 1) =>
      driftWeight({ ...readFlight(coreAircraft('f22', 130)), alphaDeg, betaDeg, incidenceDeg, angleConfidence: confidence })
    expect(at(24, 0)).toBe(0)
    expect(at(10, 2)).toBe(0)
    expect(at(0, 30)).toBe(1)
    expect(at(24 + CHASE_DRIFT.fullDeg, 0)).toBe(1)
    expect(at(0, 30, 30, 0)).toBe(0)
    expect(at(0, 10, 175)).toBe(0)
    expect(at(0, 45, 135)).toBeGreaterThan(0); expect(at(0, 45, 135)).toBeLessThan(1)
  })
  it('saturates the path look smoothly at the clamp', () => {
    expect(pathOffsetDeg(10, 0.45, 25)).toBeCloseTo(4.5, 0)
    expect(pathOffsetDeg(180, 0.45, 25)).toBeLessThan(25)
    expect(pathOffsetDeg(60, 0.45, 25)).toBeGreaterThan(pathOffsetDeg(45, 0.45, 25))
    expect(pathOffsetDeg(40, 0, 25)).toBe(0)
  })
})

describe('ChaseCamera', () => {
  it.each(styles)('keeps a full pull at corner speed a plain chase: no drift share (%s)', (_name, view) => {
    let worst = 0, offset = 0
    const { shots, trace } = film(coreAircraft('f22', 100, 90), 3, () => ({ pitch: 1 }), view, 60, (_shot, state) => { worst = Math.max(worst, driftWeight(readFlight(state))) })
    for (const frame of trace.frames) if (frame.rig === 'chase') offset = Math.max(offset, frame.blend.pathOffsetDeg)
    expect(worst).toBeLessThan(0.05)
    expect(offset).toBeLessThan(0.5)
    expect(shots.every(finiteShot)).toBe(true)
  })

  it.each(styles)('FC-13: holds a 30–60° drift with the side in view and the nose aimable (%s)', (name, view) => {
    for (const heading of [30, 45, 60]) {
      const rig = new ChaseCamera(), camera = lensOf(), state = drifting(heading)
      let shot = shoot(rig, camera, state, view, 0)
      for (let i = 0; i < 120; i++) shot = shoot(rig, camera, state, view, 1 / 60)
      const nose = noseOf(state), chaseLook = new Vector3(0, 0, -1).applyQuaternion(rig.chase)
      const offNose = chaseLook.angleTo(nose) / DEG
      // The clamp: Horizon locked leaves the nose by at most ~25° (plus the lens's small down tilt),
      // Aircraft locked by ~12°.
      expect(offNose).toBeLessThan(name === 'aircraft' ? 17 : 30)
      // The side shows: the view has turned off the nose toward the path.
      expect(offNose).toBeGreaterThan(name === 'aircraft' ? 6 : 12)
      expect(onScreen(shot, state, nose)).toBe(true)
      // Horizon locked keeps the flight path marker in the frame too.
      if (name !== 'aircraft') expect(onScreen(shot, state, new Vector3(1, 0, 0))).toBe(true)
      expect(tiltOf(shot)).toBeLessThan(name === 'aircraft' ? 1 : 16 * DEG)
    }
  })

  it.each(styles)('FC-13: sweeps the nose round through 180° and back with no flip (%s)', (_name, view) => {
    const rig = new ChaseCamera(), camera = lensOf()
    const shots: Shot[] = []
    let nearTail = 0
    // 0 → 360° over 12 s at 60 FPS, then 360 → 0.
    for (let f = 0; f <= 1440; f++) {
      const heading = f <= 720 ? f / 2 : 360 - (f - 720) / 2
      const state = drifting(heading)
      const shot = shoot(rig, camera, state, view, f === 0 ? 0 : 1 / 60)
      shots.push(shot)
      const off = ((heading % 360) + 360) % 360
      if (off > 172 && off < 188) nearTail = Math.max(nearTail, new Vector3(0, 0, -1).applyQuaternion(rig.chase).angleTo(noseOf(state)) / DEG)
    }
    expect(shots.every(finiteShot)).toBe(true)
    const j = jumps(shots)
    // A nose swinging at 30°/s moves the view half a degree a frame; a flip would be tens.
    expect(j.look).toBeLessThan(1.5); expect(j.up).toBeLessThan(1.5); expect(j.view).toBeLessThan(1.5)
    // Near reverse flow the camera sits on the nose (behind the jet), with no path look to flip.
    expect(nearTail).toBeLessThan(10)
  })

  it.each(styles)('FC-15: a tail slide through zero airspeed stays finite with no flip (%s)', (_name, view) => {
    for (const pull of [0, 1]) {
      const state = coreAircraft('f22', 70)
      // Straight up, so with the stick free it climbs to a stop and slides back tail first.
      const up = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 90 * DEG)
      state.orientation = { x: up.x, y: up.y, z: up.z, w: up.w }
      state.velocity = { x: 0, y: 70, z: 0 }
      let slowest = Infinity
      // Throttle cut: the speed hold would otherwise climb on dry thrust.
      const { shots } = film(state, 12, () => ({ pitch: pull, speedAdjust: -1 }), view, 60, (_shot, s) => { slowest = Math.min(slowest, readFlight(s).airspeed) })
      if (!pull) expect(slowest).toBeLessThan(3)
      expect(shots.every(finiteShot)).toBe(true)
      const j = jumps(shots)
      expect(j.view).toBeLessThan(5); expect(j.up).toBeLessThan(5)
    }
  })

  it.each(styles)('FC-15: frames an aircraft at exact rest, and one flying tail first (%s)', (_name, view) => {
    const still = coreAircraft('f22', 0); still.velocity = { x: 0, y: 0, z: 0 }
    const backward = drifting(180, 20)
    for (const state of [still, backward]) {
      const rig = new ChaseCamera(), camera = lensOf()
      for (let i = 0; i < 30; i++) expect(finiteShot(shoot(rig, camera, state, view, i ? 1 / 60 : 0))).toBe(true)
      expect(new Vector3(0, 0, -1).applyQuaternion(rig.chase).angleTo(noseOf(state)) / DEG).toBeLessThan(10)
    }
  })

  it.each(styles)('loops over the top and dives straight down with a continuous roll (%s)', (name, view) => {
    // A full loop, then wings level again.
    const loop = film(...looping(), view)
    expect(loop.shots.every(finiteShot)).toBe(true)
    const j = jumps(loop.shots)
    expect(j.view).toBeLessThan(5); expect(j.up).toBeLessThan(name === 'aircraft' ? 5 : 3.5)
    // A roll in a vertical dive: inside the cone the level horizon holds.
    const dive = coreAircraft('f22', 150)
    const down = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -88 * DEG)
    dive.orientation = { x: down.x, y: down.y, z: down.z, w: down.w }
    dive.velocity = { x: 150 * Math.cos(88 * DEG), y: -150 * Math.sin(88 * DEG), z: 0 }
    dive.position = { x: 0, y: 6000, z: 0 }
    const rolled = film(dive, 3, t => ({ roll: t < 1.5 ? 1 : 0 }), view)
    expect(rolled.shots.every(finiteShot)).toBe(true)
    expect(jumps(rolled.shots).view).toBeLessThan(5)
  })

  it.each(styles)('levels the horizon after a loop, and Aircraft locked rolls with the jet (%s)', (name, view) => {
    const [state, , loop] = looping(19)
    const { shots } = film(state, 19, t => ({ ...loop(t), roll: t >= 16 && t < 16.5 ? 1 : 0 }), view)
    const last = shots.at(-1)!
    expect(Math.abs(noseOf(state).y)).toBeLessThan(0.2)
    // 2.5 s after a half-second roll (90°): Horizon locked is level (Balanced tilts by its sine law), Aircraft locked banked.
    if (name === 'dynamic') expect(tiltOf(last) / DEG).toBeLessThan(1.5)
    if (name === 'balanced') expect(tiltOf(last) / DEG).toBeLessThan(16)
    if (name === 'aircraft') expect(tiltOf(last) / DEG).toBeGreaterThan(60)
  })

  it.each(styles)('renders the same camera at 30, 60 and 144 FPS (%s)', (_name, view) => {
    const script = (t: number) => ({ roll: t < 0.5 ? 1 : 0, pitch: t >= 0.5 && t < 2.5 ? 1 : 0, yaw: t >= 2.5 && t < 3.5 ? 1 : 0 })
    const at = (fps: number) => {
      const marks: Shot[] = []
      film(coreAircraft('su57', 130), 4, script, view, fps, (shot, _s, t) => { if (Math.abs(t * 2 - Math.round(t * 2)) < 1e-9) marks.push({ ...shot, look: shot.look.clone(), up: shot.up.clone() }) })
      return marks
    }
    const a = at(30), b = at(60), c = at(144)
    expect(a.length).toBe(b.length); expect(c.length).toBe(b.length)
    for (let i = 0; i < b.length; i++) for (const other of [a[i], c[i]]) {
      expect(other.look.angleTo(b[i].look) / DEG).toBeLessThan(1)
      expect(other.up.angleTo(b[i].up) / DEG).toBeLessThan(1.5)
    }
  })

  it('only reads: the state, its readout and the aim are unchanged, and Space alone moves nothing', () => {
    const state = drifting(40), aim = new Vector3(3, 1, 0.5)
    const before = structuredClone(state), aimBefore = aim.clone()
    const rig = new ChaseCamera(), camera = lensOf()
    rig.aim = aim
    for (let i = 0; i < 60; i++) shoot(rig, camera, state, BALANCED, i ? 1 / 60 : 0)
    expect(state).toEqual(before)
    expect(aim.equals(aimBefore)).toBe(true)
    // Level flight, Space held or not: the airframe does not move, so neither does the camera.
    const views = [false, true].map(psm => {
      const { shots } = film(coreAircraft('f22', 130), 2, () => ({ psm }), BALANCED)
      return shots.at(-1)!
    })
    expect(views[0].look.angleTo(views[1].look) / DEG).toBeLessThan(0.05)
    expect(views[0].up.angleTo(views[1].up) / DEG).toBeLessThan(0.05)
  })

  it.each(styles)('shows the nose marker and the flight path marker in ordinary flight (%s)', (_name, view) => {
    film(coreAircraft('f22', 140), 4, t => ({ roll: t < 0.4 ? 1 : 0, pitch: t >= 0.4 ? 0.6 : 0 }), view, 60, (shot, state) => {
      expect(onScreen(shot, state, noseOf(state))).toBe(true)
      expect(onScreen(shot, state, new Vector3().copy(state.velocity))).toBe(true)
    })
  })

  it('keeps the horizontal FOV of the base at any aspect, widens by horizontal degrees, and caps it', () => {
    // The plan's "≈ 88°" is 86.8° exactly; spec §9.2's 88° would be a base of 57.0°.
    expect(horizontalFov(56, 16 / 9)).toBeCloseTo(86.8, 1)
    expect(verticalFov(88, 16 / 9)).toBeCloseTo(57.0, 1)
    expect(verticalFov(horizontalFov(56, 4 / 3), 4 / 3)).toBeCloseTo(56, 9)
    const fovAt = (state: AircraftState, aspect: number, reduced = false) => {
      const rig = new ChaseCamera(), camera = new PerspectiveCamera(56, aspect, 0.5, 14000)
      for (let i = 0; i < 240; i++) rig.update(camera, state, BALANCED, i ? 1 / 60 : 0, reduced)
      return camera.fov
    }
    const level = coreAircraft('f22', 0), slipping = drifting(60, 0.001)
    level.velocity = { x: 0, y: 0, z: 0 }
    expect(fovAt(level, 16 / 9)).toBeCloseTo(56, 6)
    // Full drift at a crawl: +6° horizontal.
    const drift = drifting(60, 20)
    expect(driftWeight(readFlight(drift))).toBe(1)
    expect(horizontalFov(fovAt(drift, 16 / 9), 16 / 9) - horizontalFov(56, 16 / 9)).toBeCloseTo(6 + 4 * 20 / 200, 1)
    // 21:9 starts at 102° and stops at the 104° cap; 32:9 starts above it and does not widen.
    expect(horizontalFov(fovAt(drift, 21 / 9), 21 / 9)).toBeCloseTo(104, 1)
    expect(fovAt(drift, 32 / 9)).toBeCloseTo(56, 6)
    expect(fovAt(drift, 16 / 9, true)).toBe(61)
    expect(fovAt(slipping, 16 / 9)).toBeCloseTo(56, 3)
  })

  it('records chase frames without changing the shot', () => {
    const run = (trace: CameraTrace | null) => {
      const rig = new ChaseCamera(), camera = lensOf()
      rig.trace = trace
      return Array.from({ length: 90 }, (_, i) => { rig.update(camera, drifting(i / 2), DYNAMIC, i ? 1 / 60 : 0); return [camera.position.toArray(), camera.quaternion.toArray(), camera.fov] })
    }
    const trace = new CameraTrace()
    expect(run(trace)).toEqual(run(null))
    expect(trace.frames).toHaveLength(90)
    for (const frame of trace.frames) {
      expect(frame.rig).toBe('chase')
      if (frame.rig !== 'chase') continue
      for (const key of ['drift', 'levelShare', 'aimShare', 'gunZoom'] as const) { expect(frame.blend[key]).toBeGreaterThanOrEqual(0); expect(frame.blend[key]).toBeLessThanOrEqual(1) }
    }
    expect(JSON.parse(JSON.stringify(trace)).version).toBe(3)
  })

  it('rolls back to level the short way after Aircraft locked, however many rolls came before', () => {
    const settle = (rolls: number) => {
      const rig = new ChaseCamera(), camera = lensOf(), state = coreAircraft('f22', 140)
      // Balanced first, so the horizon has a history to go stale.
      let shot = shoot(rig, camera, state, BALANCED, 0)
      for (let f = 0; f < 30; f++) shot = shoot(rig, camera, state, BALANCED, 1 / 60)
      // Aircraft locked through `rolls` full rolls and 216° more, past inverted: the short way back
      // to level is 144°, the long way 216° (inside the unwind limit, so only a fresh read avoids it).
      for (let f = 1; f <= Math.round((rolls + 0.6) * 120); f++) {
        const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), f / 120 * 2 * Math.PI)
        state.orientation = { x: q.x, y: q.y, z: q.z, w: q.w }
        shot = shoot(rig, camera, state, AIRCRAFT, 1 / 60)
      }
      for (let f = 0; f < 60; f++) shot = shoot(rig, camera, state, AIRCRAFT, 1 / 60)
      // Then Balanced: count every degree the camera rolls about its view on the way to level.
      let rolled = 0
      for (let f = 0; f < 180; f++) {
        const before = shot
        shot = shoot(rig, camera, state, BALANCED, 1 / 60)
        const carried = before.up.clone().addScaledVector(shot.look, -before.up.dot(shot.look)).normalize()
        rolled += Math.atan2(new Vector3().crossVectors(carried, shot.up).dot(shot.look), carried.dot(shot.up))
      }
      return { rolled: Math.abs(rolled) / DEG, tilt: tiltOf(shot) / DEG }
    }
    const none = settle(0), three = settle(3)
    expect(none.rolled).toBeLessThan(185); expect(three.rolled).toBeLessThan(185)
    expect(three.rolled).toBeCloseTo(none.rolled, 3)
    expect(none.rolled).toBeLessThan(160)
    // Balanced's tilt for that bank, 15°·|sin 216°|.
    expect(none.tilt).toBeCloseTo(15 * Math.abs(Math.sin(216 * DEG)), 0); expect(three.tilt).toBeCloseTo(none.tilt, 3)
  })

  it('switches style mid-flight without a jump', () => {
    const rig = new ChaseCamera(), camera = lensOf(), shots: Shot[] = []
    const state = coreAircraft('f22', 140, 60)
    // The V order: Balanced → Dynamic → Aircraft locked → Balanced.
    for (let f = 0; f < 480; f++) shots.push(shoot(rig, camera, state, f < 120 ? BALANCED : f < 240 ? DYNAMIC : f < 360 ? AIRCRAFT : BALANCED, f ? 1 / 60 : 0))
    // Balanced → Dynamic swings the boom to the canopy; → Aircraft locked rolls 60° onto the bank,
    // no faster than its roll ceiling (540°/s, 9° a frame at 60 FPS). Each is a move, not a cut.
    const before = jumps(shots.slice(0, 240)), all = jumps(shots)
    expect(before.view).toBeLessThan(3.5)
    expect(all.view).toBeLessThan(9.6)
    expect(tiltOf(shots[359]) / DEG).toBeCloseTo(60, 0)
    // Back to Balanced: its tilt for a 60° bank, 15°·sin 60°.
    expect(tiltOf(shots.at(-1)!) / DEG).toBeCloseTo(15 * Math.sin(60 * DEG), 0)
  })
})
