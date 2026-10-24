import { MathUtils, Quaternion, Vector3, type Camera } from 'three'
import type { AircraftState, Vec3 } from '../state/WorldState'
import { observeAirflow } from '../flight/airflow'
import { getFlightProfile } from '../flight/profile'
import { WORLD_STEP } from '../runtime/clock'
import { drawnReticle, solveGun, type GunMount, type TargetMotion } from '../combat/gunSolution'

/*
Mouse aim, the third mouse mode (owner decision, 21 Oct 2026; replaces D05's "waits for a
playtest"). War Thunder's instructor and Battlefield 6's Simplified Jet Controls work this way.

The mouse does not hold a stick. It turns an aim direction in the world, drawn on the HUD as
a cursor, and the camera looks along it. An instructor flies the nose onto it: it rolls the
lift onto the aim and pulls, levels the wings and trims with the rudder once it is close.

Everything here is input. The instructor writes ordinary pitch/roll/yaw into the command,
once per command tick, so the simulation never knows the mouse is aiming and a replay
repeats the commands it made.

The PSM shot is not the instructor's. As incidence rises into post-stall the instructor
hands over to the relative stick (mouse up is nose up), the aim settles back onto the nose
and the camera, weighted by its own handover, ends on exactly the Phase 7 shot. A held
pitch, roll or yaw key takes the aircraft at once on all three axes: every Cobra, Kulbit
and pedal turn starts from a key, and an instructor levelling the wings over the top of
one would spoil it.
*/
export const MOUSE_AIM = {
  /** Aim travel per pixel of mouse motion, at sensitivity 1. */
  degreesPerPixel: 0.08,
  /** The aim never runs further than this from the nose: further is not a sharper turn. */
  maxOffNoseDeg: 120,
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
  /** Rudder trims the last few degrees: full below the first, gone by the second. */
  rudderDeg: [3, 10] as const,
  /** The roll plans for the pull the pitch profile asks, eased in up to this error so the bank
   * grows smoothly as the aim moves off the nose instead of jumping. */
  turnKneeDeg: 5,
  /** An aim on the belly side is reached by pushing or by rolling to pull, whichever is quicker.
   * A push is planned as if the nose went this much slower than a pull: negative g is a last
   * resort in a fighter, and a pull keeps the target in view over the canopy. */
  pushPace: 0.3,
  /** The other choice must be this many seconds quicker before the instructor switches; and a
   * roll already under way past this close to inverted from its goal keeps its direction. */
  switchSeconds: 0.25,
  reverseRad: 0.5,
  /** The pull waits for the roll: none while the canopy is further off its goal than the
   * first cosine (~60°), whole once inside the second (~18°). Gated only for an aim further off
   * than `alignedDeg`; close in, pitch trims at any bank. */
  alignedCos: [0.5, 0.95] as const,
  alignedDeg: [3, 10] as const,
  /** While rolling to pull, a push never asks more than this once the aim is far off. */
  pullOnlyPush: 0.2,
  pullOnlyDeg: [10, 30] as const,
  /** Incidence over which the instructor hands over to the stick: the post-stall band. Hard
   * turns with the limiter closed stay under alphaNormal (20°), so they keep it whole. */
  handoverDeg: [22, 35] as const,
  /** How fast (1/s) the aim settles onto the nose once the instructor has handed over, and
   * while a key flies. Settled, not snapped: the camera looks along the aim, and a snap would
   * whip the view across at the start of every Cobra. */
  settle: 6,
  keySettle: 10,
  /** Hands off (no key, no mouse) in post-stall for this long, in seconds, and the instructor
   * takes the jet back and recovers it: the first value starts it, by the second it is whole.
   * In attached flight hands off changes nothing; the aim stays where the hand left it. */
  handsOffSeconds: [0.6, 1.4] as const,
  /** The recovery flies the path's heading, wings level. Slow (below `recoverySpeed[0]`, m/s)
   * the nose goes down to the flight path — at least `recoveryDipDeg` below the horizon, at
   * most `recoveryDiveDeg` — to unload and gain speed; by `recoverySpeed[1]` it is level. */
  recoveryDipDeg: 20,
  recoveryDiveDeg: 60,
  recoverySpeed: [60, 110] as const,
}

/*
Screen-locked mouse aim ('cursor' mode, owner request 22 Oct 2026). The × roams the whole
window like the positional stick and stays where the hand leaves it, and it is where the gun
aims: the instructor flies so that the gun reticle — where rounds fired now will be, at its
range — lands under the ×. Put the × on the reticle and the jet flies straight; put it on a
target and the reticle goes there. Held off the reticle the jet keeps turning toward it (the
camera follows the nose, so the point under the × moves on); the further off, the harder.

The × is read through the camera as rendered (`cursorRay`): a ray from the lens through its
pixel. That is the only way the × and the drawn reticle can meet whatever the camera does —
its height above the nose line, its lag in a turn, its roll. The ray is kept relative to the
aircraft and the reticle solved per command tick, so between frames the jet's motion still
counts; the command depends on the last rendered frame, which a replay records anyway.
*/
export interface MouseAim {
  /** World direction the nose is flown to. */
  direction: Vector3
  /** False until the aim has been put on the nose (engage, reset, respawn). */
  synced: boolean
  /** Instructor share on the last command, 0..1; the HUD fades the cursor with it. */
  share: number
  /** Pushing to an aim on the belly side, belly toward it, instead of rolling to pull. */
  pushing: boolean
  /** The aim's own turn, world angular velocity in rad/s, smoothed; and where it was last tick. */
  rate: Vector3
  previous: Vector3
  /** Cursor mode: the gun solution's aim direction last tick, its smoothed turn (rad/s, world),
   * the tick and the target it was for (`trackLead`). */
  lead: Vector3
  leadRate: Vector3
  leadTick: number
  leadId: string | null
  /** How much the aim is on a target's lead this tick, 0..1 (`trackLead`): gunnery, so the
   * instructor flies it tighter. */
  tracking: number
  /** Close-in follow (`followTarget`): the locked target's acceleration, smoothed (world, m/s²),
   * the share it takes of the instructor's turn this tick (0..1), and the target and tick it was for. */
  follow: Vector3
  following: number
  followId: string | null
  followTick: number
  /** The instructor's last command and the tick it was for: each axis slews from it. */
  flown: { pitch: number; roll: number; yaw: number }
  flownTick: number
  /** Seconds since a key or the mouse last flew the jet. */
  handsOff: number
  /** Hands went off in post-stall: the instructor is recovering to level flight until a hand returns. */
  recovering: boolean
  tick: number
}
export const createMouseAim = (): MouseAim => ({ direction: new Vector3(1, 0, 0), synced: false, share: 0, pushing: false, rate: new Vector3(), previous: new Vector3(1, 0, 0), flown: { pitch: 0, roll: 0, yaw: 0 }, flownTick: -1, lead: new Vector3(1, 0, 0), leadRate: new Vector3(), leadTick: -1, leadId: null, tracking: 0, follow: new Vector3(), following: 0, followId: null, followTick: -1, handsOff: 0, recovering: false, tick: -1 })

export function unsyncAim(aim: MouseAim) { aim.synced = false; aim.share = 0; aim.pushing = false; aim.flownTick = -1; aim.leadTick = -1; aim.leadId = null; aim.leadRate.set(0, 0, 0); aim.tracking = 0; aim.follow.set(0, 0, 0); aim.following = 0; aim.followId = null; aim.followTick = -1; aim.rate.set(0, 0, 0); aim.handsOff = 0; aim.recovering = false; aim.tick = -1; return aim }

const PATH = new Vector3(), SETTLE_TO = new Vector3()
const NOSE = new Vector3(), BODY = new Vector3(), AXIS = new Vector3(), TURN = new Vector3(), LIFT = new Vector3(), SPIN = new Vector3()
const ORIENT = new Quaternion(), INVERSE = new Quaternion()
const noseOf = (state: Pick<AircraftState, 'orientation'>, out = NOSE) => out.set(1, 0, 0).applyQuaternion(ORIENT.copy(state.orientation as Quaternion))

/** `from` turned toward `to` by `share` of the angle between them (in place). */
function turnToward(from: Vector3, to: Vector3, share: number) {
  const angle = from.angleTo(to)
  if (share <= 0 || angle < 1e-9) return from
  if (share >= 1) return from.copy(to)
  AXIS.crossVectors(from, to)
  if (AXIS.lengthSq() < 1e-12) return from
  return from.applyAxisAngle(AXIS.normalize(), angle * share).normalize()
}

/** Mouse motion turns the aim about the view's own axes: right is right and up is up on screen. */
export function turnAim(aim: MouseAim, dx: number, dy: number, viewRight: Vec3, viewUp: Vec3) {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return aim
  const k = MathUtils.degToRad(MOUSE_AIM.degreesPerPixel)
  if (dx) aim.direction.applyAxisAngle(AXIS.set(viewUp.x, viewUp.y, viewUp.z).normalize(), -dx * k)
  if (dy) aim.direction.applyAxisAngle(AXIS.set(viewRight.x, viewRight.y, viewRight.z).normalize(), -dy * k)
  aim.direction.normalize()
  return aim
}

/** The instructor's share from the aircraft's state alone: whole in attached flight, gone in
 * post-stall, and gone where incidence cannot be read (the top of a tail slide). */
export function instructorShare(state: AircraftState) {
  const airflow = observeAirflow(state, getFlightProfile(state.aircraftId))
  return (1 - MathUtils.smoothstep(airflow.incidenceDeg, MOUSE_AIM.handoverDeg[0], MOUSE_AIM.handoverDeg[1])) * airflow.confidence
}
const airflowOf = (state: AircraftState) => observeAirflow(state, getFlightProfile(state.aircraftId))

/*
One command tick of the aim.

- Lost (engage, reset, respawn): put on the nose.
- The instructor's share: whole in attached flight, handed to the stick through post-stall,
  none while a key flies; and back again, whatever the incidence, once the hands have been off
  in post-stall for a moment — then it recovers the jet to level flight and holds it there
  until a hand returns.
- Settled as the instructor hands over: toward the nose in attached flight, toward the flight
  path in post-stall, onto the recovery's level heading while recovering, and quickly while a
  key flies so a released key leaves the jet about where the key put it.
- Kept within reach of the nose, and its own turn measured for the instructor's feedforward.
*/
export function stepAim(aim: MouseAim, state: AircraftState, tick: number, keyHeld: boolean, handsOn = keyHeld) {
  const nose = noseOf(state)
  const ticks = aim.tick < 0 || tick < aim.tick ? 0 : tick - aim.tick
  const seconds = ticks * WORLD_STEP
  aim.tick = tick
  const attached = instructorShare(state), airflow = airflowOf(state)
  aim.handsOff = handsOn ? 0 : aim.handsOff + seconds
  if (handsOn) aim.recovering = false
  else if (aim.handsOff >= MOUSE_AIM.handsOffSeconds[0] && attached < 0.5) aim.recovering = true
  // Not weighted by the airflow's confidence: the recovery flies a body-frame error to a level
  // heading, which means the same at 5 m/s, and a flat deep stall at 5 m/s is what it is for.
  const recovery = aim.recovering ? MathUtils.smoothstep(aim.handsOff, MOUSE_AIM.handsOffSeconds[0], MOUSE_AIM.handsOffSeconds[1]) : 0
  aim.share = keyHeld ? 0 : Math.max(attached, recovery)
  if (!aim.synced) {
    aim.direction.copy(nose); aim.previous.copy(nose); aim.rate.set(0, 0, 0)
    aim.synced = true; aim.pushing = false
    return aim
  }
  // The aim's own turn is what the hand (or the assist) did since the last tick, measured
  // before the settle and the reach limit move it: those follow the jet, and fed forward they
  // would keep the nose turning after a key is released.
  if (ticks > 0) {
    const angle = aim.previous.angleTo(aim.direction)
    TURN.crossVectors(aim.previous, aim.direction)
    if (keyHeld || TURN.lengthSq() <= 1e-16) TURN.set(0, 0, 0)
    else TURN.normalize().multiplyScalar(angle / seconds)
    aim.rate.lerp(TURN, 1 - Math.exp(-seconds / MOUSE_AIM.rateSeconds))
  }
  const v = state.velocity
  SETTLE_TO.copy(nose)
  if (airflow.airspeed > 1e-6) PATH.set(v.x, v.y, v.z).normalize()
  else PATH.copy(nose)
  if (aim.recovering) {
    // The path's heading (the nose's where the path runs vertical); down the path while slow.
    const heading = Math.hypot(PATH.x, PATH.z) > 0.2 ? PATH : nose
    const slow = 1 - MathUtils.smoothstep(airflow.airspeed, MOUSE_AIM.recoverySpeed[0], MOUSE_AIM.recoverySpeed[1])
    const pathDip = -Math.asin(MathUtils.clamp(PATH.y, -1, 1))
    const dip = slow * MathUtils.clamp(pathDip, MathUtils.degToRad(MOUSE_AIM.recoveryDipDeg), MathUtils.degToRad(MOUSE_AIM.recoveryDiveDeg))
    const across = Math.hypot(heading.x, heading.z)
    if (across > 1e-6) SETTLE_TO.set(heading.x / across * Math.cos(dip), -Math.sin(dip), heading.z / across * Math.cos(dip))
  } else turnToward(SETTLE_TO, PATH, (1 - attached) * airflow.confidence)
  const settle = keyHeld ? MOUSE_AIM.keySettle : aim.recovering ? MOUSE_AIM.settle : MOUSE_AIM.settle * (1 - attached)
  turnToward(aim.direction, SETTLE_TO, 1 - Math.exp(-seconds * settle))
  const off = aim.direction.angleTo(nose), limit = MathUtils.degToRad(MOUSE_AIM.maxOffNoseDeg)
  if (off > limit) turnToward(aim.direction, nose, 1 - limit / off)
  aim.previous.copy(aim.direction)
  return aim
}

const RAY = new Vector3(), GOAL = new Vector3(), HIT = new Vector3(), SWING = new Quaternion()

/** A ray from the lens through the ×: its origin relative to the aircraft, and its direction. */
export interface CursorRay { offset: Vec3; direction: Vec3 }

/** The ray through pixel (`px`, `py`) from the middle of a `width`×`height` frame, for a
 * rendered `camera` (world matrix current) following an aircraft at `aircraft`. */
export function cursorRay(camera: Camera, px: number, py: number, width: number, height: number, aircraft: Vec3): CursorRay {
  const eye = new Vector3().setFromMatrixPosition(camera.matrixWorld)
  const direction = new Vector3(px / (width / 2), -py / (height / 2), 0.5).unproject(camera).sub(eye).normalize()
  return { offset: { x: eye.x - aircraft.x, y: eye.y - aircraft.y, z: eye.z - aircraft.z }, direction: { x: direction.x, y: direction.y, z: direction.z } }
}

/** A world point (the lead marker, the target) in pixels from the middle of a `width`×`height`
 * frame, and its angle in degrees from the × at `cursor` through the lens; null when it is
 * behind the camera. For cursor mode's aim assist (FlightInput.drawCursor). */
export function markOnScreen(camera: Camera, lead: Vec3, cursor: { px: number; py: number }, width: number, height: number) {
  const eye = new Vector3().setFromMatrixPosition(camera.matrixWorld)
  const at = new Vector3(lead.x, lead.y, lead.z).project(camera)
  if (at.z > 1) return null
  const ray = new Vector3(cursor.px / (width / 2), -cursor.py / (height / 2), 0.5).unproject(camera).sub(eye)
  const errorDeg = MathUtils.radToDeg(ray.angleTo(new Vector3(lead.x, lead.y, lead.z).sub(eye)))
  return { point: { x: at.x * width / 2, y: -at.y * height / 2 }, errorDeg }
}

/*
Cursor mode with a ray: the nose that puts the gun reticle under the ×. The point under the ×
is taken at the reticle's own range from the aircraft (so the lens's offset from the nose
costs nothing there), and the nose is turned by whatever turns the reticle onto it. The reticle
is the one the HUD draws (`drawnReticle`): at the target's range while there is a solution, so
the × on the lead marker puts the drawn reticle on it too, bullet drop included.
*/
export function aimAtRay(aim: MouseAim, state: AircraftState, ray: CursorRay, mount: GunMount, target?: TargetMotion | null) {
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
  aim.direction.copy(noseOf(state)).applyQuaternion(SWING).normalize()
  aim.previous.copy(aim.direction)
  return aim
}

/*
Cursor mode tracking a moving target. The aim is read off the × every tick, so it has no turn of
its own to feed forward, and a × kept on a crossing target's lead left the nose trailing it by
the whole turn the instructor needed an error for: 6–9° at 600 m, never on the lead, never red
(user report 23 Oct 2026). The lead's own turn is the turn wanted, and it is the jet's to match:
the solution's aim direction depends on where the two aircraft are and how they move, not on
where the nose points, so feeding it forward cannot chase itself. Only while the × is on or
near the lead (`leadDeg`); a × held anywhere else keeps the plain behaviour, turning toward it.
*/
export const LEAD_TRACK = {
  /** Fed forward whole while the aim is within the first of the lead, none past the second. */
  leadDeg: [3, 8] as const,
  /** Seconds the lead's turn rate is smoothed over. */
  rateSeconds: 0.1,
  /** A lead that jumps further than this in one tick (a new target, a respawn) starts over. */
  jumpRad: 0.05,
  /** On the lead, pitch and yaw answer this much harder and every command slews this fast: the
   * last fraction of a degree is the difference between amber and red. */
  gainScale: 1.6,
  slew: 12,
}
const LEAD = new Vector3(), LEAD_NOSE = new Vector3(), LEAD_TURN = new Vector3(), WING = new Vector3()
/** Once per command tick, after `stepAim`: sets the aim's turn to the lead's while the aim is on it. */
export function trackLead(aim: MouseAim, state: AircraftState, target: (TargetMotion & { id: string }) | null, mount: GunMount, tick: number) {
  const solution = target ? solveGun(state, mount, target) : null
  if (!solution || !target) { aim.leadTick = -1; aim.leadId = null; aim.leadRate.set(0, 0, 0); aim.tracking = 0; return aim }
  LEAD.set(solution.aim.x, solution.aim.y, solution.aim.z).normalize()
  const ticks = aim.leadTick < 0 || tick < aim.leadTick ? 0 : tick - aim.leadTick
  if (aim.leadId !== target.id || ticks === 0 || aim.lead.angleTo(LEAD) > LEAD_TRACK.jumpRad * Math.max(ticks, 1)) aim.leadRate.set(0, 0, 0)
  else {
    const seconds = ticks * WORLD_STEP, angle = aim.lead.angleTo(LEAD)
    LEAD_TURN.crossVectors(aim.lead, LEAD)
    if (LEAD_TURN.lengthSq() > 1e-16) LEAD_TURN.normalize().multiplyScalar(angle / seconds)
    else LEAD_TURN.set(0, 0, 0)
    aim.leadRate.lerp(LEAD_TURN, 1 - Math.exp(-seconds / LEAD_TRACK.rateSeconds))
  }
  aim.lead.copy(LEAD); aim.leadTick = tick; aim.leadId = target.id
  // Where the nose goes for the gun line to lie on the solution: the gun line sits above the nose.
  WING.set(0, 0, 1).applyQuaternion(ORIENT.copy(state.orientation as Quaternion))
  LEAD_NOSE.copy(LEAD).applyAxisAngle(WING, -MathUtils.degToRad(mount.elevationDeg))
  const near = 1 - MathUtils.smoothstep(MathUtils.radToDeg(aim.direction.angleTo(LEAD_NOSE)), LEAD_TRACK.leadDeg[0], LEAD_TRACK.leadDeg[1])
  aim.rate.copy(aim.leadRate).multiplyScalar(near)
  aim.tracking = near
  return aim
}

/*
Close-in follow (user request 25 Oct 2026: "fly smoothly along the locked target's path up close").
Close behind a target the line of sight and the lead swing several degrees with every move it
makes. The aim follows them, the instructor feeds the aim's turn into the bank, and the jet rolls
from side to side behind it. To fly the target's path is to pull what it pulls, in the plane it
pulls in: so once the target is close and the aim is on it, the instructor's turn comes from the
target's own acceleration, smoothed, instead of from the aim's turn. The aim still corrects the
nose (pitch, rudder and the small pull toward it); only the turn being fed forward changes.
*/
export const FOLLOW = {
  /** Metres to the target: whole inside the first, gone past the second. */
  range: [300, 600] as const,
  /** Degrees from the aim to the target or its lead, whichever is nearer: whole inside the first, gone past the second. */
  onDeg: [8, 15] as const,
  /** Seconds the target's acceleration is smoothed over: its bank changes are not steps for us. */
  smoothSeconds: 0.3,
  /** While following, the pull toward the aim keeps only this share in the bank (pitch still
   * takes all of it), and the rudder trims out to these degrees: the aim is corrected inside the
   * target's plane instead of by rolling toward it. */
  turnShare: 0.2,
  rudderDeg: [8, 20] as const,
}
const FOLLOW_TO = new Vector3(), FOLLOW_ACCEL = new Vector3()
/** Once per command tick, after `stepAim`: how much the instructor turns with `target` this tick. */
export function followTarget(aim: MouseAim, state: AircraftState, target: (TargetMotion & { id: string }) | null, mount: GunMount, tick: number) {
  if (!target) { aim.following = 0; aim.followId = null; aim.followTick = -1; return aim }
  const ticks = aim.followTick < 0 || tick < aim.followTick ? 0 : tick - aim.followTick
  FOLLOW_ACCEL.set(target.acceleration.x, target.acceleration.y, target.acceleration.z)
  if (aim.followId !== target.id || ticks === 0) aim.follow.copy(FOLLOW_ACCEL)
  else aim.follow.lerp(FOLLOW_ACCEL, 1 - Math.exp(-ticks * WORLD_STEP / FOLLOW.smoothSeconds))
  aim.followId = target.id; aim.followTick = tick
  const p = state.position
  FOLLOW_TO.set(target.position.x - p.x, target.position.y - p.y, target.position.z - p.z)
  const range = FOLLOW_TO.length()
  let offDeg = MathUtils.radToDeg(aim.direction.angleTo(FOLLOW_TO))
  const solution = solveGun(state, mount, target)
  if (solution) offDeg = Math.min(offDeg, MathUtils.radToDeg(aim.direction.angleTo(LEAD.set(solution.aim.x, solution.aim.y, solution.aim.z))))
  aim.following = (1 - MathUtils.smoothstep(range, FOLLOW.range[0], FOLLOW.range[1])) * (1 - MathUtils.smoothstep(offDeg, FOLLOW.onDeg[0], FOLLOW.onDeg[1]))
  return aim
}

/*
Cursor mode before the first rendered frame (and in tests without a camera): the × read as a
direction through a lens of `fovDeg` vertical field of view centred on the nose. `screenAngle`
is how far the airframe appears rotated on screen (ScreenFrame angle × blend).
*/
export function aimAtCursor(aim: MouseAim, state: AircraftState, px: number, py: number, height: number, fovDeg: number, screenAngle: number) {
  const focal = height / 2 / Math.tan(MathUtils.degToRad(fovDeg) / 2)
  const x = px, y = -py, cos = Math.cos(screenAngle), sin = Math.sin(screenAngle)
  // Screen right and up into the airframe's wing (+Z) and canopy (+Y), then a pinhole ray.
  RAY.set(focal, x * sin + y * cos, x * cos - y * sin).normalize()
  aim.direction.copy(RAY).applyQuaternion(ORIENT.copy(state.orientation as Quaternion)).normalize()
  aim.previous.copy(aim.direction)
  return aim
}

const wrap = (angle: number) => angle - 2 * Math.PI * Math.round(angle / (2 * Math.PI))
const clamp1 = (value: number) => Math.max(-1, Math.min(1, value))

/*
The instructor: pitch, roll and yaw (−1..1) that fly the nose onto the aim as fast as the jet
can without overshooting it.

Errors are read in the body frame (+X nose, +Y canopy, +Z right wing), so they mean the same
at any attitude, inverted and vertical included.

- Roll puts the lift where the path needs it: toward the aim (growing smoothly with how far off
  it is), plus what turns the path with the aim's own motion, plus what holds it up against
  gravity. Far off the first term wins and the canopy goes toward the aim: positive g, the way
  a fighter turns. At the last few degrees gravity wins, so a still aim levels the wings and a
  twitch of the hand does not bank the jet; a held turn keeps its height.
- An aim on the belly side is pushed to instead when that is quicker (`pushPace`), with the
  belly put toward it.
- The pull waits for the roll: pulling with the canopy well off the aim only swings the nose
  out of the plane the roll is heading for.
- Each axis flies `profile`: the rate that would stop exactly on the error at an easy brake,
  so the nose and the wings arrive and stop instead of easing in late or ringing; and every
  command slews, so a goal that jumps never slams the stick.
*/
const GRAVITY = 9.81
/** The pitch rate the jet can hold with the limiter closed (rad/s), as the controller budgets
 * it: the profile's rate, or the turn its airspeed allows, whichever is less. */
function pullCeiling(state: AircraftState) {
  const profile = getFlightProfile(state.aircraftId), flow = airflowOf(state)
  const authority = Math.min(flow.airspeed / profile.aero.referenceSpeedMps, 1) * MathUtils.clamp(profile.aero.highSpeedMps / Math.max(flow.airspeed, 1), 0.6, 1)
  const budget = profile.flight.turnAcceleration * authority * Math.min(1, flow.dynamicPressure) / Math.max(flow.airspeed, 1) * profile.flight.turnRateReserve
  return Math.max(0.1, Math.min(profile.flight.pitchRate * authority, budget))
}
/** The rate (rad/s, signed) that brakes to rest exactly at `error`: linear near zero, the
 * stopping-distance curve further out, never more than `max`. */
function profile(error: number, brake: number, gain: number, max: number) {
  const knee = brake / gain
  return Math.sign(error) * Math.min(max, Math.sqrt(knee * knee + 2 * brake * Math.abs(error)) - knee)
}
export function instruct(aim: MouseAim, state: AircraftState) {
  const flight = getFlightProfile(state.aircraftId).flight
  ORIENT.copy(state.orientation as Quaternion)
  BODY.copy(aim.direction).applyQuaternion(INVERSE.copy(ORIENT).invert())
  const off = Math.acos(Math.max(-1, Math.min(1, BODY.x)))
  const offDeg = MathUtils.radToDeg(off)

  // The lift wanted, in the world: toward the aim, turning with it, and against gravity.
  const velocity = state.velocity, speed = Math.hypot(velocity.x, velocity.y, velocity.z)
  const nose = noseOf(state)
  TURN.copy(aim.direction).addScaledVector(nose, -aim.direction.dot(nose))
  // How hard toward the aim: the pull the pitch profile below will ask for (its rate × speed),
  // eased in over the first few degrees so a twitch of the hand barely banks the jet. Read off
  // the error alone, not off what the jet is pulling now: that would feed the bank back into
  // itself. Banked for that and gravity together, a held turn neither sinks nor climbs.
  const pullRate = profile(off, MOUSE_AIM.brake.pitch, MOUSE_AIM.gain.pitch, pullCeiling(state))
  if (TURN.lengthSq() > 1e-12) TURN.normalize().multiplyScalar(pullRate * Math.max(speed, 30) * Math.min(1, offDeg / MOUSE_AIM.turnKneeDeg))
  // The turn fed forward: the aim's own, or close behind a target, the target's (`followTarget`).
  LIFT.copy(aim.rate).cross(SPIN.set(velocity.x, velocity.y, velocity.z))
  if (aim.following > 0) { LIFT.lerp(aim.follow, aim.following); TURN.multiplyScalar(MathUtils.lerp(1, FOLLOW.turnShare, aim.following)) }
  LIFT.add(SPIN.set(0, GRAVITY, 0))
  const holding = LIFT.length()
  LIFT.add(TURN)
  const liftUp = LIFT.y
  LIFT.applyQuaternion(INVERSE)
  const across = Math.hypot(LIFT.y, LIFT.z)
  const pull = Math.atan2(LIFT.z, LIFT.y)
  // Push or pull, both along the same lift: canopy toward it and pull, or belly toward it and
  // push, whichever is quicker: the roll each needs plus the time to turn the nose, pushes paced
  // slower (a recovery takes the shortest way: slow and stalled, there is no pull to keep).
  // Only while the pull toward the aim is what the lift is mostly for, or the lift points down
  // (an aim a little under the nose: pushed to, wings level), or recovering. Under gravity alone
  // the canopy always goes up, never a held -1 g.
  const push = wrap(pull - Math.PI)
  const rollRate = flight.rollRate
  if (!aim.recovering && TURN.length() < 2 * holding && liftUp > 0) aim.pushing = false
  else {
    const pace = aim.recovering ? 1 : MOUSE_AIM.pushPace, margin = aim.recovering ? 0 : MOUSE_AIM.switchSeconds
    // A roll under way the other way first has to stop and come back.
    const rollTime = (to: number) => Math.abs(to) / rollRate + (to * state.rates.roll < 0 ? 2 * Math.abs(state.rates.roll) / MOUSE_AIM.brake.roll : 0)
    const pullTime = rollTime(pull) + off / flight.pitchRate
    const pushTime = rollTime(push) + off / (flight.pitchRate * pace)
    if (aim.pushing ? pullTime < pushTime - margin : pushTime < pullTime - margin) aim.pushing = !aim.pushing
  }
  // Lift along the nose (a vertical climb under a still aim) has no side to roll to: hold.
  let rollError = (aim.pushing ? push : pull) * MathUtils.smoothstep(across, 0.5, 2)
  // Nearly inverted from the goal, keep rolling the way the jet already rolls: the goal wobbling
  // across ±180° must not reverse a roll that is half done.
  if (Math.abs(rollError) > Math.PI - MOUSE_AIM.reverseRad && rollError * state.rates.roll < 0 && Math.abs(state.rates.roll) > 0.2) rollError -= Math.sign(rollError) * 2 * Math.PI

  // The aim's turn in the body frame: about +Z is pitch up, about −Y is yaw right.
  SPIN.copy(aim.rate).applyQuaternion(INVERSE)
  const pitchError = Math.atan2(BODY.y, BODY.x), yawError = Math.atan2(BODY.z, BODY.x)
  const rudderDeg = [MathUtils.lerp(MOUSE_AIM.rudderDeg[0], FOLLOW.rudderDeg[0], aim.following), MathUtils.lerp(MOUSE_AIM.rudderDeg[1], FOLLOW.rudderDeg[1], aim.following)]
  const rudder = 1 - MathUtils.smoothstep(offDeg, rudderDeg[0], rudderDeg[1])
  const { brake, track } = MOUSE_AIM, rates = state.rates
  const tight = 1 + aim.tracking * (LEAD_TRACK.gainScale - 1)
  const gain = { pitch: MOUSE_AIM.gain.pitch * tight, roll: MOUSE_AIM.gain.roll, yaw: MOUSE_AIM.gain.yaw * tight }
  const fly = (wanted: number, rate: number, full: number) => clamp1((wanted + track * (wanted - rate)) / full)
  // Pull only as hard as the lift is already on its way: pulling with the canopy still well off
  // the aim swings the nose out of the plane the roll is aiming for, and the roll overshoots.
  // Close in, pitch trims whatever the bank.
  const aligned = MathUtils.lerp(1, MathUtils.smoothstep(Math.cos(rollError), MOUSE_AIM.alignedCos[0], MOUSE_AIM.alignedCos[1]), MathUtils.smoothstep(offDeg, MOUSE_AIM.alignedDeg[0], MOUSE_AIM.alignedDeg[1]))
  let pitch = fly(aligned * profile(pitchError, brake.pitch, gain.pitch, flight.pitchRate) + SPIN.z, rates.pitch, flight.pitchRate)
  if (!aim.pushing && !aim.recovering) pitch = Math.max(pitch, -MathUtils.lerp(1, MOUSE_AIM.pullOnlyPush, MathUtils.smoothstep(offDeg, MOUSE_AIM.pullOnlyDeg[0], MOUSE_AIM.pullOnlyDeg[1])))
  const roll = fly(profile(rollError, brake.roll, gain.roll, rollRate), rates.roll, rollRate)
  const yaw = clamp1(rudder * fly(profile(yawError, brake.yaw, gain.yaw, flight.yawRate) - SPIN.y, rates.yaw, flight.yawRate))
  // Each axis slews from the last command, so a goal that jumps (the wings rolling level as the
  // nose arrives, a push becoming a pull) eases the stick over instead of slamming it. Picked up
  // after a gap (a key, the stick in post-stall) from what the jet is flying.
  const flown = aim.flown, step = WORLD_STEP * MathUtils.lerp(MOUSE_AIM.slew, LEAD_TRACK.slew, aim.tracking)
  if (aim.flownTick < 0 || aim.tick < aim.flownTick || aim.tick > aim.flownTick + 1) {
    flown.pitch = clamp1(rates.pitch / flight.pitchRate); flown.roll = clamp1(rates.roll / rollRate); flown.yaw = clamp1(rates.yaw / flight.yawRate)
  }
  if (aim.tick !== aim.flownTick) {
    flown.pitch += MathUtils.clamp(pitch - flown.pitch, -step, step)
    flown.roll += MathUtils.clamp(roll - flown.roll, -step, step)
    flown.yaw += MathUtils.clamp(yaw - flown.yaw, -step, step)
    aim.flownTick = aim.tick
  }
  return { pitch: flown.pitch, roll: flown.roll, yaw: flown.yaw }
}
