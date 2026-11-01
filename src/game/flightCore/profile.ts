import { getAircraft } from '../../content/aircraft'

/*
The rewrite core's aircraft data (docs/flight-rewrite-plan.md §3.8). One flat table per
aircraft, authored in the units the owner tunes in: degrees, seconds and HUD km/h. Every number
is a placeholder until playtest; none is copied from Ace Combat or a video.

Two configs, kept apart as the spec asks (§11): CoreProfile is what the airframe can do,
CoreAssist is how much the game helps. Camera presentation stays in the camera.

The content objects here are never mutated. The Flight Lab tuning panel builds a CoreTuning
(a patch per aircraft plus an assist patch) that the runtime hands the core every step, so a
tuned flight never leaks into tests, the bot or the next session.
*/
export interface AxisSet { pitch: number; roll: number; yaw: number }

export interface CoreProfile {
  // --- Rotation: rate command (§3.3) ---
  /** Full-stick body rate (deg/s) in the combat speed range. */
  maxRate: AxisSet
  /** Time constant of the rate response (s). */
  tau: AxisSet
  /** Most the rate may change per second (deg/s²). */
  maxAccel: AxisSet
  /** HUD km/h above which the full rates are available; below, they fall with dynamic pressure. */
  controlSpeedKph: number
  /** Load factor limits, pulling and pushing (G). */
  gLimit: number
  gLimitNeg: number
  /** The FBW alpha limit while PSM is closed (deg). Below alphaCritDeg, so normal flight never stalls. */
  aoaLimitDeg: number
  /** Nose-to-path return rate at corner speed and 90° (1/s). Pitch acts only above aoaLimitDeg; yaw always. */
  weathervane: number
  /** FD7: how far the roll axis moves from the body to the velocity vector at high alpha, 0..1. Used from FR4. */
  rollAxisWeight: number
  // --- Lift and drag (§3.4) ---
  /** HUD km/h at which CLmax lift equals the G limit. Sets the aerodynamic scale. */
  cornerSpeedKph: number
  /** Lift slope at small alpha (per radian). */
  clAlpha: number
  /** Alpha of peak lift (deg); past it lift falls and the path stops following the nose. */
  alphaCritDeg: number
  clMax: number
  /** Flat-plate lift peak past the stall (reached at 45°). */
  clPost: number
  cd0: number
  inducedK: number
  /** Drag coefficient of sin² alpha and sin² beta (high-incidence drag). */
  cdHigh: number
  /** Side force from sideslip, per sin beta. */
  cyBeta: number
  /** Extra drag coefficient of the airbrake (X) and of the S key's soft brake. */
  airbrakeCd: number
  brakeCd: number
  // --- Engine ---
  /** Dry and afterburner thrust (m/s²). */
  thrustDry: number
  thrustBurner: number
  /** Engine spool rate (1/s). */
  spool: number
  burnerSeconds: number
  burnerRecharge: number
  // --- PSM (§3.5). Present from FR1; the core opens nothing with them until FR4. ---
  /** Body rate PSM authority gives at low dynamic pressure (deg/s). */
  psmRate: AxisSet
  /** PSM authority by HUD km/h, as [speed, share] points. */
  psmAuthority: Array<[number, number]>
  /** Thrust-vectoring nozzles, for the rigs and exhaust. No physics in FR1. */
  tvc: boolean
}

export interface CoreAssist {
  /** Speed hold (§3.6): throttle per m/s of speed error, and its integral gain (1/s per m/s). */
  holdGain: number
  holdIntegral: number
  /** Above this load factor the held speed follows the actual speed down (ratchet). */
  ratchetG: number
  /** Digital keys: seconds from 0 to full deflection, and from full back to 0 (§4.4). */
  digitalRise: number
  digitalRelease: number
  /** Coordinated turn (←/→): the bank it rolls to (deg), how fast it closes the bank error (s), and how fast it corrects climb or sink (s). */
  turnBankDeg: number
  turnBankSeconds: number
  turnHoldSeconds: number
}

export const coreAssist: Readonly<CoreAssist> = {
  holdGain: 0.06, holdIntegral: 0.02, ratchetG: 3,
  digitalRise: 0.15, digitalRelease: 0.12,
  turnBankDeg: 60, turnBankSeconds: 0.3, turnHoldSeconds: 2,
}

// Spec §8.2, the example curve for a full-PSM aircraft.
const fullPsmCurve: Array<[number, number]> = [[200, 0.15], [300, 0.55], [350, 0.85], [400, 1], [500, 1], [550, 0.8], [600, 0.55], [650, 0.25], [700, 0.05], [800, 0]]

export const f22Core: Readonly<CoreProfile> = {
  maxRate: { pitch: 60, roll: 180, yaw: 22 },
  tau: { pitch: 0.12, roll: 0.1, yaw: 0.15 },
  maxAccel: { pitch: 420, roll: 1500, yaw: 200 },
  controlSpeedKph: 300,
  gLimit: 9, gLimitNeg: 3,
  aoaLimitDeg: 24,
  weathervane: 2,
  rollAxisWeight: 0.6,
  cornerSpeedKph: 500,
  clAlpha: 3.6, alphaCritDeg: 30, clMax: 1.6, clPost: 1,
  cd0: 0.058, inducedK: 0.15, cdHigh: 0.6, cyBeta: 1.2,
  airbrakeCd: 0.25, brakeCd: 0.05,
  thrustDry: 15, thrustBurner: 26, spool: 3, burnerSeconds: 6, burnerRecharge: 12,
  psmRate: { pitch: 120, roll: 120, yaw: 40 },
  psmAuthority: fullPsmCurve,
  tvc: true,
}

export const su57Core: Readonly<CoreProfile> = {
  ...f22Core,
  maxRate: { pitch: 58, roll: 170, yaw: 26 },
  rollAxisWeight: 1,
  cornerSpeedKph: 480,
  cyBeta: 1.1,
  psmRate: { pitch: 120, roll: 120, yaw: 80 },
}

// By flight profile id, so every aircraft in the Flight Lab list has one.
const byFlightProfile: Record<string, Readonly<CoreProfile>> = {
  'raptor-energy': f22Core,
  'felon-agility': su57Core,
  'raptor-notvc': { ...f22Core, tvc: false },
}

/** A Flight Lab patch: per aircraft id, and one for the assists. */
export interface CoreTuning {
  profiles?: Partial<Record<string, Partial<CoreProfile>>>
  assist?: Partial<CoreAssist>
}

export function coreProfileOf(aircraftId: string, tuning?: CoreTuning): CoreProfile {
  const base = byFlightProfile[getAircraft(aircraftId).flightProfileId]
  if (!base) throw new Error(`No rewrite core profile for aircraft '${aircraftId}'`)
  return { ...base, ...tuning?.profiles?.[aircraftId] }
}
export const coreAssistOf = (tuning?: CoreTuning): CoreAssist => ({ ...coreAssist, ...tuning?.assist })

/** Throws on assists the input or the speed hold cannot use: every one is a positive number. */
export function validateCoreAssist(a: CoreAssist, path = 'coreAssist') {
  for (const [key, value] of Object.entries(a)) if (!(Number.isFinite(value) && value > 0)) throw new Error(`${path}.${key}: expected a positive number`)
}

/** Throws on a profile the core cannot fly sensibly. */
export function validateCoreProfile(p: CoreProfile, path = 'coreProfile') {
  const positive = { controlSpeedKph: p.controlSpeedKph, gLimit: p.gLimit, gLimitNeg: p.gLimitNeg, aoaLimitDeg: p.aoaLimitDeg, cornerSpeedKph: p.cornerSpeedKph, clAlpha: p.clAlpha, alphaCritDeg: p.alphaCritDeg, clMax: p.clMax, thrustDry: p.thrustDry, spool: p.spool, burnerSeconds: p.burnerSeconds, burnerRecharge: p.burnerRecharge }
  for (const [key, value] of Object.entries(positive)) if (!(Number.isFinite(value) && value > 0)) throw new Error(`${path}.${key}: expected a positive number`)
  for (const group of ['maxRate', 'tau', 'maxAccel', 'psmRate'] as const) for (const axis of ['pitch', 'roll', 'yaw'] as const)
    if (!(Number.isFinite(p[group][axis]) && p[group][axis] > 0)) throw new Error(`${path}.${group}.${axis}: expected a positive number`)
  for (const [key, value] of Object.entries({ weathervane: p.weathervane, clPost: p.clPost, cd0: p.cd0, inducedK: p.inducedK, cdHigh: p.cdHigh, cyBeta: p.cyBeta, airbrakeCd: p.airbrakeCd, brakeCd: p.brakeCd }))
    if (!(Number.isFinite(value) && value >= 0)) throw new Error(`${path}.${key}: expected a non-negative number`)
  if (p.aoaLimitDeg >= p.alphaCritDeg) throw new Error(`${path}.aoaLimitDeg: must stay below alphaCritDeg, or normal flight stalls`)
  if (!(p.rollAxisWeight >= 0 && p.rollAxisWeight <= 1)) throw new Error(`${path}.rollAxisWeight: expected 0..1`)
  if (p.thrustBurner < p.thrustDry) throw new Error(`${path}.thrustBurner: must be at least thrustDry`)
}
