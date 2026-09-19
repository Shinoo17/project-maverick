// Migrated intact from tests/flightHandling.test.ts: Rev. 3 Phase 2 replaces these feel assumptions.
import { describe, it, expect } from 'vitest'
import { reportExpect } from './legacyFeel'
const feel = reportExpect('flightHandling')
import { Quaternion, Vector3 } from 'three'
import { stepLegacyFlight as stepFlight } from './legacyStep'
import { GameRuntime } from '../../src/game/runtime/GameRuntime'
import { neutralCommand, type PilotCommand } from '../../src/game/runtime/commands'

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

describe('legacy flightHandling tuning expectations (report only)', () => {
  it('stalls during backward flight without forcing the nose, then recovers with power', () => {
    const state = aircraft(130, 0)
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI)
    state.orientation = { x: q.x, y: q.y, z: q.z, w: q.w }
    const orientation = { ...state.orientation }
    let lastSpeed = speedOf(state)
    let peakStall = 0
    for (let tick = 0; tick < 6 * 120; tick++) {
      const before = new Vector3().copy(state.velocity)
      stepFlight(state, neutralCommand(tick, state.id), 1 / 120)
      feel(before.angleTo(new Vector3().copy(state.velocity))).toBeLessThan(0.025)
      feel(speedOf(state)).toBeLessThanOrEqual(lastSpeed + 1e-8)
      lastSpeed = speedOf(state)
      peakStall = Math.max(peakStall, state.stall.severity)
    }
    feel(new Quaternion().copy(state.orientation).angleTo(new Quaternion().copy(orientation))).toBe(0)
    feel(peakStall).toBe(1)
    fly(state, 12, { speedAdjust: 1 })
    feel(state.stall.severity).toBe(0)
    feel(state.maneuver.alpha).toBeLessThan(10)
    feel(state.velocity.x).toBeLessThan(-150)
  })
})
