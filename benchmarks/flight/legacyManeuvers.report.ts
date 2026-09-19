// Migrated intact from tests/maneuvers.test.ts: Rev. 3 Phase 2 replaces these feel assumptions.
import { describe, it, expect } from 'vitest'
import { reportExpect } from './legacyFeel'
const feel = reportExpect('maneuvers')
import { Quaternion, Vector3 } from 'three'
import { GameRuntime } from '../../src/game/runtime/GameRuntime'
import { neutralCommand } from '../../src/game/runtime/commands'
import { stepLegacyFlight as stepFlight } from './legacyStep'
const make = () => new GameRuntime({ mode: 'playground', mapId: 'flat-range', aircraftIds: ['f22'] })
const speed = (v: { x: number; y: number; z: number }) => Math.hypot(v.x, v.y, v.z)
describe('legacy maneuvers tuning expectations (report only)', () => {
  it('lets player input produce a Cobra OR a 180° reversal and retain the chosen heading', () => {
    for (const kind of ['cobra', 'reverse'] as const) {
      const s = make().snapshot().aircraft[0]; s.velocity.x = 105; s.position.y = 700
      let lowered = false, peak = 0, minimum = 105, activePathAngle = 0
      for (let i = 0; i < 1440; i++) {
        const nose = new Vector3(1, 0, 0).applyQuaternion(new Quaternion().copy(s.orientation))
        let pitchAngle = Math.atan2(nose.y, nose.x)
        if (kind === 'reverse' && pitchAngle < -0.1) pitchAngle += Math.PI * 2
        if (kind === 'cobra' && pitchAngle > 1.6) lowered = true
        // A test pilot changes the stick based on the heading they want. The
        // simulation receives only axes; it has no Cobra/reversal selection.
        const target = kind === 'cobra' ? lowered ? 0 : 1.8 : Math.PI
        const stick = Math.max(-1, Math.min(1, (target - pitchAngle) * 2 - s.rates.pitch * 0.8))
        const held = i < 300 && !(kind === 'cobra' && lowered && Math.abs(pitchAngle) < 0.15 && Math.abs(s.rates.pitch) < 0.3)
        const before = new Quaternion().copy(s.orientation)
        stepFlight(s, { ...neutralCommand(i, s.id), psmArm: held, pitch: held ? stick : 0, speedAdjust: 1 }, 1 / 120)
        feel(before.angleTo(new Quaternion().copy(s.orientation))).toBeLessThan(0.03)
        peak = Math.max(peak, s.maneuver.alpha); minimum = Math.min(minimum, speed(s.velocity))
        if (s.maneuver.phase === 'active') activePathAngle = Math.max(activePathAngle, new Vector3(1, 0, 0).angleTo(new Vector3().copy(s.velocity)))
      }
      feel(peak).toBeGreaterThan(kind === 'cobra' ? 70 : 120)
      // Powered TVC also bends the path; it must still lag the post-stall nose.
      feel(activePathAngle).toBeLessThan(0.7); feel(minimum).toBeLessThan(100)
      // Recovery/lifecycle remain hard. The original desired completion is a
      // feel miss if this pilot never reaches the existing 70° counting gate.
      expect(s.maneuver.phase).toBe('normal')
      expect(s.maneuver.completed).toBe(s.maneuver.peakAlpha >= 70 ? 1 : 0)
      expect(s.alive).toBe(true)
      feel(s.maneuver.completed).toBe(1)
      feel(s.maneuver.alpha).toBeLessThan(10)
      feel(s.velocity.x * (kind === 'cobra' ? 1 : -1)).toBeGreaterThan(150)
      feel(Math.abs(s.orientation.y)).toBeLessThan(0.001)
    }
  })
  it('keeps neutral and opposite-axis commands effective during active PSM and recovery', () => {
    const s = make().snapshot().aircraft[0]; s.velocity.x = 105
    for (let i = 0; i < 120; i++) stepFlight(s, { ...neutralCommand(i, s.id), psmArm: true, pitch: 1, speedAdjust: 1 }, 1 / 120)
    feel(s.rates.pitch).toBeGreaterThan(2)
    for (let i = 0; i < 60; i++) stepFlight(s, { ...neutralCommand(i, s.id), psmArm: true }, 1 / 120)
    feel(Math.abs(s.rates.pitch)).toBeLessThan(0.2)
    for (let i = 0; i < 30; i++) stepFlight(s, { ...neutralCommand(i, s.id), psmArm: true, pitch: -1, yaw: 1, roll: -1, speedAdjust: 1 }, 1 / 120)
    expect(s.maneuver.phase).toBe('active'); feel(s.rates.pitch).toBeLessThan(-1)
    feel(s.rates.yaw).toBeGreaterThan(0.5); feel(s.rates.roll).toBeLessThan(-1)
    stepFlight(s, neutralCommand(0, s.id), 1 / 120); expect(s.maneuver.phase).toBe('recovery')
    for (let i = 0; i < 60; i++) stepFlight(s, { ...neutralCommand(i, s.id), yaw: -1, speedAdjust: 1 }, 1 / 120)
    feel(s.rates.yaw).toBeLessThan(-0.3)
  })
  it('also permits a yaw-led 180° reversal with no forced pitch or roll', () => {
    const s = make().snapshot().aircraft[0]; s.velocity.x = 105; s.position.y = 700
    for (let i = 0; i < 1440; i++) {
      const nose = new Vector3(1, 0, 0).applyQuaternion(new Quaternion().copy(s.orientation))
      let heading = Math.atan2(nose.z, nose.x); if (heading < -0.1) heading += Math.PI * 2
      const active = i < 355
      const yaw = Math.max(-1, Math.min(1, (Math.PI - heading) * 2 - s.rates.yaw * 0.6))
      stepFlight(s, { ...neutralCommand(i, s.id), psmArm: active, yaw: active ? yaw : 0, speedAdjust: 1 }, 1 / 120)
    }
    feel(s.velocity.x).toBeLessThan(-150)
    feel(s.maneuver.peakAlpha).toBeGreaterThan(90)
    expect(s.maneuver.completed).toBe(1)
    feel(Math.abs(s.orientation.x) + Math.abs(s.orientation.z)).toBeLessThan(0.001)
    expect(s.alive).toBe(true)
  })
})
