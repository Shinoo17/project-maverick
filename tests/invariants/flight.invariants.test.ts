import { describe, expect, it } from 'vitest'
import { aircraftIds, scenarioNames, runScenario, runTrack, createAircraft } from '../../benchmarks/flight/harness'
import { assertAircraftValid, assertActuatorStep, mulberry32, runAtFps } from './helpers'
import { neutralCommand, type PilotCommand } from '../../src/game/runtime/commands'
import { runFlightReplay } from '../../src/game/playground/replay'
import { getFlightProfile } from '../../src/game/flight/profile'
import { tvcCapacity } from '../../src/game/flight/thrustVectoring'
import { flightInstrumentation } from '../../src/game/flight/instrumentation'

const observe: Parameters<typeof runTrack>[3] = (state, previous) => {
  assertAircraftValid(state)
  assertActuatorStep(state, previous)
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

it('I9: F-22 differential yaw capacity is zero; Su-57 geometry has yaw capacity', () => {
  for (const thrust of [1, 10, 50, 80]) {
    const f22 = tvcCapacity(getFlightProfile('f22').thrustVectoring, thrust)
    expect(f22.yaw).toBeLessThanOrEqual(1e-6 * f22.pitch)
    expect(tvcCapacity(getFlightProfile('su57').thrustVectoring, thrust).yaw).toBeGreaterThan(0)
  }
})
