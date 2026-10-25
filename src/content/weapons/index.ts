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
  /** Missiles only: how the seeker locks on (src/game/combat/seeker.ts). Gameplay values. */
  seeker?: SeekerProfile
  /** Missiles only: how the missile flies, steers and kills (src/game/combat/missiles.ts). Gameplay values. */
  missile?: MissileProfile
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
  /** Releasing the trigger at or above this heat locks the gun until it cools below `resumeHeat`. */
  lockHeat: number
  /** A gun locked by a release in the warning band fires again once heat falls below this. */
  resumeHeat: number
  /** An overheated gun fires again once heat is down to this; lower than `resumeHeat`, so overheating costs more. */
  overheatResumeHeat: number
}
/** A missile seeker's lock-on. Gameplay values, provisional, waiting on playtest. There is no
 * minimum range (user decision 2026-10-25): the lock holds however close the target comes, and a
 * missile can be fired at it there. */
export interface SeekerProfile {
  /** Half-angle off the nose, in degrees, inside which the seeker can see the radar's target.
   * 'radar' uses the launching aircraft's own radar cone (AircraftDefinition.radar): a radar-guided
   * missile is locked through the aircraft's radar. */
  coneDeg: number | 'radar'
  /** Metres: the seeker locks only out to this range. */
  rangeM: number
  /** Seconds from no lock to locked, with the target held inside the cone the whole time. */
  lockSeconds: number
  /** Seconds a full lock takes to bleed away once the target is outside the cone or range. */
  releaseSeconds: number
}
/** A missile in flight. Gameplay values, provisional, waiting on playtest. */
export interface MissileProfile {
  /** Seconds the motor burns, and its push along the missile's path while it does, in m/s². */
  burnSeconds: number
  thrust: number
  /** Air drag: m/s² lost per (m/s)² of speed. Sets the top speed (√(thrust / drag)) and how fast
   * the missile bleeds speed once the motor is out. */
  drag: number
  /** Most sideways pull the fins give, in g. Turn radius is v² / (maxG · 9.81): the faster the
   * missile, the wider it turns. */
  maxG: number
  /** Proportional navigation constant: how hard it turns into the target's sightline drift. */
  navigation: number
  /** Seconds after launch before it steers, while it clears the aircraft. */
  guideDelay: number
  /** Half-angle off the missile's own nose, in degrees, its seeker can look in flight. A target
   * outside it is lost. */
  gimbalDeg: number
  /** Metres: the missile's own seeker sees its target from here in. An IR missile looks for itself
   * from launch (this is its seeker's reach); a radar missile flies on the launcher's radar
   * (datalink) until then, and goes active (pitbull) inside it. */
  activeRangeM: number
  /** Metres: the launch range. Launched at a target holding its course inside it, the missile
   * arrives with energy to spare; the HUD shows SHOOT there. */
  launchRangeM: number
  /** Proximity fuse: it bursts this many metres from an aircraft's centre. */
  fuseM: number
  /** HP the burst takes from the aircraft that set it off. */
  damage: number
  /** Seconds before it destroys itself; it also does once it is slower than `minSpeed` after burnout. */
  lifetime: number
  minSpeed: number
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
// Two gun families (user decision 2026-10-24), tuned to the same 100 HP/s so neither side wins
// on paper: the choice is feel. Gameplay values, slower than the real guns, and provisional.
// - M61 (F-14, F-15, F-16, F/A-18, F-22): rotary 20 mm, a dense tracer stream, flat and fast.
//   Muzzle speed of the real M61A2 with PGU-28 rounds (about 1,030 m/s).
// - GSh-30-1 family (Su-27/30/35/57, MiG-29): single-barrel 30 mm, a slow heavy beat that needs
//   more lead (about 870 m/s) and a wider cone.
// Reach (user decision 2026-10-24, up from 1,000 m): 1,500 m of round travel or 1.8 s, whichever
// comes first. 1.8 s lets even the GSh at 870 m/s reach the cap from a standstill. The cap counts the
// shooter's own speed, so against a target flying as fast the reach is about 1,070–1,310 m.
const gunHeat = { coolRate: 0.5, lockHeat: 0.8, resumeHeat: 0.35, overheatResumeHeat: 0 } as const
const m61Gun: GunProfile = {
  rate: 50, muzzleSpeed: 1030, damage: 2, spreadDeg: 0.3, hotSpread: 0.5,
  lifetime: 1.8, maxDistance: 1500, heatSeconds: 3, ...gunHeat,
}
const gsh30Gun: GunProfile = {
  rate: 25, muzzleSpeed: 870, damage: 4, spreadDeg: 0.45, hotSpread: 0.5,
  lifetime: 1.8, maxDistance: 1500, heatSeconds: 3.5, ...gunHeat,
}
// Each missile has its own seeker. An IR seeker looks through its own narrow cone at short range and
// locks fast; its lock range is also how far it sees in flight (MissileProfile.activeRangeM is the
// same number, validated). A radar missile locks through the aircraft's radar, so it sees as wide as
// the radar (F-22 60°, Su-57 70°) and further, but takes longer to settle; its own radar only takes
// over in flight at activeRangeM (pitbull).
const aim9Seeker: SeekerProfile = { coneDeg: 20, rangeM: 3500, lockSeconds: 1.6, releaseSeconds: 0.8 }
const aim120Seeker: SeekerProfile = { coneDeg: 'radar', rangeM: 8000, lockSeconds: 2.4, releaseSeconds: 1.2 }
const trainingIrSeeker: SeekerProfile = { ...aim9Seeker, coneDeg: 18, rangeM: 3200, lockSeconds: 1.4 }
const trainingRadarSeeker: SeekerProfile = { ...aim120Seeker, rangeM: 7500, lockSeconds: 2.6 }
// Each missile has its own flight profile. Gameplay values scaled to the range (radar 9–10 km),
// not the real missiles' (classified; public figures put an AIM-9 at tens of km and an AIM-120
// past 50 km). Turn radius at 700 m/s: AIM-9 ~1.25 km at 40 g, AIM-120 ~1.65 km at 30 g.
// - AIM-9: a short hard burn, tight turns, short reach, its own IR seeker from launch.
// - AIM-120: a longer burn and less drag, so it reaches further, but turns wider; flies on the
//   launcher's radar until 3 km from the target, then on its own radar.
// - Training rounds (Su-57) differ a little from each, so the two aircraft do not fly the same missile.
const aim9Missile: MissileProfile = {
  burnSeconds: 2.2, thrust: 300, drag: 1.6e-4, maxG: 40, navigation: 4, guideDelay: 0.15,
  gimbalDeg: 50, activeRangeM: 3500, launchRangeM: 3000, fuseM: 9, damage: 100, lifetime: 10, minSpeed: 160,
}
const aim120Missile: MissileProfile = {
  burnSeconds: 4, thrust: 240, drag: 0.9e-4, maxG: 30, navigation: 4, guideDelay: 0.3,
  gimbalDeg: 40, activeRangeM: 3000, launchRangeM: 7000, fuseM: 12, damage: 100, lifetime: 20, minSpeed: 160,
}
const trainingIrMissile: MissileProfile = { ...aim9Missile, burnSeconds: 2, thrust: 310, maxG: 36, gimbalDeg: 45, activeRangeM: 3200, launchRangeM: 2800 }
const trainingRadarMissile: MissileProfile = { ...aim120Missile, burnSeconds: 3.6, maxG: 28, activeRangeM: 3500, launchRangeM: 6500 }
export const weapons: readonly WeaponDefinition[] = [
  { id: 'm61a2', name: label('M61A2 · 20 mm', 'M61A2 · 20 มม.'), kind: 'gun', calibreMm: 20, gun: m61Gun, source: usaf },
  { id: 'aim9', name: label('AIM-9 Sidewinder', 'AIM-9 Sidewinder'), kind: 'ir', model: { file: 'AIM9_compact.glb', rotation: [0, Math.PI / 2, 0], length: 3.02 }, seeker: aim9Seeker, missile: aim9Missile, source: usaf },
  { id: 'aim120', name: label('AIM-120 AMRAAM', 'AIM-120 AMRAAM'), kind: 'radar', model: { file: 'AIM120_compact.glb', rotation: [0, Math.PI / 2, 0], length: 3.66 }, seeker: aim120Seeker, missile: aim120Missile, source: usaf },
  { id: 'su57-cannon', name: label('30 mm aircraft cannon', 'ปืนใหญ่อากาศ 30 มม.'), kind: 'gun', calibreMm: 30, gun: gsh30Gun, source: 'https://www.rostec.ru/media/news/istrebitel-su-57-pyatoe-pokolenie-na-vzlet/' },
  // Placeholder identities deliberately avoid claiming a confirmed domestic missile variant.
  { id: 'training-ir', name: label('IR training missile', 'มิสไซล์ IR สำหรับฝึก'), kind: 'ir', seeker: trainingIrSeeker, missile: trainingIrMissile, provisional: true },
  { id: 'training-radar', name: label('Radar training missile', 'มิสไซล์เรดาร์สำหรับฝึก'), kind: 'radar', seeker: trainingRadarSeeker, missile: trainingRadarMissile, provisional: true },
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
/** The aircraft's missile stations in selection order: short range (IR) first, so slot 0 is always
 * the IR missile and slot 1 the radar one. The weapon panel and the seeker both read this. */
export function missileStations(definition: AircraftDefinition) {
  return weaponStations[definition.weaponStationProfileId]
    .map(station => ({ station, weapon: getWeapon(station.weaponId) }))
    .filter(row => row.weapon.kind !== 'gun')
    .sort((a, b) => (a.weapon.kind === 'ir' ? 0 : 1) - (b.weapon.kind === 'ir' ? 0 : 1))
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
