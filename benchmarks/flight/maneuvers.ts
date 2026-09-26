import { MathUtils, Quaternion, Vector3 } from 'three'
import { forward, runTrack, type Controller, type Sample, type Trace } from './harness'
import { driftSpawn } from './jetDrift'
import { observeAirflow } from '../../src/game/flight/airflow'
import { getFlightProfile } from '../../src/game/flight/profile'
import { arcadeSpeed, simulationSpeed } from '../../src/game/flight/speedLimits'
import type { PilotCommand } from '../../src/game/runtime/commands'
import type { AircraftState } from '../../src/game/state/WorldState'
import { FLIGHT_STEP as dt } from '../../src/game/runtime/clock'

/*
Maneuver catalogue M1–M7 (docs/psm-maneuver-control-plan.md §3) as closed-loop scripts.

Every script is the recipe a player is taught: the switch conditions read incidence,
attitude, heading or speed, never time alone, so a faster airframe runs the same recipe
sooner. All runs start from `driftSpawn` (3000 m, level, trim power). Speeds are arcade
km/h (HUD). Report only: no metric here is a CI gate until MR7 promotes it.
*/
export const maneuverIds = ['f22', 'su57', 'f22-notvc'] as const
const DEG = 180 / Math.PI

export const kph = (s: AircraftState) => arcadeSpeed(new Vector3().copy(s.velocity).length())
export const incidence = (s: AircraftState) => observeAirflow(s, getFlightProfile(s.aircraftId)).incidenceDeg
const velocity = (s: AircraftState) => new Vector3().copy(s.velocity)
const bodyUp = (s: AircraftState) => new Vector3(0, 1, 0).applyQuaternion(new Quaternion().copy(s.orientation))
/** Flight-path angle above the horizon (degrees). */
export const pathAngle = (s: AircraftState) => { const v = velocity(s); return v.length() < 1e-6 ? 0 : Math.asin(MathUtils.clamp(v.y / v.length(), -1, 1)) * DEG }
/** Nose pitch in the vertical plane of the entry heading, 0..180 (past 90 the nose is over the top). */
export const planeAttitude = (s: AircraftState, heading = new Vector3(1, 0, 0)) => { const f = forward(s); return Math.atan2(f.y, f.dot(heading)) * DEG }
const round = (value: number | null | undefined, digits = 2) => value == null || !Number.isFinite(value) ? null : Math.round(value * 10 ** digits) / 10 ** digits
const first = (samples: Sample[], test: (s: Sample) => boolean) => samples.find(test) ?? null
const time = (sample: Sample | null, from = 0) => sample === null ? null : round(sample.time - from, 3)
const peak = (samples: Sample[], read: (s: Sample) => number) => samples.reduce((best, s) => Math.max(best, read(s)), -Infinity)

/** Level trim spawn with the nose raised `pitchDeg` about body Z and the velocity along it. */
export function spawnAt(id: string, speedKph: number, pitchDeg = 0) {
  const state = driftSpawn(id, speedKph)
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), pitchDeg / DEG)
  state.orientation = { x: q.x, y: q.y, z: q.z, w: q.w }
  const v = new Vector3(simulationSpeed(speedKph), 0, 0).applyQuaternion(q)
  state.velocity = { x: v.x, y: v.y, z: v.z }
  return state
}

/** Signed velocity heading change, unwrapped substep by substep. Skips near-vertical flight. */
function headingTrack(samples: Sample[]) {
  let total = 0, previous: number | null = null
  return samples.map(s => {
    const v = velocity(s.state)
    if (Math.hypot(v.x, v.z) > 1) {
      const heading = Math.atan2(v.z, v.x) * DEG
      if (previous !== null) total += ((heading - previous + 540) % 360) - 180
      previous = heading
    }
    return total
  })
}

/** Cumulative angle through which the velocity vector turned. */
function pathRotation(samples: Sample[]) {
  let total = 0
  return samples.map((s, i) => {
    if (i > 0) { const a = velocity(samples[i - 1].state), b = velocity(s.state); if (a.length() > 1e-3 && b.length() > 1e-3) total += a.angleTo(b) * DEG }
    return total
  })
}

// ---------------------------------------------------------------------------------------
// M1 Roll and per-axis smoothness

export const rollSpeeds = [250, 450, 700, 1000] as const
/** Full roll from level for 3 s: peak rate, time to 90° and 360° of body roll, and the
 * allocation at the peak so budget-limited and target-limited speeds are distinguishable. */
export function rollMetrics(id: string, speedKph: number) {
  const trace = runTrack(spawnAt(id, speedKph), 3, () => ({ roll: 1 }), undefined, `roll-${speedKph}`)
  let travel = 0, t90: number | null = null, t180: number | null = null, t360: number | null = null
  for (const s of trace.samples.slice(1)) {
    travel += s.state.rates.roll * dt * DEG
    if (t90 === null && travel >= 90) t90 = s.time
    if (t180 === null && travel >= 180) t180 = s.time
    if (t360 === null && travel >= 360) t360 = s.time
  }
  const at = trace.samples.slice(1).reduce((best, s) => Math.abs(s.state.rates.roll) > Math.abs(best.state.rates.roll) ? s : best)
  const f = at.state.flightForces!
  return { aircraft: id, speedKph, peakRateDegS: round(Math.abs(at.state.rates.roll) * DEG, 1), time90: round(t90, 3), time180: round(t180, 3), time360: round(t360, 3), travel3sDeg: round(travel, 0),
    atPeakAeroBudget: round(f.budget.physicalAero.roll), atPeakAero: round(f.allocation.aero.roll), atPeakUnmet: round(f.allocation.unmet.roll), atPeakServoDamping: round(f.stabilityDamping.roll),
    targetRate: round(Math.abs(at.state.rates.roll) > 0 ? getFlightProfile(id).flight.rollRate : null) }
}

type Axis = 'pitch' | 'yaw' | 'roll'
/** Step to full stick for 1.5 s, then reverse to full opposite for 1.5 s.
 * - latency63: command → 63% of the first segment's peak rate.
 * - overshoot: peak over the rate at the end of the first segment.
 * - reversalRequestStep: the largest |Δ request| between substeps after the reversal,
 *   excluding the substep where the command itself flips (RC4 measures the jump at the
 *   rate zero crossing, not the command step).
 * - zeroCrossRequestStep: |Δ request| across the substep where the rate changes sign.
 * - peakJerk: the largest |Δ angular acceleration| / dt, again excluding command steps. */
export function smoothnessMetrics(id: string, axis: Axis, speedKph: number) {
  const trace = runTrack(spawnAt(id, speedKph), 3, (_s, t) => ({ [axis]: t < 1.5 ? 1 : -1 }), undefined, `smooth-${axis}-${speedKph}`)
  const s = trace.samples, flip = Math.round(1.5 / dt)
  const firstLeg = s.slice(1, flip + 1), peakRate = peak(firstLeg, x => x.state.rates[axis]), endRate = firstLeg.at(-1)!.state.rates[axis]
  const latency = first(firstLeg, x => x.state.rates[axis] >= 0.63 * peakRate)
  const request = (x: Sample) => x.state.flightForces!.allocation.request[axis]
  let reversalStep = 0, zeroStep: number | null = null, jerk = 0
  for (let i = 2; i < s.length; i++) {
    if (i === flip + 1) continue
    const accel = (x: Sample) => (x.state.rates[axis] - x.state.flightForces!.ratesBefore[axis]) / dt
    if (i !== flip + 2) jerk = Math.max(jerk, Math.abs(accel(s[i]) - accel(s[i - 1])) / dt)
    if (i > flip + 1) {
      const step = Math.abs(request(s[i]) - request(s[i - 1]))
      reversalStep = Math.max(reversalStep, step)
      // The request reads the rate at the start of its substep.
      const before = (x: Sample) => x.state.flightForces!.ratesBefore[axis]
      if (zeroStep === null && before(s[i]) < 0 && before(s[i - 1]) >= 0) zeroStep = step
    }
  }
  const reversal = first(s.slice(flip + 1), x => x.state.rates[axis] <= -0.63 * peakRate)
  return { aircraft: id, axis, speedKph, peakRateDegS: round(peakRate * DEG, 1), latency63: time(latency), overshootPct: round(endRate > 0 ? (peakRate / endRate - 1) * 100 : null, 1),
    reversal63: time(reversal, 1.5), reversalRequestStep: round(reversalStep), zeroCrossRequestStep: round(zeroStep), peakJerk: round(jerk, 0) }
}

// ---------------------------------------------------------------------------------------
// M2 Cobra

/** Space + full pull from level. `shift` holds Afterburner too. Entry window 2.5 s, the
 * legacy Cobra pull timeout. */
export function cobraEntry(id: string, speedKph: number, shift: boolean) {
  const trace = runTrack(spawnAt(id, speedKph), 2.5, () => ({ pitch: 1, airbrake: true, afterburner: shift }), undefined, `cobra-entry-${speedKph}-${shift}`)
  const s = trace.samples.slice(1), at = (deg: number) => time(first(s, x => incidence(x.state) >= deg))
  return { aircraft: id, speedKph, shift, time30: at(30), time60: at(60), time90: at(90), peakIncidence: round(peak(s, x => incidence(x.state)), 1),
    peakPitchRate: round(peak(s, x => x.state.rates.pitch), 3), speedLoss: round(kph(trace.samples[0].state) - Math.min(...s.map(x => kph(x.state))), 0) }
}

/** The taught exit: Space + pull until incidence 85°, then release Space and push full until
 * the attitude is back within 5° of level. `release` centres the stick and keeps Space held
 * instead (the nose hangs). Metrics run from the push. B27 counts the first return within
 * ±10° of the entry attitude. */
export function cobraExit(id: string, speedKph = 450, mode: 'push' | 'release' = 'push') {
  let pushAt: number | null = null, levelAt: number | null = null
  const controller: Controller = (s, t) => {
    if (pushAt === null && incidence(s) >= 85) pushAt = t
    if (pushAt !== null && levelAt === null && planeAttitude(s) <= 5) levelAt = t
    return { pitch: pushAt === null ? 1 : mode === 'release' || levelAt !== null ? 0 : -1, airbrake: pushAt === null || mode === 'release' }
  }
  const trace = runTrack(spawnAt(id, speedKph), 10, controller, undefined, `cobra-exit-${mode}`)
  if (pushAt === null) return { aircraft: id, speedKph, mode, pushAt: null }
  const start = trace.samples[0].state, s = trace.samples.filter(x => x.time > pushAt!)
  const within10 = first(s, x => Math.abs(planeAttitude(x.state) - planeAttitude(start)) <= 10)
  const level = first(s, x => planeAttitude(x.state) <= 5)
  const settledIncidence = first(s, x => incidence(x.state) < 15)
  const upTo = level ?? s.at(-1)!, climbWindow = trace.samples.filter(x => x.time <= upTo.time)
  return { aircraft: id, speedKph, mode, pushAt: round(pushAt, 3), peakIncidence: round(peak(trace.samples, x => incidence(x.state)), 1),
    toEntryAttitude10: time(within10, pushAt), toAttitude5: time(level, pushAt), incidenceBelow15: time(settledIncidence, pushAt),
    maxPathAngle: round(peak(climbWindow, x => pathAngle(x.state)), 1),
    altitudeGainAtLevel: level ? round(level.state.position.y - start.position.y, 0) : null, kphAtLevel: level ? round(kph(level.state), 0) : null,
    attitudeAt5s: round(planeAttitude(first(trace.samples, x => x.time >= pushAt! + 5)?.state ?? trace.samples.at(-1)!.state), 1) }
}

// ---------------------------------------------------------------------------------------
// M3 Pedal turn (B11): Space + full yaw from level 150 km/h, body yaw travel.

export function pedalTurn(id: string) {
  const trace = runTrack(spawnAt(id, 150), 8, () => ({ airbrake: true, yaw: 1 }), undefined, 'pedal')
  let travel = 0, t360: number | null = null
  for (const s of trace.samples.slice(1)) { travel += Math.abs(s.state.rates.yaw) * dt * DEG; if (t360 === null && travel >= 360) t360 = s.time }
  return { aircraft: id, time360: round(t360, 2), travel8sDeg: round(travel, 0), endKph: round(kph(trace.samples.at(-1)!.state), 0) }
}

// ---------------------------------------------------------------------------------------
// M4 Herbst (J-turn)

/** 450, Space + full pull until incidence 70°, then pull + full roll (± yaw with the roll),
 * Afterburner from 1.2 s. When the heading has turned 170°, push and keep Afterburner.
 * B28 counts from reaching 70°: heading ≥ 170° within 4 s, altitude change ±200 m. */
export function herbst(id: string, withYaw: boolean, speedKph = 450) {
  let rollAt: number | null = null, turnedAt: number | null = null, heading = 0, previous: Vector3 | null = null
  const controller: Controller = (s, t) => {
    const v = velocity(s)
    if (previous && Math.hypot(v.x, v.z) > 1 && Math.hypot(previous.x, previous.z) > 1) {
      heading += (((Math.atan2(v.z, v.x) - Math.atan2(previous.z, previous.x)) * DEG + 540) % 360) - 180
    }
    if (Math.hypot(v.x, v.z) > 1) previous = v
    if (rollAt === null && incidence(s) >= 70) rollAt = t
    if (turnedAt === null && Math.abs(heading) >= 170) turnedAt = t
    const shift = t >= 1.2
    if (turnedAt !== null) return { pitch: -1, afterburner: true }
    if (rollAt === null) return { pitch: 1, airbrake: true, afterburner: shift }
    return { pitch: 1, roll: 1, yaw: withYaw ? 1 : 0, airbrake: true, afterburner: shift }
  }
  const trace = runTrack(spawnAt(id, speedKph), 8, controller, undefined, `herbst-${withYaw}`)
  const headings = headingTrack(trace.samples), start = trace.samples[0].state
  const maxHeading = Math.max(...headings.map(Math.abs))
  const within = rollAt === null ? [] : trace.samples.filter(x => x.time >= rollAt! && x.time <= (turnedAt ?? rollAt! + 4))
  return { aircraft: id, speedKph, withYaw, time70: round(rollAt, 3), maxHeadingDeg: round(maxHeading, 0),
    time170: rollAt === null || turnedAt === null ? null : round(turnedAt - rollAt, 3),
    altitudeRange: within.length ? round(Math.max(...within.map(x => Math.abs(x.state.position.y - start.position.y))), 0) : null,
    kphAt170: turnedAt === null ? null : round(kph(first(trace.samples, x => x.time >= turnedAt!)!.state), 0),
    peakIncidence: round(peak(trace.samples, x => incidence(x.state)), 1) }
}

// ---------------------------------------------------------------------------------------
// M5 Power loop

/** Legacy probe: 700 full pull (plain loop) and 350 Shift + W + full pull. */
export function loop(id: string, kind: 'plain' | 'powered') {
  const powered = kind === 'powered', speedKph = powered ? 350 : 700
  const command = { pitch: 1, speedAdjust: powered ? 1 : 0, afterburner: powered }
  const trace = runTrack(spawnAt(id, speedKph), 12, () => command, undefined, `loop-${kind}`)
  const done = first(trace.samples, x => x.noseRotationDeg >= 360), start = trace.samples[0].state
  const window = done ? trace.samples.filter(x => x.time <= done.time) : trace.samples
  return { aircraft: id, kind, speedKph, time360: time(done), heightGain: round(peak(window, x => x.state.position.y - start.position.y), 0),
    endAltitudeChange: done ? round(done.state.position.y - start.position.y, 0) : null, endKph: done ? round(kph(done.state), 0) : null,
    peakIncidence: round(peak(window, x => incidence(x.state)), 1) }
}

export type PowerLoopFlow = 'none' | 'W' | 'Shift' | 'Shift+Space'
/** D3 follow-up flow: start vertical at 400/450, full pull; metrics when the path has turned 270°. */
export function powerLoop(id: string, speedKph: number, flow: PowerLoopFlow) {
  const command: Partial<PilotCommand> = { pitch: 1, speedAdjust: flow === 'W' ? 1 : 0, afterburner: flow.startsWith('Shift'), airbrake: flow === 'Shift+Space' }
  const trace = runTrack(spawnAt(id, speedKph, 90), 10, () => command, undefined, `power-loop-${flow}`)
  const rotation = pathRotation(trace.samples), end = trace.samples.findIndex((_, i) => rotation[i] >= 270)
  const window = end < 0 ? trace.samples : trace.samples.slice(0, end + 1)
  const noseToPath = (x: Sample) => { const v = velocity(x.state); return v.length() < 1e-3 ? 0 : forward(x.state).angleTo(v) * DEG }
  const xs = window.map(x => x.state.position.x)
  return { aircraft: id, speedKph, flow, time270: end < 0 ? null : round(trace.samples[end].time, 2), widthM: round(Math.max(...xs) - Math.min(...xs), 0),
    peakIncidence: round(peak(window, x => incidence(x.state)), 1), maxNoseMinusPath: round(peak(window, noseToPath), 1),
    minKph: round(Math.min(...window.map(x => kph(x.state))), 0), heightM: round(peak(window, x => x.state.position.y - trace.samples[0].state.position.y), 0) }
}

// ---------------------------------------------------------------------------------------
// M6 Kvochur's Bell

/** Legacy probe: 500, hold the nose at 88° (proportional pitch) until reached, then release. */
export function bellProbe(id: string) {
  let released = false
  const trace = runTrack(spawnAt(id, 500), 16, s => {
    released ||= planeAttitude(s) >= 87
    return released ? {} : { pitch: MathUtils.clamp((88 - planeAttitude(s)) / 15, -1, 1) }
  }, undefined, 'bell-probe')
  return { aircraft: id, flow: 'probe 500 attitude 88, release', ...bellMetrics(trace) }
}

/** The player's recipe: Space + full pull until the attitude reaches 90°, then centre the
 * stick and keep Space until the nose is below the horizon after the apex; then W + Shift. */
export function bell(id: string, speedKph = 450) {
  let released = false, dropped = false
  const trace = runTrack(spawnAt(id, speedKph), 16, s => {
    released ||= planeAttitude(s) >= 90
    const apexPassed = s.velocity.y <= 0
    dropped ||= released && apexPassed && forward(s).y < 0
    if (!released) return { pitch: 1, airbrake: true }
    return dropped ? { speedAdjust: 1, afterburner: true } : { airbrake: true }
  }, undefined, 'bell')
  return { aircraft: id, flow: `recipe ${speedKph} Space + pull to 90°, release`, ...bellMetrics(trace) }
}

function bellMetrics(trace: Trace) {
  const s = trace.samples, apex = first(s.slice(1), x => x.state.velocity.y <= 0)
  const drop = apex ? first(s.filter(x => x.time >= apex.time), x => forward(x.state).y < 0) : null
  let slide = 0
  for (let i = 1; i < s.length; i++) {
    const along = velocity(s[i].state).dot(forward(s[i].state))
    if (along < 0 && (!drop || s[i].time <= drop.time)) slide += -along * dt
  }
  const after = apex ? s.filter(x => x.time >= apex.time && x.time <= apex.time + 4) : []
  return { apexTime: time(apex), minKph: round(Math.min(...s.map(x => kph(x.state))), 0), backSlideM: round(slide, 1),
    noseDropAfterApex: apex && drop ? round(drop.time - apex.time, 2) : null,
    peakRollYawDegS: after.length ? round(peak(after, x => Math.hypot(x.state.rates.roll, x.state.rates.yaw)) * DEG, 0) : null,
    alive: s.at(-1)!.state.alive }
}

// ---------------------------------------------------------------------------------------
// M7 Immelmann and Kulbit

/** 800, full pull until the path has turned 180° (inverted at the top), then full roll
 * until wings level upright. */
export function immelmann(id: string, speedKph = 800) {
  let halfAt: number | null = null, rolledAt: number | null = null, turned = 0, previous: Vector3 | null = null
  const controller: Controller = (s, t) => {
    const v = velocity(s)
    if (previous) turned += previous.angleTo(v) * DEG
    previous = v
    if (halfAt === null && turned >= 180) halfAt = t
    if (halfAt !== null && rolledAt === null && bodyUp(s).y >= Math.cos(10 / DEG)) rolledAt = t
    if (halfAt === null) return { pitch: 1 }
    return rolledAt === null ? { roll: 1 } : {}
  }
  const trace = runTrack(spawnAt(id, speedKph), 10, controller, undefined, 'immelmann')
  const top = halfAt === null ? null : first(trace.samples, x => x.time >= halfAt!)
  return { aircraft: id, speedKph, halfLoop: round(halfAt, 3), rollOut: halfAt !== null && rolledAt !== null ? round(rolledAt - halfAt, 3) : null,
    topKph: top ? round(kph(top.state), 0) : null, heightGain: top ? round(top.state.position.y - trace.samples[0].state.position.y, 0) : null }
}

/** 350, Space + Shift + full pull: time to 360° of nose rotation (B5 flow at 350). */
export function kulbit(id: string, speedKph = 350) {
  const trace = runTrack(spawnAt(id, speedKph), 8, () => ({ pitch: 1, airbrake: true, afterburner: true }), undefined, 'kulbit')
  return { aircraft: id, speedKph, time360: time(first(trace.samples, x => x.noseRotationDeg >= 360)), peakIncidence: round(peak(trace.samples, x => incidence(x.state)), 1) }
}

