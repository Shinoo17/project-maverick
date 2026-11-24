import type { AircraftState } from '../state/WorldState'
import type { PilotCommand } from '../runtime/commands'
import type { FlightPose, FlightReadout } from './readout'
import { stepFlight } from './stepFlight'
import { legacyReadout } from './legacyReadout'
import { stepCoreFlight } from '../flightCore/step'
import { coreReadout } from '../flightCore/readout'
import type { CoreTuning } from '../flightCore/profile'
import { stepArcadeFlight } from '../arcadeCore/step'
import { arcadeReadout } from '../arcadeCore/readout'

/*
Flight core dispatch. A core owns one aircraft's flight:
it steps it and fills its FlightReadout. The runtime picks a core per session
(SessionConfig.flightCore) and tags each aircraft it flies with anything but the legacy core;
an untagged aircraft is the legacy core's, as every state was before the rewrite.
'new' is the rewrite's core (src/game/flightCore/, from FR1). 'arcade' is example/flight-control's
physics (src/game/arcadeCore/), the flight page's default since 2026-11-16.
`tuning` is the Flight Lab's patch on the new core's profiles; the legacy core ignores it.
*/
export type FlightCoreId = 'legacy' | 'new' | 'arcade'
export const flightCoreIds: readonly FlightCoreId[] = ['arcade', 'legacy', 'new']
export interface FlightCore {
  step(state: AircraftState, command: PilotCommand, dt: number, tuning?: CoreTuning): void
  readout(state: AircraftState, pose?: FlightPose): FlightReadout
}
const cores: Record<FlightCoreId, FlightCore | null> = {
  legacy: { step: stepFlight, readout: legacyReadout },
  new: { step: stepCoreFlight, readout: coreReadout },
  arcade: { step: stepArcadeFlight, readout: arcadeReadout },
}
export const isFlightCoreId = (value: unknown): value is FlightCoreId => flightCoreIds.includes(value as FlightCoreId)
export const flightCoreAvailable = (id: FlightCoreId) => cores[id] !== null

export function getFlightCore(id: FlightCoreId = 'legacy'): FlightCore {
  const core = cores[id]
  if (!core) throw new Error(`Flight core '${id}' is not built yet`)
  return core
}
export const flightCoreOf = (state: AircraftState) => getFlightCore(state.flightCore)
