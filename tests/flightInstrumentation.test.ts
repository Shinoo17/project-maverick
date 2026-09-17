import { describe, expect, it } from 'vitest'
import { Euler, Quaternion, Vector3 } from 'three'
import { flightInstrumentation } from '../src/game/flight/instrumentation'
import { getFlightProfile } from '../src/game/flight/profile'
import { stepSpeed } from '../src/game/flight/speed'
import { angleOfAttack } from '../src/game/flight/stall'
import { tvcCapacity, thrustForces } from '../src/game/flight/thrustVectoring'
import { neutralCommand } from '../src/game/runtime/commands'
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
      // Analytical r × F reference includes the height × axial thrust moment
      // omitted by the approximate pitch column in the plan's §3 table.
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
