/*
The missile seeker's lock-on (doc 07). The radar picks the target (targeting.ts); the selected
missile's seeker then has to settle on it before a missile can be fired at it. How far it has got
is `progress`, 0 to 1, and everything the pilot sees and hears of the lock is drawn from it:
the HUD frame shrinking onto the target, the progress ring, the tone. Nothing runs on a fixed
timeline, so a target that slips out of the cone halfway loosens the lock instead of finishing it.

- The seeker looks only at the radar's target, inside its cone and range (`SeekerProfile`, per
  missile). IR seekers have their own narrow, short cone; a radar missile locks through the
  aircraft's radar, so its cone is the radar's. No minimum range (user decision 25 Oct 2026): a
  lock holds however close the target comes.
- Inside, progress rises to 1 over `lockSeconds`; at 1 the missile is locked. Outside, it bleeds
  away over `releaseSeconds`. A lock already held gets a little more room before it breaks
  (`seekerRules.keep`), so it does not flicker on the edge of the cone.
- A held lock that breaks while the target is still the radar's reports LOCK LOST for
  `lostSeconds`. A new target or a new missile starts from nothing, and a target shot down or a
  radar lock dropped by choice reports nothing.
- An empty station never locks; firing its last missile ends the lock without LOCK LOST.

Phases are bands of progress (`lockPhase`), shared by the simulation and the HUD:
- search: a radar target, but the seeker has not started on it (progress 0);
- tracking: progress under `seekerRules.acquiring`;
- acquiring: progress from there up to the lock;
- locked.

Missiles do not fly yet: this is the lock they will need.
*/
import { getAircraft } from '../../content/aircraft'
import { missileStations, type SeekerProfile } from '../../content/weapons'
import type { AircraftState } from '../state/WorldState'
import { bearing, radarOf } from './radar'

/** Provisional values, waiting on playtest. */
export const seekerRules = {
  /** Progress at which tracking becomes acquiring. */
  acquiring: 0.6,
  /** A held lock breaks only this much past the cone (degrees) and range (share of it). */
  keep: { coneDeg: 3, range: 0.05 },
  /** Seconds LOCK LOST is reported for. */
  lostSeconds: 1.5,
} as const

export type LockPhase = 'search' | 'tracking' | 'acquiring' | 'locked'

export interface SeekerState {
  /** The selected missile: an index into `missileStations` (0 short range, 1 medium range). */
  slot: number
  /** The target `progress` belongs to. */
  targetId: string | null
  /** 0–1 */
  progress: number
  locked: boolean
  /** The target was inside the seeker's cone and range on the last tick. */
  tracking: boolean
  /** Seconds since a held lock broke, while LOCK LOST is reported; null otherwise. */
  lost: number | null
}
export const createSeekerState = (slot = 0): SeekerState => ({ slot, targetId: null, progress: 0, locked: false, tracking: false, lost: null })

export const lockPhase = (progress: number, locked: boolean): LockPhase =>
  locked ? 'locked' : progress >= seekerRules.acquiring ? 'acquiring' : progress > 0 ? 'tracking' : 'search'

/** The seeker as fitted to `aircraftId`: a radar missile's cone resolved to that aircraft's radar cone. */
export type FittedSeeker = Omit<SeekerProfile, 'coneDeg'> & { coneDeg: number }

/** The selected missile's station, weapon and seeker; null when the aircraft carries none there. */
export function selectedMissile(aircraftId: string, slot: number) {
  const row = missileStations(getAircraft(aircraftId))[slot]
  if (!row) return null
  const seeker = row.weapon.seeker!
  const fitted: FittedSeeker = { ...seeker, coneDeg: seeker.coneDeg === 'radar' ? radarOf(aircraftId).coneDeg : seeker.coneDeg }
  return { ...row, seeker: fitted }
}

/** Inside `seeker`'s cone and range; `held` gives a held lock its extra room. */
export function insideSeeker(seeker: FittedSeeker, angle: number, range: number, held = false) {
  const keep = held ? seekerRules.keep : { coneDeg: 0, range: 0 }
  return angle <= seeker.coneDeg + keep.coneDeg && range <= seeker.rangeM * (1 + keep.range)
}

/** One tick of the seeker, after targeting. `select` is the slot the pilot picked this tick, if any. */
export function stepSeeker(shooter: AircraftState, aircraft: readonly AircraftState[], select: number | null, dt: number) {
  const state = shooter.targeting.seeker
  if (select !== null && select !== state.slot && selectedMissile(shooter.aircraftId, select)) {
    Object.assign(state, createSeekerState(select))
  }
  const targetId = shooter.targeting.targetId
  const target = targetId === null ? undefined : aircraft.find(entity => entity.id === targetId && entity.alive)
  if (!target) { Object.assign(state, createSeekerState(state.slot)); return }
  if (target.id !== state.targetId) Object.assign(state, createSeekerState(state.slot), { targetId: target.id })
  const missile = selectedMissile(shooter.aircraftId, state.slot)
  const loaded = !!missile && shooter.stores.some(store => store.stationId === missile.station.id && store.count > 0)
  // The last missile gone from the station: the lock ends quietly, it was not lost.
  if (!loaded) { Object.assign(state, createSeekerState(state.slot), { targetId: target.id }); return }
  const { angle, range } = bearing(shooter, target)
  state.tracking = missile !== null && insideSeeker(missile.seeker, angle, range, state.locked)
  if (missile && state.tracking) state.progress = Math.min(1, state.progress + dt / missile.seeker.lockSeconds)
  else state.progress = Math.max(0, state.progress - dt / (missile?.seeker.releaseSeconds ?? 1))
  if (state.lost !== null) state.lost = state.lost + dt >= seekerRules.lostSeconds ? null : state.lost + dt
  // A hair under 1, like the radar grace: lockSeconds / dt ticks of dt sum to just below it in floating point.
  if (state.tracking && state.progress >= 1 - 1e-9) { state.progress = 1; state.locked = true; state.lost = null }
  else if (state.locked && !state.tracking) { state.locked = false; state.lost = 0 }
}
