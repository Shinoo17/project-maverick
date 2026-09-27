/*
Armament numbers for the Hangar, built from the weapon content. Every aircraft
carries every station at full capacity (fullArmament), so these rows are what
the player will have in a match. Nothing here is typed by hand.
*/
import { availableWeapons, fullArmament, weaponStations, type WeaponDefinition, type WeaponStation } from '../../content/weapons'
import type { AircraftDefinition } from '../../content/schemas'

/** What the Armament screen shows: one weapon, or every weapon together. */
export type WeaponSelection = string | 'all'

export interface ArmamentRow {
  weapon: WeaponDefinition
  /** Stations that carry this weapon. */
  stations: WeaponStation[]
  /** Total rounds or missiles carried; a gun counts as 1. */
  count: number
}

export function armamentRows(aircraft: AircraftDefinition): ArmamentRow[] {
  const stores = fullArmament(aircraft)
  const stations = weaponStations[aircraft.weaponStationProfileId]
  return availableWeapons(aircraft).map(weapon => ({
    weapon,
    stations: stations.filter(station => station.weaponId === weapon.id),
    count: stores.filter(store => store.weaponId === weapon.id).reduce((total, store) => total + store.count, 0),
  }))
}

/** Totals for the ARMAMENT heading, e.g. 1 GUN · 8 MSL. */
export function armamentSummary(rows: ArmamentRow[]) {
  const guns = rows.filter(row => row.weapon.kind === 'gun').reduce((total, row) => total + row.count, 0)
  const missiles = rows.filter(row => row.weapon.kind !== 'gun').reduce((total, row) => total + row.count, 0)
  return { guns, missiles }
}

/**
 * Keeps a selection valid for this aircraft. A weapon id from another aircraft
 * (after switching, or a stale value) falls back to the first weapon.
 */
export function validSelection(aircraft: AircraftDefinition, selection: WeaponSelection | null): WeaponSelection {
  const ids = availableWeapons(aircraft).map(weapon => weapon.id)
  return selection === 'all' || (selection && ids.includes(selection)) ? selection : ids[0]
}

/** The next weapon (or ALL) in picker order, for the ← → keys. ALL comes first. */
export function stepSelection(aircraft: AircraftDefinition, selection: WeaponSelection, direction: 1 | -1): WeaponSelection {
  const order = ['all', ...availableWeapons(aircraft).map(weapon => weapon.id)]
  const index = order.indexOf(selection)
  return order[(index + direction + order.length) % order.length]
}
