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
  // Phase 8 pedal turn (option B): a yaw-only input asks for 60% of the pull's
  // control power, holding the Su-57 level pedal within ±30 km/h over 360°.
  // Tuned per aircraft only if personalities need it.
  controlPowerAxisWeight: { pitch: 1, yaw: 0.6, roll: 1 },
  driveResponse: 8,
  releaseResponse: 6,
  rateResponse: 5,
  // Commanded-rate hold: the servo stops braking the rate the pilot is commanding.
  // Phase 8 (yaw): a held pedal keeps the yaw rate it has built at low speed; the band
  // fades the hold out before yaw entries at 350+ km/h (owner decision, 26 Sep 2026).
  // MR2 (owner decision D1(b), 26 Sep 2026): pitch holds as the limiter opens, so attached
  // flight keeps the Phase 3 servo; roll holds at every speed. Owner amendment: the pitch
  // hold fades out from 45° to 90° incidence. Without it a held pull tumbled through 180°
  // and f22-notvc rotated 322° in 3 s (B19 < 180°).
  commandedRateHold: { pitch: 1, yaw: 1, roll: 1 },
  commandedRateHoldScope: { pitch: 'limiter', yaw: 'speedBand', roll: 'always' },
  commandedRateHoldSpeedKph: { full: 200, zero: 300 },
  commandedRateHoldIncidenceDeg: { full: 45, zero: 90 },
  // MR2 (RC4): the drive response reaches the counter response once the counter-steered
  // rate is half the target, instead of stepping where the rate crosses zero.
  counterResponseBlend: 0.5,
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

// Path parameters describe continuous flow; there is no PSM entry envelope.
export const maneuverDefaults: ManeuverProfile = {
  pathResponse: 1.5,
  activeGrip: 0.08,
  recoveryGrip: 2.5,
  recoveryAcceleration: 70,
  lateralAcceleration: 55,

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
