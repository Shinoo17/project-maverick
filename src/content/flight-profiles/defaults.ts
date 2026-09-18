import type { AeroProfile, FlightProfile, ManeuverProfile, StallProfile } from '../../game/flight/profileTypes'

export const aeroDefaults: AeroProfile = {
  referenceSpeedMps: 90,
  highSpeedMps: 160,
  // Provisional incidence band preserves Phase 1 highAoa; per-aircraft playtest
  // will author these independently. Never derive them from stall thresholds.
  alphaNormalDeg: 20,
  alphaCriticalDeg: 30,
}

// Shared control responses. Airframe performance belongs in each aircraft file.
// Changing these defaults affects every aircraft that does not override them.
export const flightDefaults = {
  afterburnerAcceleration: 38,
  airbrakeDeceleration: 30,
  driveResponse: 8,
  releaseResponse: 6,
  rateResponse: 5,
  rollReversalResponse: 18,
  counterResponse: 12,
  neutralResponse: 9,
  turnRateReserve: 0.9,
  pathResponse: 4,
  turnAnticipation: 0.65,
  gravity: 9.81,
} satisfies Partial<FlightProfile>

// Forgiving transitions shared by all airframes; author the envelope per aircraft.
export const stallDefaults = {
  controlAuthority: 0.25,
  dragMultiplier: 1.8,
  entrySeconds: 0.4,
  recoverySeconds: 1.2,
} satisfies Partial<StallProfile>

// New aircraft must opt into PSM. The remaining PSM values are a tuning baseline;
// they do not grant the capability while psmEnabled is false.
export const maneuverDefaults: ManeuverProfile = {
  psmEnabled: false,
  entryMin: 65,
  entryMax: 115,
  minAltitude: 150,

  pitchRate: 2.6,
  yawRate: 1.6,
  rollRate: 2.1,
  exitSpeed: 135,
  blendSeconds: 0.6,
  fullControlThrust: 24,

  pathResponse: 1.5,
  activeGrip: 0.08,
  recoveryGrip: 2.5,
  recoveryAcceleration: 70,
  lateralAcceleration: 55,
  psmDrag: 0.0025,
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
