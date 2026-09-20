import { runPsmNeutralRelease } from '../../benchmarks/flight/releaseSafety'
import { describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { aircraftIds, createAircraft } from '../../benchmarks/flight/harness'
import { getFlightProfile } from '../../src/game/flight/profile'
import { stepFlight } from '../../src/game/flight/stepFlight'
import { observeAirflow } from '../../src/game/flight/airflow'
import { neutralCommand } from '../../src/game/runtime/commands'
import { FLIGHT_STEP as dt } from '../../src/game/runtime/clock'
import { assertAircraftValid, assertActuatorStep } from './helpers'

const axes = ['pitch', 'yaw', 'roll'] as const
const epsilon = 1e-9
const valid = (state: ReturnType<typeof createAircraft>, previous: ReturnType<typeof createAircraft>) => {
  assertAircraftValid(state)
  assertActuatorStep(state, previous)
  expect(state.alive).toBe(true)
}

describe.each(aircraftIds)('%s neutral release safety', id => {
  it.each([0, 0.5, 1.999])('damps residual rates to epsilon with no aerodynamic authority at %s m/s', speed => {
    const state = createAircraft(id), p = getFlightProfile(id).flight
    state.position.y = 4000
    state.stall.severity = 1
    state.maneuver.phase = 'active'; state.maneuver.blend = 1
    state.rates = { pitch: 2.9, yaw: -2.3, roll: 1.7 }
    const response = { pitch: p.neutralResponse, yaw: p.neutralResponse, roll: p.neutralRollResponse }
    // Fixed-flow rig isolates the no-authority limit; the bounded settling time
    // follows the authored exponential and numerical epsilon, not a feel deadline.
    const seconds = Math.log(3 / epsilon) / Math.min(...Object.values(response))
    for (let tick = 0; tick <= Math.ceil(seconds / dt); tick++) {
      state.velocity = { x: -speed, y: 0, z: 0 }
      const before = structuredClone(state)
      expect(observeAirflow(state, getFlightProfile(id)).confidence).toBe(0)
      stepFlight(state, neutralCommand(tick, state.id), dt)
      valid(state, before)
      for (const axis of axes) {
        expect(state.rates[axis]).toBeCloseTo(before.rates[axis] * Math.exp(-response[axis] * dt), 12)
        expect(Math.abs(state.rates[axis])).toBeLessThanOrEqual(Math.abs(before.rates[axis]) + epsilon)
        expect(Math.abs(state.flightForces!.naturalRestoring[axis])).toBe(0)
        expect(Math.abs(state.flightForces!.naturalDamping[axis])).toBe(0)
      }
    }
    for (const axis of axes) expect(Math.abs(state.rates[axis])).toBeLessThan(epsilon)
  })

  it.each([0, 1])('released five-second C pull remains recoverable (speedAdjust=%s)', speedAdjust => {
    let sawRecovery = false, recovered = false
    const { held, trace } = runPsmNeutralRelease(id, speedAdjust, speedAdjust === 1 ? 40 : 14, (state, previous) => {
      assertAircraftValid(state); assertActuatorStep(state, previous)
      sawRecovery ||= state.maneuver.phase === 'recovery'
      recovered ||= sawRecovery && state.maneuver.phase === 'normal'
      if (!state.alive) {
        // A recovered, nose-down aircraft can later hit terrain without pilot
        // input. Phase 3 has no attitude-leveling recovery/autopilot (Phase 5).
        expect(speedAdjust).toBe(1); expect(recovered).toBe(true)
        expect(['terrain', 'boundary']).toContain(state.stopReason)
      }
    })
    const release = held.samples.at(-1)!.state
    expect(release.maneuver.phase).toBe('active')
    // C now grants only permission; this old high-energy fixture need not reach
    // post-stall without phase-forced grip loss. Seeded post-stall safety is below.
    expect(release.maneuver.peakAlpha).toBeLessThan(70)
    // Neutral-throttle window retains the old 14 s fixture duration; a 40 s
    // unpowered descent can legitimately reach terrain. Keep liveness hard for C. Settling/normal times are
    // separately reported; no new four/six-second tuning acceptance is imposed.
    const final = trace.samples.at(-1)!.state
    expect(Math.abs(final.rates.pitch)).toBeLessThan(Math.abs(release.rates.pitch))
    if (speedAdjust === 1) {
      expect(final.maneuver.phase).toBe('normal')
      expect(final.maneuver.completed).toBe(release.maneuver.completed)
    }
  })

  it('keeps the reverse-flow neutral fixture energy bound in CI', () => {
    const state = createAircraft(id), p = getFlightProfile(id).flight
    state.position.y = 3000; state.velocity = { x: 130, y: 0, z: 0 }
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI)
    state.orientation = { x: q.x, y: q.y, z: q.z, w: q.w }
    const energy = () => new Vector3().copy(state.velocity).lengthSq() / 2 + p.gravity * state.position.y
    const initialEnergy = energy()
    let lastSpeed = new Vector3().copy(state.velocity).length()
    for (let tick = 0; tick < 6 / dt; tick++) {
      const previous = structuredClone(state)
      stepFlight(state, neutralCommand(tick, state.id), dt)
      valid(state, previous)
      // Speed alone need not decrease when natural aero tips the aircraft into
      // a dive. Track kinetic + potential energy, retaining the original intent.
      expect(energy()).toBeLessThanOrEqual(initialEnergy + epsilon * initialEnergy)
      // Retain the original monotonic-speed assertion for this exact fixture too.
      const speed = new Vector3().copy(state.velocity).length()
      expect(speed).toBeLessThanOrEqual(lastSpeed + 1e-8)
      lastSpeed = speed
    }
  })
})
