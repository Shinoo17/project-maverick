import { getFlightProfile } from '../src/game/flight/profile'
import { describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import type { SessionConfig } from '../src/content/schemas'
import { simulationSpeed } from '../src/game/flight/speedLimits'
import { stepFlight } from '../src/game/flight/stepFlight'
import { runFlightReplay } from '../src/game/playground/replay'
import { GameRuntime } from '../src/game/runtime/GameRuntime'
import { neutralCommand } from '../src/game/runtime/commands'
import type { AircraftState } from '../src/game/state/WorldState'

const speedOf = (state: AircraftState) => Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z)
const make = (flightOverrides?: SessionConfig['flightOverrides']) => new GameRuntime({
  mode: 'playground', aircraftIds: ['f22'], flightOverrides,
})

describe('configured arcade top speeds', () => {
  // Exact instant-thrust speed ceilings are retained in legacySpeed.report.ts.
  it.each(['released', 'depleted'])('sheds speed smoothly when afterburner is %s', reason => {
    const state = make().snapshot().aircraft[0]
    state.velocity.x = state.speedLimits.afterburnerTopSpeedMps
    if (reason === 'depleted') {
      state.maneuver.burner = 0
      state.maneuver.burnerLocked = true
    }
    const command = { ...neutralCommand(0, state.id), afterburner: reason === 'depleted' }
    const initial = speedOf(state)
    stepFlight(state, command, 1 / 120)
    expect(state.maneuver.burnerActive).toBe(false)
    expect(speedOf(state)).toBeLessThan(initial)
    expect(initial - speedOf(state)).toBeLessThan(1)
    expect(speedOf(state)).toBeGreaterThan(state.speedLimits.topSpeedMps)
    for (let tick = 0; tick < 720; tick++) stepFlight(state, neutralCommand(tick, state.id), 1 / 120)
    expect(speedOf(state)).toBeCloseTo(state.speedLimits.topSpeedMps, 6)
  })

  it('still allows gravity to carry a dive above the powered limit', () => {
    const state = make().snapshot().aircraft[0]
    const orientation = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -Math.PI / 6)
    // Quaternion stores _x/_y/_z/_w; explicitly copy the serializable components.
    state.orientation = { x: orientation.x, y: orientation.y, z: orientation.z, w: orientation.w }
    Object.assign(state.velocity, new Vector3(state.speedLimits.topSpeedMps, 0, 0).applyQuaternion(orientation))
    for (let tick = 0; tick < 120; tick++) stepFlight(state, neutralCommand(tick, state.id), 1 / 120)
    expect(speedOf(state)).toBeGreaterThan(state.speedLimits.topSpeedMps)
    expect(state.position.y).toBeLessThan(400)
    expect(state.alive).toBe(true)
  })


})

describe('session flight overrides', () => {
  it('isolates overrides from other aircraft, sessions, snapshots and caller mutations', () => {
    const original = structuredClone(getFlightProfile('f22'))
    const flightOverrides = { f22: { afterburnerTopSpeedKph: 2400 } }
    const runtime = new GameRuntime({ mode: 'offline', aircraftIds: ['f22', 'su57', 'f22'], flightOverrides })
    const snapshot = runtime.snapshot()
    expect(snapshot.aircraft[0].speedLimits.afterburnerTopSpeedMps).toBeCloseTo(simulationSpeed(2400))
    expect(snapshot.aircraft[1].speedLimits.afterburnerTopSpeedMps).toBeCloseTo(simulationSpeed(1400))
    expect(snapshot.aircraft[2].speedLimits).toEqual(snapshot.aircraft[0].speedLimits)
    snapshot.aircraft[0].speedLimits.topSpeedMps = 1
    flightOverrides.f22.afterburnerTopSpeedKph = 9999
    expect(runtime.snapshot().aircraft[0].speedLimits.topSpeedMps).toBeCloseTo(200)
    runtime.reset()
    expect(runtime.snapshot().aircraft[0].speedLimits.afterburnerTopSpeedMps).toBeCloseTo(simulationSpeed(2400))
    expect(make().snapshot().aircraft[0].speedLimits.afterburnerTopSpeedMps).toBeCloseTo(simulationSpeed(1400))
    expect(getFlightProfile('f22')).toEqual(original)
  })

  it('preserves overrides in deterministic replays and resets at 30/60/144 FPS', () => {
    const flightOverrides = { f22: { topSpeedKph: 1400, afterburnerTopSpeedKph: 2400 } }
    const results = [30, 60, 144].map(fps => {
      const runtime = make(flightOverrides)
      const initial = runtime.snapshot()
      runtime.start()
      for (let frame = 0; frame < fps * 15; frame++) {
        runtime.advance(1 / fps, (tick, id) => ({
          ...neutralCommand(tick, id), speedAdjust: 1, afterburner: tick >= 360 && tick < 660,
        }))
      }
      const replay = runtime.exportReplay()
      expect(replay.config.flightOverrides).toEqual(flightOverrides)
      const result = runtime.snapshot()
      expect(runFlightReplay(replay)).toEqual(result)
      expect(() => runFlightReplay({ ...replay, profileVersion: 'p3-profiles-1' })).toThrow('Unsupported flight replay')
      runtime.reset()
      expect(runtime.snapshot()).toEqual(initial)
      return result
    })
    expect(results[1]).toEqual(results[0])
    expect(results[2]).toEqual(results[0])
  })

  it.each([
    null,
    [],
    { missing: { topSpeedKph: 1200 } },
    { su57: { topSpeedKph: 1200 } },
    { f22: null },
    { f22: { topSpeedKph: NaN } },
    { f22: { afterburnerTopSpeedKph: Infinity } },
    { f22: { topSpeedKph: '1200' } },
    { f22: { topSpeedKph: 0 } },
    { f22: { topSpeedKph: 300 } },
    { f22: { topSpeedKph: 1500 } },
    { f22: { afterburnerTopSpeedKph: 1000 } },
    { f22: { acceleration: 100 } },
  ])('rejects invalid overrides: %j', invalid => {
    expect(() => make(invalid as unknown as SessionConfig['flightOverrides'])).toThrow('flightOverrides')
  })

  it('allows an empty override and equal normal/afterburner limits', () => {
    expect(make({ f22: {} }).snapshot()).toEqual(make().snapshot())
    const limits = make({ f22: { afterburnerTopSpeedKph: 1080 } }).snapshot().aircraft[0].speedLimits
    expect(limits.afterburnerTopSpeedMps).toBe(limits.topSpeedMps)
  })
})
