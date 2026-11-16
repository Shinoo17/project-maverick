import type { PveModeId } from '../pve/modes'
import { flatRange } from './flatRange'
import { islands } from './islands'
import { mountains } from './mountains'
import type { MapDefinition } from './types'

/** World values every flyable map shares for now (radius, spawn), read by the flight session. */
export const trainingMap = { id: 'flat-range', radius: 8000, spawnAltitude: 400, spawnSpeed: 130 } as const

/*
Map catalog. Each flyable or PVE map has its own file in this folder (types.ts says how
to add one); every map that is not built yet is a placeholder ('planned') so the menus
can show it with a reason. A map is listed on PVE Setup when `pveModes` is not empty, and
in the flight page's map picker when it declares `flight`.
*/
export type { DevGridPalette, FlightSceneSpec, MapDefinition, MapStatus } from './types'

export const maps: readonly MapDefinition[] = [
  // PVE maps (docs/game-design/20-game-shell.md, mockup 3b).
  flatRange, mountains, islands,
  // Campaign theatre maps (docs/game-design/21-campaign.md). Names are placeholders.
  { id: 'coastal-ridge', status: 'planned', pveModes: [], name: { en: 'Coastal Ridge', th: 'สันเขาริมฝั่ง' }, info: { en: 'Campaign map', th: 'แผนที่ Campaign' } },
  { id: 'frontier-valley', status: 'planned', pveModes: [], name: { en: 'Frontier Valley', th: 'หุบเขาชายแดน' }, info: { en: 'Campaign map', th: 'แผนที่ Campaign' } },
  { id: 'open-sea', status: 'planned', pveModes: [], name: { en: 'Open Sea', th: 'ทะเลเปิด' }, info: { en: 'Campaign map', th: 'แผนที่ Campaign' } },
  { id: 'main-base-plateau', status: 'planned', pveModes: [], name: { en: 'Main Base Plateau', th: 'ที่ราบสูงฐานหลัก' }, info: { en: 'Campaign map', th: 'แผนที่ Campaign' } },
  { id: 'capital-airspace', status: 'planned', pveModes: [], name: { en: 'Capital Airspace', th: 'น่านฟ้าเมืองหลวง' }, info: { en: 'Campaign map', th: 'แผนที่ Campaign' } },
]

/** Maps the flight page can fly, in picker order. Every one shares `trainingMap`'s world values for now. */
export const flightMaps = maps.filter(map => map.flight !== undefined)
export const flightMapIds = flightMaps.map(map => map.id)
export const defaultFlightMapId = flatRange.id

export const pveMaps = maps.filter(map => map.pveModes.length > 0)

export function findMap(id: string): MapDefinition | undefined {
  return maps.find(map => map.id === id)
}

export function getMap(id: string): MapDefinition {
  const map = findMap(id)
  if (!map) throw new Error(`mapId: unknown id "${id}"`)
  return map
}

/** A PVE match can start only on a ready map that declares the chosen mode. */
export function canPlayPve(map: MapDefinition, modeId: PveModeId): boolean {
  return map.status === 'ready' && map.pveModes.includes(modeId)
}
