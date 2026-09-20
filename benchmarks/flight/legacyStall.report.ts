// Migrated intact from tests/stall.test.ts: Rev. 3 Phase 2 replaces these feel assumptions.
import { describe, it, expect } from 'vitest'
import { reportExpect } from './legacyFeel'
const feel = reportExpect('stall')
import { Quaternion, Vector3 } from 'three'
import { simulationSpeed } from '../../src/game/flight/speedLimits'
import { stepLegacyFlight as stepFlight } from './legacyStep'
import { GameRuntime } from '../../src/game/runtime/GameRuntime'
import { neutralCommand, type PilotCommand } from '../../src/game/runtime/commands'
import type { AircraftState } from '../../src/game/state/WorldState'

const dt = 1 / 120
const make = (aircraftId = 'f22') => new GameRuntime({ mode: 'playground', aircraftIds: [aircraftId] })
const speedOf = (s: AircraftState) => Math.hypot(s.velocity.x, s.velocity.y, s.velocity.z)
function pose(speedKph: number, aoaDeg = 0, aircraftId = 'f22') {
  const s = make(aircraftId).snapshot().aircraft[0]
  s.position.y = 2000
  s.velocity.x = simulationSpeed(speedKph)
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), aoaDeg * Math.PI / 180)
  s.orientation = { x: q.x, y: q.y, z: q.z, w: q.w }
  return s
}
function fly(s: AircraftState, seconds: number, input: Partial<PilotCommand> = {}) {
  for (let tick = 0; tick < Math.round(seconds / dt); tick++) {
    stepFlight(s, { ...neutralCommand(tick, s.id), ...input }, dt)
    expect(s.alive).toBe(true)
  }
}

describe('legacy stall tuning expectations (report only)', () => {
  it.each(['f22', 'su57'])('loses height and retains controls, then recovers on W for %s', id => {
    const s = pose(230, 0, id)
    fly(s, 2)
    feel(s.stall.severity).toBe(1)
    feel(s.velocity.y).toBeLessThan(-1)
    feel(s.position.y).toBeLessThan(1995)
    const low = structuredClone(s), turning = structuredClone(s)
    fly(turning, 0.25, { pitch: -0.5, yaw: 0.5, roll: 0.5 })
    feel(turning.rates.pitch).toBeLessThan(0)
    feel(turning.rates.yaw).toBeGreaterThan(0)
    feel(turning.rates.roll).toBeGreaterThan(0)
    fly(s, 8, { speedAdjust: 1 })
    feel(s.stall.severity).toBe(0)
    feel(speedOf(s)).toBeGreaterThan(150)
    feel(s.position.y).toBeGreaterThan(low.position.y - 100)
  })
  it('falls from zero speed rather than floating or producing NaN', () => {
    const s = pose(0)
    fly(s, 2)
    feel(s.stall.severity).toBe(1)
    feel(s.position.y).toBeLessThan(1990)
    feel(s.velocity.y).toBeLessThan(-5)
    expect(Number.isFinite(speedOf(s))).toBe(true)
    fly(s, 10, { speedAdjust: 1 })
    feel(s.stall.severity).toBe(0)
  })
  it.each(['f22', 'su57'])('keeps mixed PSM axes smooth and responsive through stall for %s', id => {
    const s = pose(567, 0, id)
    let peakStall = 0, pitchTravel = 0, yawTravel = 0, rollTravel = 0
    for (let tick = 0; tick < 240; tick++) {
      const before = new Quaternion().copy(s.orientation)
      const input = tick < 90 ? { pitch: 1, yaw: 0.4, roll: 0.3 }
        : tick < 150 ? { pitch: 0, yaw: 1, roll: -0.5 } : { pitch: -1, yaw: -0.6, roll: 0.5 }
      stepFlight(s, { ...neutralCommand(tick, s.id), ...input, psmArm: true, speedAdjust: 1 }, dt)
      feel(before.angleTo(new Quaternion().copy(s.orientation))).toBeLessThan(0.04)
      expect(s.maneuver.phase).toBe('active')
      expect(s.alive).toBe(true)
      peakStall = Math.max(peakStall, s.stall.severity)
      pitchTravel += Math.abs(s.rates.pitch) * dt
      yawTravel += Math.abs(s.rates.yaw) * dt
      rollTravel += Math.abs(s.rates.roll) * dt
    }
    feel(peakStall).toBe(1)
    feel(Math.min(pitchTravel, yawTravel, rollTravel)).toBeGreaterThan(1)
    feel(s.rates.pitch).toBeLessThan(-1)
    feel(s.rates.yaw).toBeLessThan(-0.5)
    fly(s, 12, { speedAdjust: 1 })
    feel(s.stall.severity).toBe(0)
    expect(s.maneuver.phase).toBe('normal')
    feel(s.maneuver.alpha).toBeLessThan(10)
  })
  it.each(['f22', 'su57'])('allows a pilot-controlled pedal turn and recovery for %s', id => {
    const s = pose(567, 0, id)
    let peakStall = 0
    for (let tick = 0; tick < 1440; tick++) {
      const nose = new Vector3(1, 0, 0).applyQuaternion(new Quaternion().copy(s.orientation))
      let heading = Math.atan2(nose.z, nose.x)
      if (heading < -0.1) heading += Math.PI * 2
      const active = tick < 355
      const yaw = Math.max(-1, Math.min(1, (Math.PI - heading) * 2 - s.rates.yaw * 0.6))
      stepFlight(s, { ...neutralCommand(tick, s.id), psmArm: active, yaw: active ? yaw : 0, speedAdjust: 1 }, dt)
      peakStall = Math.max(peakStall, s.stall.severity)
    }
    feel(peakStall).toBe(1)
    feel(s.velocity.x).toBeLessThan(-150)
    feel(s.stall.severity).toBe(0)
    // Phase 3 removed generic powered yaw. Preserve the old desired completion
    // as feel, while enforcing the actual detector gate/lifecycle contract.
    expect(s.maneuver.completed).toBe(s.maneuver.phase === 'normal' && s.maneuver.peakAlpha >= 70 ? 1 : 0)
    feel(s.maneuver.completed).toBe(1)
    expect(s.alive).toBe(true)
  })
})
