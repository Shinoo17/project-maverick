import { describe, expect, it } from 'vitest'
import { GameRuntime } from '../src/game/runtime/GameRuntime'
import { neutralCommand } from '../src/game/runtime/commands'
import { FLIGHT_STEP } from '../src/game/runtime/clock'
import { runFlightReplay } from '../src/game/playground/replay'
import { stepFlight } from '../src/game/flight/stepFlight'
import { createThrustVectoringState, f22ThrustForces, f22TvcAuthority, f22TvcProfile, f22TvcTargets, stepThrustVectoring } from '../src/game/flight/thrustVectoring'
import { flightExhaustConditions } from '../src/render/exhaust/profile'

const runtime = () => new GameRuntime({ mode: 'playground', aircraftIds: ['f22'] })
const state = () => runtime().snapshot().aircraft[0]
const command = (pitch = 0, roll = 0, yaw = 0) => ({ ...neutralCommand(0, 'aircraft-1'), pitch, roll, yaw })
function actuate(s: ReturnType<typeof state>, input: ReturnType<typeof command>, seconds: number, speed = 130, aoa = 0) {
  for (let i = 0; i < seconds / FLIGHT_STEP; i++) stepThrustVectoring(s, input, FLIGHT_STEP, speed, aoa)
}

describe('F-22 continuous simulation TVC', () => {
  it('has nonzero high-speed authority and continuously grows through speed and AoA, without phase gating', () => {
    const high = f22TvcAuthority(240, 0, 'normal'), medium = f22TvcAuthority(130, 0, 'normal'), low = f22TvcAuthority(40, 0, 'normal')
    expect(high).toBeGreaterThan(0); expect(high).toBeLessThan(.12)
    expect(medium).toBeGreaterThan(high); expect(low).toBeGreaterThan(medium)
    expect(f22TvcAuthority(240, 65, 'normal')).toBe(1)
    expect(f22TvcAuthority(130, 0, 'active')).toBe(1)
    for (let speed = 20; speed < 300; speed++) expect(Math.abs(f22TvcAuthority(speed + .01, 25, 'normal') - f22TvcAuthority(speed, 25, 'normal'))).toBeLessThan(.001)
    for (let aoa = 0; aoa < 180; aoa++) expect(Math.abs(f22TvcAuthority(220, aoa + .01, 'normal') - f22TvcAuthority(220, aoa, 'normal'))).toBeLessThan(.001)
    const s = state(); actuate(s, command(1), 3, 240)
    expect(s.thrustVectoring.left).toBeGreaterThan(1)
    expect(s.thrustVectoring.left).toBeLessThan(2)
  })
  it('mixes pitch and differential roll, independently clamps both sides, and ignores yaw', () => {
    expect(f22TvcTargets(command(1), 1)).toEqual({ left: 20, right: 20 })
    expect(f22TvcTargets(command(-1), 1)).toEqual({ left: -20, right: -20 })
    expect(f22TvcTargets(command(0, 1), 1)).toEqual({ left: -6, right: 6 })
    expect(f22TvcTargets(command(1, 1), 1)).toEqual({ left: 14, right: 20 })
    expect(f22TvcTargets(command(-1, -1), 1)).toEqual({ left: -14, right: -20 })
    const yaw = state(); actuate(yaw, command(0, 0, 1), 3, 45, 90)
    expect(yaw.thrustVectoring.left).toBe(0); expect(yaw.thrustVectoring.right).toBe(0)
    stepFlight(yaw, command(0, 0, 1), FLIGHT_STEP)
    expect(yaw.rates.yaw).toBeGreaterThan(0)
  })
  it('slews with inertia to near both limits and returns smoothly on release in every phase', () => {
    for (const phase of ['normal', 'active', 'recovery'] as const) {
      const s = state(); s.maneuver.phase = phase
      stepThrustVectoring(s, command(1), FLIGHT_STEP, 40, 90)
      expect(s.thrustVectoring.left).toBeGreaterThan(0)
      expect(s.thrustVectoring.left).toBeLessThanOrEqual(f22TvcProfile.actuatorRate * FLIGHT_STEP)
      actuate(s, command(1), 3, 40, 90)
      expect(s.thrustVectoring.left).toBeGreaterThan(19.9)
      let last = s.thrustVectoring.left
      for (let i = 0; i < 360; i++) {
        stepThrustVectoring(s, command(-1, -1), FLIGHT_STEP, 40, 90)
        expect(Math.abs(s.thrustVectoring.left - last)).toBeLessThanOrEqual(f22TvcProfile.actuatorRate * FLIGHT_STEP + 1e-10)
        expect(Math.abs(s.thrustVectoring.left)).toBeLessThanOrEqual(20)
        expect(Math.abs(s.thrustVectoring.right)).toBeLessThanOrEqual(20)
        last = s.thrustVectoring.left
      }
      expect(s.thrustVectoring.right).toBeLessThan(-19.9)
      stepThrustVectoring(s, command(), FLIGHT_STEP, 40, 90)
      expect(s.thrustVectoring.right).toBeLessThan(-19)
      actuate(s, command(), 2, 40, 90)
      expect(Math.abs(s.thrustVectoring.left) + Math.abs(s.thrustVectoring.right)).toBeLessThan(.001)
    }
  })
  it('uses actual angles to redirect thrust and generate correctly signed moments, with no sideways vector', () => {
    const tvc = { left: 20, right: 20, authority: 1 }
    const up = f22ThrustForces(tvc, 50), down = f22ThrustForces({ ...tvc, left: -20, right: -20 }, 50)
    expect(up.acceleration.x).toBeCloseTo(50 * Math.cos(Math.PI / 9))
    expect(up.acceleration.y).toBeCloseTo(-50 * Math.sin(Math.PI / 9))
    expect(up.acceleration.z).toBe(0)
    expect(up.angularAcceleration.pitch).toBeGreaterThan(0); expect(down.angularAcceleration.pitch).toBeLessThan(0)
    expect(up.angularAcceleration.roll).toBe(0); expect(up.angularAcceleration.yaw).toBeCloseTo(0)
    const roll = f22ThrustForces({ ...tvc, left: -6, right: 6 }, 50)
    expect(roll.acceleration.y).toBe(0); expect(roll.acceleration.z).toBe(0)
    expect(roll.angularAcceleration.roll).toBeGreaterThan(0)
    expect(f22ThrustForces(tvc, 0).torquePerMass).toEqual({ x: 0, y: 0, z: 0 })
    expect(f22ThrustForces(tvc, 25).angularAcceleration.pitch).toBeCloseTo(up.angularAcceleration.pitch / 2)
  })
  it('integrates actual actuator torque into attitude even after release and preserves zero-thrust behavior', () => {
    const s = state(), straight = state(); s.thrustVectoring = { left: 15, right: 15, authority: 1 }
    stepFlight(s, command(), FLIGHT_STEP); stepFlight(straight, command(), FLIGHT_STEP)
    const force = f22ThrustForces(s.thrustVectoring, s.enginePower * 50)
    expect(s.rates.pitch).toBeCloseTo(force.angularAcceleration.pitch * FLIGHT_STEP, 10)
    expect(s.orientation.z).toBeGreaterThan(straight.orientation.z)
    expect(s.velocity.y).not.toBe(straight.velocity.y)
    const off = state(); off.thrustVectoring = { left: 15, right: 15, authority: 1 }
    stepFlight(off, { ...command(), airbrake: true }, FLIGHT_STEP)
    expect(off.enginePower).toBe(0); expect(off.rates.pitch).toBe(0)
  })
  it('sends each actual simulation angle to exhaust regardless of pitch rate or maneuver phase', () => {
    const s = state(); s.thrustVectoring = { left: 13, right: -7, authority: .8 }
    s.rates.pitch = -100; s.rates.roll = 100
    const before = structuredClone(s), angles = flightExhaustConditions(s).vectorAngles!
    expect(angles.left).toBeCloseTo(13 * Math.PI / 180)
    expect(angles.right).toBeCloseTo(-7 * Math.PI / 180)
    expect(s).toEqual(before)
  })
  it('freezes, single-steps and resets the actuators with the simulation clock', () => {
    const r = runtime(); r.start()
    r.advance(.1, () => command(1, 1)); r.pause()
    const paused = r.snapshot()
    expect(paused.aircraft[0].thrustVectoring.right).toBeGreaterThan(0)
    r.advance(.1); expect(r.snapshot()).toEqual(paused)
    r.singleStep(command(1, 1))
    expect(r.snapshot().aircraft[0].thrustVectoring.right).toBeGreaterThan(paused.aircraft[0].thrustVectoring.right)
    r.reset(); expect(r.snapshot().aircraft[0].thrustVectoring).toEqual(createThrustVectoringState())
  })
  it('replays mixed control and nozzle inertia identically across render rates, rejecting old physics versions', () => {
    const states = [30, 60, 144].map(fps => {
      const r = runtime(); r.start()
      for (let frame = 0; frame < fps * 4; frame++) r.advance(1 / fps, (tick, id) => ({ ...neutralCommand(tick, id), pitch: tick < 50 ? .7 : tick < 90 ? -.5 : 0, roll: tick < 80 ? .4 : -.2, afterburner: tick > 120 }))
      expect(runFlightReplay(r.exportReplay())).toEqual(r.snapshot())
      expect(() => runFlightReplay({ ...r.exportReplay(), profileVersion: 'p2-grip-3' })).toThrow()
      return r.snapshot()
    })
    expect(states[0]).toEqual(states[1]); expect(states[1]).toEqual(states[2])
  })
})
