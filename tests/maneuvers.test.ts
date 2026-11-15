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
import { runFlightReplay } from '../src/game/playground/replay'
describe('P2 playground lifecycle', () => {
  // Bindings v2 (flight rewrite FR1): X is the airbrake and Space the PSM override; before, Space was the airbrake and X unbound.
  it('maps X to the airbrake and Space to PSM, and leaves C unbound', () => {
    const input = new FlightInput()
    input.press('KeyC'); expect(input.command(0, 'a', 'keyboard')).toEqual(neutralCommand(0, 'a')); input.held.delete('KeyC')
    input.press('KeyX'); expect(input.command(0, 'a', 'keyboard')).toEqual({ ...neutralCommand(0, 'a'), airbrake: true }); input.held.delete('KeyX')
    input.press('Space'); expect(input.command(0, 'a', 'keyboard')).toEqual({ ...neutralCommand(0, 'a'), psm: true }); input.held.delete('Space')
    input.clear(); expect(input.command(30, 'a', 'mouse')).toEqual(neutralCommand(30, 'a'))
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
