// Superseded Phase 2 feel fixtures are retained in benchmarks/flight/legacyManeuvers.report.ts.
import { getFlightProfile } from '../src/game/flight/profile'
import { observeAirflow } from '../src/game/flight/airflow'
import { describe, expect, it } from 'vitest'
import { GameRuntime } from '../src/game/runtime/GameRuntime'
import { neutralCommand, type PilotCommand } from '../src/game/runtime/commands'
import { stepManeuvers } from '../src/game/flight/maneuvers'
import { stepFlight } from '../src/game/flight/stepFlight'
const make = () => new GameRuntime({ mode: 'playground', mapId: 'flat-range', aircraftIds: ['f22'] })
const speed = (v: { x: number; y: number; z: number }) => Math.hypot(v.x, v.y, v.z)
describe('P2 maneuvers', () => {
  it('never pitches, brakes or accelerates merely from holding C', () => {
    for (const entry of [105, 130]) {
      const plain = make().snapshot().aircraft[0], armed = make().snapshot().aircraft[0]
      plain.velocity.x = armed.velocity.x = entry
      for (let i = 0; i < 360; i++) {
        stepFlight(plain, neutralCommand(i, plain.id), 1 / 120)
        stepFlight(armed, { ...neutralCommand(i, armed.id), psmArm: true }, 1 / 120)
      }
      expect(armed.position).toEqual(plain.position); expect(armed.orientation).toEqual(plain.orientation)
      expect(armed.velocity).toEqual(plain.velocity); expect(armed.maneuver.airbrake).toBe(0)
      expect(armed.maneuver.phase).toBe(entry === 105 ? 'armed' : 'normal')
    }
  })

  it('enforces entry speed/altitude and keeps a held maneuver active beyond old budgets', () => {
    for (const [entry, altitude] of [[64, 400], [116, 400], [105, 149]]) {
      const s = make().snapshot().aircraft[0]; s.velocity.x = entry; s.position.y = altitude
      stepFlight(s, { ...neutralCommand(0, s.id), psmArm: true, pitch: 1, speedAdjust: 1 }, 1 / 120)
      expect(s.maneuver.phase).toBe('normal')
    }
    for (const entry of [65, 115]) {
      const s = make().snapshot().aircraft[0]; s.velocity.x = entry
      stepFlight(s, { ...neutralCommand(0, s.id), psmArm: true, pitch: 1, speedAdjust: 1 }, 1 / 120)
      expect(s.maneuver.phase).toBe('active')
    }
    const safe = make().snapshot().aircraft[0]
    safe.velocity.x = 105
    const held = { ...neutralCommand(0, safe.id), psmArm: true, pitch: 1 }
    for (let i = 0; i < 1800; i++) {
      safe.maneuver.rotation += 0.1
      stepManeuvers(safe, held, 1 / 120, observeAirflow(safe, getFlightProfile(safe.aircraftId)))
    }
    expect(safe.maneuver.phase).toBe('active')
    expect(safe.maneuver.timer).toBeGreaterThan(14)
    stepManeuvers(safe, neutralCommand(0, safe.id), 1 / 120, observeAirflow(safe, getFlightProfile(safe.aircraftId)))
    expect(safe.maneuver.phase).toBe('recovery')
    stepManeuvers(safe, held, 1 / 120, observeAirflow(safe, getFlightProfile(safe.aircraftId)))
    expect(safe.maneuver.phase).toBe('active')
  })
  it('releases armed mode immediately and freezes maneuver timers while paused', () => {
    const r = make(); r.reset('cobra'); r.start()
    r.advance(1 / 60, (tick, id) => ({ ...neutralCommand(tick, id), psmArm: true }))
    expect(r.snapshot().aircraft[0].maneuver.phase).toBe('armed')
    r.advance(1 / 60); expect(r.snapshot().aircraft[0].maneuver.phase).toBe('normal')
    r.advance(1 / 60, (tick, id) => ({ ...neutralCommand(tick, id), psmArm: true, pitch: 1 }))
    const paused = r.snapshot(); r.pause(); r.advance(1); expect(r.snapshot()).toEqual(paused)
    r.reset('free'); expect(r.snapshot()).toEqual(make().snapshot())
  })
  it('gives High-G extra turning and speed cost only when pulling', () => {
    const fly = (extra: Partial<PilotCommand>) => { const s = make().snapshot().aircraft[0]; for (let i = 0; i < 120; i++) stepFlight(s, { ...neutralCommand(i, s.id), ...extra }, 1 / 120); return s }
    const normal = fly({ pitch: 1 }), hard = fly({ pitch: 1, highG: true })
    expect(hard.rates.pitch).toBeGreaterThan(normal.rates.pitch)
    expect(speed(hard.velocity)).toBeLessThan(speed(normal.velocity))
    expect(speed(fly({ highG: true }).velocity)).toBeCloseTo(130)
  })
  it('drains burner, enforces recharge lock and permits airbrake with burner', () => {
    const s = make().snapshot().aircraft[0]
    for (let i = 0; i < 750; i++) stepFlight(s, { ...neutralCommand(i, s.id), afterburner: true }, 1 / 120)
    expect(s.maneuver.burnerLocked).toBe(true); expect(s.maneuver.burnerActive).toBe(false)
    for (let i = 0; i < 500; i++) stepFlight(s, neutralCommand(i, s.id), 1 / 120)
    expect(s.maneuver.burnerLocked).toBe(false)
    stepFlight(s, { ...neutralCommand(0, s.id), afterburner: true, airbrake: true }, 1 / 120)
    expect(s.maneuver.burnerActive).toBe(true); expect(s.enginePower).toBeGreaterThan(0)
  })
  it('replays PSM and burner identically at 30/60/144 render FPS', () => {
    const snapshots = [30, 60, 144].map(fps => { const r = make(); r.reset('cobra'); r.start(); for (let i = 0; i < fps * 12; i++) r.advance(1 / fps, (tick, id) => ({ ...neutralCommand(tick, id), psmArm: tick < 130, pitch: tick < 50 ? 1 : tick < 100 ? -1 : 0, afterburner: tick > 300 && tick < 500 })); return r.snapshot() })
    expect(snapshots[1]).toEqual(snapshots[0]); expect(snapshots[2]).toEqual(snapshots[0])
  })
})

import { FlightInput } from '../src/game/input/FlightInput'
import { runFlightReplay } from '../src/game/playground/replay'
describe('P2 playground lifecycle', () => {
  it('uses a held modifier and body-axis mouse control through inverted PSM', () => {
    const input = new FlightInput(); input.press('KeyC'); input.held.delete('KeyC')
    expect(input.command(0, 'a', 'keyboard').psmArm).toBe(false)
    input.engage(); input.move(0, -input.gate.radius); input.screen = { angle: Math.PI, blend: 1 }
    expect(input.command(0, 'a', 'mouse').pitch).toBe(-1)
    input.press('KeyC'); expect(input.command(1, 'a', 'mouse').pitch).toBe(1)
    input.held.delete('KeyC'); input.psmControl = true
    expect(input.command(2, 'a', 'mouse').pitch).toBe(1)
    input.clear(); expect(input.command(3, 'a', 'mouse')).toEqual(neutralCommand(3, 'a'))
  })
  it('uses the selected spawn, single-steps only while paused, and replays exported commands exactly', () => {
    const r = make(); r.reset('cobra'); r.start(); r.pause()
    expect(r.snapshot().aircraft[0].position.y).toBe(700)
    r.singleStep(); expect(r.snapshot().tick).toBe(1)
    r.advance(1); expect(r.snapshot().tick).toBe(1)
    r.resume(); r.singleStep(); expect(r.snapshot().tick).toBe(1)
    for (let i = 0; i < 600; i++) r.advance(1 / 60, (tick, id) => ({ ...neutralCommand(tick, id), psmArm: tick > 2 && tick < 130, pitch: tick < 50 ? 1 : tick < 100 ? -1 : 0 }))
    expect(runFlightReplay(r.exportReplay())).toEqual(r.snapshot())
    r.reset(); const first = r.snapshot(); r.reset(); expect(r.snapshot()).toEqual(first)
    expect(r.exportReplay().commands).toHaveLength(0)
  })
  it('measures ring crossings and low-energy recovery from simulation', () => {
    const r = make(); r.start()
    for (let i = 0; i < 420; i++) r.advance(1 / 60)
    expect(r.snapshot().practice.rings).toBe(1)
    r.reset('recovery')
    for (let i = 0; i < 180; i++) r.advance(1 / 60, (tick, id) => ({ ...neutralCommand(tick, id), speedAdjust: 1 }))
    expect(r.snapshot().practice.recovered).toBe(true)
  })
})

// Manual PSM turn-plane feel fixture moved to benchmarks/flight/legacyManeuvers.report.ts.
