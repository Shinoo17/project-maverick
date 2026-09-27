/*
The one store for saved player choices (aircraft, language, controls, menu
selections). Components read it with `useSessionSettings()` and change it only
through the functions below, which validate, save and notify.
*/
import { useSyncExternalStore } from 'react'
import { getAircraft } from '../content/aircraft'
import type { AircraftId, Locale } from '../content/schemas'
import { loadSettings, parsePveSetup, saveSettings, type PveSetup, type SelectedMode, type Settings } from '../platform/storage'
import { parseMouseSettings, type MouseSettings } from '../game/input/mouseStick'

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
export function selectMode(mode: SelectedMode) { update({ selectedMode: mode }) }
export function updatePveSetup(patch: Partial<PveSetup>) { update({ pveSetup: parsePveSetup({ ...settings.pveSetup, ...patch }) }) }
export function useSessionSettings() { return useSyncExternalStore(subscribe, () => settings) }
