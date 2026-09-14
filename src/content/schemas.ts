import type { FlightProfileId } from '../game/flight/profile'
export type AircraftId = string
export const presentationIds = ['f22', 'su57'] as const
export type Locale = 'th' | 'en'
export type LocalizedText = Record<Locale, string>

export interface AircraftDefinition {
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
}
