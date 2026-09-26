import { it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { PerspectiveCamera, Quaternion, Vector3 } from 'three'
import { runScenario, runTrack, type Trace } from './harness'
import { driftSpawn } from './jetDrift'
import { flightProfileVersion, getFlightProfile } from '../../src/game/flight/profile'
import { observeAirflow } from '../../src/game/flight/airflow'
import { interpretEnvelope } from '../../src/game/flight/envelope'
import { FLIGHT_STEP } from '../../src/game/runtime/clock'
import { FlightCamera, type CameraRollMode } from '../../src/render/FlightCamera'
import { projectVelocityMarker } from '../../src/features/flight/hudPainter'
import { screenFrame } from '../../src/game/input/mouseStick'
import type { AircraftState } from '../../src/game/state/WorldState'

/*
B21 camera framing. Drives the public FlightCamera API from real flight traces at several
render rates and aspect ratios, and measures what the player sees:
- nose pipper / FPM on screen, by the HUD's own rule (projectVelocityMarker, inset 24 px);
- the airframe's projected extent (1 = frame edge; the flight model is 18.9 units long);
- camera roll rate about its own view axis, raw up-vector rate and view rotation rate (motion comfort);
- stick-frame mismatch: the angle, about the nose, between the rendered screen-up and the
  up that the mouse mapping assumes (screenFrame + highAoa body-axis blend). Large values
  mean "mouse up" no longer looks like "up" on screen.
Presentation only; nothing here feeds flight. Report only, no targets yet.
*/
const aircraftIds = ['f22', 'su57'] as const
const aspects = [['9:16', 9 / 16], ['4:3', 4 / 3], ['16:9', 16 / 9], ['21:9', 21 / 9]] as const
const fpsList = [30, 60, 144] as const
const modes: CameraRollMode[] = ['horizon', 'aircraft']
const HEIGHT = 900, INSET = 24
const bands = [[0, 20], [20, 40], [40, 70], [70, 110], [110, 181]] as const
const bandName = ([lo, hi]: readonly [number, number]) => `${lo}-${Math.min(hi, 180)}`
const corners: Vector3[] = []
for (const x of [-9.45, 9.45]) for (const y of [-3, 3]) for (const z of [-7.5, 7.5]) corners.push(new Vector3(x, y, z))

function tracks(aircraftId: string): Trace[] {
  const drift = (name: string, seconds: number, controller: Parameters<typeof runTrack>[2], kph = 500) =>
    runTrack(driftSpawn(aircraftId, kph), seconds, controller, undefined, name)
  return [
    ...(['cobra', 'kulbit', 'tailSlide', 'reversal180', 'pedal', 'psmIntent450', 'hardTurn900'] as const).map(name => runScenario(name, aircraftId)),
    drift('entry-pitch-450', 3, () => ({ pitch: 1, airbrake: true }), 450),
    drift('entry-yaw-450', 3, () => ({ yaw: 1, airbrake: true }), 450),
    drift('handoff', 6, (_s, t) => ({ airbrake: t < 3.6, pitch: t < 1 ? 1 : t >= 2.8 && t < 3.6 ? 0.5 : 0,
      yaw: t >= 1.1 && t < 1.9 ? 0.5 : 0, roll: t >= 2 && t < 2.7 ? 0.7 : 0 })),
    drift('rollPull', 4, (_s, t) => ({ roll: t < 0.6 ? 1 : 0, pitch: t >= 0.6 ? 1 : 0, airbrake: t >= 0.6 })),
  ]
}

const percentile = (values: number[], p: number) => {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
}
const signedAngleAbout = (from: Vector3, to: Vector3, axis: Vector3) =>
  Math.atan2(new Vector3().crossVectors(from, to).dot(axis), from.dot(to))

function pose(trace: Trace, time: number): AircraftState {
  const i = Math.min(trace.samples.length - 1, Math.floor(time / FLIGHT_STEP))
  const a = trace.samples[i].state, b = trace.samples[Math.min(trace.samples.length - 1, i + 1)].state
  const t = Math.min(1, time / FLIGHT_STEP - i)
  return { ...b,
    position: new Vector3().copy(a.position).lerp(new Vector3().copy(b.position), t),
    velocity: new Vector3().copy(a.velocity).lerp(new Vector3().copy(b.velocity), t),
    orientation: new Quaternion().copy(a.orientation).slerp(new Quaternion().copy(b.orientation), t) }
}

/** The screen-up the mouse mapping assumes, about the nose (readStickAxes + screenFrame):
 * the stick is turned by angle · blend toward the held horizon, then eased back to body axes by highAoa. */
function impliedUp(state: AircraftState, mode: CameraRollMode, nose: Vector3) {
  const bodyUp = new Vector3(0, 1, 0).applyQuaternion(new Quaternion().copy(state.orientation))
  const profile = getFlightProfile(state.aircraftId)
  const highAoa = interpretEnvelope(state, observeAirflow(state, profile), profile).highAoa
  const frame = screenFrame(state, mode)
  return bodyUp.applyAxisAngle(nose, -frame.angle * frame.blend * (1 - highAoa))
}

function measure(trace: Trace, mode: CameraRollMode, aspect: number, fps: number) {
  const width = HEIGHT * aspect, dt = 1 / fps
  const camera = new PerspectiveCamera(69, aspect, 0.5, 14000), rig = new FlightCamera()
  const duration = (trace.samples.length - 1) * FLIGHT_STEP
  const perBand = bands.map(() => ({ frames: 0, nose: 0, fpm: 0, both: 0 }))
  const upRates: number[] = [], rollRates: number[] = [], viewRates: number[] = [], mismatch: number[] = []
  let maxExtent = 0, depthInvalid = 0, minFov = Infinity, maxFov = -Infinity, frames = 0
  let lastUp: Vector3 | null = null, lastQ: Quaternion | null = null
  for (let time = 0; time <= duration + 1e-9; time += dt) {
    const state = pose(trace, time)
    rig.update(camera, state, mode, dt, false)
    camera.updateMatrixWorld()
    frames++
    minFov = Math.min(minFov, camera.fov); maxFov = Math.max(maxFov, camera.fov)
    const q = new Quaternion().copy(state.orientation), origin = new Vector3().copy(state.position)
    const nose = new Vector3(1, 0, 0).applyQuaternion(q)
    const incidence = observeAirflow(state, getFlightProfile(state.aircraftId)).incidenceDeg
    const band = bands.findIndex(([lo, hi]) => incidence >= lo && incidence < hi)
    const noseMark = projectVelocityMarker(camera, origin, nose.clone().multiplyScalar(2), width, HEIGHT, INSET)
    const fpmMark = projectVelocityMarker(camera, origin, state.velocity, width, HEIGHT, INSET)
    const counts = perBand[band]
    counts.frames++
    const noseOn = !!noseMark?.onScreen, fpmOn = !fpmMark || fpmMark.onScreen
    if (noseOn) counts.nose++
    if (fpmOn) counts.fpm++
    if (noseOn && fpmOn) counts.both++
    for (const corner of corners) {
      const ndc = corner.clone().applyQuaternion(q).add(origin).project(camera)
      maxExtent = Math.max(maxExtent, Math.abs(ndc.x), Math.abs(ndc.y))
      if (!(ndc.z > -1 && ndc.z < 1)) depthInvalid++
    }
    const up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion)
    if (lastUp && lastQ) {
      upRates.push(lastUp.angleTo(up) / dt * 180 / Math.PI)
      const view = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion)
      const carried = lastUp.clone().addScaledVector(view, -lastUp.dot(view))
      if (carried.lengthSq() > 1e-8) rollRates.push(Math.abs(signedAngleAbout(carried.normalize(), up, view)) / dt * 180 / Math.PI)
      viewRates.push(lastQ.angleTo(camera.quaternion) / dt * 180 / Math.PI)
    }
    lastUp = up; lastQ = camera.quaternion.clone()
    const screenUp = up.clone().addScaledVector(nose, -up.dot(nose))
    if (screenUp.lengthSq() > 1e-4) {
      mismatch.push(Math.abs(signedAngleAbout(impliedUp(state, mode, nose), screenUp.normalize(), nose)) * 180 / Math.PI)
    }
  }
  const share = (n: number, d: number) => d ? n / d : null
  return {
    frames, maxExtent, depthInvalid, fov: [minFov, maxFov],
    bands: Object.fromEntries(bands.map((band, i) => [bandName(band), { frames: perBand[i].frames,
      nose: share(perBand[i].nose, perBand[i].frames), fpm: share(perBand[i].fpm, perBand[i].frames), both: share(perBand[i].both, perBand[i].frames) }])),
    upRate: { p95: percentile(upRates, 0.95), max: Math.max(0, ...upRates) },
    rollRate: { p95: percentile(rollRates, 0.95), max: Math.max(0, ...rollRates) },
    viewRate: { p95: percentile(viewRates, 0.95), max: Math.max(0, ...viewRates) },
    mismatch: { p50: percentile(mismatch, 0.5), p95: percentile(mismatch, 0.95), max: Math.max(0, ...mismatch) },
  }
}

it('reports B21 camera framing, marker visibility, motion and stick-frame mismatch', () => {
  const label = process.env.CAMERA_REPORT_LABEL ?? 'camera'
  const results = aircraftIds.flatMap(aircraftId => tracks(aircraftId).flatMap(trace => modes.flatMap(mode => aspects.flatMap(([aspectName, aspect]) =>
    fpsList.map(fps => ({ aircraftId, track: trace.scenario, mode, aspect: aspectName, fps, ...measure(trace, mode, aspect, fps) }))))))
  const directory = new URL('./out/', import.meta.url); mkdirSync(directory, { recursive: true })
  writeFileSync(new URL(`${label}.json`, directory), JSON.stringify({ flightProfileVersion, results }, null, 2) + '\n')

  const pct = (value: number | null) => value === null ? '—' : `${Math.round(value * 100)}%`
  const md = [`# B21 camera framing — ${label} (${flightProfileVersion})`, '',
    'Nose / FPM columns: share of frames with the marker on screen (HUD rule, 24 px inset) in each incidence band.',
    'Primary table: horizon mode, 16:9, 60 fps. Worst-case table: minimum/maximum across modes, aspects and 30/60/144 fps.', '',
    '## Primary (horizon, 16:9, 60 fps)', '',
    '| Aircraft | Track | Nose 20–40 | FPM 20–40 | Nose 40–70 | FPM 40–70 | Nose 70–110 | FPM 70–110 | Nose 110–180 | FPM 110–180 | Extent max | Roll °/s p95/max | Up °/s p95/max | View °/s p95/max | Mismatch ° p50/p95 | FOV |',
    '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|---|']
  for (const r of results.filter(r => r.mode === 'horizon' && r.aspect === '16:9' && r.fps === 60)) {
    const b = r.bands
    md.push(`| ${r.aircraftId} | ${r.track} | ${pct(b['20-40'].nose)} | ${pct(b['20-40'].fpm)} | ${pct(b['40-70'].nose)} | ${pct(b['40-70'].fpm)} | ${pct(b['70-110'].nose)} | ${pct(b['70-110'].fpm)} | ${pct(b['110-180'].nose)} | ${pct(b['110-180'].fpm)} | ${r.maxExtent.toFixed(2)} | ${r.rollRate.p95.toFixed(0)} / ${r.rollRate.max.toFixed(0)} | ${r.upRate.p95.toFixed(0)} / ${r.upRate.max.toFixed(0)} | ${r.viewRate.p95.toFixed(0)} / ${r.viewRate.max.toFixed(0)} | ${r.mismatch.p50.toFixed(0)} / ${r.mismatch.p95.toFixed(0)} | ${r.fov[0].toFixed(0)}–${r.fov[1].toFixed(0)} |`)
  }
  md.push('', '## Worst case per mode (all aspects, 30/60/144 fps, both aircraft, all tracks)', '',
    '| Mode | Min nose 20–40 | Min FPM 20–40 | Min nose 40–70 | Min FPM 40–70 | Max extent | Depth-invalid frames | Max roll °/s | Max up °/s | Max view °/s | Max mismatch p95 ° |', '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|')
  for (const mode of modes) {
    const rows = results.filter(r => r.mode === mode)
    const min = (band: string, key: 'nose' | 'fpm') => Math.min(...rows.map(r => r.bands[band][key]).filter((v): v is number => v !== null))
    md.push(`| ${mode} | ${pct(min('20-40', 'nose'))} | ${pct(min('20-40', 'fpm'))} | ${pct(min('40-70', 'nose'))} | ${pct(min('40-70', 'fpm'))} | ${Math.max(...rows.map(r => r.maxExtent)).toFixed(2)} | ${rows.reduce((n, r) => n + r.depthInvalid, 0)} | ${Math.max(...rows.map(r => r.rollRate.max)).toFixed(0)} | ${Math.max(...rows.map(r => r.upRate.max)).toFixed(0)} | ${Math.max(...rows.map(r => r.viewRate.max)).toFixed(0)} | ${Math.max(...rows.map(r => r.mismatch.p95)).toFixed(0)} |`)
  }
  md.push('', '## Frame-rate spread (horizon, 16:9): max |value(30 or 144 fps) − value(60 fps)|', '',
    '| Aircraft | Track | Extent | FPM 40–70 share | Mismatch p95 ° |', '|---|---|---:|---:|---:|')
  for (const r of results.filter(r => r.mode === 'horizon' && r.aspect === '16:9' && r.fps === 60)) {
    const others = results.filter(o => o.mode === 'horizon' && o.aspect === '16:9' && o.aircraftId === r.aircraftId && o.track === r.track && o.fps !== 60)
    const spread = (f: (x: typeof r) => number | null) => Math.max(...others.map(o => Math.abs((f(o) ?? 0) - (f(r) ?? 0))))
    md.push(`| ${r.aircraftId} | ${r.track} | ${spread(x => x.maxExtent).toFixed(3)} | ${pct(spread(x => x.bands['40-70'].fpm))} | ${spread(x => x.mismatch.p95).toFixed(1)} |`)
  }
  writeFileSync(new URL(`${label}.md`, directory), md.join('\n') + '\n')
  console.info(`Camera report: benchmarks/flight/out/${label}.md (full ledger: ${label}.json)`)
}, 300000)
