import { describe, expect, it } from 'vitest'
import { GameRuntime } from '../src/game/runtime/GameRuntime'
import { neutralCommand } from '../src/game/runtime/commands'
import { stepSpeed, dryThrustLimit } from '../src/game/flight/speed'
import { stepEngine, stepBurner } from '../src/game/flight/engine'
import { getFlightProfile, validateFlightProfile } from '../src/game/flight/profile'
import { createPilotIntent, readIntent } from '../src/game/flight/intent'

const state = () => new GameRuntime({ mode: 'playground', aircraftIds: ['f22'] }).snapshot().aircraft[0]
const dt = 1 / 120

describe('engine and player intent separation', () => {
  it('spools toward requested power with exact exponential, sharing actual thrust', () => {
    const s = state(), p = getFlightProfile(s.aircraftId), initial = s.enginePower
    const dry = dryThrustLimit(p.flight, s.speedLimits)
    const thrust = stepEngine(s, 1, dry, p.engine, dt)
    expect(s.enginePower).toBe(initial + (1 - initial) * (1 - Math.exp(-p.engine.spoolUpResponse * dt)))
    expect(thrust).toBe(s.engine.actualThrust)
    expect(thrust).toBe(s.enginePower * dry)
    expect(s.enginePower).toBeLessThan(s.engine.requestedPower)
    const before = s.enginePower
    stepEngine(s, 0, dry, p.engine, dt)
    expect(s.enginePower).toBeCloseTo(before * Math.exp(-p.engine.spoolDownResponse * dt), 14)
  })
  it('I17: governor does not compensate separation, alpha/beta drag, airbrake or nozzle angle', () => {
    const plain = state(), dirty = structuredClone(plain), p = getFlightProfile('f22')
    dirty.stall.severity = 1; dirty.maneuver.airbrake = 1
    dirty.thrustVectoring.left = 20; dirty.thrustVectoring.right = -20
    const input = neutralCommand(0, plain.id)
    const a = stepSpeed(plain, input, dt, 100)
    const old = { alphaDrag: p.aero.alphaDrag, betaDrag: p.aero.betaDrag }
    try {
      p.aero.alphaDrag = 10; p.aero.betaDrag = 10
      const b = stepSpeed(dirty, { ...input, airbrake: true }, dt, 100)
      expect(dirty.engine).toEqual(plain.engine)
      expect(b.thrust).toBe(a.thrust)
      expect(b.braking).toBeGreaterThan(a.braking)
    } finally { Object.assign(p.aero, old) }
  })
  it('the untouched throttle holds its setting: it follows speed down, never up', () => {
    const s = state(), input = neutralCommand(0, s.id), p = getFlightProfile('f22').flight
    stepSpeed(s, input, dt, 100)
    expect(s.throttleHoldMps).toBe(100)
    // A dive or a fall adds no thrust: the trim stays at the setting's speed.
    expect(stepSpeed(s, input, dt, 140).power.baseTrim).toBeCloseTo(p.drag * 100 ** 2, 12)
    // Speed lost in a turn or climb lowers the setting, so nothing pushes it back.
    stepSpeed(s, input, dt, 70)
    expect(stepSpeed(s, input, dt, 90).power.baseTrim).toBeCloseTo(p.drag * 70 ** 2, 12)
    // W, S and the burner set it to the speed they reach.
    stepSpeed(s, { ...input, speedAdjust: 1 }, dt, 120)
    expect(s.throttleHoldMps).toBe(120)
    s.speedDrive = 0
    stepSpeed(s, { ...input, afterburner: true }, dt, 150)
    expect(s.throttleHoldMps).toBe(150)
  })
  it('burner exhausts its reserve and unlocks only after recharge', () => {
    const s = state(), p = getFlightProfile('f22').maneuver
    s.maneuver.burner = dt / p.burnerSeconds
    stepBurner(s.maneuver, true, p, dt)
    expect(s.maneuver.burnerLocked).toBe(true)
    stepBurner(s.maneuver, true, p, dt)
    expect(s.maneuver.burnerActive).toBe(false)
    for (let i = 0; i < Math.ceil((1 + p.burnerRecharge / 4) / dt); i++) stepBurner(s.maneuver, false, p, dt)
    expect(s.maneuver.burnerLocked).toBe(false)
  })
  it('power intent reads keys even when reserve is empty, never autothrottle trim', () => {
    const input = neutralCommand(0, 'a')
    expect(readIntent(input, createPilotIntent(), dt, 1).powerIntent).toBe(0)
    expect(readIntent({ ...input, speedAdjust: 1 }, createPilotIntent(), dt, 1).powerIntent).toBe(0.4)
    expect(readIntent({ ...input, afterburner: true, airbrake: true }, createPilotIntent(), dt, 1).powerIntent).toBe(1)
  })
  it('validates required finite positive spool rates', () => {
    for (const value of [0, -1, NaN, Infinity, undefined]) {
      const p = structuredClone(getFlightProfile('f22'))
      p.engine.spoolUpResponse = value as number
      expect(() => validateFlightProfile(p)).toThrow('engine.spoolUpResponse')
    }
  })
})
