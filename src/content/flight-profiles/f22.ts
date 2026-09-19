import type { AircraftFlightProfile, ThrustVectoringProfile } from '../../game/flight/profileTypes'
import { aeroDefaults, flightDefaults, maneuverDefaults, stallDefaults } from './defaults'

export const f22TvcProfile: ThrustVectoringProfile = {
  maxAngle: 20,
  rollGain: 6,
  yawGain: 0,
  cantDeg: 0,
  actuatorRate: 45,
  actuatorResponse: 7,
  authorityResponse: 5,

  pivotX: -6.3824,
  height: -1.0373,
  spacing: 0.6517,
  lipArm: 0.983,
  inertia: { roll: 12, yaw: 40, pitch: 40 },
}

export const f22Profile: AircraftFlightProfile = {
  aero: {
    ...aeroDefaults,
    // Arcade stability: predictable high-incidence return; no powered authority.
    restoring: { pitch: [{ incidenceDeg: 0, stiffness: 1.2 }, { incidenceDeg: 20, stiffness: 1.2 }, { incidenceDeg: 45, stiffness: 1.0 }, { incidenceDeg: 90, stiffness: 0.65 }, { incidenceDeg: 180, stiffness: 0.45 }], yaw: [{ incidenceDeg: 0, stiffness: 0.9 }, { incidenceDeg: 20, stiffness: 0.9 }, { incidenceDeg: 45, stiffness: 0.75 }, { incidenceDeg: 90, stiffness: 0.5 }, { incidenceDeg: 180, stiffness: 0.35 }] },
    damping: { attached: { pitch: 0.1, yaw: 0.12, roll: 0.08 }, separated: { pitch: 0.65, yaw: 0.55, roll: 0.35 } },
    alphaDrag: 0.0025, betaDrag: 0.003, reverseDrag: 0.4,
  },
  flight: {
    ...flightDefaults,
    neutralRollResponse: 9,

    // Speed and energy.
    minPoweredMps: 65,
    topSpeedKph: 1080,             // HUD speed; 200 simulation m/s.
    afterburnerTopSpeedKph: 1400,  // HUD speed; about 259 simulation m/s.
    acceleration: 24,
    deceleration: 24,
    maxThrust: 50,
    drag: 0.00035,
    turnDrag: 3,

    // Normal-flight handling.
    pitchRate: 0.95,
    yawRate: 0.42,
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
    yawRate: 1.6,
    rollRate: 2.1,
    recoveryAcceleration: 70,
  },
  thrustVectoring: f22TvcProfile,
}
