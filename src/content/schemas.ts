export type AircraftId = 'f22' | 'su57'
export type Locale = 'th' | 'en'
export type LocalizedText = Record<Locale, string>

export interface AircraftDefinition {
  id: AircraftId
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
