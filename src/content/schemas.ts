import type { FlightProfileId } from './flight-profiles'
import type { FlightSpeedOverride } from '../game/flight/profileTypes'
export type AircraftId = string
export const presentationIds = ['f22', 'su57'] as const
export type Locale = 'th' | 'en'
export type LocalizedText = Record<Locale, string>

export interface AircraftDefinition {
  /** Development validation variants are selectable only in Playground. */
  playgroundOnly?: boolean
  id: AircraftId
  flightProfileId: FlightProfileId
  presentationId: typeof presentationIds[number]
  weaponStationProfileId: string
  designation: string
  name: string
  /* Role / signature trait shown under the airframe name on the stage. */
  role: LocalizedText
  modelFile: string
  rotation: [number, number, number]
  removeNodes: string[]
  description: LocalizedText
}

export interface SessionConfig {
  mode: 'playground' | 'offline'
  mapId?: 'flat-range'
  aircraftIds: AircraftId[]
  /** Per aircraft type, in the same ARCADE km/h units as its profile. */
  flightOverrides?: Record<AircraftId, FlightSpeedOverride>
}
