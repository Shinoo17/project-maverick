import { MathUtils, Quaternion, Vector3 } from 'three'
import type { AircraftState } from '../state/WorldState'
import type { AircraftFlightProfile } from './profileTypes'
import type { AirflowState } from './airflow'
import { arcadeSpeed } from './speedLimits'

/** Permission only. These factors never change an authority budget. */
export interface EnvelopeFactors {
  highAoa: number
  separation: number
  intent: number
  energyPermission: number
  limiterTarget: number
  limiterOpen: number
  alphaLimitDeg: number
  gAllowance: number
  /** Shared rate/drag blend, independent of the G allowance mapping. */
  hardTurnBlend: number
  continuation: number
  pathAssistWeight: number
  bankedDrift: number
  /** 0 on any angular input; ramps in after the shared release delay. Weight only, never authority. */
  recoveryAssist: number
}
export interface LimiterStep {
  previous: number
  target: number
  rate: number
  automatic: boolean
}
type EnvelopeState = Pick<AircraftState, 'stall' | 'maneuver' | 'limiterOpen' | 'pathAssistWeight' | 'intent' | 'orientation'>

/** 1 at knife-edge above the speed band, 0 wings-level or inverted. */
export function bankedDriftWeight(orientation: EnvelopeState['orientation'], flow: AirflowState, profile: AircraftFlightProfile) {
  const d = profile.bankedDrift
  const wingSpan = new Vector3(0, 0, 1).applyQuaternion(new Quaternion().copy(orientation))
  const knifeEdge = MathUtils.smoothstep(Math.abs(wingSpan.y), Math.sin(d.bankStartDeg * Math.PI / 180), Math.sin(d.bankFullDeg * Math.PI / 180))
  return knifeEdge * MathUtils.smoothstep(arcadeSpeed(flow.airspeed), d.speedStartKph, d.speedFullKph)
}

function alphaLimit(limiterOpen: number, bankedDrift: number, profile: AircraftFlightProfile) {
  const a = profile.aero
  const envelope = MathUtils.lerp(a.alphaNormalDeg, a.maxControllableAlphaDeg, limiterOpen)
  return Math.min(envelope, MathUtils.lerp(a.maxControllableAlphaDeg, profile.bankedDrift.maxAlphaDeg, bankedDrift))
}

/** Read-only observation, also used before integration. H uses unsigned incidence;
 * confidence gates continuation as well as highAoa; near-rest angles never latch. */
export function interpretEnvelope(state: EnvelopeState, flow: AirflowState, profile: AircraftFlightProfile): EnvelopeFactors {
  const { demand: D, saturation: S, sustained: T, brakeIntent: B, powerIntent: Pi } = state.intent
  const b = profile.breakout, a = profile.aero
  const E = 1 - MathUtils.smoothstep(flow.dynamicPressure, b.qLow, b.qHigh)
  const H = MathUtils.smoothstep(flow.incidenceDeg, a.alphaNormalDeg, a.alphaCriticalDeg)
  const continuation = H * flow.confidence * state.intent.continuation
  const permission = E * (b.baseWeight + b.brakeWeight * B + b.decelerationWeight * state.intent.decelerationIntent + b.powerWeight * Pi + b.comboWeight * B * Pi)
    + b.sustainWeight * T * E
  // Owner-approved P4-1 resolution: saturation gates G, not low-energy breakout.
  // At intended entry speeds, faithful S can be zero while E is high.
  const intent = MathUtils.clamp(D * permission, 0, 1)
  // Space remains a smoothed manual request into the same allowance as automatic G.
  const hardTurn = Math.max(D * S * (1 - E), state.maneuver.highG)
  const bankedDrift = bankedDriftWeight(state.orientation, flow, profile)
  const r = profile.recovery
  return {
    highAoa: H * flow.confidence, separation: state.stall.severity,
    intent, energyPermission: E, limiterTarget: Math.max(intent, continuation),
    limiterOpen: state.limiterOpen,
    alphaLimitDeg: alphaLimit(state.limiterOpen, bankedDrift, profile),
    gAllowance: MathUtils.lerp(1, b.hardTurnG, hardTurn),
    hardTurnBlend: hardTurn,
    continuation,
    pathAssistWeight: state.pathAssistWeight,
    bankedDrift,
    // releaseSeconds resets on the same step as any activity (I20).
    recoveryAssist: MathUtils.smoothstep(state.intent.releaseSeconds, r.delaySeconds, r.delaySeconds + r.rampSeconds),
  }
}

export function stepEnvelope(state: EnvelopeState, flow: AirflowState, profile: AircraftFlightProfile, dt: number, debugOpen: boolean) {
  const envelope = interpretEnvelope(state, flow, profile), b = profile.breakout
  const previous = state.limiterOpen, target = envelope.limiterTarget
  const rate = target > previous ? b.openRate * (1 + b.brakeBoost * state.intent.brakeIntent + b.powerBoost * state.intent.powerIntent) : b.closeRate
  // C alone may jump open for comparison; every automatic step, including release
  // from C, follows the same exponential. No threshold latch or snap-to-zero.
  state.limiterOpen = debugOpen ? 1 : previous + (target - previous) * (1 - Math.exp(-rate * dt))
  const assistRelease = state.limiterOpen * Math.max(state.intent.brakeIntent,
    state.intent.decelerationIntent * 0.65, envelope.continuation) * flow.confidence
  const assistTarget = 1 - assistRelease * (1 - envelope.bankedDrift * profile.bankedDrift.pathGrip)
  state.pathAssistWeight += (assistTarget - state.pathAssistWeight) * (1 - Math.exp(-profile.flight.pathAssistResponse * dt))
  envelope.pathAssistWeight = state.pathAssistWeight
  envelope.limiterOpen = state.limiterOpen
  envelope.alphaLimitDeg = alphaLimit(state.limiterOpen, envelope.bankedDrift, profile)
  return { envelope, limiterStep: { previous, target, rate, automatic: !debugOpen } satisfies LimiterStep }
}

export type EnvelopeLabel = 'NORMAL' | 'HIGH_AOA' | 'POST_STALL' | 'RECOVERING' | 'DEPARTED'
/** Observer only: no stored label or hysteresis can feed back into flight. */
export function envelopeLabel(envelope: EnvelopeFactors, activity: number): EnvelopeLabel {
  if (activity < 0.1) {
    if (envelope.highAoa > 0.8 && envelope.separation > 0.8) return 'DEPARTED'
    if (envelope.highAoa > 0 || envelope.separation > 0.1) return 'RECOVERING'
  }
  if (envelope.highAoa > 0.5 && envelope.separation > 0.5) return 'POST_STALL'
  if (envelope.highAoa > 0) return 'HIGH_AOA'
  return envelope.separation > 0.5 ? 'DEPARTED' : 'NORMAL'
}
