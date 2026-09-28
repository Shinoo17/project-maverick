/*
Gun rounds as plain data: spawn, ballistic flight and swept hits.

A round is born at the muzzle with the shooter's velocity plus the muzzle speed
along the gun line, spread by a seeded cone. Each tick it moves on a straight
chord of its ballistic arc and `castSegment` tests that chord against the ground
and every live aircraft, posed at the start and end of that part of the tick.
The round ends at its first hit, after `lifetime` or after `maxDistance`
metres, whichever comes first; the last chord is clipped so nothing is hit past
the distance cap.

The shooter's own hitboxes are ignored only while the round leaves the muzzle
(`OWNER_IGNORE_SECONDS`); the muzzle sits on the airframe skin.
*/
import { Quaternion, Vector3 } from 'three'
import type { GunProfile } from '../../content/weapons'
import type { HitShape } from '../../content/hitboxes'
import type { Quat, Vec3 } from '../state/WorldState'
import { castSegment, type CollisionTarget, type Pose, type SegmentHit } from './collision'
import { spreadHalfAngle, spreadSample } from './gun'

/** m/s², the same as the flight profiles. The lead cue must use this drop too. */
export const GRAVITY = 9.81
export const GROUND_Y = 0
/** Three ticks: the round is 40 m or more clear of the muzzle by then. */
export const OWNER_IGNORE_SECONDS = 0.05

export interface Projectile {
  /** Unique for the session; never reused. */
  id: number
  ownerId: string
  weaponId: string
  spawnTick: number
  position: Vec3
  velocity: Vec3
  /** Seconds since birth. */
  age: number
  /** Metres travelled. */
  travelled: number
}
export interface ProjectileHit { tick: number; projectileId: number; ownerId: string; weaponId: string; hit: SegmentHit }

/** A live aircraft as seen by rounds during one tick. */
export interface CombatBody {
  id: string
  shapes: readonly HitShape[]
  radius: number
  from: Pose & { velocity: Vec3 }
  to: Pose & { velocity: Vec3 }
}

const lerp = (a: Vec3, b: Vec3, f: number): Vec3 => ({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f })
const quat = (q: Quat) => new Quaternion(q.x, q.y, q.z, q.w)

/** Pose a fraction `f` of the way through the tick. */
export function poseAt(body: CombatBody, f: number): Pose & { velocity: Vec3 } {
  if (f <= 0) return body.from
  if (f >= 1) return body.to
  const q = quat(body.from.orientation).slerp(quat(body.to.orientation), f)
  return { position: lerp(body.from.position, body.to.position, f), orientation: { x: q.x, y: q.y, z: q.z, w: q.w }, velocity: lerp(body.from.velocity, body.to.velocity, f) }
}

/** A new round, fired from the shooter's pose `f` of the way through the tick. */
export function spawnRound(id: number, tick: number, shooter: CombatBody, f: number, muzzle: readonly [number, number, number],
  weaponId: string, profile: GunProfile, heat: number, shot: number): Projectile {
  const pose = poseAt(shooter, f)
  const orientation = quat(pose.orientation)
  const [u, v] = spreadSample(shooter.id, shot)
  // Uniform over the cone's disc: sqrt keeps the centre from bunching.
  const off = spreadHalfAngle(profile, heat) * Math.sqrt(u), around = 2 * Math.PI * v
  const direction = new Vector3(Math.cos(off), Math.sin(off) * Math.cos(around), Math.sin(off) * Math.sin(around)).applyQuaternion(orientation)
  const start = new Vector3(...muzzle).applyQuaternion(orientation)
  return {
    id, ownerId: shooter.id, weaponId, spawnTick: tick, age: 0, travelled: 0,
    position: { x: pose.position.x + start.x, y: pose.position.y + start.y, z: pose.position.z + start.z },
    velocity: { x: pose.velocity.x + direction.x * profile.muzzleSpeed, y: pose.velocity.y + direction.y * profile.muzzleSpeed, z: pose.velocity.z + direction.z * profile.muzzleSpeed },
  }
}

/**
 * Moves a round through the part of the tick from `offset` to `dt` seconds and tests its path.
 * Returns the hit, or whether the round is spent. Mutates the round when it flies on.
 */
export function stepRound(round: Projectile, profile: GunProfile, offset: number, dt: number, bodies: readonly CombatBody[]): { hit: SegmentHit | null; done: boolean } {
  let time = Math.min(dt - offset, profile.lifetime - round.age)
  if (time <= 0) return { hit: null, done: true }
  const { position: p, velocity: v } = round
  let end = { x: p.x + v.x * time, y: p.y + v.y * time - GRAVITY * time * time / 2, z: p.z + v.z * time }
  let length = Math.hypot(end.x - p.x, end.y - p.y, end.z - p.z)
  const left = profile.maxDistance - round.travelled
  let capped = false
  if (length >= left) {
    const k = length > 0 ? left / length : 0
    end = lerp(p, end, k); time *= k; length = left; capped = true
  }
  const f0 = offset / dt, f1 = (offset + time) / dt
  const whole = f0 <= 0 && f1 >= 1
  const targets: CollisionTarget[] = bodies.map(body => whole ? body : { ...body, from: poseAt(body, f0), to: poseAt(body, f1) })
  const hit = castSegment(p, end, { groundY: GROUND_Y, targets, ignoreId: round.age < OWNER_IGNORE_SECONDS ? round.ownerId : undefined })
  if (hit) return { hit, done: true }
  round.position = end
  round.velocity = { x: v.x, y: v.y - GRAVITY * time, z: v.z }
  round.age += time; round.travelled += length
  return { hit: null, done: capped || round.age >= profile.lifetime - 1e-9 }
}
