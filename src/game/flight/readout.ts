import type { AircraftState, Quat, Vec3 } from '../state/WorldState'
import { flightCoreOf } from './core'

/*
FlightReadout: the one view of a flying aircraft that everything outside the flight core reads
(HUD, telemetry, camera, rigs, exhaust, vapor, sound, practice, bot, input). Each core fills it
from its own state, so a consumer never names maneuver, stall, intent or thrustVectoring, and
swapping cores (docs/flight-rewrite-plan.md §3.2) changes nothing outside the core.

Two kinds of value:
- Step values: what the last flight step flew with or ended on. A pose never changes them.
- Air values: observed at `pose` (default: the state's own pose). The render loop passes the
  interpolated pose, so the camera and the HUD glass read the air between ticks.
*/
export type FlightRegime = 'NORMAL' | 'HIGH_AOA' | 'POST_STALL' | 'RECOVERING' | 'DEPARTED'
export type BurnerStatus = 'engaged' | 'depleted' | 'recharging' | 'ready'
export interface FlightReadout {
  // --- Step values ---
  /** Unsigned nose–velocity angle the last step ended on (degrees). Not alpha: it counts yaw too. */
  noseVelocityDeg: number
  /** Load factor of the last step. */
  g: number
  /** Turn rate of the flight path over the last step (deg/s). */
  pathRateDeg: number
  /** Engine output, normalized by the dry thrust limit; above 1 with burner. */
  power: number
  burner: { active: boolean; status: BurnerStatus; /** 0..1 */ reserve: number; seconds: number }
  /** Airbrake deployment, 0..1. */
  airbrake: number
  /** PSM authority, 0..1: how far the alpha limit is open. */
  psmAuthority: number
  /** Nozzle angles (degrees, positive = exhaust up); null without thrust vectoring. */
  nozzle: { left: number; right: number } | null
  /** Separated-flow share, 0..1. A label for HUD and effects, not a mode. */
  postStall: number
  /** G the flight envelope allowed on the last step, as a multiple of the normal limit. */
  gAllowance: number
  // --- Air values (at the pose) ---
  /** Airspeed in simulation m/s. */
  airspeed: number
  /** Airspeed in HUD km/h (arcade units). */
  hudSpeed: number
  /** Signed pitch-plane angle of attack (degrees). */
  alphaDeg: number
  /** Signed sideslip (degrees). */
  betaDeg: number
  /** Unsigned nose–velocity angle at the pose (degrees). */
  incidenceDeg: number
  /** 0..1: how far the angles can be trusted. They lose meaning near rest. */
  angleConfidence: number
  /** 0..1 share of high-incidence flight, already weighted by confidence. */
  highAoa: number
  regime: FlightRegime
  /** The alpha limit in force (degrees). */
  alphaLimitDeg: number
  /** The aircraft's alpha marks (degrees): normal flight, critical, most it can hold. */
  alphaBandDeg: { normal: number; critical: number; max: number }
}
/** A pose to observe the air at; any field left out is the state's own. */
export type FlightPose = { orientation?: Quat; velocity?: Vec3 }

export function readFlight(state: AircraftState, pose?: FlightPose): FlightReadout {
  return flightCoreOf(state).readout(state, pose)
}
