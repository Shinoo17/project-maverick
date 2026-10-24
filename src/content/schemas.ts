import type { TargetDroneMode } from '../game/playground/dronePath'
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
  /** Key into `hitboxes` (src/content/hitboxes.ts). */
  hitboxProfileId: string
  /** The search radar as the game models it (src/game/combat/radar.ts). Gameplay tuning, not the
   * real set's performance, which is not public (doc 05): never shown as a fact in the Hangar. */
  radar: RadarSpec
  designation: string
  name: string
  /* Role / signature trait shown under the airframe name on the stage. */
  role: LocalizedText
  modelFile: string
  rotation: [number, number, number]
  removeNodes: string[]
  description: LocalizedText
  /** Copy for the Hangar screen. */
  hangar: AircraftHangarInfo
}

export interface RadarSpec {
  /** Half-angle off the nose, in degrees, the radar sees and holds a lock in. */
  coneDeg: number
  /** Metres it sees out to. */
  rangeM: number
}

export interface AircraftHangarInfo {
  /** Game role tag, e.g. 'Air superiority'. */
  gameRole: LocalizedText
  /** How the aircraft wins, e.g. 'Energy fighter'. */
  playStyle: LocalizedText
  /** One or two sentences of advice for the player. */
  tip: LocalizedText
  /** Short history from checked facts. */
  history: LocalizedText
}

export interface SessionConfig {
  mode: 'playground' | 'offline'
  mapId?: 'flat-range'
  aircraftIds: AircraftId[]
  /** Playground only: adds a target drone ahead of the spawn that holds still or flies a path
   * (src/game/playground/dronePath.ts). Absent or false = no drone; true = 'still' (older sessions). */
  targetDrone?: boolean | TargetDroneMode
  /** Per aircraft type, in the same ARCADE km/h units as its profile. */
  flightOverrides?: Record<AircraftId, FlightSpeedOverride>
}
