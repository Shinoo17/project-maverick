/*
Missiles (doc 07): launch, flight, guidance and the burst, as plain data the runtime steps once
per world tick. Each weapon flies its own `MissileProfile` (content/weapons).

Launch: one missile per press of the launch key, from the selected station, only with the seeker
locked (seeker.ts) and a missile left there, and not within `missileRules.interval` of the last
one. It leaves the aircraft below its belly with the aircraft's own velocity and a small push, and
keeps the target it was fired at for its whole flight: locking another target afterwards does not
change what a missile in the air chases.

Flight: the motor pushes along the path for `burnSeconds`; drag (k·v²) and gravity act all the
time. Steering is proportional navigation: the missile turns at `navigation` times the rate the
sightline to the target swings, capped at `maxG`, so its turn radius grows with speed (v² / g·n).

Guidance, by what the missile knows of its target:
- active: its own seeker sees the target, inside `gimbalDeg` of its nose and `activeRangeM`. An
  IR missile is active from launch; a radar missile goes active (pitbull) once that close.
- datalink: a radar missile not yet active, steered by the launcher's radar while the launcher
  is alive and its radar paints the target (radar.ts).
- memory: a radar missile with neither, flying at where the target was going when last seen.
- lost: an IR missile whose seeker has lost the target flies on unsteered, as does any missile
  in its first `guideDelay` seconds. It can pick the target up again if it comes back in view.

The burst: the proximity fuse sets it off within `fuseM` of any aircraft's centre but the
launcher's, or the path strikes an airframe or the ground. It takes `damage` from the aircraft
that set it off. A missile past its `lifetime`, or slower than `minSpeed` after burnout, destroys
itself harmlessly. There is no minimum range or arming distance (user decision 25 Oct 2026):
only physics stops a close shot, a turn too tight for the missile.
*/
import { Quaternion, Vector3 } from 'three'
import type { MissileProfile } from '../../content/weapons'
import type { AircraftState, Vec3 } from '../state/WorldState'
import { castSegment, type CollisionTarget } from './collision'
import { GRAVITY, GROUND_Y, poseAt, type CombatBody } from './projectiles'
import { radarContacts } from './radar'

/** Provisional values, waiting on playtest. */
export const missileRules = {
  /** Seconds between two launches from one aircraft. */
  interval: 0.6,
  /** Metres below the aircraft's centre a missile leaves from, and the push it is given, m/s. */
  drop: 1.8, eject: 12,
  /** Integration steps per world tick. */
  substeps: 4,
} as const

export type MissileGuidance = 'active' | 'datalink' | 'memory' | 'lost'
export interface Missile {
  /** Unique for the session; shares the projectile counter, so never reused. */
  id: number
  ownerId: string
  weaponId: string
  /** The target it was launched at; fixed for the flight, and '' once that target is gone. */
  targetId: string
  spawnTick: number
  position: Vec3
  velocity: Vec3
  /** Seconds since launch. */
  age: number
  guidance: MissileGuidance
  /** Where the target was and how it moved when last seen, and the missile's age then. */
  known: { position: Vec3; velocity: Vec3; age: number }
}
export type MissileBurst = { cause: 'proximity' | 'impact' | 'ground' | 'expired'; point: Vec3; entityId: string | null }

const v = (p: Vec3) => new Vector3(p.x, p.y, p.z)
const plain = (p: Vector3): Vec3 => ({ x: p.x, y: p.y, z: p.z })

/** A missile leaving `shooter` (its pose as the tick ends) at `target`. */
export function launchMissile(id: number, tick: number, shooter: AircraftState, weaponId: string, target: AircraftState): Missile {
  const q = shooter.orientation, turn = new Quaternion(q.x, q.y, q.z, q.w)
  const nose = new Vector3(1, 0, 0).applyQuaternion(turn), belly = new Vector3(0, -missileRules.drop, 0).applyQuaternion(turn)
  return {
    id, ownerId: shooter.id, weaponId, targetId: target.id, spawnTick: tick, age: 0, guidance: 'lost',
    position: plain(v(shooter.position).add(belly)),
    velocity: plain(v(shooter.velocity).addScaledVector(nose, missileRules.eject)),
    known: { position: { ...target.position }, velocity: { ...target.velocity }, age: 0 },
  }
}

/** Angle in degrees between the missile's path and the line to `point`. */
function offNose(missile: Missile, point: Vec3) {
  const ahead = v(missile.velocity), line = v(point).sub(v(missile.position))
  return ahead.lengthSq() < 1e-6 || line.lengthSq() < 1e-6 ? 0 : ahead.angleTo(line) * 180 / Math.PI
}

/** What the missile knows of its target this tick (updates `guidance` and `known`). */
function sense(missile: Missile, profile: MissileProfile, radarGuided: boolean, owner: AircraftState | undefined, target: AircraftState | undefined, aircraft: readonly AircraftState[]) {
  const sees = !!target && Math.hypot(target.position.x - missile.position.x, target.position.y - missile.position.y, target.position.z - missile.position.z) <= profile.activeRangeM
    && offNose(missile, target.position) <= profile.gimbalDeg
  const linked = radarGuided && !!target && !!owner?.alive && radarContacts(owner, aircraft, null).some(contact => contact.entity.id === target.id && contact.painted)
  // A radar missile that loses its own lock falls back on the datalink, then on memory.
  missile.guidance = sees ? 'active' : !radarGuided || !target ? 'lost' : linked ? 'datalink' : 'memory'
  if ((missile.guidance === 'active' || missile.guidance === 'datalink') && target) {
    missile.known = { position: { ...target.position }, velocity: { ...target.velocity }, age: missile.age }
  }
}

const sight = new Vector3(), closing = new Vector3(), swing = new Vector3(), heading = new Vector3()
/** Proportional navigation toward `aim` moving at `aimVelocity`: the sideways pull, capped at maxG. */
function steer(missile: Missile, profile: MissileProfile, aim: Vec3, aimVelocity: Vec3, out: Vector3) {
  sight.set(aim.x - missile.position.x, aim.y - missile.position.y, aim.z - missile.position.z)
  closing.set(aimVelocity.x - missile.velocity.x, aimVelocity.y - missile.velocity.y, aimVelocity.z - missile.velocity.z)
  const r2 = Math.max(1, sight.lengthSq())
  // Sightline rate Ω = (r × v_rel) / |r|²; the pull is N · Ω × v_missile, square to the path.
  swing.copy(sight).cross(closing).divideScalar(r2)
  heading.set(missile.velocity.x, missile.velocity.y, missile.velocity.z)
  out.copy(swing).cross(heading).multiplyScalar(profile.navigation)
  // A target behind the missile gives no sightline swing to follow: turn toward it at full pull.
  if (sight.dot(heading) < 0) out.copy(sight).addScaledVector(heading, -sight.dot(heading) / Math.max(1e-6, heading.lengthSq())).setLength(profile.maxG * GRAVITY)
  // Hold its height against gravity, as part of the same pull.
  out.y += GRAVITY
  // Only the part square to the path is the fins' work.
  const speed2 = Math.max(1e-6, heading.lengthSq())
  out.addScaledVector(heading, -out.dot(heading) / speed2)
  const limit = profile.maxG * GRAVITY
  if (out.lengthSq() > limit * limit) out.setLength(limit)
  return out
}

/** Distance from the origin to the segment a→b, and the share along it where it is closest. */
function closest(ax: number, ay: number, az: number, bx: number, by: number, bz: number) {
  const dx = bx - ax, dy = by - ay, dz = bz - az
  const len2 = dx * dx + dy * dy + dz * dz
  const t = len2 < 1e-9 ? 0 : Math.min(1, Math.max(0, -(ax * dx + ay * dy + az * dz) / len2))
  return { distance: Math.hypot(ax + dx * t, ay + dy * t, az + dz * t), t }
}

/**
 * Moves a missile through one world tick of `dt` and tests its path against `bodies` (live
 * aircraft posed at the start and end of the tick) and the ground. Returns the burst, or null
 * while it flies on. Mutates the missile.
 */
export function stepMissile(missile: Missile, profile: MissileProfile, radarGuided: boolean, aircraft: readonly AircraftState[], bodies: readonly CombatBody[], dt: number): MissileBurst | null {
  const owner = aircraft.find(entity => entity.id === missile.ownerId)
  const target = aircraft.find(entity => entity.id === missile.targetId && entity.alive)
  // Its target is gone for good: a respawned drone takes the same id, and is not this missile's.
  if (!target) missile.targetId = ''
  sense(missile, profile, radarGuided, owner, target, aircraft)
  const others = bodies.filter(body => body.id !== missile.ownerId)
  const h = dt / missileRules.substeps
  const pullNow = new Vector3(), along = new Vector3()
  for (let step = 0; step < missileRules.substeps; step++) {
    const f0 = step / missileRules.substeps, f1 = (step + 1) / missileRules.substeps
    const p = missile.position, vel = missile.velocity
    const speed = Math.hypot(vel.x, vel.y, vel.z)
    if (missile.age >= profile.lifetime || (missile.age > profile.burnSeconds && speed < profile.minSpeed)) return { cause: 'expired', point: { ...p }, entityId: null }
    pullNow.set(0, 0, 0)
    if (missile.age >= profile.guideDelay && missile.guidance !== 'lost') {
      const since = missile.age - missile.known.age, k = missile.known
      const aim = missile.guidance === 'memory' ? { x: k.position.x + k.velocity.x * since, y: k.position.y + k.velocity.y * since, z: k.position.z + k.velocity.z * since } : k.position
      steer(missile, profile, aim, k.velocity, pullNow)
    }
    // Motor along the path, drag against it, gravity down, and the fins' pull.
    along.set(vel.x, vel.y, vel.z).divideScalar(Math.max(1e-6, speed))
    const push = (missile.age < profile.burnSeconds ? profile.thrust : 0) - profile.drag * speed * speed
    const ax = along.x * push + pullNow.x, ay = along.y * push + pullNow.y - GRAVITY, az = along.z * push + pullNow.z
    const next = { x: vel.x + ax * h, y: vel.y + ay * h, z: vel.z + az * h }
    const end = { x: p.x + next.x * h, y: p.y + next.y * h, z: p.z + next.z * h }
    // The fuse: the closest any aircraft's centre comes to this piece of the path, both moving.
    let fuse: { body: CombatBody; t: number; distance: number } | null = null
    for (const body of others) {
      const a = poseAt(body, f0).position, b = poseAt(body, f1).position
      const near = closest(p.x - a.x, p.y - a.y, p.z - a.z, end.x - b.x, end.y - b.y, end.z - b.z)
      if (near.distance <= profile.fuseM && (!fuse || near.t < fuse.t)) fuse = { body, t: near.t, distance: near.distance }
    }
    const targets: CollisionTarget[] = others.map(body => ({ ...body, from: poseAt(body, f0), to: poseAt(body, f1) }))
    const hit = castSegment(p, end, { groundY: GROUND_Y, targets })
    const at = (t: number): Vec3 => ({ x: p.x + (end.x - p.x) * t, y: p.y + (end.y - p.y) * t, z: p.z + (end.z - p.z) * t })
    if (hit && (!fuse || hit.t <= fuse.t)) {
      return hit.kind === 'aircraft' ? { cause: 'impact', point: hit.point, entityId: hit.entityId } : { cause: 'ground', point: hit.point, entityId: null }
    }
    if (fuse) return { cause: 'proximity', point: at(fuse.t), entityId: fuse.body.id }
    missile.position = end
    missile.velocity = next
    missile.age += h
  }
  return null
}
