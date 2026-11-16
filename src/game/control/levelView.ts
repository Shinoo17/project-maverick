import { MathUtils, Vector3, type Camera } from 'three'
import { CAMERA } from './config'

/*
The hand steers along the horizon, not along the tilted picture (owner request 2026-11-16: the
controls must not fight the pilot).

Horizon lock and Aim lock lean the view with the bank (`CAMERA.horizonBankFollowDeg`,
`aimBankFollowDeg`, up to 35° adaptive). The mouse turned the aim about that leaning view's own
axes, so a hand moving straight to the right in a banked turn also turned the aim down: measured,
a steady 30–60°/s drag to the right for four seconds left the nose 29–38° under the horizon and
100–215 m lower, and under screen steering a × held to the side became a spiral dive. With the
lean taken out, the same drag ends within a degree of level.

So the lean is taken out of the hand's axes: `leveled` gives the view's right and up turned back
about the view axis by the view's roll off the level horizon. The picture still leans; only what
"right" and "up" mean to the hand stays on the horizon.

Only the lean. Past `tiltDeg` of roll the view is not leaning with a bank, it is on its side or on
its back with the jet (after a half loop, in a roll the view follows), and near the vertical
there is no level horizon to speak of (`CAMERA.verticalBlend`): there the view's own axes stand,
as before. Aircraft lock never levels: there "mouse up" is the canopy.
*/
export const LEVEL_VIEW = {
  /** Roll of the view off the level horizon (deg): taken out whole up to the first, not at all from the second. */
  tiltDeg: [40, 70] as const,
}

const forward = new Vector3(), flat = new Vector3(), side = new Vector3(), across = new Vector3()
/**
 * How far to turn the view's axes back about the view axis to stand on the level horizon:
 * radians, positive when the view's right has turned toward its down. 0 where the view's own axes stand.
 */
export function viewLean(camera: Camera): number {
  const e = camera.matrixWorld.elements
  // Column 0 is the view's right, column 2 points back at the eye.
  forward.set(-e[8], -e[9], -e[10]).normalize()
  flat.set(-forward.z, 0, forward.x)
  const horizontal = flat.length()
  if (horizontal < 1e-6) return 0
  flat.divideScalar(horizontal)
  const right = side.set(e[0], e[1], e[2]).normalize()
  // The angle about the view axis from the level right to the view's right.
  const lean = Math.atan2(forward.dot(across.crossVectors(flat, right)), flat.dot(right))
  const keep = (1 - MathUtils.smoothstep(Math.abs(MathUtils.radToDeg(lean)), LEVEL_VIEW.tiltDeg[0], LEVEL_VIEW.tiltDeg[1]))
    * (1 - MathUtils.smoothstep(Math.abs(forward.y), CAMERA.verticalBlend[0], CAMERA.verticalBlend[1]))
  return lean * keep
}

/** The view's right and up with its lean taken out, into `right` and `up` (world, unit). */
export function leveled(camera: Camera, right: Vector3, up: Vector3) {
  const e = camera.matrixWorld.elements
  right.set(e[0], e[1], e[2]).normalize(); up.set(e[4], e[5], e[6]).normalize()
  const lean = viewLean(camera)
  if (lean === 0) return
  // Turned back about the view axis by the lean: right takes a share of up, up gives one to right.
  const c = Math.cos(lean), s = Math.sin(lean), rx = right.x, ry = right.y, rz = right.z
  right.set(rx * c + up.x * s, ry * c + up.y * s, rz * c + up.z * s)
  up.set(up.x * c - rx * s, up.y * c - ry * s, up.z * c - rz * s)
}

/**
 * Screen steering: a place on the window (`px` right, `py` down, pixels from the middle) turned
 * about `about` (the gun reticle as drawn) so that an offset straight to the right of the reticle
 * on the leaning picture is read as straight along the horizon. Into `out`.
 */
export function levelOffset(camera: Camera, px: number, py: number, about: { px: number; py: number }, out: { px: number; py: number }) {
  const lean = viewLean(camera)
  const ox = px - about.px, oy = py - about.py, c = Math.cos(lean), s = Math.sin(lean)
  out.px = about.px + ox * c + oy * s
  out.py = about.py - ox * s + oy * c
  return out
}
