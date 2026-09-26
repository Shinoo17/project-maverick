import { describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { stepFlight } from '../../src/game/flight/stepFlight'
import { neutralCommand } from '../../src/game/runtime/commands'
import { FLIGHT_STEP as dt } from '../../src/game/runtime/clock'
import { readFileSync } from 'node:fs'
import { observeAirflow } from '../../src/game/flight/airflow'
import { envelopeLabel, interpretEnvelope, stepEnvelope } from '../../src/game/flight/envelope'
import { getFlightProfile, validateFlightProfile } from '../../src/game/flight/profile'
import { readIntent, createPilotIntent } from '../../src/game/flight/intent'
import { createAircraft, aircraftIds, runScenario, runTrack } from '../../benchmarks/flight/harness'
import { assertAircraftValid, assertActuatorStep, assertLimiterStep, runAtFps, positionalHorizon } from './helpers'
import { runFlightReplay } from '../../src/game/playground/replay'
import { flightInstrumentation } from '../../src/game/flight/instrumentation'
import { flightWarning } from '../../src/features/flight/telemetry'
import { FlightInput } from '../../src/game/input/FlightInput'

const profile = getFlightProfile('f22')
function envelopeRig(q = 0.2, incidence = 0) {
  const state = createAircraft('f22')
  state.intent = { ...createPilotIntent(), demand: 1, saturation: 1, sustained: 0, brakeIntent: 0, powerIntent: 0 }
  const flow = { ...observeAirflow(state, profile), dynamicPressure: q, incidenceDeg: incidence }
  return { state, flow }
}

describe('automatic permission', () => {
  it.each(['opening', 'closing', 'boosted', 'incidence'] as const)('I7: %s follows the authored exponential at every step', mode => {
    const { state, flow } = envelopeRig(0.2, mode === 'incidence' ? 90 : 0)
    if (mode === 'closing') { state.limiterOpen = 0.8; state.intent.demand = 0 }
    if (mode === 'boosted') { state.intent.brakeIntent = 1; state.intent.powerIntent = 1 }
    if (mode === 'incidence') state.intent.saturation = 0
    for (let i = 0; i < 120; i++) {
      const previous = state.limiterOpen
      const { envelope, limiterStep } = stepEnvelope(state, flow, profile, dt)
      const b = profile.breakout
      const rate = limiterStep.target > previous ? b.openRate * (1 + b.brakeBoost * state.intent.brakeIntent + b.powerBoost * state.intent.powerIntent) : b.closeRate
      const bound = (limiterStep.target > previous ? 1 - previous : previous) * (1 - Math.exp(-rate * dt))
      expect(Math.abs(state.limiterOpen - previous)).toBeLessThanOrEqual(bound + 16 * Number.EPSILON)
      expect(state.limiterOpen).toBe(previous + (limiterStep.target - previous) * (1 - Math.exp(-rate * dt)))
      expect(envelope.alphaLimitDeg).toBeCloseTo(profile.aero.alphaNormalDeg + (profile.aero.maxControllableAlphaDeg - profile.aero.alphaNormalDeg) * state.limiterOpen, 12)
    }
  })

  it('boosted low energy opens faster; beginner permission starts gradually', () => {
    const plain = envelopeRig(), intentional = envelopeRig()
    intentional.state.intent.brakeIntent = 1; intentional.state.intent.powerIntent = 1
    stepEnvelope(plain.state, plain.flow, profile, dt)
    stepEnvelope(intentional.state, intentional.flow, profile, dt)
    expect(plain.state.limiterOpen).toBeGreaterThan(0)
    expect(plain.state.limiterOpen).toBeLessThan(profile.breakout.baseWeight)
    expect(intentional.state.limiterOpen).toBeGreaterThan(plain.state.limiterOpen)
    expect(intentional.state.limiterOpen).toBeLessThan(1)
  })

  it('high speed full demand becomes G permission', () => {
    const { state, flow } = envelopeRig(profile.breakout.qHigh + 1)
    state.intent.brakeIntent = state.intent.powerIntent = 1
    const envelope = stepEnvelope(state, flow, profile, dt).envelope
    expect(envelope.energyPermission).toBe(0)
    expect(envelope.limiterOpen).toBe(0)
    expect(envelope.gAllowance).toBe(profile.breakout.hardTurnG)
    // Without saturation there is no hard turn: Phase 6 removed the manual Space request.
    state.intent.saturation = 0
    expect(interpretEnvelope(state, flow, profile).gAllowance).toBe(1)
  })

  it('H maintains permission during demanded sideslip, then demand release closes monotonically without a latch', () => {
    const { state, flow } = envelopeRig(profile.breakout.qHigh + 1, 90)
    flow.alphaDeg = 0; flow.betaDeg = 90
    state.limiterOpen = 0.7; state.intent.saturation = 0; state.intent.continuation = 1
    const held = stepEnvelope(state, flow, profile, dt)
    expect(held.limiterStep.target).toBe(1)
    expect(state.limiterOpen).toBeGreaterThan(0.7)
    state.intent.demand = 0; state.intent.continuation = 0
    for (let i = 0; i < 240; i++) {
      const previous = state.limiterOpen
      const result = stepEnvelope(state, flow, profile, dt)
      expect(result.limiterStep.target).toBe(0)
      expect(state.limiterOpen).toBeGreaterThan(0)
      expect(state.limiterOpen).toBeLessThan(previous)
    }
  })

  it('the exponential is subdivision independent for fixed observations', () => {
    const outputs = [30, 60, 144].map(hz => {
      const { state, flow } = envelopeRig()
      state.intent.brakeIntent = state.intent.powerIntent = 1
      for (let i = 0; i < hz; i++) stepEnvelope(state, flow, profile, 1 / hz)
      state.intent.demand = 0
      for (let i = 0; i < hz; i++) stepEnvelope(state, flow, profile, 1 / hz)
      return state.limiterOpen
    })
    expect(outputs[0]).toBeCloseTo(outputs[1], 14)
    expect(outputs[2]).toBeCloseTo(outputs[1], 14)
  })

  it('no command, envelope or separation dependency can enter AuthorityBudget', () => {
    const source = readFileSync(new URL('../../src/game/flight/authority.ts', import.meta.url), 'utf8')
    const imports = [...source.matchAll(/from\s*['"]([^'"]+)['"]/g)].map(match => match[1])
    expect(imports).toEqual(['./airflow', './profileTypes', './thrustVectoring'])
    expect(source).not.toMatch(/(?:command|envelope|stall)\./)
  })
})

const audit = (state: ReturnType<typeof createAircraft>, previous: ReturnType<typeof createAircraft>) => {
  assertAircraftValid(state); assertActuatorStep(state, previous); assertLimiterStep(state, previous)
}
describe.each([...aircraftIds, 'f22-notvc'])('%s automatic integration', id => {
  it.each(['cobra', 'kulbit', 'reversal180', 'pedal', 'psmIntent450'] as const)('I1/I7/I11: %s runs on automatic permission', scenario => {
    const trace = runScenario(scenario, id, audit)
    expect(trace.samples.some(s => s.state.limiterOpen > 0)).toBe(true)
    if (id === 'f22-notvc') for (const { state } of trace.samples.slice(1)) {
      expect(state.flightForces!.budget.poweredControlAvailable).toBe(0)
      expect(state.flightForces!.tvc).toEqual({ pitch: 0, yaw: 0, roll: 0 })
      expect(state.flightForces!.allocation.tvc).toEqual({ pitch: 0, yaw: 0, roll: 0 })
    }
  })
  it('I2/I3: automatic Airbrake + Shift + pull replays exactly at 30/60/144 FPS', () => {
    const input = (tick: number, entityId: string) => ({ ...neutralCommand(tick, entityId), pitch: tick < 180 ? 1 : 0,
      airbrake: tick < 180, afterburner: tick < 180, speedAdjust: tick < 60 ? -1 : 0 })
    const at60 = runAtFps(60, id, input)
    expect(runAtFps(30, id, input)).toEqual(at60)
    expect(runAtFps(144, id, input)).toEqual(at60)
    expect(runFlightReplay(at60.replay)).toEqual(at60.snapshot)
    for (const profileVersion of ['p3-flow-effectiveness-4', 'p4-automatic-envelope-1']) {
      expect(() => runFlightReplay({ ...at60.replay, profileVersion })).toThrow('Unsupported flight replay')
    }
  })
})

it('I7 audit rejects a limiter jump, and no command opens the limiter in one step', () => {
  const state = createAircraft('f22'), previous = structuredClone(state)
  stepFlight(state, neutralCommand(0, state.id), dt)
  state.limiterOpen = 1
  expect(() => assertLimiterStep(state, previous)).toThrow('I7')
  const low = createAircraft('f22'); low.position.y = 4000; low.velocity.x = 40
  const before = structuredClone(low)
  stepFlight(low, { ...neutralCommand(0, low.id), pitch: 1, yaw: 1, roll: 1, speedAdjust: 1, airbrake: true, afterburner: true }, dt)
  expect(() => assertLimiterStep(low, before)).not.toThrow()
  expect(low.limiterOpen).toBeLessThan(1)
})

it('labels and presentation have no effect on an automatic flight trace', () => {
  const initial = createAircraft('f22'); initial.velocity.x = 60
  const controller = () => ({ pitch: 1, afterburner: true, airbrake: true })
  const plain = runTrack(initial, 3, controller)
  const observed = runTrack(initial, 3, controller, state => {
    const telemetry = flightInstrumentation(state)
    envelopeLabel(telemetry.envelope, state.intent.activity); flightWarning(state)
  })
  expect(observed).toEqual(plain)
  const alternate = structuredClone(initial)
  alternate.stall.cause = 'aoa'
  for (let i = 0; i < 120; i++) {
    const command = { ...neutralCommand(i, initial.id), ...controller() }
    stepFlight(initial, command, dt); stepFlight(alternate, command, dt)
    expect(alternate.flightForces).toEqual(initial.flightForces)
    expect(alternate.velocity).toEqual(initial.velocity)
    expect(alternate.orientation).toEqual(initial.orientation)
  }
})

it('Space is Airbrake, Shift is Afterburner, X is unbound, and the positional mouse correction blends continuously', () => {
  const input = new FlightInput(positionalHorizon); input.press('KeyX'); input.press('Space'); input.press('ShiftLeft')
  expect(input.command(0, 'a', 'keyboard')).toEqual({ ...neutralCommand(0, 'a'), airbrake: true, afterburner: true })
  for (const angle of [-Math.PI, -1, 1, Math.PI]) for (const y of [-100, 100]) {
    input.clear(); input.engage(); input.move(150, y); input.screen = { angle, blend: 1 }
    const from = input.command(0, 'a', 'mouse')
    input.highAoa = 1
    const to = input.command(0, 'a', 'mouse')
    for (const blend of [0.01, 0.5, 0.99, 1 - 1e-9]) {
      input.highAoa = blend
      const command = input.command(0, 'a', 'mouse')
      expect(command.pitch).toBeCloseTo(from.pitch + (to.pitch - from.pitch) * blend, 12)
      expect(command.roll).toBeCloseTo(from.roll + (to.roll - from.roll) * blend, 12)
    }
  }
})

it('profile validation rejects missing/nonfinite/unsafe envelope tuning', () => {
  for (const key of Object.keys(profile.breakout) as (keyof typeof profile.breakout)[]) for (const bad of [NaN, Infinity, -1, undefined]) {
    const copy = structuredClone(profile)
    Object.assign(copy.breakout, { [key]: bad })
    expect(() => validateFlightProfile(copy)).toThrow(/breakout/)
  }
  for (const patch of [{ qHigh: profile.breakout.qLow }, { openRate: 0 }, { closeRate: 0 }, { hardTurnG: 0.5 }, { hardTurnG: Number.MAX_VALUE }, { baseWeight: 2 }, { openRate: Number.MAX_VALUE, brakeBoost: Number.MAX_VALUE }]) {
    const copy = structuredClone(profile); Object.assign(copy.breakout, patch)
    expect(() => validateFlightProfile(copy)).toThrow(/breakout/)
  }
})

it('sustained input remains a low-weight signal and power intent remains input-only', () => {
  const command = { ...neutralCommand(0, 'a'), pitch: 1, afterburner: true, airbrake: true }
  const intent = readIntent(command, createPilotIntent(), dt, 2)
  expect(intent.demand).toBe(1); expect(intent.saturation).toBe(1); expect(intent.powerIntent).toBe(1)
  expect(intent.sustained).toBeCloseTo(1 - Math.exp(-dt / 0.4), 14)
})

it.each(aircraftIds)('%s keeps natural recovery active immediately after automatic high-incidence release', id => {
  const state = createAircraft(id); state.position.y = 4000; state.velocity = { x: 20, y: 0, z: 0 }
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 100 * Math.PI / 180)
  state.orientation = { x: q.x, y: q.y, z: q.z, w: q.w }
  state.stall.severity = 1; state.limiterOpen = 1
  state.rates = { pitch: 2, yaw: -0.4, roll: 0.3 }
  const trace = runTrack(state, 14, () => ({}), audit)
  const first = trace.samples[1].state.flightForces!
  expect(first.naturalRestoring.pitch).not.toBe(0)
  expect(first.naturalDamping.pitch).toBeLessThan(0)
  expect(trace.samples.every(sample => sample.state.alive)).toBe(true)
  expect(Math.abs(trace.samples.at(-1)!.state.rates.pitch)).toBeLessThan(Math.abs(state.rates.pitch))
})

it('automatic permission opens outside the retired C altitude and speed gates', () => {
  // Below the old 150 m minimum and 65 m/s entry band.
  const state = createAircraft('f22'); state.position.y = 100; state.velocity.x = 40
  stepFlight(state, { ...neutralCommand(0, state.id), pitch: 1, afterburner: true, airbrake: true }, dt)
  expect(state.limiterOpen).toBeGreaterThan(0)
})

it('the reverse-path alignment transition is continuous at the former binary incidence boundary', () => {
  const results = [-1e-7, 1e-7].map(offset => {
    const state = createAircraft('f22'); state.velocity.x = 70; state.stall.severity = 1
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.acos(-0.8) + offset)
    state.orientation = { x: q.x, y: q.y, z: q.z, w: q.w }
    stepFlight(state, neutralCommand(0, state.id), dt)
    return state.velocity
  })
  for (const axis of ['x', 'y', 'z'] as const) expect(results[0][axis]).toBeCloseTo(results[1][axis], 5)
})
