/*
The one store for saved player choices (aircraft, language, controls, menu
selections). Components read it with `useSessionSettings()` and change it only
through the functions below, which validate, save and notify.
*/
import { useSyncExternalStore } from 'react'
import { getAircraft } from '../content/aircraft'
import type { AircraftId, Locale } from '../content/schemas'
import { loadSettings, parseCallsign, parseDisplaySettings, parsePveSetup, saveSettings, type DisplaySettings, type PveSetup, type SelectedMode, type Settings } from '../platform/storage'
import { parseMouseSettings, type MouseSettings } from '../game/input/mouseStick'
import { parseCameraFov, parseCameraSettings, type CameraSettings } from '../game/camera/cameraSettings'
import { parseKeyboardSettings, type KeyboardSettings } from '../game/input/keyBindings'
import { parseGraphicsSettings, type GraphicsSettings } from '../render/graphicsSettings'

import i18n from '../locales'

let settings = loadSettings()
const listeners = new Set<() => void>()
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
function update(patch: Partial<Settings>) {
  settings = { ...settings, ...patch }
  saveSettings(settings)
  listeners.forEach((listener) => listener())
}
export function selectAircraft(id: AircraftId) { getAircraft(id); update({ aircraftId: id }) }
export function selectLocale(locale: Locale) { update({ locale }); void i18n.changeLanguage(locale) }
export function selectControls(patch: Partial<MouseSettings>) { update({ controls: parseMouseSettings({ ...settings.controls, ...patch }) }) }
export function selectCamera(patch: Partial<CameraSettings>) { update({ camera: parseCameraSettings({ ...settings.camera, ...patch }) }) }
export function selectCameraFov(fov: number) { update({ cameraFov: parseCameraFov(fov) }) }
export function selectKeyboard(patch: Partial<KeyboardSettings>) { update({ keyboard: parseKeyboardSettings({ ...settings.keyboard, ...patch }) }) }
export function selectGraphics(patch: Partial<GraphicsSettings>) { update({ graphics: parseGraphicsSettings({ ...settings.graphics, ...patch }) }) }
export function selectDisplay(patch: Partial<DisplaySettings>) { update({ display: parseDisplaySettings({ ...settings.display, ...patch }) }) }
export function selectCallsign(callsign: string) { update({ callsign: parseCallsign(callsign) }) }
export function selectMode(mode: SelectedMode) { update({ selectedMode: mode }) }
export function updatePveSetup(patch: Partial<PveSetup>) { update({ pveSetup: parsePveSetup({ ...settings.pveSetup, ...patch }) }) }
export function useSessionSettings() { return useSyncExternalStore(subscribe, () => settings) }
