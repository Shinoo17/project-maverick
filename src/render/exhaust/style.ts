import { getAircraft } from '../../content/aircraft'
import type { AircraftId } from '../../content/schemas'

/*
Exhaust look, as plain data. The geometry of each nozzle (where the lip is, how wide,
round or flat) lives in profile.ts; everything here is style and is shared by every
aircraft unless `exhaustStyleOverrides` says otherwise.

Values come from example/su57-exhaust-demo.html, Exhaust Style GAME with the SIM FX
palette. Lengths and radii are in the demo's metres for a 0.585 m nozzle exit; the
component rescales them to each aircraft's nozzle.
*/

export type Rgb = readonly [number, number, number]

/** One stylised flame shell. Intensity = flameBrightness × intensity × (burner × abI + dry × dryGlow). */
export interface FlameLayerStyle {
  /** Nozzle → mids[0] → mids[1] → tail. */
  colors: readonly [Rgb, Rgb, Rgb, Rgb]
  mids: readonly [number, number]
  /** Radius at the nozzle and at the tip (demo metres), and the curve between them. */
  r0: number; r1: number; shape: number
  /** Silhouette softness, end-on glow, axial fade-out power, fade-in length (0–1). */
  edge: number; axial: number; falloff: number; fadeIn: number
  /** Travelling glow bands; 0 is a still gradient. */
  flicker: number
  /** 0 solid, 1 hollow sheath brightest between axis and silhouette. */
  rim: number
  wobble: number; bump: number
  /** SIM-style ragged edges and breakup, 0–1, faded in past `ramp` so the root stays tight. */
  hybrid: number; ramp: number
  /** Where the layer is gone (0–1 of its length). */
  tail: number
  /** Inner side of a sheath leans toward this colour. */
  tint: Rgb; tintAmount: number
  /** Low-frequency drop-outs along the envelope. */
  patch: number
  /**
   * How much the layer covers what is behind it, 0–1. 0 is purely additive light; above 0 it
   * also dims the background by its own strength, so it still reads against a bright day sky.
   */
  cover: number
  /** Layer multiplier, share of the afterburner and dry-thrust terms, and length relative to the plume. */
  intensity: number; burner: number; dry: number; length: number
}

export interface ExhaustStyle {
  name: string
  /** Global multipliers (demo sliders). */
  flameLength: number; turbulence: number; nozzleGlow: number
  /** Multiplies every flame layer's light; above 1 keeps the plume readable against a bright day sky. */
  flameBrightness: number
  /** How far inside the lip the flame shells begin, in exit radii; the nozzle wall hides that part from the side. */
  flameStart: number
  /**
   * End-on glow (layer `axial`) of the shell part inside the nozzle, 0–1. Low keeps the
   * shells from stacking a second bright fill over the nozzle glow; it ramps back to 1 at the lip.
   */
  insideAxial: number
  layers: { glow: FlameLayerStyle; cone: FlameLayerStyle; core: FlameLayerStyle; sheath: FlameLayerStyle }
  /** Mach diamonds; only with the afterburner. */
  shock: { enabled: boolean; intensity: number; colors: readonly [Rgb, Rgb]; cells: number }
  /**
   * The lit duct seen through the nozzle exit, drawn by interior mapping on one plane at the
   * lip: side walls and a back face (flameholder rings round a hot core) that shift with the
   * camera. Lengths are in exit radii.
   */
  interior: {
    enabled: boolean; intensity: number
    /** Hot core → flameholder → dark rim. */
    colors: readonly [Rgb, Rgb, Rgb]
    /**
     * Ring contrast on the back face; back face depth behind the plane; duct size at the plane
     * relative to the exit (above 1 its walls and corners fall outside the opening), and at the
     * back face relative to that; the plane's own size relative to the exit (it must stay inside
     * the airframe's outline) and its inset behind the lip.
     */
    rings: number; depth: number; oversize: number; taper: number; plane: number; inset: number
    /** Side-wall light (higher: walls stay bright further towards the exit), hot gas along the view ray, hot-core size (0–1 of the back face). */
    wall: number; gas: number; core: number
  }
  /**
   * Camera-facing glow at the nozzle, strongest when looking into it. `depth` puts it and
   * the hot spot inside the lip (exit radii), so the airframe clips them to the opening.
   */
  halo: { color: Rgb; intensity: number; scale: number; depth: number }
  hotspot: { intensity: number; scale: number; white: number }
  /** Screen-space refraction behind the nozzle. Strength 1 is the demo's default. */
  haze: { enabled: boolean; strength: number }
  /** Also draw the older ray-marched plume (CondensationVolume). Off: it draws only the hot nozzle cavity. */
  volumePlume: boolean
  /** Ray-marched nozzle cavity glow, 0–1. 0: `interior` is the only light inside the nozzle. */
  volumeCavity: number
}

const flameLayer = (layer: Omit<FlameLayerStyle, 'rim' | 'wobble' | 'bump' | 'tint' | 'tintAmount' | 'patch' | 'cover'> & Partial<FlameLayerStyle>): FlameLayerStyle =>
  ({ rim: 0, wobble: .15, bump: .04, tint: [1, 1, 1], tintAmount: 0, patch: 0, cover: 0, ...layer })

/** GAME style, SIM FX palette: white-orange core and root, blue/violet outer envelope. */
export const SIM_FX: ExhaustStyle = {
  name: 'simfx',
  flameLength: 1, turbulence: .25, nozzleGlow: 1, flameBrightness: 1.6, flameStart: 1.2, insideAxial: .2,
  layers: {
    glow: flameLayer({
      colors: [[1, .44, .12], [1, .36, .10], [.85, .28, .30], [.50, .24, .85]], mids: [.28, .62],
      r0: .6, r1: .3, shape: .9, edge: 3, axial: .18, falloff: 1.9, fadeIn: .14, flicker: .6,
      hybrid: .8, ramp: .45, tail: .75, intensity: .4, burner: .16, dry: .6, length: .85, cover: .6,
    }),
    cone: flameLayer({
      colors: [[1, .60, .20], [1, .42, .09], [.95, .30, .22], [.58, .26, .85]], mids: [.28, .62],
      r0: .46, r1: .06, shape: .85, edge: 1.3, axial: .22, falloff: 1.35, fadeIn: .02, flicker: 1,
      hybrid: 1, ramp: .45, tail: .9, intensity: .85, burner: .85, dry: 1, length: 1, cover: 1,
    }),
    core: flameLayer({
      colors: [[1, .86, .55], [1, .62, .24], [1, .46, .12], [1, .40, .10]], mids: [.4, .8],
      r0: .26, r1: 0, shape: .9, edge: 1.1, axial: .2, falloff: .9, fadeIn: .015, flicker: .5,
      hybrid: .35, ramp: .55, tail: .95, intensity: .45, burner: .55, dry: .8, length: .38, cover: 1,
    }),
    sheath: flameLayer({
      colors: [[.50, .44, 1], [.44, .33, 1], [.38, .24, .85], [.30, .16, .62]], mids: [.25, .6],
      r0: .6, r1: .34, shape: .8, edge: 1, axial: .12, falloff: 1.5, fadeIn: .22, flicker: 1.3,
      rim: .5, wobble: .55, bump: .16, tint: [.95, .42, .40], tintAmount: .55, patch: .75,
      hybrid: 1, ramp: .35, tail: .84, intensity: .7, burner: .55, dry: .25, length: 1.05,
    }),
  },
  shock: { enabled: true, intensity: .5, colors: [[1, .88, .6], [1, .6, .25]], cells: 4 },
  interior: {
    enabled: true, intensity: .8, colors: [[1, .72, .38], [1, .40, .08], [.90, .20, .05]],
    rings: .45, depth: 1.55, oversize: 1.3, taper: .85, plane: 1, inset: .05, wall: .8, gas: .35, core: .3,
  },
  halo: { color: [1, .5, .2], intensity: .35, scale: 1.7, depth: .35 },
  hotspot: { intensity: .55, scale: .8, white: .12 },
  haze: { enabled: true, strength: 1 },
  volumePlume: false,
  volumeCavity: 0,
}

export type ExhaustStyleOverride = {
  [K in keyof ExhaustStyle]?: ExhaustStyle[K] extends readonly unknown[] ? ExhaustStyle[K]
    : ExhaustStyle[K] extends object ? { [J in keyof ExhaustStyle[K]]?: ExhaustStyle[K][J] extends readonly unknown[] ? ExhaustStyle[K][J] : ExhaustStyle[K][J] extends object ? Partial<ExhaustStyle[K][J]> : ExhaustStyle[K][J] }
    : ExhaustStyle[K]
}

/** Per-airframe tuning on top of SIM_FX. */
export const exhaustStyleOverrides: Partial<Record<AircraftId, ExhaustStyleOverride>> = {
  // The ray-marched cavity draws the Su-57's blue throat ring and lit sleeve; on the
  // F-22 it is a second elliptical fill over `interior`, so only the Su-57 keeps it.
  su57: { volumeCavity: 1 },
  // The F-22's flaps diverge ~1 m from a throat the size of `width`/`radiusY` to a taller exit;
  // the duct plane and the flame both start at the throat, so the flaps frame them from every angle.
  f22: { flameStart: 2.15, interior: { inset: 2.15 } },
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Objects merge key by key; arrays (colours, mids) and scalars replace. */
function merge<T>(base: T, override: unknown): T {
  if (!isRecord(base) || !isRecord(override)) return (override === undefined ? base : override) as T
  const out: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(override)) if (value !== undefined) out[key] = key in base ? merge(base[key], value) : value
  return out as T
}

const clamp = (value: number, min: number, max: number) => Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min
const color = (rgb: Rgb): Rgb => [clamp(rgb[0], 0, 8), clamp(rgb[1], 0, 8), clamp(rgb[2], 0, 8)]

function sanitizeLayer(layer: FlameLayerStyle): FlameLayerStyle {
  const lo = clamp(layer.mids[0], 0, 1)
  return {
    ...layer, colors: layer.colors.map(color) as unknown as FlameLayerStyle['colors'], mids: [lo, clamp(layer.mids[1], lo, 1)],
    r0: clamp(layer.r0, 0, 4), r1: clamp(layer.r1, 0, 4), shape: clamp(layer.shape, .05, 8), edge: clamp(layer.edge, .05, 16),
    axial: clamp(layer.axial, 0, 2), falloff: clamp(layer.falloff, .05, 8), fadeIn: clamp(layer.fadeIn, .001, 1), flicker: clamp(layer.flicker, 0, 4),
    rim: clamp(layer.rim, 0, 1), wobble: clamp(layer.wobble, 0, 4), bump: clamp(layer.bump, 0, 2), hybrid: clamp(layer.hybrid, 0, 1),
    ramp: clamp(layer.ramp, .12, 1), tail: clamp(layer.tail, .3, 1.3), tint: color(layer.tint), tintAmount: clamp(layer.tintAmount, 0, 1),
    patch: clamp(layer.patch, 0, 1), cover: clamp(layer.cover, 0, 1), intensity: clamp(layer.intensity, 0, 8), burner: clamp(layer.burner, 0, 8), dry: clamp(layer.dry, 0, 8), length: clamp(layer.length, 0, 4),
  }
}

/** Out-of-range values clamp instead of producing NaN geometry or negative light. */
export function sanitizeExhaustStyle(style: ExhaustStyle): ExhaustStyle {
  const { layers, shock, interior, halo, hotspot, haze } = style
  return {
    ...style,
    flameLength: clamp(style.flameLength, .1, 4), turbulence: clamp(style.turbulence, 0, 3), nozzleGlow: clamp(style.nozzleGlow, 0, 4), flameBrightness: clamp(style.flameBrightness, 0, 4),
    flameStart: clamp(style.flameStart, 0, 4), insideAxial: clamp(style.insideAxial, 0, 1), volumeCavity: clamp(style.volumeCavity, 0, 1),
    layers: { glow: sanitizeLayer(layers.glow), cone: sanitizeLayer(layers.cone), core: sanitizeLayer(layers.core), sheath: sanitizeLayer(layers.sheath) },
    shock: { ...shock, intensity: clamp(shock.intensity, 0, 4), colors: [color(shock.colors[0]), color(shock.colors[1])], cells: Math.round(clamp(shock.cells, 1, 12)) },
    interior: {
      ...interior, intensity: clamp(interior.intensity, 0, 4), colors: [color(interior.colors[0]), color(interior.colors[1]), color(interior.colors[2])],
      rings: clamp(interior.rings, 0, 1), depth: clamp(interior.depth, .1, 6), oversize: clamp(interior.oversize, 1, 2), taper: clamp(interior.taper, .2, 1), plane: clamp(interior.plane, .5, 2), inset: clamp(interior.inset, 0, 3),
      wall: clamp(interior.wall, 0, 4), gas: clamp(interior.gas, 0, 4), core: clamp(interior.core, .02, 1),
    },
    halo: { color: color(halo.color), intensity: clamp(halo.intensity, 0, 4), scale: clamp(halo.scale, 0, 6), depth: clamp(halo.depth, -1, 4) },
    hotspot: { intensity: clamp(hotspot.intensity, 0, 4), scale: clamp(hotspot.scale, 0, 6), white: clamp(hotspot.white, 0, 1) },
    haze: { ...haze, strength: clamp(haze.strength, 0, 3) },
  }
}

/** SIM_FX, then the airframe's overrides, then the caller's (a future settings page or tuning tool). */
export function resolveExhaustStyle(aircraftId: string, override?: ExhaustStyleOverride): ExhaustStyle {
  const airframe = exhaustStyleOverrides[getAircraft(aircraftId).presentationId]
  return sanitizeExhaustStyle(merge(merge(SIM_FX, airframe), override))
}
