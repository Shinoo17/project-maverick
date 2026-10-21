import { MathUtils, Vector3 } from 'three'
import { getAircraft } from '../../content/aircraft'
import type { AircraftId } from '../../content/schemas'
import type { VaporConditions } from './conditions'
import type { VaporModelRig } from './vaporModel'

// Measured at the outboard trailing-edge vertices of each flight-normalized
// GLB (18.9 units long, animation frame zero). Fixed attachment, not AoA-scaled.
export const wingtipOrigins: Record<AircraftId, { left: [number, number, number]; right: [number, number, number] }> = {
  f22: { left: [-4.396, -1.134, -6.809], right: [-4.396, -1.134, 6.796] },
  su57: { left: [-5.101, -.651, -6.821], right: [-5.101, -.651, 6.821] },
}

const wingSheets = { f22: { span: 6.7, height: -.74 }, su57: { span: 6.4, height: -.35 } }

type Point = [number, number, number]
/** Right-side (+Z) leading-edge vortex axis; the left side mirrors Z. Radius grows apex → end. */
/** Points along the skin, apex first. Must hold LEX_PATH_POINTS points. */
export interface LexPath { points: Point[]; radius: [number, number] }
export const LEX_PATH_POINTS = 6

/*
Leading-edge vortex axes on the flight-normalized GLB (+X nose), baked by
scripts/measure-vapor-paths.mjs: rays cast down onto the real upper skin, so the
wisp hugs the surface and runs parallel to the fuselage. F-22 has no separate
LEX: its vortex runs from the chine over the inlet top and wing root, ending
ahead of the fins, 0.02 above the skin. Su-57's comes off the LEVCON at the
wing root, 0.12 above the skin. The script applies animation frame zero as the
game does; without it the F-22 skin came out 0.59 too high.
*/
export const lexPaths: Record<AircraftId, LexPath> = {
  f22: { points: [[4, -.811, 1.2], [2.56, -.717, 1.38], [1.12, -.641, 1.56], [-.32, -.69, 1.74], [-1.76, -.664, 1.92], [-3.2, -.695, 2.1]], radius: [.06, .22] },
  su57: { points: [[3.4, -.355, 1.25], [2.02, -.202, 1.37], [.64, -.122, 1.49], [-.74, -.098, 1.61], [-2.12, -.154, 1.73], [-3.5, -.238, 1.85]], radius: [.07, .22] },
}

/*
Wing loading uses combat weight over reference wing area: F-22 ≈ 26 t / 78 m²,
Su-57 ≈ 25 t / 78.8 m². Su-57's LEVCON holds its vortex from a lower AoA.
*/
export const vaporRigs: Record<AircraftId, VaporModelRig> = {
  f22: { wingLoading: 335, alphaOnset: 8 },
  su57: { wingLoading: 317, alphaOnset: 7 },
}

/*
Vapor-cone shell around the fuselage axis: from the canopy (front) back to the
shock, which moves from back[0] at M 0.85 to back[1] at M 1.05.
*/
export interface ConeShape { front: number; back: [number, number]; axisY: number; radius: [number, number] }
export const coneShapes: Record<AircraftId, ConeShape> = {
  f22: { front: 5.4, back: [1.6, -5.2], axisY: .15, radius: [1.2, 6] },
  su57: { front: 5.0, back: [1.2, -5.4], axisY: .05, radius: [1.2, 6] },
}

export function getVaporProfile(aircraftId: string) {
  const id = getAircraft(aircraftId).presentationId
  return { origins: wingtipOrigins[id], ...wingSheets[id], lex: lexPaths[id], cone: coneShapes[id], rig: vaporRigs[id] }
}

export function vortexProfile(c: VaporConditions) {
  const incidence = MathUtils.smoothstep(Math.abs(c.aoa), 4, 34)
  const load = MathUtils.smoothstep(Math.abs(c.g), 1.6, 8)
  const energy = MathUtils.clamp(incidence * .55 + load * .65, 0, 1)
  const moisture = MathUtils.smoothstep(c.water, .15, .7)
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
