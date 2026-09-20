// Superseded Phase 2 feel fixtures are retained in benchmarks/flight/legacyStall.report.ts.
import { observeAirflow } from '../src/game/flight/airflow'
import { describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { getFlightProfile, validateFlightProfile } from '../src/game/flight/profile'
import { angleOfAttack, createStallState, stepStall, separationTarget } from '../src/game/flight/stall'
import { simulationSpeed } from '../src/game/flight/speedLimits'
import { stepFlight } from '../src/game/flight/stepFlight'
import { GameRuntime } from '../src/game/runtime/GameRuntime'
import { neutralCommand, type PilotCommand } from '../src/game/runtime/commands'
import { runFlightReplay } from '../src/game/playground/replay'
import { dryThrustLimit } from '../src/game/flight/speed'
import { thrustForces } from '../src/game/flight/thrustVectoring'
import type { AircraftState } from '../src/game/state/WorldState'

const dt = 1 / 120
const make = (aircraftId = 'f22') => new GameRuntime({ mode: 'playground', aircraftIds: [aircraftId] })
const speedOf = (s: AircraftState) => Math.hypot(s.velocity.x, s.velocity.y, s.velocity.z)
function pose(speedKph: number, aoaDeg = 0, aircraftId = 'f22') {
  const s = make(aircraftId).snapshot().aircraft[0]
  s.position.y = 2000
  s.velocity.x = simulationSpeed(speedKph)
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), aoaDeg * Math.PI / 180)
  s.orientation = { x: q.x, y: q.y, z: q.z, w: q.w }
  return s
}
function fly(s: AircraftState, seconds: number, input: Partial<PilotCommand> = {}) {
  for (let tick = 0; tick < Math.round(seconds / dt); tick++) {
    stepFlight(s, { ...neutralCommand(tick, s.id), ...input }, dt)
    expect(s.alive).toBe(true)
  }
}

describe('stall envelope', () => {
  it('measures signed body-plane incidence, including inverted and backward flight, independently of sideslip', () => {
    for (const angle of [-170, -45, 0, 45, 170]) {
      const s = pose(700, angle)
      expect(angleOfAttack(s)).toBeCloseTo(angle)
      // Rotate the entire scene: incidence must not depend on world attitude.
      const bank = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI)
      const q = bank.clone().multiply(new Quaternion().copy(s.orientation))
      s.orientation = { x: q.x, y: q.y, z: q.z, w: q.w }
      Object.assign(s.velocity, new Vector3().copy(s.velocity).applyQuaternion(bank))
      expect(angleOfAttack(s)).toBeCloseTo(angle)
    }
    const side = pose(700)
    side.velocity.z = 200
    expect(angleOfAttack(side)).toBe(0)
    stepStall(side, getFlightProfile(side.aircraftId).stall, observeAirflow(side, getFlightProfile(side.aircraftId)), dt)
    expect(side.stall.cause).toBe('none')
    side.velocity = { x: 0, y: 0, z: 100 }
    expect(angleOfAttack(side)).toBe(0)
    side.velocity = { x: -100, y: 0, z: 0 }
    expect(Math.abs(angleOfAttack(side))).toBe(180)
  })

  it.each([[290, 0, 'speed'], [700, 45, 'aoa'], [290, -45, 'speed+aoa']] as const)(
    'detects %s km/h, %s° as %s and builds severity gradually', (speed, angle, cause) => {
      const s = pose(speed, angle), p = getFlightProfile(s.aircraftId).stall
      stepStall(s, p, observeAirflow(s, getFlightProfile(s.aircraftId)), dt)
      expect(s.stall.cause).toBe(cause)
      expect(s.stall.severity).toBeCloseTo(separationTarget(observeAirflow(s, getFlightProfile(s.aircraftId)), p).target * (1 - Math.exp(-dt / p.separationEntrySeconds)), 14)
      for (let tick = 1; tick < 60; tick++) stepStall(s, p, observeAirflow(s, getFlightProfile(s.aircraftId)), dt)
      expect(s.stall.severity).toBeGreaterThan(0)
    })

  it('uses continuous targets and exponential memory, without threshold hysteresis', () => {
    const s = pose(340, 25), p = getFlightProfile(s.aircraftId)
    const flow = observeAirflow(s, p)
    const { target } = separationTarget(flow, p.stall)
    expect(target).toBeGreaterThan(0)
    expect(target).toBeLessThan(1)
    const split = structuredClone(s)
    stepStall(s, p.stall, flow, dt)
    stepStall(split, p.stall, flow, dt / 2)
    stepStall(split, p.stall, flow, dt / 2)
    expect(split.stall.severity).toBeCloseTo(s.stall.severity, 14)
    s.stall.severity = 1
    stepStall(s, p.stall, flow, dt)
    expect(s.stall.severity).toBeCloseTo(1 + (target - 1) * (1 - Math.exp(-dt / p.stall.separationRecoverySeconds)), 14)
  })

  it('does not advance stalled or stopped simulation state with a nonpositive step', () => {
    const s = pose(200, 60), initial = structuredClone(s)
    for (const delta of [0, -dt]) stepStall(s, getFlightProfile(s.aircraftId).stall, observeAirflow(s, getFlightProfile(s.aircraftId)), delta)
    expect(s).toEqual(initial)
    s.alive = false
    stepStall(s, getFlightProfile(s.aircraftId).stall, observeAirflow(s, getFlightProfile(s.aircraftId)), dt)
    expect(s.stall).toEqual(createStallState())
  })
})

describe('forgiving stall flight', () => {
  it.each(['f22', 'su57'])('keeps S-only deceleration above stall for %s', id => {
    const s = pose(700, 0, id)
    fly(s, 12, { speedAdjust: -1 })
    expect(speedOf(s)).toBeCloseTo(getFlightProfile(id).flight.minPoweredMps)
    expect(s.stall.severity).toBe(0)
    expect(s.position.y).toBe(2000)
  })

  it('preserves actual TVC torque in full stall, while zero engine thrust produces none', () => {
    const p = getFlightProfile('f22')
    for (const speed of [0, 230]) {
      const s = pose(speed)
      if (speed === 0) { s.enginePower = 0; s.engine.actualThrust = 0 }
      s.stall = { severity: 1, cause: 'speed', aoaDeg: 0 }
      s.thrustVectoring = { left: 15, right: 15, authority: 1 }
      stepFlight(s, neutralCommand(0, s.id), dt)
      const thrust = s.enginePower * dryThrustLimit(p.flight, s.speedLimits)
      const torque = thrustForces(s.thrustVectoring, thrust, p.thrustVectoring!)
      expect(s.rates.pitch).toBeCloseTo(torque.angularAcceleration.pitch * p.thrustVectoring!.gain * dt, 10)
      if (speed === 0) expect(s.rates.pitch).toBe(0)
      else expect(s.rates.pitch).toBeGreaterThan(0)
    }
  })

  it('works with PSM disabled, without granting assist to a held C', () => {
    const profile = getFlightProfile('su57'), previous = profile.maneuver.psmEnabled
    profile.maneuver.psmEnabled = false
    try {
      const plain = pose(240, 0, 'su57'), held = structuredClone(plain)
      fly(plain, 2, { pitch: 0.3 })
      fly(held, 2, { pitch: 0.3, psmArm: true })
      expect(held).toEqual(plain)
      expect(held.stall.severity).toBeGreaterThan(0)
      expect(held.maneuver.phase).toBe('normal')
      expect(held.maneuver.blocked).toBe('unsupported')
    } finally { profile.maneuver.psmEnabled = previous }
  })

})

describe('stall configuration and lifecycle', () => {
  it('uses each aircraft envelope and rejects overrides below its recovery speed', () => {
    const p = getFlightProfile('f22'), previous = p.stall
    p.stall = { ...previous, stallSpeedKph: 500, separationAttachedSpeedKph: 550 }
    try {
      const tuned = pose(450), other = pose(450, 0, 'su57')
      fly(tuned, 0.5); fly(other, 0.5)
      expect(tuned.stall.severity).toBeGreaterThan(other.stall.severity)
      expect(other.stall.severity).toBe(0)
      expect(() => new GameRuntime({ mode: 'playground', aircraftIds: ['f22'],
        flightOverrides: { f22: { topSpeedKph: 500 } },
      })).toThrow('flightOverrides.f22.topSpeedKph')
    } finally { p.stall = previous }
  })

  it.each([
    ['stallSpeedKph', 0], ['stallSpeedKph', NaN], ['separationAttachedSpeedKph', 290], ['separationAttachedSpeedKph', 2000],
    ['criticalAoaDeg', 181], ['criticalAoaDeg', 0], ['separationAttachedAoaDeg', 30], ['separationAttachedAoaDeg', -1],
    ['controlAuthority', -0.1], ['controlAuthority', 1.1], ['dragMultiplier', 0.9],
    ['separationEntrySeconds', 0], ['separationRecoverySeconds', Infinity], ['separationRecoverySeconds', 0],
  ] as const)('rejects invalid %s = %s with an actionable path', (key, value) => {
    const p = structuredClone(getFlightProfile('f22'))
    p.stall[key] = value
    expect(() => validateFlightProfile(p, 'test-plane')).toThrow(`test-plane.stall.${key}`)
  })

  it('isolates per-aircraft state and replays stall/recovery identically at 30/60/144 FPS', () => {
    const results = [30, 60, 144].map(fps => {
      const runtime = make()
      runtime.reset('recovery')
      const initial = runtime.snapshot()
      runtime.start()
      let peakStall = 0
      for (let frame = 0; frame < fps * 12; frame++) {
        runtime.advance(1 / fps, (tick, id) => ({ ...neutralCommand(tick, id), airbrake: tick < 100, speedAdjust: tick >= 100 ? 1 : 0 }))
        peakStall = Math.max(peakStall, runtime.snapshot().aircraft[0].stall.severity)
      }
      const final = runtime.snapshot()
      expect(peakStall).toBeGreaterThan(0)
      expect(final.aircraft[0].stall.severity).toBeLessThan(peakStall)
      expect(runFlightReplay(runtime.exportReplay())).toEqual(final)
      expect(() => runFlightReplay({ ...runtime.exportReplay(), profileVersion: 'p3-speed-limits-2' })).toThrow()
      runtime.pause(); runtime.advance(1)
      expect(runtime.snapshot()).toEqual(final)
      runtime.reset()
      expect(runtime.snapshot()).toEqual(initial)
      return final
    })
    expect(results[1]).toEqual(results[0])
    expect(results[2]).toEqual(results[0])
    const runtime = new GameRuntime({ mode: 'offline', aircraftIds: ['f22', 'su57', 'f22'] })
    runtime.start()
    for (let frame = 0; frame < 300; frame++) runtime.advance(1 / 60, (tick, id) => ({ ...neutralCommand(tick, id), airbrake: id === 'aircraft-1' }))
    const snapshot = runtime.snapshot()
    expect(snapshot.aircraft[0].stall.severity).toBeGreaterThan(0)
    expect(snapshot.aircraft[1].stall.severity).toBe(0)
    expect(snapshot.aircraft[2].stall.severity).toBe(0)
    snapshot.aircraft[1].stall.severity = 1
    expect(runtime.snapshot().aircraft[1].stall.severity).toBe(0)
  })
})
