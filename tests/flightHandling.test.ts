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
const speedOf = (s: ReturnType<typeof aircraft>) => Math.hypot(s.velocity.x, s.velocity.y, s.velocity.z)
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
  it('keeps the path with the nose throughout sustained and combined turns across the speed envelope', () => {
    for (const speed of [30, 65, 90, 130, 160, 200, 240]) {
      for (const command of [{ pitch: 1 }, { yaw: -1 }, { pitch: 1, yaw: 1, roll: 0.4 }, { pitch: 1, highG: true }]) {
        const state = aircraft(speed)
        expect(fly(state, 6, command).peakSlip, `speed=${speed}, command=${JSON.stringify(command)}`).toBeLessThan(10)
        expect(state.maneuver.phase).toBe('normal')
      }
    }
  })

  it('gives High-G a tighter actual path at an energy cost, while fast flight turns wider', () => {
    const normal = aircraft(), hard = aircraft(), fast = aircraft(200)
    const normalTurn = fly(normal, 3, { pitch: 1 })
    const hardTurn = fly(hard, 3, { pitch: 1, highG: true })
    const fastTurn = fly(fast, 3, { pitch: 1 })
    expect(hardTurn.pathDegrees).toBeGreaterThan(normalTurn.pathDegrees * 1.2)
    expect(speedOf(hard)).toBeLessThan(speedOf(normal) - 10)
    expect(fastTurn.pathDegrees).toBeLessThan(normalTurn.pathDegrees * 0.75)
    expect(speedOf(normal)).toBeLessThan(130)
  })

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

  it('captures an opposite heading without moving the nose or adding kinetic energy', () => {
    const state = aircraft(130, 0)
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI)
    state.orientation = { x: q.x, y: q.y, z: q.z, w: q.w }
    const orientation = { ...state.orientation }
    let lastSpeed = speedOf(state)
    for (let tick = 0; tick < 6 * 120; tick++) {
      const before = new Vector3().copy(state.velocity)
      stepFlight(state, neutralCommand(tick, state.id), 1 / 120)
      expect(before.angleTo(new Vector3().copy(state.velocity))).toBeLessThan(0.025)
      expect(speedOf(state)).toBeLessThanOrEqual(lastSpeed + 1e-8)
      lastSpeed = speedOf(state)
    }
    expect(state.orientation).toEqual(orientation)
    expect(state.maneuver.alpha).toBeLessThan(1)
    expect(state.velocity.x).toBeLessThan(-90)
  })

  it('does not silently replay old flight tuning with the new model', () => {
    const runtime = new GameRuntime({ mode: 'playground', aircraftIds: ['f22'] })
    const replay = runtime.exportReplay()
    expect(() => runFlightReplay({ ...replay, profileVersion: 'p2-manual-2' })).toThrow('Unsupported flight replay')
  })
})
