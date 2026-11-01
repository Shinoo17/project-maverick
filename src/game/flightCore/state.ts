import type { AxisSet } from './profile'

/** Which of the rate command's limits shaped an axis on the last step. */
export type RateLimit = 'none' | 'alpha' | 'g' | 'rate'
/** What the throttle obeyed on the last step (§3.6). */
export type SpeedMode = 'hold' | 'accelerate' | 'decelerate' | 'airbrake' | 'burner'

/** One step's workings, for the Flight Lab overlay (spec §10.2). Read-only; nothing reads it back. */
export interface CoreDiagnostics {
  /** Body rate asked of each axis before the rate response (rad/s). */
  target: AxisSet
  /** The pilot's part of it after the limits (rad/s). */
  pilot: AxisSet
  /** The weathervane's part (rad/s). */
  weathervane: AxisSet
  limit: { pitch: RateLimit; roll: RateLimit; yaw: RateLimit }
  /** The pitch rate band the FBW allowed (rad/s). */
  pitchBand: { low: number; high: number }
  /** Share of the full rates dynamic pressure allows, 0..1. */
  control: number
  /** FD7 roll axis share on the velocity vector, 0..1. */
  rollAxis: number
  /** Accelerations (m/s²): lift and side magnitudes, drag and thrust along their own axes. */
  lift: number; side: number; drag: number; thrust: number
  /** Lift was cut to the G limit. */
  liftCapped: boolean
  speed: { mode: SpeedMode; ratchet: boolean; throttle: number; integral: number }
}

/** The rewrite core's per-aircraft state (AircraftState.coreFlight). Plain numbers only:
 * snapshots structuredClone it, and replays rebuild it from the same commands. */
export interface CoreFlightState {
  /** The speed the hold flies to (m/s). */
  speedTarget: number
  /** Commanded dry throttle 0..1, and the engine's actual output in dry-thrust units (above 1 with burner). */
  throttle: number
  power: number
  /** The hold's integral term, in throttle. */
  holdIntegral: number
  /** Airbrake deployment 0..1. */
  airbrake: number
  burner: { active: boolean; locked: boolean; /** 0..1 */ reserve: number; /** Seconds since it last burned. */ rest: number }
  /** PSM authority 0..1. Always 0 in FR1: the alpha limit stays closed. */
  psmAuthority: number
  // End-of-step observations.
  noseVelocityDeg: number
  g: number
  pathRateDeg: number
  diag: CoreDiagnostics
}

const axes = (): AxisSet => ({ pitch: 0, roll: 0, yaw: 0 })
export function createCoreFlightState(speed: number, power: number): CoreFlightState {
  return {
    speedTarget: speed, throttle: Math.min(1, power), power, holdIntegral: 0, airbrake: 0,
    burner: { active: false, locked: false, reserve: 1, rest: 0 },
    psmAuthority: 0, noseVelocityDeg: 0, g: 1, pathRateDeg: 0,
    diag: {
      target: axes(), pilot: axes(), weathervane: axes(), limit: { pitch: 'none', roll: 'none', yaw: 'none' },
      pitchBand: { low: 0, high: 0 }, control: 1, rollAxis: 0, lift: 0, side: 0, drag: 0, thrust: 0, liftCapped: false,
      speed: { mode: 'hold', ratchet: false, throttle: Math.min(1, power), integral: 0 },
    },
  }
}
