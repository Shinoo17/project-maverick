import { MathUtils, Quaternion, Vector3, type Camera } from 'three'
import type { AircraftState, Vec3 } from '../state/WorldState'
import { drawnReticle, solveGun, type GunMount, type TargetMotion } from '../combat/gunSolution'
import { MOUSE } from './config'

/*
The instructor: the aim controller of the feat/p4-gun-duel branch (its src/game/input/mouseAim.ts,
`instruct`, `trackLead`, `followTarget`, `aimAtRay`), brought back on 2026-11-16 because the owner
found the example's aim controller (AimController.ts) jerky and late against it.

Why it reads smoother. The example's controller commands rate = gain × error, which is full
stick from about four degrees of error, so the stick slams between its stops, and it banks by
a threshold on the error. The instructor instead:

- flies each axis at the rate that brakes to rest exactly on the error (`profile`): full rate
  far out, an easy brake in, linear at the last so it never chatters;
- slews every command (`slew`), so a goal that jumps eases the stick over;
- feeds the aim's own turn forward (`rate`), so a moving aim is followed without an error;
- plans the roll from the lift the path needs: toward the aim, with the aim's turn, and against
  gravity. Far off the canopy goes toward the aim; close in gravity alone is left, so a still
  aim levels the wings.

Direct or banked, as the example splits it (`directDeg`, `bankDeg`; owner request
2026-11-16). On the old branch the bank began with the first degree of error, so a small drag
to the side rolled the jet and then pulled, and it twitched. Here an aim within `directDeg` of
the nose is flown with pitch and rudder alone, no roll toward it; the bank toward the aim, and
the bank for the aim's own turn, come in between `directDeg` and `bankDeg`, and the rudder
falls to `MOUSE.bankYawShare` over the same range. Tracking a target's lead or following a
target close in still banks for its turn at any error: a crossing target is out-turning the
rudder.

The bank is kept (owner request 2026-11-16, as the example does with its roll-out off). In the
direct range the roll is not flown at all, so a turn ends with the jet still banked and the
nose held on the aim with pitch and rudder; the old branch levelled the wings at once, which
read as hurried. The wings roll level when the hand moves the mouse a little back against the
bank (`levelDeg`): the hand's own motion, not the nose running a degree past the aim. And a bank set on the roll keys is the pilot's and is never
levelled (`own`), until the instructor next banks the jet itself.

What changed in the port. It read the legacy flight profile and airflow; here it is given the
rates full stick commands now (`limits`, from controlAircraft.ts, any flight core). Its
post-stall handover and hands-off recovery are gone: on this branch the ControlMixer and the
FCS own PSM and RECOVERY, and the mixer blends the example's controller back in for its PSM
direct regime. Tick counting became a `dt` and explicit resets.

Everything here is input: it writes ordinary pitch, roll and yaw into the command, once per
command tick, and a replay repeats the commands.
*/
export const INSTRUCTOR = {
  /** Direct or banked: an aim within the first of the nose is flown with pitch and rudder alone,
   * whatever the bank (at 90° of bank a small move up or down is the rudder's); the bank toward the
   * aim comes in up to the second. Wider than the example's 6°, so a small move of the hand at a
   * held bank does not start a roll. */
  directDeg: 10,
  bankDeg: 25,
  /** The same two for an aim on the belly side (owner request 2026-11-16): a moderate move of the
   * mouse downward at any bank is a push, pitch down alone, not a roll over to pull. Between the
   * belly and the sides the range runs between this and the pair above. */
  pushDirectDeg: 25,
  pushBankDeg: 45,
  /** Each axis flies the fastest rate profile that still stops on the aim: full rate while far,
   * then braking at `brake` (rad/s²) so the rate reaches zero as the error does. Near the aim the
   * profile turns linear at `gain` (1/s) so it never chatters about zero. `track` adds that share
   * of the gap between the rate wanted and the rate flying, to cancel the controller's lag. The
   * brake is well under what the jet can do: an easy stop reads as smooth. */
  brake: { pitch: 2.4, roll: 7, yaw: 1.2 },
  gain: { pitch: 6, roll: 5, yaw: 4 },
  track: 0.5,
  /** How fast a command may move, in full deflections per second. */
  slew: 4,
  /** Seconds over which the aim's turn rate is smoothed: a hand is not a steady turn. */
  rateSeconds: 0.15,
  /** An aim on the belly side is reached by pushing or by rolling to pull, whichever is quicker.
   * A push is planned as if the nose went this much slower than a pull. */
  pushPace: 0.3,
  /** The other choice must be this many seconds quicker before the instructor switches; and a
   * roll already under way past this close to inverted from its goal keeps its direction. */
  switchSeconds: 0.25,
  reverseRad: 0.5,
  /** The pull waits for the roll: none while the canopy is further off its goal than the first
   * cosine (~60°), whole once inside the second (~18°). Gated only for an aim further off than
   * `alignedDeg`; close in, pitch trims at any bank. */
  alignedCos: [0.5, 0.95] as const,
  alignedDeg: [3, 10] as const,
  /** The bank is kept once the nose is on the aim. It is rolled level only when the hand moves the
   * mouse this many degrees of aim back against the bank (a bank of more than `bankedDeg`), and
   * until the wings are within `levelDoneDeg` of level. The count of that motion fades over
   * `levelSeconds`, so stray sideways pixels over a long turn never add up to a levelling. */
  levelDeg: 1.5,
  levelSeconds: 0.5,
  bankedDeg: 3,
  levelDoneDeg: 1,
  /** A sweep of the hand banks at once (owner request 2026-11-16, "smooth, flying about"). Under a steady
   * drag of the mouse the direct range waited for the nose to fall `directDeg` behind the aim, and
   * the bank then came in only as the error grew on to `bankDeg`: the jet skidded on the rudder for
   * most of a second, 24° behind a 40°/s hand, and then whipped round to catch up. A sweep is told
   * from a flick by lasting: the hand has moved the aim more than `directDeg` in one go (`travel`,
   * fading over `seconds` once the hand rests, wiped by `reverseDeg` of motion back) and has been moving for
   * `heldSeconds` (faster than `movingDeg` a second), and is moving still, faster than the rudder
   * can turn the nose (`outrun`: the smoothed rate of the aim as a multiple of the yaw rate full
   * rudder gives now; a slower drag the rudder follows flat, wings level, as before). Then the bank
   * is whole within `widthDeg` more of travel, wherever the nose has got to, and the roll is planned
   * for the hand's own turn. A flick is over in a tenth of a second, so it never counts: inside the
   * direct range it still flies direct with no roll, and past it the bank comes in with the error as
   * before. The moment the hand stops the sweep is over too, so the bank the turn ends with is kept.
   * `enabled: false` = as before, the bank by the error alone. */
  sweep: { enabled: true, seconds: 0.5, reverseDeg: 1.5, widthDeg: 6, heldSeconds: [0.15, 0.3] as const, movingDeg: 5, outrun: [1, 1.5] as const },
  /** While rolling to pull, a push never asks more than this once the aim is far off. */
  pullOnlyPush: 0.2,
  pullOnlyDeg: [10, 30] as const,
}

/** Screen steering on a moving target: the lead's own turn fed forward while the × is on it. */
export const LEAD_TRACK = {
  /** Fed forward whole while the aim is within the first of the lead, none past the second. */
  leadDeg: [3, 8] as const,
  /** Seconds the lead's turn rate is smoothed over. */
  rateSeconds: 0.1,
  /** A lead that jumps further than this in one second's worth of ticks (a new target, a respawn) starts over. */
  jumpRadPerSecond: 3,
  /** On the lead, pitch and yaw answer this much harder and every command slews this fast. */
  gainScale: 1.6,
  slew: 12,
}

/** Close-in follow: close behind a target the instructor turns with the target's own acceleration,
 * instead of with the aim swinging behind it, which rolled the jet from side to side. */
export const FOLLOW = {
  /** Metres to the target: whole inside the first, gone past the second. */
  range: [300, 600] as const,
  /** Degrees from the aim to the target or its lead, whichever is nearer: whole inside the first, gone past the second. */
  onDeg: [8, 15] as const,
  /** Seconds the target's acceleration is smoothed over. */
  smoothSeconds: 0.3,
  /** While following, the pull toward the aim keeps only this share in the bank. */
  turnShare: 0.2,
}

export interface InstructorState {
  /** The aim's own turn, world angular velocity in rad/s, smoothed; and where the aim was last tick. */
  rate: Vector3
  previous: Vector3
  primed: boolean
  /** How far the hand has turned the aim in one go, as a rotation (world axis × radians), and the seconds
   * it has been moving (falling back three times as fast while it rests): see `INSTRUCTOR.sweep`. */
  travel: Vector3
  moving: number
  /** The gun solution's aim direction last tick, its smoothed turn (rad/s, world) and the target it was for. */
  lead: Vector3
  leadRate: Vector3
  leadId: string | null
  /** How much the aim is on a target's lead this tick, 0..1: gunnery, so it is flown tighter. */
  tracking: number
  /** Close-in follow: the target's acceleration, smoothed (world, m/s²), its share of the turn, and the target. */
  follow: Vector3
  following: number
  followId: string | null
  /** Pushing to an aim on the belly side instead of rolling to pull. */
  pushing: boolean
  /** Rolling the wings level: the hand moved back against the bank (see `levelDeg`); and the degrees it has moved back so far. */
  levelling: boolean
  back: number
  /** The bank was last set on the roll keys, and the instructor has flown no roll of its own since: it is the pilot's, never levelled. */
  own: boolean
  /** The last command: each axis slews from it. `flying` is false until the first command after a reset. */
  flown: { pitch: number; roll: number; yaw: number }
  flying: boolean
}
export const createInstructor = (): InstructorState => ({ rate: new Vector3(), previous: new Vector3(1, 0, 0), primed: false, travel: new Vector3(), moving: 0, lead: new Vector3(1, 0, 0), leadRate: new Vector3(), leadId: null, tracking: 0,
  follow: new Vector3(), following: 0, followId: null, pushing: false, levelling: false, back: 0, own: false, flown: { pitch: 0, roll: 0, yaw: 0 }, flying: false })
export function resetInstructor(s: InstructorState) {
  s.rate.set(0, 0, 0); s.primed = false; s.travel.set(0, 0, 0); s.moving = 0; s.leadRate.set(0, 0, 0); s.leadId = null; s.tracking = 0
  s.follow.set(0, 0, 0); s.following = 0; s.followId = null; s.pushing = false; s.levelling = false; s.back = 0; s.own = false; s.flying = false
  return s
}

const NOSE = new Vector3(), BODY = new Vector3(), TURN = new Vector3(), LIFT = new Vector3(), SPIN = new Vector3()
const ORIENT = new Quaternion(), INVERSE = new Quaternion()
const noseOf = (state: Pick<AircraftState, 'orientation'>, out = NOSE) => out.set(1, 0, 0).applyQuaternion(ORIENT.set(state.orientation.x, state.orientation.y, state.orientation.z, state.orientation.w))

/**
 * Once per command tick, before anything that follows the jet moves the aim: measures the aim's
 * own turn since the last tick (what the hand or the gun lock did). `still` reads it as no turn
 * (a key flying the jet; screen steering, whose aim is read off the × afresh every tick).
 * Call `settleAim` after the tick's syncs and limits have moved the aim.
 */
export function measureAim(s: InstructorState, aim: Vector3, dt: number, still: boolean) {
  if (!s.primed || !(dt > 0)) { s.rate.set(0, 0, 0); s.travel.set(0, 0, 0); s.moving = 0; return s }
  const angle = s.previous.angleTo(aim)
  TURN.crossVectors(s.previous, aim)
  if (still || TURN.lengthSq() <= 1e-16) TURN.set(0, 0, 0)
  else TURN.normalize().multiplyScalar(angle / dt)
  s.rate.lerp(TURN, 1 - Math.exp(-dt / INSTRUCTOR.rateSeconds))
  // The hand's travel in one go: fading, and wiped by a little motion back the other way.
  const sweep = INSTRUCTOR.sweep
  const handMoves = !still && angle > MathUtils.degToRad(sweep.movingDeg) * dt
  s.moving = handMoves ? Math.min(s.moving + dt, 1) : Math.max(0, s.moving - 3 * dt)
  if (still) s.travel.set(0, 0, 0)
  else {
    if (!handMoves) s.travel.multiplyScalar(Math.exp(-dt / sweep.seconds))
    if (TURN.dot(s.travel) < 0) s.travel.multiplyScalar(Math.max(0, 1 - angle / MathUtils.degToRad(sweep.reverseDeg)))
    s.travel.addScaledVector(TURN, dt)
  }
  return s
}
export function settleAim(s: InstructorState, aim: Vector3) { s.previous.copy(aim); s.primed = true }

/** A ray from the lens through the ×: its origin relative to the aircraft, and its direction. */
export interface CursorRay { offset: Vec3; direction: Vec3 }

const EYE = new Vector3(), THROUGH = new Vector3()
/** The ray through pixel (`px`, `py`) from the middle of a `width`×`height` frame, for a
 * rendered `camera` (world matrix current) following an aircraft at `aircraft`. */
export function cursorRay(camera: Camera, px: number, py: number, width: number, height: number, aircraft: Vec3): CursorRay {
  EYE.setFromMatrixPosition(camera.matrixWorld)
  THROUGH.set(px / (width / 2), -py / (height / 2), 0.5).unproject(camera).sub(EYE).normalize()
  return { offset: { x: EYE.x - aircraft.x, y: EYE.y - aircraft.y, z: EYE.z - aircraft.z }, direction: { x: THROUGH.x, y: THROUGH.y, z: THROUGH.z } }
}

const GOAL = new Vector3(), HIT = new Vector3(), SWING = new Quaternion()
/*
Screen steering: the nose that puts the gun reticle under the ×, into `aim`. The point under the
× is taken at the reticle's own range from the aircraft (so the lens's offset from the nose costs
nothing there), and the nose is turned by whatever turns the reticle onto it. The reticle is the
one the HUD draws (`drawnReticle`): at the target's range while there is a solution, so the × on
the lead marker puts the drawn reticle on it too, bullet drop included.
*/
export function aimAtRay(aim: Vector3, state: AircraftState, ray: CursorRay, mount: GunMount, target?: TargetMotion | null) {
  const p = state.position
  const { reticle } = drawnReticle(state, mount, target)
  HIT.set(reticle.x - p.x, reticle.y - p.y, reticle.z - p.z)
  const range = HIT.length()
  if (range < 1e-6) return aim
  HIT.divideScalar(range)
  // Along the ray to the point `range` from the aircraft: |offset + direction·t| = range.
  const o = ray.offset, d = ray.direction
  const along = o.x * d.x + o.y * d.y + o.z * d.z, offsetSq = o.x * o.x + o.y * o.y + o.z * o.z
  const t = -along + Math.sqrt(Math.max(0, along * along - offsetSq + range * range))
  GOAL.set(o.x + d.x * t, o.y + d.y * t, o.z + d.z * t).normalize()
  SWING.setFromUnitVectors(HIT, GOAL)
  return aim.copy(noseOf(state)).applyQuaternion(SWING).normalize()
}

const LEAD = new Vector3(), LEAD_NOSE = new Vector3(), LEAD_TURN = new Vector3(), WING = new Vector3()
/*
Screen steering tracking a moving target. The aim is read off the × every tick, so it has no turn
of its own to feed forward, and a × kept on a crossing target's lead left the nose trailing it by
the whole turn the instructor needed an error for. The lead's own turn is the turn wanted: fed
forward while the × is on or near the lead (`leadDeg`); a × held anywhere else keeps the plain
behaviour, turning toward it. Once per command tick, after `measureAim`.
*/
export function trackLead(s: InstructorState, aim: Vector3, state: AircraftState, target: (TargetMotion & { id: string }) | null, mount: GunMount, dt: number) {
  const solution = target ? solveGun(state, mount, target) : null
  if (!solution || !target) { s.leadId = null; s.leadRate.set(0, 0, 0); s.tracking = 0; return s }
  LEAD.set(solution.aim.x, solution.aim.y, solution.aim.z).normalize()
  const angle = s.lead.angleTo(LEAD)
  if (s.leadId !== target.id || !(dt > 0) || angle > LEAD_TRACK.jumpRadPerSecond * dt) s.leadRate.set(0, 0, 0)
  else {
    LEAD_TURN.crossVectors(s.lead, LEAD)
    if (LEAD_TURN.lengthSq() > 1e-16) LEAD_TURN.normalize().multiplyScalar(angle / dt)
    else LEAD_TURN.set(0, 0, 0)
    s.leadRate.lerp(LEAD_TURN, 1 - Math.exp(-dt / LEAD_TRACK.rateSeconds))
  }
  s.lead.copy(LEAD); s.leadId = target.id
  // Where the nose goes for the gun line to lie on the solution: the gun line sits above the nose.
  WING.set(0, 0, 1).applyQuaternion(ORIENT.set(state.orientation.x, state.orientation.y, state.orientation.z, state.orientation.w))
  LEAD_NOSE.copy(LEAD).applyAxisAngle(WING, -MathUtils.degToRad(mount.elevationDeg))
  const near = 1 - MathUtils.smoothstep(MathUtils.radToDeg(aim.angleTo(LEAD_NOSE)), LEAD_TRACK.leadDeg[0], LEAD_TRACK.leadDeg[1])
  s.rate.copy(s.leadRate).multiplyScalar(near)
  s.tracking = near
  return s
}

const FOLLOW_TO = new Vector3(), FOLLOW_ACCEL = new Vector3()
/** Once per command tick: how much the instructor turns with `target` this tick (close-in follow). */
export function followTarget(s: InstructorState, aim: Vector3, state: AircraftState, target: (TargetMotion & { id: string }) | null, mount: GunMount, dt: number) {
  if (!target) { s.following = 0; s.followId = null; return s }
  FOLLOW_ACCEL.set(target.acceleration.x, target.acceleration.y, target.acceleration.z)
  if (s.followId !== target.id || !(dt > 0)) s.follow.copy(FOLLOW_ACCEL)
  else s.follow.lerp(FOLLOW_ACCEL, 1 - Math.exp(-dt / FOLLOW.smoothSeconds))
  s.followId = target.id
  const p = state.position
  FOLLOW_TO.set(target.position.x - p.x, target.position.y - p.y, target.position.z - p.z)
  const range = FOLLOW_TO.length()
  let offDeg = MathUtils.radToDeg(aim.angleTo(FOLLOW_TO))
  const solution = solveGun(state, mount, target)
  if (solution) offDeg = Math.min(offDeg, MathUtils.radToDeg(aim.angleTo(LEAD.set(solution.aim.x, solution.aim.y, solution.aim.z))))
  s.following = (1 - MathUtils.smoothstep(range, FOLLOW.range[0], FOLLOW.range[1])) * (1 - MathUtils.smoothstep(offDeg, FOLLOW.onDeg[0], FOLLOW.onDeg[1]))
  return s
}

const SIDE = new Vector3()
const wrap = (angle: number) => angle - 2 * Math.PI * Math.round(angle / (2 * Math.PI))
const clamp1 = (value: number) => Math.max(-1, Math.min(1, value))
const GRAVITY = 9.81
/** The rate (rad/s, signed) that brakes to rest exactly at `error`: linear near zero, the
 * stopping-distance curve further out, never more than `max`. */
function profile(error: number, brake: number, gain: number, max: number) {
  const knee = brake / gain
  return Math.sign(error) * Math.min(max, Math.sqrt(knee * knee + 2 * brake * Math.abs(error)) - knee)
}

/**
 * Pitch, roll and yaw (−1..1) that fly the nose onto `aim` as fast as the jet can without
 * overshooting it. `limits` are the body rates full stick commands now (rad/s; pitch with the G
 * limit in it). Errors are read in the body frame (+X nose, +Y canopy, +Z right wing), so they
 * mean the same at any attitude.
 */
export function instruct(s: InstructorState, aim: Vector3, state: AircraftState, limits: { pitch: number; roll: number; yaw: number }, dt: number, rollKey = false, handAsideDeg = 0) {
  const I = INSTRUCTOR
  const pitchRate = Math.max(limits.pitch, 0.05), rollRate = Math.max(limits.roll, 0.05), yawRate = Math.max(limits.yaw, 0.05)
  const nose = noseOf(state)
  INVERSE.copy(ORIENT).invert()
  BODY.copy(aim).applyQuaternion(INVERSE)
  const off = Math.acos(Math.max(-1, Math.min(1, BODY.x)))
  const offDeg = MathUtils.radToDeg(off)

  // The lift wanted, in the world: toward the aim, turning with it, and against gravity.
  const velocity = state.velocity, speed = Math.hypot(velocity.x, velocity.y, velocity.z)
  TURN.copy(aim).addScaledVector(nose, -aim.dot(nose))
  // Direct below `directDeg` (pitch and rudder, no roll toward the aim), banked from `bankDeg`.
  // Wider toward the belly: there the direct way is a push, and rolling over to pull is the long way round.
  const belly = off > 1e-6 ? MathUtils.clamp(-BODY.y / Math.sin(off), 0, 1) : 0
  const byError = MathUtils.smoothstep(offDeg, MathUtils.lerp(I.directDeg, I.pushDirectDeg, belly), MathUtils.lerp(I.bankDeg, I.pushBankDeg, belly))
  // A sweep of the hand counts as the error does (`sweep`), read on the side the hand is moving the aim to.
  const travelled = s.travel.length()
  let bySweep = 0
  if (I.sweep.enabled && travelled > 1e-6) {
    BODY.crossVectors(s.travel, aim).applyQuaternion(INVERSE)
    const toBelly = MathUtils.clamp(-BODY.y / Math.max(BODY.length(), 1e-9), 0, 1)
    const from = MathUtils.lerp(I.directDeg, I.pushDirectDeg, toBelly)
    bySweep = MathUtils.smoothstep(MathUtils.radToDeg(travelled), from, from + I.sweep.widthDeg)
      * MathUtils.smoothstep(s.moving, I.sweep.heldSeconds[0], I.sweep.heldSeconds[1])
      * MathUtils.smoothstep(s.rate.length() / yawRate, I.sweep.outrun[0], I.sweep.outrun[1])
    BODY.copy(aim).applyQuaternion(INVERSE)
  }
  const banked = Math.max(byError, bySweep)
  // How hard toward the aim: the pull the pitch profile below will ask for (its rate × speed),
  // none in the direct range, so a small drag of the hand does not bank the jet. Read off
  // the error alone, not off what the jet is pulling now: that would feed the bank back into
  // itself. Banked for that and gravity together, a held turn neither sinks nor climbs.
  const pullRate = profile(off, I.brake.pitch, I.gain.pitch, pitchRate)
  if (TURN.lengthSq() > 1e-12) TURN.normalize().multiplyScalar(pullRate * Math.max(speed, 30) * banked)
  // The turn fed forward: the aim's own, or close behind a target, the target's (`followTarget`).
  // In the direct range the rudder and pitch follow the aim's turn; on a target they are out-turned, so the bank stays.
  LIFT.copy(s.rate).cross(SPIN.set(velocity.x, velocity.y, velocity.z)).multiplyScalar(Math.max(banked, s.tracking, s.following))
  if (s.following > 0) { LIFT.lerp(s.follow, s.following); TURN.multiplyScalar(MathUtils.lerp(1, FOLLOW.turnShare, s.following)) }
  LIFT.add(SPIN.set(0, GRAVITY, 0))
  const holding = LIFT.length()
  LIFT.add(TURN)
  const liftUp = LIFT.y
  LIFT.applyQuaternion(INVERSE)
  const across = Math.hypot(LIFT.y, LIFT.z)
  const pull = Math.atan2(LIFT.z, LIFT.y)
  // Push or pull, both along the same lift: canopy toward it and pull, or belly toward it and
  // push, whichever is quicker: the roll each needs plus the time to turn the nose, pushes paced
  // slower. Only while the pull toward the aim is what the lift is mostly for, or the lift points
  // down (an aim a little under the nose: pushed to, wings level). Under gravity alone the canopy
  // always goes up, never a held −1 g.
  const push = wrap(pull - Math.PI)
  if (TURN.length() < 2 * holding && liftUp > 0) s.pushing = false
  else {
    // A roll under way the other way first has to stop and come back.
    const rollTime = (to: number) => Math.abs(to) / rollRate + (to * state.rates.roll < 0 ? 2 * Math.abs(state.rates.roll) / I.brake.roll : 0)
    const pullTime = rollTime(pull) + off / pitchRate
    const pushTime = rollTime(push) + off / (pitchRate * I.pushPace)
    if (s.pushing ? pullTime < pushTime - I.switchSeconds : pushTime < pullTime - I.switchSeconds) s.pushing = !s.pushing
  }
  // Lift along the nose (a vertical climb under a still aim) has no side to roll to: hold.
  let rollError = (s.pushing ? push : pull) * MathUtils.smoothstep(across, 0.5, 2)
  // How much of that roll is flown. All of it while banking for the aim or a target; none in the
  // direct range, where the bank the turn ended with is kept, until the hand moves back against the
  // bank (`handAsideDeg`: degrees of aim the mouse moved sideways this tick, right positive): then
  // the wings are rolled level.
  WING.set(0, 0, 1).applyQuaternion(ORIENT); SIDE.set(0, 1, 0).applyQuaternion(ORIENT)
  const bankDeg = MathUtils.radToDeg(Math.atan2(-WING.y, SIDE.y))
  // Motion toward the bank starts the count again, and is a turn being asked for, not a levelling.
  s.back *= Math.exp(-dt / I.levelSeconds)
  if (handAsideDeg * bankDeg > 0) { s.back = 0; s.levelling = false }
  else if (Math.abs(bankDeg) > I.bankedDeg) s.back += Math.abs(handAsideDeg)
  // A bank set on the roll keys stays the pilot's until the instructor banks the jet itself (a turn
  // past the direct range, a target tracked or followed): a knife edge rolled on the keys to pass
  // a gap is not rolled level by a small correction of the mouse against it.
  if (rollKey) s.own = true
  else if (Math.max(banked, s.tracking, s.following) > 0) s.own = false
  if (rollKey || s.own || Math.abs(bankDeg) < I.levelDoneDeg) { s.levelling = false; s.back = 0 }
  else if (s.back > I.levelDeg) s.levelling = true
  rollError *= Math.max(banked, s.levelling ? 1 : 0, s.tracking, s.following)
  // Nearly inverted from the goal, keep rolling the way the jet already rolls: the goal wobbling
  // across ±180° must not reverse a roll that is half done.
  if (Math.abs(rollError) > Math.PI - I.reverseRad && rollError * state.rates.roll < 0 && Math.abs(state.rates.roll) > 0.2) rollError -= Math.sign(rollError) * 2 * Math.PI

  // The aim's turn in the body frame: about +Z is pitch up, about −Y is yaw right.
  SPIN.copy(s.rate).applyQuaternion(INVERSE)
  const pitchError = Math.atan2(BODY.y, BODY.x), yawError = Math.atan2(BODY.z, BODY.x)
  const rudder = MathUtils.lerp(1, MOUSE.bankYawShare, banked)
  const { brake, track } = I, rates = state.rates
  const tight = 1 + s.tracking * (LEAD_TRACK.gainScale - 1)
  const fly = (wanted: number, rate: number, full: number) => clamp1((wanted + track * (wanted - rate)) / full)
  // Pull only as hard as the lift is already on its way: pulling with the canopy still well off
  // the aim swings the nose out of the plane the roll is aiming for, and the roll overshoots.
  // Close in, pitch trims whatever the bank.
  const aligned = MathUtils.lerp(1, MathUtils.smoothstep(Math.cos(rollError), I.alignedCos[0], I.alignedCos[1]), MathUtils.smoothstep(offDeg, I.alignedDeg[0], I.alignedDeg[1]))
  let pitch = fly(aligned * profile(pitchError, brake.pitch, I.gain.pitch * tight, pitchRate) + SPIN.z, rates.pitch, pitchRate)
  // Only while a roll to pull is being flown: in the direct range the push is the whole answer.
  if (!s.pushing) pitch = Math.max(pitch, -MathUtils.lerp(1, I.pullOnlyPush, MathUtils.smoothstep(offDeg, I.pullOnlyDeg[0], I.pullOnlyDeg[1]) * banked))
  const roll = fly(profile(rollError, brake.roll, I.gain.roll, rollRate), rates.roll, rollRate)
  const yaw = clamp1(rudder * fly(profile(yawError, brake.yaw, I.gain.yaw * tight, yawRate) - SPIN.y, rates.yaw, yawRate))
  // Each axis slews from the last command, so a goal that jumps (the wings rolling level as the
  // nose arrives, a push becoming a pull) eases the stick over instead of slamming it. Picked up
  // after a gap from what the jet is flying.
  const flown = s.flown, step = dt * MathUtils.lerp(I.slew, LEAD_TRACK.slew, s.tracking)
  if (!s.flying) { flown.pitch = clamp1(rates.pitch / pitchRate); flown.roll = clamp1(rates.roll / rollRate); flown.yaw = clamp1(rates.yaw / yawRate); s.flying = true }
  flown.pitch += MathUtils.clamp(pitch - flown.pitch, -step, step)
  flown.roll += MathUtils.clamp(roll - flown.roll, -step, step)
  flown.yaw += MathUtils.clamp(yaw - flown.yaw, -step, step)
  return flown
}
