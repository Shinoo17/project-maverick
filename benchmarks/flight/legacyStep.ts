import { stepFlight } from '../../src/game/flight/stepFlight'
import { assertAircraftValid } from '../../tests/invariants/helpers'

/** Every migrated fixture keeps hard state checks, including single-line loops.
 * These errors must never enter reportExpect's numeric feel matcher.
 */
export function stepLegacyFlight(...args: Parameters<typeof stepFlight>) {
  stepFlight(...args)
  assertAircraftValid(args[0])
  if (!args[0].alive) throw new Error(`Legacy fixture stopped: ${args[0].stopReason}`)
}
