import { describe, expect, it } from 'vitest'
import { Euler, Quaternion, Vector3 } from 'three'
import { flightInstrumentation } from '../src/game/flight/instrumentation'
import { getFlightProfile } from '../src/game/flight/profile'
import { stepSpeed } from '../src/game/flight/speed'
import { angleOfAttack } from '../src/game/flight/stall'
import { tvcCapacity, thrustForces } from '../src/game/flight/thrustVectoring'
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
  it.each(aircraftIds)('%s splits the exact legacy rate ceiling into aero/floor/powered shares', aircraftId => {
    const state = createAircraft(aircraftId)
    const p = getFlightProfile(aircraftId)
    for (const speed of [0, 5, 10.8, 45, 90, 150, 300]) {
      state.velocity = { x: speed, y: 0, z: 0 }
      state.stall.severity = .4
      state.maneuver.blend = .6
      state.maneuver.controlAuthority = .7
      const { legacy } = flightInstrumentation(state)
      const authority = Math.max(.12, Math.min(speed / 90, 1)) * Math.max(.6, Math.min(160 / Math.max(speed, 1), 1))
      for (const axis of ['pitch', 'yaw', 'roll'] as const) {
        expect(legacy.aeroRate[axis] + legacy.floorRate[axis]).toBeCloseTo(p.flight[`${axis}Rate`] * authority * legacy.surfaceControl * (1 - legacy.poweredBlend), 12)
        expect(legacy.poweredRate[axis]).toBeCloseTo(p.maneuver[`${axis}Rate`] * .6 * .7, 12)
      }
      // Spec 0.7's "floor > 0 at 45" conflicts with runtime's 0.12 floor.
      expect(legacy.floorRate.pitch > 0).toBe(speed < 10.8)
    }
    state.maneuver.blend = 0
    expect(flightInstrumentation(state).legacy.poweredRate).toEqual({ pitch: 0, yaw: 0, roll: 0 })
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
    expect(tvcCapacity(p, thrust).pitch).toBeCloseTo(noseDown, 5)
    expect(Math.abs(down)).toBeGreaterThan(up)
  })
  it.each(aircraftIds)('%s takes geometry extrema at both travel signs, independent of mixer gains', aircraftId => {
    const profile = getFlightProfile(aircraftId).thrustVectoring!
    const before = structuredClone(profile)
    for (const thrust of [3.5, 27.5, 65]) {
      const a = profile.maxAngle
      const forces = (left: number, right: number) => thrustForces({ left, right, authority: 1 }, thrust, profile).angularAcceleration
      const capacity = tvcCapacity(profile, thrust)
      expect(capacity.pitch).toBe(Math.max(Math.abs(forces(a, a).pitch), Math.abs(forces(-a, -a).pitch)))
      expect(capacity.yaw).toBe(Math.max(Math.abs(forces(a, -a).yaw), Math.abs(forces(-a, a).yaw)))
      expect(capacity.roll).toBe(Math.max(Math.abs(forces(a, -a).roll), Math.abs(forces(-a, a).roll)))
      expect(tvcCapacity({ ...profile, rollGain: 0, yawGain: 0 }, thrust)).toEqual(capacity)
      // Absolute maximum includes the height × axial-thrust term with the
      // nose-DOWN sign. §3 uses nose-up; signed references above distinguish them.
      const angle = a * Math.PI / 180, cant = profile.cantDeg * Math.PI / 180
      expect(capacity.pitch).toBeCloseTo(thrust * (Math.abs(profile.pivotX * Math.sin(angle) * Math.cos(cant)) + Math.abs(profile.height * (1 - Math.cos(angle)))) / profile.inertia.pitch, 12)
    }
    expect(profile).toEqual(before)
  })
  it('reports zero without TVC or positive thrust and scales linearly', () => {
    const profile = getFlightProfile('su57').thrustVectoring
    expect(tvcCapacity(null, 65)).toEqual({ pitch: 0, yaw: 0, roll: 0 })
    for (const thrust of [0, -1]) expect(tvcCapacity(profile, thrust)).toEqual({ pitch: 0, yaw: 0, roll: 0 })
    const unit = tvcCapacity(profile, 1), ten = tvcCapacity(profile, 10)
    for (const axis of ['pitch', 'yaw', 'roll'] as const) expect(ten[axis]).toBeCloseTo(unit[axis] * 10, 12)
  })
})

describe.each(aircraftIds)('%s legacy overlay versus the actual flight controller', aircraftId => {
  it.each([
    { speed: 0, powered: false, speedAdjust: 0, axes: ['pitch', 'yaw', 'roll'] as const },
    { speed: 70, powered: false, speedAdjust: 0, axes: ['pitch', 'yaw', 'roll'] as const },
    { speed: 120, powered: false, speedAdjust: 0, axes: ['pitch', 'yaw', 'roll'] as const },
    { speed: 200, powered: false, speedAdjust: 0, axes: ['yaw', 'roll'] as const },
    { speed: 300, powered: false, speedAdjust: 0, axes: ['roll'] as const },
    { speed: 70, powered: true, speedAdjust: 0, axes: ['pitch', 'yaw', 'roll'] as const },
    { speed: 70, powered: true, speedAdjust: 1, axes: ['pitch', 'yaw', 'roll'] as const },
  ])('converges to the overlay at $speed m/s, PSM=$powered, W=$speedAdjust', ({ speed, powered, speedAdjust, axes }) => {
    const profile = getFlightProfile(aircraftId)
    const tolerance = 1e-9
    // Two numerical settling windows for the slowest controller/actuator/input
    // response. This is a convergence tolerance, not a maneuver-time target.
    const response = Math.min(profile.flight.rateResponse, profile.flight.driveResponse,
      profile.thrustVectoring!.actuatorResponse, profile.thrustVectoring!.authorityResponse)
    const steps = Math.ceil(2 * Math.log(1 / tolerance) / (response * FLIGHT_STEP))
    for (const axis of axes) {
      const state = createAircraft(aircraftId)
      const command = { ...neutralCommand(0, state.id), [axis]: 1, psmArm: powered, speedAdjust }
      state.stall.severity = speed === 0 ? 1 : 0
      // Test-only fixed-flow rig: hold pose/velocity/position at the solver entry,
      // but evolve rates, engine output, PSM, stall and actuators via stepFlight.
      // No profile mutation, solver mock or copied authority-curve expectation.
      const holdFlow = () => {
        state.orientation = { x: 0, y: 0, z: 0, w: 1 }
        state.velocity = { x: speed, y: 0, z: 0 }
        state.position = { x: 0, y: 2000, z: 0 }
      }
      for (let step = 0; step < steps; step++) {
        holdFlow()
        stepFlight(state, command, FLIGHT_STEP)
      }
      holdFlow() // Observe the same fixed flow as the last controller update.
      const { legacy, actualThrust } = flightInstrumentation(state)
      const ceiling = legacy.aeroRate[axis] + legacy.floorRate[axis] + legacy.poweredRate[axis]
      // Phase 2 natural damping acts alongside the legacy target controller.
      // At fixed aligned flow the equilibrium balances their exact step factors.
      const controlStep = 1 - Math.exp(-profile.flight.rateResponse * FLIGHT_STEP)
      const dampingStep = 1 - Math.exp(-profile.aero.damping.attached[axis] * (speed / profile.aero.referenceSpeedMps) ** 2 * FLIGHT_STEP)
      const expected = ceiling * controlStep / (controlStep + dampingStep)
      expect(state.alive).toBe(true)
      expect(state.maneuver.highG).toBe(0)
      if (speed === 0) {
        // Floor with no TVC moment. At low nonzero speed stall can leave a TVC
        // residual, so the pre-TVC overlay is not the complete resulting rate.
        expect(actualThrust).toBe(0)
        expect(legacy.floorRate[axis]).toBeGreaterThan(0)
      } else {
        // At attached flow, settled actual/requested TVC moments cancel in the
        // existing double-count guard, leaving the controller ceiling to measure.
        expect(legacy.surfaceControl).toBe(1)
        expect(legacy.aeroRate[axis]).toBeGreaterThanOrEqual(0)
      }
      expect(legacy.poweredRate[axis] > 0).toBe(powered)
      // The chosen pitch/yaw speeds leave turn-budget headroom. Roll has no
      // turn-budget clamp and also exercises both branches of high-speed scaling.
      // A clamped fixture or drift in stepFlight's authority curve fails here.
      expect(Math.abs(state.rates[axis] - expected), `${axis}: ${state.rates[axis]} vs overlay ${expected}`)
        .toBeLessThanOrEqual(tolerance * Math.max(1, Math.abs(expected)))
    }
  })
})
