import { interpretEnvelope, envelopeLabel } from '../../game/flight/envelope'
import { observeAirflow } from '../../game/flight/airflow'
import { getFlightProfile } from '../../game/flight/profile'
import { Quaternion, Vector3 } from 'three'
import type { AircraftState } from '../../game/state/WorldState'

const degrees = 180 / Math.PI
export const wrapHeading = (value: number) => (value % 360 + 360) % 360

export function flightWarning(state: AircraftState | null) {
  if (!state || !state.alive) return null
  if (Math.hypot(state.position.x, state.position.z) > 6500 || state.position.y > 6500) return 'boundaryWarning'
  if (state.position.y < 100) return 'lowAltitude'
  const profile = getFlightProfile(state.aircraftId)
  const flow = observeAirflow(state, profile)
  const envelope = interpretEnvelope(state, flow, profile)
  const label = envelopeLabel(envelope, state.intent.activity)
  // Phase 4.5 treats active high-AoA input (including roll) as intentional drift,
  // even at full separation. Distinguishing a pilot fighting departure needs Phase 5 recovery signals.
  if (label === 'HIGH_AOA' || label === 'POST_STALL') return null
  // Low-speed separation alone should not hide the actionable energy advisory.
  // High-incidence recovery/departure still takes precedence below this speed.
  if (flow.airspeed < 60 && envelope.highAoa === 0) return 'hudLowEnergy'
  if (label === 'RECOVERING') return 'hudStallRecovering'
  if (label === 'DEPARTED') return 'hudStall'
  // Held activity can leave mild separation labelled NORMAL. Match its severity
  // to the recovery advisory; DEPARTED above handles separation greater than 0.5.
  if (envelope.separation > 0.1) return 'hudStallRecovering'
  return null
}

/*
Terrain and the boundary end the flight: they blink. Stall, recovery and low-energy plates are
advisories: steady, and held briefly after their condition clears, so a label crossing its
threshold does not flicker the plate at the 10 Hz telemetry rate.
*/
export type FlightWarning = NonNullable<ReturnType<typeof flightWarning>>
export const warningSeverity = (warning: FlightWarning) => warning === 'boundaryWarning' || warning === 'lowAltitude' ? 'hazard' : 'advisory'
export const ADVISORY_HOLD_MS = 800
export interface HeldWarning { warning: FlightWarning | null; until: number }
export function holdWarning(shown: HeldWarning, next: FlightWarning | null, now: number): HeldWarning {
  if (next) return { warning: next, until: warningSeverity(next) === 'advisory' ? now + ADVISORY_HOLD_MS : now }
  return shown.warning && now < shown.until ? shown : { warning: null, until: now }
}

// Range convention: +X is north, +Z east, +Y up. Read the nose, not velocity
// (the two deliberately separate in PSM). Positive bank means right wing down.
export function flightAttitude(orientation: AircraftState['orientation']) {
  const q = new Quaternion().copy(orientation).normalize()
  const nose = new Vector3(1, 0, 0).applyQuaternion(q)
  const up = new Vector3(0, 1, 0).applyQuaternion(q)
  const right = new Vector3(0, 0, 1).applyQuaternion(q)
  const horizontal = Math.hypot(nose.x, nose.z)
  return {
    pitch: Math.atan2(nose.y, horizontal) * degrees,
    // Heading and bank have no unique value when pointing exactly vertical.
    heading: horizontal < 1e-5 ? null : wrapHeading(Math.atan2(nose.z, nose.x) * degrees),
    bank: horizontal < 1e-5 ? null : Math.atan2(-right.y, up.y) * degrees,
  }
}

export function burnerStatus(state: AircraftState | null) {
  if (!state) return 'hudWaiting'
  const m = state.maneuver
  if (m.burnerActive) return 'hudBurnerActive'
  if (m.burnerLocked) return 'hudBurnerLocked'
  if (m.burner < 1 && m.burnerRest > 1) return 'recharging'
  return 'hudBurnerReady'
}
