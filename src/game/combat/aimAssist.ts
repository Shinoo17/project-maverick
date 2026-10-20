/*
Aim assist: a pilot aid that adds a little pitch and yaw toward the gun solution once the
reticle is already close to the lead marker (the user asked for it on 2026-10-21, after the
display-only aids were not enough). It works on the pilot's stick, not on the rounds: rounds
never steer and hitboxes never grow (doc 07). It is not hidden either: Settings turns it off
or up, and the HUD says ASSIST while it acts.

It runs where the command is made (the flight scene's input step, a bot's command), so the
command that reaches the simulation already carries it and replays repeat it exactly.

- Error: the solution's aim direction against the current gun line, in the body frame:
  vertical error → pitch, horizontal error → yaw (rolling to turn stays the pilot's job).
- Reach: full inside `full` degrees of error, fading to nothing at `cone` degrees.
- Sharing: small pilot corrections keep the full assist; past a third of the stick on an
  axis the assist gives way, and a full stick is never fought.
*/
import { Quaternion, Vector3 } from 'three'
import type { AircraftState } from '../state/WorldState'
import { solveGun, type GunMount } from './gunSolution'

export type AimAssistLevel = 'off' | 'standard' | 'strong'
export const aimAssistLevels: readonly AimAssistLevel[] = ['off', 'standard', 'strong']

/** Provisional values, waiting on playtest. Gains are stick per radian of error. */
export const aimAssistProfiles: Record<Exclude<AimAssistLevel, 'off'>, { cone: number; full: number; pitchGain: number; yawGain: number }> = {
  standard: { cone: 8, full: 4, pitchGain: 6, yawGain: 8 },
  strong: { cone: 14, full: 8, pitchGain: 9, yawGain: 12 },
}

export interface AimAssist { pitch: number; yaw: number; active: boolean }
const none: AimAssist = { pitch: 0, yaw: 0, active: false }

const turn = new Quaternion(), aimBody = new Vector3()
/** The assist for one command. `pilot` is the pilot's own pitch and yaw this tick. */
export function aimAssist(level: AimAssistLevel, shooter: AircraftState, target: AircraftState | undefined, mount: GunMount, pilot: { pitch: number; yaw: number }): AimAssist {
  if (level === 'off' || !target?.alive || !shooter.alive) return none
  const profile = aimAssistProfiles[level]
  const solution = solveGun(shooter, mount, target)
  if (!solution?.reachable) return none
  const { x, y, z, w } = shooter.orientation
  aimBody.set(solution.aim.x, solution.aim.y, solution.aim.z).applyQuaternion(turn.set(x, y, z, w).invert())
  if (aimBody.x <= 0) return none
  // Errors from the gun line (body +X tilted up by the elevation): up is +pitch, right (+Z) is +yaw.
  const pitchError = Math.atan2(aimBody.y, aimBody.x) - mount.elevationDeg * Math.PI / 180
  const yawError = Math.atan2(aimBody.z, aimBody.x)
  const error = Math.hypot(pitchError, yawError) * 180 / Math.PI
  if (error >= profile.cone) return none
  const reach = error <= profile.full ? 1 : 1 - (error - profile.full) / (profile.cone - profile.full)
  // Small corrections from the pilot keep the full assist; it gives way as the stick goes past a third.
  const giveWay = (own: number) => 1 - Math.min(1, Math.max(0, Math.abs(own) - 0.35) / 0.65)
  const share = (gain: number, err: number, own: number) => Math.max(-1, Math.min(1, gain * err)) * reach * giveWay(own)
  return { pitch: share(profile.pitchGain, pitchError, pilot.pitch), yaw: share(profile.yawGain, yawError, pilot.yaw), active: true }
}

/** The pilot's command with the assist added, each axis kept to ±1. */
export function withAimAssist<T extends { pitch: number; yaw: number }>(command: T, assist: AimAssist): T {
  if (!assist.active) return command
  const clamp = (value: number) => Math.max(-1, Math.min(1, value))
  return { ...command, pitch: clamp(command.pitch + assist.pitch), yaw: clamp(command.yaw + assist.yaw) }
}
