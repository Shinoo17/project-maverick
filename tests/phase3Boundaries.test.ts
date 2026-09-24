import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { aircraft, getAircraft } from '../src/content/aircraft'
import { getFlightProfile } from '../src/game/flight/profile'
import { GameRuntime } from '../src/game/runtime/GameRuntime'
import { createAircraft } from '../benchmarks/flight/harness'
import { aeroFlowEffectiveness } from '../src/game/flight/aerodynamics'
import { observeAirflow } from '../src/game/flight/airflow'
import { interpretEnvelope } from '../src/game/flight/envelope'
import { measureControlDemand, requestControl } from '../src/game/flight/controller'
import { computeBudget } from '../src/game/flight/authority'
import { neutralCommand } from '../src/game/runtime/commands'
import { tvcMomentCapacity, poweredThrustForces } from '../src/game/flight/thrustVectoring'

it('low-speed rate requests are independent of floor tuning and activate at the authored boundary', () => {
  const state = createAircraft('f22'), profile = structuredClone(getFlightProfile('f22'))
  const dt = 1 / 120, command = { ...neutralCommand(0, state.id), pitch: 1, yaw: 1, roll: 1 }
  for (const speed of [0, 5, 18, 19, 25, 100]) {
    state.velocity.x = speed
    const flow = observeAirflow(state, profile), envelope = interpretEnvelope(state, flow, profile)
    const demand = measureControlDemand(command, flow, state.stall.severity, profile, state.limiterOpen)
    const reference = requestControl(command, state.rates, flow, envelope, profile, dt, demand)
    const retuned = structuredClone(profile)
    retuned.arcadeControlFloor = { acceleration: { pitch: 100, yaw: 100, roll: 100 }, maxRate: { pitch: 100, yaw: 100, roll: 100 } }
    expect(requestControl(command, state.rates, flow, envelope, retuned, dt, measureControlDemand(command, flow, state.stall.severity, retuned, state.limiterOpen))).toEqual(reference)
  }
  const boundary = profile.aero.referenceSpeedMps * profile.flight.minRateTarget.pitch / profile.flight.pitchRate
  for (const speed of [boundary - 0.01, boundary + 0.01]) {
    state.velocity.x = speed
    const flow = observeAirflow(state, profile), envelope = interpretEnvelope(state, flow, profile)
    const input = { ...command, yaw: 0, roll: 0 }
    const demand = measureControlDemand(input, flow, state.stall.severity, profile, state.limiterOpen)
    const result = requestControl(input, state.rates, flow, envelope, profile, dt, demand)
    const closedBudget = demand.closedTurnBudget
    const target = Math.max(profile.flight.minRateTarget.pitch, Math.min(closedBudget, profile.flight.pitchRate * speed / profile.aero.referenceSpeedMps))
    expect(result.request.pitch).toBeCloseTo(target * (1 - Math.exp(-profile.flight.rateResponse * dt)) / dt, 12)
  }
})

it('fractional limiter permission is continuous and changes no capability budget', () => {
  const state = createAircraft('f22'), profile = getFlightProfile('f22')
  const flow = observeAirflow(state, profile), budget = computeBudget(flow, aeroFlowEffectiveness(flow, profile.aero), 35, profile)
  let prior = profile.aero.alphaNormalDeg
  for (let i = 0; i <= 100; i++) {
    state.limiterOpen = i / 100
    const envelope = interpretEnvelope(state, flow, profile)
    expect(envelope.limiterOpen).toBe(i / 100)
    expect(envelope.alphaLimitDeg - prior).toBeCloseTo(i === 0 ? 0 : (profile.aero.maxControllableAlphaDeg - profile.aero.alphaNormalDeg) / 100, 12)
    expect(computeBudget(flow, aeroFlowEffectiveness(flow, profile.aero), 35, profile)).toEqual(budget)
    prior = envelope.alphaLimitDeg
  }
})

it.each(['f22', 'su57'])('%s scalar gain scales every capacity and actual moment axis equally', id => {
  const profile = getFlightProfile(id).thrustVectoring!
  const unit = { ...profile, gain: 1 }, scaled = { ...profile, gain: 2.5 }
  const a = tvcMomentCapacity(unit, 35), b = tvcMomentCapacity(scaled, 35)
  for (const kind of ['commanded', 'moments'] as const) for (const sign of ['positive', 'negative'] as const) for (const axis of ['pitch', 'yaw', 'roll'] as const) {
    expect(b[kind][sign][axis]).toBeCloseTo(a[kind][sign][axis] * 2.5, 12)
  }
  const angles = { left: profile.maxAngle, right: -profile.maxAngle / 2, authority: 1 }
  const raw = poweredThrustForces(angles, 35, unit), boosted = poweredThrustForces(angles, 35, scaled)
  expect(boosted.acceleration).toEqual(raw.acceleration)
  for (const axis of ['pitch', 'yaw', 'roll'] as const) expect(boosted.angularAcceleration[axis]).toBeCloseTo(raw.angularAcceleration[axis] * 2.5, 12)
})

it('I16: input intent module has no capability/profile/state/engine imports', () => {
  const source = readFileSync(new URL('../src/game/flight/intent.ts', import.meta.url), 'utf8')
  const imports = [...source.matchAll(/(?:import|export)\s[^;]*?from\s*['"]([^'"]+)['"]/g)].map(match => match[1])
  expect(imports).toEqual(['../runtime/commands'])
})
it('no-TVC validation variant has independent aero data and reuses F-22 presentation in Playground only', () => {
  const normal = getAircraft('f22'), variant = getAircraft('f22-notvc')
  expect(aircraft.some(entry => entry.id === variant.id)).toBe(false)
  expect(variant.presentationId).toBe(normal.presentationId)
  expect(variant.modelFile).toBe(normal.modelFile)
  const profile = getFlightProfile(variant.id), base = getFlightProfile(normal.id)
  expect(profile.thrustVectoring).toBeNull()
  expect(profile.aero).toEqual(base.aero)
  expect(profile.aero).not.toBe(base.aero)
  expect(() => new GameRuntime({ mode: 'playground', aircraftIds: [variant.id] })).not.toThrow()
  expect(() => new GameRuntime({ mode: 'offline', aircraftIds: [variant.id] })).toThrow('Playground')
})

it('angular authority comes from measured flow, never from the separation memory', () => {
  const profile = getFlightProfile('f22'), state = createAircraft('f22')
  const axes = ['pitch', 'yaw', 'roll'] as const
  for (const speed of [12, 40, 55, 55.6, 64.8, 90, 200]) {
    state.velocity = { x: speed, y: 0, z: 0 }
    const flow = observeAirflow(state, profile), effectiveness = aeroFlowEffectiveness(flow, profile.aero)
    const budget = computeBudget(flow, effectiveness, 25, profile)
    // Regression for the low-speed hard zero: the arcade band below 300 arcade km/h
    // must not remove surface authority that dynamic pressure already scales.
    for (const axis of axes) {
      expect(budget.physicalAero[axis]).toBeGreaterThan(0)
      expect(budget.physicalAero[axis]).toBeCloseTo(flow.dynamicPressure * flow.confidence * effectiveness[axis] * profile.aero.controlAcceleration[axis], 12)
    }
    // Same flow, any separation memory: the capability layer cannot observe it.
    for (const severity of [0, 0.5, 1]) {
      state.stall.severity = severity
      expect(computeBudget(flow, aeroFlowEffectiveness(flow, profile.aero), 25, profile)).toEqual(budget)
    }
  }
  const source = readFileSync(new URL('../src/game/flight/authority.ts', import.meta.url), 'utf8')
  expect(source).not.toMatch(/from ['"].*stall['"]/)
})
