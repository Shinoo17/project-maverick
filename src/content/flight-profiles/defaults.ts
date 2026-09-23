import { simulationSpeed } from '../../game/flight/speedLimits'
import type { AeroProfile, BankedDriftProfile, BreakoutProfile, FlightProfile, ManeuverProfile, RecoveryProfile, StallProfile } from '../../game/flight/profileTypes'

export const aeroDefaults: Pick<AeroProfile, 'referenceSpeedMps' | 'highSpeedMps' | 'alphaNormalDeg' | 'alphaCriticalDeg' | 'controlEffectiveness' | 'departure'> = {
  referenceSpeedMps: 90,
  highSpeedMps: 160,
  // Tail-slide nose drop, shared by both airframes. Provisional until playtest.
  departure: { stiffness: 3, minPressure: 0.3 },
  // Control-surface effectiveness versus unsigned incidence. Attached flow keeps
  // full effectiveness to 25°, deliberately leaving ordinary flight unchanged;
  // past that the shape follows the forward-flow projection (cos incidence) down
  // to an authored stalled residual, so pure sideslip loses surface authority
  // exactly like pure alpha. One shape for all three axes and all airframes on
  // purpose: per-axis and per-aircraft differentiation is Phase 8 tuning, not an
  // architecture decision. Provisional until that playtest.
  controlEffectiveness: {
    pitch: [{ incidenceDeg: 0, effectiveness: 1 }, { incidenceDeg: 25, effectiveness: 1 }, { incidenceDeg: 45, effectiveness: 0.71 }, { incidenceDeg: 60, effectiveness: 0.5 }, { incidenceDeg: 90, effectiveness: 0.15 }, { incidenceDeg: 120, effectiveness: 0.09 }, { incidenceDeg: 180, effectiveness: 0.05 }],
    yaw: [{ incidenceDeg: 0, effectiveness: 1 }, { incidenceDeg: 25, effectiveness: 1 }, { incidenceDeg: 45, effectiveness: 0.71 }, { incidenceDeg: 60, effectiveness: 0.5 }, { incidenceDeg: 90, effectiveness: 0.15 }, { incidenceDeg: 120, effectiveness: 0.09 }, { incidenceDeg: 180, effectiveness: 0.05 }],
    roll: [{ incidenceDeg: 0, effectiveness: 1 }, { incidenceDeg: 25, effectiveness: 1 }, { incidenceDeg: 45, effectiveness: 0.71 }, { incidenceDeg: 60, effectiveness: 0.5 }, { incidenceDeg: 90, effectiveness: 0.15 }, { incidenceDeg: 120, effectiveness: 0.09 }, { incidenceDeg: 180, effectiveness: 0.05 }],
  },
  // Neutral-assist fade band. Retained 20–30° starting tune; human playtest
  // remains pending. Independent of the continuous separation band.
  alphaNormalDeg: 20,
  alphaCriticalDeg: 30,
}

// Shared control responses. Airframe performance belongs in each aircraft file.
// Changing these defaults affects every aircraft that does not override them.
export const flightDefaults = {
  afterburnerAcceleration: 38,
  airbrakeDeceleration: 30,
  airbrakeCrossflow: 0.25, controlPower: 0.7,
  driveResponse: 8,
  releaseResponse: 6,
  rateResponse: 5,
  rollReversalResponse: 18,
  counterResponse: 12,
  neutralResponse: 9,
  turnRateReserve: 0.9,
  pathResponse: 4,
  physicalPathResponse: 0.35, physicalPathAcceleration: 40, pathAssistAcceleration: 250, pathAssistResponse: 18,
  turnAnticipation: 0.65,
  gravity: 9.81,
} satisfies Partial<FlightProfile>

// Forgiving transitions shared by all airframes; author the envelope per aircraft.
export const stallDefaults = {
  controlAuthority: 0.25,
  dragMultiplier: 1.8,
  separationEntrySeconds: 0.4,
  separationRecoverySeconds: 1.2,
} satisfies Partial<StallProfile>

// C comparison remains opt-in. Path parameters now describe continuous flow;
// automatic permission and physical capability do not depend on psmEnabled.
export const maneuverDefaults: ManeuverProfile = {
  psmEnabled: false,
  entryMin: 65,
  entryMax: 115,
  minAltitude: 150,

  exitSpeed: 135,
  blendSeconds: 0.6,

  pathResponse: 1.5,
  activeGrip: 0.08,
  recoveryGrip: 2.5,
  recoveryAcceleration: 70,
  lateralAcceleration: 55,
  recoveryIncidenceRad: 0.3,
  recoverySpeedMps: 60,
  highGMinSpeedMps: 75,
  highGMaxSpeedMps: 190,
  highGSpeedFadeMps: 15,

  highGRate: 1.4,
  highGDrag: 2,
  burnerSeconds: 6,
  burnerRecharge: 12,
}

// Shared provisional envelope, without aircraft personality tuning (Phase 8).
export const breakoutDefaults: BreakoutProfile = {
  handoffSeconds: 0.22,
  qLow: (simulationSpeed(650) / aeroDefaults.referenceSpeedMps) ** 2, qHigh: (simulationSpeed(850) / aeroDefaults.referenceSpeedMps) ** 2,
  baseWeight: 0.08, brakeWeight: 0.92, decelerationWeight: 0.45, powerWeight: 0.1, comboWeight: 0.1,
  sustainWeight: 0.05,
  openRate: 5, closeRate: 2, brakeBoost: 1, powerBoost: 1,
  hardTurnG: 1.6,
}

// Provisional until playtest. The delay outlasts breakout.handoffSeconds so a brief
// neutral gap between chained inputs never starts recovery.
export const recoveryDefaults: RecoveryProfile = {
  delaySeconds: 0.3,
  rampSeconds: 0.3,
  response: 5,
  noseRate: 1.2,
}

// Provisional until playtest. Speed band sits under the S floor (minPoweredMps ≈ 351 km/h).
export const bankedDriftDefaults: BankedDriftProfile = {
  bankStartDeg: 55, bankFullDeg: 80,
  speedStartKph: 280, speedFullKph: 330,
  maxAlphaDeg: 35,
  pathGrip: 0.4,
}
