/*
Flight paths for the moving target drone (Playground).

The drone does not run the flight model: its pose is a plain function of time
along a racetrack, so it is the same at any frame rate and never stalls or
drifts. A racetrack is a straight leg, a half circle, the leg flown back and a
half circle home. With a leg of 0 it is a full circle, which is how the
"circle" drone flies around the range.

The drone flies level at one altitude and one speed. It banks into the turns
(the bank a real coordinated turn needs at that speed and radius), rolling in
and out over the first and last ROLL_METRES of each turn so it never snaps.
*/
import type { Quat, Vec3 } from '../state/WorldState'

export type TargetDroneMode = 'still' | 'racetrack' | 'circle'

/** Provisional values, waiting on playtest. */
export const dronePaths = {
  /** m/s, a little faster than the player's 130 m/s spawn speed. */
  speed: 150,
  /** The racetrack's straight leg ends this far from the range centre (the range is 8,000 m). */
  turnBackRadius: 6000,
  /** Shortest straight leg, when the drone starts near the turn-back radius. */
  minLeg: 800,
  /** Racetrack turn radius: about a 57° bank at 150 m/s. */
  racetrackTurn: 1500,
  /** The circle around the range centre: about a 37° bank at 150 m/s. */
  circleRadius: 3000,
} as const
const GRAVITY = 9.81
const ROLL_METRES = 150

/** One racetrack, fixed when the drone spawns. All vectors are level (y = 0) except `start`. */
export interface DronePath {
  start: Vec3
  /** Unit heading of the first leg. */
  heading: Vec3
  /** Unit vector toward the side the drone turns to. */
  side: Vec3
  /** Straight leg length in metres; 0 flies a circle. */
  leg: number
  turnRadius: number
  speed: number
  /** The tick the drone was at `start`. */
  startTick: number
}

export interface DronePose { position: Vec3; orientation: Quat; velocity: Vec3 }

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z })
const along = (base: Vec3, a: Vec3, ka: number, b: Vec3, kb: number): Vec3 =>
  v(base.x + a.x * ka + b.x * kb, base.y, base.z + a.z * ka + b.z * kb)

/** A racetrack from `start`, heading `heading`: straight until the turn-back radius, then turning toward the centre. */
export function racetrackFrom(start: Vec3, heading: Vec3, startTick: number): DronePath {
  const h = level(heading)
  // Distance along the heading to the turn-back circle (positive root of |start + h s| = R).
  const b = start.x * h.x + start.z * h.z, c = start.x ** 2 + start.z ** 2 - dronePaths.turnBackRadius ** 2
  const toEdge = -b + Math.sqrt(Math.max(0, b * b - c))
  // Turn to whichever side the centre is on; straight at it, turn left.
  const right = v(-h.z, 0, h.x)
  const sign = start.x * right.x + start.z * right.z > 0 ? -1 : 1
  return { start: { ...start }, heading: h, side: v(right.x * sign, 0, right.z * sign), leg: Math.max(dronePaths.minLeg, toEdge),
    turnRadius: dronePaths.racetrackTurn, speed: dronePaths.speed, startTick }
}

/** The circle around the range centre, joined at the point nearest `near`, flown anticlockwise seen from above. */
export function circleFrom(near: Vec3, altitude: number, startTick: number): DronePath {
  const r = dronePaths.circleRadius, distance = Math.hypot(near.x, near.z)
  const out = distance > 1e-6 ? v(near.x / distance, 0, near.z / distance) : v(1, 0, 0)
  // Anticlockwise from above (+Y up): heading is `out` turned 90° to the left, the centre is to the left.
  return { start: v(out.x * r, altitude, out.z * r), heading: v(out.z, 0, -out.x), side: v(-out.x, 0, -out.z), leg: 0,
    turnRadius: r, speed: dronePaths.speed, startTick }
}

/** Pose `seconds` after the path started. */
export function dronePose(path: DronePath, seconds: number): DronePose {
  const { start: p, heading: h, side: n, leg, turnRadius: r, speed } = path
  const turn = Math.PI * r, lap = 2 * leg + 2 * turn
  let s = (speed * seconds) % lap
  if (s < 0) s += lap
  let position: Vec3, direction: Vec3, turning = 0
  if (s < leg) {
    position = along(p, h, s, n, 0); direction = h
  } else if (s < leg + turn) {
    const a = (s - leg) / r, into = s - leg
    position = along(p, h, leg + r * Math.sin(a), n, r - r * Math.cos(a))
    direction = along(v(0, 0, 0), h, Math.cos(a), n, Math.sin(a)); turning = rollIn(into, turn)
  } else if (s < 2 * leg + turn) {
    const back = s - leg - turn
    position = along(p, h, leg - back, n, 2 * r); direction = v(-h.x, 0, -h.z)
  } else {
    const a = (s - 2 * leg - turn) / r, into = s - 2 * leg - turn
    position = along(p, h, -r * Math.sin(a), n, r + r * Math.cos(a))
    direction = along(v(0, 0, 0), h, -Math.cos(a), n, -Math.sin(a)); turning = rollIn(into, turn)
  }
  // A circle never leaves its turn, so it holds the full bank.
  if (leg === 0) turning = 1
  // Both turns go the same way round, so the bank keeps one sign: right wing down (positive roll)
  // when the first turn is to the right of the first leg.
  const turnsRight = n.x * -h.z + n.z * h.x > 0
  const bank = turning * Math.atan(speed * speed / (r * GRAVITY)) * (turnsRight ? 1 : -1)
  return { position: v(position.x, p.y, position.z), orientation: yawRoll(direction, bank), velocity: v(direction.x * speed, 0, direction.z * speed) }
}

/** 0 → 1 → 0 across a turn of `length` metres, easing over ROLL_METRES at each end. */
function rollIn(into: number, length: number) {
  const edge = Math.min(into, length - into) / ROLL_METRES
  if (edge >= 1) return 1
  const f = Math.max(0, edge)
  return f * f * (3 - 2 * f)
}
function level(heading: Vec3): Vec3 {
  const length = Math.hypot(heading.x, heading.z)
  return length > 1e-6 ? v(heading.x / length, 0, heading.z / length) : v(1, 0, 0)
}
/** Body +X along the level `direction`, then rolled `roll` radians about the nose. */
function yawRoll(direction: Vec3, roll: number): Quat {
  // Yaw about world +Y that turns +X onto the direction, then roll about body +X.
  const yaw = Math.atan2(-direction.z, direction.x)
  const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cr = Math.cos(roll / 2), sr = Math.sin(roll / 2)
  // q = yaw(Y) * roll(X)
  return { x: cy * sr, y: sy * cr, z: -sy * sr, w: cy * cr }
}
