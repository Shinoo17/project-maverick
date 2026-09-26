// Migrated from tests/poweredPsm.test.ts: Rev. 3 Phase 2 replaces these feel assumptions.
// Phase 6: the C hold became Airbrake (Space); phase/timer lifecycle checks retired with the phase machine.
import { describe, it, expect } from 'vitest'
import { reportExpect } from './legacyFeel'
const feel = reportExpect('poweredPsm')
import { Quaternion } from 'three'
import { GameRuntime } from '../../src/game/runtime/GameRuntime'
import { neutralCommand, type PilotCommand } from '../../src/game/runtime/commands'
import { FLIGHT_STEP as dt } from '../../src/game/runtime/clock'
import { stepLegacyFlight as stepFlight } from './legacyStep'

function aircraft(id = 'f22', speed = 100) {
  const s = new GameRuntime({ mode: 'playground', aircraftIds: [id] }).snapshot().aircraft[0]
  s.position.y = 2000; s.velocity = { x: speed, y: 0, z: 0 }
  return s
}
/** Returns accumulated nose rotation (rad). */
function fly(s: ReturnType<typeof aircraft>, seconds: number, input: Partial<PilotCommand>) {
  let rotation = 0
  for (let tick = 0; tick < Math.round(seconds / dt); tick++) {
    const before = new Quaternion().copy(s.orientation)
    stepFlight(s, { ...neutralCommand(tick, s.id), ...input }, dt)
    rotation += before.angleTo(new Quaternion().copy(s.orientation))
  }
  return rotation
}

describe('legacy poweredPsm tuning expectations (report only)', () => {
  it.each(['f22', 'su57'])('continues beyond 3 seconds / one rotation and recovers on release: %s', id => {
    const s = aircraft(id)
    const rotation = fly(s, 5, { airbrake: true, pitch: 1, speedAdjust: 1 })
    expect(s.alive).toBe(true)
    feel(rotation).toBeGreaterThan(2 * Math.PI)
    const before = new Quaternion().copy(s.orientation)
    fly(s, dt, { speedAdjust: 1 })
    feel(before.angleTo(new Quaternion().copy(s.orientation))).toBeLessThan(0.04)
    fly(s, 14, { speedAdjust: 1 })
    feel(s.stall.severity).toBe(0)
    expect(s.alive).toBe(true)
  })
})
