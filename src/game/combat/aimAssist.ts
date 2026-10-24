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
- Range: full out to `assistRange[0]` metres (the HUD's IN RNG), fading to nothing at
  `assistRange[1]` (user decision 25 Oct 2026). The rounds fly on to 1,500 m, but out there the
  spread is as wide as the airframe, so the assist would only steer a spray. Fading instead of
  cutting off means a target easing out of range never lets go with a jolt.
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

/** Metres to the target: full assist out to the first, none from the second. Provisional. */
export const assistRange = [800, 1000] as const
/** The assist's share (0..1) at `range` metres from the target. */
export function rangeShare(range: number) {
  return 1 - Math.min(1, Math.max(0, (range - assistRange[0]) / (assistRange[1] - assistRange[0])))
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
  const fade = rangeShare(solution.range)
  if (fade <= 0) return none
  const { x, y, z, w } = shooter.orientation
  aimBody.set(solution.aim.x, solution.aim.y, solution.aim.z).applyQuaternion(turn.set(x, y, z, w).invert())
  if (aimBody.x <= 0) return none
  // Errors from the gun line (body +X tilted up by the elevation): up is +pitch, right (+Z) is +yaw.
  const pitchError = Math.atan2(aimBody.y, aimBody.x) - mount.elevationDeg * Math.PI / 180
  const yawError = Math.atan2(aimBody.z, aimBody.x)
  const error = Math.hypot(pitchError, yawError) * 180 / Math.PI
  if (error >= profile.cone) return none
  const reach = (error <= profile.full ? 1 : 1 - (error - profile.full) / (profile.cone - profile.full)) * fade
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

/*
Mouse aim's assist (src/game/input/mouseAim.ts). There the stick belongs to the instructor,
which would take back any nudge on the next tick, so the assist moves the aim instead: inside
the same cone it draws the aim toward where the nose must point for the gun line to lie on
the solution, and the instructor flies there. Moving the mouse away still wins: the draw is
a rate, and it lets go outside the cone.

Holding the trigger tightens it (user request 23 Oct 2026, "point at the target and fire, and it
pulls onto it"): the draw runs `firingBoost` times faster and stays whole out to the edge of the
cone, so a burst stays on the lead while the target moves. Idle, it only eases the aim in.

- World-locked aim ('aim'): `aimMagnet` turns the aim direction, once per command tick.
- Screen-locked aim ('cursor'): the aim is wherever the × is, read afresh every tick, so the
  assist moves the × itself toward the lead marker on screen (`cursorDraw`, once per rendered
  frame, like a hand). Moving the × rather than the aim behind it means letting go never snaps
  the jet back to where the × was. A hand moving fast gives way, so the × is never glued.
*/
export const aimMagnetRates: Record<Exclude<AimAssistLevel, 'off'>, number> = { standard: 4, strong: 8 }
export const firingBoost = 3
const noseAim = new Vector3(), wingAxis = new Vector3(), drawAxis = new Vector3()
/** Draws `aim` (a world direction, changed in place) toward the solution for one tick of `dt` seconds. True while it acts. */
export function aimMagnet(level: AimAssistLevel, shooter: AircraftState, target: AircraftState | undefined, mount: GunMount, aim: Vector3, dt: number, firing = false) {
  if (level === 'off' || !target?.alive || !shooter.alive) return false
  const profile = aimAssistProfiles[level]
  const solution = solveGun(shooter, mount, target)
  if (!solution?.reachable) return false
  const fade = rangeShare(solution.range)
  if (fade <= 0) return false
  const { x, y, z, w } = shooter.orientation
  turn.set(x, y, z, w)
  // The gun line sits elevationDeg above the nose, so the nose goes that far below the aim.
  wingAxis.set(0, 0, 1).applyQuaternion(turn)
  noseAim.set(solution.aim.x, solution.aim.y, solution.aim.z).normalize().applyAxisAngle(wingAxis, -mount.elevationDeg * Math.PI / 180)
  const error = aim.angleTo(noseAim) * 180 / Math.PI
  if (error >= profile.cone || error < 1e-6) return error < 1e-6
  drawAxis.crossVectors(aim, noseAim)
  if (drawAxis.lengthSq() < 1e-12) return true
  const share = draw(level, error, dt, firing) * fade
  aim.applyAxisAngle(drawAxis.normalize(), aim.angleTo(noseAim) * share).normalize()
  return true
}

/** The share (0..1) of the way to the lead the aim moves in `dt` seconds, `error` degrees off it. */
function draw(level: Exclude<AimAssistLevel, 'off'>, error: number, dt: number, firing: boolean) {
  const profile = aimAssistProfiles[level]
  if (error >= profile.cone) return 0
  const reach = firing || error <= profile.full ? 1 : 1 - (error - profile.full) / (profile.cone - profile.full)
  return (1 - Math.exp(-aimMagnetRates[level] * (firing ? firingBoost : 1) * dt)) * reach
}

/** Hand speed (pixels per second) at which the cursor draw starts to give way, and is gone. */
export const handGiveWay = [150, 700] as const
/** Cursor mode: the share (0..1) of the way from the × to the lead marker the × moves this frame.
 * `leadError` and `targetError` are degrees from the × to the lead marker and to the target
 * through the lens; `handPixels` is how far the hand moved the × this frame; `range` is metres
 * to the target.

 While firing, a × on the target itself captures too: against a crossing target the lead sits
 about (target speed / round speed) off the airframe at any range — 7° at 150 m/s, 12° at 250 —
 so "point at it and fire" would otherwise miss the cone. The draw still goes to the lead. */
export function cursorDraw(level: AimAssistLevel, leadError: number, targetError: number, dt: number, firing: boolean, handPixels: number, range: number) {
  if (level === 'off' || !(dt > 0)) return 0
  const fade = rangeShare(range)
  if (fade <= 0) return 0
  const speed = handPixels / dt
  const giveWay = 1 - Math.min(1, Math.max(0, (speed - handGiveWay[0]) / (handGiveWay[1] - handGiveWay[0])))
  return draw(level, firing ? Math.min(leadError, targetError) : leadError, dt, firing) * giveWay * fade
}
