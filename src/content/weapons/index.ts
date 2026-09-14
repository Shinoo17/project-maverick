import type { AircraftDefinition, LocalizedText } from '../schemas'

export type WeaponKind = 'gun' | 'ir' | 'radar'
export interface WeaponDefinition {
  id: string
  name: LocalizedText
  kind: WeaponKind
  model?: { file: string; rotation: [number, number, number]; length: number }
  /** Curated provenance only; no remote fetch during play. */
  source?: string
  provisional?: boolean
}
export interface WeaponStation {
  id: string
  name: LocalizedText
  weaponId: string
  capacity: number
}
export interface WeaponStore { stationId: string; weaponId: string; count: number }
const label = (en: string, th: string): LocalizedText => ({ en, th })
const usaf = 'https://www.af.mil/About-Us/Fact-Sheets/Display/Article/104506/f22/f-22-raptor/'
export const weapons: readonly WeaponDefinition[] = [
  { id: 'm61a2', name: label('M61A2 · 20 mm', 'M61A2 · 20 มม.'), kind: 'gun', source: usaf },
  { id: 'aim9', name: label('AIM-9 Sidewinder', 'AIM-9 Sidewinder'), kind: 'ir', model: { file: 'AIM9_compact.glb', rotation: [0, Math.PI / 2, 0], length: 3.02 }, source: usaf },
  { id: 'aim120', name: label('AIM-120 AMRAAM', 'AIM-120 AMRAAM'), kind: 'radar', model: { file: 'AIM120_compact.glb', rotation: [0, Math.PI / 2, 0], length: 3.66 }, source: usaf },
  { id: 'su57-cannon', name: label('30 mm aircraft cannon', 'ปืนใหญ่อากาศ 30 มม.'), kind: 'gun', source: 'https://www.rostec.ru/media/news/istrebitel-su-57-pyatoe-pokolenie-na-vzlet/' },
  // Placeholder identities deliberately avoid claiming a confirmed domestic missile variant.
  { id: 'training-ir', name: label('IR training missile', 'มิสไซล์ IR สำหรับฝึก'), kind: 'ir', provisional: true },
  { id: 'training-radar', name: label('Radar training missile', 'มิสไซล์เรดาร์สำหรับฝึก'), kind: 'radar', provisional: true },
]
export function getWeapon(id: string): WeaponDefinition {
  const entry = weapons.find(item => item.id === id)
  if (!entry) throw new Error(`weaponId: unknown id "${id}"`)
  return entry
}
// Stations and quantities are game capacities, not certified real-world carriage limits.
export const weaponStations: Record<string, WeaponStation[]> = {
  f22: [
    { id: 'gun', name: label('Internal gun', 'ปืนประจำเครื่อง'), weaponId: 'm61a2', capacity: 1 },
    { id: 'side-bays', name: label('Side bays', 'ช่องอาวุธด้านข้าง'), weaponId: 'aim9', capacity: 2 },
    { id: 'main-bays', name: label('Main bays', 'ช่องอาวุธหลัก'), weaponId: 'aim120', capacity: 6 },
  ],
  su57: [
    { id: 'gun', name: label('Internal gun', 'ปืนประจำเครื่อง'), weaponId: 'su57-cannon', capacity: 1 },
    { id: 'short-range', name: label('Short-range stations', 'จุดติดตั้งอาวุธระยะใกล้'), weaponId: 'training-ir', capacity: 2 },
    { id: 'medium-range', name: label('Medium-range stations', 'จุดติดตั้งอาวุธระยะกลาง'), weaponId: 'training-radar', capacity: 4 },
  ],
}
/** Every aircraft starts with every station filled; no selectable presets. */
export function fullArmament(definition: AircraftDefinition): WeaponStore[] {
  return weaponStations[definition.weaponStationProfileId].map(station => ({
    stationId: station.id, weaponId: station.weaponId, count: station.capacity,
  }))
}
export function availableWeapons(definition: AircraftDefinition) {
  return [...new Set(weaponStations[definition.weaponStationProfileId].map(station => station.weaponId))].map(getWeapon)
}

export type WeaponModelStatus = 'loading' | 'ready' | 'missing'
export function weaponModelUrl(weapon: WeaponDefinition) {
  return weapon.model ? `${import.meta.env.BASE_URL}assets/missile/${weapon.model.file}` : undefined
}
export function inspectedWeapons(definition: AircraftDefinition, selection: string) {
  const catalog = availableWeapons(definition)
  return selection === 'all' ? catalog : catalog.filter(weapon => weapon.id === selection)
}
