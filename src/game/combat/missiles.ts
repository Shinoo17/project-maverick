/*
Missiles (doc 07): launch, flight, guidance and the burst, as plain data the runtime steps once
per world tick. Each weapon flies its own `MissileProfile` (content/weapons).

Launch: one missile per press of the launch key, from the selected station, only with the seeker
locked (seeker.ts) and a missile left there, and not within `missileRules.interval` of the last
one. It keeps the target it was fired at for its whole flight: locking another target afterwards
does not change what a missile in the air chases.

Separation: the missile starts at its station's hardpoint (WeaponStation.launch) with the
aircraft's velocity, and does not steer for the mount's separation time.
- bay: ejected down out of the bay; the motor lights once the separation is over.
- pylon: the motor lights at once and the missile runs off the rail.
Bay doors are drawn only (flightRig): they never delay a launch.

Flight: the motor pushes along the path for `burnSeconds` from ignition; drag (k·v²) and
gravity act all the time, and pulling g costs speed too (turnDrag · n²). Steering is proportional
navigation: the missile turns at `navigation` times the rate the sightline to the target swings.
The pull builds from nothing over `rampSeconds` after separation, and is capped at `maxG` and at
`turnRateDeg` × speed, so a slow missile turns gently and a fast one turns wide (v² / g·n).

Guidance, by what the missile knows of its target:
- active: its own seeker tracks the target, inside `gimbalDeg` of its nose and `activeRangeM`.
  An IR missile leaves the rail tracking; a radar missile goes active (pitbull) once that close.
- datalink: a radar missile not yet active, steered by the launcher's radar while the launcher
  is alive and its radar paints the target (radar.ts).
- memory: a radar missile with neither, flying at where the target was going when last seen.
- lost: an IR missile whose seeker has lost the target flies on unsteered, as does any missile
  whose seeker gave up.
Flares (countermeasures.ts) pull at an IR seeker that is tracking. Each tick it looks at what is
hot within `searchDeg` of what it follows, in its gimbal and range: the target, by its engine
power and how much of its tail it shows the missile (missileRules.heat), and each flare, by its
heat now (flareHeat), less the missile's `flareResist`, times a share fixed per missile and flare
(unitHash: some flares pull harder at one missile than another, never at random per tick). It
follows the hottest, but only changes for something clearly hotter than what it follows
(`switchMargin`), so it never flickers between two. Taken by a flare, it flies at the flare; if the
target is still close by it in view once the flare dims, it takes the target back; if not, when
the flare burns out the track is lost and the seeker searches where the flare was heading, as
below. A radar seeker ignores flares.

Chaff does the same to a radar seeker once it is active (not on datalink or memory), and only to
it. The target returns 1; a chaff cloud returns `radar.chaff` × its bloom (chaffReturn), less
`chaffResist`, times its fixed luck, times how alike the two look in Doppler: the seeker sorts
echoes by speed along its line of sight, and chaff almost hangs in the air, so it only passes for
a target flying square to that line (beaming, the notch). Their speeds along the line must differ
by less than `radar.doppler` m/s for the chaff to count at all. Taken by chaff while the
launcher's radar still paints the target, the datalink points the search back at the target.

The seeker only finds the target within `searchDeg` of where it expects it, and must hold it for
`acquireSeconds` to take it. A seeker that lost its track, or reached where it expected the
target and found nothing, searches for `searchSeconds` and then gives up for good. So a target
that turns hard away from where a missile on memory expects it, or breaks an IR seeker's track
and stays out of view, escapes.

The burst: once armed (`arm`: a time or a distance from the launcher, whichever first), the
proximity fuse sets it off within `fuseM` of any aircraft's centre but the launcher's, or the path
strikes an airframe or the ground. It takes `damage` from the aircraft that set it off. Unarmed,
a strike is a dud: the missile breaks up and does no damage. A missile past its `lifetime`, or
slower than `minSpeed` after burnout, destroys itself harmlessly. Launching close in is allowed
(user decision 2026-10-25); only arming and the turn the missile can make stop a close shot.
*/
import { Quaternion, Vector3 } from 'three'
import type { MissileProfile, WeaponStation } from '../../content/weapons'
import type { Tuple3 } from '../../content/hitboxes'
import type { AircraftState, Vec3 } from '../state/WorldState'
import { castSegment, type CollisionTarget } from './collision'
import { GRAVITY, GROUND_Y, poseAt, type CombatBody } from './projectiles'
import { radarContacts } from './radar'
import { chaffReturn, flareHeat, unitHash, type Decoy } from './countermeasures'

/** Provisional values, waiting on playtest. */
export const missileRules = {
  /** Seconds between two launches from one aircraft. */
  interval: 0.6,
  /** Per mount: seconds before the missile steers, and the push down out of a bay, m/s. */
  mounts: {
    bay: { separation: 0.25, eject: 8 },
    pylon: { separation: 0.1, eject: 0 },
  },
  /** Integration steps per world tick. */
  substeps: 4,
  /** An IR seeker's view of heat. An aircraft shows `engine` (no power, dry power) plus `burner`
   * per unit of afterburner power, times `aspect` (nose on, tail on) by how much tail it shows; a
   * flare at full heat shows `flare`. A flare's pull on one missile varies by up to `luck` either
   * way. The seeker changes what it follows only for something `switchMargin` times hotter. */
  heat: { engine: [0.5, 1], burner: 0.8, aspect: [0.35, 1], flare: 2.4, luck: 0.3, switchMargin: 1.15 },
  /** An active radar seeker's view of chaff: a bloomed cloud returns `chaff` (the target 1),
   * counted only within `doppler` m/s of the target's speed along the sightline, fading to that
   * gate; `luck` as for flares. It switches at heat.switchMargin too. */
  radar: { chaff: 4, doppler: 100, luck: 0.3 },
} as const
export type MissileMount = keyof typeof missileRules.mounts

export type MissileGuidance = 'active' | 'datalink' | 'memory' | 'lost'
export interface Missile {
  /** Unique for the session; shares the projectile counter, so never reused. */
  id: number
  ownerId: string
  weaponId: string
  /** The target it was launched at; fixed for the flight, and '' once that target is gone. */
  targetId: string
  /** The station it left, how, and from which hardpoint (body frame). */
  stationId: string
  mount: MissileMount
  hardpoint: Vec3
  spawnTick: number
  position: Vec3
  velocity: Vec3
  /** Seconds since launch, and metres flown. */
  age: number
  travelled: number
  /** The warhead is armed (MissileProfile.arm); it stays so. */
  armed: boolean
  guidance: MissileGuidance
  /** The seeker: tracking; seconds it has had the target in view while not tracking; seconds it
   * has searched (null when not searching); gave up for good; and the flare it follows instead of
   * the target while tracking (null: the target). */
  seeker: { tracking: boolean; seen: number; searching: number | null; gaveUp: boolean; decoyId: number | null }
  /** Where the target was and how it moved when last seen, and the missile's age then. */
  known: { position: Vec3; velocity: Vec3; age: number }
}
export type MissileBurst = { cause: 'proximity' | 'impact' | 'ground' | 'expired' | 'dud'; point: Vec3; entityId: string | null }

const v = (p: Vec3) => new Vector3(p.x, p.y, p.z)
const plain = (p: Vector3): Vec3 => ({ x: p.x, y: p.y, z: p.z })
const quat = (q: AircraftState['orientation']) => new Quaternion(q.x, q.y, q.z, q.w)

/** The hardpoint the next missile leaves `station` from, with `count` missiles left on it. */
export function hardpointOf(station: WeaponStation, count: number): Tuple3 {
  const points = station.launch!.points
  return points[(station.capacity - count) % points.length]
}

/** Seconds after launch the motor lights. */
const ignition = (missile: Missile) => missile.mount === 'bay' ? missileRules.mounts.bay.separation : 0
/** The motor is burning. */
export const motorBurning = (missile: Missile, profile: MissileProfile) => missile.age >= ignition(missile) && missile.age < ignition(missile) + profile.burnSeconds

/** A missile leaving `shooter` (its pose as the tick ends) from `launch`'s hardpoint at `target`. */
export function launchMissile(id: number, tick: number, shooter: AircraftState, weaponId: string, target: AircraftState,
  launch: { stationId: string; mount: MissileMount; point: Tuple3 }, radarGuided: boolean): Missile {
  const turn = quat(shooter.orientation)
  const down = new Vector3(0, -missileRules.mounts[launch.mount].eject, 0).applyQuaternion(turn)
  return {
    id, ownerId: shooter.id, weaponId, targetId: target.id, stationId: launch.stationId, mount: launch.mount,
    hardpoint: { x: launch.point[0], y: launch.point[1], z: launch.point[2] }, spawnTick: tick,
    position: plain(new Vector3(...launch.point).applyQuaternion(turn).add(v(shooter.position))),
    velocity: plain(v(shooter.velocity).add(down)),
    age: 0, travelled: 0, armed: false, guidance: radarGuided ? 'datalink' : 'active',
    // An IR missile leaves the rail with the launcher's lock handed to its seeker.
    seeker: { tracking: !radarGuided, seen: 0, searching: null, gaveUp: false, decoyId: null },
    known: { position: { ...target.position }, velocity: { ...target.velocity }, age: 0 },
  }
}

/** Angle in degrees between the missile's path and the line to `point`. */
function offNose(missile: Missile, point: Vec3) {
  const ahead = v(missile.velocity), line = v(point).sub(v(missile.position))
  return ahead.lengthSq() < 1e-6 || line.lengthSq() < 1e-6 ? 0 : ahead.angleTo(line) * 180 / Math.PI
}
const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
/** Where the missile expects its target now: the last sighting carried forward. */
function expected(missile: Missile): Vec3 {
  const k = missile.known, since = missile.age - k.age
  return { x: k.position.x + k.velocity.x * since, y: k.position.y + k.velocity.y * since, z: k.position.z + k.velocity.z * since }
}

const angleBetween = (from: Vec3, a: Vec3, b: Vec3) => {
  const one = v(a).sub(v(from)), two = v(b).sub(v(from))
  return one.lengthSq() < 1e-6 || two.lengthSq() < 1e-6 ? 0 : one.angleTo(two) * 180 / Math.PI
}

/** How hot `entity` looks to an IR seeker at `from`: its engine, and how much tail it shows. */
export function aircraftHeat(entity: AircraftState, from: Vec3) {
  const { engine, burner, aspect } = missileRules.heat
  const power = Math.max(0, entity.enginePower)
  const glow = engine[0] + (engine[1] - engine[0]) * Math.min(1, power) + burner * Math.max(0, power - 1)
  const nose = new Vector3(1, 0, 0).applyQuaternion(quat(entity.orientation))
  const toSeeker = v(from).sub(v(entity.position))
  // 1 when the seeker sits right behind it, 0 dead ahead.
  const tail = toSeeker.lengthSq() < 1e-6 ? 1 : (1 - nose.dot(toSeeker.normalize())) / 2
  return glow * (aspect[0] + (aspect[1] - aspect[0]) * tail)
}

/** How hot flare `decoy` looks to `missile`'s seeker. */
export function flarePull(missile: Missile, profile: MissileProfile, decoy: Decoy) {
  const { flare, luck } = missileRules.heat
  return flare * flareHeat(decoy) * (1 - (profile.flareResist ?? 0)) * (1 + luck * (2 * unitHash(missile.id, decoy.id) - 1))
}

/** How strongly chaff `decoy` passes for `target` to `missile`'s active radar seeker (see the header). */
export function chaffPull(missile: Missile, profile: MissileProfile, decoy: Decoy, target: AircraftState | undefined) {
  const { chaff, doppler, luck } = missileRules.radar
  if (!target) return 0
  const line = v(target.position).sub(v(missile.position))
  if (line.lengthSq() < 1e-6) return 0
  line.normalize()
  // Their speeds along the sightline: the Doppler the seeker sorts echoes by.
  const apart = Math.abs(v(target.velocity).sub(v(decoy.velocity)).dot(line))
  const notch = Math.max(0, 1 - apart / doppler)
  return chaff * chaffReturn(decoy) * notch * (1 - (profile.chaffResist ?? 0)) * (1 + luck * (2 * unitHash(missile.id, decoy.id) - 1))
}

/**
 * A seeker tracking: follows the strongest thing near what it follows now, the target or a decoy
 * (flares for IR, chaff for radar; see the header). Returns what it follows, or null once nothing
 * it could follow is left in view.
 */
function followStrongest(missile: Missile, profile: MissileProfile, radarGuided: boolean, target: AircraftState | undefined, decoys: readonly Decoy[]): AircraftState | Decoy | null {
  const seeker = missile.seeker
  const followed = seeker.decoyId === null ? target : decoys.find(decoy => decoy.id === seeker.decoyId)
  if (!followed) return null
  const centre = followed.position
  const inField = (point: Vec3) => distance(point, missile.position) <= profile.activeRangeM && offNose(missile, point) <= profile.gimbalDeg
    && angleBetween(missile.position, point, centre) <= profile.searchDeg
  let best: AircraftState | Decoy | null = null, bestHeat = 0, current = 0
  const weigh = (candidate: AircraftState | Decoy, heat: number) => {
    if (candidate === followed) current = heat
    if (heat > bestHeat) { best = candidate; bestHeat = heat }
  }
  if (target && inField(target.position)) weigh(target, radarGuided ? 1 : aircraftHeat(target, missile.position))
  const kind = radarGuided ? 'chaff' : 'flare'
  for (const decoy of decoys) if (decoy.kind === kind && inField(decoy.position)) weigh(decoy, radarGuided ? chaffPull(missile, profile, decoy, target) : flarePull(missile, profile, decoy))
  if (!best || bestHeat <= 0) return null
  const next: AircraftState | Decoy = current > 0 && bestHeat <= current * missileRules.heat.switchMargin ? followed : best
  seeker.decoyId = next === target ? null : (next as Decoy).id
  return next
}

/** What the missile knows of its target this tick (updates `seeker`, `guidance` and `known`). */
function sense(missile: Missile, profile: MissileProfile, radarGuided: boolean, owner: AircraftState | undefined, target: AircraftState | undefined, aircraft: readonly AircraftState[], decoys: readonly Decoy[], dt: number) {
  const seeker = missile.seeker
  const see = (entity: { position: Vec3; velocity: Vec3 }) => { missile.known = { position: { ...entity.position }, velocity: { ...entity.velocity }, age: missile.age } }
  const linked = radarGuided && !!target && !!owner?.alive && radarContacts(owner, aircraft, null).some(contact => contact.entity.id === target.id && contact.painted)
  // The datalink tells the missile where the target is now.
  if (linked) see(target)
  const guess = expected(missile)
  // The seeker looks where it expects the target, not at the target itself.
  const inView = !!target && distance(target.position, missile.position) <= profile.activeRangeM && offNose(missile, target.position) <= profile.gimbalDeg
    && v(target.position).sub(v(missile.position)).angleTo(v(guess).sub(v(missile.position))) * 180 / Math.PI <= profile.searchDeg
  if (seeker.tracking) {
    const followed = followStrongest(missile, profile, radarGuided, target, decoys)
    if (followed) see(followed)
    else { seeker.tracking = false; seeker.seen = 0; seeker.searching = 0; seeker.decoyId = null }
  } else if (target && !seeker.gaveUp && (seeker.searching !== null || distance(guess, missile.position) <= profile.activeRangeM)) {
    seeker.seen = inView ? seeker.seen + dt : 0
    if (seeker.seen >= profile.acquireSeconds - 1e-9) {
      seeker.tracking = true; seeker.seen = 0; seeker.searching = null
      see(target)
    } else {
      seeker.searching = (seeker.searching ?? 0) + dt
      // A radar missile on the datalink keeps flying it; anything else gives up.
      if (seeker.searching > profile.searchSeconds && !linked) seeker.gaveUp = true
    }
  }
  missile.guidance = seeker.tracking ? 'active' : !target || seeker.gaveUp || !radarGuided ? 'lost' : linked ? 'datalink' : 'memory'
}

const sight = new Vector3(), closing = new Vector3(), swing = new Vector3(), heading = new Vector3()
/** Proportional navigation toward `aim` moving at `aimVelocity`: the sideways pull, capped at `limit`. */
function steer(missile: Missile, profile: MissileProfile, aim: Vec3, aimVelocity: Vec3, limit: number, out: Vector3) {
  sight.set(aim.x - missile.position.x, aim.y - missile.position.y, aim.z - missile.position.z)
  closing.set(aimVelocity.x - missile.velocity.x, aimVelocity.y - missile.velocity.y, aimVelocity.z - missile.velocity.z)
  const r2 = Math.max(1, sight.lengthSq())
  // Sightline rate Ω = (r × v_rel) / |r|²; the pull is N · Ω × v_missile, square to the path.
  swing.copy(sight).cross(closing).divideScalar(r2)
  heading.set(missile.velocity.x, missile.velocity.y, missile.velocity.z)
  out.copy(swing).cross(heading).multiplyScalar(profile.navigation)
  // A target behind the missile gives no sightline swing to follow: turn toward it at full pull.
  if (sight.dot(heading) < 0) out.copy(sight).addScaledVector(heading, -sight.dot(heading) / Math.max(1e-6, heading.lengthSq())).setLength(limit)
  // Hold its height against gravity, as part of the same pull.
  out.y += GRAVITY
  // Only the part square to the path is the fins' work.
  const speed2 = Math.max(1e-6, heading.lengthSq())
  out.addScaledVector(heading, -out.dot(heading) / speed2)
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
 * while it flies on. `decoys` are the flares and chaff in the air, for its seeker. Mutates the missile.
 */
export function stepMissile(missile: Missile, profile: MissileProfile, radarGuided: boolean, aircraft: readonly AircraftState[], bodies: readonly CombatBody[], dt: number, decoys: readonly Decoy[] = []): MissileBurst | null {
  const owner = aircraft.find(entity => entity.id === missile.ownerId)
  const target = aircraft.find(entity => entity.id === missile.targetId && entity.alive)
  // Its target is gone for good: a respawned drone takes the same id, and is not this missile's.
  if (!target) missile.targetId = ''
  sense(missile, profile, radarGuided, owner, target, aircraft, decoys, dt)
  const launcher = bodies.find(body => body.id === missile.ownerId)
  const others = bodies.filter(body => body.id !== missile.ownerId)
  const h = dt / missileRules.substeps
  const steerFrom = missileRules.mounts[missile.mount].separation, lit = ignition(missile)
  const pullNow = new Vector3(), along = new Vector3()
  for (let step = 0; step < missileRules.substeps; step++) {
    const f0 = step / missileRules.substeps, f1 = (step + 1) / missileRules.substeps
    const p = missile.position, vel = missile.velocity
    const speed = Math.hypot(vel.x, vel.y, vel.z)
    if (missile.age >= profile.lifetime || (missile.age > lit + profile.burnSeconds && speed < profile.minSpeed)) return { cause: 'expired', point: { ...p }, entityId: null }
    pullNow.set(0, 0, 0)
    if (missile.age >= steerFrom && missile.guidance !== 'lost') {
      // The autopilot takes hold over rampSeconds; the fins never turn the path faster than turnRateDeg.
      const hold = Math.min(1, (missile.age - steerFrom) / profile.rampSeconds)
      const limit = Math.min(profile.maxG * GRAVITY * hold, profile.turnRateDeg * Math.PI / 180 * speed)
      if (limit > 0) steer(missile, profile, expected(missile), missile.known.velocity, limit, pullNow)
    }
    // Motor along the path, drag and the cost of the pull against it, gravity down, and the fins' pull.
    along.set(vel.x, vel.y, vel.z).divideScalar(Math.max(1e-6, speed))
    const g = pullNow.length() / GRAVITY
    const push = (missile.age >= lit && missile.age < lit + profile.burnSeconds ? profile.thrust : 0) - profile.drag * speed * speed - profile.turnDrag * g * g
    const ax = along.x * push + pullNow.x, ay = along.y * push + pullNow.y - GRAVITY, az = along.z * push + pullNow.z
    const next = { x: vel.x + ax * h, y: vel.y + ay * h, z: vel.z + az * h }
    const end = { x: p.x + next.x * h, y: p.y + next.y * h, z: p.z + next.z * h }
    // Armed by time, or by distance from the launcher (from where it left, once the launcher is gone).
    const travelled = missile.travelled + Math.hypot(next.x * h, next.y * h, next.z * h)
    const clear = launcher ? distance(end, poseAt(launcher, f1).position) : travelled
    const armed = missile.armed || missile.age + h >= profile.arm.seconds || clear >= profile.arm.metres
    // The fuse: the closest any aircraft's centre comes to this piece of the path, both moving.
    let fuse: { body: CombatBody; t: number; distance: number } | null = null
    if (armed) for (const body of others) {
      const a = poseAt(body, f0).position, b = poseAt(body, f1).position
      const near = closest(p.x - a.x, p.y - a.y, p.z - a.z, end.x - b.x, end.y - b.y, end.z - b.z)
      if (near.distance <= profile.fuseM && (!fuse || near.t < fuse.t)) fuse = { body, t: near.t, distance: near.distance }
    }
    const targets: CollisionTarget[] = others.map(body => ({ ...body, from: poseAt(body, f0), to: poseAt(body, f1) }))
    const hit = castSegment(p, end, { groundY: GROUND_Y, targets })
    const at = (t: number): Vec3 => ({ x: p.x + (end.x - p.x) * t, y: p.y + (end.y - p.y) * t, z: p.z + (end.z - p.z) * t })
    if (hit && (!fuse || hit.t <= fuse.t)) {
      const entityId = hit.kind === 'aircraft' ? hit.entityId : null
      if (!armed) return { cause: 'dud', point: hit.point, entityId }
      return entityId ? { cause: 'impact', point: hit.point, entityId } : { cause: 'ground', point: hit.point, entityId: null }
    }
    if (fuse) return { cause: 'proximity', point: at(fuse.t), entityId: fuse.body.id }
    missile.position = end
    missile.velocity = next
    missile.age += h
    missile.travelled = travelled
    missile.armed = armed
  }
  return null
}
