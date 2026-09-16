import { getAircraft } from '../../content/aircraft'
import { flightProfiles } from '../../content/flight-profiles'
import { f22Profile } from '../../content/flight-profiles/f22'
import type { AircraftFlightProfile } from './profileTypes'

// Bump when tuning or simulation rules change; replays must use matching physics.
export const flightProfileVersion = 'p3-powered-psm-1'

export function getFlightProfile(aircraftId: string): AircraftFlightProfile {
  return flightProfiles[getAircraft(aircraftId).flightProfileId]
}

export { flightProfiles, type FlightProfileId } from '../../content/flight-profiles'
export type { AircraftFlightProfile, FlightProfile, ManeuverProfile, StallProfile, ThrustVectoringProfile } from './profileTypes'
export { validateFlightProfile } from './validateProfile'

// Compatibility for existing F-22 callers. New code selects by aircraft ID.
export const flightProfile = f22Profile.flight
export const maneuverProfile = f22Profile.maneuver
export { f22TvcProfile } from '../../content/flight-profiles/f22'
