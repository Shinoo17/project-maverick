import { getAircraft } from '../../content/aircraft'

// Serializable arcade tuning. Real aircraft specifications belong to facts content.
export const flightProfileVersion = 'p3-profiles-1'
export const flightProfile = {
  neutralDampingDuringPsm: true,
  minPoweredMps: 65, maxPoweredMps: 200,
  acceleration: 24, deceleration: 24, driveResponse: 8, releaseResponse: 6,
  maxThrust: 50, drag: 0.00035, turnDrag: 3,
  pitchRate: 0.95, yawRate: 0.42, rollRate: 2.1, rateResponse: 5,
  // Reversing a roll is not starting one: the hand has already crossed the whole gate, so the
  // airframe follows rather than coasting on. Roll axis only, and only against the rate.
  rollReversalResponse: 18,
  // Normal flight: lateral acceleration in m/s², alignment response in 1/s.
  // Reserve some path authority to close slip while the pilot keeps pulling.
  turnAcceleration: 145, turnRateReserve: 0.9,
  pathResponse: 4, turnAnticipation: 0.65,
  counterResponse: 12, neutralResponse: 9,
  gravity: 9.81,
}

export const maneuverProfile = {
  psmEnabled: true, entryMin: 65, entryMax: 115, minAltitude: 150,
  pitchRate: 2.6, yawRate: 1.6, rollRate: 2.1, maxRotation: Math.PI * 2, activeSeconds: 3, cooldown: 4,
  highGRate: 1.4, highGDrag: 2, burnerSeconds: 6, burnerRecharge: 12,
  // Keep PSM airflow independent of normal-flight grip tuning.
  pathResponse: 1.5, activeGrip: 0.08, recoveryGrip: 2.5,
  recoveryAcceleration: 70,
}

export const f22TvcProfile = {
  maxAngle: 20, rollGain: 6, actuatorRate: 45, actuatorResponse: 7, authorityResponse: 5,
  // Metres in the same centered +X-forward frame as the displayed aircraft.
  pivotX: -6.3824, height: -1.0373, spacing: .6517, lipArm: .983,
  // Mass-normalized inertia (I/m, m²), tuned for this arcade airframe. These are
  // not claimed to be measured F-22 inertias or a real flight-control schedule.
  inertia: { roll: 12, yaw: 40, pitch: 40 },
}

export type FlightProfile = typeof flightProfile
export type ManeuverProfile = typeof maneuverProfile
export type ThrustVectoringProfile = typeof f22TvcProfile
export interface AircraftFlightProfile {
  flight: FlightProfile
  maneuver: ManeuverProfile
  thrustVectoring: ThrustVectoringProfile | null
}
export const flightProfiles = {
  'raptor-energy': { flight: flightProfile, maneuver: maneuverProfile, thrustVectoring: f22TvcProfile },
  'felon-agility': {
    flight: { ...flightProfile, neutralDampingDuringPsm: false, acceleration: 22.8, turnDrag: 3.15, yawRate: .48 },
    maneuver: { ...maneuverProfile, yawRate: 1.85, recoveryAcceleration: 66.5, cooldown: 4.5 },
    // Su-57 currently uses the generic PSM assist and a presentation-only nozzle rig.
    // Do not apply the pitch-only twin-engine force solver to its three-axis rig.
    thrustVectoring: null,
  },
} satisfies Record<string, AircraftFlightProfile>
export type FlightProfileId = keyof typeof flightProfiles
export function getFlightProfile(aircraftId: string): AircraftFlightProfile {
  return flightProfiles[getAircraft(aircraftId).flightProfileId]
}

export function validateFlightProfile(profile: AircraftFlightProfile) {
  function finite(value: unknown, path: string) {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`${path}: expected finite number`)
    if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) finite(child, `${path}.${key}`)
  }
  finite(profile, 'flightProfile')
  if (profile.flight.minPoweredMps <= 0 || profile.flight.maxPoweredMps <= profile.flight.minPoweredMps
    || profile.flight.maxThrust <= 0 || profile.flight.gravity <= 0
    || profile.maneuver.entryMin <= 0 || profile.maneuver.entryMax <= profile.maneuver.entryMin
    || profile.maneuver.burnerSeconds <= 0 || profile.maneuver.burnerRecharge <= 0) throw new Error('flightProfile: invalid envelope')
  if (profile.thrustVectoring && Object.values(profile.thrustVectoring.inertia).some(value => value <= 0)) throw new Error('flightProfile.thrustVectoring.inertia: expected positive values')
}
