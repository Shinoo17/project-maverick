import { describe, expect, it } from 'vitest'
import { runTrack } from '../../benchmarks/flight/harness'
import { driftSpawn } from '../../benchmarks/flight/jetDrift'
import { observeAirflow } from '../../src/game/flight/airflow'
import { interpretEnvelope } from '../../src/game/flight/envelope'
import { measureControlDemand, requestControl } from '../../src/game/flight/controller'
import { createPilotIntent, readIntent } from '../../src/game/flight/intent'
import { getFlightProfile, validateFlightProfile } from '../../src/game/flight/profile'
import { stepSpeed } from '../../src/game/flight/speed'
import { neutralCommand, type PilotCommand } from '../../src/game/runtime/commands'
import { FLIGHT_STEP as dt } from '../../src/game/runtime/clock'
import type { AircraftState } from '../../src/game/state/WorldState'

const axes = ['pitch', 'yaw', 'roll'] as const
const ids = ['f22', 'su57', 'f22-notvc'] as const
const withHold = (id: string, hold: number) => {
  const profile = structuredClone(getFlightProfile(id))
  profile.flight.commandedRateHold = { pitch: hold, yaw: hold, roll: hold }
  return profile
}
function control(state: AircraftState, command: PilotCommand, profile: ReturnType<typeof withHold>) {
  const flow = observeAirflow(state, profile), envelope = interpretEnvelope(state, flow, profile)
  const demand = measureControlDemand(command, flow, state.stall.severity, profile, state.limiterOpen)
  return requestControl(command, state.rates, flow, envelope, profile, dt, demand)
}
/** Low-q pedal and level-pull states, sampled every 0.25 s, cover rates inside and beyond the target. */
const states = (id: string) => [
  runTrack(driftSpawn(id, 150), 6, () => ({ yaw: 1, airbrake: true })),
  runTrack(driftSpawn(id, 450), 3, (_s, t) => ({ pitch: t < 1.5 ? 1 : -0.4, yaw: t < 1 ? -0.6 : 0.8, roll: 0.3, airbrake: true })),
].flatMap(trace => trace.samples.filter(sample => sample.step % 30 === 0).map(sample => sample.state))
const commands: Partial<PilotCommand>[] = [{ yaw: 1 }, { yaw: -1 }, { pitch: 1, yaw: 0.5 }, { pitch: -0.4, roll: 1 }, { yaw: 0.2 }]

describe('Phase 8 commanded-rate hold', () => {
  // request + servoDamping is the same for every hold, so wherever allocation grants the
  // whole hold-0 drive the rate change is identical. That is not the same as high q:
  // high incidence is budget-limited at any speed, which is why the hold has a speed band.
  it.each(ids)('%s: hold moves drive out of dissipation without changing the servo total', id => {
    const open = withHold(id, 0), held = withHold(id, 1)
    for (const state of states(id)) for (const partial of commands) {
      const command = { ...neutralCommand(0, state.id), ...partial }
      const a = control(state, command, open), b = control(state, command, held)
      for (const axis of axes) {
        expect(b.request[axis] + b.servoDamping[axis]).toBeCloseTo(a.request[axis] + a.servoDamping[axis], 9)
        // Hold only moves drive out of dissipation: damping stays dissipative, the drive
        // keeps the target's sign and never grows past the hold-0 drive.
        expect(b.servoDamping[axis] * state.rates[axis]).toBeLessThanOrEqual(1e-12)
        expect(Math.abs(b.servoDamping[axis] * dt)).toBeLessThanOrEqual(Math.abs(state.rates[axis]) + 1e-12)
        expect(b.request[axis] * a.request[axis]).toBeGreaterThanOrEqual(0)
        expect(Math.abs(b.request[axis])).toBeLessThanOrEqual(Math.abs(a.request[axis]) + 1e-9)
      }
    }
  })

  it('shipping profiles hold yaw only; pitch and roll keep the Phase 3 no-sustain contract', () => {
    for (const id of ids) expect(getFlightProfile(id).flight.commandedRateHold).toEqual({ pitch: 0, yaw: 1, roll: 0 })
    const state = driftSpawn('su57', 150), profile = getFlightProfile('su57')
    state.rates = { pitch: 0.01, yaw: 0.01, roll: 0.01 }
    const command = { ...neutralCommand(0, state.id), pitch: 1, yaw: 1, roll: 1 }
    const result = control(state, command, profile), blend = 1 - Math.exp(-profile.flight.rateResponse * dt)
    // A rate below the target: yaw is left to natural aero, pitch and roll are still damped.
    expect(Math.abs(result.servoDamping.yaw)).toBe(0)
    expect(result.servoDamping.pitch).toBeCloseTo(-0.01 * blend / dt, 12)
    expect(result.servoDamping.roll).toBeLessThan(0)
  })

  it('the hold fades out across the speed band, back to the Phase 3 servo above it', () => {
    const profile = getFlightProfile('su57'), { full, zero } = profile.flight.commandedRateHoldSpeedKph
    const blend = 1 - Math.exp(-profile.flight.rateResponse * dt)
    const damping = (kph: number) => {
      const state = driftSpawn('su57', kph)
      state.rates = { pitch: 0, yaw: 0.01, roll: 0 }
      return control(state, { ...neutralCommand(0, state.id), yaw: 1 }, profile).servoDamping.yaw
    }
    expect(Math.abs(damping(full))).toBe(0)
    expect(damping(zero)).toBeCloseTo(-0.01 * blend / dt, 12)
    expect(damping(700)).toBeCloseTo(-0.01 * blend / dt, 12)
    const middle = damping((full + zero) / 2)
    expect(middle).toBeLessThan(0); expect(middle).toBeGreaterThan(-0.01 * blend / dt)
  })

  it('a yaw rate above the target and a counter-steered yaw rate are still damped', () => {
    const state = driftSpawn('su57', 150), profile = getFlightProfile('su57')
    for (const [rate, yaw] of [[5, 1], [-0.5, 1]] as const) {
      state.rates = { pitch: 0, yaw: rate, roll: 0 }
      const result = control(state, { ...neutralCommand(0, state.id), yaw }, profile)
      expect(result.servoDamping.yaw * rate).toBeLessThan(0)
    }
  })

  it('validates the hold speed band', () => {
    for (const band of [{ full: 300, zero: 300 }, { full: -1, zero: 300 }, { full: NaN, zero: 300 }, undefined]) {
      const profile = structuredClone(getFlightProfile('f22'))
      profile.flight.commandedRateHoldSpeedKph = band as { full: number; zero: number }
      expect(() => validateFlightProfile(profile, 'plane')).toThrow('plane.flight.commandedRateHoldSpeedKph')
    }
  })

  it('validates hold and axis weights as 0..1 per axis', () => {
    for (const key of ['commandedRateHold', 'controlPowerAxisWeight'] as const) for (const axis of axes) {
      for (const value of [undefined, NaN, -0.01, 1.01]) {
        const profile = structuredClone(getFlightProfile('f22'))
        profile.flight[key][axis] = value as number
        expect(() => validateFlightProfile(profile, 'plane')).toThrow(`plane.flight.${key}.${axis}`)
      }
    }
  })
})

describe('Phase 8 per-axis control power', () => {
  const intentFor = (commands: Partial<PilotCommand>[]) => commands.reduce((intent, partial) =>
    readIntent({ ...neutralCommand(0, 'a'), ...partial }, intent, dt, 0), createPilotIntent())

  it('axis share is input only, sums to one and holds through neutral', () => {
    expect(intentFor([]).axisShare).toEqual({ pitch: 0, yaw: 0, roll: 0 })
    const mixed = intentFor([{ pitch: 1, yaw: 0.5 }]).axisShare
    expect(mixed.pitch).toBeCloseTo(0.8, 12); expect(mixed.yaw).toBeCloseTo(0.2, 12); expect(mixed.roll).toBe(0)
    expect(intentFor([{ yaw: -1 }, {}, {}]).axisShare).toEqual({ pitch: 0, yaw: 1, roll: 0 })
  })

  it('weights control power by the stick split and reads no drag or speed error', () => {
    const p = getFlightProfile('su57').flight
    const power = (commands: Partial<PilotCommand>[]) => {
      const state = driftSpawn('su57', 150)
      state.intent = intentFor(commands)
      return stepSpeed(state, { ...neutralCommand(0, state.id), ...commands.at(-1) }, dt, 42, 1).power.controlPower
    }
    expect(power([{ pitch: 1 }])).toBe(p.controlPower)
    expect(power([{ yaw: 1 }])).toBeCloseTo(p.controlPower * p.controlPowerAxisWeight.yaw, 12)
    expect(power([{ pitch: 1, yaw: 1 }])).toBeCloseTo(p.controlPower * (1 + p.controlPowerAxisWeight.yaw) / 2, 12)
    // Releasing the pedal keeps the yaw weighting for the continuation tail.
    expect(power([{ yaw: 1 }, {}])).toBeCloseTo(p.controlPower * p.controlPowerAxisWeight.yaw, 12)
    // No input history leaves the Phase 4.5C request unweighted.
    expect(power([])).toBe(p.controlPower)
  })
})
