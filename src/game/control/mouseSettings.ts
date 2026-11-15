import { aimAssistLevels, type AimAssistLevel } from '../combat/aimAssist'
import { MOUSE } from './config'

/*
The mouse choices a pilot can save. Input only: the command contract and physics are unchanged,
and a replay records the commands these produce.

Since the example/flight-control port there is one mouse scheme, the example's mouse aim (the
mouse turns a world aim direction, the aim controller flies the nose to it, Space turns the
mouse into a virtual stick). The older modes (cursor, relative and positional stick, the body or
horizon frame, the X axis choice) are gone; a save that still has them reads as the defaults.
*/
export type AimLimit = 'limited' | 'free'
export const aimLimits: readonly AimLimit[] = ['limited', 'free']

export interface MouseSettings {
  /** Multiplies pointer motion, 0.5..2. */
  sensitivity: number
  invertPitch: boolean
  /** 'limited' keeps the aim within MOUSE.coneDeg of the nose; 'free' lets it go anywhere (G). */
  aimLimit: AimLimit
  /** Gun aim assist (src/game/combat/aimAssist.ts). Saved with the controls; applies to both presets. */
  aimAssist: AimAssistLevel
}

export const defaultMouseSettings: Readonly<MouseSettings> = { sensitivity: 1, invertPitch: MOUSE.invertY, aimLimit: MOUSE.aimLimit, aimAssist: 'standard' }

/** Anything unreadable falls back to the default, field by field. */
export function parseMouseSettings(value: unknown): MouseSettings {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const sensitivity = typeof data.sensitivity === 'number' && Number.isFinite(data.sensitivity) ? Math.min(2, Math.max(0.5, data.sensitivity)) : defaultMouseSettings.sensitivity
  return {
    sensitivity,
    invertPitch: data.invertPitch === true,
    aimLimit: aimLimits.includes(data.aimLimit as AimLimit) ? data.aimLimit as AimLimit : defaultMouseSettings.aimLimit,
    aimAssist: aimAssistLevels.includes(data.aimAssist as AimAssistLevel) ? data.aimAssist as AimAssistLevel : defaultMouseSettings.aimAssist,
  }
}
