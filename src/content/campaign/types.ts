/*
Campaign data shapes (docs/game-design/21-campaign.md).
An operation is a set of missions. A mission unlocks when every mission in its
`requires` list is complete. Weapons are left out on purpose for now.
*/
import type { AircraftId, LocalizedText } from '../schemas'

export type MissionObjective =
  | { kind: 'destroy-air'; count: number }
  | { kind: 'destroy-ground'; targets: number }
  | { kind: 'protect'; entities: number }
  | { kind: 'survive'; seconds: number }

export interface MissionDefinition {
  id: string
  /** Short code on the map box, e.g. 'M03'. */
  code: string
  title: LocalizedText
  briefing: LocalizedText
  /** Box position on the theatre image, 0–1 from the top-left. UI only. */
  mapPosition: [number, number]
  /** Mission ids that must all be COMPLETE first. */
  requires: string[]
  mapId: string
  aircraft: { kind: 'assigned'; aircraftId: AircraftId } | { kind: 'pilot-choice' }
  threats: LocalizedText
  objectives: MissionObjective[]
  /** 'planned' = the game lacks a system this mission needs. */
  availability: 'ready' | 'planned'
  /** Shown on planned missions: what is still missing. */
  plannedReason?: LocalizedText
}

export interface OperationDefinition {
  id: string
  name: LocalizedText
  missions: MissionDefinition[]
}
