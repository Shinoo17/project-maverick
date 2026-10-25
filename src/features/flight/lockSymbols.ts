/*
The missile lock on the HUD glass (doc 07), drawn by hudPainter over the gun marks. Everything is
driven by the seeker's progress (game/combat/seeker.ts, render/lockFrame.ts), never by a fixed
timeline: a lock that stalls halfway stays halfway, and one that slips loosens again.

- SEARCH: a blue frame about 1.8x the aircraft with a scan line sweeping down through it.
- TRACKING: the frame shrinks onto the aircraft on a spring and a ring around it fills with the
  progress. The scan line fades as it goes.
- ACQUIRING: amber, close to the airframe, with four sight lines closing in from the sides.
- LOCKED: the frame snaps in with a short red flash, small and red. Only the frame: no outline of
  the aircraft (user request 25 Oct 2026).
- LOCK LOST: blinks under the target while the frame loosens back out.
- SHOOT replaces LOCK while the target is inside the missile's launch range (MissileProfile).

The frame comes from 3D anchor points on the target projected through the camera, so it follows
its position, attitude and drawn size.

Colour: blue, amber and red join the glass's phosphor green for the lock alone (user request
25 Oct 2026). Amber and red are the gun's lock colours too (gunnerySymbols.ts): red marks a
lock there as well, so a missile lock and a gun solution can both show red at once.

Strokes only, no fills, and nothing allocated per frame: the buffers and springs live in the
painter. Springs, blinks and the flash run on simulation time, so pause freezes them. Reduced
motion drops the scan line, the flash and the glide.
*/
import type { Camera } from 'three'
import { Vector3 } from 'three'
import { WORLD_STEP } from '../../game/runtime/clock'
import { seekerRules } from '../../game/combat/seeker'
import type { LockMarks } from '../../render/lockFrame'
import type { Pen } from './gunnerySymbols'

const SEEKER = { color: 'rgba(96, 214, 255, 0.96)', bloom: 'rgba(64, 186, 255, 0.24)' } as const
/** Frame size as a multiple of the aircraft's drawn size: searching, at the end of acquiring, locked. */
const SCALE = { search: 1.8, acquired: 1.12, locked: 1 } as const
/** A new target's frame opens in from a little wider than SEARCH. */
const OPEN_SCALE = 2.2
/** Pixels: the aircraft box is never smaller than this half-size, nor the frame larger. */
const MIN_HALF = 9, MAX_HALF = 220
/** Spring stiffness (1/s²) and damping ratio. Tracking glides; the lock snaps with a small overshoot. */
const GLIDE = { k: 70, zeta: 1 }, SNAP = { k: 420, zeta: 0.42 }, SLIDE = { k: 90, zeta: 1 }
const FLASH_SECONDS = 0.28, SCAN_SECONDS = 1.1
const TAGS = { search: 'SRCH', tracking: 'TRK', acquiring: 'ACQ', locked: 'LOCK' } as const

type Spring = { x: number; v: number }
function spring(s: Spring, goal: number, { k, zeta }: { k: number; zeta: number }, dt: number) {
  // Semi-implicit Euler in small steps: stable for these stiffnesses at any frame rate.
  for (let left = dt; left > 1e-6; left -= 1 / 240) {
    const h = Math.min(left, 1 / 240)
    s.v += (k * (goal - s.x) - 2 * zeta * Math.sqrt(k) * s.v) * h
    s.x += s.v * h
  }
}
const ease = (t: number) => 1 - (1 - t) * (1 - t)

export function createLockPainter(maxAnchors = 128) {
  const screen = new Float32Array(maxAnchors * 2)
  const view = new Vector3()
  let targetId: string | null = null, lastNow = -1, flashAt: number | null = null, wasLocked = false
  const scale: Spring = { x: SCALE.search, v: 0 }, slideX: Spring = { x: 0, v: 0 }, slideY: Spring = { x: 0, v: 0 }
  // The frame's centre last drawn, so a switch to another target glides across.
  let lastX = 0, lastY = 0, shown = false

  /** Projects the anchors; false when any is behind the camera or the whole box is off the frame. */
  function project(marks: LockMarks, camera: Camera, width: number, height: number) {
    for (let i = 0; i < marks.count; i++) {
      view.set(marks.anchors[i * 3], marks.anchors[i * 3 + 1], marks.anchors[i * 3 + 2]).applyMatrix4(camera.matrixWorldInverse)
      if (view.z > -0.5) return false
      view.applyMatrix4(camera.projectionMatrix)
      screen[i * 2] = (view.x * 0.5 + 0.5) * width
      screen[i * 2 + 1] = (-view.y * 0.5 + 0.5) * height
    }
    return marks.count > 0
  }

  function reset() { targetId = null; lastNow = -1; flashAt = null; wasLocked = false; shown = false }

  /** Draws the lock. Returns the half-size in pixels that the lock's marks keep inside at any
   * progress (the search frame), so the gun box can set its text outside it without it moving as the
   * frame shrinks; 0 when the frame is not on the glass (the gun box then draws its own brackets). */
  function draw(pen: Pen, marks: LockMarks, camera: Camera, width: number, height: number): number {
    const { ctx } = pen
    const dt = lastNow < 0 || marks.now < lastNow ? 0 : Math.min(0.1, (marks.now - lastNow) * WORLD_STEP)
    lastNow = marks.now
    const seconds = marks.now * WORLD_STEP
    const locked = marks.phase === 'locked'
    if (locked && !wasLocked) flashAt = marks.now
    wasLocked = locked

    const onGlass = marks.targetId !== null && project(marks, camera, width, height)
    let cx = width / 2, cy = height / 2 + 70, halfX = 0, halfY = 0, reach = 0
    if (onGlass) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (let i = 0; i < marks.count; i++) {
        const x = screen[i * 2], y = screen[i * 2 + 1]
        if (x < minX) minX = x; if (x > maxX) maxX = x
        if (y < minY) minY = y; if (y > maxY) maxY = y
      }
      const boxX = (minX + maxX) / 2, boxY = (minY + maxY) / 2
      // The aircraft's box, never a sliver: a jet seen side-on is wide and short.
      const hw = Math.max(MIN_HALF, (maxX - minX) / 2), hh = Math.max(MIN_HALF, (maxY - minY) / 2)
      const aw = Math.max(hw, hh * 0.6), ah = Math.max(hh, hw * 0.45)
      const offFrame = maxX < 0 || minX > width || maxY < 0 || minY > height
      if (!offFrame) {
        const goal = locked ? SCALE.locked : SCALE.search + (SCALE.acquired - SCALE.search) * ease(Math.min(1, marks.progress / 1))
        if (marks.targetId !== targetId) {
          // Another live target straight after this one: slide across from the old frame. Otherwise open in.
          const glide = shown && targetId !== null && !marks.still
          slideX.x = glide ? lastX - boxX : 0; slideY.x = glide ? lastY - boxY : 0
          slideX.v = slideY.v = 0
          if (!glide) { scale.x = marks.still ? goal : OPEN_SCALE; scale.v = 0 }
          targetId = marks.targetId
        }
        if (marks.still) { scale.x = goal; scale.v = 0; slideX.x = slideY.x = 0 }
        else {
          spring(scale, goal, locked ? SNAP : GLIDE, dt)
          spring(slideX, 0, SLIDE, dt); spring(slideY, 0, SLIDE, dt)
        }
        cx = boxX + slideX.x; cy = boxY + slideY.x
        halfX = Math.min(MAX_HALF, aw * scale.x + 3); halfY = Math.min(MAX_HALF, ah * scale.x + 3)
        lastX = cx; lastY = cy; shown = true
        reach = Math.min(MAX_HALF, Math.max(aw, ah) * SCALE.search + 3)
        drawFrame(pen, marks, cx, cy, halfX, halfY, aw, ah, seconds)
      } else shown = false
    } else {
      shown = false
      if (marks.targetId === null) targetId = null
    }
    if (marks.lost !== null) {
      // Blinks for its first second, then holds until it clears.
      if (marks.lost > 1 || Math.floor(marks.lost * 6) % 2 === 0) {
        pen.text('LOCK LOST', cx, shown ? cy + Math.max(halfY, reach) + 36 : cy, pen.font(12, 700), pen.locked.color, 'center')
      }
    }
    ctx.globalAlpha = 1
    ctx.setLineDash([])
    return shown ? reach : 0
  }

  function drawFrame(pen: Pen, marks: LockMarks, cx: number, cy: number, halfX: number, halfY: number, aw: number, ah: number, seconds: number) {
    const { ctx } = pen
    const { phase, progress } = marks
    const tone = phase === 'locked' ? pen.locked : phase === 'acquiring' ? pen.captured : SEEKER
    const left = cx - halfX, right = cx + halfX, top = cy - halfY, bottom = cy + halfY

    // Corner brackets: the frame itself. Searching, they are dimmer than a lock in progress.
    const arm = Math.max(5, Math.min(halfX, halfY) * (phase === 'locked' ? 0.5 : 0.38))
    ctx.globalAlpha = phase === 'search' ? 0.7 : 1
    pen.luminous(() => {
      ctx.beginPath()
      for (const [x, y, sx, sy] of [[left, top, 1, 1], [right, top, -1, 1], [right, bottom, -1, -1], [left, bottom, 1, -1]] as const) {
        ctx.moveTo(x + sx * arm, y); ctx.lineTo(x, y); ctx.lineTo(x, y + sy * arm)
      }
      ctx.stroke()
    }, phase === 'locked' ? 1.8 : 1.5, tone.color, tone.bloom)

    // Scan line: sweeps down the frame while searching, fading out as the seeker settles.
    const scan = 1 - Math.min(1, progress / seekerRules.acquiring)
    if (!marks.still && scan > 0 && phase !== 'locked') {
      const share = (seconds / SCAN_SECONDS) % 1
      for (let trail = 0; trail < 3; trail++) {
        const y = top + 2 + ((share - trail * 0.04 + 1) % 1) * (2 * halfY - 4)
        ctx.globalAlpha = scan * (0.55 - trail * 0.17)
        pen.line(left + 3, y, right - 3, y, 1, SEEKER.color)
      }
    }

    // Progress ring, filling clockwise from the top. Sized to the aircraft, not the frame, so it
    // holds still while the frame shrinks through it. A faint full track shows its end; with the
    // target outside the seeker it dims, emptying.
    if (phase !== 'locked') {
      const r = Math.hypot(aw, ah) * 1.05 + 6
      ctx.globalAlpha = 0.28
      pen.luminous(() => { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke() }, 1, tone.color, tone.bloom)
      ctx.globalAlpha = marks.tracking ? 1 : 0.55
      if (progress > 0) pen.luminous(() => { ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2); ctx.stroke() }, 2, tone.color, tone.bloom)
      // Quarter ticks, so the ring reads as an instrument rather than a halo.
      pen.luminous(() => {
        ctx.beginPath()
        for (let q = 0; q < 4; q++) {
          const a = q * Math.PI / 2
          ctx.moveTo(cx + Math.cos(a) * (r + 2), cy + Math.sin(a) * (r + 2)); ctx.lineTo(cx + Math.cos(a) * (r + 6), cy + Math.sin(a) * (r + 6))
        }
        ctx.stroke()
      }, 1.2, tone.color, tone.bloom)
    }

    // Acquiring: four sight lines close in from the frame's sides toward the airframe.
    if (phase === 'acquiring') {
      const t = ease((progress - seekerRules.acquiring) / (1 - seekerRules.acquiring))
      ctx.globalAlpha = 1
      pen.luminous(() => {
        ctx.beginPath()
        for (const [dx, dy, half, body] of [[1, 0, halfX, aw], [-1, 0, halfX, aw], [0, 1, halfY, ah], [0, -1, halfY, ah]] as const) {
          const outer = half + 9, inner = half + 2 + (body * 0.55 - half - 2) * t
          ctx.moveTo(cx + dx * outer, cy + dy * outer); ctx.lineTo(cx + dx * inner, cy + dy * inner)
        }
        ctx.stroke()
      }, 1.5, tone.color, tone.bloom)
    }

    // Locked: a short flash, a rectangle growing out of the frame and fading, as it snaps in.
    if (phase === 'locked') {
      const flash = flashAt === null || marks.still ? 1 : (marks.now - flashAt) * WORLD_STEP / FLASH_SECONDS
      if (flash >= 0 && flash < 1) {
        const fade = 1 - flash, grow = 1 + 0.7 * ease(flash)
        ctx.globalAlpha = fade
        pen.luminous(() => { ctx.beginPath(); ctx.rect(cx - halfX * grow, cy - halfY * grow, halfX * grow * 2, halfY * grow * 2); ctx.stroke() }, 2, tone.color, tone.bloom)
      }
    }

    // The missile and the phase, left of the frame (the gun's range and closure sit to its right).
    // A lock bleeding away with the target outside the seeker reads as searching again, dimmed.
    ctx.globalAlpha = 1
    const slipping = !marks.tracking && phase !== 'locked'
    pen.text(marks.missile, left - 8, cy - 7, pen.font(11, 700), tone.color, 'right')
    if (slipping) ctx.globalAlpha = 0.6
    pen.text(slipping ? TAGS.search : phase === 'locked' && marks.shoot ? 'SHOOT' : TAGS[phase], left - 8, cy + 8, pen.font(10, 700), tone.color, 'right')
    ctx.globalAlpha = 1
  }

  return { draw, reset }
}
