import { describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { driftSpawn, driftMetrics } from '../benchmarks/flight/jetDrift'
import { runTrack } from '../benchmarks/flight/harness'
import { bankedDriftWeight, interpretEnvelope } from '../src/game/flight/envelope'
import { observeAirflow } from '../src/game/flight/airflow'
import { getFlightProfile } from '../src/game/flight/profile'

function bankedSpawn(id: string, bankDeg: number, kph = 500) {
  const state = driftSpawn(id, kph)
  const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), bankDeg * Math.PI / 180)
  state.orientation = { x: q.x, y: q.y, z: q.z, w: q.w }
  return state
}

const pullWithS = () => ({ pitch: 1, speedAdjust: -1 })

describe('banked drift', () => {
  it('weights knife-edge only, above the speed band', () => {
    const p = getFlightProfile('f22')
    const weight = (bank: number, kph = 500) => {
      const state = bankedSpawn('f22', bank, kph)
      return bankedDriftWeight(state.orientation, observeAirflow(state, p), p)
    }
    for (const bank of [0, 45, 135, 180, -180]) expect(weight(bank)).toBe(0)
    for (const bank of [90, -90, 85, -95]) expect(weight(bank)).toBe(1)
    expect(weight(70)).toBeGreaterThan(0)
    expect(weight(70)).toBeLessThan(1)
    expect(weight(90, p.bankedDrift.speedStartKph)).toBe(0)
    expect(weight(90, p.bankedDrift.speedFullKph)).toBe(1)
  })

  it('caps the open limiter incidence at knife-edge only', () => {
    const p = getFlightProfile('f22')
    for (const [bank, expected] of [[0, p.aero.maxControllableAlphaDeg], [90, p.bankedDrift.maxAlphaDeg]]) {
      const state = bankedSpawn('f22', bank)
      state.limiterOpen = 1
      expect(interpretEnvelope(state, observeAirflow(state, p), p).alphaLimitDeg).toBe(expected)
    }
  })

  it.each(['f22', 'su57'])('%s wings-level and inverted pulls never engage the drift', id => {
    for (const bank of [0, 180]) {
      const samples = runTrack(bankedSpawn(id, bank), 3, pullWithS).samples.slice(1)
      expect(samples.every(s => s.state.flightForces!.envelope.bankedDrift === 0)).toBe(true)
    }
  })

  it.each(['f22', 'su57'])('%s knife-edge pull with S drifts through the turn instead of cobra', id => {
    for (const bank of [90, -90]) {
      const drift = driftMetrics(runTrack(bankedSpawn(id, bank), 3, pullWithS))
      const plain = driftMetrics(runTrack(bankedSpawn(id, bank), 3, () => ({ pitch: 1 })))
      expect(drift.peakIncidence).toBeLessThanOrEqual(40)
      expect(drift.peakIncidence).toBeGreaterThan(15)
      expect(Math.abs(drift.netVelocityHeadingDegrees!)).toBeGreaterThan(120)
      expect(Math.abs(drift.heightLoss)).toBeLessThan(20)
      expect(drift.finalSpeedKph).toBeLessThan(plain.finalSpeedKph)
    }
    const cobra = driftMetrics(runTrack(bankedSpawn(id, 0), 3, pullWithS))
    expect(cobra.peakIncidence).toBeGreaterThan(60)
  })

  it('leaves high-speed knife-edge turns to the closed limiter', () => {
    const trace = runTrack(bankedSpawn('f22', 90, 1000), 3, pullWithS)
    expect(driftMetrics(trace).peakIncidence).toBeLessThan(getFlightProfile('f22').bankedDrift.maxAlphaDeg)
  })
})
