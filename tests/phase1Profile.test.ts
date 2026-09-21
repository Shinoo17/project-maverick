import { observeAirflow } from '../src/game/flight/airflow'
import { describe, expect, it } from 'vitest'
import { createAircraft } from '../benchmarks/flight/harness'
import { getFlightProfile, validateFlightProfile } from '../src/game/flight/profile'
import { stepManeuvers } from '../src/game/flight/maneuvers'
import { stepSpeed } from '../src/game/flight/speed'
import { stepFlight } from '../src/game/flight/stepFlight'
import { flightInstrumentation } from '../src/game/flight/instrumentation'
import { neutralCommand } from '../src/game/runtime/commands'
import { FLIGHT_STEP } from '../src/game/runtime/clock'
import { Quaternion, Vector3 } from 'three'

describe('Phase 1 profile constants', () => {
  it.each([0, -1, NaN, Infinity, undefined])('rejects unusable TVC gain %s; null is the explicit no-TVC contract', value => {
    const profile = structuredClone(getFlightProfile('f22'))
    Object.assign(profile.thrustVectoring!, { gain: value })
    expect(() => validateFlightProfile(profile, 'plane')).toThrow('plane.thrustVectoring.gain')
    profile.thrustVectoring = null
    expect(() => validateFlightProfile(profile, 'plane')).not.toThrow()
  })

  it('requires finite nonnegative minimum rate requests on every axis', () => {
    for (const axis of ['pitch', 'yaw', 'roll']) for (const value of [-1, NaN, Infinity, undefined]) {
      const profile = structuredClone(getFlightProfile('f22'))
      Object.assign(profile.flight.minRateTarget, { [axis]: value })
      expect(() => validateFlightProfile(profile, 'plane')).toThrow(`plane.flight.minRateTarget.${axis}`)
    }
  })
  const fields = {
    aero: ['referenceSpeedMps', 'highSpeedMps', 'alphaNormalDeg', 'alphaCriticalDeg'],
    flight: ['afterburnerAcceleration', 'airbrakeDeceleration'],
    maneuver: ['lateralAcceleration', 'recoveryIncidenceRad', 'recoverySpeedMps',
      'highGMinSpeedMps', 'highGMaxSpeedMps', 'highGSpeedFadeMps'],
  } as const
  for (const group of ['aero', 'flight', 'maneuver'] as const) {
    it.each(fields[group])(`rejects missing, negative and nonfinite ${group}.%s`, key => {
      for (const value of [undefined, -1, NaN, Infinity]) {
        const profile = structuredClone(getFlightProfile('f22'))
        Object.assign(profile[group], { [key]: value })
        expect(() => validateFlightProfile(profile, 'plane')).toThrow(`plane.${group}.${key}`)
      }
    })
  }
  it.each([
    ['aero', 'referenceSpeedMps', 0], ['aero', 'highSpeedMps', 89],
    ['aero', 'alphaNormalDeg', 181], ['aero', 'alphaCriticalDeg', 181],
    ['aero', 'alphaCriticalDeg', 20], ['aero', 'alphaCriticalDeg', 19],
    ['maneuver', 'highGSpeedFadeMps', 0], ['maneuver', 'highGMaxSpeedMps', 75],
    ['maneuver', 'recoveryIncidenceRad', Math.PI + 0.01],
  ] as const)('rejects invalid ranges: %s.%s', (group, key, value) => {
    const profile = structuredClone(getFlightProfile('f22'))
    Object.assign(profile[group], { [key]: value })
    expect(() => validateFlightProfile(profile, 'plane')).toThrow(`plane.${group}.${key}`)
  })

  it('uses authored q reference for physical surface budgets with no shared tuning mutation', () => {
    const profile = getFlightProfile('f22'), original = profile.aero
    const other = structuredClone(getFlightProfile('su57').aero)
    profile.aero = { ...original, referenceSpeedMps: 120, highSpeedMps: 180 }
    try {
      const state = createAircraft('f22'); state.velocity.x = 60
      const observation = flightInstrumentation(state)
      expect(observation.budget.physicalAero.roll).toBeCloseTo(profile.aero.controlAcceleration.roll * (60 / 120) ** 2)
      expect(getFlightProfile('su57').aero).toEqual(other)
    } finally { profile.aero = original }
  })

  it('uses authored burner acceleration and brake deceleration in the existing speed solver', () => {
    const profile = getFlightProfile('f22'), original = profile.flight
    profile.flight = { ...original, afterburnerAcceleration: 12, airbrakeDeceleration: 18 }
    try {
      const state = createAircraft('f22')
      state.maneuver.burnerActive = true
      state.maneuver.airbrake = 1
      const force = stepSpeed(state, { ...neutralCommand(0, state.id), afterburner: true }, FLIGHT_STEP, 100)
      expect(state.engine.requestedPower * 50).toBe(original.drag * 100 * 100 + 12)
      expect(force.thrust).toBe(state.engine.actualThrust)
      expect(force.braking).toBe(18)
    } finally { profile.flight = original }
  })

  it('uses authored High-G speed bounds and fade width without changing its time response', () => {
    const profile = getFlightProfile('f22'), original = profile.maneuver
    profile.maneuver = { ...original, highGMinSpeedMps: 100, highGMaxSpeedMps: 200, highGSpeedFadeMps: 20 }
    try {
      for (const [speed, target] of [[90, 0], [110, 0.5], [150, 1], [190, 0.5], [210, 0]]) {
        const state = createAircraft('f22')
        state.velocity.x = speed
        stepManeuvers(state, { ...neutralCommand(0, state.id), pitch: 1, highG: true }, FLIGHT_STEP, observeAirflow(state, profile))
        expect(state.maneuver.highG).toBe(target * (1 - Math.exp(-6 * FLIGHT_STEP)))
      }
    } finally { profile.maneuver = original }
  })

  it('reads the exact recovery angle and speed thresholds from the aircraft profile', () => {
    const profile = getFlightProfile('f22'), original = profile.maneuver
    expect(original.recoveryIncidenceRad).toBe(0.3)
    profile.maneuver = { ...original, recoveryIncidenceRad: 0.2, recoverySpeedMps: 80 }
    try {
      for (const [angle, speed, stable] of [[0.1, 90, true], [0.25, 90, false], [0.1, 70, false]] as const) {
        const state = createAircraft('f22')
        state.velocity.x = speed
        const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), angle)
        state.orientation = { x: q.x, y: q.y, z: q.z, w: q.w }
        state.maneuver.phase = 'recovery'
        stepManeuvers(state, neutralCommand(0, state.id), FLIGHT_STEP, observeAirflow(state, profile))
        expect(state.maneuver.stable).toBe(stable ? FLIGHT_STEP : 0)
      }
    } finally { profile.maneuver = original }
  })

  it.each(['lateralAcceleration'] as const)('reads legacy %s from the aircraft profile', key => {
    const profile = getFlightProfile('f22'), original = profile.maneuver
    const state = createAircraft('f22')
    state.position.y = 2000
    state.velocity = { x: 85, y: 0, z: 0 }
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 3)
    state.orientation = { x: q.x, y: q.y, z: q.z, w: q.w }
    state.maneuver.phase = 'active'
    state.maneuver.blend = 1
    // Observe this legacy arcade term while assistance is still present.
    state.pathAssistWeight = 1
    const reference = structuredClone(state)
    const command = { ...neutralCommand(0, state.id), psmArm: true, pitch: 1, speedAdjust: 1 }
    stepFlight(reference, command, FLIGHT_STEP)
    profile.maneuver = { ...original, [key]: 0 }
    try {
      stepFlight(state, command, FLIGHT_STEP)
      expect(state.velocity).not.toEqual(reference.velocity)
      expect(state.maneuver.drag).toBe(reference.maneuver.drag)
    } finally { profile.maneuver = original }
  })
})
