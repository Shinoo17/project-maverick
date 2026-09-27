/*
The chase camera choices a pilot can make, as plain data.

No three.js here on purpose: the save file, the pause menu, the future Settings page and the
flight camera all read these, and only the camera needs vectors.

Two choices, the second one depending on the first:
1. `roll` — what the camera's roll follows.
   - `horizon` (Horizon locked): the horizon stays level; the jet rolls on screen.
   - `aircraft` (Aircraft locked): the camera rolls fully with the jet; the world turns.
2. `horizonStyle` — only used with Horizon locked. With Aircraft locked a Settings page shows
   it as "Default" and disabled; the saved value is kept for when the pilot switches back.
   - `balanced`: the camera stays above and tilts a little in a roll; you see the belly.
   - `dynamic`: Battlefield-style. The camera swings round the jet so you always see its
     top, and the jet rolls around the centre of the screen.

The post-stall (PSM) shot is the same for every choice, with one exception the owner asked for:
with Aircraft locked, a jet drift (the nose leading the flight path sideways, near level) keeps
following the nose with a little extra lag. See `driftShareOf` in `cameraRoll.ts`.

Ids are stable save-file values. Labels come from the locale files through the keys below,
so a label can be renamed without breaking anyone's saved settings.
*/

export type CameraRollMode = 'horizon' | 'aircraft'
export type HorizonStyle = 'balanced' | 'dynamic'

export interface CameraSettings {
  roll: CameraRollMode
  horizonStyle: HorizonStyle
}

export const cameraRollModes: readonly CameraRollMode[] = ['horizon', 'aircraft']
export const horizonStyles: readonly HorizonStyle[] = ['balanced', 'dynamic']

export const defaultCameraSettings: Readonly<CameraSettings> = { roll: 'horizon', horizonStyle: 'balanced' }

export function isCameraRollMode(value: unknown): value is CameraRollMode {
  return typeof value === 'string' && (cameraRollModes as readonly string[]).includes(value)
}
export function isHorizonStyle(value: unknown): value is HorizonStyle {
  return typeof value === 'string' && (horizonStyles as readonly string[]).includes(value)
}

/** Anything unreadable falls back to the default, field by field. */
export function parseCameraSettings(value: unknown): CameraSettings {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  // A save from the short-lived three-style version (roll: 'balanced' | 'roll' | 'dynamic').
  if (isHorizonStyle(data.roll)) return { roll: 'horizon', horizonStyle: data.roll }
  if (data.roll === 'roll') return { roll: 'aircraft', horizonStyle: defaultCameraSettings.horizonStyle }
  return {
    roll: isCameraRollMode(data.roll) ? data.roll : defaultCameraSettings.roll,
    horizonStyle: isHorizonStyle(data.horizonStyle) ? data.horizonStyle : defaultCameraSettings.horizonStyle,
  }
}

/** The next camera in the order Balanced → Dynamic → Aircraft locked, for a key that cycles them. */
export function nextCameraSettings(current: CameraSettings): CameraSettings {
  if (current.roll === 'aircraft') return { roll: 'horizon', horizonStyle: 'balanced' }
  if (current.horizonStyle === 'balanced') return { roll: 'horizon', horizonStyle: 'dynamic' }
  return { roll: 'aircraft', horizonStyle: current.horizonStyle }
}

/** Label and one-line description keys (locale files), in display order, for a Settings page. */
export const cameraRollOptions = [
  { id: 'horizon', labelKey: 'cameraRollHorizon', detailKey: 'cameraRollHorizonDetail' },
  { id: 'aircraft', labelKey: 'cameraRollAircraft', detailKey: 'cameraRollAircraftDetail' },
] as const satisfies readonly { id: CameraRollMode; labelKey: string; detailKey: string }[]

export const horizonStyleOptions = [
  { id: 'balanced', labelKey: 'cameraStyleBalanced', detailKey: 'cameraStyleBalancedDetail' },
  { id: 'dynamic', labelKey: 'cameraStyleDynamic', detailKey: 'cameraStyleDynamicDetail' },
] as const satisfies readonly { id: HorizonStyle; labelKey: string; detailKey: string }[]

/** Shown in place of the style choice while Aircraft locked is selected. */
export const horizonStyleDisabled = { labelKey: 'cameraStyleDefault', detailKey: 'cameraStyleDefaultDetail' } as const

export function cameraRollOption(mode: CameraRollMode) {
  return cameraRollOptions.find(option => option.id === mode) ?? cameraRollOptions[0]
}
export function horizonStyleOption(style: HorizonStyle) {
  return horizonStyleOptions.find(option => option.id === style) ?? horizonStyleOptions[0]
}
