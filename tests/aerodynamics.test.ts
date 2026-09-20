import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { aircraftIds, scenarioNames, createAircraft, runScenario, runTrack, scenarioSetup } from '../benchmarks/flight/harness'
import { aeroFlowEffectiveness, controlEffectivenessAt, naturalAerodynamics, naturalRateStep, restoringStiffness } from '../src/game/flight/aerodynamics'
import { observeAirflow } from '../src/game/flight/airflow'
import { getFlightProfile, validateFlightProfile } from '../src/game/flight/profile'
import { separationTarget, stepStall } from '../src/game/flight/stall'
import { stepFlight } from '../src/game/flight/stepFlight'
import { stepSpeed } from '../src/game/flight/speed'
import { FLIGHT_STEP as dt } from '../src/game/runtime/clock'
import { neutralCommand } from '../src/game/runtime/commands'
import { assertAircraftValid } from './invariants/helpers'

const axes = ['pitch', 'yaw', 'roll'] as const
const epsilon = 1e-10

describe.each(aircraftIds)('%s Phase 2 natural aero', id => {
  it('I6: restoring vanishes at aligned/reverse flow; near-antipode perturbations are unstable', () => {
    const state = createAircraft(id), profile = getFlightProfile(id)
    for (const speed of [0, 1e-9, 0.001, 2, 10, 70, 300]) for (const sign of [-1, 1]) {
      state.velocity = { x: sign * speed, y: 0, z: 0 }
      const n = naturalAerodynamics(observeAirflow(state, profile), 1, aeroFlowEffectiveness(observeAirflow(state, profile), profile.aero), state.rates, profile.aero)
      for (const value of Object.values(n.restoring)) expect(Math.abs(value)).toBeLessThan(epsilon)
      expect(n.alphaDrag).toBeGreaterThanOrEqual(0)
      expect(n.betaDrag).toBeGreaterThanOrEqual(0)
    }
    for (const angle of [-179.99, -45, 45, 179.99]) {
      const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), angle * Math.PI / 180)
      state.orientation = { x: q.x, y: q.y, z: q.z, w: q.w }
      state.velocity = { x: 70, y: 0, z: 0 }
      const flow = observeAirflow(state, profile)
      expect(naturalAerodynamics(flow, 1, aeroFlowEffectiveness(flow, profile.aero), state.rates, profile.aero).restoring.pitch * angle).toBeLessThan(0)
    }
  })

  it('uses signed beta to restore sideslip and dissipative q-damping without a floor', () => {
    const state = createAircraft(id), profile = getFlightProfile(id)
    state.rates = { pitch: 1, yaw: -2, roll: 3 }
    for (const z of [-80, 80]) {
      state.velocity = { x: 60, y: 0, z }
      const n = naturalAerodynamics(observeAirflow(state, profile), 0.6, aeroFlowEffectiveness(observeAirflow(state, profile), profile.aero), state.rates, profile.aero)
      expect(n.restoring.yaw * z).toBeGreaterThan(0)
      expect(Math.abs(n.restoring.pitch)).toBe(0)
      const applied = naturalRateStep(n, state.rates, dt)
      for (const axis of axes) {
        expect(n.damping[axis] * state.rates[axis]).toBeLessThanOrEqual(0)
        expect(applied[axis] * state.rates[axis]).toBeLessThanOrEqual(0)
        expect(Math.abs(applied[axis] * dt)).toBeLessThanOrEqual(Math.abs(state.rates[axis]))
      }
    }
    state.velocity = { x: 0, y: 0, z: 0 }
    const n = naturalAerodynamics(observeAirflow(state, profile), 1, aeroFlowEffectiveness(observeAirflow(state, profile), profile.aero), state.rates, profile.aero)
    for (const group of [n.restoring, n.damping]) for (const value of Object.values(group)) expect(Math.abs(value)).toBe(0)
  })

  it('I7: separation and legacy path-grip memory obey authored substep bounds on every trace', () => {
    const profile = getFlightProfile(id)
    for (const scenario of scenarioNames) runScenario(scenario, id, (state, previous) => {
      const flow = observeAirflow(previous, profile)
      const target = separationTarget(flow, profile.stall).target
      const tau = target > previous.stall.severity ? profile.stall.separationEntrySeconds : profile.stall.separationRecoverySeconds
      expect(Math.abs(state.stall.severity - previous.stall.severity)).toBeLessThanOrEqual(1 - Math.exp(-dt / tau) + epsilon)
      expect(state.stall.severity).toBeGreaterThanOrEqual(0)
      expect(state.stall.severity).toBeLessThanOrEqual(1)
      // Legacy path grip has an exponential 99%-response time; debug limiter permission is separate.
      expect(Math.abs(state.maneuver.blend - previous.maneuver.blend)).toBeLessThanOrEqual(1 - Math.exp(-Math.log(100) * dt / profile.maneuver.blendSeconds) + 1e-9)
    })
  })

  it('I8: natural contributions ignore commands, phase labels, burner, TVC and PSM capability', () => {
    const profile = getFlightProfile(id), { state } = scenarioSetup('release45', id)
    state.rates = { pitch: 0.3, yaw: -0.2, roll: 0.1 }
    const copy = structuredClone(state)
    copy.maneuver.phase = 'active'; copy.maneuver.blend = 1
    copy.maneuver.burnerActive = true; copy.enginePower = 1
    stepFlight(state, neutralCommand(0, state.id), dt)
    stepFlight(copy, { ...neutralCommand(0, copy.id), psmArm: true, pitch: 1, yaw: 1, roll: 1, afterburner: true, highG: true, airbrake: true }, dt)
    for (const key of ['naturalRestoring', 'naturalDamping', 'alphaDrag', 'betaDrag', 'separation'] as const) expect(copy.flightForces![key]).toEqual(state.flightForces![key])
    const stripped = structuredClone(profile)
    stripped.maneuver.psmEnabled = false; stripped.thrustVectoring = null
    const flow = observeAirflow(copy, profile)
    expect(naturalAerodynamics(flow, 1, aeroFlowEffectiveness(flow, stripped.aero), copy.rates, stripped.aero)).toEqual(naturalAerodynamics(flow, 1, aeroFlowEffectiveness(flow, profile.aero), copy.rates, profile.aero))
  })

  it('neutral high-incidence controller yields to aero; the contribution ledger reconstructs rates', () => {
    const trace = runScenario('release45', id)
    for (const sample of trace.samples.slice(1)) {
      const f = sample.state.flightForces!
      for (const axis of axes) {
        expect(f.ratesAfter[axis]).toBeCloseTo(f.ratesBefore[axis] + dt * (f.controller[axis] + f.tvc[axis] + f.naturalRestoring[axis] + f.naturalDamping[axis]), 12)
        if (f.highAoa === 1) expect(Math.abs(f.stabilityDamping[axis])).toBe(0)
      }
    }
    const first = trace.samples[1].state.flightForces!
    expect(first.naturalRestoring.pitch).toBeLessThan(0)
    expect(first.controller.pitch).toBe(0)
    expect(first.naturalRestoring.pitch).not.toBe(0)
  })

  it('I1/I2: vertical zero crossing develops reverse flow and remains finite/deterministic', () => {
    const { state } = scenarioSetup('tailSlide', id)
    const trace = runTrack(state, 30, () => ({}), current => assertAircraftValid(current))
    expect(runTrack(state, 30, () => ({})).samples).toEqual(trace.samples)
    expect(trace.samples.some(s => observeAirflow(s.state, getFlightProfile(id)).reverseFlow > 0)).toBe(true)
    // Qualitative liveness only; flip time/amount is a benchmark, not a deadline invariant.
    expect(trace.samples.at(-1)!.state.orientation).not.toEqual(state.orientation)
    expect(trace.samples.at(-1)!.state.velocity).not.toEqual({ x: 0, y: 0, z: 0 })
  })

  it('retains gravity through zero without allowing drag alone to reverse the path', () => {
    const p = getFlightProfile(id), s = scenarioSetup('tailSlide', id).state
    s.velocity = { x: 0, y: p.flight.gravity * dt / 2, z: 0 }
    s.stall.severity = 1
    stepFlight(s, neutralCommand(0, s.id), dt)
    expect(s.velocity.y).toBeLessThan(0)
    assertAircraftValid(s)
    const level = createAircraft(id)
    level.position.y = 2000; level.velocity.x = p.flight.airbrakeDeceleration * dt / 2
    level.maneuver.airbrake = 1
    stepFlight(level, { ...neutralCommand(0, level.id), airbrake: true }, dt)
    expect(level.velocity.x).toBeGreaterThanOrEqual(0)
  })

  it('keeps natural alpha/beta drag outside autothrottle base-drag trim', () => {
    const profile = getFlightProfile(id), { state } = scenarioSetup('sideslip60', id)
    const original = { ...profile.aero }
    const command = neutralCommand(0, state.id)
    const expected = stepSpeed(structuredClone(state), command, dt, 100)
    try {
      profile.aero.alphaDrag *= 10; profile.aero.betaDrag *= 10
      const other = structuredClone(state)
      other.stall.severity = 1; other.maneuver.airbrake = 1
      expect(stepSpeed(other, command, dt, 100).thrust).toBe(expected.thrust)
    } finally { Object.assign(profile.aero, original) }
  })
})

it('I8 import/type boundary exposes only airflow, separation, rates and AeroProfile', () => {
  const source = readFileSync(new URL('../src/game/flight/aerodynamics.ts', import.meta.url), 'utf8')
  expect(source).not.toMatch(/PilotCommand|AircraftState|psmArm|maneuver\.|Math\.random|Date\./)
  expect(source.match(/from ['"].+['"]/g)).toEqual(["from './airflow'", "from './profileTypes'"])
})

it('I6: validates required curves/damping/drag and keeps independent nested aircraft tuning', () => {
  const p = getFlightProfile('f22'), other = structuredClone(getFlightProfile('su57'))
  for (const axis of ['pitch', 'yaw'] as const) {
    const curve = p.aero.restoring[axis]
    for (const knot of curve) expect(restoringStiffness(curve, knot.incidenceDeg)).toBeCloseTo(knot.stiffness, 12)
    for (const knot of curve.slice(1, -1)) expect(Math.abs(restoringStiffness(curve, knot.incidenceDeg - 1e-8) - restoringStiffness(curve, knot.incidenceDeg + 1e-8))).toBeLessThan(1e-8)
    for (const invalid of [undefined, [], [{ incidenceDeg: 0, stiffness: 1 }], [{ incidenceDeg: 0, stiffness: -1 }, { incidenceDeg: 180, stiffness: 1 }], [{ incidenceDeg: 0, stiffness: 1 }, { incidenceDeg: 0, stiffness: 1 }], [{ incidenceDeg: 1, stiffness: 1 }, { incidenceDeg: 180, stiffness: 1 }], [{ incidenceDeg: 0, stiffness: NaN }, { incidenceDeg: 180, stiffness: 1 }]]) {
      const bad = structuredClone(p)
      Object.assign(bad.aero.restoring, { [axis]: invalid })
      expect(() => validateFlightProfile(bad)).toThrow(`aero.restoring.${axis}`)
    }
  }
  for (const axis of axes) {
    const curve = p.aero.controlEffectiveness[axis]
    for (const knot of curve) expect(controlEffectivenessAt(curve, knot.incidenceDeg)).toBeCloseTo(knot.effectiveness, 12)
    for (const invalid of [undefined, [], [{ incidenceDeg: 0, effectiveness: 1 }], [{ incidenceDeg: 0, effectiveness: 1.01 }, { incidenceDeg: 180, effectiveness: 0.1 }], [{ incidenceDeg: 0, effectiveness: -0.01 }, { incidenceDeg: 180, effectiveness: 0.1 }], [{ incidenceDeg: 0, effectiveness: 1 }, { incidenceDeg: 0, effectiveness: 1 }], [{ incidenceDeg: 1, effectiveness: 1 }, { incidenceDeg: 180, effectiveness: 0.1 }], [{ incidenceDeg: 0, effectiveness: 1 }, { incidenceDeg: 90, effectiveness: 0.1 }], [{ incidenceDeg: 0, effectiveness: NaN }, { incidenceDeg: 180, effectiveness: 0.1 }]]) {
      const bad = structuredClone(p)
      Object.assign(bad.aero.controlEffectiveness, { [axis]: invalid })
      expect(() => validateFlightProfile(bad)).toThrow(`aero.controlEffectiveness.${axis}`)
    }
  }
  for (const key of ['alphaDrag', 'betaDrag', 'reverseDrag'] as const) for (const value of [undefined, -1, Infinity, NaN]) {
    const bad = structuredClone(p); Object.assign(bad.aero, { [key]: value })
    expect(() => validateFlightProfile(bad)).toThrow(`aero.${key}`)
  }
  for (const regime of ['attached', 'separated'] as const) for (const axis of axes) for (const value of [undefined, -1, Infinity]) {
    const bad = structuredClone(p); Object.assign(bad.aero.damping[regime], { [axis]: value })
    expect(() => validateFlightProfile(bad)).toThrow(`aero.damping.${regime}.${axis}`)
  }
  const stiffness = p.aero.restoring.pitch[0].stiffness
  try { p.aero.restoring.pitch[0].stiffness = 99; expect(getFlightProfile('su57')).toEqual(other) }
  finally { p.aero.restoring.pitch[0].stiffness = stiffness }
})

it('separation responds continuously to incidence and speed, independent of diagnostic cause', () => {
  const p = getFlightProfile('f22'), s = createAircraft('f22')
  for (const speed of [0, 55, 60, 70]) for (const incidence of [19.999, 20, 20.001, 29.999, 30, 30.001, 180]) {
    s.velocity = { x: speed * Math.cos(incidence * Math.PI / 180), y: -speed * Math.sin(incidence * Math.PI / 180), z: 0 }
    const copy = structuredClone(s); copy.stall.cause = 'speed+aoa'
    const flow = observeAirflow(s, p)
    stepStall(s, p.stall, flow, dt); stepStall(copy, p.stall, flow, dt)
    expect(copy.stall).toEqual(s.stall)
  }
})

describe.each(aircraftIds)('%s flow effectiveness', id => {
  it('is measured from flow geometry alone and fades to attached flow near rest', () => {
    const state = createAircraft(id), profile = getFlightProfile(id)
    let previous = Infinity
    for (const incidence of [0, 10, 25, 25.001, 45, 60, 90, 120, 179.999, 180]) {
      state.velocity = { x: 100 * Math.cos(incidence * Math.PI / 180), y: -100 * Math.sin(incidence * Math.PI / 180), z: 0 }
      const effectiveness = aeroFlowEffectiveness(observeAirflow(state, profile), profile.aero)
      for (const axis of axes) {
        expect(effectiveness[axis]).toBeGreaterThan(0)
        expect(effectiveness[axis]).toBeLessThanOrEqual(1)
      }
      expect(effectiveness.pitch).toBeLessThanOrEqual(previous + epsilon)
      previous = effectiveness.pitch
      // Identical geometry reached through sideslip instead of alpha reads the same.
      state.velocity = { x: 100 * Math.cos(incidence * Math.PI / 180), y: 0, z: 100 * Math.sin(incidence * Math.PI / 180) }
      expect(aeroFlowEffectiveness(observeAirflow(state, profile), profile.aero)).toEqual(effectiveness)
    }
    // Angles carry no meaning near rest, so the curve fades back to attached flow.
    state.velocity = { x: 0, y: -1, z: 0 }
    for (const value of Object.values(aeroFlowEffectiveness(observeAirflow(state, profile), profile.aero))) expect(value).toBe(1)
  })

  it('restoringSeparationIndependence: separation scales damping, never the static restoring moment', () => {
    const state = createAircraft(id), profile = getFlightProfile(id)
    state.rates = { pitch: 0.4, yaw: -0.3, roll: 0.2 }
    state.velocity = { x: 80, y: -30, z: 10 }
    const flow = observeAirflow(state, profile), effectiveness = aeroFlowEffectiveness(flow, profile.aero)
    const attached = naturalAerodynamics(flow, 0, effectiveness, state.rates, profile.aero)
    const separated = naturalAerodynamics(flow, 1, effectiveness, state.rates, profile.aero)
    expect(separated.restoring).toEqual(attached.restoring)
    expect(separated.alphaDrag).toEqual(attached.alphaDrag)
    expect(separated.betaDrag).toEqual(attached.betaDrag)
    for (const axis of axes) expect(Math.abs(separated.damping[axis])).toBeGreaterThan(Math.abs(attached.damping[axis]))
  })

  it('crossflow damps as separated flow even when the pitch-alpha band reports none', () => {
    const state = createAircraft(id), profile = getFlightProfile(id)
    state.rates = { pitch: 0.4, yaw: -0.3, roll: 0.2 }
    // Pure sideslip: alpha stays zero, so separationTarget is speed-driven only.
    state.velocity = { x: 0, y: 0, z: 150 }
    const flow = observeAirflow(state, profile)
    expect(Math.abs(flow.alphaDeg)).toBeLessThan(epsilon)
    expect(separationTarget(flow, profile.stall).target).toBe(0)
    const effectiveness = aeroFlowEffectiveness(flow, profile.aero)
    const crossflow = naturalAerodynamics(flow, 0, effectiveness, state.rates, profile.aero)
    const pretendAttached = naturalAerodynamics(flow, 0, { pitch: 1, yaw: 1, roll: 1 }, state.rates, profile.aero)
    for (const axis of axes) {
      expect(effectiveness[axis]).toBeLessThan(0.2)
      expect(Math.abs(crossflow.damping[axis])).toBeGreaterThan(Math.abs(pretendAttached.damping[axis]))
    }
  })
})
