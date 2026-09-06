export type PilotAction =
  | { id: number; type: 'fire-missile' | 'countermeasure' }
  | { id: number; type: 'select-target'; targetId: string | null }
  | { id: number; type: 'select-secondary'; slot: number }

export interface PilotCommand {
  tick: number
  entityId: string
  pitch: number
  roll: number
  yaw: number
  // Signed acceleration request: W = +1, S = -1, release = 0.
  speedAdjust: number
  airbrake: boolean
  afterburner: boolean
  highG: boolean
  psmArm: boolean
  gunHeld: boolean
  actions: PilotAction[]
}

// Camera/UI commands intentionally do not enter this simulation contract.
export function neutralCommand(tick: number, entityId: string): PilotCommand {
  return { tick, entityId, pitch: 0, roll: 0, yaw: 0, speedAdjust: 0, airbrake: false, afterburner: false, highG: false, psmArm: false, gunHeld: false, actions: [] }
}
