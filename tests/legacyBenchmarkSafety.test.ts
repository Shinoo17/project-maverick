import { describe, expect, it } from 'vitest'
import { reportExpect } from '../benchmarks/flight/legacyFeel'
import { stepLegacyFlight } from '../benchmarks/flight/legacyStep'
import { createAircraft } from '../benchmarks/flight/harness'
import { neutralCommand } from '../src/game/runtime/commands'
import { FLIGHT_STEP } from '../src/game/runtime/clock'

const feel = reportExpect('matcher-safety')
describe('migrated fixture safety remains hard', () => {
  it('reports finite feel misses but rejects nonfinite metrics', () => {
    expect(() => feel(1).toBeGreaterThan(2)).not.toThrow()
    for (const value of [NaN, Infinity, -Infinity]) expect(() => feel(value)).toThrow('nonfinite feel metric')
  })
  it('cannot swallow invalid state or a stopped aircraft in migrated scenarios', () => {
    const invalid = createAircraft('f22')
    invalid.position.x = NaN
    expect(() => stepLegacyFlight(invalid, neutralCommand(0, invalid.id), FLIGHT_STEP)).toThrow('I1')
    const stopped = createAircraft('f22')
    stopped.alive = false
    expect(() => stepLegacyFlight(stopped, neutralCommand(0, stopped.id), FLIGHT_STEP)).toThrow('Legacy fixture stopped')
  })
})
