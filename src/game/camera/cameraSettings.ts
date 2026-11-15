/*
The chase camera choices a pilot can make, as plain data.

No three.js here on purpose: the save file, the pause menu, the Settings page and the flight
camera all read these, and only the camera needs vectors.

`mode` is the camera the game flies with (ArcadeCamera, ported from example/flight-control):
Aircraft lock, Horizon lock or Aim lock; V cycles them. `roll` and `horizonStyle` are the older
rigs' choices, kept only so the Flight Lab can still compare against FlightCamera and the FR2
ChaseCamera.

Ids are stable save-file values. Labels come from the locale files through the keys below,
so a label can be renamed without breaking anyone's saved settings.
*/

export type CameraRollMode = 'horizon' | 'aircraft'
export type HorizonStyle = 'balanced' | 'dynamic'
/**
 * The chase camera ported from example/flight-control (src/render/ArcadeCamera.ts), the one the
 * flight scene flies with:
 * - `aircraft` (Aircraft lock): the camera follows the jet's attitude, rolling with it.
 * - `horizon` (Horizon lock): heading and pitch on a level horizon, a little of the bank.
 * - `aim` (Aim lock): like Horizon lock, looking along the mouse aim blended with the flight path.
 */
export type CameraMode = 'aircraft' | 'horizon' | 'aim'

export interface CameraSettings {
  mode: CameraMode
  /** The legacy and FR2 rigs' choices (Flight Lab comparison only). Kept in step with `mode`
   * (Aircraft lock → aircraft, else horizon); horizonStyle keeps its saved value. */
  roll: CameraRollMode
  horizonStyle: HorizonStyle
}

export const cameraModes: readonly CameraMode[] = ['aircraft', 'horizon', 'aim']
export const cameraRollModes: readonly CameraRollMode[] = ['horizon', 'aircraft']
export const horizonStyles: readonly HorizonStyle[] = ['balanced', 'dynamic']

export const defaultCameraSettings: Readonly<CameraSettings> = { mode: 'aim', roll: 'horizon', horizonStyle: 'balanced' }

export function isCameraMode(value: unknown): value is CameraMode {
  return typeof value === 'string' && (cameraModes as readonly string[]).includes(value)
}
export function isCameraRollMode(value: unknown): value is CameraRollMode {
  return typeof value === 'string' && (cameraRollModes as readonly string[]).includes(value)
}
export function isHorizonStyle(value: unknown): value is HorizonStyle {
  return typeof value === 'string' && (horizonStyles as readonly string[]).includes(value)
}

const rollOf = (mode: CameraMode): CameraRollMode => mode === 'aircraft' ? 'aircraft' : 'horizon'

/** Anything unreadable falls back to the default, field by field. A save from before `mode`
 * existed starts on the default mode. */
export function parseCameraSettings(value: unknown): CameraSettings {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const mode = isCameraMode(data.mode) ? data.mode : defaultCameraSettings.mode
  return { mode, roll: rollOf(mode), horizonStyle: isHorizonStyle(data.horizonStyle) ? data.horizonStyle : defaultCameraSettings.horizonStyle }
}

/** The next camera in the order Aircraft lock → Horizon lock → Aim lock (the V key). */
export function nextCameraSettings(current: CameraSettings): CameraSettings {
  const mode = cameraModes[(cameraModes.indexOf(current.mode) + 1) % cameraModes.length]
  return { ...current, mode, roll: rollOf(mode) }
}

/** Label and one-line description keys for each camera mode, in display order. */
export const cameraModeOptions = [
  { id: 'aircraft', labelKey: 'cameraModeAircraft', detailKey: 'cameraModeAircraftDetail' },
  { id: 'horizon', labelKey: 'cameraModeHorizon', detailKey: 'cameraModeHorizonDetail' },
  { id: 'aim', labelKey: 'cameraModeAim', detailKey: 'cameraModeAimDetail' },
] as const satisfies readonly { id: CameraMode; labelKey: string; detailKey: string }[]
export function cameraModeOption(mode: CameraMode) {
  return cameraModeOptions.find(option => option.id === mode) ?? cameraModeOptions[0]
}

/**
 * Base vertical field of view in degrees, saved apart from the roll choices. The chase camera
 * adds its dynamic widening (speed, burner, post-stall) on top of this.
 */
export const cameraFovRange = { min: 50, max: 70, step: 1, default: 56 } as const

export function parseCameraFov(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return cameraFovRange.default
  return Math.min(cameraFovRange.max, Math.max(cameraFovRange.min, Math.round(value)))
}
