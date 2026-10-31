import { mkdirSync, writeFileSync } from 'node:fs'
import { it } from 'vitest'
import { MathUtils, Quaternion, Vector3 } from 'three'
import { forward, runTrack } from './harness'
import { driftSpawn } from './jetDrift'
import { observeAirflow } from '../../src/game/flight/airflow'
import { flightProfileVersion, getFlightProfile } from '../../src/game/flight/profile'
import { arcadeSpeed } from '../../src/game/flight/speedLimits'
import type { PilotCommand } from '../../src/game/runtime/commands'
import type { AircraftState } from '../../src/game/state/WorldState'

/** Reference: example/Battlefield 6 aircraft control.mp4, 6.7–10.3 s. From inverted level flight a pull
 * points the nose ~80–90° down in ~1.3 s while the path stays near level; burner then recovers.
 * Report only: no targets, no CI gate. Variants compare today's entry modifiers (X = airbrake, Space = highG). */
const ids = ['f22', 'su57'] as const
const speeds = [450, 550, 650] as const
const variants = { plain: {}, brake: { airbrake: true }, highG: { highG: true } } satisfies Record<string, Partial<PilotCommand>>
const recoveries = ['splitS', 'rollPull'] as const
type Recovery = typeof recoveries[number]
const flickDeg = 80, flickTimeout = 3, holdSeconds = 0.8, recoverTimeout = 8, rollDoneDeg = 15, rollTimeout = 2

const degrees = (radians: number) => radians * 180 / Math.PI
const nosePitch = (s: AircraftState) => degrees(Math.asin(MathUtils.clamp(forward(s).y, -1, 1)))
const pathPitch = (s: AircraftState) => {
  const v = new Vector3().copy(s.velocity)
  return v.length() < 1 ? null : degrees(Math.asin(v.y / v.length()))
}

function invertedSpawn(id: string, kph: number) {
  const state = driftSpawn(id, kph)
  const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI)
  state.orientation = { x: q.x, y: q.y, z: q.z, w: q.w }
  return state
}

/** Signed roll (about the nose, positive = roll right) that brings the canopy toward the entry travel
 * direction (+X), so a pull returns the nose that way instead of completing a split-S. */
function rollErrorDeg(state: AircraftState) {
  const quaternion = new Quaternion().copy(state.orientation)
  const nose = new Vector3(1, 0, 0).applyQuaternion(quaternion), up = new Vector3(0, 1, 0).applyQuaternion(quaternion)
  const desired = new Vector3(1, 0, 0).projectOnPlane(nose)
  if (desired.lengthSq() < 1e-6) return 0
  return degrees(Math.atan2(nose.dot(new Vector3().crossVectors(up, desired.normalize())), up.dot(desired)))
}

/** Flick: variant + full pull until the nose is flickDeg below the horizon. Hold: neutral, as if firing.
 * Recover with afterburner: splitS keeps pulling through; rollPull rolls the canopy toward the entry
 * direction first, then pulls (the clip's exit, 9.3–10.3 s). */
function noseFlickTrack(id: string, kph: number, variant: keyof typeof variants, recovery: Recovery) {
  let flickEnd: number | null = null, recoverStart: number | null = null, rollEnd: number | null = null
  const trace = runTrack(invertedSpawn(id, kph), flickTimeout + holdSeconds + recoverTimeout, (state, time) => {
    if (flickEnd === null && (nosePitch(state) <= -flickDeg || time >= flickTimeout)) flickEnd = time
    if (flickEnd === null) return { pitch: 1, ...variants[variant] }
    if (time < flickEnd + holdSeconds) return {}
    recoverStart ??= time
    if (recovery === 'rollPull' && rollEnd === null) {
      const error = rollErrorDeg(state)
      if (Math.abs(error) > rollDoneDeg && time < recoverStart + rollTimeout) return { roll: MathUtils.clamp(error / 30, -1, 1), afterburner: true }
      rollEnd = time
    }
    return { pitch: 1, afterburner: true }
  }, undefined, `nose-flick-${variant}-${recovery}-${kph}`)
  return { trace, flickEnd, recoverStart, rollEnd }
}

function noseFlickMetrics({ trace, flickEnd, recoverStart, rollEnd }: ReturnType<typeof noseFlickTrack>) {
  const samples = trace.samples, first = samples[0].state, p = getFlightProfile(trace.aircraftId)
  const at = (time: number | null) => time === null ? null : samples.find(s => s.time >= time - 1e-9) ?? null
  const firstTime = (test: (s: AircraftState) => boolean, from = 0) => samples.find(s => s.time >= from && test(s.state))?.time ?? null
  const time60 = firstTime(s => nosePitch(s) <= -60), time80 = firstTime(s => nosePitch(s) <= -flickDeg)
  const flick = at(flickEnd)?.state ?? null, recover = at(recoverStart)?.state ?? null
  const flickSamples = samples.filter(s => flickEnd !== null && s.time <= flickEnd)
  const recovered = recoverStart === null ? null : firstTime(s => s.velocity.y >= 0 && nosePitch(s) >= 0, recoverStart)
  return {
    aircraftId: trace.aircraftId, scenario: trace.scenario,
    time60, time80,
    nosePitchAtFlickEnd: flick && nosePitch(flick),
    pathPitchAtFlickEnd: flick && pathPitch(flick),
    peakIncidenceFlick: Math.max(...flickSamples.map(s => observeAirflow(s.state, p).incidenceDeg)),
    heightLossFlick: flick && first.position.y - flick.position.y,
    speedLossFlickKph: flick && arcadeSpeed(new Vector3().copy(first.velocity).length()) - arcadeSpeed(new Vector3().copy(flick.velocity).length()),
    // Nose rotation during the neutral hold; the clip keeps the nose on the ground target here.
    holdNoseRotationDeg: flickEnd === null || recoverStart === null ? null : at(recoverStart)!.noseRotationDeg - at(flickEnd)!.noseRotationDeg,
    recoverStartSpeedKph: recover && arcadeSpeed(new Vector3().copy(recover.velocity).length()),
    recoverStartPathPitch: recover && pathPitch(recover),
    recoverStartIncidence: recover && observeAirflow(recover, p).incidenceDeg,
    rollSeconds: rollEnd === null || recoverStart === null ? null : rollEnd - recoverStart,
    recoverySeconds: recovered === null || recoverStart === null ? null : recovered - recoverStart,
    maxHeightLoss: first.position.y - Math.min(...samples.map(s => s.state.position.y)),
    speedAtRecoveryKph: recovered === null ? null : arcadeSpeed(new Vector3().copy(at(recovered)!.state.velocity).length()),
    // 0 = leaves along the entry direction (clip); 180 = reversed (split-S).
    exitHeadingDeg: recovered === null ? null : degrees(new Vector3(1, 0, 0).angleTo(new Vector3().copy(at(recovered)!.state.velocity).setY(0))),
    alive: samples.at(-1)!.state.alive,
  }
}

const round = (value: number | null | boolean | string) => typeof value === 'number' ? Number(value.toFixed(2)) : value

// it('reports the BF6-style inverted nose flick (report only)', () => {
//   const rows = ids.flatMap(id => speeds.flatMap(kph => recoveries.flatMap(recovery => (Object.keys(variants) as (keyof typeof variants)[])
//     .map(variant => noseFlickMetrics(noseFlickTrack(id, kph, variant, recovery))))))
//   mkdirSync('benchmarks/flight/out', { recursive: true })
//   writeFileSync('benchmarks/flight/out/nose-flick.json', JSON.stringify({ profileVersion: flightProfileVersion,
//     reference: { time80Seconds: 1.3, pathStaysNearLevel: true }, rows }, null, 2))
//   console.table(rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, round(value)]))))
// }, 60000)
