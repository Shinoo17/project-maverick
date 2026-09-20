import { describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { aircraftIds, scenarioNames, runScenario, runTrack, createAircraft } from '../../benchmarks/flight/harness'
import { assertAircraftValid, assertActuatorStep, assertLimiterStep, mulberry32, runAtFps } from './helpers'
import { neutralCommand, type PilotCommand } from '../../src/game/runtime/commands'
import { runFlightReplay } from '../../src/game/playground/replay'
import { getFlightProfile } from '../../src/game/flight/profile'
import { thrustForces, tvcTargets } from '../../src/game/flight/thrustVectoring'
import { flightInstrumentation } from '../../src/game/flight/instrumentation'

const observe: Parameters<typeof runTrack>[3] = (state, previous) => {
  assertAircraftValid(state)
  assertActuatorStep(state, previous); assertLimiterStep(state, previous)
}
describe.each(aircraftIds)('%s Phase 0 invariants', aircraftId => {
  it.each(scenarioNames)('I1/I11: %s valid state and actuator bounds at every substep', scenario => {
    const trace = runScenario(scenario, aircraftId, observe)
    assertAircraftValid(trace.initialState)
  })
  it.each([1, 42, 12345, 0xdeadbeef])('I1/I11 fuzz seed %i, including zero/reverse/low/random entry speed', seed => {
    const random = mulberry32(seed)
    const state = createAircraft(aircraftId)
    state.position.y = 2000
    state.velocity.x = seed === 1 ? 0 : seed === 42 ? -60 : seed === 12345 ? 0.01 : random() * 180
    let command: Partial<PilotCommand> = {}
    assertAircraftValid(state)
    runTrack(state, 6, (_state, time) => {
      if (Math.round(time * 120) % 30 === 0) command = {
        pitch: random() * 2 - 1, yaw: random() * 2 - 1, roll: random() * 2 - 1,
        speedAdjust: random() * 2 - 1, psmArm: random() > 0.5, afterburner: random() > 0.5,
        airbrake: random() > 0.5, highG: random() > 0.5,
      }
      return command
    }, observe)
  })
  it.each([120, 170])('I1/I11 fuzz from %i° incidence in varied turn planes', incidenceDeg => {
    for (const seed of [1, 42, 12345, 0xdeadbeef]) {
      const random = mulberry32(seed)
      const state = createAircraft(aircraftId)
      state.position.y = 2000
      state.velocity = { x: 60 + random() * 120, y: 0, z: 0 }
      // Rotate the nose away from +X flow around a seeded axis in the YZ plane:
      // reverse flow with both pitch/sideslip components, not only level -X entry.
      const plane = random() * Math.PI * 2
      const q = new Quaternion().setFromAxisAngle(new Vector3(0, Math.cos(plane), Math.sin(plane)), incidenceDeg * Math.PI / 180)
      state.orientation = { x: q.x, y: q.y, z: q.z, w: q.w }
      expect(flightInstrumentation(state).incidenceDeg).toBeCloseTo(incidenceDeg, 10)
      expect(new Vector3().copy(state.velocity).applyQuaternion(q.clone().invert()).x).toBeLessThan(0)
      assertAircraftValid(state)
      let command: Partial<PilotCommand> = {}
      const trace = runTrack(state, 6, (_state, time) => {
        if (Math.round(time * 120) % 30 === 0) command = {
          pitch: random() * 2 - 1, yaw: random() * 2 - 1, roll: random() * 2 - 1,
          speedAdjust: random() * 2 - 1, psmArm: random() > 0.5, afterburner: random() > 0.5,
          airbrake: random() > 0.5, highG: random() > 0.5,
        }
        return command
      }, observe)
      // Confirm the fuzz actually observes reverse flow after entering the solver.
      expect(flightInstrumentation(trace.samples[1].state).incidenceDeg).toBeGreaterThan(90)
    }
  })
  it('I2/I3: runtime determinism and public replay/version contract', () => {
    const pattern = (tick: number, id: string): PilotCommand => ({ ...neutralCommand(tick, id),
      psmArm: tick >= 45 && tick < 240, pitch: tick < 150 ? 1 : tick < 240 ? -1 : 0,
      yaw: tick >= 240 ? 0.5 : 0, speedAdjust: tick < 45 ? -1 : 1,
      afterburner: tick >= 150 && tick < 240, airbrake: tick < 45, highG: tick < 45,
    })
    const at60 = runAtFps(60, aircraftId, pattern)
    expect(runAtFps(30, aircraftId, pattern)).toEqual(at60)
    expect(runAtFps(144, aircraftId, pattern)).toEqual(at60)
    expect(runFlightReplay(at60.replay)).toEqual(at60.snapshot)
    expect(runFlightReplay(at60.replay)).toEqual(runFlightReplay(at60.replay))
    expect(() => runFlightReplay({ ...at60.replay, profileVersion: 'wrong-version' })).toThrow('Unsupported flight replay')
    expect(() => runFlightReplay({ ...at60.replay, schemaVersion: 999 })).toThrow('Unsupported flight replay')
  })
  it('observation at every substep leaves the complete trace unchanged', () => {
    const plain = runScenario('cobraC', aircraftId)
    const observed = runScenario('cobraC', aircraftId, state => { flightInstrumentation(state) })
    expect(observed).toEqual(plain)
  })
})

it('I9: F-22 axial-thrust yaw stays below 1% of pitch across the full travel grid; Su-57 has yaw', () => {
  const f22 = getFlightProfile('f22').thrustVectoring!
  const su57 = getFlightProfile('su57').thrustVectoring!
  for (const thrust of [1, 10, 27.5, 50, 65, 80]) {
    let maxYaw = 0, noseUp = 0
    for (let left = -f22.maxAngle; left <= f22.maxAngle; left += 0.5) {
      for (let right = -f22.maxAngle; right <= f22.maxAngle; right += 0.5) {
        const moment = thrustForces({ left, right, authority: 1 }, thrust, f22).angularAcceleration
        maxYaw = Math.max(maxYaw, Math.abs(moment.yaw))
        noseUp = Math.max(noseUp, moment.pitch)
        // Preserve the original zero-yaw assertion precisely where it is valid.
        if (Math.abs(left) === Math.abs(right)) expect(Math.abs(moment.yaw)).toBeLessThanOrEqual(1e-6 * Math.abs(moment.pitch))
      }
    }
    // Geometry bound, not feel: spacing * thrust/2 * (1-cos(maxAngle)) / I_yaw
    // is ~0.927% of nose-UP pitch. 1% bounds the whole grid, including asymmetric
    // axial thrust missed by the former opposed-only sampling (plan erratum E3).
    expect(maxYaw).toBeGreaterThan(0)
    expect(maxYaw).toBeLessThanOrEqual(0.01 * noseUp)
    expect(Math.abs(thrustForces({ left: su57.maxAngle, right: -su57.maxAngle, authority: 1 }, thrust, su57).angularAcceleration.yaw)).toBeGreaterThan(0)
  }
})

it('I9: asymmetric F-22 nozzle angles reachable by the current mixer produce nonzero yaw', () => {
  const p = getFlightProfile('f22').thrustVectoring!
  // rollGain is 6°, not 10°: pitch=-0.7, roll=1 reaches (-20,-8).
  expect(tvcTargets({ pitch: -0.7, roll: 1 }, 1, p)).toEqual({ left: -20, right: -8 })
  let maxYaw = 0
  for (let pitch = -100; pitch <= 100; pitch++) for (let roll = -100; roll <= 100; roll++) {
    const target = tvcTargets({ pitch: pitch / 100, roll: roll / 100 }, 1, p)
    maxYaw = Math.max(maxYaw, Math.abs(thrustForces({ ...target, authority: 1 }, 27.5, p).angularAcceleration.yaw))
  }
  expect(maxYaw).toBeGreaterThan(0)
  const noseUp = thrustForces({ left: p.maxAngle, right: p.maxAngle, authority: 1 }, 27.5, p).angularAcceleration.pitch
  expect(maxYaw).toBeLessThanOrEqual(0.01 * noseUp)
})
