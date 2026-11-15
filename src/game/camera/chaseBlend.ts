/*
The new chase camera's blend (src/render/ChaseCamera.ts), from the flight's real state only
the nose–path separation and the alpha, never a key. Pressing
Space changes nothing here until the airframe actually moves.

Drift share, 0..1: how much of the separation is a drift — the airframe pointing away from where
it is going beyond what ordinary flight does.
- It counts the sideslip and only the alpha past the aircraft's normal limit
  (`alphaBandDeg.normal`). A full pull inside the envelope reaches 21–24° of alpha on the new
  core (FR1 §8.2); counted as drift, every hard turn would lag the camera and lean it onto the
  path, which is complaint C4.
- It fades out from reverseStartDeg to nothing at reverseEndDeg of incidence. With the path near
  the tail, the turn from nose to path has no axis to speak of; the camera then sits on the nose
  and has nothing to flip (FC-13, FC-15).
- Weighted by angleConfidence, so near rest (a tail slide's top) it is zero.
*/
import { MathUtils } from 'three'
import type { AircraftState } from '../state/WorldState'
import { readFlight, type FlightReadout } from '../flight/readout'

export const CHASE_DRIFT = { startDeg: 3, fullDeg: 20, reverseStartDeg: 100, reverseEndDeg: 170 }

/** Drift share, 0..1, from a readout (no smoothing). */
export function driftWeight(flight: FlightReadout) {
  const pastLimit = Math.max(0, Math.abs(flight.alphaDeg) - flight.alphaBandDeg.normal)
  const separation = Math.hypot(pastLimit, flight.betaDeg)
  return MathUtils.smoothstep(separation, CHASE_DRIFT.startDeg, CHASE_DRIFT.fullDeg) * flight.angleConfidence
    * (1 - MathUtils.smoothstep(flight.incidenceDeg, CHASE_DRIFT.reverseStartDeg, CHASE_DRIFT.reverseEndDeg))
}

/** `driftWeight` read straight from the aircraft state. */
export const driftWeightOf = (state: AircraftState) => driftWeight(readFlight(state))

/*
How far the look leaves the nose toward the path (degrees): `share` of the incidence, saturated
smoothly at `clampDeg` (spec §9.3: ~20–30° so the pilot can still aim). A plain min() would kink
the camera's motion where it starts to bite.
*/
export function pathOffsetDeg(incidenceDeg: number, share: number, clampDeg: number) {
  if (share <= 0 || clampDeg <= 0) return 0
  return clampDeg * Math.tanh(share * incidenceDeg / clampDeg)
}
