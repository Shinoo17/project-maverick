/*
The gun solution: where rounds fired now will be, and where to aim so they meet the target.
Display only (doc 07): rounds never steer, and hitboxes never grow. Everything here uses the
same physics as `spawnRound`/`stepRound` (projectiles.ts): muzzle offset, the gun line's
nose-up tilt, the shooter's velocity added to the muzzle speed, and gravity.

All results are WORLD points at the same moment t after firing. Two world points that meet
also meet on screen from any camera, so the HUD can project them through the chase camera
and "reticle on lead marker" still means "hit". A direction from the aircraft would not: the
camera sits metres behind it.

- Gun reticle: where a round fired now along the current gun line is at time t.
- Lead point: where the target will be at time t, from its velocity and acceleration (so a
  turning target is led around its turn). t is the time the round needs to reach it.
- With no target, the reticle is drawn at DEFAULT_RANGE.

Solving: the round must cover r(t) = r0 + Δv·t + ½(a_target − g)·t² at muzzle speed, so
t = |r(t)| / muzzleSpeed, iterated from t = |r0| / muzzleSpeed. Relative speeds are far below
muzzle speed, so it settles in a few steps.
*/
import { Quaternion, Vector3 } from 'three'
import { gunStation, type GunProfile } from '../../content/weapons'
import { getAircraft } from '../../content/aircraft'
import type { Quat, Vec3 } from '../state/WorldState'
import { GRAVITY } from './projectiles'

/** Metres. The reticle's range when there is no target, mid way through the designed 200–700 m gun window. */
export const DEFAULT_RANGE = 500
/** Metres. Inside this the HUD calls the target in range: the spread still keeps rounds on an aircraft. Provisional. */
export const EFFECTIVE_RANGE = 800

export interface GunMount { muzzle: readonly [number, number, number]; elevationDeg: number; profile: GunProfile }
/** The gun of an aircraft type, as the solution needs it. */
export function gunMountOf(aircraftId: string): GunMount {
  const station = gunStation(getAircraft(aircraftId))
  return { muzzle: station.muzzle ?? [0, 0, 0], elevationDeg: station.elevationDeg ?? 0, profile: station.profile }
}
export interface ShooterPose { position: Vec3; orientation: Quat; velocity: Vec3 }
export interface TargetMotion { position: Vec3; velocity: Vec3; acceleration: Vec3 }

export interface GunSolution {
  /** Seconds from firing to meeting the target. */
  time: number
  /** Where the target will be then, in the world. */
  lead: Vec3
  /** Where a round fired now along the current gun line will be then, in the world. */
  reticle: Vec3
  /** Unit world direction the gun line must point for a hit. */
  aim: Vec3
  /** Metres to the target now. */
  range: number
  /** The round reaches the target before its lifetime or distance cap. */
  reachable: boolean
}

const turn = new Quaternion(), line = new Vector3(), offset = new Vector3()
/** The gun line in world space: body +X tilted nose-up by the elevation, as `spawnRound` fires it. */
export function gunLine(orientation: Quat, elevationDeg: number): Vec3 {
  const e = elevationDeg * Math.PI / 180
  line.set(Math.cos(e), Math.sin(e), 0).applyQuaternion(turn.set(orientation.x, orientation.y, orientation.z, orientation.w))
  return { x: line.x, y: line.y, z: line.z }
}
export function muzzlePoint(shooter: ShooterPose, mount: GunMount): Vec3 {
  const { x, y, z, w } = shooter.orientation
  offset.set(...mount.muzzle).applyQuaternion(turn.set(x, y, z, w))
  return { x: shooter.position.x + offset.x, y: shooter.position.y + offset.y, z: shooter.position.z + offset.z }
}
/** Where a round fired now along `direction` is after `time` seconds, ignoring spread. */
export function roundAt(shooter: ShooterPose, mount: GunMount, direction: Vec3, time: number): Vec3 {
  const start = muzzlePoint(shooter, mount), m = mount.profile.muzzleSpeed, v = shooter.velocity
  return {
    x: start.x + (v.x + direction.x * m) * time,
    y: start.y + (v.y + direction.y * m) * time - GRAVITY * time * time / 2,
    z: start.z + (v.z + direction.z * m) * time,
  }
}
/** Seconds a round fired along `direction` takes to cover `metres` of its path. */
function timeFor(shooter: ShooterPose, mount: GunMount, direction: Vec3, metres: number) {
  const m = mount.profile.muzzleSpeed, v = shooter.velocity
  return metres / Math.hypot(v.x + direction.x * m, v.y + direction.y * m, v.z + direction.z * m)
}
/** Within the round's lifetime and distance cap. The path length is taken as launch speed × time;
 * gravity changes the speed by well under 1% inside the gun's reach. */
function reaches(shooter: ShooterPose, mount: GunMount, direction: Vec3, time: number) {
  return time <= mount.profile.lifetime && time <= timeFor(shooter, mount, direction, mount.profile.maxDistance)
}

/** The reticle alone, at `DEFAULT_RANGE` of round travel. */
export function defaultReticle(shooter: ShooterPose, mount: GunMount): Vec3 {
  const direction = gunLine(shooter.orientation, mount.elevationDeg)
  return roundAt(shooter, mount, direction, timeFor(shooter, mount, direction, DEFAULT_RANGE))
}

export function solveGun(shooter: ShooterPose, mount: GunMount, target: TargetMotion): GunSolution | null {
  const start = muzzlePoint(shooter, mount), m = mount.profile.muzzleSpeed
  const p = target.position, v = target.velocity, a = target.acceleration, s = shooter.velocity
  const r0 = { x: p.x - start.x, y: p.y - start.y, z: p.z - start.z }
  const needed = (t: number) => ({
    x: r0.x + (v.x - s.x) * t + a.x * t * t / 2,
    y: r0.y + (v.y - s.y) * t + (a.y + GRAVITY) * t * t / 2,
    z: r0.z + (v.z - s.z) * t + a.z * t * t / 2,
  })
  let time = Math.hypot(r0.x, r0.y, r0.z) / m, settled = false
  for (let step = 0; step < 12 && !settled; step++) {
    const r = needed(time), next = Math.hypot(r.x, r.y, r.z) / m
    settled = Math.abs(next - time) < 1e-7
    time = next
  }
  if (!settled || !(time > 0)) return null
  const r = needed(time), length = Math.hypot(r.x, r.y, r.z)
  const aim = { x: r.x / length, y: r.y / length, z: r.z / length }
  const lead = { x: p.x + v.x * time + a.x * time * time / 2, y: p.y + v.y * time + a.y * time * time / 2, z: p.z + v.z * time + a.z * time * time / 2 }
  const current = gunLine(shooter.orientation, mount.elevationDeg)
  return {
    time, lead, aim, reticle: roundAt(shooter, mount, current, time),
    range: Math.hypot(p.x - shooter.position.x, p.y - shooter.position.y, p.z - shooter.position.z),
    reachable: reaches(shooter, mount, aim, time),
  }
}
