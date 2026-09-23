import { describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { driftIds, driftMetrics, driftSpawn } from '../benchmarks/flight/jetDrift'
import { createAircraft, runScenario, runTrack, type Controller } from '../benchmarks/flight/harness'
import { naturalObservationWindowSeconds } from '../benchmarks/flight/targets'
import { observeAirflow } from '../src/game/flight/airflow'
import { getFlightProfile, validateFlightProfile } from '../src/game/flight/profile'
import { signedBudget } from '../src/game/flight/authority'
import type { AircraftState } from '../src/game/state/WorldState'

const axes = ['pitch', 'yaw', 'roll'] as const
const epsilon = 1e-9
const entry = (id: string) => runTrack(driftSpawn(id), 1.2, () => ({ pitch: 1, airbrake: true })).samples.at(-1)!.state

/** Runs with recovery switched off by an unreachable delay; the profile is restored. */
function withoutRecovery<T>(id: string, run: () => T) {
  const recovery = getFlightProfile(id).recovery, original = recovery.delaySeconds
  recovery.delaySeconds = 1e9
  try { return run() } finally { recovery.delaySeconds = original }
}
/** Falling straight down at `speed`, nose pitched to the requested pitch-plane alpha, released. */
function reverseFlowSeed(id: string, alphaDeg: number, speed: number) {
  const state = createAircraft(id)
  state.position.y = 3000; state.velocity = { x: 0, y: -speed, z: 0 }; state.enginePower = 0
  state.intent.releaseSeconds = 10
  // Body +X is rotated about world Z; alpha = atan2(-body.y, body.x) of a downward velocity.
  const pitch = (alphaDeg - 90) * Math.PI / 180
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), pitch)
  state.orientation = { x: q.x, y: q.y, z: q.z, w: q.w }
  return state
}
const peakIncidence = (id: string, state: AircraftState, controller: Controller = () => ({})) =>
  Math.max(...runTrack(state, 4, controller).samples.map(s => observeAirflow(s.state, getFlightProfile(id)).incidenceDeg))

describe.each(driftIds)('%s Phase 5 recovery assist', id => {
  it('I20: any angular input zeroes assistance on the same step; brief handoff gaps never start it', () => {
    const tracks = [
      // Handoff with 0.1 s neutral gaps, then a 0.15 s release-reapply gap, then genuine release.
      runTrack(driftSpawn(id), 6, (_s, t) => ({ airbrake: t < 3.6, pitch: t < 1 ? 1 : t >= 2.8 && t < 3.6 ? 0.5 : 0,
        yaw: t >= 1.1 && t < 1.9 ? 0.5 : 0, roll: t >= 2 && t < 2.7 ? 0.7 : 0 })),
      runTrack(driftSpawn(id), 4, (_s, t) => ({ pitch: t < 1 ? 1 : t >= 1.15 && t < 2 ? -0.5 : 0, airbrake: t < 1 })),
      // Reapply after assistance is fully active.
      runTrack(entry(id), 3, (_s, t) => ({ pitch: t >= 1.5 ? 0.5 : 0, airbrake: true })),
    ]
    const delay = getFlightProfile(id).recovery.delaySeconds
    let sawAssist = false
    for (const trace of tracks) for (const sample of trace.samples.slice(1)) {
      const { intent, flightForces } = sample.state
      const assist = flightForces!.envelope.recoveryAssist
      if (intent.activity > 0 || intent.releaseSeconds <= delay) expect(assist).toBe(0)
      sawAssist ||= assist === 1
    }
    expect(sawAssist).toBe(true)
    // The 0.1 s and 0.15 s gaps stay inside the delay.
    for (const trace of tracks.slice(0, 2)) {
      const last = trace.commands.filter(run => run.command.pitch || run.command.yaw || run.command.roll).at(-1)!
      const end = last.startStep + last.steps
      expect(trace.samples.slice(1, end + 1).map(s => s.state.flightForces!.envelope.recoveryAssist)).toEqual(Array(end).fill(0))
    }
  })

  it('I15: recovery damping is dissipative and its drive stays inside the allocated budget', () => {
    const exhausted = entry(id); exhausted.maneuver.burner = 0; exhausted.maneuver.burnerLocked = true
    for (const [state, afterburner] of [[entry(id), false], [entry(id), true], [exhausted, true]] as const) {
      const trace = runTrack(state, 4, () => ({ afterburner }))
      for (const sample of trace.samples.slice(1)) {
        const f = sample.state.flightForces!, selected = signedBudget(f.budget, f.allocation.request)
        for (const axis of axes) {
          expect(f.stabilityDamping[axis] * f.ratesBefore[axis]).toBeLessThanOrEqual(0)
          expect(Math.abs(f.stabilityDamping[axis] * f.dt)).toBeLessThanOrEqual(Math.abs(f.ratesBefore[axis]) + epsilon)
          expect(Math.abs(f.allocation.aero[axis])).toBeLessThanOrEqual(selected.physicalAero[axis] + epsilon)
          expect(Math.abs(f.allocation.tvc[axis])).toBeLessThanOrEqual(selected.tvc[axis] + epsilon)
          if (getFlightProfile(id).thrustVectoring === null) expect(f.allocation.tvc[axis]).toBe(0)
          // An engaged afterburner flies the nose: recovery only damps, it requests no correction.
          if (sample.state.maneuver.burnerActive) expect(Math.abs(f.allocation.request[axis])).toBe(0)
        }
      }
    }
  })

  it('recovery corrects with real authority only: the arcade floor never serves it', () => {
    // Near rest, aero is tiny and the floor would otherwise supply most of the correction.
    const seeded = reverseFlowSeed(id, 90, 10)
    for (const state of [seeded, entry(id)]) {
      state.intent.releaseSeconds = 10
      let corrected = false
      for (const sample of runTrack(state, 2, () => ({})).samples.slice(1)) {
        const f = sample.state.flightForces!
        for (const axis of axes) if (f.recoveryRequest[axis] !== 0) {
          corrected = true
          expect(Math.abs(f.allocation.floor[axis])).toBe(0)
        }
      }
      expect(corrected).toBe(true)
    }
  })

  it.each([-170, -150, -140, -120, 120, 140, 150, 170])('reverse flow at alpha %s°: recovery steers with the natural moment and settles whenever natural response does', alpha => {
    for (const speed of [20, 60, 100]) {
      const state = reverseFlowSeed(id, alpha, speed)
      expect(observeAirflow(state, getFlightProfile(id)).alphaDeg).toBeCloseTo(alpha, 6)
      const trace = runTrack(state, 6, () => ({}))
      for (const sample of trace.samples.slice(1)) {
        const f = sample.state.flightForces!
        for (const axis of ['pitch', 'yaw'] as const) {
          expect(f.recoveryRequest[axis] * (f.naturalRestoring[axis] + f.naturalDeparture[axis])).toBeGreaterThanOrEqual(0)
        }
      }
      const natural = withoutRecovery(id, () => driftMetrics(runTrack(state, 6, () => ({})))).settledBelow30
      if (natural !== null) expect(driftMetrics(trace).settledBelow30).not.toBeNull()
    }
  })

  it('attached flight is unchanged; natural response owns the delay window', () => {
    const tracks: [number, Controller][] = [[500, () => ({})], [500, () => ({ pitch: 0.15, yaw: 0.1 })], [500, () => ({ roll: 0.7 })], [900, () => ({ pitch: 1 })]]
    for (const [kph, controller] of tracks) {
      const final = (trace: ReturnType<typeof runTrack>) => { const { flightForces: _, ...state } = trace.samples.at(-1)!.state; return state }
      expect(final(runTrack(driftSpawn(id, kph), 4, controller))).toEqual(withoutRecovery(id, () => final(runTrack(driftSpawn(id, kph), 4, controller))))
    }
    expect(naturalObservationWindowSeconds).toBeLessThanOrEqual(getFlightProfile(id).recovery.delaySeconds)
    const release = runScenario('release45', id).samples, steps = Math.floor(getFlightProfile(id).recovery.delaySeconds * 120)
    expect(withoutRecovery(id, () => runScenario('release45', id).samples.slice(0, steps))).toEqual(release.slice(0, steps))
  })

  it('neutral release overshoots less than natural response alone, also with a dead afterburner key', () => {
    const state = entry(id), exhausted = entry(id)
    exhausted.maneuver.burner = 0; exhausted.maneuver.burnerLocked = true
    expect(peakIncidence(id, state)).toBeLessThan(withoutRecovery(id, () => peakIncidence(id, state)))
    const held = () => ({ afterburner: true })
    expect(peakIncidence(id, exhausted, held)).toBeLessThan(withoutRecovery(id, () => peakIncidence(id, exhausted, held)))
  })
})

it('validation keeps the recovery delay outside the handoff window', () => {
  const bad = structuredClone(getFlightProfile('f22'))
  bad.recovery.delaySeconds = bad.breakout.handoffSeconds / 2
  expect(() => validateFlightProfile(bad)).toThrow('recovery.delaySeconds')
  for (const key of ['rampSeconds', 'response', 'noseRate'] as const) {
    const invalid = structuredClone(getFlightProfile('f22'))
    invalid.recovery[key] = -1
    expect(() => validateFlightProfile(invalid)).toThrow(`recovery.${key}`)
  }
})
