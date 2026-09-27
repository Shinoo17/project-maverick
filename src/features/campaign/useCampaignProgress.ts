/*
Campaign progress for the menus: which missions are done, how many, and what
comes next. Read once per mount; nothing writes progress until missions are
playable (after P5).
*/
import { useMemo } from 'react'
import { firstOperation } from '../../content/campaign/firstOperation'
import { nextMission } from '../../content/campaign/missionStatus'
import { completedMissions, loadCampaignProgress } from '../../platform/campaignProgress'

export function useCampaignProgress() {
  return useMemo(() => {
    const operation = firstOperation
    const completed = completedMissions(loadCampaignProgress(), operation.id)
    const done = operation.missions.filter(mission => completed.has(mission.id)).length
    return { operation, completed, done, total: operation.missions.length, next: nextMission(operation.missions, completed) }
  }, [])
}
