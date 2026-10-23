/*
Gun symbology on the HUD glass (doc 07, doc 12), drawn by hudPainter in the same phosphor
green. Every mark is a WORLD point projected through the flight camera (gunSolution.ts says
why), so the reticle sitting on the lead marker on screen means a hit.

- Gun reticle: a broken ring with a centre dot where rounds fired now will be. At the
  target's range when there is one, otherwise at 500 m. It swings away from the nose in a
  pull, because the rounds keep the aircraft's own velocity.
- Target box: corner brackets sized to the drawn target, its designation above, its range and
  closure, an HP bar under it, and IN RNG / OUT RNG. Off screen, an arrow at the frame edge points to it.
- Lead marker: a diamond where the target will be when the rounds arrive, tied to the box by a
  dashed line, with an arc that empties as the range closes. Doubled when the reticle is on it.
- ASSIST under the reticle while aim assist is moving the stick (or, under mouse aim, the aim).
- Lock colour, the only colour on the glass besides phosphor green (user request 23 Oct 2026):
  the lead marker turns amber while aim assist has captured it and red once the reticle sits
  on it with the target in range, where rounds fired now hit. The mouse-aim × takes the same
  colour (hudPainter.ts). It only tells: rounds never steer and hitboxes never grow (doc 07).
- Hit: ticks flare off the box corners for a moment after each confirmed hit. SPLASH where
  the target went down. Both are timed in simulation ticks, so pause freezes them.
*/
import type { Camera, PerspectiveCamera } from 'three'
import { WORLD_STEP } from '../../game/runtime/clock'

type Vec3Like = { x: number; y: number; z: number }
type Point = { x: number; y: number }

export interface GunneryMarks {
  /** Where rounds fired now will be (world). */
  reticle: Vec3Like | null
  target: {
    position: Vec3Like
    /** Metres: the hitbox bounding radius times the distance scale the model is drawn at. */
    radius: number
    range: number
    /** m/s, positive while the range shrinks. */
    closure: number
    /** 0–1 */
    hp: number
    /** Designation, e.g. "DRONE · SU-57". */
    label: string
  } | null
  /** Where the target will be when the rounds arrive (world); null without a reachable solution. */
  lead: Vec3Like | null
  inRange: boolean
  /** The reticle is on the lead marker, within the target's size. */
  onSolution: boolean
  /** Simulation time now and of the last hit / kill, in ticks (may be fractional between ticks). */
  now: number
  hitTick: number | null
  splash: { tick: number; position: Vec3Like } | null
  /** Aim assist acted on the last command. */
  assist: boolean
  /** Free, captured by aim assist, or locked: the reticle on the lead in range (gunneryFrame.ts). */
  lock: 'free' | 'captured' | 'locked'
}

export interface Pen {
  ctx: CanvasRenderingContext2D
  line(x1: number, y1: number, x2: number, y2: number, lineWidth?: number, color?: string): void
  luminous(paint: () => void, lineWidth: number, color: string, bloom?: string): void
  text(value: string, x: number, y: number, font: string, color?: string, align?: CanvasTextAlign, baseline?: CanvasTextBaseline): void
  project(point: Vec3Like): Point | null
  /** A point off the frame clamped to its edge, with the outward angle; null when on screen. */
  edge(from: Vec3Like, toward: Vec3Like): { x: number; y: number; angle: number } | null
  font(size: number, weight?: number): string
  green: string; dim: string; bright: string
  /** Lock colours, each with its own bloom so it glows its own colour. */
  captured: { color: string; bloom: string }; locked: { color: string; bloom: string }
}

const HIT_SECONDS = 0.25, SPLASH_SECONDS = 1.6
const MAX_ARC_RANGE = 1000

export function drawGunnery(pen: Pen, marks: GunneryMarks, camera: Camera, height: number, shooter: Vec3Like) {
  const { ctx } = pen
  const focal = height / 2 / Math.tan(((camera as PerspectiveCamera).fov ?? 60) * Math.PI / 360)
  const box = marks.target ? drawTarget(pen, marks, marks.target, focal, shooter) : null
  if (marks.lead) drawLead(pen, marks, box)
  if (marks.reticle) drawReticle(pen, marks.reticle, marks.assist)
  drawSplash(pen, marks)
  ctx.setLineDash([])
}

function drawReticle(pen: Pen, point: Vec3Like, assist: boolean) {
  const at = pen.project(point)
  if (!at) return
  // Larger than the nose pipper and the -W-, so in level flight it rings them instead of piling onto them.
  const r = 17, { ctx } = pen
  // Four arcs with gaps at the cardinal points, so it never reads as the nose pipper's full ring.
  pen.luminous(() => {
    ctx.beginPath()
    for (let quarter = 0; quarter < 4; quarter++) {
      const start = quarter * Math.PI / 2 + 0.28, end = (quarter + 1) * Math.PI / 2 - 0.28
      ctx.moveTo(at.x + r * Math.cos(start), at.y + r * Math.sin(start))
      ctx.arc(at.x, at.y, r, start, end)
    }
    ctx.stroke()
  }, 1.6, pen.green)
  pen.luminous(() => { ctx.beginPath(); ctx.arc(at.x, at.y, 1.2, 0, Math.PI * 2); ctx.stroke() }, 2.2, pen.bright)
  // The assist is never hidden: it is named under the reticle while it moves the stick.
  if (assist) pen.text('ASSIST', at.x, at.y + r + 12, pen.font(11, 700), pen.dim, 'center')
}

function drawTarget(pen: Pen, marks: GunneryMarks, target: NonNullable<GunneryMarks['target']>, focal: number, shooter: Vec3Like) {
  const at = pen.project(target.position)
  const off = pen.edge(shooter, target.position)
  const range = `${(target.range / 1000).toFixed(2)} KM`
  if (!at || off) {
    // Off the frame: an arrow on the edge toward it, with its range.
    const edge = off ?? { x: 0, y: 0, angle: 0 }
    const { ctx } = pen
    ctx.save()
    ctx.translate(edge.x, edge.y)
    ctx.rotate(edge.angle)
    pen.luminous(() => { ctx.beginPath(); ctx.moveTo(-14, -8); ctx.lineTo(0, 0); ctx.lineTo(-14, 8); ctx.closePath(); ctx.stroke() }, 1.6, pen.green)
    ctx.restore()
    pen.text(range, edge.x - Math.cos(edge.angle) * 30, edge.y - Math.sin(edge.angle) * 22, pen.font(12, 700), pen.green, 'center')
    return null
  }
  const half = Math.min(90, Math.max(13, target.radius / Math.max(1, target.range) * focal * 1.15))
  const arm = Math.max(6, half * 0.42)
  const flash = marks.hitTick !== null && (marks.now - marks.hitTick) * WORLD_STEP < HIT_SECONDS
  const color = flash ? pen.bright : pen.green
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    const x = at.x + sx * half, y = at.y + sy * half
    pen.line(x, y, x - sx * arm, y, 1.6, color)
    pen.line(x, y, x, y - sy * arm, 1.6, color)
    // Confirmed hit: a tick flares outward from each corner.
    if (flash) pen.line(x + sx * 4, y + sy * 4, x + sx * 12, y + sy * 12, 2, pen.bright)
  }
  // Who it is above the box; range and closure to the right, the gun's verdict under them.
  pen.text(target.label, at.x, at.y - half - 7, pen.font(12, 700), color, 'center', 'bottom')
  const labelX = at.x + half + 8
  pen.text(range, labelX, at.y - half + 6, pen.font(13, 700), pen.green)
  pen.text(`${target.closure >= 0 ? '+' : '−'}${Math.abs(Math.round(target.closure))} M/S`, labelX, at.y - half + 22, pen.font(11), pen.dim)
  pen.text(marks.inRange ? 'IN RNG' : 'OUT RNG', labelX, at.y - half + 37, pen.font(11, 700), marks.inRange ? pen.green : pen.dim)
  // HP: a dim track with the remaining share over it, as strokes (the glass has no fills).
  const barY = at.y + half + 8, barWidth = Math.max(44, half * 2)
  const barX = at.x - barWidth / 2
  pen.line(barX, barY, barX + barWidth, barY, 1, pen.dim)
  if (target.hp > 0) pen.line(barX, barY, barX + barWidth * target.hp, barY, 3.4, color)
  return { x: at.x, y: at.y, half }
}

function drawLead(pen: Pen, marks: GunneryMarks, box: { x: number; y: number; half: number } | null) {
  const at = pen.project(marks.lead!)
  if (!at) return
  const { ctx } = pen, s = 7
  const lock = marks.lock === 'free' ? null : pen[marks.lock]
  const color = lock?.color ?? (marks.inRange ? pen.bright : pen.dim), bloom = lock?.bloom
  // Dashed tie to the box, so the eye knows whose lead it is.
  if (box && Math.hypot(at.x - box.x, at.y - box.y) > box.half + s * 2) {
    const dx = at.x - box.x, dy = at.y - box.y, d = Math.hypot(dx, dy)
    ctx.setLineDash([3, 4])
    pen.line(box.x + dx / d * box.half, box.y + dy / d * box.half, at.x - dx / d * (s + 4), at.y - dy / d * (s + 4), 1, pen.dim)
    ctx.setLineDash([])
  }
  const diamond = (size: number) => { ctx.beginPath(); ctx.moveTo(at.x, at.y - size); ctx.lineTo(at.x + size, at.y); ctx.lineTo(at.x, at.y + size); ctx.lineTo(at.x - size, at.y); ctx.closePath(); ctx.stroke() }
  pen.luminous(() => diamond(s), lock ? 2 : 1.6, color, bloom)
  if (marks.onSolution) pen.luminous(() => diamond(s + 5), 1.6, color, bloom)
  // Range arc: full at 1,000 m and beyond, empty at the target.
  const share = Math.min(1, (marks.target?.range ?? MAX_ARC_RANGE) / MAX_ARC_RANGE)
  pen.luminous(() => { ctx.beginPath(); ctx.arc(at.x, at.y, s + 10, -Math.PI / 2, -Math.PI / 2 + share * Math.PI * 2); ctx.stroke() }, 1.4, color, bloom)
}

function drawSplash(pen: Pen, marks: GunneryMarks) {
  if (!marks.splash || (marks.now - marks.splash.tick) * WORLD_STEP >= SPLASH_SECONDS) return
  const at = pen.project(marks.splash.position)
  if (at) pen.text('SPLASH', at.x, at.y - 26, pen.font(18, 700), pen.bright, 'center')
}
