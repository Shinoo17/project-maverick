import type { AircraftFlightProfile, ThrustVectoringProfile } from '../../game/flight/profileTypes'
import { breakoutDefaults, aeroDefaults, flightDefaults, maneuverDefaults, stallDefaults } from './defaults'

// Arcade approximation of canted twin nozzles, not measured Su-57 performance.
// Pitch uses both together; yaw and roll share differential nozzle travel.
export const su57TvcProfile: ThrustVectoringProfile = {
  maxAngle: 18,
  rollGain: 6,
  yawGain: 14,
  cantDeg: 30,
  actuatorRate: 36,
  actuatorResponse: 7,
  gain: 2,
  pivotX: -7.2,
  height: -0.6691,
  spacing: 1.3903,
  lipArm: 1.02,
  inertia: { roll: 18, yaw: 40, pitch: 40 },
}

export const su57Profile: AircraftFlightProfile = {
  breakout: { ...breakoutDefaults },
  arcadeControlFloor: { acceleration: { pitch: 0.25, yaw: 0.18, roll: 0.3 }, maxRate: { pitch: 0.2, yaw: 0.15, roll: 0.3 } },
  engine: { spoolUpResponse: 4, spoolDownResponse: 6 },
  aero: {
    ...aeroDefaults,
    maxControllableAlphaDeg: 180,
    controlAcceleration: { pitch: 4.75, yaw: 2.4, roll: 10.5 },
    pathRateFloorMps: 40,
    // Arcade stability: more relaxed high-incidence stability; no powered authority.
    restoring: { pitch: [{ incidenceDeg: 0, stiffness: 1.2 }, { incidenceDeg: 20, stiffness: 1.1 }, { incidenceDeg: 45, stiffness: 0.6 }, { incidenceDeg: 90, stiffness: 0.3 }, { incidenceDeg: 180, stiffness: 0.25 }], yaw: [{ incidenceDeg: 0, stiffness: 0.9 }, { incidenceDeg: 20, stiffness: 0.85 }, { incidenceDeg: 45, stiffness: 0.45 }, { incidenceDeg: 90, stiffness: 0.25 }, { incidenceDeg: 180, stiffness: 0.2 }] },
    damping: { attached: { pitch: 0.1, yaw: 0.12, roll: 0.08 }, separated: { pitch: 0.45, yaw: 0.4, roll: 0.3 } },
    alphaDrag: 0.0027, betaDrag: 0.0032, reverseDrag: 0.4,
  },
  flight: {
    ...flightDefaults,
    neutralRollResponse: 5,
    minRateTarget: { pitch: 0.2, yaw: 0.15, roll: 0.3 },

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
    separationAttachedSpeedKph: 350,
    criticalAoaDeg: 30,
    separationAttachedAoaDeg: 20,
  },
  maneuver: {
    ...maneuverDefaults,
    psmEnabled: true,
    entryMin: 65,
    entryMax: 115,
    minAltitude: 150,
    recoveryAcceleration: 66.5,
  },
  thrustVectoring: su57TvcProfile,
}
