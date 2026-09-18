import type { AircraftFlightProfile, ThrustVectoringProfile } from '../../game/flight/profileTypes'
import { aeroDefaults, flightDefaults, maneuverDefaults, stallDefaults } from './defaults'

// Arcade approximation of canted twin nozzles, not measured Su-57 performance.
// Pitch uses both together; yaw and roll share differential nozzle travel.
export const su57TvcProfile: ThrustVectoringProfile = {
  maxAngle: 18,
  rollGain: 6,
  yawGain: 14,
  cantDeg: 30,
  actuatorRate: 36,
  actuatorResponse: 7,
  authorityResponse: 5,
  pivotX: -7.2,
  height: -0.6691,
  spacing: 1.3903,
  lipArm: 1.02,
  inertia: { roll: 18, yaw: 40, pitch: 40 },
}

export const su57Profile: AircraftFlightProfile = {
  aero: { ...aeroDefaults },
  flight: {
    ...flightDefaults,
    neutralDampingDuringPsm: false,

    // Speed and energy.
    minPoweredMps: 65,
    topSpeedKph: 1080,             // HUD speed; 200 simulation m/s.
    afterburnerTopSpeedKph: 1400,  // HUD speed; about 259 simulation m/s.
    acceleration: 22.8,
    deceleration: 24,
    maxThrust: 50,
    drag: 0.00035,
    turnDrag: 3.15,

    // Normal-flight handling.
    pitchRate: 0.95,
    yawRate: 0.48,
    rollRate: 2.1,
    turnAcceleration: 145,
  },
  stall: {
    ...stallDefaults,
    stallSpeedKph: 300,
    recoverySpeedKph: 350,
    criticalAoaDeg: 30,
    recoveryAoaDeg: 20,
  },
  maneuver: {
    ...maneuverDefaults,
    psmEnabled: true,
    entryMin: 65,
    entryMax: 115,
    minAltitude: 150,
    pitchRate: 2.6,
    yawRate: 1.85,
    rollRate: 2.1,
    recoveryAcceleration: 66.5,
  },
  thrustVectoring: su57TvcProfile,
}
