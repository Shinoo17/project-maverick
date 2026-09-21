import { expect, it, vi } from 'vitest'
import { energySweep, partialEntryComparison, entryDiagnostics } from '../benchmarks/flight/permissionProbes'
import { createAircraft, runScenario, runTrack, scenarioSetup } from '../benchmarks/flight/harness'
import { observeAirflow } from '../src/game/flight/airflow'
import { measureControlDemand, requestControl } from '../src/game/flight/controller'
import * as envelopeModule from '../src/game/flight/envelope'
import { stepFlight } from '../src/game/flight/stepFlight'
import { interpretEnvelope } from '../src/game/flight/envelope'
import { getFlightProfile } from '../src/game/flight/profile'
import { readIntent, createPilotIntent } from '../src/game/flight/intent'
import { neutralCommand } from '../src/game/runtime/commands'
import { FLIGHT_STEP as dt } from '../src/game/runtime/clock'

it('automatic permission changes the flown outcome compared with a closed limiter', () => {
  const free = runScenario('psmIntent450', 'f22')
  // A test-only pinned property blocks envelope integration before the controller
  // reads it. There is no production switch or alternate allocation path.
  const setup = scenarioSetup('psmIntent450', 'f22')
  const closed = runTrack(setup.state, setup.seconds, (state, time, rotation) => {
    if (time === 0) Object.defineProperty(state, 'limiterOpen', { configurable: true, enumerable: true, get: () => 0, set: () => {} })
    return setup.controller(state, time, rotation)
  })
  const peak = (trace: typeof free) => Math.max(...trace.samples.map(s => observeAirflow(s.state, getFlightProfile('f22')).incidenceDeg))
  expect(closed.samples.slice(1).every(s => s.state.limiterOpen === 0)).toBe(true)
  // This is wiring coverage, not B14's time-to-incidence feel target.
  expect(peak(free)).toBeGreaterThan(peak(closed) + getFlightProfile('f22').aero.alphaNormalDeg)
})

it.each(['f22', 'su57', 'f22-notvc'])('%s B17 partial entry exercises unsaturated control and different applied drive', id => {
  const [auto, debug] = partialEntryComparison(id).map(entryDiagnostics)
  expect(auto.unsaturatedPitchSteps).toBeGreaterThan(0)
  expect(auto.firstPitchDrive).not.toBe(debug.firstPitchDrive)
})

it.each([false, true])('B16 rig sees the intended reversal and responds to a near-corner ripple (boosted=%s)', boosted => {
  const control = energySweep('f22', boosted, 0)
  const perturbed = energySweep('f22', boosted)
  expect(control.intendedReversalObserved).toBe(true)
  expect(control.directionChanges).toBe(1)
  expect(perturbed.intendedReversalObserved).toBe(true)
  // Rig sensitivity, not a feel target: a deliberately stronger perturbation
  // must register additional reversals instead of passing by construction.
  const stress = energySweep('f22', boosted, 0.6)
  expect(stress.intendedReversalObserved).toBe(true)
  expect(stress.chatterCount).toBeGreaterThan(0)
})


it.each(['f22', 'su57'])('%s saturation discriminates real requests instead of assuming fully open permission', id => {
  const state = createAircraft(id), p = getFlightProfile(id)
  const intentAt = (speed: number, pitch: number, limiter = 0) => {
    state.velocity.x = speed
    const flow = observeAirflow(state, p), command = { ...neutralCommand(0, state.id), pitch }
    const feedback = measureControlDemand(command, flow, 0, p, limiter)
    const speedAuthority = feedback.speedAuthority
    const alphaLimit = p.aero.alphaNormalDeg + (p.aero.maxControllableAlphaDeg - p.aero.alphaNormalDeg) * limiter
    const ratePermission = speedAuthority + (Math.sqrt(alphaLimit / p.aero.alphaNormalDeg) - speedAuthority) * limiter
    expect(feedback.saturationRatio).toBeCloseTo(Math.abs(pitch) * p.flight.pitchRate * ratePermission / feedback.closedTurnBudget, 12)
    return readIntent(command, createPilotIntent(), dt, feedback.saturationRatio)
  }
  expect(intentAt(100, 1).saturation).toBe(0)
  const full = intentAt(166.7, 1).saturation
  expect(full).toBeGreaterThan(0)
  expect(full).toBeLessThan(1)
  expect(intentAt(166.7, 0.7).saturation).toBeLessThan(full)
  expect(intentAt(259, 1).saturation).toBe(1)
  expect(intentAt(100, 1, 0.5).saturation).toBeGreaterThan(0)
})

it('S changes only G; low-energy breakout and sustained demand do not require saturation', () => {
  const state = createAircraft('f22'), p = getFlightProfile('f22')
  state.velocity.x = 450 / 5.4
  const flow = observeAirflow(state, p)
  const command = { ...neutralCommand(0, state.id), pitch: 1, airbrake: true, afterburner: true }
  const ratio = measureControlDemand(command, flow, 0, p).saturationRatio
  state.intent = readIntent(command, createPilotIntent(), dt, ratio)
  expect(state.intent.saturation).toBe(0)
  expect(state.intent.sustained).toBeGreaterThan(0)
  const unsaturated = interpretEnvelope(state, flow, p)
  expect(unsaturated.limiterTarget).toBeGreaterThan(0)
  expect(unsaturated.gAllowance).toBe(1)
  const saturatedIntent = readIntent(command, createPilotIntent(), dt, 2)
  expect(saturatedIntent.sustained).toBe(state.intent.sustained)
  state.intent = saturatedIntent
  const saturated = interpretEnvelope(state, flow, p)
  // At 450 the revised entry band is fully open (E=1), so G remains normal.
  expect(saturated.gAllowance).toBe(1)
  const transitionFlow = { ...flow, dynamicPressure: (p.breakout.qLow + p.breakout.qHigh) / 2 }
  expect(interpretEnvelope(state, transitionFlow, p).gAllowance).toBeGreaterThan(1)
  expect({ ...saturated, gAllowance: 1, hardTurnBlend: 0 }).toEqual(unsaturated)
})


it('rate and drag follow hardTurnBlend independently of the G allowance curve', () => {
  const initial = createAircraft('f22'), profile = getFlightProfile('f22')
  initial.velocity.x = 100
  const flow = observeAirflow(initial, profile)
  const command = { ...neutralCommand(0, initial.id), pitch: 0.2, yaw: 0.1, psmArm: true }
  const blend = 0.4
  const envelope = { ...interpretEnvelope(initial, flow, profile), limiterOpen: 1,
    alphaLimitDeg: profile.aero.maxControllableAlphaDeg, hardTurnBlend: blend }
  const demand = measureControlDemand(command, flow, initial.stall.severity, profile, initial.limiterOpen)
  const plain = requestControl(command, initial.rates, flow, { ...envelope, hardTurnBlend: 0 }, profile, dt, demand)
  // Open permission removes closed-turn clipping, isolating the rate multipliers.
  for (const gAllowance of [1, 1 + (profile.breakout.hardTurnG - 1) * blend ** 2, 2.5]) {
    const control = requestControl(command, initial.rates, flow, { ...envelope, gAllowance }, profile, dt, demand)
    expect(control.highG).toBe(blend)
    expect(control.request.pitch / plain.request.pitch).toBeCloseTo(1 + blend * (profile.maneuver.highGRate - 1), 14)
    expect(control.request.yaw / plain.request.yaw).toBeCloseTo(1 + blend * 0.4, 14)
  }
  const original = envelopeModule.stepEnvelope
  let allowance = 1
  const spy = vi.spyOn(envelopeModule, 'stepEnvelope').mockImplementation((...args) => {
    const result = original(...args)
    result.envelope.hardTurnBlend = blend
    result.envelope.gAllowance = allowance
    return result
  })
  try {
    const states = [1, 2.5].map(value => {
      allowance = value
      const state = structuredClone(initial)
      stepFlight(state, command, dt)
      const forces = state.flightForces!
      const turnDrag = profile.flight.turnDrag * (state.rates.pitch ** 2 + state.rates.yaw ** 2)
        * (1 + blend * (profile.maneuver.highGDrag - 1))
      const baseDrag = profile.flight.drag * flow.airspeed ** 2 * (1 + forces.separation * (profile.stall.dragMultiplier - 1))
      expect(state.maneuver.drag).toBeCloseTo(baseDrag + turnDrag + forces.alphaDrag + forces.betaDrag, 12)
      return state
    })
    expect(states[0].rates).toEqual(states[1].rates)
    expect(states[0].maneuver.drag).toBe(states[1].maneuver.drag)
  } finally {
    spy.mockRestore()
  }
})

it.each([60, 120].flatMap(speed => [
  { speed, pitch: 0.5, yaw: 1 },
  { speed, pitch: 1, yaw: 1 },
  { speed, pitch: 0.8, yaw: 0 },
  { speed, pitch: 1, yaw: 0 },
]))('Rev. 4 combined incidence preserves cross-axis pitch and clears pure outward restriction within 0.2 s ($speed m/s, pitch=$pitch, yaw=$yaw)', ({ speed, pitch, yaw }) => {
  const state = createAircraft('f22'), profile = getFlightProfile('f22')
  const alpha = 10 * Math.PI / 180, beta = -60 * Math.PI / 180
  state.orientation = { x: 0, y: 0, z: 0, w: 1 }
  state.velocity = { x: speed * Math.cos(alpha) * Math.cos(beta),
    y: -speed * Math.sin(alpha) * Math.cos(beta), z: speed * Math.sin(beta) }
  state.limiterOpen = 0
  const flow = observeAirflow(state, profile)
  expect(flow.alphaDeg).toBeCloseTo(10, 12)
  expect(flow.betaDeg).toBeCloseTo(-60, 12)
  expect(flow.incidenceDeg).toBeGreaterThan(profile.aero.alphaNormalDeg)

  // Rev. 4 supersedes the historical zero-first-pitch assertion; measured
  // before/after values are archived in phase45-implementation-report.md.
  // No C, brake or burner: natural flow recovery / the demanded H latch must
  // clear the restriction, including yaw held outward to sustain the sideslip.
  let firstPositiveStep: number | null = null
  const steps = Math.round(0.2 / dt)
  for (let step = 1; step <= steps; step++) {
    stepFlight(state, { ...neutralCommand(step, state.id), pitch, yaw }, dt)
    const request = state.flightForces!.allocation.request.pitch
    if (step === 1) {
      if (yaw !== 0) expect(request).toBeGreaterThan(0)
      else expect(Math.abs(request)).toBeLessThan(1e-8)
    }
    if (request > 1e-6) firstPositiveStep ??= step
  }
  expect(firstPositiveStep).not.toBeNull()
  expect(firstPositiveStep!).toBeLessThanOrEqual(steps)
})
