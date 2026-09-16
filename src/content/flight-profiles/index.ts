import type { AircraftFlightProfile } from '../../game/flight/profileTypes'
import { f22Profile } from './f22'
import { su57Profile } from './su57'

export const flightProfiles = {
  'raptor-energy': f22Profile,
  'felon-agility': su57Profile,
} satisfies Record<string, AircraftFlightProfile>

export type FlightProfileId = keyof typeof flightProfiles
