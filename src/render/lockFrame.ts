/*
Builds the HUD's missile-lock picture for one rendered frame (lockSymbols.ts draws it).

The seeker's state comes from the simulation (seeker.ts); its progress is drawn between ticks so
the frame shrinks smoothly at any frame rate. The target is drawn between ticks like the drone
model (gunneryFrame.ts `between`).

The frame hugs the aircraft as it is drawn: anchor points taken from its hitboxes
(fitted to the GLB, body frame) are scaled by the same distance scale as the model, which uses the
distance from the camera (TargetDrone, placeDrone), turned with the target's attitude and placed at
its position. The HUD projects them, so the box follows the target's turn, roll and
size on screen. Every buffer is allocated once and reused.
*/
import { Quaternion, Vector3 } from 'three'
import { getAircraft } from '../content/aircraft'
import { hitboxes, type HitShape } from '../content/hitboxes'
import { lockPhase, selectedMissile, type LockPhase } from '../game/combat/seeker'
import type { AircraftState, WorldState } from '../game/state/WorldState'
import { between } from './gunneryFrame'
import { distanceScale } from './targetVisibility'

export interface LockMarks {
  targetId: string | null
  phase: LockPhase
  /** 0–1, between the last two ticks. */
  progress: number
  /** The target is inside the seeker's cone and range. */
  tracking: boolean
  /** Seconds since a held lock broke, while LOCK LOST is shown; null otherwise. */
  lost: number | null
  /** World anchor points of the drawn target, packed x, y, z; `count` of them are set. */
  anchors: Float32Array
  count: number
  /** The selected missile's short name, e.g. AIM-9. */
  missile: string
  /** Locked with the target inside the missile's launch range: the HUD shows SHOOT. */
  shoot: boolean
  /** Simulation time in ticks (fractional between ticks): the HUD's springs and blinks run on it, so pause freezes them. */
  now: number
  /** Reduced motion: no scan line, no flash, no glide. */
  still: boolean
}

// Every capsule end and box corner, plus a capsule's reach along and across its axis.
function anchorsOf(shapes: readonly HitShape[]) {
  const points: number[] = []
  for (const shape of shapes) {
    if (shape.kind === 'box') {
      const [cx, cy, cz] = shape.center, [hx, hy, hz] = shape.half
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) points.push(cx + sx * hx, cy + sy * hy, cz + sz * hz)
      continue
    }
    const from = new Vector3(...shape.from), to = new Vector3(...shape.to)
    const axis = to.clone().sub(from).normalize()
    const side = new Vector3(0, 1, 0).cross(axis)
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0)
    side.normalize()
    const up = axis.clone().cross(side)
    for (const [end, out] of [[from, -1], [to, 1]] as const) {
      points.push(...end.clone().addScaledVector(axis, out * shape.radius).toArray())
      for (const dir of [side, up]) for (const s of [-1, 1]) points.push(...end.clone().addScaledVector(dir, s * shape.radius).toArray())
    }
  }
  return new Float32Array(points)
}
const bodyAnchors = new Map<string, Float32Array>()
export function anchorsFor(aircraftId: string) {
  const id = getAircraft(aircraftId).hitboxProfileId
  if (!bodyAnchors.has(id)) bodyAnchors.set(id, anchorsOf(hitboxes[id]))
  return bodyAnchors.get(id)!
}
const MAX_ANCHORS = Math.max(...Object.keys(hitboxes).map(id => anchorsOf(hitboxes[id]).length / 3))

const point = new Vector3(), turn = new Quaternion()
/** Places `aircraftId`'s anchors at `position`, turned by `orientation` and scaled by `scale`, into `out`. */
export function placeAnchors(out: Float32Array, aircraftId: string, position: Vector3, orientation: Quaternion, scale: number) {
  const body = anchorsFor(aircraftId)
  turn.copy(orientation)
  for (let i = 0; i < body.length; i += 3) {
    point.set(body[i], body[i + 1], body[i + 2]).multiplyScalar(scale).applyQuaternion(turn).add(position)
    out[i] = point.x; out[i + 1] = point.y; out[i + 2] = point.z
  }
  return body.length / 3
}

/** Short HUD name of a missile: the designation before any " " or "·". */
export const missileLabel = (name: string) => name.split(/[ ·]/)[0].toUpperCase()

export function createLockFrame() {
  const marks: LockMarks = { targetId: null, phase: 'search', progress: 0, tracking: false, lost: null, anchors: new Float32Array(MAX_ANCHORS * 3), count: 0, missile: '', shoot: false, now: 0, still: false }

  /** `shooter` is the player as of the latest tick; `eye` the camera position this frame. */
  function update(before: WorldState | null, now: WorldState | null, alpha: number, shooter: AircraftState, eye: Vector3, still: boolean): LockMarks | null {
    const seeker = shooter.targeting.seeker
    const missile = selectedMissile(shooter.aircraftId, seeker.slot)
    if (!shooter.alive || !missile) return null
    const last = before?.aircraft.find(entity => entity.id === shooter.id)?.targeting.seeker
    // A new target or slot starts from nothing: no sweep down from the last one's progress.
    const from = last && last.targetId === seeker.targetId && last.slot === seeker.slot ? last.progress : seeker.progress
    const target = seeker.targetId ? between(before, now, entity => entity.id === seeker.targetId, alpha) : null
    marks.targetId = target ? seeker.targetId : null
    marks.progress = from + (seeker.progress - from) * alpha
    marks.phase = lockPhase(marks.progress, seeker.locked)
    marks.tracking = seeker.tracking
    marks.lost = seeker.lost
    marks.missile = missileLabel(missile.weapon.name.en)
    marks.now = (now?.tick ?? 0) - 1 + alpha
    marks.still = still
    const p = shooter.position
    marks.shoot = !!target && seeker.locked && Math.hypot(target.position.x - p.x, target.position.y - p.y, target.position.z - p.z) <= missile.weapon.missile!.launchRangeM
    marks.count = target ? placeAnchors(marks.anchors, target.entity.aircraftId, target.position, target.orientation, distanceScale(eye.distanceTo(target.position))) : 0
    // Nothing to frame and nothing to report.
    return marks.targetId || marks.lost !== null ? marks : null
  }
  return { update }
}
