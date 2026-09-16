import type { AircraftFlightProfile } from '../../game/flight/profileTypes'
import { flightDefaults, maneuverDefaults, stallDefaults } from './defaults'

export const su57Profile: AircraftFlightProfile = {
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
    activeSeconds: 3,
    cooldown: 4.5,
    recoveryAcceleration: 66.5,
  },
  // Generic PSM assist with presentation-only nozzles. The pitch-only twin-engine
  // force solver does not represent the Su-57's three-axis nozzle rig.
  thrustVectoring: null,
}
