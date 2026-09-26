import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { createAircraft, runTrack, runScenario, scenarioNames } from '../../benchmarks/flight/harness'
import { getFlightProfile } from '../../src/game/flight/profile'
import { computeBudget } from '../../src/game/flight/authority'
import { aeroFlowEffectiveness } from '../../src/game/flight/aerodynamics'
import { observeAirflow } from '../../src/game/flight/airflow'
import { poweredThrustForces, tvcMomentCapacity, solveTvcAngles } from '../../src/game/flight/thrustVectoring'
import { axes } from '../../src/game/flight/allocation'
import { assertAircraftValid, assertActuatorStep, assertLimiterStep, mulberry32, runAtFps } from './helpers'
import { stepFlight } from '../../src/game/flight/stepFlight'
import { neutralCommand } from '../../src/game/runtime/commands'
import { readIntent, createPilotIntent } from '../../src/game/flight/intent'

const ids = ['f22', 'su57', 'f22-notvc']
function audit(state: ReturnType<typeof createAircraft>, previous: ReturnType<typeof createAircraft>) {
  assertAircraftValid(state); assertActuatorStep(state, previous); assertLimiterStep(state, previous)
  const f = state.flightForces!, { budget: b, allocation: r } = f, p = getFlightProfile(state.aircraftId)
  const thrust = state.engine.actualThrust, epsilon = 1e-8
  for (const axis of axes) {
    const direction = r.request[axis] < 0 ? 'negative' : 'positive', cap = b.tvc[direction][axis]
    expect(Math.abs(r.aero[axis])).toBeLessThanOrEqual(b.physicalAero[axis] + epsilon)
    expect(Math.abs(r.tvc[axis])).toBeLessThanOrEqual(cap + epsilon)
    const floorGap = Math.max(0, b.arcadeFloor.acceleration[axis] - b.physicalAero[axis] - cap)
    expect(Math.abs(r.floor[axis])).toBeLessThanOrEqual(floorGap + epsilon)
    expect(r.aero[axis] + r.tvc[axis] + r.floor[axis] + r.unmet[axis]).toBeCloseTo(r.request[axis], 10)
    expect(Math.abs(r.aero[axis] + r.tvc[axis] + r.floor[axis])).toBeLessThanOrEqual(Math.abs(r.request[axis]) + epsilon)
    if (Math.abs(r.floor[axis]) > epsilon) expect(Math.sign(r.request[axis]) * (f.ratesBefore[axis] + (r.aero[axis] + r.tvc[axis] + r.floor[axis]) * f.dt)).toBeLessThanOrEqual(b.arcadeFloor.maxRate[axis] + epsilon)
    expect(f.tvc[axis]).toBeLessThanOrEqual(b.actualMomentBounds.positive[axis] + epsilon)
    expect(-f.tvc[axis]).toBeLessThanOrEqual(b.actualMomentBounds.negative[axis] + epsilon)
    expect(f.targetTorque[axis]).toBeCloseTo(r.tvc[axis] + f.coupledTarget[axis], 12)
    expect(f.tvc[axis]).toBeCloseTo(r.tvc[axis] + f.coupledTarget[axis] + f.actuatorLag[axis], 12)
    const neutral = f.stabilityDamping[axis]
    expect(neutral * f.ratesBefore[axis]).toBeLessThanOrEqual(epsilon)
    expect(Math.abs(neutral * f.dt)).toBeLessThanOrEqual(Math.abs(f.ratesBefore[axis]) + epsilon)
    expect(f.ratesAfter[axis]).toBeCloseTo(f.ratesBefore[axis] + f.dt * (r.aero[axis] + r.floor[axis] + neutral + f.tvc[axis] + f.naturalRestoring[axis] + f.naturalDeparture[axis] + f.naturalDamping[axis]), 11)
  }
  if (p.thrustVectoring) expect(f.tvc).toEqual(poweredThrustForces(state.thrustVectoring, thrust, p.thrustVectoring).angularAcceleration)
  else {
    expect(b.poweredControlAvailable).toBe(0)
    for (const axis of axes) { expect(b.tvc.positive[axis]).toBe(0); expect(b.tvc.negative[axis]).toBe(0); expect(Math.abs(r.tvc[axis])).toBe(0); expect(f.tvc[axis]).toBe(0) }
  }
  const energy = (s: typeof state) => new Vector3().copy(s.velocity).lengthSq() / 2 + p.flight.gravity * s.position.y
  // Terrain clamps altitude on impact; flight energy is audited before that external collision.
  if (state.alive) expect(energy(state) - energy(previous)).toBeLessThanOrEqual(f.translation.thrustWork - f.translation.dragWork + epsilon * Math.max(1, energy(previous)))
  expect(f.translation.controlPathRate).toBeLessThanOrEqual(f.translation.controlPathCap + epsilon)
}

describe.each(ids)('%s Phase 3 hard invariants', id => {
  it.each(scenarioNames)('I10–I19 allocation/moment/work/path trace: %s', scenario => { runScenario(scenario, id, audit) })
  it.each([1, 42, 991])('I10–I19 low/reverse-speed mixed-input fuzz seed %s', seed => {
    const random = mulberry32(seed), state = createAircraft(id)
    state.position.y = 4000
    state.velocity = { x: seed === 42 ? -5 : seed === 1 ? 0 : 20, y: 0, z: 0 }
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), random() * Math.PI)
    state.orientation = { x: q.x, y: q.y, z: q.z, w: q.w }
    let input = {}
    const trace = runTrack(state, 4, (_s, time) => {
      if (Math.round(time * 120) % 15 === 0) input = { pitch: random() * 2 - 1, yaw: random() * 2 - 1, roll: random() * 2 - 1,
        speedAdjust: random() * 2 - 1, afterburner: true, airbrake: random() > 0.5 }
      return input
    }, audit)
    // Coverage: C used to force the limiter open here. Automatic permission must still reach it.
    expect(Math.max(...trace.samples.map(sample => sample.state.limiterOpen))).toBeGreaterThan(0.9)
  })
})
it.each(['f22', 'su57'])('I9/I10: %s signed capacity scales with thrust and bounds the full actual-angle grid', id => {
  const p = getFlightProfile(id).thrustVectoring!
  const unit = tvcMomentCapacity(p, 1)
  for (const thrust of [0, 1, 65]) {
    const capacity = tvcMomentCapacity(p, thrust)
    for (const axis of axes) for (const direction of ['positive', 'negative'] as const) {
      expect(capacity.commanded[direction][axis]).toBeCloseTo(unit.commanded[direction][axis] * thrust, 12)
      expect(capacity.moments[direction][axis]).toBeCloseTo(unit.moments[direction][axis] * thrust, 12)
    }
    for (let left = -p.maxAngle; left <= p.maxAngle; left += 0.5) for (let right = -p.maxAngle; right <= p.maxAngle; right += 0.5) {
      const moment = poweredThrustForces({ left, right }, thrust, p).angularAcceleration
      for (const axis of axes) {
        expect(moment[axis]).toBeLessThanOrEqual(capacity.moments.positive[axis] + 1e-10)
        expect(-moment[axis]).toBeLessThanOrEqual(capacity.moments.negative[axis] + 1e-10)
      }
    }
  }
  expect(unit.commanded.negative.pitch).toBeGreaterThan(unit.commanded.positive.pitch)
  if (id === 'f22') { expect(unit.commanded.positive.yaw).toBe(0); expect(unit.moments.positive.yaw).toBeGreaterThan(0) }
  else expect(unit.commanded.positive.yaw).toBeGreaterThan(0)
})
it('reachable nozzle solve does not treat three independent torque ceilings as three actuators', () => {
  const p = getFlightProfile('su57').thrustVectoring!, capacity = tvcMomentCapacity(p, 65).commanded.positive
  const target = solveTvcAngles(capacity, 65, p), actual = poweredThrustForces(target, 65, p).angularAcceleration
  expect(Math.abs(target.left)).toBeLessThanOrEqual(p.maxAngle)
  expect(Math.abs(target.right)).toBeLessThanOrEqual(p.maxAngle)
  expect(axes.some(axis => Math.abs(actual[axis] - capacity[axis]) > 1e-6)).toBe(true)
})
it('I16: budget ignores command and intent ignores aircraft capability/governor trim', () => {
  const state = createAircraft('f22'), profile = getFlightProfile('f22'), flow = observeAirflow(state, profile)
  const reference = computeBudget(flow, aeroFlowEffectiveness(flow, profile.aero), 25, profile)
  const input = { ...neutralCommand(0, state.id), pitch: 1, afterburner: true, airbrake: true }
  const expected = readIntent(input, createPilotIntent(), 1 / 120, 2)
  for (const id of ids) {
    state.aircraftId = id; state.engine.requestedPower = 100; state.intent = expected
    expect(computeBudget(flow, aeroFlowEffectiveness(flow, profile.aero), 25, profile)).toEqual(reference)
    expect(readIntent(input, createPilotIntent(), 1 / 120, 2)).toEqual(expected)
  }
  const source = readFileSync(new URL('../../src/game/flight/authority.ts', import.meta.url), 'utf8')
  expect(source).not.toMatch(/from ['"].*(?:commands|intent|WorldState)['"]/)
})
it('I2/I3: non-TVC replay stays exact at 30/60/144 FPS with airbrake and burner', () => {
  const input = (tick: number, id: string) => ({ ...neutralCommand(tick, id), pitch: 1, speedAdjust: 1, afterburner: true, airbrake: true })
  const base = runAtFps(60, 'f22-notvc', input, 3)
  expect(runAtFps(30, 'f22-notvc', input, 3)).toEqual(base)
  expect(runAtFps(144, 'f22-notvc', input, 3)).toEqual(base)
})

// MR2 amendment: the pitch hold follows limiterOpen (owner decision D1(b)), and Shift opens
// the limiter faster (Phase 4 powerBoost), so the Shift *intent* now shapes the servo's free
// braking even at zero q. The invariant is that thrust creates no rotation, so the powered rig
// is compared with a rig holding the same keys whose burner reserve is empty: identical intent,
// no burner thrust. The unpowered rig keeps the capability and floor-cap checks.
it('I13/I14: a fully open limiter and burner cannot create powered rotation in a fixed zero-q no-TVC rig', () => {
  const idle = createAircraft('f22-notvc'), powered = structuredClone(idle), dry = structuredClone(idle), p = getFlightProfile('f22-notvc')
  dry.maneuver.burner = 0; dry.maneuver.burnerLocked = true
  for (let i = 0; i < 600; i++) {
    for (const [state, afterburner] of [[idle, false], [powered, true], [dry, true]] as const) {
      state.velocity = { x: 0, y: 0, z: 0 }; state.orientation = { x: 0, y: 0, z: 0, w: 1 }; state.position.y = 4000
      // Seed the limiter fully open: the permission C used to force, now with no back door.
      state.stall.severity = 1; state.limiterOpen = 1
      stepFlight(state, { ...neutralCommand(i, state.id), pitch: 1, yaw: 1, roll: 1,
        afterburner, speedAdjust: afterburner ? 1 : 0, airbrake: true }, 1 / 120)
      expect(state.flightForces!.budget.poweredControlAvailable).toBe(0)
      for (const axis of axes) {
        expect(state.flightForces!.budget.physicalAero[axis]).toBe(0)
        expect(Math.abs(state.flightForces!.allocation.tvc[axis])).toBe(0)
        expect(Math.abs(state.rates[axis])).toBeLessThanOrEqual(p.arcadeControlFloor.maxRate[axis] + 1e-9)
      }
    }
    expect(powered.engine.actualThrust).toBeGreaterThan(dry.engine.actualThrust)
    expect(powered.rates).toEqual(dry.rates)
    expect(powered.flightForces!.allocation.floor).toEqual(dry.flightForces!.allocation.floor)
  }
})
