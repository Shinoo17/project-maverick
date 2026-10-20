/*
Presentation aids that make another aircraft easier to see at gun range. They change only
what is drawn: the simulation, hitboxes and replays never see them.

- Distance scale: a real fighter at 1 km is only ~16 px tall on a 1080p screen. Other aircraft
  are drawn larger with distance, like DCS's "model visibility" option: true size up to
  `near`, easing up to `maxScale` at `far` and beyond. The target box grows with the model, so it
  frames what the eye sees; whether rounds hit still uses the true hitbox.
- Gun zoom: while the gun is held on a selected target, the camera's field of view narrows by
  up to `zoom` of itself (a share, so it feels the same at every FOV setting). Narrowing zooms
  on the screen centre, so it fades out as the target sits further off the view axis: full
  inside `fullDeg`, none past `noneDeg`. Off the axis it would push the target to the edge.

All values are provisional, waiting on playtest.
*/
import { MathUtils } from 'three'

export const visibility = {
  near: 300,
  far: 1000,
  maxScale: 2,
  zoom: 0.15,
  fullDeg: 8,
  noneDeg: 20,
} as const

/** How much larger than life another aircraft is drawn at `metres` from the camera. */
export function distanceScale(metres: number) {
  return 1 + (visibility.maxScale - 1) * MathUtils.smoothstep(metres, visibility.near, visibility.far)
}

/** 0–1: how much of the gun zoom applies with the target `degrees` off the view axis. */
export function zoomShare(degrees: number) {
  return 1 - MathUtils.smoothstep(degrees, visibility.fullDeg, visibility.noneDeg)
}
