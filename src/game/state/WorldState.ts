import type { ThrustVectoringState } from '../flight/thrustVectoring'
import type { PracticeState } from '../playground/practice'
import type { ManeuverState } from '../flight/maneuvers'
import type { WeaponStore } from '../../content/weapons'
import type { AircraftId } from '../../content/schemas'
import type { SpeedLimits } from '../flight/speedLimits'

export type Vec3 = { x: number; y: number; z: number }
export type Quat = Vec3 & { w: number }
export interface AircraftState {
  id: string
  aircraftId: AircraftId
  /** Resolved session limits, in simulation m/s. */
  speedLimits: SpeedLimits
  /** Per-entity inventory for future combat; P3 never consumes it. */
  stores: WeaponStore[]
  position: Vec3
  orientation: Quat
  velocity: Vec3
  maneuver: ManeuverState
  speedDrive: number
  enginePower: number
  thrustVectoring: ThrustVectoringState
  rates: { pitch: number; yaw: number; roll: number }
  stopReason?: 'terrain' | 'boundary'
  alive: boolean
}
export interface WorldState {
  tick: number
  practice: PracticeState
  aircraft: AircraftState[]
}
