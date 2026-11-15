import { Quaternion, Vector3 } from 'three'
import type { AircraftState } from '../state/WorldState'
import { solveGun, type GunMount } from './gunSolution'
import { assistRange, type AimAssistLevel } from './aimAssist'

/*
Gun lock: mouse aim's aim assist (owner design, 2026-11-16). It replaces the aim magnet
(aimAssist.ts `aimMagnet`) under mouse aim.

- Charge. Holding the cursor on the selected target, or on its lead, within `captureDeg` fills
  a ring around the cursor over `dwellSeconds` (1.5 s standard, 1 s strong). Off it the ring
  drains at `drainRate` of a full ring a second rather than emptying at once.
- Lock. A full ring locks: the cursor moves onto the lead (where the nose must point for the
  rounds to meet the target) and stays on it, and the aim controller flies the nose there.
  The cursor glides on (`followRate`), it never jumps. On the arcade core the nose is drawn onto
  the lead too (`goal`, sent as PilotCommand.gunTrack: arcadeCore/step.ts, the magnet), the stick
  stays out of it (no bank-to-turn rolling the jet about), and the chase camera looks at the lead
  with its horizon level (ArcadeChase `gunLock`), so the target holds still on screen whatever
  the jet's roll. Other cores have no magnet: there the aim controller flies the nose.
- Break. A hard flick of the mouse breaks it: hand motion piles up and drains with a quarter
  second time constant, and past `flickDeg` the lock lets go with the cursor where the hand put
  it. Small hand motion is ignored while locked. The lock also goes when the target dies or
  changes, leaves gun reach (`assistRange.far[1]` plus `rangeSlack`), or the lead swings more
  than `breakOffNoseDeg` off the nose.

Only the selected target is charged on, and only within gun reach and ahead. The lock moves
the aim, never the rounds: rounds never steer and hitboxes never grow (doc 07).

It runs once per rendered frame on the interpolated poses, like the hand on the mouse. The aim
is input, not the record: replays keep the commands the aim produced.
*/
export const gunLockTuning = {
  /** Seconds the cursor must stay on the target to lock, by aim assist level. */
  dwellSeconds: { standard: 1.5, strong: 1 } as Record<Exclude<AimAssistLevel, 'off'>, number>,
  /** Degrees from the target or its lead that count as on it. */
  captureDeg: 4,
  /** Full rings a second the charge drains while off the target. */
  drainRate: 1,
  /** How fast the locked cursor closes on the lead (1/s), and its top speed (deg/s). */
  followRate: 14,
  followMaxDeg: 240,
  /** Hand motion (degrees of aim turn, piled up with `flickSeconds` decay) that breaks the lock. */
  flickDeg: 7,
  flickSeconds: 0.25,
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
  /** Hand motion piled up while locked (degrees). */
  hand: number
  /** While locked: where the nose must point for the rounds to meet the target (world, unit). The
   * flight scene sends it with each command (PilotCommand.gunTrack) and the arcade core draws the
   * nose onto it, the magnet. */
  goal: { x: number; y: number; z: number }
}

export const createGunLock = (): GunLockState => ({ targetId: null, progress: 0, locked: false, hand: 0, goal: { x: 1, y: 0, z: 0 } })
export function releaseGunLock(lock: GunLockState) { lock.targetId = null; lock.progress = 0; lock.locked = false; lock.hand = 0 }

export interface GunLockFrame {
  level: AimAssistLevel
  shooter: AircraftState
  target: AircraftState | null
  mount: GunMount
  /** The mouse aim direction (world, unit); turned in place while locked. */
  aim: Vector3
  /** Seconds since the last frame. */
  dt: number
  /** Degrees the hand turned the aim since the last frame. */
  handDeg: number
}

const turn = new Quaternion(), wing = new Vector3(), lead = new Vector3(), toTarget = new Vector3(), nose = new Vector3(), axis = new Vector3()
const DEG = Math.PI / 180

/** Steps the lock one frame. Returns the state for the HUD; while locked the aim is moved onto the lead. */
export function stepGunLock(lock: GunLockState, frame: GunLockFrame): GunLockState {
  const { level, shooter, target, mount, aim, dt } = frame
  const T = gunLockTuning
  if (level === 'off' || !shooter.alive || !target?.alive) { releaseGunLock(lock); return lock }
  if (!(dt > 0)) return lock
  if (lock.targetId !== target.id) { releaseGunLock(lock); lock.targetId = target.id }

  const solution = solveGun(shooter, mount, target)
  const reach = assistRange.far[1] + (lock.locked ? T.rangeSlack : 0)
  if (!solution?.reachable || solution.range > reach) { drain(lock, dt); return lock }
  // Where the nose must point: the gun line sits elevationDeg above the nose, so the nose goes that far below the solution.
  turn.set(shooter.orientation.x, shooter.orientation.y, shooter.orientation.z, shooter.orientation.w)
  wing.set(0, 0, 1).applyQuaternion(turn)
  lead.set(solution.aim.x, solution.aim.y, solution.aim.z).normalize().applyAxisAngle(wing, -mount.elevationDeg * DEG)
  nose.set(1, 0, 0).applyQuaternion(turn)

  if (lock.locked) {
    lock.hand = lock.hand * Math.exp(-dt / T.flickSeconds) + frame.handDeg
    if (lock.hand > T.flickDeg || lead.angleTo(nose) > T.breakOffNoseDeg * DEG) { releaseGunLock(lock); lock.targetId = target.id; return lock }
    follow(aim, lead, dt)
    lock.goal = { x: lead.x, y: lead.y, z: lead.z }
    return lock
  }

  toTarget.set(target.position.x - shooter.position.x, target.position.y - shooter.position.y, target.position.z - shooter.position.z).normalize()
  const ahead = toTarget.dot(nose) > 0
  const off = Math.min(aim.angleTo(toTarget), aim.angleTo(lead)) / DEG
  if (ahead && off <= T.captureDeg) {
    lock.progress = Math.min(1, lock.progress + dt / T.dwellSeconds[level])
    if (lock.progress >= 1) { lock.locked = true; lock.hand = 0; lock.goal = { x: lead.x, y: lead.y, z: lead.z } }
  } else drain(lock, dt)
  return lock
}

function drain(lock: GunLockState, dt: number) {
  lock.locked = false; lock.hand = 0
  lock.progress = Math.max(0, lock.progress - dt * gunLockTuning.drainRate)
}

/** Turns `aim` toward `goal`: exponential, kept to the top follow speed. */
function follow(aim: Vector3, goal: Vector3, dt: number) {
  const angle = aim.angleTo(goal)
  if (angle < 1e-7) { aim.copy(goal); return }
  const step = Math.min(angle * (1 - Math.exp(-gunLockTuning.followRate * dt)), gunLockTuning.followMaxDeg * DEG * dt)
  axis.crossVectors(aim, goal)
  if (axis.lengthSq() < 1e-14) { aim.copy(goal); return }
  aim.applyAxisAngle(axis.normalize(), step).normalize()
}
