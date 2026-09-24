// Superseded Phase 2 feel fixtures are retained in benchmarks/flight/legacyFlightHandling.report.ts.
import { describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { stepFlight } from '../src/game/flight/stepFlight'
import { GameRuntime } from '../src/game/runtime/GameRuntime'
import { neutralCommand, type PilotCommand } from '../src/game/runtime/commands'
import { runFlightReplay } from '../src/game/playground/replay'

function aircraft(speed = 130, bank = Math.PI / 2) {
  const state = new GameRuntime({ mode: 'playground', aircraftIds: ['f22'] }).snapshot().aircraft[0]
  state.position.y = 3000
  state.velocity.x = speed
  const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), bank)
  state.orientation = { x: q.x, y: q.y, z: q.z, w: q.w }
  return state
}
function fly(state: ReturnType<typeof aircraft>, seconds: number, command: Partial<PilotCommand>) {
  let peakSlip = 0, pathDegrees = 0
  for (let tick = 0; tick < seconds * 120; tick++) {
    stepFlight(state, { ...neutralCommand(tick, state.id), ...command }, 1 / 120)
    peakSlip = Math.max(peakSlip, state.maneuver.alpha)
    pathDegrees += state.maneuver.pathRate / 120
    expect(state.alive).toBe(true)
  }
  return { peakSlip, pathDegrees }
}

describe('normal flight grip', () => {
  it('keeps the path with the nose throughout sustained and combined turns above the stall envelope', () => {
    for (const speed of [90, 130, 160, 200, 240]) {
      for (const command of [{ pitch: 1 }, { yaw: -1 }, { pitch: 1, yaw: 1, roll: 0.4 }]) {
        const state = aircraft(speed)
        expect(fly(state, 6, command).peakSlip, `speed=${speed}, command=${JSON.stringify(command)}`).toBeLessThan(10)
      }
    }
  })

  // The old manual-vs-fast path ratio is now reported in phase4.report.ts:
  // automatic High-G deliberately changes the full-stick fast-flight baseline.

  it('stops on neutral and answers a reversed pull without a long drifting tail', () => {
    for (const axis of ['pitch', 'yaw'] as const) {
      const neutral = aircraft(), reversed = aircraft()
      fly(neutral, 1, { [axis]: 1 }); fly(reversed, 1, { [axis]: 1 })
      fly(neutral, 0.4, {})
      expect(Math.abs(neutral.rates[axis])).toBeLessThan(0.04)
      expect(neutral.maneuver.alpha).toBeLessThan(3)
      fly(reversed, 0.15, { [axis]: -1 })
      expect(reversed.rates[axis]).toBeLessThan(-0.1)
      expect(reversed.maneuver.alpha).toBeLessThan(5)
    }
  })

  it('does not silently replay old flight tuning with the new model', () => {
    const runtime = new GameRuntime({ mode: 'playground', aircraftIds: ['f22'] })
    const replay = runtime.exportReplay()
    expect(() => runFlightReplay({ ...replay, profileVersion: 'p2-manual-2' })).toThrow('Unsupported flight replay')
  })
})
