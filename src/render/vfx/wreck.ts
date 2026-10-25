/*
A shot-down aircraft's fall, for the view only (the user asked on 2026-10-21 for the wreck to
lose control, fall and explode again on the ground). The simulation is not involved: the
aircraft is already dead there and may respawn while its wreck is still falling, so the wreck
is a separate thing drawn from the pose the aircraft died in.

Out of control:
- It keeps its velocity at death and gets a downward kick (the wing has let go), then falls
  under gravity with light drag. From ~400 m it reaches the ground in about 7 s.
- It rolls continuously, one way or the other, and its nose swings toward its motion, so it
  tumbles into a steepening spiral rather than gliding.
- It lands when its centre comes within LANDING of the ground (the model is centred on its
  origin, so its belly touches first).

Stepped at a fixed 1/120 s from the simulation clock, so the same death falls the same way at
any frame rate, and pause freezes it.
*/
import { Quaternion, Vector3 } from 'three'
import { GROUND_Y } from '../../game/combat/projectiles'

const STEP = 1 / 120
export const wreckFall = {
  gravity: 9.81,
  /** 1/s, linear drag on velocity. */
  drag: 0.05,
  /** m/s added straight down at death. */
  kick: 25,
  /** rad/s of roll; the sign comes from the seed. */
  roll: 2.6,
  /** 1/s: how fast the nose swings onto the motion. */
  noseFollow: 1.1,
  /** Metres above the ground at which the centre counts as down. */
  landing: 3,
} as const

type Vec3Like = { x: number; y: number; z: number }
type QuatLike = Vec3Like & { w: number }
export interface Wreck {
  position: Vector3
  velocity: Vector3
  orientation: Quaternion
  /** Simulation seconds the wreck has been stepped to. */
  time: number
  roll: number
  landed: boolean
}

export function createWreck(pose: { position: Vec3Like; velocity: Vec3Like; orientation: QuatLike }, time: number, seed: number): Wreck {
  return {
    position: new Vector3(pose.position.x, pose.position.y, pose.position.z),
    velocity: new Vector3(pose.velocity.x, pose.velocity.y - wreckFall.kick, pose.velocity.z),
    orientation: new Quaternion(pose.orientation.x, pose.orientation.y, pose.orientation.z, pose.orientation.w),
    time, roll: (seed % 2 === 0 ? 1 : -1) * wreckFall.roll, landed: false,
  }
}

const nose = new Vector3(), heading = new Vector3(), swing = new Quaternion(), partial = new Quaternion(), spin = new Quaternion(), X = new Vector3(1, 0, 0)
/** Steps the wreck up to simulation time `now`. Returns true on the step it lands. */
export function advanceWreck(wreck: Wreck, now: number) {
  while (!wreck.landed && wreck.time + STEP <= now) {
    wreck.time += STEP
    const v = wreck.velocity
    v.multiplyScalar(1 - wreckFall.drag * STEP)
    v.y -= wreckFall.gravity * STEP
    wreck.position.addScaledVector(v, STEP)
    // Nose toward the motion, then the roll about the nose.
    nose.copy(X).applyQuaternion(wreck.orientation)
    if (v.lengthSq() > 1) {
      heading.copy(v).normalize()
      swing.setFromUnitVectors(nose, heading)
      wreck.orientation.premultiply(partial.identity().slerp(swing, 1 - Math.exp(-wreckFall.noseFollow * STEP)))
    }
    wreck.orientation.multiply(spin.setFromAxisAngle(X, wreck.roll * STEP)).normalize()
    if (wreck.position.y <= GROUND_Y + wreckFall.landing) {
      wreck.position.y = GROUND_Y + wreckFall.landing
      wreck.landed = true
      return true
    }
  }
  return false
}
