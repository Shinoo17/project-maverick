import type { AircraftId, Locale } from '../content/schemas'
import { getAircraft } from '../content/aircraft'
import { defaultMouseSettings, parseMouseSettings, type MouseSettings } from '../game/input/mouseStick'

/** `controls` joined in MR1 without a version bump: an older blob reads as the defaults. */
export interface Settings { version: 1; aircraftId: AircraftId; locale: Locale; controls: MouseSettings }
export const defaultSettings: Settings = { version: 1, aircraftId: 'f22', locale: 'th', controls: { ...defaultMouseSettings } }
const STORAGE_KEY = 'maverick.settings'

export function parseSettings(raw: string | null): Settings {
  try {
    const value: unknown = JSON.parse(raw ?? 'null')
    if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1) return defaultSettings
    const data = value as Record<string, unknown>
    const aircraftId = typeof data.aircraftId === 'string' ? getAircraft(data.aircraftId).id : 'f22'
    return { version: 1, aircraftId, locale: data.locale === 'en' ? 'en' : 'th', controls: parseMouseSettings(data.controls) }
  } catch { return defaultSettings }
}

export function loadSettings(): Settings {
  try { return parseSettings(localStorage.getItem(STORAGE_KEY)) } catch { return defaultSettings }
}
export function saveSettings(settings: Settings) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)) } catch { /* Private/storage-restricted browsing still works in memory. */ }
}
