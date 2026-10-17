import type { AircraftDefinition, LocalizedText } from '../schemas'
import type { Tuple3 } from '../hitboxes'

export type WeaponKind = 'gun' | 'ir' | 'radar'
export interface WeaponDefinition {
  id: string
  name: LocalizedText
  kind: WeaponKind
  model?: { file: string; rotation: [number, number, number]; length: number }
  /** Guns only: bore in millimetres. */
  calibreMm?: number
  /** Guns only: simulation profile. Gameplay values (doc 07), not the real gun's figures. */
  gun?: GunProfile
  /** Curated provenance only; no remote fetch during play. */
  source?: string
  provisional?: boolean
}
export interface GunProfile {
  /** Rounds per second while the trigger is held. */
  rate: number
  /** m/s, added to the shooter's velocity along the gun line. */
  muzzleSpeed: number
  /** HP per hit. */
  damage: number
  /** Full apex angle of the cold spread cone, in degrees (half of it either side of the gun line). */
  spreadDeg: number
  /** Extra spread at full heat, as a fraction of `spreadDeg`. */
  hotSpread: number
  /** A round is removed after this many seconds or `maxDistance` metres travelled, whichever comes first. */
  lifetime: number
  maxDistance: number
  /** Seconds of continuous fire from a cold gun to overheat. */
  heatSeconds: number
  /** Heat lost per second while not firing, on a 0–1 scale. Provisional: doc 07 gives no rate. */
  coolRate: number
  /** An overheated gun fires again once heat falls below this. */
  resumeHeat: number
}
export interface WeaponStation {
  id: string
  name: LocalizedText
  weaponId: string
  capacity: number
  /** Gun stations only: the muzzle in the hitbox body frame (src/content/hitboxes.ts), in metres.
   * The gun line is body +X. Refit with the hitboxes when `flightModelLength` changes.
   * Provisional: placed by eye near each real gun port, not fitted to the GLB. */
  muzzle?: Tuple3
  /** Gun stations only: the gun line tilted nose-up from body +X, in degrees. Real fighters
   * harmonise the gun a little above the fuselage line so rounds fired in a turn (positive AoA)
   * and dropping under gravity still pass near where the nose points. This flight model holds AoA
   * to 1–4° in a gun turn, so the tilt is smaller than a real fighter's: at 0.5° rounds pass about
   * 1.3 m above the nose line at 500 m in level flight and about 3 m below it in a full pull. */
  elevationDeg?: number
}
export interface WeaponStore { stationId: string; weaponId: string; count: number }
const label = (en: string, th: string): LocalizedText => ({ en, th })
const usaf = 'https://www.af.mil/About-Us/Fact-Sheets/Display/Article/104506/f22/f-22-raptor/'
// One baseline for both guns until playtests give a reason to split them (doc 07).
const baselineGun: GunProfile = {
  rate: 80, muzzleSpeed: 900, damage: 2, spreadDeg: 0.3, hotSpread: 0.5,
  lifetime: 1.2, maxDistance: 1000, heatSeconds: 2, coolRate: 0.5, resumeHeat: 0.35,
}
// Muzzle speed of the real M61A2 with PGU-28 rounds (about 1,030 m/s); less drop and less lead than the baseline.
const m61Gun: GunProfile = { ...baselineGun, muzzleSpeed: 1030 }
export const weapons: readonly WeaponDefinition[] = [
  { id: 'm61a2', name: label('M61A2 · 20 mm', 'M61A2 · 20 มม.'), kind: 'gun', calibreMm: 20, gun: m61Gun, source: usaf },
  { id: 'aim9', name: label('AIM-9 Sidewinder', 'AIM-9 Sidewinder'), kind: 'ir', model: { file: 'AIM9_compact.glb', rotation: [0, Math.PI / 2, 0], length: 3.02 }, source: usaf },
  { id: 'aim120', name: label('AIM-120 AMRAAM', 'AIM-120 AMRAAM'), kind: 'radar', model: { file: 'AIM120_compact.glb', rotation: [0, Math.PI / 2, 0], length: 3.66 }, source: usaf },
  { id: 'su57-cannon', name: label('30 mm aircraft cannon', 'ปืนใหญ่อากาศ 30 มม.'), kind: 'gun', calibreMm: 30, gun: baselineGun, source: 'https://www.rostec.ru/media/news/istrebitel-su-57-pyatoe-pokolenie-na-vzlet/' },
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
    { id: 'gun', name: label('Internal gun', 'ปืนประจำเครื่อง'), weaponId: 'm61a2', capacity: 1, muzzle: [1, -0.6, 1.3], elevationDeg: 0.5 },
    { id: 'side-bays', name: label('Side bays', 'ช่องอาวุธด้านข้าง'), weaponId: 'aim9', capacity: 2 },
    { id: 'main-bays', name: label('Main bays', 'ช่องอาวุธหลัก'), weaponId: 'aim120', capacity: 6 },
  ],
  su57: [
    { id: 'gun', name: label('Internal gun', 'ปืนประจำเครื่อง'), weaponId: 'su57-cannon', capacity: 1, muzzle: [3.5, -0.4, 1], elevationDeg: 0.5 },
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
/** The aircraft's gun station and its profile. Every aircraft has exactly one (validated). */
export function gunStation(definition: AircraftDefinition) {
  const station = weaponStations[definition.weaponStationProfileId].find(entry => getWeapon(entry.weaponId).kind === 'gun')
  if (!station) throw new Error(`${definition.id}: no gun station`)
  const weapon = getWeapon(station.weaponId)
  return { station, weapon, muzzle: station.muzzle!, elevationDeg: station.elevationDeg ?? 0, profile: weapon.gun! }
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
