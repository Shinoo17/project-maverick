import type { ThrustVectoringState } from '../flight/thrustVectoring'
import type { PracticeState } from '../playground/practice'
import type { ManeuverState } from '../flight/maneuvers'
import type { WeaponStore } from '../../content/weapons'
import type { AircraftId } from '../../content/schemas'
import type { SpeedLimits } from '../flight/speedLimits'
import type { StallState } from '../flight/stall'
import type { PilotIntent } from '../flight/intent'
import type { EngineState } from '../flight/engine'
import type { FlightForces } from '../flight/flightForces'
import type { GunState } from '../combat/gun'
import type { Projectile } from '../combat/projectiles'

export type Vec3 = { x: number; y: number; z: number }
export type Quat = Vec3 & { w: number }
export interface AircraftState {
  id: string
  aircraftId: AircraftId
  /** Who flies it. 'hold' (the target drone) keeps its pose and never reads a command. */
  control: 'pilot' | 'hold'
  /** Resolved session limits, in simulation m/s. */
  speedLimits: SpeedLimits
  /** Per-entity inventory for future combat. The gun never consumes it: gun ammo is unlimited and heat limits bursts. */
  stores: WeaponStore[]
  gun: GunState
  position: Vec3
  orientation: Quat
  velocity: Vec3
  maneuver: ManeuverState
  stall: StallState
  speedDrive: number
  /** Actual power, normalized by the dry thrust limit; may exceed 1 with burner. */
  enginePower: number
  engine: EngineState
  intent: PilotIntent
  /** Continuous automatic permission. No manual override exists. */
  limiterOpen: number
  /** Smoothed explicit translational assistance permission. */
  pathAssistWeight: number
  thrustVectoring: ThrustVectoringState
  rates: { pitch: number; yaw: number; roll: number }
  /** Read-only diagnostics, populated after the first integrated flight substep. */
  flightForces?: FlightForces
  stopReason?: 'terrain' | 'boundary'
  alive: boolean
}
export interface WorldState {
  tick: number
  practice: PracticeState
  aircraft: AircraftState[]
  /** Gun rounds in flight. */
  projectiles: Projectile[]
  /** The next projectile id; only goes up, so ids are never reused. */
  nextProjectileId: number
}
