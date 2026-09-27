/*
Mission status is computed from progress; it is never stored in content.
Order (docs/game-design/21-campaign.md): PLANNED → COMPLETE → AVAILABLE → LOCKED.
*/
import type { MissionDefinition } from './types'

export type MissionStatus = 'planned' | 'complete' | 'available' | 'locked'

/**
 * Missions cannot be flown yet: the mission runtime (objectives, fail
 * conditions, results) arrives after P5. Until then LAUNCH stays disabled.
 */
export const missionRuntimeReady = false

export function missionStatus(mission: MissionDefinition, completed: ReadonlySet<string>): MissionStatus {
  if (mission.availability === 'planned') return 'planned'
  if (completed.has(mission.id)) return 'complete'
  if (mission.requires.every(id => completed.has(id))) return 'available'
  return 'locked'
}

/** First mission the player can fly next, for the "NEXT" line on Select Mode. */
export function nextMission(missions: readonly MissionDefinition[], completed: ReadonlySet<string>): MissionDefinition | undefined {
  return missions.find(mission => missionStatus(mission, completed) === 'available')
}
