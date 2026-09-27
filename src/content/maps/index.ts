import type { LocalizedText } from '../schemas'
import type { PveModeId } from '../pve/modes'

/** World values of the one playable map, read by the flight session. */
export const trainingMap = { id: 'flat-range', radius: 8000, spawnAltitude: 400, spawnSpeed: 130 } as const

/*
Map catalog for the menus. Only the Flat Training Range exists in the game;
every other map is a placeholder ('planned') so the menus can show it with a
reason. A map is listed on PVE Setup when `pveModes` is not empty.
*/
export type MapStatus = 'ready' | 'planned'

export interface MapDefinition {
  id: string
  name: LocalizedText
  info: LocalizedText
  status: MapStatus
  /** PVE modes whose objectives this map declares. Empty = Campaign only. */
  pveModes: PveModeId[]
}

const allPveModes: PveModeId[] = ['tdm', 'control-point', 'ctf', 'priority-target', 'flyover']

export const maps: readonly MapDefinition[] = [
  // PVE maps (docs/game-design/20-game-shell.md, mockup 3b).
  {
    id: 'flat-range', status: 'ready', pveModes: ['tdm'],
    name: { en: 'Flat Training Range', th: 'สนามฝึกพื้นราบ' },
    info: { en: 'Radius 8 km · spawn 400 m · flat grid', th: 'รัศมี 8 กม. · เกิดที่ 400 ม. · พื้นตาราง' },
  },
  {
    id: 'mountains', status: 'planned', pveModes: allPveModes,
    name: { en: 'Mountains', th: 'เทือกเขา' },
    info: { en: 'About 10 × 10 km · terrain cover · 200–2,500 m', th: 'ราว 10 × 10 กม. · ภูเขาบังแนวยิง · 200–2,500 ม.' },
  },
  {
    id: 'coastal', status: 'planned', pveModes: allPveModes,
    name: { en: 'Coastal', th: 'ชายฝั่ง' },
    info: { en: 'About 10 × 10 km · sea and cliffs', th: 'ราว 10 × 10 กม. · ทะเลและหน้าผา' },
  },
  // Campaign theatre maps (docs/game-design/21-campaign.md). Names are placeholders.
  { id: 'coastal-ridge', status: 'planned', pveModes: [], name: { en: 'Coastal Ridge', th: 'สันเขาริมฝั่ง' }, info: { en: 'Campaign map', th: 'แผนที่ Campaign' } },
  { id: 'frontier-valley', status: 'planned', pveModes: [], name: { en: 'Frontier Valley', th: 'หุบเขาชายแดน' }, info: { en: 'Campaign map', th: 'แผนที่ Campaign' } },
  { id: 'open-sea', status: 'planned', pveModes: [], name: { en: 'Open Sea', th: 'ทะเลเปิด' }, info: { en: 'Campaign map', th: 'แผนที่ Campaign' } },
  { id: 'main-base-plateau', status: 'planned', pveModes: [], name: { en: 'Main Base Plateau', th: 'ที่ราบสูงฐานหลัก' }, info: { en: 'Campaign map', th: 'แผนที่ Campaign' } },
  { id: 'capital-airspace', status: 'planned', pveModes: [], name: { en: 'Capital Airspace', th: 'น่านฟ้าเมืองหลวง' }, info: { en: 'Campaign map', th: 'แผนที่ Campaign' } },
]

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
