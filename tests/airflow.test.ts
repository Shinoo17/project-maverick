import { describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { aircraftIds, createAircraft, runScenario } from '../benchmarks/flight/harness'
import { angleOfAttack, observeAirflow } from '../src/game/flight/airflow'
import { interpretEnvelope } from '../src/game/flight/envelope'
import { getFlightProfile } from '../src/game/flight/profile'
import { flightInstrumentation } from '../src/game/flight/instrumentation'
import { stepFlight } from '../src/game/flight/stepFlight'
import { neutralCommand } from '../src/game/runtime/commands'
import { FLIGHT_STEP } from '../src/game/runtime/clock'
import { flightVaporConditions, vaporActivation } from '../src/render/vapor/conditions'

function freeze(value: object) {
  Object.freeze(value)
  for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child)
}

describe('shared airflow observation', () => {
  it.each([
    [100, 0, 0, 0, 0, 0, 1, 0],
    [100, -100, 0, 45, 0, 45, Math.SQRT1_2, 0],
    [100, 100, 0, -45, 0, 45, Math.SQRT1_2, 0],
    [0, 0, 100, 0, 90, 90, 0, 0],
    [0, 0, -100, 0, -90, 90, 0, 0],
    [-100, 0, 0, -180, 0, 180, 0, 1],
    [0, 0, 0, 0, 0, 0, 0, 0],
  ])('measures signed angles and flow shares at (%s, %s, %s)', (x, y, z, alpha, beta, incidence, forward, reverse) => {
    const state = createAircraft('f22')
    state.velocity = { x, y, z }
    const flow = observeAirflow(state, getFlightProfile('f22'))
    expect(flow.alphaDeg).toBeCloseTo(alpha, 12)
    expect(flow.betaDeg).toBeCloseTo(beta, 12)
    expect(flow.incidenceDeg).toBeCloseTo(incidence, 12)
    expect(flow.forwardFlow).toBeCloseTo(forward, 12)
    expect(flow.reverseFlow).toBeCloseTo(reverse, 12)
    expect(flow.alphaDeg).toBe(angleOfAttack(state))
  })

  it('preserves world-frame invariance and separates alpha from sideslip', () => {
    const state = createAircraft('su57'), profile = getFlightProfile('su57')
    state.velocity = { x: -80, y: -40, z: 30 }
    const original = observeAirflow(state, profile)
    const q = new Quaternion().setFromAxisAngle(new Vector3(1, 2, 3).normalize(), 2.1)
    state.orientation = { x: q.x, y: q.y, z: q.z, w: q.w }
    state.velocity = new Vector3().copy(state.velocity).applyQuaternion(q)
    const rotated = observeAirflow(state, profile)
    for (const key of ['airspeed', 'alphaDeg', 'betaDeg', 'incidenceDeg', 'forwardFlow', 'reverseFlow', 'dynamicPressure'] as const) {
      expect(rotated[key]).toBeCloseTo(original[key], 10)
    }
  })

  it('uses the pitch-plane cutoff for vapor at full sideslip speed, not just near rest', () => {
    const state = createAircraft('f22'), profile = getFlightProfile('f22')
    for (const [x, y] of [[0, 0], [0, -1e-14], [0, 1e-14], [-1e-14, 0], [1e-14, -1e-14]]) {
      state.velocity = { x, y, z: 100 }
      const flow = observeAirflow(state, profile)
      expect(flow.airspeed).toBe(100)
      expect(flow.confidence).toBe(1)
      expect(flow.alphaDeg).toBe(0)
      expect(flow.betaDeg).toBeCloseTo(90)
      expect(flightVaporConditions(state).aoa).toBe(0)
    }
    // Body-Y flow has a nonzero pitch-plane component and keeps its ±90° alpha.
    for (const y of [-100, 100]) {
      state.velocity = { x: 0, y, z: 0 }
      expect(flightVaporConditions(state).aoa).toBe(y < 0 ? 90 : -90)
    }
  })

  it('uses an unclamped per-aircraft pressure reference and smooth low-speed confidence', () => {
    const state = createAircraft('f22'), profile = structuredClone(getFlightProfile('f22'))
    profile.aero.referenceSpeedMps = 50
    for (const [speed, confidence] of [[0, 0], [2, 0], [6, 0.5], [10, 1], [100, 1]]) {
      state.velocity = { x: speed, y: 0, z: 0 }
      const flow = observeAirflow(state, profile)
      expect(flow.dynamicPressure).toBe((speed / 50) ** 2)
      expect(flow.confidence).toBe(confidence)
      expect(Object.values(flow).filter(value => typeof value === 'number').every(Number.isFinite)).toBe(true)
    }
  })

  it('retires the legacy near-rest conventions in versioned Phase 2 physics', () => {
    const state = createAircraft('f22'), profile = getFlightProfile('f22')
    for (const speed of [0, 0.0001, 0.001, 0.01, 0.0101]) {
      state.velocity = { x: -speed, y: 0, z: 0 }
      const flow = observeAirflow(state, profile)
      expect(flow.incidenceDeg).toBe(speed < 0.001 ? 0 : 180)
      expect(flow).not.toHaveProperty('legacy')
    }
    // Tail-slide residual flow used to produce a meaningless vapor AoA of 90°.
    state.velocity = { x: 0, y: -1e-16, z: 0 }
    const vapor = flightVaporConditions(state)
    expect(vapor.aoa).toBe(0)
    expect(vaporActivation(vapor)).toBe(0)
  })

  it('keeps physics start-of-step alpha distinct from end-of-step telemetry and FX', () => {
    const state = createAircraft('f22'), profile = getFlightProfile('f22')
    state.position.y = 2000
    state.velocity = { x: 85, y: -35, z: 20 }
    const start = observeAirflow(state, profile)
    stepFlight(state, { ...neutralCommand(0, state.id), pitch: 1, psmArm: true, speedAdjust: 1 }, FLIGHT_STEP)
    const end = observeAirflow(state, profile), telemetry = flightInstrumentation(state)
    expect(state.stall.aoaDeg).toBe(start.alphaDeg)
    expect(end.alphaDeg).not.toBe(start.alphaDeg)
    expect(telemetry.airflow).toEqual(end)
    expect(state.maneuver.alpha).toBe(end.incidenceDeg)
    const vapor = flightVaporConditions(state)
    expect(vapor.speed).toBe(end.airspeed)
    expect(vapor.aoa).toBe(end.alphaDeg)
    expect(vapor.sideslip).toBe(end.betaDeg * Math.PI / 180)
  })
})

describe('observe-only envelope', () => {
  it('keeps debug limiter permission independent of legacy path smoothing', () => {
    const state = createAircraft('f22'), profile = getFlightProfile('f22')
    state.velocity = { x: 0, y: -100, z: 0 }
    state.stall.severity = 0.4
    state.maneuver.blend = 0.6
    state.maneuver.highG = 0.5
    state.maneuver.phase = 'recovery'
    const flow = observeAirflow(state, profile)
    expect(interpretEnvelope(state, flow, profile)).toEqual({
      highAoa: 1, separation: 0.4, intent: 0, limiterOpen: 0,
      alphaLimitDeg: 20, gAllowance: 1.3, stabilityAssist: 0.4, recoveryAssist: 0.4,
    })
    state.velocity = { x: 0, y: 0, z: 0 }
    expect(interpretEnvelope(state, observeAirflow(state, profile), profile).highAoa).toBe(0)
    state.maneuver.phase = 'normal'
    expect(interpretEnvelope(state, flow, profile).recoveryAssist).toBe(0)
  })

  it('accepts frozen state/profile and leaves both unchanged', () => {
    const state = createAircraft('su57'), profile = structuredClone(getFlightProfile('su57'))
    const before = structuredClone({ state, profile })
    freeze(state); freeze(profile)
    const flow = observeAirflow(state, profile)
    freeze(flow)
    interpretEnvelope(state, flow, profile)
    flightInstrumentation(state)
    flightVaporConditions(state)
    expect({ state, profile }).toEqual(before)
  })

  it.each(aircraftIds)('%s observations at every substep leave the full flight trace unchanged', id => {
    const plain = runScenario('kulbitC', id)
    const observed = runScenario('kulbitC', id, state => {
      const profile = getFlightProfile(id), flow = observeAirflow(state, profile)
      interpretEnvelope(state, flow, profile)
      flightVaporConditions(state)
    })
    expect(observed).toEqual(plain)
  })
})
