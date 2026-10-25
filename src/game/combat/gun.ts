/*
Gun cadence and heat, one world tick at a time.

Cadence: `cooldown` is the time until the gun may fire again. While the trigger
is held, rounds are born at `cooldown`, `cooldown + 1/rate`, … inside the tick,
so 80 rounds/s at 60 ticks/s fires 1 or 2 rounds a tick at even spacing. The
cooldown carries over a release, so tapping the trigger never beats the rate,
and a tap on a rested gun fires one round at once.

Heat: builds with trigger time, not per round, so continuous fire from cold
overheats after exactly `heatSeconds`. Two lockouts, both cooling even with the
trigger held (the user's two-tier rule, 2026-10-24):
- Release the trigger at or above `lockHeat`: cooling lockout until heat falls below `resumeHeat`.
- Reach full heat: overheat lockout until heat is down to `overheatResumeHeat`, the longer wait.
Firing on into overheat buys a little more fire for a longer silence; stopping in the warning band
costs a short one.
*/
import type { GunProfile } from '../../content/weapons'

export interface GunState {
  weaponId: string
  /** 0 = cold, 1 = overheated. */
  heat: number
  overheated: boolean
  /** Released in the warning band: locked out until heat falls below the profile's `resumeHeat`. */
  cooling: boolean
  /** Seconds until the next round may fire; 0 when rested. */
  cooldown: number
  /** Rounds fired so far; seeds each round's spread. */
  shots: number
}

export function createGunState(weaponId: string): GunState {
  return { weaponId, heat: 0, overheated: false, cooling: false, cooldown: 0, shots: 0 }
}

/** Advances the gun by `dt`. Returns the birth time of each round fired, in seconds from the start of the tick. */
export function stepGun(gun: GunState, profile: GunProfile, held: boolean, dt: number): number[] {
  const births: number[] = []
  if (held && !gun.overheated && !gun.cooling) {
    let t = gun.cooldown
    for (; t < dt - 1e-12; t += 1 / profile.rate) births.push(t)
    gun.cooldown = t - dt
    gun.heat += dt / profile.heatSeconds
    // Summed float steps land a hair under 1 at exactly heatSeconds.
    if (gun.heat >= 1 - 1e-9) { gun.heat = 1; gun.overheated = true }
  } else {
    if (!held && !gun.overheated && gun.heat >= profile.lockHeat) gun.cooling = true
    gun.cooldown = Math.max(0, gun.cooldown - dt)
    gun.heat = Math.max(0, gun.heat - dt * profile.coolRate)
    // At most: heat stops at 0, so an overheat resume mark of 0 is reached exactly.
    if (gun.overheated && gun.heat <= profile.overheatResumeHeat) gun.overheated = false
    if (gun.cooling && gun.heat < profile.resumeHeat) gun.cooling = false
  }
  gun.shots += births.length
  return births
}

/** Spread half-angle in radians at the gun's current heat. */
export function spreadHalfAngle(profile: GunProfile, heat: number) {
  return profile.spreadDeg / 2 * (1 + profile.hotSpread * heat) * Math.PI / 180
}

/** Two numbers in [0, 1) from the shooter id and round number. Deterministic, so replays fire the same pattern. */
export function spreadSample(ownerId: string, shot: number): [number, number] {
  let seed = 2166136261
  for (const char of `${ownerId}#${shot}`) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619)
  // mulberry32
  const next = () => {
    seed = (seed + 0x6d2b79f5) | 0
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
  return [next(), next()]
}
