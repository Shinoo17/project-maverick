import type { AircraftState } from '../state/WorldState'
import type { PilotCommand } from '../runtime/commands'
import type { FlightPose, FlightReadout } from './readout'
import { stepFlight } from './stepFlight'
import { legacyReadout } from './legacyReadout'
import { stepCoreFlight } from '../flightCore/step'
import { coreReadout } from '../flightCore/readout'
import type { CoreTuning } from '../flightCore/profile'

/*
Flight core dispatch (docs/flight-rewrite-plan.md §3.2). A core owns one aircraft's flight:
it steps it and fills its FlightReadout. The runtime picks a core per session
(SessionConfig.flightCore) and tags each aircraft it flies with anything but the legacy core;
an untagged aircraft is the legacy core's, as every state was before the rewrite.
'new' is the rewrite's core (src/game/flightCore/, from FR1).
`tuning` is the Flight Lab's patch on the new core's profiles; the legacy core ignores it.
*/
export type FlightCoreId = 'legacy' | 'new'
export const flightCoreIds: readonly FlightCoreId[] = ['legacy', 'new']
export interface FlightCore {
  step(state: AircraftState, command: PilotCommand, dt: number, tuning?: CoreTuning): void
  readout(state: AircraftState, pose?: FlightPose): FlightReadout
}
const cores: Record<FlightCoreId, FlightCore | null> = {
  legacy: { step: stepFlight, readout: legacyReadout },
  new: { step: stepCoreFlight, readout: coreReadout },
}
export const isFlightCoreId = (value: unknown): value is FlightCoreId => flightCoreIds.includes(value as FlightCoreId)
export const flightCoreAvailable = (id: FlightCoreId) => cores[id] !== null

export function getFlightCore(id: FlightCoreId = 'legacy'): FlightCore {
  const core = cores[id]
  if (!core) throw new Error(`Flight core '${id}' is not built yet`)
  return core
}
export const flightCoreOf = (state: AircraftState) => getFlightCore(state.flightCore)
