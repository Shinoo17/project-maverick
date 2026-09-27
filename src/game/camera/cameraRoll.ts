/*
Camera roll arithmetic shared by the flight camera and the mouse stick.

Both need the same answers, and both must get them from the aircraft's state alone:
- how much of the view has handed over to the post-stall (PSM) shot,
- how far the Balanced style tilts the camera for a given bank, and
- how much of a PSM is a jet drift (Aircraft locked keeps its roll through one).

If the camera and the stick computed these separately they would drift apart, and "mouse up"
would stop meaning "up on screen".
*/
import { MathUtils, Quaternion, Vector3 } from 'three'
import type { AircraftState } from '../state/WorldState'
import { observeAirflow } from '../flight/airflow'
import { getFlightProfile } from '../flight/profile'

/*
How far the view leaves the nose, from incidence alone (Phase 7, owner-approved). Zero in
ordinary flight, one from 35° of incidence. Ordinary hard turns without the airbrake stay
under 8°, so they never start the handoff. Below ~10 m/s the incidence is unreliable and the
confidence term keeps this at zero.
*/
export const DECOUPLE = { startDeg: 8, fullDeg: 35 }

/** Share of the PSM shot, 0..1, from incidence and its confidence. */
export function psmShare(incidenceDeg: number, confidence: number) {
  return MathUtils.smoothstep(incidenceDeg, DECOUPLE.startDeg, DECOUPLE.fullDeg) * confidence
}

/** `psmShare` read straight from the aircraft state (no smoothing). */
export function psmShareOf(state: AircraftState) {
  const airflow = observeAirflow(state, getFlightProfile(state.aircraftId))
  return psmShare(airflow.incidenceDeg, airflow.confidence)
}

/*
Balanced tilt: the camera takes `BALANCED_TILT · sin(bank)` of the bank.

Ported from the example's Hybrid camera. It is a sine rather than a clamped fraction
because a clamp jumps at inverted: the bank wraps from +179° to −179° there, so a clamp
would hand back +15° on one frame and −15° on the next. The sine is 0 at inverted, so the
wrap costs nothing. Near level the slope is about a quarter of the bank, and the tilt peaks
at 15° at knife edge.
*/
export const BALANCED_TILT = MathUtils.degToRad(15)

export function balancedTilt(bank: number) {
  return BALANCED_TILT * Math.sin(bank)
}

const LEVEL_UP = new Vector3(), LEVEL_RIGHT = new Vector3()

/**
 * The bank of `up` about `forward`, measured from the level horizon, in radians, clockwise
 * on screen positive. Rotating the level up about `forward` by this angle gives `up`.
 * Returns 0 when `forward` is vertical, where no horizon exists.
 */
export function bankAbout(forward: Vector3, up: Vector3) {
  LEVEL_UP.set(0, 1, 0).addScaledVector(forward, -forward.y)
  if (LEVEL_UP.lengthSq() < 1e-10) return 0
  LEVEL_UP.normalize()
  LEVEL_RIGHT.crossVectors(forward, LEVEL_UP)
  return Math.atan2(up.dot(LEVEL_RIGHT), up.dot(LEVEL_UP))
}

/*
Jet drift share, 0..1: how much the current nose/path separation looks like a jet drift — the
nose leading the flight path sideways while both stay near the horizon.

Only Aircraft locked reads it: there, a drift keeps following the nose instead of handing over
to the level PSM shot. Following the nose is safe only while the horizon stays in view, so
every term below keeps vertical-plane moves (Cobra, Kulbit, tail slide, Bell) at zero:
- `flat`: nose and path both within ~20° of level, fading out by 40°;
- `side`: the separation is mostly a heading difference, not a pitch difference;
- `sep`: some real separation (from 3°, full by 8°), up to ~70°, fading out by 100°.

A pedal turn is geometrically the same as a yaw drift, so it follows too while its nose stays
within ~70° of the path: all of the F-22's (it yaws ~60% as far), and the Su-57's until it
swings past ~70–100°, where it hands over to the PSM shot. The owner decides whether to keep
that, follow the whole pedal turn (raise sepStartDeg/sepEndDeg), or exclude it.

A continuous weight from geometry only — no manoeuvre name, phase or latch.
*/
export const DRIFT = { flatStartDeg: 20, flatEndDeg: 40, sideStart: 0.55, sideFull: 0.8, minStartDeg: 3, minFullDeg: 8, sepStartDeg: 70, sepEndDeg: 100 }

const NOSE = new Vector3(), PATH = new Vector3(), ORIENT = new Quaternion()

/** `driftShare` read straight from the aircraft state (no smoothing). */
export function driftShareOf(state: AircraftState) {
  const airflow = observeAirflow(state, getFlightProfile(state.aircraftId))
  if (airflow.airspeed < 1e-6) return 0
  NOSE.set(1, 0, 0).applyQuaternion(ORIENT.copy(state.orientation as Quaternion))
  PATH.copy(state.velocity as Vector3).normalize()
  return driftShare(NOSE, PATH, airflow.incidenceDeg)
}

/** Jet drift share from the nose, the flight path (unit vectors) and the incidence between them. */
export function driftShare(nose: Vector3, path: Vector3, incidenceDeg: number) {
  const noseElevation = Math.asin(MathUtils.clamp(nose.y, -1, 1)), pathElevation = Math.asin(MathUtils.clamp(path.y, -1, 1))
  const level = (elevation: number) => 1 - MathUtils.smoothstep(Math.abs(MathUtils.radToDeg(elevation)), DRIFT.flatStartDeg, DRIFT.flatEndDeg)
  const flat = level(noseElevation) * level(pathElevation)
  if (flat <= 0) return 0
  // Heading difference between the two, against their elevation difference.
  const heading = Math.abs(Math.atan2(nose.x * path.z - nose.z * path.x, nose.x * path.x + nose.z * path.z))
  const pitch = Math.abs(noseElevation - pathElevation)
  const side = MathUtils.smoothstep(heading / Math.max(heading + pitch, 1e-6), DRIFT.sideStart, DRIFT.sideFull)
  const sep = MathUtils.smoothstep(incidenceDeg, DRIFT.minStartDeg, DRIFT.minFullDeg) * (1 - MathUtils.smoothstep(incidenceDeg, DRIFT.sepStartDeg, DRIFT.sepEndDeg))
  return flat * side * sep
}
