/*
The HUD glass, ported from the reference implementation's canvas painter
(example/F22/src/features/flight-range/hud.js) so the training range reads the same way.
Framework-free: it owns one 2D canvas and one `draw(state)` call; FlightInstruments calls it
from the render loop, never through React state.

Anything attitude-shaped — the pitch ladder, the nose pipper — is projected from world space
through the scene camera, so it stays registered with the ground. Anything scale-shaped — the
tapes, the boxed readouts, the status block — is screen-fixed.

One phosphor-green family. Brightness, opacity and shape carry hierarchy; a wider translucent
green pass under every mark keeps it legible over sky and ground without a CSS filter, so
nothing is recomposited when the frame changes.
*/
import { MathUtils, Vector3, type Camera } from 'three'

const HUD_GREEN = 'rgba(98, 255, 132, 0.98)'
const HUD_GREEN_DIM = 'rgba(98, 255, 132, 0.66)'
const HUD_GREEN_CAUTION = 'rgba(98, 255, 132, 0.84)'
const HUD_GREEN_ALERT = 'rgba(122, 255, 151, 1)'
const HUD_BLOOM = 'rgba(48, 255, 104, 0.24)'
const DISPLAY = '"DIN Alternate", "Arial Narrow", "Aptos Narrow", sans-serif'

type Tape = { minor: number; major: number; span: number }
type Point = { x: number; y: number }
type Vec3Like = { x: number; y: number; z: number }

// A span in value units fixes tick density whatever the frame height.
const SPEED_TAPE: Tape = { minor: 100, major: 500, span: 1400 }
const ALTITUDE_TAPE: Tape = { minor: 100, major: 500, span: 3800 }
const HEADING_HALF_SPAN = 26

// Rungs every 5° out to ±60, each a real pair of world points 6 km ahead of the aircraft.
const LADDER_STEP = 5
const LADDER_LIMIT = 60
const LADDER_DISTANCE = 6000
const LADDER_HALF_SPAN = 0.15
const LADDER_GAP = 0.2

const VERTICAL_SPEED_FULL_SCALE = 60
const CLEARANCE_FULL_SCALE = 600
const EDGE_CAUTION = 620
const RESERVE_CAUTION = 0.25
// The heading readout sits above its own tape; this keeps it under the identity and pause plates.
const TOP_CLEARANCE = 100

export type BurnerState = 'ready' | 'engaged' | 'depleted' | 'inhibited' | 'recharging'
const AFTERBURNER_LABELS: Record<BurnerState, string> = {
  ready: 'A/B', engaged: 'A/B·ON', depleted: 'A/B·CLD', inhibited: 'A/B·INH', recharging: 'A/B·CHG',
}

export interface GlassState {
  live: boolean
  camera: Camera | null
  position: Vec3Like
  forward: Vec3Like
  velocity: Vec3Like
  /** ARCADE km/h */
  speed: number
  /** Metres above the flat range. */
  altitude: number
  heading: number | null
  pitch: number
  bank: number | null
  verticalSpeed: number
  aoa: number
  gLoad: number
  power: number
  groundClearance: number
  /** Metres to the nearest training boundary. */
  edge: number
  burnerReserve: number
  burnerSeconds: number
  burnerState: BurnerState
  airbrake: boolean
  highG: boolean
  psm: boolean
}

/*
Proportional to the frame: a half-frame of min(42% width, 72% height) sets tape spacing,
ladder width and the heading tape's rise. `compact` is a narrow window where the status
columns run to the edges; `tight` is a crowded one where they stack.
*/
export function glassLayout(width: number, height: number) {
  const half = Math.min(width * 0.42, height * 0.72)
  const compact = width <= 760
  const tight = !compact && (height <= 720 || width <= 1100)
  const tapeHeight = Math.min(height * 0.42, half * 0.95)
  const cx = width / 2, cy = height / 2
  const rise = Math.min(Math.max(half * 0.58, height * 0.3), cy - TOP_CLEARANCE)
  // How far below its first row the status block still draws.
  const depth = tight ? 86 : compact ? 104 : 42
  const statusFirst = Math.min(cy + tapeHeight / 2 + 46, height - depth - 14)
  return {
    width, height, cx, cy, half, compact, tight, tapeHeight, rise,
    tapeOffset: compact ? 0.62 : 0.72,
    ladderTop: cy - (rise - 34),
    ladderBottom: cy + tapeHeight / 2 + 22,
    statusFirst,
    // The HTML advisory plate: under the status block, or beside the stacked column when crowded.
    advisoryTop: tight ? statusFirst - 14 : Math.min(statusFirst + depth + 18, height - 40),
    advisoryLeft: tight ? cx + 24 : cx,
    advisoryCentred: !tight,
  }
}
export type GlassLayout = ReturnType<typeof glassLayout>

const WORLD_UP = new Vector3(0, 1, 0)
const projected = new Vector3(), scratch = new Vector3(), across = new Vector3()
const level = new Vector3(), ladderDir = new Vector3(), centre = new Vector3()

// Points behind the lens return null rather than folding back into view.
export function projectPoint(camera: Camera, point: Vec3Like, width: number, height: number): Point | null {
  projected.set(point.x, point.y, point.z).applyMatrix4(camera.matrixWorldInverse)
  if (projected.z > -0.5) return null
  projected.applyMatrix4(camera.projectionMatrix)
  return { x: (projected.x * 0.5 + 0.5) * width, y: (-projected.y * 0.5 + 0.5) * height }
}

/** Flight-path marker in CSS pixels; angle points outward from screen centre.
 * A directly aft vector has no unique edge direction, so it uses the bottom edge.
 */
export function projectVelocityMarker(camera: Camera, position: Vec3Like, velocity: Vec3Like, width: number, height: number, inset: number) {
  const path = new Vector3().copy(velocity)
  if (path.length() < 1) return null
  const point = path.normalize().multiplyScalar(4000).add(position)
  const view = point.clone().applyMatrix4(camera.matrixWorldInverse)
  const front = projectPoint(camera, point, width, height)
  const margin = Math.max(0, Math.min(inset, width / 2, height / 2))
  const cx = width / 2, cy = height / 2
  const onScreen = !!front && front.x >= margin && front.x <= width - margin && front.y >= margin && front.y <= height - margin
  let dx = front ? front.x - cx : view.x
  let dy = front ? front.y - cy : -view.y
  if (Math.hypot(dx, dy) < 1e-9) { dx = 0; dy = 1 }
  const angle = Math.atan2(dy, dx)
  if (onScreen) return { ...front!, onScreen: true, angle }
  const scale = Math.min(dx === 0 ? Infinity : (cx - margin) / Math.abs(dx), dy === 0 ? Infinity : (cy - margin) / Math.abs(dy))
  return { x: MathUtils.clamp(cx + dx * scale, margin, width - margin), y: MathUtils.clamp(cy + dy * scale, margin, height - margin), onScreen: false, angle }
}

// One rung's screen endpoints. The rung plane follows the nose's ground track, not its
// pitch, so it banks and slides with the world rather than with the airframe.
export function projectRung(camera: Camera, position: Vec3Like, forward: Vec3Like, angle: number, width: number, height: number) {
  level.set(forward.x, 0, forward.z)
  if (level.lengthSq() < 1e-6) return null
  level.normalize()
  across.crossVectors(level, WORLD_UP).normalize()
  const radians = MathUtils.degToRad(angle)
  ladderDir.copy(level).multiplyScalar(Math.cos(radians)).addScaledVector(WORLD_UP, Math.sin(radians))
  centre.set(position.x, position.y, position.z).addScaledVector(ladderDir, LADDER_DISTANCE)
  const span = LADDER_DISTANCE * LADDER_HALF_SPAN * (angle === 0 ? 1.7 : 1)
  const left = projectPoint(camera, scratch.copy(centre).addScaledVector(across, -span), width, height)
  const right = projectPoint(camera, scratch.copy(centre).addScaledVector(across, span), width, height)
  return left && right ? { left, right } : null
}

const display = (size: number, weight = 600) => `${weight} ${size}px ${DISPLAY}`
const pad = (value: number, width: number) => String(Math.max(0, Math.round(value))).padStart(width, '0')
const signed = (value: number) => {
  const rounded = Math.round(value)
  return `${rounded > 0 ? '+' : rounded < 0 ? '−' : ''}${Math.abs(rounded)}`
}
function headingLabel(value: number) {
  const heading = MathUtils.euclideanModulo(value, 360)
  if (heading === 0) return 'N'
  if (heading === 90) return 'E'
  if (heading === 180) return 'S'
  if (heading === 270) return 'W'
  return pad(Math.round(heading / 10) % 36, 2)
}

export function createGlassPainter(canvas: HTMLCanvasElement, { speedBand }: { speedBand: { min: number; max: number } | null }) {
  const ctx = canvas.getContext('2d')!
  let width = 0, height = 0
  let layout = glassLayout(1, 1)

  function resize(cssWidth: number, cssHeight: number, pixelRatio: number) {
    width = cssWidth; height = cssHeight
    canvas.width = Math.max(1, Math.floor(cssWidth * pixelRatio))
    canvas.height = Math.max(1, Math.floor(cssHeight * pixelRatio))
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    layout = glassLayout(cssWidth, cssHeight)
    return layout
  }

  // Every stroke goes down twice: a broad translucent phosphor pass, then the crisp mark.
  function luminous(paint: () => void, lineWidth: number, color: string) {
    ctx.lineWidth = lineWidth + 2.4
    ctx.strokeStyle = HUD_BLOOM
    paint()
    ctx.lineWidth = lineWidth
    ctx.strokeStyle = color
    paint()
  }
  function line(x1: number, y1: number, x2: number, y2: number, lineWidth = 1.4, color = HUD_GREEN) {
    luminous(() => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke() }, lineWidth, color)
  }
  function pitchLine(x1: number, y1: number, x2: number, y2: number, lineWidth: number, color: string) {
    const paint = () => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke() }
    ctx.lineWidth = lineWidth + 3
    ctx.strokeStyle = HUD_BLOOM
    paint()
    ctx.lineWidth = lineWidth
    ctx.strokeStyle = color
    paint()
  }
  function box(x: number, y: number, w: number, h: number, lineWidth = 1.5, color = HUD_GREEN) {
    luminous(() => { ctx.beginPath(); ctx.rect(x, y, w, h); ctx.stroke() }, lineWidth, color)
  }
  function text(value: string, x: number, y: number, font: string, color = HUD_GREEN, align: CanvasTextAlign = 'left', baseline: CanvasTextBaseline = 'middle') {
    ctx.font = font
    ctx.textAlign = align
    ctx.textBaseline = baseline
    ctx.lineWidth = 3.2
    ctx.lineJoin = 'round'
    ctx.strokeStyle = HUD_BLOOM
    ctx.strokeText(value, x, y)
    ctx.fillStyle = color
    ctx.fillText(value, x, y)
  }
  function pitchText(value: string, x: number, y: number, align: CanvasTextAlign) {
    ctx.font = display(12)
    ctx.textAlign = align
    ctx.textBaseline = 'middle'
    ctx.lineWidth = 2.4
    ctx.lineJoin = 'round'
    ctx.strokeStyle = HUD_BLOOM
    ctx.strokeText(value, x, y)
    ctx.fillStyle = HUD_GREEN_DIM
    ctx.fillText(value, x, y)
  }

  // --- Sightline --------------------------------------------------------------
  // Dashed below the horizon, solid above, ticks hanging toward the horizon.
  function drawLadder(state: GlassState, camera: Camera) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(layout.cx - layout.half * 0.62, layout.ladderTop, layout.half * 1.24, layout.ladderBottom - layout.ladderTop)
    ctx.clip()
    for (let angle = -LADDER_LIMIT; angle <= LADDER_LIMIT; angle += LADDER_STEP) {
      const rung = projectRung(camera, state.position, state.forward, angle, width, height)
      if (!rung) continue
      const { left, right } = rung
      const isHorizon = angle === 0
      const dx = right.x - left.x, dy = right.y - left.y
      const length = Math.hypot(dx, dy)
      if (length < 12 || length > layout.half * 12) continue
      const ux = dx / length, uy = dy / length
      const gap = isHorizon ? length * 0.05 : length * LADDER_GAP
      const tick = isHorizon ? 0 : (angle > 0 ? 1 : -1) * length * 0.06
      const midX = (left.x + right.x) / 2, midY = (left.y + right.y) / 2
      const color = isHorizon ? HUD_GREEN : HUD_GREEN_DIM
      const weight = isHorizon ? 2.2 : 1.7
      ctx.setLineDash(angle < 0 ? [7, 6] : [])
      for (const side of [-1, 1]) {
        const innerX = midX + ux * gap * side, innerY = midY + uy * gap * side
        const outerX = midX + ux * (length / 2) * side, outerY = midY + uy * (length / 2) * side
        pitchLine(innerX, innerY, outerX, outerY, weight, color)
        if (tick) pitchLine(outerX, outerY, outerX - uy * tick, outerY + ux * tick, weight, color)
      }
      ctx.setLineDash([])
      // Both ends carry the number, rotated onto the rung.
      if (!isHorizon && angle % 10 === 0) {
        const angleOnScreen = Math.atan2(dy, dx)
        for (const side of [-1, 1]) {
          ctx.save()
          ctx.translate(midX + ux * side * (length / 2 + 14), midY + uy * side * (length / 2 + 14))
          ctx.rotate(angleOnScreen)
          pitchText(String(Math.abs(angle)), 0, 0, side === 1 ? 'left' : 'right')
          ctx.restore()
        }
      }
    }
    ctx.restore()
  }

  // Nose cross and winged flight-path circle remain distinct during high incidence.
  function drawNosePipper(state: GlassState, camera: Camera) {
    const point = projectPoint(camera, scratch.set(state.forward.x, state.forward.y, state.forward.z).multiplyScalar(4000).add(state.position), width, height)
    if (!point) return
    const { x: cx, y: cy } = point
    const r = Math.max(layout.half * 0.018, 6)
    ctx.lineWidth = 1.6
    ctx.strokeStyle = HUD_GREEN
    ctx.beginPath()
    ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy)
    ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r)
    ctx.stroke()
  }

  function drawVelocityMarker(state: GlassState, camera: Camera) {
    const point = projectVelocityMarker(camera, state.position, state.velocity, width, height, 24)
    if (!point) return
    const { x, y, onScreen, angle } = point
    const r = Math.max(layout.half * 0.018, 6)
    ctx.save()
    ctx.translate(x, y)
    ctx.lineWidth = 1.6
    ctx.strokeStyle = HUD_GREEN
    ctx.beginPath()
    if (onScreen) {
      ctx.arc(0, 0, r, 0, Math.PI * 2)
      ctx.moveTo(-r, 0); ctx.lineTo(-r * 2.6, 0)
      ctx.moveTo(r, 0); ctx.lineTo(r * 2.6, 0)
      ctx.moveTo(0, -r); ctx.lineTo(0, -r * 2.2)
    } else {
      ctx.rotate(angle)
      ctx.moveTo(-10, -6); ctx.lineTo(0, 0); ctx.lineTo(-10, 6)
    }
    ctx.stroke()
    ctx.restore()
  }

  // --- Tapes ------------------------------------------------------------------
  function drawTape({ x, value, side, tape, label, subreadout, live, digits, band }: {
    x: number; value: number; side: 'left' | 'right'; tape: Tape; label: string; subreadout?: string; live: boolean; digits: number; band?: { min: number; max: number } | null
  }) {
    const top = layout.cy - layout.tapeHeight / 2
    const bottom = layout.cy + layout.tapeHeight / 2
    const dir = side === 'left' ? -1 : 1
    const pixelsPerUnit = layout.tapeHeight / tape.span

    line(x, top, x, bottom, 1.4)

    // The PSM entry band as a bracket inboard of the rail; it brightens when the aircraft is inside.
    if (live && band) {
      const bandTop = layout.cy - (band.max - value) * pixelsPerUnit
      const bandBottom = layout.cy - (band.min - value) * pixelsPerUnit
      const y1 = Math.max(top, Math.min(bottom, bandTop))
      const y2 = Math.max(top, Math.min(bottom, bandBottom))
      if (y2 - y1 > 1) {
        const bandX = x - dir * 6
        const inside = value >= band.min && value <= band.max
        const color = inside ? HUD_GREEN : HUD_GREEN_DIM
        line(bandX, y1, bandX, y2, inside ? 3 : 2, color)
        if (bandTop >= top) line(bandX, y1, bandX - dir * 5, y1, 1.4, color)
        if (bandBottom <= bottom) line(bandX, y2, bandX - dir * 5, y2, 1.4, color)
      }
    }

    if (live) {
      ctx.save()
      ctx.beginPath()
      ctx.rect(Math.min(x, x + dir * 64), top, 64, layout.tapeHeight)
      ctx.clip()
      const range = tape.span / 2
      const first = Math.ceil((value - range) / tape.minor) * tape.minor
      for (let v = first; v <= value + range; v += tape.minor) {
        if (v < 0) continue
        const y = layout.cy - (v - value) * pixelsPerUnit
        if (Math.abs(y - layout.cy) < 15) continue
        const isMajor = Math.abs(v % tape.major) < tape.minor * 0.01
        const length = isMajor ? 13 : 7
        line(x, y, x + dir * length, y, isMajor ? 1.4 : 1.2, isMajor ? HUD_GREEN : HUD_GREEN_DIM)
        // Nor under the sub-readout hanging beneath the box.
        const underSubreadout = !!subreadout && y > layout.cy && y - layout.cy < 46
        if (isMajor && Math.abs(y - layout.cy) > 26 && !underSubreadout) {
          text(String(Math.round(v)), x + dir * (length + 6), y, display(12), HUD_GREEN_DIM, side === 'left' ? 'right' : 'left')
        }
      }
      ctx.restore()
    }

    // Current value, in a box that points back at the scale it came from.
    const boxW = digits >= 5 ? 80 : 66
    const boxH = 24
    const boxX = side === 'left' ? x - boxW - 10 : x + 10
    box(boxX, layout.cy - boxH / 2, boxW, boxH, 1.5)
    const tipX = side === 'left' ? boxX + boxW : boxX
    luminous(() => {
      ctx.beginPath()
      ctx.moveTo(tipX, layout.cy - 6)
      ctx.lineTo(tipX + dir * 9, layout.cy)
      ctx.lineTo(tipX, layout.cy + 6)
      ctx.stroke()
    }, 1.5, HUD_GREEN)
    text(live ? pad(value, digits) : '–'.repeat(digits), boxX + boxW / 2, layout.cy + 1, display(16, 700), HUD_GREEN, 'center')
    text(label, side === 'left' ? boxX : boxX + boxW, layout.cy - boxH / 2 - 11, display(10), HUD_GREEN_DIM, side === 'left' ? 'left' : 'right')
    if (subreadout) text(subreadout, boxX + boxW / 2, layout.cy + boxH / 2 + 10, display(11, 700), HUD_GREEN_DIM, 'center', 'top')
  }

  function drawHeadingTape(state: GlassState) {
    const y = layout.cy - layout.rise
    const halfW = layout.half * 0.5
    const pixelsPerDegree = halfW / HEADING_HALF_SPAN
    const heading = state.heading === null ? null : MathUtils.euclideanModulo(state.heading, 360)

    line(layout.cx - halfW, y, layout.cx + halfW, y, 1.4)
    if (state.live && heading !== null) {
      ctx.save()
      ctx.beginPath()
      ctx.rect(layout.cx - halfW, y - 24, halfW * 2, 46)
      ctx.clip()
      const first = Math.ceil((heading - HEADING_HALF_SPAN) / 5) * 5
      for (let deg = first; deg <= heading + HEADING_HALF_SPAN; deg += 5) {
        const x = layout.cx + (deg - heading) * pixelsPerDegree
        const isMajor = MathUtils.euclideanModulo(deg, 10) === 0
        line(x, y, x, y - (isMajor ? 10 : 5), isMajor ? 1.4 : 1.2, isMajor ? HUD_GREEN : HUD_GREEN_DIM)
        if (isMajor) text(headingLabel(deg), x, y + 6, display(11), HUD_GREEN_DIM, 'center', 'top')
      }
      ctx.restore()
    }
    luminous(() => {
      ctx.beginPath()
      ctx.moveTo(layout.cx - 7, y - 15)
      ctx.lineTo(layout.cx, y - 5)
      ctx.lineTo(layout.cx + 7, y - 15)
      ctx.stroke()
    }, 1.6, HUD_GREEN)
    text(state.live && heading !== null ? `${pad(heading, 3)}°` : '–––', layout.cx, y - 21, display(15, 700), HUD_GREEN, 'center', 'bottom')
  }

  // --- Status block -------------------------------------------------------------
  function bar(x: number, y: number, w: number, h: number, fill: number, color: string) {
    box(x, y - h / 2, w, h, 1.2, HUD_GREEN_DIM)
    ctx.fillStyle = color
    ctx.fillRect(x + 1.5, y - h / 2 + 1.5, Math.max(0, (w - 3) * fill), h - 3)
  }

  function drawStatusBlock(state: GlassState) {
    const { live } = state
    const left = layout.cx - layout.half * (layout.tight ? 0.45 : 0.72)
    const right = layout.tight ? left : layout.cx + layout.half * (layout.compact ? 0.98 : 0.55)
    const align: CanvasTextAlign = layout.tight ? 'left' : 'right'
    const first = layout.statusFirst
    const second = first + 22
    const barX = left + (layout.compact ? 32 : 40)
    const barW = layout.compact ? 72 : 116

    // Ground clearance earns a bar as well as digits: it is the number that ends the flight.
    const clearance = live ? Math.min(1, Math.max(0, state.groundClearance) / CLEARANCE_FULL_SCALE) : 0
    const clearanceColor = state.groundClearance < 120 ? HUD_GREEN_ALERT : state.groundClearance < 260 ? HUD_GREEN_CAUTION : HUD_GREEN
    text('GND', left, first, display(12), HUD_GREEN_DIM)
    bar(barX, first, barW, 10, clearance, live ? clearanceColor : HUD_GREEN_DIM)
    text(live ? pad(state.groundClearance, 3) : '–––', barX + barW + 10, first, display(12, 700), live ? clearanceColor : HUD_GREEN_DIM)

    const pitch = live ? signed(state.pitch) : '––'
    const bank = live && state.bank !== null ? signed(state.bank) : '––'
    const verticalSpeed = live ? signed(state.verticalSpeed) : '––'
    const aoa = live ? signed(state.aoa) : '––'
    const g = live ? state.gLoad.toFixed(1) : '–.–'
    const aoaColor = live && Math.abs(state.aoa) > 26 ? HUD_GREEN_CAUTION : HUD_GREEN_DIM
    const attitudeRow = layout.tight ? second + 21 : first
    text(`PITCH ${pitch}°   BANK ${bank}°`, right, attitudeRow, display(12), HUD_GREEN_DIM, align)
    const aoaRow = layout.tight ? attitudeRow + 40 : layout.compact ? second + 80 : second
    const flags = `${state.psm ? '   PSM' : ''}${state.highG ? '   HI-G' : ''}${state.airbrake ? '   BRAKE' : ''}`
    text(`α ${aoa}°   ${g}G${live ? flags : ''}`, right, aoaRow, display(12), aoaColor, align)

    // Distance to the training boundary: this range has no tacmap to carry it.
    const edge = live ? `EDGE ${pad(state.edge, 4)}` : 'EDGE ––––'
    const edgeColor = live && state.edge < EDGE_CAUTION ? HUD_GREEN_CAUTION : HUD_GREEN_DIM
    if (layout.tight) text(edge, right, attitudeRow + 20, display(12), edgeColor, align)
    else if (layout.compact) text(edge, right, second, display(12), edgeColor, 'right')
    else text(edge, left, second, display(12), edgeColor)

    // Reheat reads as a budget: a column that drains and a clock for what it is worth.
    const reserve = live ? state.burnerReserve : 0
    const burnerColor = !live ? HUD_GREEN_DIM
      : state.burnerState === 'depleted' || state.burnerState === 'engaged' ? HUD_GREEN_ALERT
        : state.burnerState === 'inhibited' || reserve < RESERVE_CAUTION ? HUD_GREEN_CAUTION : HUD_GREEN
    const burnerLabel = AFTERBURNER_LABELS[state.burnerState]
    const burnerClock = live ? `${state.burnerSeconds.toFixed(1)}s` : '––.–s'

    // Narrow frames have no room outboard of the tapes; both gauges become digits.
    if (layout.compact) {
      text(`V/S ${verticalSpeed}`, right, second + 40, display(12), HUD_GREEN_DIM, 'right')
      text(`${burnerLabel} ${burnerClock}`, right, second + 60, display(12), burnerColor, 'right')
      return
    }

    const gaugeTop = layout.cy - layout.tapeHeight * 0.28
    const gaugeBottom = layout.cy + layout.tapeHeight * 0.28
    const gaugeSpan = gaugeBottom - gaugeTop

    const climb = live ? MathUtils.clamp(state.verticalSpeed / VERTICAL_SPEED_FULL_SCALE, -1, 1) : 0
    const climbX = layout.cx + layout.half * layout.tapeOffset + 92
    const climbMid = (gaugeTop + gaugeBottom) / 2
    line(climbX, gaugeTop, climbX, gaugeBottom, 1.2, HUD_GREEN_DIM)
    line(climbX - 5, climbMid, climbX + 5, climbMid, 1.2, HUD_GREEN_DIM)
    line(climbX - 4, climbMid, climbX - 4, climbMid - (climb * gaugeSpan) / 2, 3, HUD_GREEN)
    text('V/S', climbX, gaugeTop - 12, display(10), HUD_GREEN_DIM, 'center')
    text(verticalSpeed, climbX, gaugeBottom + 14, display(12, 700), HUD_GREEN, 'center')

    // Reserve empties toward the floor; the tick is where a burst stops being worth it.
    const reheatX = layout.cx - layout.half * layout.tapeOffset - 92
    const cautionY = gaugeTop + gaugeSpan * (1 - RESERVE_CAUTION)
    line(reheatX, gaugeTop, reheatX, gaugeBottom, 1.2, HUD_GREEN_DIM)
    line(reheatX - 5, cautionY, reheatX + 5, cautionY, 1.2, HUD_GREEN_DIM)
    line(reheatX + 4, gaugeBottom, reheatX + 4, gaugeBottom - reserve * gaugeSpan, 3, burnerColor)
    text(burnerLabel, reheatX, gaugeTop - 12, display(10), HUD_GREEN_DIM, 'center')
    text(burnerClock, reheatX, gaugeBottom + 14, display(12, 700), burnerColor, 'center')
  }

  function draw(state: GlassState | null) {
    ctx.clearRect(0, 0, width, height)
    if (!state) return
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.setLineDash([])
    // Scales stand on their own; only projected symbology waits for a camera.
    if (state.live && state.camera) {
      drawLadder(state, state.camera)
      drawNosePipper(state, state.camera)
      drawVelocityMarker(state, state.camera)
    }
    drawTape({
      x: layout.cx - layout.half * layout.tapeOffset, value: state.speed, side: 'left', tape: SPEED_TAPE, band: speedBand,
      label: 'KM/H', subreadout: state.live ? `PWR ${Math.round(state.power * 100)}%` : 'PWR –––', digits: 4, live: state.live,
    })
    drawTape({
      x: layout.cx + layout.half * layout.tapeOffset, value: Math.max(0, state.altitude), side: 'right', tape: ALTITUDE_TAPE,
      label: 'ALT · M AGL', digits: 5, live: state.live,
    })
    drawHeadingTape(state)
    drawStatusBlock(state)
    drawScreenCenter()
  }

  // Fixed dot at the exact middle of the frame, independent of where the nose points.
  // A faint dark rim keeps it readable against bright sky and cloud.
  function drawScreenCenter() {
    ctx.beginPath()
    ctx.arc(layout.cx, layout.cy, 2, 0, Math.PI * 2)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
    ctx.lineWidth = 1
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)'
    ctx.stroke()
  }

  return { resize, draw }
}
