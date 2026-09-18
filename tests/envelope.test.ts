import { describe, expect, it } from 'vitest'
import { aircraftIds, createAircraft, runScenario } from '../benchmarks/flight/harness'
import { aeroDefaults } from '../src/content/flight-profiles/defaults'
import { observeAirflow } from '../src/game/flight/airflow'
import { interpretEnvelope } from '../src/game/flight/envelope'
import { getFlightProfile, validateFlightProfile } from '../src/game/flight/profile'
import { stepStall } from '../src/game/flight/stall'
import { FLIGHT_STEP } from '../src/game/runtime/clock'

describe('independent incidence envelope', () => {
  it('uses the authored aero band for pure sideslip while stall still reads pitch alpha', () => {
    const state = createAircraft('f22'), profile = structuredClone(getFlightProfile('f22'))
    profile.aero.alphaNormalDeg = 60
    profile.aero.alphaCriticalDeg = 120
    state.velocity = { x: 0, y: 0, z: 100 }
    const airflow = observeAirflow(state, profile)
    stepStall(state, profile.stall, airflow.airspeed, FLIGHT_STEP, airflow)
    const envelope = interpretEnvelope(state, airflow, profile)
    expect(airflow.alphaDeg).toBe(0)
    expect(airflow.incidenceDeg).toBe(90)
    expect(state.stall.cause).toBe('none')
    expect(state.stall.severity).toBe(0)
    expect(envelope.highAoa).toBe(0.5)
    expect(envelope.alphaLimitDeg).toBe(60)

    // Changing stall thresholds alone cannot retune any envelope threshold.
    profile.stall.recoveryAoaDeg = 5
    profile.stall.criticalAoaDeg = 10
    expect(interpretEnvelope(state, airflow, profile)).toEqual(envelope)
  })

  it('observes the independent band boundaries and low-speed confidence', () => {
    const state = createAircraft('su57'), profile = structuredClone(getFlightProfile('su57'))
    profile.aero.alphaNormalDeg = 40
    profile.aero.alphaCriticalDeg = 80
    for (const [incidence, expected] of [[0, 0], [40, 0], [60, 0.5], [80, 1], [180, 1]]) {
      const angle = incidence * Math.PI / 180
      state.velocity = { x: 100 * Math.cos(angle), y: 0, z: 100 * Math.sin(angle) }
      expect(interpretEnvelope(state, observeAirflow(state, profile), profile).highAoa).toBeCloseTo(expected, 12)
    }
    state.velocity = { x: 0, y: 0, z: 1 }
    expect(interpretEnvelope(state, observeAirflow(state, profile), profile).highAoa).toBe(0)
  })

  it('accepts the full incidence domain without tying it to stall', () => {
    const profile = structuredClone(getFlightProfile('f22'))
    profile.aero.alphaNormalDeg = 0
    profile.aero.alphaCriticalDeg = 180
    expect(() => validateFlightProfile(profile)).not.toThrow()
  })

  it.each(aircraftIds)('%s tuning affects its envelope only, not flight physics or other profiles', id => {
    const profile = getFlightProfile(id), original = { ...profile.aero }
    const other = getFlightProfile(id === 'f22' ? 'su57' : 'f22')
    const otherBefore = structuredClone(other), defaultsBefore = { ...aeroDefaults }
    const baseline = runScenario('cobraC', id)
    const state = createAircraft(id)
    state.velocity = { x: 0, y: 0, z: 100 }
    const before = interpretEnvelope(state, observeAirflow(state, profile), profile)
    try {
      profile.aero.alphaNormalDeg = 60
      profile.aero.alphaCriticalDeg = 120
      const tuned = interpretEnvelope(state, observeAirflow(state, profile), profile)
      expect(tuned.highAoa).not.toBe(before.highAoa)
      expect(tuned.alphaLimitDeg).not.toBe(before.alphaLimitDeg)
      expect(runScenario('cobraC', id)).toEqual(baseline)
      expect(other).toEqual(otherBefore)
      expect(aeroDefaults).toEqual(defaultsBefore)
    } finally { Object.assign(profile.aero, original) }
  })
})
