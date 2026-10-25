/*
Gun and missile damage: one HP pool per aircraft (doc 07 MVP, no wing or engine damage). A
missile burst comes in as one hit on the aircraft that set it off, in the same batch as the
tick's gun hits.

The runtime applies one tick's hits as a batch after every round has moved, so
the result never depends on frame rate or render order. Every aircraft that is
alive when the batch starts takes each hit on it in order until its HP reaches
0; later hits on it in the same batch do nothing. Two aircraft can therefore
kill each other in the same tick. Ground hits do no damage.

This module only lowers HP and flips `alive`. The runtime emits
`aircraft-destroyed` from one place for every cause (weapon, terrain,
boundary), so each death is reported exactly once.
*/
import { getWeapon } from '../../content/weapons'
import type { AircraftState } from '../state/WorldState'
import type { ProjectileHit } from './projectiles'

/** Baseline HP for every aircraft (doc 07). */
export const AIRCRAFT_HP = 100

/** `killed`: this hit took the last HP. */
export interface DamageApplied { targetId: string; sourceId: string; amount: number; killed: boolean }

/** Applies one tick's hits in order. Returns the damage actually taken, one entry per hit that did damage. */
export function applyHits(aircraft: readonly AircraftState[], hits: readonly ProjectileHit[]): DamageApplied[] {
  const applied: DamageApplied[] = []
  for (const entry of hits) {
    if (entry.hit.kind !== 'aircraft') continue
    const targetId = entry.hit.entityId
    const target = aircraft.find(entity => entity.id === targetId)
    if (!target || !target.alive || target.hp <= 0) continue
    const weapon = getWeapon(entry.weaponId)
    const damage = weapon.gun?.damage ?? weapon.missile?.damage ?? 0
    // The event carries the HP actually removed, so one kill always adds up to the full pool.
    const amount = Math.min(damage, target.hp)
    if (amount <= 0) continue
    target.hp -= amount
    const killed = target.hp <= 0
    if (killed) { target.alive = false; target.stopReason = 'weapon' }
    applied.push({ targetId, sourceId: entry.ownerId, amount, killed })
  }
  return applied
}
