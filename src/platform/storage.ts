import type { AircraftId, Locale } from '../content/schemas'
import { aircraft, getAircraft } from '../content/aircraft'
import { findMap } from '../content/maps'
import { isDifficulty, isPveModeId, teamSizeRange, type Difficulty, type PveModeId } from '../content/pve/modes'
import { defaultMouseSettings, parseMouseSettings, type MouseSettings } from '../game/input/mouseStick'
import { defaultCameraSettings, parseCameraSettings, type CameraSettings } from '../game/camera/cameraSettings'

export type SelectedMode = 'campaign' | 'pve' | 'training'

/** Last PVE Setup choices. Bot aircraft lists hold one entry per possible slot. */
export interface PveSetup {
  modeId: PveModeId
  mapId: string
  teamSize: number
  difficulty: Difficulty
  allyAircraft: AircraftId[]
  enemyAircraft: AircraftId[]
}

/**
 * Fields added after v1 (`controls` in MR1; `callsign`, `selectedMode` and
 * `pveSetup` in P3b; `camera` with the camera styles) read as their defaults
 * from an older blob, so no bump.
 */
export interface Settings {
  version: 1
  aircraftId: AircraftId
  locale: Locale
  controls: MouseSettings
  camera: CameraSettings
  callsign: string
  selectedMode: SelectedMode
  pveSetup: PveSetup
}

export const defaultPveSetup: PveSetup = {
  modeId: 'tdm', mapId: 'flat-range', teamSize: 1, difficulty: 'normal',
  allyAircraft: ['su57'], enemyAircraft: ['su57', 'f22'],
}
export const defaultSettings: Settings = {
  version: 1, aircraftId: 'f22', locale: 'th', controls: { ...defaultMouseSettings }, camera: { ...defaultCameraSettings },
  callsign: 'VIPER 1-1', selectedMode: 'pve', pveSetup: defaultPveSetup,
}
const STORAGE_KEY = 'maverick.settings'
const maxCallsignLength = 16

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isAircraftId = (value: unknown): value is AircraftId =>
  typeof value === 'string' && aircraft.some(entry => entry.id === value)

/** Keeps each valid slot and replaces bad or missing ones with the default. */
function parseAircraftSlots(value: unknown, fallback: AircraftId[]): AircraftId[] {
  const list = Array.isArray(value) ? value : []
  return fallback.map((defaultId, index) => isAircraftId(list[index]) ? list[index] : defaultId)
}

export function parsePveSetup(value: unknown): PveSetup {
  if (!isRecord(value)) return defaultPveSetup
  const d = defaultPveSetup
  const teamSize = typeof value.teamSize === 'number' && Number.isInteger(value.teamSize)
    && value.teamSize >= teamSizeRange.min && value.teamSize <= teamSizeRange.max ? value.teamSize : d.teamSize
  return {
    modeId: isPveModeId(value.modeId) ? value.modeId : d.modeId,
    // A removed map falls back to the default instead of breaking PLAY.
    mapId: typeof value.mapId === 'string' && findMap(value.mapId)?.pveModes.length ? value.mapId : d.mapId,
    teamSize,
    difficulty: isDifficulty(value.difficulty) ? value.difficulty : d.difficulty,
    allyAircraft: parseAircraftSlots(value.allyAircraft, d.allyAircraft),
    enemyAircraft: parseAircraftSlots(value.enemyAircraft, d.enemyAircraft),
  }
}

export function parseCallsign(value: unknown): string {
  if (typeof value !== 'string') return defaultSettings.callsign
  const trimmed = value.trim().slice(0, maxCallsignLength)
  return trimmed || defaultSettings.callsign
}

export function parseSettings(raw: string | null): Settings {
  try {
    const value: unknown = JSON.parse(raw ?? 'null')
    if (!isRecord(value) || value.version !== 1) return defaultSettings
    const aircraftId = typeof value.aircraftId === 'string' ? getAircraft(value.aircraftId).id : 'f22'
    const selectedMode: SelectedMode = value.selectedMode === 'campaign' || value.selectedMode === 'training' ? value.selectedMode : 'pve'
    return {
      version: 1, aircraftId, locale: value.locale === 'en' ? 'en' : 'th', controls: parseMouseSettings(value.controls), camera: parseCameraSettings(value.camera),
      callsign: parseCallsign(value.callsign), selectedMode, pveSetup: parsePveSetup(value.pveSetup),
    }
  } catch { return defaultSettings }
}

export function loadSettings(): Settings {
  try { return parseSettings(localStorage.getItem(STORAGE_KEY)) } catch { return defaultSettings }
}
export function saveSettings(settings: Settings) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)) } catch { /* Private/storage-restricted browsing still works in memory. */ }
}
