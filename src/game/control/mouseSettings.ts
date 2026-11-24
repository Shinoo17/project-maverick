import { aimAssistLevels, type AimAssistLevel } from '../combat/aimAssist'
import { MOUSE } from './config'

/*
The mouse choices a pilot can save. Input only: the command contract and physics are unchanged,
and a replay records the commands these produce.

Since the example/flight-control port the mouse flies the example's mouse aim (the aim
controller flies the nose to an aim direction, Space turns the mouse into a virtual stick).
`aimMode` chooses what the mouse moves: 'world', the example's, turns an aim direction fixed in
the world, so the jet flies to that point and stops turning; 'screen' moves a × that
stays where it is left on the window, and the gun reticle is flown under it, so the jet keeps
turning toward a × held off the reticle (FlightInput; the feat/p4-gun-duel branch's 'cursor' mode). The older modes (cursor, relative and positional stick, the body or
horizon frame, the X axis choice) are gone; a save that still has them reads as the defaults.
*/
export type AimLimit = 'limited' | 'free'
export const aimLimits: readonly AimLimit[] = ['limited', 'free']
export type AimMode = 'world' | 'screen'
export const aimModes: readonly AimMode[] = ['world', 'screen']

export interface MouseSettings {
  /** Multiplies pointer motion, 0.5..2. */
  sensitivity: number
  invertPitch: boolean
  /** What the mouse moves: an aim direction in the world, or a × held on the screen. */
  aimMode: AimMode
  /** 'limited' keeps the aim within MOUSE.coneDeg of the nose; 'free' lets it go anywhere (G). */
  aimLimit: AimLimit
  /** Gun aim assist (src/game/combat/aimAssist.ts). Saved with the controls; applies to both presets. */
  aimAssist: AimAssistLevel
}

export const defaultMouseSettings: Readonly<MouseSettings> = { sensitivity: 1, invertPitch: MOUSE.invertY, aimMode: 'world', aimLimit: MOUSE.aimLimit, aimAssist: 'standard' }

/** Anything unreadable falls back to the default, field by field. */
export function parseMouseSettings(value: unknown): MouseSettings {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const sensitivity = typeof data.sensitivity === 'number' && Number.isFinite(data.sensitivity) ? Math.min(2, Math.max(0.5, data.sensitivity)) : defaultMouseSettings.sensitivity
  return {
    sensitivity,
    invertPitch: data.invertPitch === true,
    aimMode: aimModes.includes(data.aimMode as AimMode) ? data.aimMode as AimMode : defaultMouseSettings.aimMode,
    aimLimit: aimLimits.includes(data.aimLimit as AimLimit) ? data.aimLimit as AimLimit : defaultMouseSettings.aimLimit,
    aimAssist: aimAssistLevels.includes(data.aimAssist as AimAssistLevel) ? data.aimAssist as AimAssistLevel : defaultMouseSettings.aimAssist,
  }
}
