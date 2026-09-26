import type { AircraftFlightProfile } from '../../game/flight/profileTypes'
import { f22Profile } from './f22'
import { su57Profile } from './su57'

// The no-TVC validation variant. MR2 owner decision: no pitch commanded-rate hold. Without
// thrust vectoring the hold let a Space pull reach 82° incidence at 450 km/h (F-22: 102°)
// and closed the drift-entry gap jet-drift review R12 protects.
function notvc(): AircraftFlightProfile {
  const profile = { ...structuredClone(f22Profile), thrustVectoring: null }
  profile.flight.commandedRateHold.pitch = 0
  return profile
}

export const flightProfiles = {
  'raptor-energy': f22Profile,
  'felon-agility': su57Profile,
  'raptor-notvc': notvc(),
} satisfies Record<string, AircraftFlightProfile>

export type FlightProfileId = keyof typeof flightProfiles
