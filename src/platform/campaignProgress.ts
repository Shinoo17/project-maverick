/*
Campaign progress lives under its own storage key, apart from settings, so a
settings reset never erases it. Nothing writes progress yet: missions become
playable after P5. Reading is safe against missing or broken data.
*/
export interface CampaignProgress {
  schemaVersion: 1
  operations: Record<string, { completed: Record<string, { firstClearedAt: string }> }>
}

const STORAGE_KEY = 'maverick.campaign'
const emptyProgress = (): CampaignProgress => ({ schemaVersion: 1, operations: {} })

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Keeps every well-formed entry and drops the rest. Unknown mission ids stay: content may add them back. */
export function parseCampaignProgress(raw: string | null): CampaignProgress {
  let value: unknown
  try { value = JSON.parse(raw ?? 'null') } catch { return emptyProgress() }
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.operations)) return emptyProgress()

  const progress = emptyProgress()
  for (const [operationId, operation] of Object.entries(value.operations)) {
    if (!isRecord(operation) || !isRecord(operation.completed)) continue
    const completed: CampaignProgress['operations'][string]['completed'] = {}
    for (const [missionId, entry] of Object.entries(operation.completed)) {
      if (isRecord(entry) && typeof entry.firstClearedAt === 'string') completed[missionId] = { firstClearedAt: entry.firstClearedAt }
    }
    progress.operations[operationId] = { completed }
  }
  return progress
}

export function loadCampaignProgress(): CampaignProgress {
  try { return parseCampaignProgress(localStorage.getItem(STORAGE_KEY)) } catch { return emptyProgress() }
}

/** Ids of the completed missions of one operation. */
export function completedMissions(progress: CampaignProgress, operationId: string): Set<string> {
  return new Set(Object.keys(progress.operations[operationId]?.completed ?? {}))
}
