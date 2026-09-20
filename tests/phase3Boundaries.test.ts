import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { aircraft, getAircraft } from '../src/content/aircraft'
import { getFlightProfile } from '../src/game/flight/profile'
import { GameRuntime } from '../src/game/runtime/GameRuntime'
import { createAircraft } from '../benchmarks/flight/harness'
import { aeroFlowEffectiveness } from '../src/game/flight/aerodynamics'
import { observeAirflow } from '../src/game/flight/airflow'
import { interpretEnvelope } from '../src/game/flight/envelope'
import { requestControl } from '../src/game/flight/controller'
import { computeBudget } from '../src/game/flight/authority'
import { stepFlight } from '../src/game/flight/stepFlight'
import { neutralCommand } from '../src/game/runtime/commands'
import { tvcMomentCapacity, poweredThrustForces } from '../src/game/flight/thrustVectoring'

it('low-speed rate requests are independent of floor tuning and activate at the authored boundary', () => {
  const state = createAircraft('f22'), profile = structuredClone(getFlightProfile('f22'))
  const dt = 1 / 120, command = { ...neutralCommand(0, state.id), pitch: 1, yaw: 1, roll: 1 }
  for (const speed of [0, 5, 18, 19, 25, 100]) {
    state.velocity.x = speed
    const flow = observeAirflow(state, profile), envelope = interpretEnvelope(state, flow, profile)
    const reference = requestControl(command, state.rates, flow, envelope, profile, 0, dt)
    const retuned = structuredClone(profile)
    retuned.arcadeControlFloor = { acceleration: { pitch: 100, yaw: 100, roll: 100 }, maxRate: { pitch: 100, yaw: 100, roll: 100 } }
    expect(requestControl(command, state.rates, flow, envelope, retuned, 0, dt)).toEqual(reference)
  }
  const boundary = profile.aero.referenceSpeedMps * profile.flight.minRateTarget.pitch / profile.flight.pitchRate
  for (const speed of [boundary - 0.01, boundary + 0.01]) {
    state.velocity.x = speed
    const flow = observeAirflow(state, profile), envelope = interpretEnvelope(state, flow, profile)
    const result = requestControl({ ...command, yaw: 0, roll: 0 }, state.rates, flow, envelope, profile, 0, dt)
    const target = Math.max(profile.flight.minRateTarget.pitch, profile.flight.pitchRate * speed / profile.aero.referenceSpeedMps)
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

it('Phase 3 debug permission steps only on C transitions; runtime smoothing remains a Phase 4 requirement', () => {
  const state = createAircraft('f22'); state.velocity.x = 25
  for (const open of [false, false, true, true, false, false]) {
    const alternate = structuredClone(state), command = { ...neutralCommand(0, state.id), pitch: 1, psmArm: open }
    stepFlight(state, command, 1 / 120)
    stepFlight(alternate, { ...command, psmArm: !open }, 1 / 120)
    expect(state.limiterOpen).toBe(open ? 1 : 0)
    expect(state.flightForces!.budget).toEqual(alternate.flightForces!.budget)
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
