import { describe, expect, it } from 'vitest'
import { Euler, Quaternion, Vector3 } from 'three'
import { flightInstrumentation } from '../src/game/flight/instrumentation'
import { getFlightProfile } from '../src/game/flight/profile'
import { stepSpeed } from '../src/game/flight/speed'
import { angleOfAttack } from '../src/game/flight/stall'
import { geometryCapacity, thrustForces } from '../src/game/flight/thrustVectoring'
import { neutralCommand } from '../src/game/runtime/commands'
import { FLIGHT_STEP } from '../src/game/runtime/clock'
import { stepFlight } from '../src/game/flight/stepFlight'
import { aircraftIds, createAircraft } from '../benchmarks/flight/harness'

function freeze(value: object) {
  Object.freeze(value)
  for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child)
}

describe('read-only end-of-step flight observations', () => {
  it.each([
    [100, 0, 0, 0, 0, 0], [100, -100, 0, 45, 0, 45],
    [100, 100, 0, -45, 0, 45], [50, 0, Math.sqrt(3) * 50, 0, 60, 60],
    [0, 0, 100, 0, 90, 90], [-100, 0, 0, -180, 0, 180], [0, 0, 0, 0, 0, 0],
  ])('observes body flow (%s, %s, %s)', (x, y, z, alpha, beta, incidence) => {
    const state = createAircraft('f22')
    state.velocity = { x, y, z }
    const observation = flightInstrumentation(state)
    expect(observation.alphaDeg).toBeCloseTo(alpha)
    expect(observation.alphaDeg).toBe(angleOfAttack(state))
    expect(observation.betaDeg).toBeCloseTo(beta)
    expect(observation.incidenceDeg).toBeCloseTo(incidence)
    expect(observation.dynamicPressureProxy).toBeCloseTo((Math.hypot(x, y, z) / 90) ** 2)
  })
  it('separates pitch incidence from sideslip in a rotated body frame', () => {
    const state = createAircraft('su57')
    const q = new Quaternion().setFromEuler(new Euler(.4, .8, -.3, 'XYZ'))
    state.orientation = { x: q.x, y: q.y, z: q.z, w: q.w }
    for (const z of [0, 80, -80]) {
      state.velocity = new Vector3(100, -100, z).applyQuaternion(q)
      expect(flightInstrumentation(state).alphaDeg).toBeCloseTo(45)
    }
  })
  it.each(aircraftIds)('%s reconstructs thrust returned by stepSpeed (including burner and speed overrides)', aircraftId => {
    for (const speed of [0, 45, 100, 300]) for (const afterburner of [false, true]) {
      const state = createAircraft(aircraftId)
      state.speedLimits.topSpeedMps = 310
      state.speedLimits.afterburnerTopSpeedMps = 400
      state.maneuver.burnerActive = afterburner
      const result = stepSpeed(state, { ...neutralCommand(0, state.id), speedAdjust: 1, afterburner }, 1 / 120, speed)
      expect(flightInstrumentation(state).actualThrust).toBeCloseTo(result.thrust, 12)
    }
  })
  it('can observe recursively frozen state without mutation', () => {
    const state = createAircraft('f22'), before = structuredClone(state)
    freeze(state)
    flightInstrumentation(state)
    expect(state).toEqual(before)
  })
})

describe('full-travel TVC capacity', () => {
  it.each([
    { aircraftId: 'f22', thrust: 27.5, noseUp: 1.45774, noseDown: 1.54376, tablePitch: 1.46 },
    { aircraftId: 'f22', thrust: 65, noseUp: 3.44557, noseDown: 3.64888, tablePitch: 3.45 },
    { aircraftId: 'su57', thrust: 27.5, noseUp: 1.30219, noseDown: 1.34722, tablePitch: 1.30 },
    { aircraftId: 'su57', thrust: 65, noseUp: 3.07790, noseDown: 3.18433, tablePitch: 3.08 },
  ])('$aircraftId at thrust $thrust matches independent signed pitch references', ({ aircraftId, thrust, noseUp, noseDown, tablePitch }) => {
    const p = getFlightProfile(aircraftId).thrustVectoring!
    // Independently reviewed 0.5° full-grid sweep, rounded to 5 decimal places.
    // The nose-UP column (not max absolute pitch) is the plan's §3 table.
    const up = thrustForces({ left: p.maxAngle, right: p.maxAngle, authority: 1 }, thrust, p).angularAcceleration.pitch
    const down = thrustForces({ left: -p.maxAngle, right: -p.maxAngle, authority: 1 }, thrust, p).angularAcceleration.pitch
    expect(up).toBeCloseTo(noseUp, 5)
    expect(down).toBeCloseTo(-noseDown, 5)
    expect(up).toBeCloseTo(tablePitch, 2)
    expect(geometryCapacity(p, thrust).pitch).toBeCloseTo(noseDown, 5)
    expect(Math.abs(down)).toBeGreaterThan(up)
  })
  it.each(aircraftIds)('%s takes geometry extrema at both travel signs, independent of mixer gains', aircraftId => {
    const profile = getFlightProfile(aircraftId).thrustVectoring!
    const before = structuredClone(profile)
    for (const thrust of [3.5, 27.5, 65]) {
      const a = profile.maxAngle
      const forces = (left: number, right: number) => thrustForces({ left, right, authority: 1 }, thrust, profile).angularAcceleration
      const capacity = geometryCapacity(profile, thrust)
      expect(capacity.pitch).toBe(Math.max(Math.abs(forces(a, a).pitch), Math.abs(forces(-a, -a).pitch)))
      expect(capacity.yaw).toBe(Math.max(Math.abs(forces(a, -a).yaw), Math.abs(forces(-a, a).yaw)))
      expect(capacity.roll).toBe(Math.max(Math.abs(forces(a, -a).roll), Math.abs(forces(-a, a).roll)))
      expect(geometryCapacity({ ...profile, rollGain: 0, yawGain: 0 }, thrust)).toEqual(capacity)
      // Absolute maximum includes the height × axial-thrust term with the
      // nose-DOWN sign. §3 uses nose-up; signed references above distinguish them.
      const angle = a * Math.PI / 180, cant = profile.cantDeg * Math.PI / 180
      expect(capacity.pitch).toBeCloseTo(thrust * (Math.abs(profile.pivotX * Math.sin(angle) * Math.cos(cant)) + Math.abs(profile.height * (1 - Math.cos(angle)))) / profile.inertia.pitch, 12)
    }
    expect(profile).toEqual(before)
  })
  it('reports zero without TVC or positive thrust and scales linearly', () => {
    const profile = getFlightProfile('su57').thrustVectoring
    expect(geometryCapacity(null, 65)).toEqual({ pitch: 0, yaw: 0, roll: 0 })
    for (const thrust of [0, -1]) expect(geometryCapacity(profile, thrust)).toEqual({ pitch: 0, yaw: 0, roll: 0 })
    const unit = geometryCapacity(profile, 1), ten = geometryCapacity(profile, 10)
    for (const axis of ['pitch', 'yaw', 'roll'] as const) expect(ten[axis]).toBeCloseTo(unit[axis] * 10, 12)
  })
})

describe.each([...aircraftIds, 'f22-notvc'])('%s allocation ledger', aircraftId => {
  it('observes exactly the integrated shares, actual torque and engine output without recomputing allocation', () => {
    const state = createAircraft(aircraftId)
    state.velocity.x = 20
    for (let step = 0; step < 240; step++) {
      stepFlight(state, { ...neutralCommand(step, state.id), pitch: 1, yaw: 0.5, psmArm: true, afterburner: true }, FLIGHT_STEP)
      const before = structuredClone(state), observation = flightInstrumentation(state)
      expect(state).toEqual(before)
      expect(observation.lastStep).toEqual(state.flightForces)
      expect(observation.actualThrust).toBe(state.engine.actualThrust)
      const ledger = observation.lastStep!
      for (const axis of ['pitch', 'yaw', 'roll'] as const) {
        expect(ledger.ratesAfter[axis]).toBeCloseTo(ledger.ratesBefore[axis] + FLIGHT_STEP * (ledger.controller[axis] + ledger.tvc[axis] + ledger.naturalRestoring[axis] + ledger.naturalDeparture[axis] + ledger.naturalDamping[axis]), 12)
      }
    }
  })
})
