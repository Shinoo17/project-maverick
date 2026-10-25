import { Color, HalfFloatType, type Camera, type DepthTexture, type Texture, Vector2, type WebGLRenderer, WebGLRenderTarget } from 'three'
import type { JetExhaust } from './JetExhaust'

/**
 * Half-resolution buffer of signed screen-space UV offsets from every exhaust's
 * heat volumes. Needs float color targets; without them haze stays off.
 */
export class HeatHazePass {
  private readonly target: WebGLRenderTarget | null
  private readonly size = new Vector2()
  private readonly clearColor = new Color()

  constructor(renderer: WebGLRenderer) {
    this.target = renderer.extensions.has('EXT_color_buffer_float')
      ? new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false })
      : null
  }

  /** Call after the opaque scene has resolved `depth`. Returns null when nothing refracts. */
  render(renderer: WebGLRenderer, camera: Camera, depth: DepthTexture, sources: readonly JetExhaust[]): Texture | null {
    const target = this.target
    const active = sources.filter(source => source.hazeActive)
    if (!target || !active.length) return null
    renderer.getDrawingBufferSize(this.size)
    const width = Math.max(1, this.size.x >> 1), height = Math.max(1, this.size.y >> 1)
    if (target.width !== width || target.height !== height) target.setSize(width, height)
    const lens = camera as Camera & { near?: number; far?: number; isOrthographicCamera?: boolean }
    const previousTarget = renderer.getRenderTarget(), previousAlpha = renderer.getClearAlpha(), previousAutoClear = renderer.autoClear
    renderer.getClearColor(this.clearColor)
    try {
      renderer.setRenderTarget(target)
      renderer.setClearColor(0x000000, 0)
      renderer.clear(true, false, false)
      renderer.autoClear = false
      for (const source of active) {
        const shared = source.heatShared
        shared.tDepth.value = depth
        shared.uRes.value.set(width, height)
        shared.uNear.value = lens.near ?? .1; shared.uFar.value = lens.far ?? 1000
        shared.uOrtho.value = lens.isOrthographicCamera ? 1 : 0
        renderer.render(source.heatScene, camera)
      }
    } finally {
      renderer.autoClear = previousAutoClear
      renderer.setClearColor(this.clearColor, previousAlpha)
      renderer.setRenderTarget(previousTarget)
    }
    return target.texture
  }

  dispose() { this.target?.dispose() }
}
