import { MathUtils, Vector3 } from 'three'
import type { AircraftId } from '../../content/schemas'
import type { VaporConditions } from './conditions'

// Measured at the outboard trailing-edge vertices of each flight-normalized
// GLB (18.9 units long, animation frame zero). Fixed attachment, not AoA-scaled.
export const wingtipOrigins: Record<AircraftId, { left: [number, number, number]; right: [number, number, number] }> = {
  f22: { left: [-4.396, -1.134, -6.809], right: [-4.396, -1.134, 6.796] },
  su57: { left: [-5.101, -.651, -6.821], right: [-5.101, -.651, 6.821] },
}

export function vortexProfile(c: VaporConditions) {
  const incidence = MathUtils.smoothstep(Math.abs(c.aoa), 4, 34)
  const load = MathUtils.smoothstep(Math.abs(c.g), 1.6, 8)
  const energy = MathUtils.clamp(incidence * .55 + load * .65, 0, 1)
  const moisture = MathUtils.smoothstep(c.humidity, .32, .85)
  return {
    length: (18 + energy * 65) * MathUtils.lerp(.65, 1, MathUtils.smoothstep(c.speed, 35, 200)) * MathUtils.lerp(.55, 1, moisture),
    radius: .045 + energy * .060,
    turbulence: .15 + energy * .65,
  }
}

/** Unit downstream air-relative velocity in canonical body axes. */
export function vortexAirflow(c: VaporConditions, out: Vector3) {
  const a = c.aoa * MathUtils.DEG2RAD, s = c.sideslip
  return out.set(-Math.cos(a) * Math.cos(s), Math.sin(a) * Math.cos(s), -Math.sin(s)).normalize()
}
