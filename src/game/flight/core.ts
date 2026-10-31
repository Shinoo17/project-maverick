import type { AircraftState } from '../state/WorldState'
import type { PilotCommand } from '../runtime/commands'
import type { FlightPose, FlightReadout } from './readout'
import { stepFlight } from './stepFlight'
import { legacyReadout } from './legacyReadout'

/*
Flight core dispatch (docs/flight-rewrite-plan.md §3.2). A core owns one aircraft's flight:
it steps it and fills its FlightReadout. The runtime picks a core per session
(SessionConfig.flightCore) and tags each aircraft it flies with anything but the legacy core;
an untagged aircraft is the legacy core's, as every state was before the rewrite.
'new' is the rewrite's core, built from FR1; until then asking for it is an error, never a fallback.
*/
export type FlightCoreId = 'legacy' | 'new'
export const flightCoreIds: readonly FlightCoreId[] = ['legacy', 'new']
export interface FlightCore {
  step(state: AircraftState, command: PilotCommand, dt: number): void
  readout(state: AircraftState, pose?: FlightPose): FlightReadout
}
const cores: Record<FlightCoreId, FlightCore | null> = {
  legacy: { step: stepFlight, readout: legacyReadout },
  new: null,
}
export const isFlightCoreId = (value: unknown): value is FlightCoreId => flightCoreIds.includes(value as FlightCoreId)
export const flightCoreAvailable = (id: FlightCoreId) => cores[id] !== null

export function getFlightCore(id: FlightCoreId = 'legacy'): FlightCore {
  const core = cores[id]
  if (!core) throw new Error(`Flight core '${id}' is not built yet (FR1)`)
  return core
}
export const flightCoreOf = (state: AircraftState) => getFlightCore(state.flightCore)
