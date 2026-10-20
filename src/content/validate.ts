import { flightProfiles } from './flight-profiles'
import { validateFlightProfile } from '../game/flight/validateProfile'
import { resolveSpeedLimits } from '../game/flight/speedLimits'
import { getWeapon, weaponStations, type GunProfile } from './weapons'
import { hitboxes, validateHitboxes } from './hitboxes'
import { getAircraft } from './aircraft'
import { presentationIds, type AircraftDefinition, type SessionConfig } from './schemas'

export function validateAircraft(entries: readonly AircraftDefinition[]) {
  const ids = new Set<string>()
  entries.forEach((entry, index) => {
    const path = `aircraft[${index}]`
    if (!entry.id || ids.has(entry.id)) throw new Error(`${path}.id: missing or duplicate`)
    ids.add(entry.id)
    if (!Object.hasOwn(flightProfiles, entry.flightProfileId)) throw new Error(`${path}.flightProfileId: unknown profile`)
    validateFlightProfile(flightProfiles[entry.flightProfileId], `${path}.flightProfile(${entry.flightProfileId})`)
    if (!presentationIds.includes(entry.presentationId)) throw new Error(`${path}.presentationId: unknown profile`)
    if (!Object.hasOwn(weaponStations, entry.weaponStationProfileId)) throw new Error(`${path}.weaponStationProfileId: unknown profile`)
    if (!Object.hasOwn(hitboxes, entry.hitboxProfileId)) throw new Error(`${path}.hitboxProfileId: unknown profile`)
    validateHitboxes(hitboxes[entry.hitboxProfileId], `${path}.hitboxes`)
    const stations = weaponStations[entry.weaponStationProfileId]
    const stationIds = new Set<string>()
    for (const station of stations) {
      if (!station.id || stationIds.has(station.id)) throw new Error(`${path}.stations.id: missing or duplicate`)
      stationIds.add(station.id)
      if (!Number.isInteger(station.capacity) || station.capacity < 1) throw new Error(`${path}.stations.capacity: expected positive integer`)
      const weapon = getWeapon(station.weaponId)
      if (weapon.kind === 'gun') {
        const muzzle = station.muzzle
        if (!muzzle || muzzle.length !== 3 || !muzzle.every(Number.isFinite)) throw new Error(`${path}.stations.muzzle: gun station needs three finite numbers`)
        const elevation = station.elevationDeg ?? 0
        if (!(Number.isFinite(elevation) && Math.abs(elevation) <= 5)) throw new Error(`${path}.stations.elevationDeg: expected -5 to 5 degrees`)
        validateGunProfile(weapon.gun, `${path}.stations.weapon(${weapon.id}).gun`)
      }
      for (const locale of ['th', 'en'] as const) if (!station.name[locale]?.trim()) throw new Error(`${path}.stations.name.${locale}: required`)
    }
    if (stations.filter(station => getWeapon(station.weaponId).kind === 'gun').length !== 1) throw new Error(`${path}.stations: expected exactly one gun station`)
    if (!/^[\w-]+\.glb$/.test(entry.modelFile)) throw new Error(`${path}.modelFile: expected local GLB filename`)
    if (entry.rotation.length !== 3 || entry.rotation.some((value) => !Number.isFinite(value))) {
      throw new Error(`${path}.rotation: expected three finite numbers`)
    }
    for (const locale of ['th', 'en'] as const) {
      if (!entry.description[locale]?.trim()) throw new Error(`${path}.description.${locale}: required`)
      if (!entry.role[locale]?.trim()) throw new Error(`${path}.role.${locale}: required`)
      for (const field of ['gameRole', 'playStyle', 'tip', 'history'] as const) {
        if (!entry.hangar[field][locale]?.trim()) throw new Error(`${path}.hangar.${field}.${locale}: required`)
      }
    }
  })
}

function validateGunProfile(gun: GunProfile | undefined, path: string) {
  if (!gun) throw new Error(`${path}: required for a gun`)
  for (const key of ['rate', 'muzzleSpeed', 'damage', 'lifetime', 'maxDistance', 'heatSeconds', 'coolRate'] as const) {
    if (!(Number.isFinite(gun[key]) && gun[key] > 0)) throw new Error(`${path}.${key}: expected a positive number`)
  }
  for (const key of ['spreadDeg', 'hotSpread'] as const) if (!(Number.isFinite(gun[key]) && gun[key] >= 0)) throw new Error(`${path}.${key}: expected zero or more`)
  if (!(gun.resumeHeat > 0 && gun.resumeHeat < 1)) throw new Error(`${path}.resumeHeat: expected between 0 and 1`)
}

export function validateSession(config: SessionConfig) {
  if (!['playground', 'offline'].includes(config.mode)) throw new Error('session.mode: unsupported mode')
  if (config.mapId !== undefined && config.mapId !== 'flat-range') throw new Error('session.mapId: unsupported map')
  if (!config.aircraftIds.length) throw new Error('session.aircraftIds: expected at least one aircraft')
  if (config.targetDrone !== undefined && typeof config.targetDrone !== 'boolean' && !['still', 'racetrack', 'circle'].includes(config.targetDrone)) throw new Error('session.targetDrone: expected true, false, still, racetrack or circle')
  if (config.targetDrone && config.mode !== 'playground') throw new Error('session.targetDrone: Playground only')
  config.aircraftIds.forEach((id, index) => {
    try { getAircraft(id) } catch { throw new Error(`session.aircraftIds[${index}]: unknown id "${id}"`) }
    if (getAircraft(id).playgroundOnly && config.mode !== 'playground') throw new Error(`session.aircraftIds: ${id} is a Playground validation variant`)
    validateAircraft([getAircraft(id)])
  })
  if (config.flightOverrides !== undefined) {
    if (!config.flightOverrides || typeof config.flightOverrides !== 'object' || Array.isArray(config.flightOverrides)) {
      throw new Error('session.flightOverrides: expected aircraft overrides')
    }
    for (const [id, override] of Object.entries(config.flightOverrides)) {
      const path = `session.flightOverrides.${id}`
      if (!config.aircraftIds.includes(id)) throw new Error(`${path}: aircraft is not in this session`)
      if (!override || typeof override !== 'object' || Array.isArray(override)) throw new Error(`${path}: expected speed overrides`)
      for (const key of Object.keys(override)) {
        if (key !== 'topSpeedKph' && key !== 'afterburnerTopSpeedKph') throw new Error(`${path}.${key}: unsupported override`)
      }
      const profile = flightProfiles[getAircraft(id).flightProfileId]
      resolveSpeedLimits(profile.flight, override, path)
      if ((override.topSpeedKph ?? profile.flight.topSpeedKph) < profile.stall.separationAttachedSpeedKph) {
        throw new Error(`${path}.topSpeedKph: must be at least stall.separationAttachedSpeedKph`)
      }
    }
  }
}
