import type { AircraftId } from '../../content/schemas'

export type Vec3 = { x: number; y: number; z: number }
export type Quat = Vec3 & { w: number }
export interface AircraftState {
  id: string
  aircraftId: AircraftId
  position: Vec3
  orientation: Quat
  velocity: Vec3
  alive: boolean
}
export interface WorldState {
  tick: number
  aircraft: AircraftState[]
}
