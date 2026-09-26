import { describe, expect, it } from 'vitest'
import { flightDefaults, maneuverDefaults, stallDefaults } from '../src/content/flight-profiles/defaults'
import { flightProfiles, getFlightProfile, validateFlightProfile } from '../src/game/flight/profile'

describe('aircraft flight configuration', () => {
  it('validates every registered profile', () => {
    for (const profile of Object.values(flightProfiles)) {
      expect(() => validateFlightProfile(profile)).not.toThrow()
    }
  })

  it('keeps aircraft tuning independent from other aircraft and defaults', () => {
    const f22 = getFlightProfile('f22')
    const su57 = getFlightProfile('su57')
    const previousFlight = { ...f22.flight }
    const previousManeuver = { ...f22.maneuver }
    const previousStall = { ...f22.stall }
    const otherAircraft = structuredClone(su57)
    const defaults = structuredClone({ flightDefaults, maneuverDefaults, stallDefaults })
    try {
      f22.flight.acceleration = 10
      f22.flight.rateResponse = 2
      f22.maneuver.lateralAcceleration = 90
      f22.maneuver.activeGrip = 0.2
      f22.stall.stallSpeedKph = 200
      f22.stall.separationEntrySeconds = 1
      expect(su57).toEqual(otherAircraft)
      expect({ flightDefaults, maneuverDefaults, stallDefaults }).toEqual(defaults)
    } finally {
      Object.assign(f22.flight, previousFlight)
      Object.assign(f22.maneuver, previousManeuver)
      Object.assign(f22.stall, previousStall)
    }
  })

  it.each([
    ['pitchRate', 0],
    ['yawRate', 0],
    ['rollRate', 0],
    ['rateResponse', -1],
    ['turnRateReserve', 1.1],
  ] as const)('rejects unsafe flight tuning: %s = %s', (key, value) => {
    const profile = structuredClone(getFlightProfile('f22'))
    profile.flight[key] = value
    expect(() => validateFlightProfile(profile)).toThrow(`flight.${key}`)
  })
})
