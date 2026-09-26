// Phase 3 intentionally replaces instant thrust with spool. Preserve original
// speed/settling measurements as report-only feel targets; safety stays hard.
import { it, expect as assert } from 'vitest'
import { Vector3, PerspectiveCamera } from 'three'
import { GameRuntime } from '../../src/game/runtime/GameRuntime'
import { neutralCommand, type PilotCommand } from '../../src/game/runtime/commands'
import { getFlightProfile } from '../../src/game/flight/profile'
import { arcadeSpeed, simulationSpeed } from '../../src/game/flight/speedLimits'
import { glassState } from '../../src/features/flight/FlightInstruments'
import type { SessionConfig } from '../../src/content/schemas'
import { reportExpect } from './legacyFeel'
import { assertAircraftValid } from '../../tests/invariants/helpers'
const expect = reportExpect('engine-speed')
const speedOf = (state: { velocity: { x: number; y: number; z: number } }) => Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z)
const make = (flightOverrides?: SessionConfig['flightOverrides']) => new GameRuntime({ mode: 'playground', aircraftIds: ['f22'], flightOverrides })
function run(fps: number, seconds: number, track: (tick: number) => Partial<PilotCommand> = () => ({})) {
  const runtime = make(); runtime.start()
  for (let i = 0; i < fps * seconds; i++) { runtime.advance(1 / fps, (tick, id) => ({ ...neutralCommand(tick, id), ...track(tick) })); assertAircraftValid(runtime.snapshot().aircraft[0]) }
  return runtime
}
  it('accelerates and decelerates directly, coasts briefly on release, then holds the reached speed', () => {
    for (const sign of [1, -1]) {
      const runtime = run(60, 1, () => ({ speedAdjust: sign }))
      const speed = () => new Vector3().copy(runtime.snapshot().aircraft[0].velocity).length()
      const held = speed()
      expect((held - 130) * sign).toBeGreaterThan(18)
      for (let i = 0; i < 120; i++) runtime.advance(1 / 60)
      const settled = speed()
      expect((settled - held) * sign).toBeGreaterThan(1)
      expect((settled - held) * sign).toBeLessThan(5)
      for (let i = 0; i < 120; i++) runtime.advance(1 / 60)
      expect(speed()).toBeCloseTo(settled, 6)
      expect(runtime.snapshot().aircraft[0].speedDrive).toBe(0)
    }
    expect(new Vector3().copy(run(60, 8, () => ({ speedAdjust: 1 })).snapshot().aircraft[0].velocity).length()).toBeCloseTo(200)
    expect(new Vector3().copy(run(60, 8, () => ({ speedAdjust: -1 })).snapshot().aircraft[0].velocity).length()).toBeCloseTo(65)
  })
  it.each(['f22', 'su57'])('reaches and holds each powered limit for %s without overshooting', aircraftId => {
    const flight = getFlightProfile(aircraftId).flight
    for (const command of [
      { speedAdjust: 1, afterburner: false },
      { speedAdjust: 0, afterburner: true },
      { speedAdjust: 1, afterburner: true },
    ]) {
      const runtime = new GameRuntime({ mode: 'playground', aircraftIds: [aircraftId] })
      const target = command.afterburner ? flight.afterburnerTopSpeedKph : flight.topSpeedKph
      runtime.start()
      for (let frame = 0; frame < 300; frame++) {
        runtime.advance(1 / 60, (tick, id) => ({ ...neutralCommand(tick, id), ...command }))
        expect(arcadeSpeed(speedOf(runtime.snapshot().aircraft[0]))).toBeLessThanOrEqual(target + 1e-8)
      }
      const state = runtime.snapshot().aircraft[0]
      assertAircraftValid(state); assert(state.alive).toBe(true)
      expect(arcadeSpeed(speedOf(state))).toBeCloseTo(target, 6)
      expect(speedOf(state)).toBeCloseTo(target / (3.6 * 1.5), 6)
    }
  })

  it('reaches higher overridden limits despite the old thrust and 260 m/s drag ceiling', () => {
    const runtime = make({ f22: { topSpeedKph: 2160, afterburnerTopSpeedKph: 2400 } })
    runtime.start()
    for (let frame = 0; frame < 900; frame++) {
      runtime.advance(1 / 60, (tick, id) => ({ ...neutralCommand(tick, id), speedAdjust: 1 }))
    }
    expect(speedOf(runtime.snapshot().aircraft[0])).toBeCloseTo(400, 6)
    for (let frame = 0; frame < 120; frame++) {
      runtime.advance(1 / 60, (tick, id) => ({ ...neutralCommand(tick, id), afterburner: true }))
    }
    const state = runtime.snapshot().aircraft[0]
    assertAircraftValid(state); assert(state.alive).toBe(true)
    expect(speedOf(state)).toBeCloseTo(simulationSpeed(2400), 6)
    const glass = glassState({
      camera: new PerspectiveCamera(), state,
      position: state.position, orientation: state.orientation, velocity: state.velocity,
    })
    expect(glass.speed).toBeCloseTo(2400, 6)
  })