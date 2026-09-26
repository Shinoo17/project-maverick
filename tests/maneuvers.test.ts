// Superseded Phase 2 feel fixtures are retained in benchmarks/flight/legacyManeuvers.report.ts.
import { describe, expect, it } from 'vitest'
import { GameRuntime } from '../src/game/runtime/GameRuntime'
import { neutralCommand } from '../src/game/runtime/commands'
import { stepFlight } from '../src/game/flight/stepFlight'
const make = () => new GameRuntime({ mode: 'playground', mapId: 'flat-range', aircraftIds: ['f22'] })
describe('P2 maneuvers (Phase 6: no PSM phase, entry envelope or C)', () => {
  it('freezes flight state while paused and resets to the spawn', () => {
    const r = make(); r.reset('cobra'); r.start()
    r.advance(1 / 60, (tick, id) => ({ ...neutralCommand(tick, id), airbrake: true, pitch: 1 }))
    const paused = r.snapshot(); r.pause(); r.advance(1); expect(r.snapshot()).toEqual(paused)
    r.reset('free'); expect(r.snapshot()).toEqual(make().snapshot())
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
    const snapshots = [30, 60, 144].map(fps => { const r = make(); r.reset('cobra'); r.start(); for (let i = 0; i < fps * 12; i++) r.advance(1 / fps, (tick, id) => ({ ...neutralCommand(tick, id), airbrake: tick < 130, pitch: tick < 50 ? 1 : tick < 100 ? -1 : 0, afterburner: tick > 300 && tick < 500 })); return r.snapshot() })
    expect(snapshots[1]).toEqual(snapshots[0]); expect(snapshots[2]).toEqual(snapshots[0])
  })
})

import { FlightInput } from '../src/game/input/FlightInput'
import { positionalHorizon } from './invariants/helpers'
import { runFlightReplay } from '../src/game/playground/replay'
describe('P2 playground lifecycle', () => {
  it('maps Space to the airbrake, leaves X and C unbound, and blends the inverted mouse frame with incidence', () => {
    const input = new FlightInput(positionalHorizon)
    for (const code of ['KeyX', 'KeyC']) {
      input.press(code); expect(input.command(0, 'a', 'keyboard')).toEqual(neutralCommand(0, 'a')); input.held.delete(code)
    }
    input.press('Space'); expect(input.command(0, 'a', 'keyboard')).toEqual({ ...neutralCommand(0, 'a'), airbrake: true }); input.held.delete('Space')
    input.engage(); input.move(0, -input.gate.radius); input.screen = { angle: Math.PI, blend: 1 }
    expect(input.command(0, 'a', 'mouse').pitch).toBe(-1)
    input.press('Space'); expect(input.command(1, 'a', 'mouse').pitch).toBe(-1)
    input.held.delete('Space'); input.highAoa = 0.5
    expect(input.command(2, 'a', 'mouse').pitch).toBeCloseTo(0, 12)
    input.highAoa = 1
    expect(input.command(2, 'a', 'mouse').pitch).toBe(1)
    input.clear(); expect(input.command(3, 'a', 'mouse')).toEqual(neutralCommand(3, 'a'))
  })
  it('uses the selected spawn, single-steps only while paused, and replays exported commands exactly', () => {
    const r = make(); r.reset('cobra'); r.start(); r.pause()
    expect(r.snapshot().aircraft[0].position.y).toBe(700)
    r.singleStep(); expect(r.snapshot().tick).toBe(1)
    r.advance(1); expect(r.snapshot().tick).toBe(1)
    r.resume(); r.singleStep(); expect(r.snapshot().tick).toBe(1)
    for (let i = 0; i < 600; i++) r.advance(1 / 60, (tick, id) => ({ ...neutralCommand(tick, id), airbrake: tick > 2 && tick < 130, pitch: tick < 50 ? 1 : tick < 100 ? -1 : 0 }))
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
