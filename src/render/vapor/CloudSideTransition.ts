import { MathUtils } from 'three'

/** A density crossfade between fixed upper/lower pressure fields, not a moving
 * surface. Small incidence jitter blends around neutral instead of flipping. */
export class CloudSideTransition {
  upperWeight = .5
  private initialized = false

  reset() { this.initialized = false; this.upperWeight = .5 }

  update(aoa: number, dt: number, fadeSeconds: number) {
    const target = MathUtils.smoothstep(aoa, -3, 3)
    if (!this.initialized) {
      this.upperWeight = target
      this.initialized = true
    } else if (dt > 0) {
      // ~0.9 s to complete 95% of a full reversal at the default fade setting.
      // Exponential response is independent of frame rate, slow motion or steps.
      const response = Math.max(.12, fadeSeconds * .65)
      this.upperWeight += (target - this.upperWeight) * -Math.expm1(-dt / response)
    }
    return this.upperWeight
  }
}
