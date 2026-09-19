// Superseded Phase 2 feel fixtures are retained in benchmarks/flight/legacyPoweredPsm.report.ts.
import { observeAirflow } from '../src/game/flight/airflow'
import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { GameRuntime } from '../src/game/runtime/GameRuntime'
import { neutralCommand, type PilotCommand } from '../src/game/runtime/commands'
import { FLIGHT_STEP as dt } from '../src/game/runtime/clock'
import { getFlightProfile, validateFlightProfile } from '../src/game/flight/profile'
import { stepFlight } from '../src/game/flight/stepFlight'
import { stepManeuvers } from '../src/game/flight/maneuvers'
import { nozzleDirection, thrustForces, tvcTargets } from '../src/game/flight/thrustVectoring'
import { runFlightReplay } from '../src/game/playground/replay'

function aircraft(id = 'f22', speed = 100) {
  const s = new GameRuntime({ mode: 'playground', aircraftIds: [id] }).snapshot().aircraft[0]
  s.position.y = 2000; s.velocity = { x: speed, y: 0, z: 0 }
  return s
}
function fly(s: ReturnType<typeof aircraft>, seconds: number, input: Partial<PilotCommand>) {
  for (let tick = 0; tick < Math.round(seconds / dt); tick++) {
    stepFlight(s, { ...neutralCommand(tick, s.id), ...input }, dt)
  }
}
const speedOf = (s: ReturnType<typeof aircraft>) => Math.hypot(s.velocity.x, s.velocity.y, s.velocity.z)

describe('held, thrust-powered PSM', () => {

  it('retains entry history and blend when chaining, and uses a separate overspeed exit', () => {
    const s = aircraft(), input = { ...neutralCommand(0, s.id), psmArm: true, roll: 1 }
    for (let i = 0; i < 120; i++) stepManeuvers(s, input, dt, observeAirflow(s, getFlightProfile(s.aircraftId)))
    s.maneuver.peakAlpha = 120; s.maneuver.rotation = 7
    stepManeuvers(s, { ...input, psmArm: false }, dt, observeAirflow(s, getFlightProfile(s.aircraftId)))
    const before = s.maneuver.blend
    stepManeuvers(s, input, dt, observeAirflow(s, getFlightProfile(s.aircraftId)))
    expect(s.maneuver.phase).toBe('active')
    expect(s.maneuver.blend - before).toBeLessThan(0.02)
    expect(s.maneuver.peakAlpha).toBe(120)
    expect(s.maneuver.rotation).toBe(7)
    expect(s.maneuver.entrySpeed).toBe(100)
    s.velocity.x = 125
    stepManeuvers(s, input, dt, observeAirflow(s, getFlightProfile(s.aircraftId)))
    expect(s.maneuver.phase).toBe('active')
    s.velocity.x = 136
    stepManeuvers(s, input, dt, observeAirflow(s, getFlightProfile(s.aircraftId)))
    expect(s.maneuver.phase).toBe('recovery')
    s.velocity.x = 125
    stepManeuvers(s, input, dt, observeAirflow(s, getFlightProfile(s.aircraftId)))
    expect(s.maneuver.phase).toBe('recovery')
    s.velocity.x = 100
    stepManeuvers(s, input, dt, observeAirflow(s, getFlightProfile(s.aircraftId)))
    expect(s.maneuver.phase).toBe('active')
  })

  it.each(['f22', 'su57'])('gives more post-stall control with thrust, and none of the powered assist at zero thrust: %s', id => {
    const idle = aircraft(id, 0), powered = structuredClone(idle)
    for (const s of [idle, powered]) {
      s.stall.severity = 1; s.maneuver.phase = 'active'; s.maneuver.blend = 1
    }
    fly(idle, dt, { psmArm: true, pitch: 1 })
    expect(idle.enginePower).toBe(0)
    expect(idle.maneuver.controlAuthority).toBe(0)
    fly(powered, 0.75, { psmArm: true, pitch: 1, speedAdjust: 1 })
    fly(idle, 0.75 - dt, { psmArm: true, pitch: 1 })
    expect(powered.rates.pitch).toBeGreaterThan(idle.rates.pitch * 3)
    expect(powered.maneuver.controlAuthority).toBeGreaterThan(0.9)
    expect(powered.maneuver.phase).toBe('active')
  })

  it.each(['f22', 'su57'])('keeps TVC and translation at full stall with no C, even while braking: %s', id => {
    const s = aircraft(id, 20), withoutTvc = structuredClone(s)
    s.stall.severity = withoutTvc.stall.severity = 1
    const p = getFlightProfile(id), tvc = p.thrustVectoring
    fly(s, 0.8, { speedAdjust: 1, airbrake: true, pitch: 1, yaw: id === 'su57' ? 1 : 0 })
    try {
      p.thrustVectoring = null
      fly(withoutTvc, 0.8, { speedAdjust: 1, airbrake: true, pitch: 1, yaw: id === 'su57' ? 1 : 0 })
    } finally { p.thrustVectoring = tvc }
    expect(s.maneuver.phase).toBe('normal')
    expect(s.stall.severity).toBe(1)
    expect(s.enginePower).toBeGreaterThan(0.4)
    expect(s.rates.pitch).toBeGreaterThan(withoutTvc.rates.pitch)
    expect(new Vector3().copy(s.velocity).distanceTo(new Vector3().copy(withoutTvc.velocity))).toBeGreaterThan(0.1)
    expect(s.position.y).toBeLessThan(2000)
  })

  it('lets brake oppose thrust without disabling dry power or afterburner', () => {
    for (const afterburner of [false, true]) {
      const plain = aircraft(), braking = structuredClone(plain)
      fly(plain, 1, { speedAdjust: 1, afterburner })
      fly(braking, 1, { speedAdjust: 1, afterburner, airbrake: true })
      expect(braking.enginePower).toBeGreaterThan(0.4)
      expect(speedOf(braking)).toBeLessThan(speedOf(plain))
      expect(braking.maneuver.burnerActive).toBe(afterburner)
    }
    const s = aircraft()
    fly(s, 1, { psmArm: true, pitch: 1, airbrake: true, afterburner: true })
    expect(s.maneuver.phase).toBe('active')
    expect(s.maneuver.burnerActive).toBe(true)
    expect(s.maneuver.burner).toBeLessThan(1)
  })

  it.each(['f22', 'su57'])('does not create mechanical energy by toggling PSM: %s', id => {
    const s = aircraft(id), p = getFlightProfile(id).flight
    const energy = () => 0.5 * speedOf(s) ** 2 + p.gravity * s.position.y
    const initial = energy()
    // Neutral speed-hold only replaces base drag. Maneuvers must cost energy.
    for (let tick = 0; tick < 600; tick++) {
      stepFlight(s, { ...neutralCommand(tick, s.id), psmArm: tick % 24 < 12, yaw: 1 }, dt)
      expect(energy()).toBeLessThanOrEqual(initial + 0.1)
    }
  })
})

describe('canted TVC geometry and replay', () => {
  it('preserves thrust magnitude, produces coupled yaw/roll, and scales moments with thrust', () => {
    const p = getFlightProfile('su57').thrustVectoring!
    for (const side of ['left', 'right'] as const) {
      const v = nozzleDirection(18, side, p)
      expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(1, 12)
    }
    const angles = { ...tvcTargets({ pitch: 0, yaw: 1, roll: 0 }, 1, p), authority: 1 }
    const full = thrustForces(angles, 40, p), half = thrustForces(angles, 20, p)
    expect(full.acceleration.z).toBeLessThan(0)
    expect(full.angularAcceleration.yaw).toBeGreaterThan(0)
    expect(full.angularAcceleration.roll).toBeGreaterThan(0)
    expect(half.angularAcceleration.yaw).toBeCloseTo(full.angularAcceleration.yaw / 2)
    expect(thrustForces(angles, 0, p).torquePerMass).toEqual({ x: 0, y: 0, z: 0 })
    const reverse = thrustForces({ left: -angles.left, right: -angles.right, authority: 1 }, 40, p)
    expect(reverse.angularAcceleration.yaw).toBeCloseTo(-full.angularAcceleration.yaw)
  })

  it('rejects unusable transition/thrust settings and exit thresholds', () => {
    for (const [key, value] of [['blendSeconds', 0], ['fullControlThrust', 0], ['exitSpeed', 115]] as const) {
      const p = structuredClone(getFlightProfile('f22')); p.maneuver[key] = value
      expect(() => validateFlightProfile(p)).toThrow(`maneuver.${key}`)
    }
  })

  it('replays Su-57 continuous PSM, brake/burner and nozzle travel at 30/60/144 FPS', () => {
    const snapshots = [30, 60, 144].map(fps => {
      const r = new GameRuntime({ mode: 'playground', aircraftIds: ['su57'] })
      r.reset('cobra'); r.start()
      for (let frame = 0; frame < fps * 12; frame++) r.advance(1 / fps, (tick, id) => ({
        ...neutralCommand(tick, id), psmArm: tick < 300, pitch: tick < 300 ? 1 : 0,
        yaw: tick < 100 ? 0.2 : 0, speedAdjust: 1, airbrake: tick > 150 && tick < 240,
        afterburner: tick > 150 && tick < 240,
      }))
      expect(runFlightReplay(r.exportReplay())).toEqual(r.snapshot())
      expect(() => runFlightReplay({ ...r.exportReplay(), profileVersion: 'p3-stall-1' })).toThrow()
      r.pause(); const frozen = r.snapshot(); r.advance(1)
      expect(r.snapshot()).toEqual(frozen)
      r.reset(); expect(r.snapshot().aircraft[0].maneuver.blend).toBe(0)
      expect(r.snapshot().aircraft[0].thrustVectoring.left).toBe(0)
      return frozen
    })
    expect(snapshots[1]).toEqual(snapshots[0]); expect(snapshots[2]).toEqual(snapshots[0])
  })
})
