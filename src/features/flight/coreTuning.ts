import { coreAssistOf, coreProfileOf, validateCoreAssist, validateCoreProfile, type CoreTuning } from '../../game/flightCore/profile'
import type { FlightSession } from './session'

/** Hands the session's Flight Lab tuning to its runtime and to the keyboard (the coordinated turn
 * and the key shaping read the same profile the core flies). Under the legacy core the keyboard
 * gets no profile and reads every key as it always has. Live: no reset. */
export function applyCoreTuning(session: FlightSession, aircraftId: string) {
  if (session.flightCore !== 'new') { session.input.core = null; return }
  session.runtime?.tuneCore(session.coreTuning)
  session.input.core = { profile: coreProfileOf(aircraftId, session.coreTuning), assist: coreAssistOf(session.coreTuning) }
}

/** The tuning panel's commit: throws, changing nothing, if a patched profile would not validate. */
export function setCoreTuning(session: FlightSession, aircraftId: string, next: CoreTuning) {
  for (const id of Object.keys(next.profiles ?? {})) validateCoreProfile(coreProfileOf(id, next), `coreTuning.${id}`)
  validateCoreAssist(coreAssistOf(next), 'coreTuning.assist')
  session.coreTuning = structuredClone(next)
  applyCoreTuning(session, aircraftId)
}
