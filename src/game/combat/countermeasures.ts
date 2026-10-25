/*
Countermeasures (doc 07): flares and chaff, as plain data the runtime steps once per world tick.

One key drops both (arcade style, user decision 2026-10-25). A press starts a burst when the
aircraft has one left and is past the last burst's cooldown; presses in between do nothing.
A burst releases `burst.flares` flares, left and right in turn, spread evenly over
`burst.duration` seconds, and `burst.chaff` chaff bundles at its start, from the aircraft's
dispensers (AircraftDefinition.countermeasures.points, body frame). The cooldown runs from the
burst's end. Stock is limited per life: a new aircraft starts full, nothing refills it in flight.

A decoy leaves with the aircraft's velocity plus a push out of its dispenser, then slows under
its own drag (k·v²) and falls, so it drops away behind the jet. No two decoys are alike: each
takes its push, direction, drag and life from a hash of its id (`unitHash`), so a burst spreads
and dies out differently every time, yet the same in every replay and at any frame rate.

A flare lights within a moment, burns at full heat, then dims over the last part of its life
(`flareHeat`); the seeker (missiles.ts) and the drawing (combatEffects.ts) read the same curve.
Chaff blooms into a cloud that almost hangs in the air (`chaffReturn`). Each is gone at the end of its life or
on the ground.
*/
import { Quaternion, Vector3 } from 'three'
import { getAircraft } from '../../content/aircraft'
import type { AircraftState, Vec3 } from '../state/WorldState'
import { GRAVITY, GROUND_Y } from './projectiles'

/** Provisional values, waiting on playtest (user values 2026-10-25 for the flare burst; duration 0.7 s
 * at the user's request, from 0.45 s). Change them here. */
export const countermeasureRules = {
  /** One burst: flares, alternating left and right over `duration` seconds; chaff at its start. */
  burst: { flares: 8, chaff: 4, duration: 0.7 },
  /** Seconds from the end of one burst until another may start. */
  cooldown: 1.5,
  /** Per kind: mean seconds it lasts, mean drag k (1/m), the share of gravity it falls with, and
   * the push off the dispenser (m/s, least to most). */
  kinds: {
    flare: { life: 2.5, drag: 0.004, gravity: 1, eject: [22, 45] },
    chaff: { life: 3, drag: 0.05, gravity: 0.1, eject: [12, 18] },
  },
  /** Each decoy's life and drag differ from the mean by up to this share either way. */
  spread: 0.12,
  /** Seconds a flare takes to light, and the share of its life it burns at full heat. */
  flareIgnition: 0.08, flareFull: 0.35,
  /** Seconds a chaff bundle takes to bloom into a cloud, and the share of its life it holds full. */
  chaffBloom: 0.3, chaffFull: 0.6,
} as const
export type DecoyKind = keyof typeof countermeasureRules.kinds

export interface Decoy {
  /** Unique for the session; shares the projectile counter, so never reused. */
  id: number
  kind: DecoyKind
  ownerId: string
  spawnTick: number
  position: Vec3
  velocity: Vec3
  /** Seconds since release, and this decoy's own life (seconds) and drag k (1/m). */
  age: number
  life: number
  drag: number
}

export interface CountermeasureState {
  /** Bursts left. */
  bursts: number
  /** The burst under way: the tick it started and the flares it has released; null between bursts. */
  burst: { startTick: number; flares: number } | null
  /** The first tick another burst may start on. */
  readyTick: number
}

export function createCountermeasureState(aircraftId: string): CountermeasureState {
  return { bursts: getAircraft(aircraftId).countermeasures.bursts, burst: null, readyTick: 0 }
}

/** A fixed number in [0, 1) for the pair (`a`, `b`): the same every run, never tied to frame rate. */
export function unitHash(a: number, b: number) {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x632be5ab, 0x85ebca77)
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d)
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Ticks after a burst's start that flare `index` leaves on. */
const flareTick = (index: number, step: number) => {
  const { flares, duration } = countermeasureRules.burst
  return Math.round(index * duration / Math.max(1, flares - 1) / step)
}

/** A press of the countermeasure key on `tick`. Returns true when it started a burst. */
export function startBurst(state: CountermeasureState, tick: number, step: number): boolean {
  if (state.bursts <= 0 || state.burst || tick < state.readyTick) return false
  state.bursts--
  state.burst = { startTick: tick, flares: 0 }
  state.readyTick = tick + flareTick(countermeasureRules.burst.flares - 1, step) + Math.round(countermeasureRules.cooldown / step)
  return true
}

/**
 * The decoys `entity` (its pose as the tick ends) releases on `tick`, taking ids from `nextId`.
 * A dead aircraft drops what is left of its burst.
 */
export function releaseDecoys(entity: AircraftState, tick: number, step: number, nextId: () => number): Decoy[] {
  const state = entity.countermeasures, burst = state.burst
  if (!burst) return []
  if (!entity.alive) { state.burst = null; return [] }
  const { flares, chaff } = countermeasureRules.burst
  const points = getAircraft(entity.aircraftId).countermeasures.points
  const turn = new Quaternion(entity.orientation.x, entity.orientation.y, entity.orientation.z, entity.orientation.w)
  const out: Decoy[] = []
  // Chaff at the start, one bundle per dispenser in turn.
  if (tick === burst.startTick) for (let index = 0; index < chaff; index++) out.push(decoy(entity, turn, 'chaff', points[index % points.length], tick, nextId()))
  // Flares as each one's time comes, left and right in turn.
  while (burst.flares < flares && tick - burst.startTick >= flareTick(burst.flares, step)) {
    out.push(decoy(entity, turn, 'flare', points[burst.flares % points.length], tick, nextId()))
    burst.flares++
  }
  if (burst.flares >= flares) state.burst = null
  return out
}

function decoy(entity: AircraftState, turn: Quaternion, kind: DecoyKind, point: readonly number[], tick: number, id: number): Decoy {
  const rules = countermeasureRules.kinds[kind], spread = countermeasureRules.spread
  const roll = (salt: number) => unitHash(id, salt)
  const side = Math.sign(point[2]) || 1
  // Mostly down and outboard, some aft or ahead, some up: a fan, never the same twice.
  const push = new Vector3(-0.35 + 0.5 * roll(1), -1 + 1.3 * roll(2), side * (0.5 + 0.8 * roll(3)))
    .normalize().multiplyScalar(rules.eject[0] + (rules.eject[1] - rules.eject[0]) * roll(4)).applyQuaternion(turn)
  const at = new Vector3(point[0], point[1], point[2]).applyQuaternion(turn)
  return {
    id, kind, ownerId: entity.id, spawnTick: tick, age: 0,
    life: rules.life * (1 + spread * (2 * roll(5) - 1)), drag: rules.drag * (1 + spread * (2 * roll(6) - 1)),
    position: { x: entity.position.x + at.x, y: entity.position.y + at.y, z: entity.position.z + at.z },
    velocity: { x: entity.velocity.x + push.x, y: entity.velocity.y + push.y, z: entity.velocity.z + push.z },
  }
}

/** A flare's heat now, 0 to 1: it lights over `flareIgnition`, burns full for `flareFull` of its
 * life, then dims to nothing at the end of it. 0 for chaff. */
export function flareHeat(decoy: Decoy) {
  if (decoy.kind !== 'flare' || decoy.age >= decoy.life) return 0
  const { flareIgnition, flareFull } = countermeasureRules
  const share = decoy.age / decoy.life
  const lit = Math.min(1, decoy.age / flareIgnition)
  return lit * (share <= flareFull ? 1 : ((1 - share) / (1 - flareFull)) ** 1.5)
}

/** How much radar a chaff cloud returns now, 0 to 1: it blooms over `chaffBloom`, holds for
 * `chaffFull` of its life, then thins to nothing. 0 for a flare. */
export function chaffReturn(decoy: Decoy) {
  if (decoy.kind !== 'chaff' || decoy.age >= decoy.life) return 0
  const { chaffBloom, chaffFull } = countermeasureRules
  const share = decoy.age / decoy.life
  return Math.min(1, decoy.age / chaffBloom) * (share <= chaffFull ? 1 : (1 - share) / (1 - chaffFull))
}

/** Moves a decoy through `dt`. Returns false once it is gone. Mutates the decoy. */
export function stepDecoy(decoy: Decoy, dt: number): boolean {
  const v = decoy.velocity
  // Drag solved implicitly (v / (1 + k·|v|·dt)), so light chaff never overshoots to a standstill.
  const slow = 1 / (1 + decoy.drag * Math.hypot(v.x, v.y, v.z) * dt)
  v.x *= slow; v.y = v.y * slow - GRAVITY * countermeasureRules.kinds[decoy.kind].gravity * dt; v.z *= slow
  decoy.position.x += v.x * dt; decoy.position.y += v.y * dt; decoy.position.z += v.z * dt
  decoy.age += dt
  return decoy.age < decoy.life && decoy.position.y > GROUND_Y
}
