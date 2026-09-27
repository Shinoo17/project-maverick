import type { MissionStatus } from '../../content/campaign/missionStatus'

/** Translation key for each mission status. */
export const statusLabel = {
  complete: 'statusComplete',
  available: 'statusAvailable',
  locked: 'statusLocked',
  planned: 'statusPlanned',
} as const satisfies Record<MissionStatus, string>
