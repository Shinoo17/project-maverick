import { useSyncExternalStore } from 'react'
import { getAircraft } from '../content/aircraft'
import type { AircraftId, Locale } from '../content/schemas'
import { loadSettings, saveSettings, type Settings } from '../platform/storage'

let settings = loadSettings()
const listeners = new Set<() => void>()
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
function update(patch: Partial<Settings>) {
  settings = { ...settings, ...patch }
  saveSettings(settings)
  listeners.forEach((listener) => listener())
}
export function selectAircraft(id: AircraftId) { getAircraft(id); update({ aircraftId: id }) }
export function selectLocale(locale: Locale) { update({ locale }) }
export function useSessionSettings() { return useSyncExternalStore(subscribe, () => settings) }
