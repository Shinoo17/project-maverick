/*
Graphics choices, as plain data (no three.js), so the save file and the Settings page can
read them without loading the renderer.

The quality preset is not stored. It is worked out from the individual values: a match
with Low, Medium or High shows that name, anything else shows Custom. Picking a preset
writes its values, so the two can never drift apart.
*/

export type RenderScale = 'auto' | 0.6 | 0.8 | 1 | 1.2 | 1.5 | 2
export type EffectQuality = 'off' | 'low' | 'high'
export type FrameRateLimit = 30 | 60 | 120 | 'unlimited'
export type QualityPreset = 'low' | 'medium' | 'high'

export interface GraphicsSettings {
  renderScale: RenderScale
  antialias: boolean
  exhaust: EffectQuality
  vapor: EffectQuality
  frameRate: FrameRateLimit
  showFps: boolean
}

export const renderScales: readonly RenderScale[] = ['auto', 0.6, 0.8, 1, 1.2, 1.5, 2]
export const effectQualities: readonly EffectQuality[] = ['off', 'low', 'high']
export const frameRateLimits: readonly FrameRateLimit[] = [30, 60, 120, 'unlimited']
export const qualityPresets: readonly QualityPreset[] = ['low', 'medium', 'high']

/** Values each preset writes. Show FPS is a readout, not a cost, so no preset touches it. */
export const presetValues: Record<QualityPreset, Omit<GraphicsSettings, 'showFps'>> = {
  low: { renderScale: 0.8, antialias: false, exhaust: 'low', vapor: 'off', frameRate: 60 },
  medium: { renderScale: 1, antialias: true, exhaust: 'high', vapor: 'low', frameRate: 60 },
  high: { renderScale: 'auto', antialias: true, exhaust: 'high', vapor: 'high', frameRate: 'unlimited' },
}

export const defaultGraphicsSettings: Readonly<GraphicsSettings> = { ...presetValues.high, showFps: false }

export function graphicsPreset(settings: GraphicsSettings): QualityPreset | 'custom' {
  return qualityPresets.find(preset => (Object.keys(presetValues[preset]) as (keyof typeof presetValues.high)[])
    .every(key => presetValues[preset][key] === settings[key])) ?? 'custom'
}

// One shared array, so memoised scenes do not see a new prop on every render.
const autoDpr: [number, number] = [1, 1.5]
/** The pixel ratio range for a react-three-fiber Canvas. Auto keeps the old [1, 1.5] clamp. */
export function canvasDpr(scale: RenderScale): number | [number, number] {
  return scale === 'auto' ? autoDpr : scale
}

const pick = <T>(list: readonly T[], value: unknown, fallback: T): T => list.includes(value as T) ? value as T : fallback

export function parseGraphicsSettings(value: unknown): GraphicsSettings {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const d = defaultGraphicsSettings
  return {
    renderScale: pick(renderScales, data.renderScale, d.renderScale),
    antialias: typeof data.antialias === 'boolean' ? data.antialias : d.antialias,
    exhaust: pick(effectQualities, data.exhaust, d.exhaust),
    vapor: pick(effectQualities, data.vapor, d.vapor),
    frameRate: pick(frameRateLimits, data.frameRate, d.frameRate),
    showFps: data.showFps === true,
  }
}
