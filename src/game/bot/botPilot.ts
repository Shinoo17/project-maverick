/*
The combat bot (doc 08, P4 slice): one enemy that chases the player and runs when chased, with
the gun and missiles.

A bot is a pilot like the player. It writes an ordinary PilotCommand, once per world tick, and
the aircraft flies it through the same flight model, gun, heat and damage. It never moves its
own aircraft, sets its speed or touches anyone's HP. The runtime builds every bot's command from
the world as it was at the start of the tick, so the order aircraft are stepped in never matters,
and a replay repeats the bot exactly: everything here is a function of the world and the bot's
own plain-data state, with a seeded random stream and no clock.

  world → perceive (10 Hz) → decide (10 Hz, after a reaction delay) → steer + trigger → command

- Perceive: the bot sees every live aircraft within `sensorRange`, all round. The flat range has
  nothing to hide behind, so there is no line-of-sight test yet. A contact is refreshed at the
  decision rate and extrapolated in between, and is forgotten `memorySeconds` after it is lost.
- Decide: patrol with no contact, engage, evade when the contact sits behind it in gun range,
  extend to win back speed or to break off a turning fight neither side is winning, and defend
  above all of them against a missile its warning gear shows (see Defend). A change of tactic waits out the profile's reaction delay; safety
  (the ground, the range edge, a stall) never waits.
- Steer: the bot picks a world direction for its nose and the mouse-aim instructor
  (src/game/input/mouseAim.ts) flies it there, exactly as it flies the player's aim: bank to
  turn, rudder only for the last degrees, the same rate limits. In post-stall the instructor's
  hands-off recovery brings the jet back.
- Trigger: bursts while the bot believes its gun line is on the solution, released before the
  heat lockout. The belief carries a seeded aim error that drifts slowly (doc 08: never per-tick
  jitter); that error, not HP or turn rate, is what makes the bot beatable.
- Missiles: while engaging, the bot picks the station for the range (the IR missile inside its
  `launchRangeM`, the radar missile out to its own), with a little hysteresis so it does not
  swap back and forth on the line, and fires through the same radar lock and seeker as the
  player (targeting.ts, seeker.ts: the runtime steps them for bots too) once the seeker is
  locked on its contact. One missile of its own in the air at a time, then a rest drawn from
  `missileRestSeconds`, and none inside `missileMinRange` (the warhead could not arm).
- Defend: the bot knows of missiles only what its own warning gear shows (rwr.ts): a bearing
  and a level, never a range. A missile (MAWS, or a radar missile gone active) or a radar launch
  warning makes it turn to put the threat square off its side (the beam: an IR seeker sees a
  turning target slide off its flares, a radar seeker loses it in the chaff's Doppler notch),
  burner off, a little nose down. Once it has seen the missile for `dispenseAfter` and is near
  the beam, or `dispenseLate` regardless, it drops a burst, at most `burstsPerMissile` on one
  missile, never wasted inside the cooldown. A launch warning alone gets the turn, not a burst:
  chaff only works on an active seeker. Defence lasts while the warning does, plus
  `threatMemorySeconds` (a coasting missile drops off MAWS).
*/
import { MathUtils, Quaternion, Vector3 } from 'three'
import type { AircraftState, Vec3 } from '../state/WorldState'
import { neutralCommand, type PilotCommand } from '../runtime/commands'
import { WORLD_STEP } from '../runtime/clock'
import { createMouseAim, instruct, instructorShare, stepAim, type MouseAim } from '../input/mouseAim'
import { EFFECTIVE_RANGE, gunMountOf, solveGun, type GunMount } from '../combat/gunSolution'
import { boundingRadius } from '../combat/collision'
import { hitboxes } from '../../content/hitboxes'
import { getAircraft } from '../../content/aircraft'
import { missileStations } from '../../content/weapons'
import type { Missile } from '../combat/missiles'
import { rwrPicture, type RwrThreat } from '../combat/rwr'

export type BotTactic = 'patrol' | 'engage' | 'evade' | 'extend' | 'defend'

/** One difficulty for now (doc 08's Normal). Provisional values, waiting on playtest. */
export interface BotProfile {
  /** Seconds before a new tactic takes over, drawn per decision. */
  reactionSeconds: readonly [number, number]
  /** Typical aim error in degrees, and how long one error lasts before it drifts to the next. */
  aimErrorDeg: number
  aimErrorSeconds: number
  /** The bot fires while it believes its gun line is within this of the solution. */
  fireConeDeg: number
  /** Seconds on aim before the first round; burst and rest lengths in seconds. */
  triggerDelaySeconds: number
  burstSeconds: readonly [number, number]
  restSeconds: readonly [number, number]
  /** Seconds between one of its missiles ending and the next launch. */
  missileRestSeconds: readonly [number, number]
}
export const botProfiles = {
  normal: { reactionSeconds: [0.3, 0.5], aimErrorDeg: 0.7, aimErrorSeconds: 1.4, fireConeDeg: 1.2, triggerDelaySeconds: 0.25, burstSeconds: [0.4, 0.8], restSeconds: [0.5, 1.1], missileRestSeconds: [6, 10] },
} as const satisfies Record<string, BotProfile>
export type BotDifficulty = keyof typeof botProfiles

/** Tactics and safety, shared by every difficulty. Provisional values, waiting on playtest. */
export const botRules = {
  sensorRange: 8000,
  memorySeconds: 4,
  /** Decisions per second, spread across bots by index. */
  decisionHz: 10,
  /** Patrol: a square of waypoints around the range centre, at this altitude. */
  patrolRadius: 2500,
  patrolAltitude: 1200,
  /** Evade when the contact is this close and the bot sits within `threatConeDeg` of its nose. */
  threatRange: 1500,
  threatConeDeg: 25,
  /** Evade ends once the threat has been gone this long, or after `evadeMaxSeconds`. */
  threatClearSeconds: 1.2,
  evadeMaxSeconds: 8,
  /** Break turn: degrees off the current heading; reversed every few seconds while the threat is inside `reverseRange`. */
  breakDeg: 85,
  reverseSeconds: [3, 5] as const,
  reverseRange: 800,
  /** Extend below `slow` (m/s) when not on the gun; done above `fast` or after `extendMaxSeconds`. */
  slow: 85,
  fast: 150,
  extendMaxSeconds: 7,
  /** A turning fight this long without a gun aim is a stalemate: the bot extends and comes back. */
  stalemateSeconds: 12,
  /** Engage: the gun aim inside `gunAimRange`, taken over from the pursuit as the solution comes
   * from the second `gunConeDeg` to the first off the nose. Pursuit lags behind the contact as the
   * bot sits further off its tail (`lagAspectDeg`), inside `lagRange`; it leads otherwise. */
  gunAimRange: 1400,
  gunConeDeg: [10, 25] as const,
  lagAspectDeg: [25, 60] as const,
  lagRange: [2000, 3000] as const,
  /** Speed held behind a target, over its speed, and the closure that calls for the airbrake. */
  overtake: 15,
  brakeClosure: 70,
  brakeRange: 600,
  /** Ground: pull up when the lowest point of a pull-out started now is under `floor` metres;
   * released once it is over `floorClear`. The pull-out is `floorReaction` seconds of the present
   * sink, then a `floorPull` m/s² pull to level. (A straight 6 s look ahead, used before, pulled
   * the bot out of every dive onto a target at 400 m and left it bobbing behind it.) Climb angle in degrees. */
  floor: 350,
  floorClear: 550,
  floorReaction: 1.5,
  floorPull: 30,
  climbDeg: 25,
  /** Ceiling: the nose goes level above this. */
  ceiling: 6500,
  /** Range edge (radius 8 km): turn for the centre from the first radius, wholly by the second. */
  edge: [5000, 6000] as const,
  /** A goal further than this off the nose (degrees) is flown as a turn this far off, in a plane
   * that is kept until the goal comes back in front: a goal near the tail swings from side to side
   * with every small move, and the instructor would reverse the turn with it. */
  farTurnDeg: 100,
  /** Speed (m/s) held in a turning fight, when the contact is well off the nose. The jets reach their
   * best turn rate (0.95 rad/s) from 90 to about 135 m/s, and slower is a tighter circle at that rate. */
  cornerSpeed: 115,
  /** Incidence (degrees) over which the pull is eased off: the bot never asks for post-stall. */
  alphaGuard: [12, 18] as const,
  /** Defend: seconds a warning is kept after it goes; the beam is within `beamDeg` of square off
   * the side; seconds on one missile before a burst near the beam, and before one regardless;
   * bursts spent on one missile at most; speed held (m/s), burner off. */
  threatMemorySeconds: 1.5,
  beamDeg: 35,
  dispenseAfter: 0.6,
  dispenseLate: 1.4,
  burstsPerMissile: 2,
  defendSpeed: [170, 200] as const,
  /** Missiles: no launch closer than this (m); the radar missile gives way to the IR one inside
   * this share of the IR missile's launch range. */
  missileMinRange: 400,
  irHandover: 0.8,
} as const

export interface BotContact {
  id: string
  /** Its type, which the bot can see: the fire cone allows for its size. */
  aircraftId: string
  position: Vec3
  velocity: Vec3
  acceleration: Vec3
  /** Tick the contact was last seen on. */
  tick: number
}

/** Plain data, so a snapshot copies it and a replay rebuilds it. */
export interface BotState {
  difficulty: BotDifficulty
  tactic: BotTactic
  /** Tick the current tactic took over. */
  since: number
  contact: BotContact | null
  /** A tactic decided on but still waiting out the reaction delay. */
  pending: { tactic: BotTactic; at: number } | null
  /** mulberry32 state. */
  rng: number
  /** Aim error, radians about the nose's up and right axes: drifting from `from` to `to` over its span. */
  aimError: { from: [number, number]; to: [number, number]; start: number }
  /** Trigger: on aim since (tick, or -1), burst ends at, rest ends at. */
  onAimSince: number
  burstUntil: number
  restUntil: number
  /** Patrol waypoint index; break side and the tick it reverses on; ticks since the threat went. */
  waypoint: number
  breakSide: 1 | -1
  reverseAt: number
  threatGone: number
  /** Holding a pull-up off the ground. */
  climbing: boolean
  /** Last tick the bot had a gun aim on the contact. */
  lastGun: number
  /** World axis of a turn toward a goal far behind the nose, kept so the turn is never reversed half way. */
  turnAxis: Vec3 | null
  /** The warning defended against: its source, world direction from the bot when last shown, a
   * missile (not a launch warning), first and last tick shown, and bursts dropped on it. */
  threat: { sourceId: string; direction: Vec3; missile: boolean; firstTick: number; lastTick: number; bursts: number } | null
  /** The first tick it may launch another missile on, and the rest (ticks) drawn at its last launch,
   * counted from when that missile is gone. */
  missileReadyTick: number
  missileRest: number
}

export function createBotState(seed: number, difficulty: BotDifficulty = 'normal'): BotState {
  return {
    difficulty, tactic: 'patrol', since: 0, contact: null, pending: null, rng: seed >>> 0,
    aimError: { from: [0, 0], to: [0, 0], start: 0 }, onAimSince: -1, burstUntil: -1, restUntil: -1,
    waypoint: 0, breakSide: 1, reverseAt: 0, threatGone: 0, climbing: false, lastGun: 0, turnAxis: null, threat: null, missileReadyTick: 0, missileRest: 0,
  }
}
/** The instructor's memory for one bot. Kept by the runtime, beside the world, and started afresh each life. */
export const createBotSteering = (): MouseAim => createMouseAim()

/** mulberry32: a uniform number in [0, 1), advancing the bot's own stream. */
function random(bot: BotState) {
  bot.rng = (bot.rng + 0x6d2b79f5) >>> 0
  let t = bot.rng
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const between = (bot: BotState, [lo, hi]: readonly [number, number]) => lo + (hi - lo) * random(bot)
const ticks = (seconds: number) => Math.round(seconds / WORLD_STEP)

const ORIENT = new Quaternion(), NOSE = new Vector3(), UP = new Vector3(), RIGHT = new Vector3()
const AIM = new Vector3(), TO = new Vector3(), FLAT = new Vector3(), CENTRE = new Vector3(), AXIS = new Vector3(), KEPT = new Vector3()
const radii = new Map<string, number>()
function radiusOf(aircraftId: string) {
  const id = getAircraft(aircraftId).hitboxProfileId
  if (!radii.has(id)) radii.set(id, boundingRadius(hitboxes[id]))
  return radii.get(id)!
}
const speedOf = (v: Vec3) => Math.hypot(v.x, v.y, v.z)
const vec = (v: Vec3, out = new Vector3()) => out.set(v.x, v.y, v.z)

/** Angle in degrees between `from`'s nose and the direction to `to`. */
function offNose(from: Pick<AircraftState, 'orientation' | 'position'>, to: Vec3) {
  NOSE.set(1, 0, 0).applyQuaternion(ORIENT.copy(from.orientation as Quaternion))
  TO.set(to.x - from.position.x, to.y - from.position.y, to.z - from.position.z)
  return TO.lengthSq() > 1e-9 ? MathUtils.radToDeg(NOSE.angleTo(TO)) : 0
}

/** Where the contact is now, extrapolated from when it was last seen. */
function contactNow(contact: BotContact, tick: number) {
  const t = (tick - contact.tick) * WORLD_STEP, { position: p, velocity: v, acceleration: a } = contact
  return {
    id: contact.id, aircraftId: contact.aircraftId,
    position: { x: p.x + v.x * t + a.x * t * t / 2, y: p.y + v.y * t + a.y * t * t / 2, z: p.z + v.z * t + a.z * t * t / 2 },
    velocity: { x: v.x + a.x * t, y: v.y + a.y * t, z: v.z + a.z * t },
    acceleration: { ...a },
  }
}

/** The nearest live aircraft within sensor range, other than the bot. Teams come later (doc 07, IFF). */
function perceive(bot: BotState, self: AircraftState, aircraft: readonly AircraftState[], tick: number) {
  let best: AircraftState | null = null, bestRange: number = botRules.sensorRange
  for (const entity of aircraft) {
    if (entity.id === self.id || !entity.alive) continue
    const range = Math.hypot(entity.position.x - self.position.x, entity.position.y - self.position.y, entity.position.z - self.position.z)
    // The one already tracked wins ties within 20%, so the bot does not swap targets every decision.
    const score = entity.id === bot.contact?.id ? range * 0.8 : range
    if (score < bestRange) { best = entity; bestRange = score }
  }
  if (best) bot.contact = { id: best.id, aircraftId: best.aircraftId, position: { ...best.position }, velocity: { ...best.velocity }, acceleration: { ...best.acceleration }, tick }
  else if (bot.contact && (tick - bot.contact.tick) * WORLD_STEP > botRules.memorySeconds) bot.contact = null
}

/** The world direction of a warning, from its bearing and elevation in `self`'s frame. */
function threatDirection(self: AircraftState, threat: RwrThreat): Vec3 {
  const b = MathUtils.degToRad(threat.bearing), e = MathUtils.degToRad(threat.elevation)
  const out = new Vector3(Math.cos(e) * Math.cos(b), Math.sin(e), Math.cos(e) * Math.sin(b)).applyQuaternion(ORIENT.copy(self.orientation as Quaternion))
  return { x: out.x, y: out.y, z: out.z }
}

/** Reads the warning gear: keeps the most urgent missile, or else a launch warning. */
function perceiveThreats(bot: BotState, self: AircraftState, aircraft: readonly AircraftState[], missiles: readonly Missile[], tick: number) {
  const picture = rwrPicture(self, { aircraft, missiles })
  // The missile already defended against stays the one while it shows, so its burst count holds.
  const shown = picture.find(threat => threat.sourceId === bot.threat?.sourceId && (threat.level === 'missile' || threat.level === 'launch'))
    ?? picture.find(threat => threat.level === 'missile') ?? picture.find(threat => threat.level === 'launch')
  if (shown) {
    const missile = shown.level === 'missile'
    if (bot.threat?.sourceId !== shown.sourceId) bot.threat = { sourceId: shown.sourceId, direction: threatDirection(self, shown), missile, firstTick: tick, lastTick: tick, bursts: 0 }
    else Object.assign(bot.threat, { direction: threatDirection(self, shown), missile, lastTick: tick })
  } else if (bot.threat && (tick - bot.threat.lastTick) * WORLD_STEP > botRules.threatMemorySeconds) bot.threat = null
}

/** The tactic the bot wants, from what it perceives. */
function wanted(bot: BotState, self: AircraftState, tick: number): BotTactic {
  // A missile or a launch warning comes before any fight.
  if (bot.threat) return 'defend'
  if (!bot.contact) return 'patrol'
  const contact = contactNow(bot.contact, tick)
  const range = Math.hypot(contact.position.x - self.position.x, contact.position.y - self.position.y, contact.position.z - self.position.z)
  // Threat: the contact is close behind with its nose on the bot.
  const threatened = range < botRules.threatRange && offNose({ position: contact.position, orientation: velocityFrame(contact.velocity) }, self.position) < botRules.threatConeDeg
    && offNose(self, contact.position) > 90
  const speed = speedOf(self.velocity), elapsed = (tick - bot.since) * WORLD_STEP
  if (bot.tactic === 'evade') {
    bot.threatGone = threatened ? 0 : bot.threatGone + 1 / botRules.decisionHz
    if (bot.threatGone < botRules.threatClearSeconds && elapsed < botRules.evadeMaxSeconds) return 'evade'
    return speed < botRules.slow ? 'extend' : 'engage'
  }
  if (threatened) return 'evade'
  if (bot.tactic === 'extend' && (speed < botRules.fast || elapsed < 3) && elapsed < botRules.extendMaxSeconds) return 'extend'
  // Two aircraft circling each other with neither getting its nose round: break off, open the range
  // and come back from a new side. It also gives the other pilot a shot.
  if (bot.tactic === 'engage' && range < 2000 && Math.min(elapsed, (tick - bot.lastGun) * WORLD_STEP) > botRules.stalemateSeconds) return 'extend'
  // Slow and not about to shoot: run out and win back speed first.
  if (speed < botRules.slow && (range > EFFECTIVE_RANGE || offNose(self, contact.position) > 30)) return 'extend'
  return 'engage'
}
/** A contact's orientation guessed from its velocity: what the bot can see of where its nose points. */
function velocityFrame(v: Vec3) {
  FLAT.set(v.x, v.y, v.z)
  if (FLAT.lengthSq() < 1e-6) FLAT.set(1, 0, 0)
  return new Quaternion().setFromUnitVectors(new Vector3(1, 0, 0), FLAT.normalize())
}

function decide(bot: BotState, self: AircraftState, aircraft: readonly AircraftState[], missiles: readonly Missile[], tick: number) {
  perceive(bot, self, aircraft, tick)
  perceiveThreats(bot, self, aircraft, missiles, tick)
  const next = wanted(bot, self, tick)
  if (next === bot.tactic) { bot.pending = null; return }
  if (bot.pending?.tactic !== next) bot.pending = { tactic: next, at: tick + ticks(between(bot, botProfiles[bot.difficulty].reactionSeconds)) }
}
function switchTo(bot: BotState, tactic: BotTactic, tick: number) {
  bot.tactic = tactic; bot.since = tick; bot.pending = null; bot.threatGone = 0
  if (tactic === 'evade') bot.reverseAt = tick + ticks(between(bot, botRules.reverseSeconds))
}
/** The break goes the way the lift already leans, so it starts pulling at once instead of rolling first. */
function breakSide(self: AircraftState): 1 | -1 {
  ORIENT.copy(self.orientation as Quaternion)
  UP.set(0, 1, 0).applyQuaternion(ORIENT); NOSE.set(1, 0, 0).applyQuaternion(ORIENT)
  // The canopy against the level direction to the right of the nose: leaning right breaks right (+1).
  return UP.dot(RIGHT.set(-NOSE.z, 0, NOSE.x)) >= 0 ? 1 : -1
}

/** The aim error now, in radians about the nose's up and right axes, drifting smoothly between draws. */
function aimError(bot: BotState, tick: number): [number, number] {
  const profile = botProfiles[bot.difficulty], span = ticks(profile.aimErrorSeconds)
  if (tick - bot.aimError.start >= span) {
    // A new error each span, smoothly reached: a triangular draw per axis, at most 1.7 × aimErrorDeg.
    const draw = () => MathUtils.degToRad(profile.aimErrorDeg) * (random(bot) + random(bot) - 1) * 1.7
    bot.aimError = { from: bot.aimError.to, to: [draw(), draw()], start: tick }
  }
  const t = MathUtils.smoothstep(tick - bot.aimError.start, 0, span)
  return [MathUtils.lerp(bot.aimError.from[0], bot.aimError.to[0], t), MathUtils.lerp(bot.aimError.from[1], bot.aimError.to[1], t)]
}

/** `direction` turned by the aim error about the nose's up and right axes (in place). */
function withError(direction: Vector3, self: AircraftState, error: [number, number]) {
  ORIENT.copy(self.orientation as Quaternion)
  UP.set(0, 1, 0).applyQuaternion(ORIENT); RIGHT.set(0, 0, 1).applyQuaternion(ORIENT)
  return direction.applyAxisAngle(UP, error[0]).applyAxisAngle(RIGHT, error[1]).normalize()
}

/** A horizontal unit direction with `pitchDeg` of climb. */
function heading(x: number, z: number, pitchDeg: number, out: Vector3) {
  const across = Math.hypot(x, z) || 1, pitch = MathUtils.degToRad(pitchDeg)
  return out.set(x / across * Math.cos(pitch), Math.sin(pitch), z / across * Math.cos(pitch))
}

interface Steer { direction: Vector3; speedAdjust: number; afterburner: boolean; airbrake: boolean; gun?: { mount: GunMount; target: ReturnType<typeof contactNow>; believed: Vector3 } }

/** The nose direction and throttle for the current tactic, before safety. */
function steer(bot: BotState, self: AircraftState, tick: number): Steer {
  const p = self.position, v = self.velocity, speed = speedOf(v)
  const out: Steer = { direction: AIM, speedAdjust: 0, afterburner: false, airbrake: false }
  if (bot.tactic === 'defend') {
    const threat = bot.threat
    if (threat) {
      // Beam it: level flight square to the threat, on the side nearer the present heading.
      const across = Math.hypot(threat.direction.x, threat.direction.z) || 1
      const sx = -threat.direction.z / across, sz = threat.direction.x / across
      const side = sx * v.x + sz * v.z >= 0 ? 1 : -1
      heading(side * sx, side * sz, p.y > 1500 ? -5 : 0, AIM)
    } else heading(v.x, v.z, 0, AIM)
    out.speedAdjust = speed < botRules.defendSpeed[0] ? 1 : speed > botRules.defendSpeed[1] ? -1 : 0
    return out
  }
  const contact = bot.contact && contactNow(bot.contact, tick)
  if (bot.tactic === 'patrol' || !contact) {
    const angle = bot.waypoint * Math.PI / 2, wx = Math.cos(angle) * botRules.patrolRadius, wz = Math.sin(angle) * botRules.patrolRadius
    if (Math.hypot(wx - p.x, wz - p.z) < 600) bot.waypoint = (bot.waypoint + 1) % 4
    const climb = MathUtils.clamp((botRules.patrolAltitude - p.y) / 40, -10, 10)
    heading(wx - p.x, wz - p.z, climb, AIM)
    out.speedAdjust = speed < 150 ? 1 : speed > 170 ? -1 : 0
    return out
  }
  const range = Math.hypot(contact.position.x - p.x, contact.position.y - p.y, contact.position.z - p.z)
  if (bot.tactic === 'evade') {
    // A hard level break across the threat's line at corner speed. Reversed now and then while the
    // threat sits close, to spoil its aim; every reversal costs a roll, so not often.
    if (tick >= bot.reverseAt) {
      if (range < botRules.reverseRange) bot.breakSide = -bot.breakSide as 1 | -1
      bot.reverseAt = tick + ticks(between(bot, botRules.reverseSeconds))
    }
    const yaw = Math.atan2(v.z, v.x) + bot.breakSide * MathUtils.degToRad(botRules.breakDeg)
    heading(Math.cos(yaw), Math.sin(yaw), -3, AIM)
    const want = botRules.cornerSpeed + 20
    out.speedAdjust = speed < want - 5 ? 1 : speed > want + 5 ? -1 : 0
    out.airbrake = speed > want + 25
    return out
  }
  if (bot.tactic === 'extend') {
    // Unload: hold the heading, a little nose down while there is height for it, burner on.
    heading(v.x, v.z, p.y > 900 ? -6 : 0, AIM)
    out.speedAdjust = 1; out.afterburner = true
    return out
  }
  // Engage.
  const closure = -((contact.velocity.x - v.x) * (contact.position.x - p.x) + (contact.velocity.y - v.y) * (contact.position.y - p.y) + (contact.velocity.z - v.z) * (contact.position.z - p.z)) / Math.max(range, 1)
  const mount = gunMountOf(self.aircraftId)
  const solution = range < botRules.gunAimRange ? solveGun(self, mount, contact) : null
  // Angle off the contact's tail: 0 sitting dead astern of it, 180 head on.
  TO.set(contact.position.x - p.x, contact.position.y - p.y, contact.position.z - p.z)
  const targetSpeed = speedOf(contact.velocity)
  const aspect = targetSpeed > 1 ? MathUtils.radToDeg(vec(contact.velocity, FLAT).angleTo(TO)) : 0
  // Pursuit: a point on the contact's track, ahead of it (lead) or behind it (lag). Lag well off its
  // tail brings the bot round onto the tail instead of across it and past. One continuous blend,
  // so the aim never jumps from one side of the contact to the other.
  const leadTime = MathUtils.clamp(range / Math.max(speed + closure * 0.5, 80), 0, 4)
  const lagTime = -MathUtils.clamp(range * 0.4, 150, 600) / Math.max(targetSpeed, 1)
  const lag = MathUtils.smoothstep(aspect, botRules.lagAspectDeg[0], botRules.lagAspectDeg[1]) * (1 - MathUtils.smoothstep(range, botRules.lagRange[0], botRules.lagRange[1]))
  const ahead = MathUtils.lerp(leadTime, lagTime, lag)
  AIM.set(contact.position.x + contact.velocity.x * ahead - p.x, contact.position.y + contact.velocity.y * ahead - p.y, contact.position.z + contact.velocity.z * ahead - p.z).normalize()
  if (solution) {
    // Gun aim: the nose where the gun line lies on the solution (the gun line sits elevationDeg above
    // the nose), as the bot misjudges it. Taken over from the pursuit as it comes near the nose.
    ORIENT.copy(self.orientation as Quaternion)
    RIGHT.set(0, 0, 1).applyQuaternion(ORIENT)
    const gunNose = vec(solution.aim, new Vector3()).normalize().applyAxisAngle(RIGHT, -MathUtils.degToRad(mount.elevationDeg))
    withError(gunNose, self, aimError(bot, tick))
    NOSE.set(1, 0, 0).applyQuaternion(ORIENT)
    const take = 1 - MathUtils.smoothstep(MathUtils.radToDeg(NOSE.angleTo(gunNose)), botRules.gunConeDeg[0], botRules.gunConeDeg[1])
    if (take > 0) {
      AXIS.crossVectors(AIM, gunNose)
      if (AXIS.lengthSq() > 1e-12) AIM.applyAxisAngle(AXIS.normalize(), AIM.angleTo(gunNose) * take)
      if (take > 0.5) { out.gun = { mount, target: contact, believed: gunNose }; bot.lastGun = tick }
    }
  }
  // Throttle: burner to close from afar, then hold a small overtake, airbrake when too fast.
  if (range > 1500) { out.speedAdjust = 1; out.afterburner = speed < 230 }
  else {
    const want = targetSpeed + (range > 500 ? botRules.overtake * 2 : botRules.overtake)
    out.speedAdjust = speed < want - 5 ? 1 : speed > want + 5 ? -1 : 0
    out.afterburner = speed < want - 30
    out.airbrake = speed > want + 15 || (closure > botRules.brakeClosure && range < botRules.brakeRange)
  }
  if (range < 1500 && offNose(self, contact.position) > 30) {
    // Turning to bring the nose round: corner speed.
    out.speedAdjust = speed < botRules.cornerSpeed - 5 ? 1 : speed > botRules.cornerSpeed + 5 ? -1 : 0
    out.afterburner = false
    out.airbrake = speed > botRules.cornerSpeed + 25
  }
  // Never let a fight bleed below the extend speed for long: the decision loop will extend.
  if (speed < botRules.slow) { out.speedAdjust = 1; out.airbrake = false }
  return out
}

/** Safety overrides, in doc 08's order: the ground, then the ceiling and the range edge. True while one holds. */
function guard(bot: BotState, self: AircraftState, direction: Vector3) {
  const p = self.position, v = self.velocity
  const sink = Math.max(0, -v.y), ahead = p.y - sink * botRules.floorReaction - sink * sink / (2 * botRules.floorPull)
  bot.climbing = bot.climbing ? ahead < botRules.floorClear || v.y < 0 : ahead < botRules.floor
  if (bot.climbing) { heading(v.x, v.z, botRules.climbDeg, direction); return true }
  if (p.y > botRules.ceiling && direction.y > 0) heading(direction.x, direction.z, -2, direction)
  const radius = Math.hypot(p.x, p.z)
  const edge = MathUtils.smoothstep(radius, botRules.edge[0], botRules.edge[1])
  if (edge > 0) {
    // Turn for the centre, keeping the climb or dive the tactic asked for.
    heading(-p.x, -p.z, MathUtils.radToDeg(Math.asin(MathUtils.clamp(direction.y, -1, 1))), CENTRE)
    direction.lerp(CENTRE, edge).normalize()
    return edge > 0.5
  }
  return false
}

/** A goal far behind the nose becomes a turn `farTurnDeg` off it, in a plane kept from tick to tick (in place). */
function holdTurn(bot: BotState, self: AircraftState, direction: Vector3) {
  NOSE.set(1, 0, 0).applyQuaternion(ORIENT.copy(self.orientation as Quaternion))
  const limit = MathUtils.degToRad(botRules.farTurnDeg)
  if (NOSE.angleTo(direction) <= limit) { bot.turnAxis = null; return }
  AXIS.crossVectors(NOSE, direction)
  if (bot.turnAxis) {
    // The kept plane, brought up to date with the nose: it stays as long as it still turns the right way round.
    vec(bot.turnAxis, KEPT)
    KEPT.addScaledVector(NOSE, -KEPT.dot(NOSE))
    if (KEPT.lengthSq() > 1e-6) AXIS.copy(KEPT)
  } else if (AXIS.lengthSq() < 1e-8) AXIS.set(0, 1, 0).applyQuaternion(ORIENT)
  AXIS.normalize()
  bot.turnAxis = { x: AXIS.x, y: AXIS.y, z: AXIS.z }
  direction.copy(NOSE).applyAxisAngle(AXIS, limit)
}

/** The missile actions this tick: pick the station for the range, then launch once locked (see the header). */
function missileActions(bot: BotState, self: AircraftState, missiles: readonly Missile[], tick: number): PilotCommand['actions'] {
  if (bot.tactic !== 'engage' || !bot.contact) return []
  const contact = contactNow(bot.contact, tick)
  const range = Math.hypot(contact.position.x - self.position.x, contact.position.y - self.position.y, contact.position.z - self.position.z)
  const rows = missileStations(getAircraft(self.aircraftId)).map((row, slot) => ({ ...row, slot,
    loaded: self.stores.some(store => store.stationId === row.station.id && store.count > 0) }))
  const fits = (row: typeof rows[number]) => row.loaded && range <= row.weapon.missile!.launchRangeM
  const ir = rows.find(row => row.weapon.kind === 'ir')
  const current = rows[self.targeting.seeker.slot]
  // Keep the station it has while it still fits, unless the IR missile is now well inside its range.
  const closeIn = ir && fits(ir) && range <= ir.weapon.missile!.launchRangeM * botRules.irHandover
  const choice = current && fits(current) && !(closeIn && current !== ir) ? current : closeIn ? ir : rows.find(fits)
  if (!choice) return []
  if (choice !== current) return [{ id: tick, type: 'select-secondary', slot: choice.slot }]
  const seeker = self.targeting.seeker
  if (tick < bot.missileReadyTick || range < botRules.missileMinRange || !seeker.locked || seeker.targetId !== contact.id) return []
  // One of its own in the air at a time; the rest starts again when that one is gone.
  if (missiles.some(missile => missile.ownerId === self.id)) { bot.missileReadyTick = tick + bot.missileRest; return [] }
  bot.missileRest = ticks(between(bot, botProfiles[bot.difficulty].missileRestSeconds))
  return [{ id: tick, type: 'fire-missile' }]
}

/** Drops a burst on the missile defended against once it is time (see the header), when the stock and cooldown allow. */
function dispense(bot: BotState, self: AircraftState, tick: number) {
  const threat = bot.threat, stock = self.countermeasures
  if (bot.tactic !== 'defend' || !threat?.missile || threat.bursts >= botRules.burstsPerMissile) return false
  if (stock.bursts <= 0 || stock.burst || tick < stock.readyTick) return false
  const seen = (tick - threat.firstTick) * WORLD_STEP
  if (seen < botRules.dispenseAfter) return false
  // How far the threat sits from square off the side, now.
  NOSE.set(1, 0, 0).applyQuaternion(ORIENT.copy(self.orientation as Quaternion))
  const offBeam = Math.abs(90 - MathUtils.radToDeg(NOSE.angleTo(vec(threat.direction, TO))))
  if (offBeam > botRules.beamDeg && seen < botRules.dispenseLate) return false
  threat.bursts++
  return true
}

/** One tick of a bot: decisions at 10 Hz, steering and trigger every tick. `index` spreads decisions across bots.
 * `missiles` are those in flight, for its warning gear. */
export function botCommand(bot: BotState, steering: MouseAim, self: AircraftState, aircraft: readonly AircraftState[], tick: number, index = 0, missiles: readonly Missile[] = []): PilotCommand {
  const command = neutralCommand(tick, self.id)
  if (!self.alive) return command
  const period = Math.round(1 / (botRules.decisionHz * WORLD_STEP))
  if ((tick + index) % period === 0) decide(bot, self, aircraft, missiles, tick)
  if (bot.pending && tick >= bot.pending.at) {
    if (bot.pending.tactic === 'evade') bot.breakSide = breakSide(self)
    switchTo(bot, bot.pending.tactic, tick)
  }
  const plan = steer(bot, self, tick)
  const guarded = guard(bot, self, plan.direction)
  holdTurn(bot, self, plan.direction)
  if (bot.climbing) { plan.speedAdjust = 1; plan.airbrake = false }

  // Post-stall: hands off, and the instructor's own recovery levels the jet; hands back on once it flies.
  const flying = instructorShare(self) > 0.9 && speedOf(self.velocity) > botRules.slow
  const handsOn = steering.recovering ? flying : instructorShare(self) > 0.5
  if (!steering.recovering || flying) steering.direction.copy(plan.direction)
  stepAim(steering, self, tick, false, handsOn)
  const gunning = plan.gun && !guarded && !steering.recovering
  // On the gun the instructor flies tighter, as it does for a player's aim on the lead. The
  // lead's own turn is already in the aim's measured rate, so trackLead's feed-forward is not needed.
  steering.tracking = gunning ? 1 : 0
  const flown = steering.share > 0 ? instruct(steering, self) : { pitch: 0, roll: 0, yaw: 0 }
  // Ease off the pull as incidence climbs: the bot never opens the limiter into post-stall (no PSM below Hard).
  const guardPull = 1 - 0.9 * MathUtils.smoothstep(self.maneuver.alpha, botRules.alphaGuard[0], botRules.alphaGuard[1])
  command.pitch = steering.share * flown.pitch * (flown.pitch > 0 ? guardPull : 1)
  command.roll = steering.share * flown.roll
  command.yaw = steering.share * flown.yaw
  command.speedAdjust = plan.speedAdjust; command.afterburner = plan.afterburner; command.airbrake = plan.airbrake
  command.gunHeld = gunning ? trigger(bot, self, plan.gun!, tick) : release(bot)
  if (dispense(bot, self, tick)) command.actions.push({ id: tick, type: 'countermeasure' })
  command.actions.push(...missileActions(bot, self, missiles, tick))
  return command
}

/** Bursts while the bot believes it is on the solution, in range, with the heat clear of the lockout. */
function trigger(bot: BotState, self: AircraftState, gun: NonNullable<Steer['gun']>, tick: number) {
  const profile = botProfiles[bot.difficulty]
  const solution = solveGun(self, gun.mount, gun.target)
  if (!solution?.reachable || solution.range > EFFECTIVE_RANGE) return release(bot)
  // What the bot believes: its gun line against the solution as it misjudges it (the drifting aim error).
  ORIENT.copy(self.orientation as Quaternion)
  RIGHT.set(0, 0, 1).applyQuaternion(ORIENT)
  const believedLine = TO.copy(gun.believed).applyAxisAngle(RIGHT, MathUtils.degToRad(gun.mount.elevationDeg))
  const gunLine = NOSE.set(Math.cos(MathUtils.degToRad(gun.mount.elevationDeg)), Math.sin(MathUtils.degToRad(gun.mount.elevationDeg)), 0).applyQuaternion(ORIENT)
  const offDeg = MathUtils.radToDeg(gunLine.angleTo(believedLine))
  // The cone never narrows below the target's own size at that range.
  const cone = Math.max(profile.fireConeDeg, MathUtils.radToDeg(Math.atan(radiusOf(gun.target.aircraftId) / Math.max(solution.range, 1))))
  if (offDeg > cone) return release(bot)
  if (bot.onAimSince < 0) bot.onAimSince = tick
  const heat = self.gun.heat, lockHeat = gun.mount.profile.lockHeat
  if (self.gun.overheated || self.gun.cooling) return false
  // Let go short of the lockout band, so the bot never takes the cooling penalty.
  if (heat >= lockHeat - 0.12) {
    if (tick >= bot.restUntil) bot.restUntil = tick + ticks(between(bot, profile.restSeconds))
    bot.burstUntil = -1
    return false
  }
  if (tick < bot.onAimSince + ticks(profile.triggerDelaySeconds) || tick < bot.restUntil) return false
  if (bot.burstUntil < 0) bot.burstUntil = tick + ticks(between(bot, profile.burstSeconds))
  if (tick < bot.burstUntil) return true
  bot.burstUntil = -1
  bot.restUntil = tick + ticks(between(bot, profile.restSeconds))
  return false
}
function release(bot: BotState) { bot.onAimSince = -1; bot.burstUntil = -1; return false }
