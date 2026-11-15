import { it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { PerspectiveCamera, Quaternion, Vector3 } from 'three'
import { coreAircraft } from './coreFeel'
import { neutralCommand, type PilotCommand } from '../../src/game/runtime/commands'
import { FLIGHT_STEP } from '../../src/game/runtime/clock'
import { stepCoreFlight } from '../../src/game/flightCore/step'
import { readFlight } from '../../src/game/flight/readout'
import { FlightCamera } from '../../src/render/FlightCamera'
import { ChaseCamera } from '../../src/render/ChaseCamera'
import { CameraTrace } from '../../src/render/cameraTrace'
import type { CameraRig } from '../../src/render/cameraRig'
import { projectVelocityMarker } from '../../src/features/flight/hudPainter'
import type { CameraSettings } from '../../src/game/camera/cameraSettings'
import type { AircraftState } from '../../src/game/state/WorldState'

/*
FR2 camera comparison. The same new-core flight is filmed by the
legacy FlightCamera and the rewrite's ChaseCamera, in every style, at 60 FPS and 16:9, and each
rig's CAMERA_TRACE is read back for motion numbers. Report only: nothing here is a target.
Writes benchmarks/flight/out/camera-compare-fr2.{json,md} and the traces under
benchmarks/flight/out/camera-traces-fr2/ (all gitignored).

Mouse aim is not flown (FR3): every flight here is a scripted stick.
*/
const DEG = Math.PI / 180
const FPS = 60, WIDTH = 1600, HEIGHT = 900
const views: Record<string, CameraSettings> = {
  balanced: { mode: 'horizon', roll: 'horizon', horizonStyle: 'balanced' },
  dynamic: { mode: 'horizon', roll: 'horizon', horizonStyle: 'dynamic' },
  aircraft: { mode: 'aircraft', roll: 'aircraft', horizonStyle: 'balanced' },
}
const rigs: Record<string, () => CameraRig> = { legacy: () => new FlightCamera(), chase: () => new ChaseCamera() }
type Script = (t: number, state: AircraftState) => Partial<PilotCommand>
interface Flight { name: string; seconds: number; start: () => AircraftState; script?: Script; pose?: (t: number) => AircraftState }

const noseOf = (s: AircraftState) => new Vector3(1, 0, 0).applyQuaternion(new Quaternion().copy(s.orientation))
const at = (state: AircraftState, pitchDeg: number, speed: number, altitude = 4000) => {
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), pitchDeg * DEG)
  state.orientation = { x: q.x, y: q.y, z: q.z, w: q.w }
  state.velocity = { x: speed * Math.cos(pitchDeg * DEG), y: speed * Math.sin(pitchDeg * DEG), z: 0 }
  state.position = { x: 0, y: altitude, z: 0 }
  return state
}
const flights: Flight[] = [
  // Pull from level on burner until the nose is back at level.
  { name: 'loop', seconds: 15, start: () => coreAircraft('f22', 150), script: (() => { let done = false; return (t: number, s: AircraftState) => {
    const n = noseOf(s); if (t > 6 && n.y > -0.02 && n.x > 0) done = true
    return { pitch: done ? 0 : 1, speedAdjust: 1, afterburner: true } } })() },
  { name: 'roll360', seconds: 4, start: () => coreAircraft('f22', 150), script: t => ({ roll: t >= 0.5 && t < 2.5 ? 1 : 0 }) },
  { name: 'hardTurn', seconds: 6, start: () => coreAircraft('f22', 100), script: t => ({ roll: t < 0.45 ? 1 : 0, pitch: t >= 0.45 && t < 4.5 ? 1 : 0 }) },
  // The deepest drift the FR1 core flies: banked full pull, full rudder, airbrake.
  { name: 'drift', seconds: 6, start: () => coreAircraft('f22', 110), script: t => ({ roll: t < 0.4 ? 1 : 0, pitch: t >= 0.4 && t < 4 ? 1 : 0, yaw: t >= 0.4 && t < 4 ? -1 : 0, airbrake: t >= 0.4 && t < 4 }) },
  // FC-13: a posed drift (no flight), the nose swung 0 → 180° off the path over 9 s, then held.
  { name: 'driftSweep', seconds: 11, start: () => coreAircraft('f22', 140), pose: t => {
    const s = coreAircraft('f22', 140), q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.min(180, t * 20) * DEG)
    s.orientation = { x: q.x, y: q.y, z: q.z, w: q.w }; s.velocity = { x: 140, y: 0, z: 0 }; return s } },
  // Inverted: roll over, hold it, then pull through (split-S).
  { name: 'inverted', seconds: 8, start: () => coreAircraft('f22', 140), script: t => ({ roll: t >= 0.3 && t < 1.3 ? 1 : 0, pitch: t >= 3 && t < 6.5 ? 1 : 0, speedAdjust: -1 }) },
  // Straight down, rolling, then pulling out.
  { name: 'dive', seconds: 6, start: () => at(coreAircraft('f22', 150), -88, 150, 7000), script: t => ({ roll: t < 1.5 ? 1 : 0, pitch: t >= 2.5 ? 1 : 0 }) },
  // FC-15: straight up, throttle cut, to a stop and a slide back.
  { name: 'tailSlide', seconds: 12, start: () => at(coreAircraft('f22', 70), 90, 70), script: () => ({ speedAdjust: -1 }) },
  // Nearly straight up: it stops, and falls over nose first through zero airspeed.
  { name: 'hammerhead', seconds: 12, start: () => at(coreAircraft('f22', 70), 85, 70), script: () => ({ speedAdjust: -1 }) },
]

/** The flight's pose at each frame, interpolated between steps as FlightScene does. */
function poses(flight: Flight): AircraftState[] {
  const frames = Math.floor(flight.seconds * FPS)
  if (flight.pose) return Array.from({ length: frames + 1 }, (_, f) => flight.pose!(f / FPS))
  const state = flight.start(), steps = Math.round(flight.seconds / FLIGHT_STEP), history = [structuredClone(state)]
  for (let i = 0; i < steps; i++) { stepCoreFlight(state, { ...neutralCommand(i, state.id), ...flight.script!(i * FLIGHT_STEP, state) }, FLIGHT_STEP); history.push(structuredClone(state)) }
  return Array.from({ length: frames + 1 }, (_, f) => {
    const t = f / FPS, i = Math.min(steps - 1, Math.floor(t / FLIGHT_STEP)), alpha = Math.min(1, t / FLIGHT_STEP - i), a = history[i], b = history[i + 1]
    return { ...b, position: new Vector3().copy(a.position).lerp(b.position as Vector3, alpha), orientation: new Quaternion().copy(a.orientation).slerp(new Quaternion().copy(b.orientation), alpha),
      velocity: new Vector3().copy(a.velocity).lerp(b.velocity as Vector3, alpha) }
  })
}
const percentile = (values: number[], p: number) => values.length ? [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(p * values.length))] : 0
const round = (value: number, digits = 1) => Number(value.toFixed(digits))

function film(rigName: string, view: CameraSettings, frames: AircraftState[]) {
  const rig = rigs[rigName](), camera = new PerspectiveCamera(56, WIDTH / HEIGHT, 0.5, 14000), trace = new CameraTrace()
  rig.trace = trace
  let nose = 0, fpm = 0, nan = 0
  frames.forEach((state, f) => {
    rig.update(camera, state, view, f ? 1 / FPS : 0)
    camera.updateMatrixWorld()
    if (![camera.position.x, camera.position.y, camera.position.z, camera.quaternion.w, camera.fov].every(Number.isFinite)) nan++
    // As the HUD draws them: the nose scaled past the marker's 1-unit floor, the FPM from the velocity (hidden under 1 m/s).
    if (projectVelocityMarker(camera, state.position, noseOf(state).multiplyScalar(2), WIDTH, HEIGHT, 24)?.onScreen) nose++
    if (projectVelocityMarker(camera, state.position, state.velocity, WIDTH, HEIGHT, 24)?.onScreen) fpm++
  })
  // Motion, from the trace alone.
  const look: number[] = [], roll: number[] = [], jump: number[] = [], tilt: number[] = []
  const v = (a: [number, number, number]) => new Vector3(...a)
  for (let i = 1; i < trace.frames.length; i++) {
    const a = trace.frames[i - 1], b = trace.frames[i], la = v(a.look), lb = v(b.look), ua = v(a.up), ub = v(b.up)
    const turn = la.angleTo(lb) / DEG
    // Roll about the view: last frame's up carried onto this look, against this up.
    const carried = ua.clone().addScaledVector(lb, -ua.dot(lb)).normalize()
    const rolled = Math.atan2(new Vector3().crossVectors(carried, ub).dot(lb), carried.dot(ub)) / DEG
    look.push(turn * FPS); roll.push(Math.abs(rolled) * FPS); jump.push(Math.max(turn, ua.angleTo(ub) / DEG))
  }
  for (const frame of trace.frames) {
    const l = v(frame.look), u = v(frame.up), level = new Vector3(0, 1, 0).addScaledVector(l, -l.y)
    if (level.lengthSq() > 1e-6 && Math.hypot(l.x, l.z) > 0.35) tilt.push(u.angleTo(level.normalize()) / DEG)
  }
  const blend = trace.frames.map(frame => frame.rig === 'legacy' ? frame.blend.handover : frame.blend.drift)
  return {
    trace,
    metrics: {
      lookRateP95: round(percentile(look, 0.95)), lookRateMax: round(Math.max(0, ...look)),
      rollRateP95: round(percentile(roll, 0.95)), rollRateMax: round(Math.max(0, ...roll)),
      jumpMax: round(Math.max(0, ...jump), 2),
      noseOnScreen: round(nose / frames.length, 3), fpmOnScreen: round(fpm / frames.length, 3),
      tiltMax: round(Math.max(0, ...tilt)), tiltEnd: tilt.length ? round(tilt.at(-1)!) : null,
      // legacy: its PSM-shot handover; chase: its drift share. Both 0..1, at their peak.
      blendMax: round(Math.max(0, ...blend), 2), nan,
    },
  }
}

it('compares the legacy and the rewrite chase cameras on the new core (report only)', () => {
  const result: Record<string, Record<string, Record<string, ReturnType<typeof film>['metrics']>>> = {}
  const peaks: Record<string, { incidenceMax: number; betaMax: number; airspeedMin: number }> = {}
  mkdirSync('benchmarks/flight/out/camera-traces-fr2', { recursive: true })
  for (const flight of flights) {
    const frames = poses(flight)
    const air = frames.map(state => readFlight(state))
    peaks[flight.name] = { incidenceMax: round(Math.max(...air.map(a => a.incidenceDeg))), betaMax: round(Math.max(...air.map(a => Math.abs(a.betaDeg)))), airspeedMin: round(Math.min(...air.map(a => a.airspeed))) }
    result[flight.name] = {}
    for (const [styleName, view] of Object.entries(views)) {
      result[flight.name][styleName] = {}
      for (const rigName of Object.keys(rigs)) {
        const { trace, metrics } = film(rigName, view, frames)
        result[flight.name][styleName][rigName] = metrics
        writeFileSync(`benchmarks/flight/out/camera-traces-fr2/${flight.name}-${styleName}-${rigName}.json`, JSON.stringify(trace))
      }
    }
  }
  const lines = ['# Camera comparison on the new core (FR2)', '',
    'Same flight per row, filmed by both rigs at 60 FPS, 16:9. Rates in °/s, jump = largest frame-to-frame change of look or up (°), on-screen = share of frames, tilt = horizon tilt (°) where the look is not near vertical, blend = legacy PSM handover / chase drift share (peak).', '']
  for (const flight of flights) {
    const p = peaks[flight.name]
    lines.push(`## ${flight.name}`, '', `Flight: incidence up to ${p.incidenceMax}°, |β| up to ${p.betaMax}°, airspeed down to ${p.airspeedMin} m/s.`, '',
      '| style | rig | look p95 | look max | roll p95 | roll max | jump max | nose on | FPM on | tilt max | tilt end | blend | NaN |', '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|')
    for (const styleName of Object.keys(views)) for (const rigName of Object.keys(rigs)) {
      const m = result[flight.name][styleName][rigName]
      lines.push(`| ${styleName} | ${rigName} | ${m.lookRateP95} | ${m.lookRateMax} | ${m.rollRateP95} | ${m.rollRateMax} | ${m.jumpMax} | ${m.noseOnScreen} | ${m.fpmOnScreen} | ${m.tiltMax} | ${m.tiltEnd ?? '—'} | ${m.blendMax} | ${m.nan} |`)
    }
    lines.push('')
  }
  writeFileSync('benchmarks/flight/out/camera-compare-fr2.json', JSON.stringify({ peaks, result }, null, 2))
  writeFileSync('benchmarks/flight/out/camera-compare-fr2.md', lines.join('\n'))
  console.log(lines.join('\n'))
}, 300000)
