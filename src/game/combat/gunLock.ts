import { Quaternion, Vector3 } from 'three'
import type { AircraftState } from '../state/WorldState'
import { GUN_TRACK } from '../arcadeCore/config'
import { solveGun, type GunMount } from './gunSolution'
import { assistRange, type AimAssistLevel } from './aimAssist'

/*
Gun lock: mouse aim's aim assist (owner design, 2026-11-16). It replaces the aim magnet
(aimAssist.ts `aimMagnet`) under mouse aim.

- Charge. Holding the cursor on the selected target, or on its lead, within `captureDeg` fills
  a ring around the cursor over `dwellSeconds` (1 s standard, 0.7 s strong). Off it the ring
  drains at `drainRate` of a full ring a second rather than emptying at once. While it fills the
  cursor is drawn gently toward the lead and carried along with it, more as the ring fills
  (`chargePull`, `chargeCarry`), so it stays on a crossing target; the hand still outweighs it.
- Lock. A full ring locks: the cursor moves onto the lead (where the nose must point for the
  rounds to meet the target) and rides on it. It eases over: from rest, up to speed, to rest on
  the lead (`settle*`), carried along with the lead meanwhile, so neither the cursor nor the Aim
  lock view (which looks along the cursor) jumps. Once there it moves exactly as the lead moves.
- Magnet (arcade core). The nose is drawn onto the lead too: `trackGoal`, once per simulation
  tick on the live state, gives the direction sent as PilotCommand.gunTrack (arcadeCore/step.ts).
  The magnet closes a share of the angle each step, so on its own it trails a moving lead by
  (lead's turn rate) / GUN_TRACK.rate: 3 to 5 degrees on a crossing target, a clean miss. So
  the goal sent is the lead turned ahead by its own measured rate over that lag, which holds the
  nose on a crossing target. The pull fades in over `engageSeconds`. The stick stays out of it
  (no bank-to-turn rolling the jet about), and the chase camera looks at the lead with its
  horizon level (ArcadeChase `gunLock`). Other cores have no magnet: there the aim controller
  flies the nose to the cursor.
- Break. Dragging the cursor off the lead lets go. While locked the hand still moves the cursor,
  as an offset from the lead that springs back at `holdRate`; past `breakDeg` the lock goes and
  the cursor stays where the hand put it, and the ring waits `relockSeconds` before it charges
  again. A small nudge springs back. Pitch and yaw keys drag
  the aim with the nose (ControlMixer), so flying off the target on the keys lets go the same
  way. The lock also goes when the target dies or changes, leaves gun reach
  (`assistRange.far[1]` plus `rangeSlack`), or the lead swings more than `breakOffNoseDeg` off
  the nose.

Only the selected target is charged on, and only within gun reach and ahead. The lock moves
the aim, never the rounds: rounds never steer and hitboxes never grow (doc 07).

The cursor runs once per rendered frame on the interpolated poses, like the hand on the mouse.
The aim is input, not the record: replays keep the commands the aim produced.
*/
export const gunLockTuning = {
  /** Seconds the cursor must stay on the target to lock, by aim assist level. */
  dwellSeconds: { standard: 1, strong: 0.7 } as Record<Exclude<AimAssistLevel, 'off'>, number>,
  /** Degrees from the target or its lead that count as on it. */
  captureDeg: 4,
  /** While the ring fills: how fast the cursor closes on the lead (1/s) and the share of the lead's own motion it is
   * carried with, both at a full ring and in proportion to the fill below it. */
  chargePull: 2.5,
  chargeCarry: 0.8,
  /** Full rings a second the charge drains while off the target. */
  drainRate: 1,
  /** The locked cursor's glide onto the lead: its average speed (deg/s) sets the time, kept within these seconds. */
  settleDegPerSecond: 30,
  settleSeconds: [0.4, 0.9] as readonly [number, number],
  /** Degrees the hand must hold the cursor off the lead to let go, and how fast that offset springs back (1/s).
   * A steady drag lets go above breakDeg × holdRate degrees a second. */
  breakDeg: 3,
  holdRate: 4,
  /** Seconds after the hand lets go of a lock before the ring charges again. */
  relockSeconds: 1,
  /** Seconds the magnet's pull takes to come in after the lock. */
  engageSeconds: 0.5,
  /** Seconds the measured turn rate of the lead is smoothed over. */
  rateSeconds: 0.05,
  /** Metres past gun reach before a held lock lets go. */
  rangeSlack: 100,
  /** Degrees between the lead and the nose past which a held lock lets go. */
  breakOffNoseDeg: 60,
} as const

export interface GunLockState {
  /** The target being charged on or locked, or null. */
  targetId: string | null
  /** Ring fill 0..1. */
  progress: number
  locked: boolean
  /** Locked cursor (per frame): where it is without the hand, the hand's offset, the aim as last
   * left, the lead a frame ago, and the glide's clock and length (seconds). */
  auto: Vector3; pull: Vector3; last: Vector3; lead: Vector3
  settle: number; settleFor: number
  /** `lead` is last frame's (the ring was filling then). */
  charging: boolean
  /** Magnet (per tick): the lead a tick ago (null on the first), its turn rate (rad/s, world
   * axis), and seconds since the lock. */
  tracked: Vector3 | null; rate: Vector3
  engaged: number
  /** Seconds left before the ring may charge again, after the hand let go of a lock. */
  wait: number
}

export const createGunLock = (): GunLockState => ({ targetId: null, progress: 0, locked: false,
  auto: new Vector3(), pull: new Vector3(), last: new Vector3(), lead: new Vector3(), settle: 0, settleFor: 0, charging: false,
  tracked: null, rate: new Vector3(), engaged: 0, wait: 0 })
export function releaseGunLock(lock: GunLockState) { lock.targetId = null; lock.progress = 0; lock.locked = false; lock.charging = false; lock.tracked = null; lock.rate.set(0, 0, 0); lock.engaged = 0 }

export interface GunLockFrame {
  level: AimAssistLevel
  shooter: AircraftState
  target: AircraftState | null
  mount: GunMount
  /** The mouse aim direction (world, unit); turned in place while locked. */
  aim: Vector3
  /** Seconds since the last frame. */
  dt: number
}

const turn = new Quaternion(), spin4 = new Quaternion(), wing = new Vector3(), lead = new Vector3(), toTarget = new Vector3(), nose = new Vector3(), axis = new Vector3(), moved = new Vector3()
const DEG = Math.PI / 180
const ease = (x: number) => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x)

/** Where the nose must point for the rounds to meet the target, into `out` (world, unit), and the
 * solution. The gun line sits elevationDeg above the nose, so the nose goes that far below it. */
function noseLead(shooter: AircraftState, target: AircraftState, mount: GunMount, out: Vector3) {
  const solution = solveGun(shooter, mount, target)
  if (!solution) return null
  turn.set(shooter.orientation.x, shooter.orientation.y, shooter.orientation.z, shooter.orientation.w)
  wing.set(0, 0, 1).applyQuaternion(turn)
  out.set(solution.aim.x, solution.aim.y, solution.aim.z).normalize().applyAxisAngle(wing, -mount.elevationDeg * DEG)
  nose.set(1, 0, 0).applyQuaternion(turn)
  return solution
}

/** Steps the lock one frame. Returns the state for the HUD; while locked the aim is moved onto the lead. */
export function stepGunLock(lock: GunLockState, frame: GunLockFrame): GunLockState {
  const { level, shooter, target, mount, aim, dt } = frame
  const T = gunLockTuning
  if (level === 'off' || !shooter.alive || !target?.alive) { releaseGunLock(lock); return lock }
  if (!(dt > 0)) return lock
  if (lock.targetId !== target.id) { releaseGunLock(lock); lock.targetId = target.id; lock.wait = 0 }
  lock.wait = Math.max(0, lock.wait - dt)

  const solution = noseLead(shooter, target, mount, lead)
  const reach = assistRange.far[1] + (lock.locked ? T.rangeSlack : 0)
  if (!solution?.reachable || solution.range > reach) { drain(lock, dt); return lock }

  if (lock.locked) {
    // The hand (or the keys, through the mixer) moved the aim since the last frame: an offset that springs back.
    lock.pull.multiplyScalar(Math.exp(-T.holdRate * dt)).add(moved.subVectors(aim, lock.last))
    if (lock.pull.length() > T.breakDeg * DEG || lead.angleTo(nose) > T.breakOffNoseDeg * DEG) { releaseGunLock(lock); lock.targetId = target.id; lock.wait = T.relockSeconds; return lock }
    // Carried with the lead, then the glide closes what is left of the gap.
    lock.auto.applyQuaternion(turn.setFromUnitVectors(lock.lead, lead))
    const before = ease(lock.settle / lock.settleFor)
    lock.settle += dt
    const after = ease(lock.settle / lock.settleFor)
    if (after >= 1) lock.auto.copy(lead)
    else {
      const gap = lock.auto.angleTo(lead)
      axis.crossVectors(lock.auto, lead)
      if (gap > 1e-7 && axis.lengthSq() > 1e-14) lock.auto.applyAxisAngle(axis.normalize(), gap * (1 - (1 - after) / (1 - before))).normalize()
    }
    aim.copy(lock.auto).add(lock.pull).normalize()
    lock.last.copy(aim); lock.lead.copy(lead)
    return lock
  }

  toTarget.set(target.position.x - shooter.position.x, target.position.y - shooter.position.y, target.position.z - shooter.position.z).normalize()
  const ahead = toTarget.dot(nose) > 0
  const off = Math.min(aim.angleTo(toTarget), aim.angleTo(lead)) / DEG
  if (ahead && off <= T.captureDeg && lock.wait <= 0) {
    // The gentle pull: carried with the lead, then a share of the gap closed.
    if (lock.charging) aim.applyQuaternion(turn.identity().slerp(spin4.setFromUnitVectors(lock.lead, lead), T.chargeCarry * lock.progress))
    const gap = aim.angleTo(lead)
    axis.crossVectors(aim, lead)
    if (gap > 1e-7 && axis.lengthSq() > 1e-14) aim.applyAxisAngle(axis.normalize(), gap * (1 - Math.exp(-T.chargePull * lock.progress * dt)))
    aim.normalize()
    lock.charging = true; lock.lead.copy(lead)
    lock.progress = Math.min(1, lock.progress + dt / T.dwellSeconds[level])
    if (lock.progress >= 1) {
      lock.locked = true; lock.tracked = null; lock.rate.set(0, 0, 0); lock.engaged = 0
      lock.auto.copy(aim); lock.last.copy(aim); lock.lead.copy(lead); lock.pull.set(0, 0, 0)
      lock.settle = 0
      lock.settleFor = Math.min(T.settleSeconds[1], Math.max(T.settleSeconds[0], aim.angleTo(lead) / DEG / T.settleDegPerSecond))
    }
  } else drain(lock, dt)
  return lock
}

function drain(lock: GunLockState, dt: number) {
  lock.locked = false; lock.charging = false; lock.tracked = null; lock.engaged = 0
  lock.progress = Math.max(0, lock.progress - dt * gunLockTuning.drainRate)
}

const goal = new Vector3(), spin = new Vector3()
/**
 * The magnet's goal for one simulation tick of `dt` seconds, on the live state: the direction
 * to send as PilotCommand.gunTrack, or null with no solution. Call once per tick while locked.
 *
 * The lead, turned ahead by its measured turn rate over the magnet's lag (1 / GUN_TRACK.rate,
 * plus half the tick the command is flown over), then blended in from the nose as the pull
 * engages.
 */
export function trackGoal(lock: GunLockState, shooter: AircraftState, target: AircraftState, mount: GunMount, dt: number) {
  if (!lock.locked || !noseLead(shooter, target, mount, goal)) return null
  const T = gunLockTuning
  if (lock.tracked && dt > 0) {
    spin.crossVectors(lock.tracked, goal)
    const sine = spin.length(), angle = Math.atan2(sine, lock.tracked.dot(goal))
    if (sine > 1e-12) spin.multiplyScalar(angle / sine / dt); else spin.set(0, 0, 0)
    lock.rate.lerp(spin, 1 - Math.exp(-dt / T.rateSeconds))
  }
  (lock.tracked ??= new Vector3()).copy(goal)
  lock.engaged += dt
  const ahead = lock.rate.length() * (1 / GUN_TRACK.rate + dt / 2)
  if (ahead > 1e-9) goal.applyAxisAngle(axis.copy(lock.rate).normalize(), ahead)
  // Fading in: a share of the way from the nose is a share of the magnet's pull.
  const share = ease(lock.engaged / T.engageSeconds)
  if (share < 1) goal.copy(nose.lerp(goal, share)).normalize()
  return { x: goal.x, y: goal.y, z: goal.z }
}
