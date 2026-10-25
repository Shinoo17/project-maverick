/*
The radar scope at the bottom left (doc 12): a map of what the player's sensors show.
THESIS: A heading-up scope beside the glass, in the weapon column's off-white line art.
OWN-WORLD: Off-white rings and the radar cone on a dark disc; enemies are red diamonds, the one
locked is boxed and named; nothing glows and nothing fills but the faint cone.
STORY: The jet sits in the middle pointing up. The wedge is what the radar paints: anything inside
it can be locked. Outside it only the lock (for its grace time) and aircraft within visual range
show, dashed. Contacts beyond the scope ride its rim. The dashed arc is the range boundary.
MOTION: Redrawn every frame from the render loop, never through React state. Only the lock's
"LOST IN" countdown blinks, timed in simulation seconds so pause freezes it.

Framework-free like hudPainter: one canvas, one draw call.
*/
import type { RadarPicture } from '../../render/radarFrame'
import { trainingMap } from '../../content/maps'

/** Metres from the middle to the rim. Provisional: a gun fight lives inside 2 km, a merge starts at 3. */
export const SCOPE_RANGE = 5000
const INK = '#f2f4ee', DIM = 'rgba(242, 244, 238, 0.62)', FAINT = 'rgba(242, 244, 238, 0.18)', HOSTILE = '#ff5c5c', HOSTILE_DIM = 'rgba(255, 92, 92, 0.6)'
const FONT = '"Barlow Condensed", "IBM Plex Sans Thai", "Arial Narrow", sans-serif'
/** Above or below by more than this (metres), a contact carries an up or down tick. */
const LEVEL_BAND = 150
const radians = Math.PI / 180

export function createRadarPainter(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')!
  let size = 0, ratio = 1

  function resize(width: number, pixelRatio: number) {
    size = width; ratio = pixelRatio
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(width * ratio)
  }

  function text(value: string, x: number, y: number, px: number, color: string, align: CanvasTextAlign = 'left', weight = 600) {
    ctx.font = `${weight} ${px}px ${FONT}`
    ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle'
    ctx.shadowColor = 'rgba(0, 0, 0, 0.7)'; ctx.shadowBlur = 2 * ratio
    ctx.fillText(value, x, y)
    ctx.shadowBlur = 0
  }
  function stroke(color: string, width: number, dash: number[] = []) { ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash) }

  /** `seconds` is simulation time, for the countdown's blink. */
  function draw(picture: RadarPicture | null, seconds: number) {
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.clearRect(0, 0, size, size)
    if (!size) return
    const cx = size / 2, cy = size / 2 + 6, R = size / 2 - 22, scale = R / SCOPE_RANGE
    // Scope angle of a world heading: clockwise from straight up, nose up.
    const toScope = (bearing: number, metres: number) => {
      const a = (bearing - (picture?.heading ?? 0)) * radians
      return { x: cx + Math.sin(a) * metres * scale, y: cy - Math.cos(a) * metres * scale }
    }

    const disc = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R + 14)
    disc.addColorStop(0, 'rgba(4, 7, 10, 0.5)'); disc.addColorStop(1, 'rgba(4, 7, 10, 0)')
    ctx.fillStyle = disc
    ctx.beginPath(); ctx.arc(cx, cy, R + 14, 0, Math.PI * 2); ctx.fill()
    stroke(FAINT, 1); ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke()
    stroke(FAINT, 1, [2, 4]); ctx.beginPath(); ctx.arc(cx, cy, R / 2, 0, Math.PI * 2); ctx.stroke()
    text('RDR', 8, 10, 12, INK, 'left', 700)
    text(`${SCOPE_RANGE / 1000} KM`, size - 8, 10, 11, DIM, 'right')
    text(`${SCOPE_RANGE / 2000}`, cx + 3, cy - R / 2 - 6, 9, DIM)
    if (!picture) { text('—', cx, cy, 16, DIM, 'center'); ctx.setLineDash([]); return }

    // The radar cone: what can be painted and locked.
    if (picture.coneDeg < 180) {
      const reach = Math.min(R, picture.rangeM * scale), half = picture.coneDeg * radians
      ctx.fillStyle = 'rgba(242, 244, 238, 0.05)'
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, reach, -Math.PI / 2 - half, -Math.PI / 2 + half); ctx.closePath(); ctx.fill()
      stroke(DIM, 1)
      for (const side of [-1, 1]) { ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.sin(side * half) * reach, cy - Math.cos(side * half) * reach); ctx.stroke() }
    }
    // North on the rim, and the range boundary where it comes inside the scope.
    const north = toScope(0, SCOPE_RANGE)
    text('N', cx + (north.x - cx) * 1.13, cy + (north.y - cy) * 1.13, 11, DIM, 'center', 700)
    ctx.save()
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip()
    const centre = toScope(Math.atan2(-picture.position.z, -picture.position.x) / radians, Math.hypot(picture.position.x, picture.position.z))
    stroke(HOSTILE_DIM, 1.2, [6, 5]); ctx.beginPath(); ctx.arc(centre.x, centre.y, trainingMap.radius * scale, 0, Math.PI * 2); ctx.stroke()
    ctx.restore()
    // The player: a chevron pointing up.
    stroke(INK, 1.6, [])
    ctx.beginPath(); ctx.moveTo(cx - 6, cy + 6); ctx.lineTo(cx, cy - 7); ctx.lineTo(cx + 6, cy + 6); ctx.lineTo(cx, cy + 3); ctx.closePath(); ctx.stroke()

    const ordered = [...picture.contacts].sort((a, b) => Number(a.locked) - Number(b.locked))
    for (const contact of ordered) {
      const flat = Math.hypot(contact.position.x - picture.position.x, contact.position.z - picture.position.z)
      const color = contact.painted || contact.locked ? HOSTILE : HOSTILE_DIM
      if (flat > SCOPE_RANGE) {
        // Beyond the scope: a small arrow on the rim, pointing out.
        const at = toScope(contact.bearing, SCOPE_RANGE), a = Math.atan2(at.y - cy, at.x - cx)
        ctx.save(); ctx.translate(at.x, at.y); ctx.rotate(a)
        stroke(color, 1.6, []); ctx.beginPath(); ctx.moveTo(-5, -4); ctx.lineTo(2, 0); ctx.lineTo(-5, 4); ctx.stroke()
        ctx.restore()
        if (contact.locked) lockLabel(contact, at.x, at.y)
        continue
      }
      const at = toScope(contact.bearing, flat), s = 5
      // Painted: a solid diamond outline. Seen only by eye: dashed.
      stroke(color, 1.7, contact.painted || contact.locked ? [] : [2, 2])
      ctx.beginPath(); ctx.moveTo(at.x, at.y - s); ctx.lineTo(at.x + s, at.y); ctx.lineTo(at.x, at.y + s); ctx.lineTo(at.x - s, at.y); ctx.closePath(); ctx.stroke()
      if (Math.abs(contact.above) > LEVEL_BAND) {
        const up = contact.above > 0, y = up ? at.y - s - 4 : at.y + s + 4
        stroke(color, 1.4, []); ctx.beginPath(); ctx.moveTo(at.x - 3, y + (up ? 2 : -2)); ctx.lineTo(at.x, y + (up ? -2 : 2)); ctx.lineTo(at.x + 3, y + (up ? 2 : -2)); ctx.stroke()
      }
      if (contact.locked) {
        // The lock: a square around it (shape, not only colour) and its name and range.
        stroke(HOSTILE, 1.4, []); ctx.strokeRect(at.x - 9, at.y - 9, 18, 18)
        lockLabel(contact, at.x, at.y)
      }
    }
    ctx.setLineDash([])
    // Bottom line: the lock, and its countdown once it is outside the radar cone.
    const locked = picture.contacts.find(contact => contact.locked)
    if (locked && picture.lock) {
      const left = picture.lock.grace - picture.lock.outside
      if (picture.lock.outside > 0) {
        if (Math.floor(seconds * 4) % 2 === 0) text(`LOST IN ${Math.max(0, left).toFixed(1)}`, cx, size - 6, 12, HOSTILE, 'center', 700)
      } else text(`LOCK · ${locked.designation}`, cx, size - 6, 12, HOSTILE, 'center', 700)
    }
  }
  function lockLabel(contact: RadarPicture['contacts'][number], x: number, y: number) {
    const right = x < size - 60
    text(`${(contact.range / 1000).toFixed(1)}`, x + (right ? 13 : -13), y, 11, INK, right ? 'left' : 'right', 700)
  }
  return { resize, draw }
}
