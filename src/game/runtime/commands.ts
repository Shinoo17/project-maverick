export type PilotAction =
  | { id: number; type: 'fire-missile' | 'countermeasure' }
  | { id: number; type: 'select-target'; targetId: string | null }
  | { id: number; type: 'select-secondary'; slot: number }
  /** T: step the gun's selected target to the next candidate. One per key press. */
  | { id: number; type: 'next-target' }

/** Bump when PilotCommand fields or their meaning change; replays of another schema are rejected.
 * 2: Phase 6 removed the psmArm (C) and highG (Space) fields; Space now drives airbrake.
 * 3: flight rewrite FR1 added `psm` (Space); airbrake moved to X.
 * 4: `gunTrack`, the gun lock's magnet (2026-11-16). */
export const commandSchemaVersion = 4

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
  /** PSM override held (Space). A permission, never a maneuver. */
  psm: boolean
  gunHeld: boolean
  /** Gun lock held (game/combat/gunLock.ts): where the nose must point for the rounds to hit (world,
   * unit). The arcade core draws the nose onto it; other cores ignore it. Absent when not locked. */
  gunTrack?: { x: number; y: number; z: number }
  actions: PilotAction[]
}

// Camera/UI commands intentionally do not enter this simulation contract.
export function neutralCommand(tick: number, entityId: string): PilotCommand {
  return { tick, entityId, pitch: 0, roll: 0, yaw: 0, speedAdjust: 0, airbrake: false, afterburner: false, psm: false, gunHeld: false, actions: [] }
}
