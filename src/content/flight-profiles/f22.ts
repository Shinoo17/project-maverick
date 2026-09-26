import type { AircraftFlightProfile, ThrustVectoringProfile } from '../../game/flight/profileTypes'
import { bankedDriftDefaults, breakoutDefaults, aeroDefaults, flightDefaults, maneuverDefaults, recoveryDefaults, stallDefaults } from './defaults'

export const f22TvcProfile: ThrustVectoringProfile = {
  maxAngle: 20,
  rollGain: 6,
  yawGain: 0,
  cantDeg: 0,
  actuatorRate: 45,
  actuatorResponse: 7,
  gain: 2,

  pivotX: -6.3824,
  height: -1.0373,
  spacing: 0.6517,
  lipArm: 0.983,
  inertia: { roll: 12, yaw: 40, pitch: 40 },
}

export const f22Profile: AircraftFlightProfile = {
  breakout: { ...breakoutDefaults },
  bankedDrift: { ...bankedDriftDefaults },
  recovery: { ...recoveryDefaults },
  arcadeControlFloor: { acceleration: { pitch: 0.25, yaw: 0.18, roll: 0.3 }, maxRate: { pitch: 0.2, yaw: 0.15, roll: 0.3 } },
  engine: { spoolUpResponse: 4, spoolDownResponse: 6 },
  aero: {
    ...aeroDefaults,
    maxControllableAlphaDeg: 180,
    controlAcceleration: { pitch: 4.75, yaw: 2.1, roll: 10.5 },
    pathRateFloorMps: 40,
    // Arcade stability: predictable high-incidence return; no powered authority.
    restoring: { pitch: [{ incidenceDeg: 0, stiffness: 1.2 }, { incidenceDeg: 20, stiffness: 1.2 }, { incidenceDeg: 45, stiffness: 1.0 }, { incidenceDeg: 90, stiffness: 0.65 }, { incidenceDeg: 180, stiffness: 0.45 }], yaw: [{ incidenceDeg: 0, stiffness: 0.9 }, { incidenceDeg: 20, stiffness: 0.9 }, { incidenceDeg: 45, stiffness: 0.75 }, { incidenceDeg: 90, stiffness: 0.5 }, { incidenceDeg: 180, stiffness: 0.35 }] },
    damping: { attached: { pitch: 0.1, yaw: 0.12, roll: 0.08 }, separated: { pitch: 0.65, yaw: 0.55, roll: 0.35 } },
    alphaDrag: 0.0025, betaDrag: 0.003, reverseDrag: 0.4,
  },
  flight: {
    ...flightDefaults,
    neutralRollResponse: 9.1,
    minRateTarget: { pitch: 0.2, yaw: 0.15, roll: 0.3 },
    commandedRateHold: { ...flightDefaults.commandedRateHold },
    commandedRateHoldScope: { ...flightDefaults.commandedRateHoldScope },
    commandedRateHoldSpeedKph: { ...flightDefaults.commandedRateHoldSpeedKph },
    commandedRateHoldIncidenceDeg: { ...flightDefaults.commandedRateHoldIncidenceDeg },
    controlPowerAxisWeight: { ...flightDefaults.controlPowerAxisWeight },

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
    separationAttachedSpeedKph: 350,
    criticalAoaDeg: 30,
    separationAttachedAoaDeg: 20,
  },
  maneuver: {
    ...maneuverDefaults,
    recoveryAcceleration: 70,
  },
  thrustVectoring: f22TvcProfile,
}
