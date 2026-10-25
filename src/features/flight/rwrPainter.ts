/*
The RWR scope above the radar scope (doc 12): who is painting, locking and shooting at the player,
by bearing only (user decision 2026-10-25: never range).
THESIS: A classic threat azimuth display in the radar scope's line art, smaller: the jet in the
middle pointing up, threats around it, the worse the closer in.
OWN-WORLD: Off-white rings and bearing ticks on a dark disc. Search is a dim number; a lock is the
number in amber inside a box; a launch is red in a diamond; a missile is a red M in a circle.
Nothing glows; colour and shape both carry the level.
STORY: Each threat sits on its level's ring at its bearing: search on the outer ring, missiles on
the inner. The level shown right now is printed above the scope. A symbol whose emitter has gone
quiet fades over a couple of seconds (rwrFrame.ts).
MOTION: Redrawn every frame from the render loop. Launch and missile symbols blink at 4 Hz,
timed in simulation seconds so pause freezes them.

Framework-free like radarPainter: one canvas.
*/
import type { RwrDisplay, RwrMark } from '../../render/rwrFrame'
import type { ThreatLevel } from '../../game/combat/rwr'

const DIM = 'rgba(242, 244, 238, 0.62)', FAINT = 'rgba(242, 244, 238, 0.18)', CAUTION = '#ffd08a', HOSTILE = '#ff5c5c'
const FONT = '"Barlow Condensed", "IBM Plex Sans Thai", "Arial Narrow", sans-serif'
/** Share of the scope's radius each level sits at. */
const RING: Record<ThreatLevel, number> = { search: 0.86, lock: 0.66, launch: 0.46, missile: 0.3 }
const WORD: Record<ThreatLevel, string> = { search: 'SEARCH', lock: 'LOCK', launch: 'LAUNCH', missile: 'MISSILE' }
const COLOR: Record<ThreatLevel, string> = { search: DIM, lock: CAUTION, launch: HOSTILE, missile: HOSTILE }
const radians = Math.PI / 180

export function createRwrPainter(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')!
  let size = 0, ratio = 1

  function resize(width: number, pixelRatio: number) {
    size = width; ratio = pixelRatio
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(width * ratio)
  }
  function text(value: string, x: number, y: number, px: number, color: string, weight = 700) {
    ctx.font = `${weight} ${px}px ${FONT}`
    ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.shadowColor = 'rgba(0, 0, 0, 0.7)'; ctx.shadowBlur = 2 * ratio
    ctx.fillText(value, x, y)
    ctx.shadowBlur = 0
  }

  function symbol(mark: RwrMark, x: number, y: number) {
    const color = COLOR[mark.level]
    ctx.strokeStyle = color; ctx.lineWidth = 1.4; ctx.setLineDash([])
    ctx.beginPath()
    if (mark.level === 'lock') ctx.rect(x - 9, y - 7, 18, 14)
    else if (mark.level === 'launch') { ctx.moveTo(x, y - 11); ctx.lineTo(x + 11, y); ctx.lineTo(x, y + 11); ctx.lineTo(x - 11, y); ctx.closePath() }
    else if (mark.level === 'missile') ctx.arc(x, y, 8, 0, Math.PI * 2)
    if (mark.level !== 'search') ctx.stroke()
    text(mark.label, x, y + 0.5, mark.level === 'search' ? 12 : 11, color)
  }

  /** `seconds` is simulation time, for the blink. */
  function draw(display: RwrDisplay | null, seconds: number) {
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.clearRect(0, 0, size, size)
    if (!size) return
    const cx = size / 2, cy = size / 2 + 7, R = size / 2 - 16
    const disc = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R + 10)
    disc.addColorStop(0, 'rgba(4, 7, 10, 0.5)'); disc.addColorStop(1, 'rgba(4, 7, 10, 0)')
    ctx.fillStyle = disc
    ctx.beginPath(); ctx.arc(cx, cy, R + 10, 0, Math.PI * 2); ctx.fill()
    // Rings and a tick every 30°, with the nose and tail ticks longer.
    ctx.strokeStyle = FAINT; ctx.lineWidth = 1; ctx.setLineDash([])
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke()
    ctx.setLineDash([2, 4]); ctx.beginPath(); ctx.arc(cx, cy, R * 0.56, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([])
    for (let deg = 0; deg < 360; deg += 30) {
      const a = deg * radians, inner = deg % 180 === 0 ? R - 7 : R - 4
      ctx.beginPath(); ctx.moveTo(cx + Math.sin(a) * inner, cy - Math.cos(a) * inner); ctx.lineTo(cx + Math.sin(a) * R, cy - Math.cos(a) * R); ctx.stroke()
    }
    // The jet, nose up.
    ctx.strokeStyle = DIM; ctx.lineWidth = 1.2
    ctx.beginPath(); ctx.moveTo(cx, cy - 6); ctx.lineTo(cx, cy + 6); ctx.moveTo(cx - 5, cy + 1); ctx.lineTo(cx + 5, cy + 1); ctx.moveTo(cx - 2.5, cy + 6); ctx.lineTo(cx + 2.5, cy + 6); ctx.stroke()

    text('RWR', 12, 9, 10, DIM, 600)
    const top = display?.top ?? null
    const blinkOff = Math.floor(seconds * 8) % 2 === 1
    if (top) {
      ctx.globalAlpha = (top === 'launch' || top === 'missile') && blinkOff ? 0.35 : 1
      text(WORD[top], size / 2, 9, 12, COLOR[top])
      ctx.globalAlpha = 1
    }
    for (const mark of display?.marks ?? []) {
      const a = mark.bearing * radians, r = R * RING[mark.level]
      const x = cx + Math.sin(a) * r, y = cy - Math.cos(a) * r
      const blinking = (mark.level === 'launch' || mark.level === 'missile') && mark.strength >= 1 && blinkOff
      ctx.globalAlpha = Math.max(0, mark.strength) * (blinking ? 0.35 : 1)
      symbol(mark, x, y)
    }
    ctx.globalAlpha = 1
  }
  return { resize, draw }
}
