import { MathUtils } from 'three'
import type { AircraftState } from '../state/WorldState'
import type { AircraftFlightProfile } from './profileTypes'
import type { AirflowState } from './airflow'

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
}
export interface LimiterStep {
  previous: number
  target: number
  rate: number
  automatic: boolean
}
type EnvelopeState = Pick<AircraftState, 'stall' | 'maneuver' | 'limiterOpen' | 'intent'>

/** Read-only observation, also used before integration. H uses unsigned incidence;
 * confidence fades only highAoa (neutral smoothing/mouse), not the authored H latch. */
export function interpretEnvelope(state: EnvelopeState, flow: AirflowState, profile: AircraftFlightProfile): EnvelopeFactors {
  const { demand: D, saturation: S, sustained: T, brakeIntent: B, powerIntent: Pi } = state.intent
  const b = profile.breakout, a = profile.aero
  const E = 1 - MathUtils.smoothstep(flow.dynamicPressure, b.qLow, b.qHigh)
  const H = MathUtils.smoothstep(flow.incidenceDeg, a.alphaNormalDeg, a.alphaCriticalDeg)
  const permission = E * (b.baseWeight + b.brakeWeight * B + b.powerWeight * Pi + b.comboWeight * B * Pi)
    + b.sustainWeight * T * E
  // Owner-approved P4-1 resolution: saturation gates G, not low-energy breakout.
  // At intended entry speeds, faithful S can be zero while E is high.
  const intent = MathUtils.clamp(D * permission, 0, 1)
  // Space remains a smoothed manual request into the same allowance as automatic G.
  const hardTurn = Math.max(D * S * (1 - E), state.maneuver.highG)
  return {
    highAoa: H * flow.confidence, separation: state.stall.severity,
    intent, energyPermission: E, limiterTarget: Math.max(intent, H * D),
    limiterOpen: state.limiterOpen,
    alphaLimitDeg: MathUtils.lerp(a.alphaNormalDeg, a.maxControllableAlphaDeg, state.limiterOpen),
    gAllowance: MathUtils.lerp(1, b.hardTurnG, hardTurn),
    hardTurnBlend: hardTurn,
  }
}

export function stepEnvelope(state: EnvelopeState, flow: AirflowState, profile: AircraftFlightProfile, dt: number, debugOpen: boolean) {
  const envelope = interpretEnvelope(state, flow, profile), b = profile.breakout
  const previous = state.limiterOpen, target = envelope.limiterTarget
  const rate = target > previous ? b.openRate * (1 + b.brakeBoost * state.intent.brakeIntent + b.powerBoost * state.intent.powerIntent) : b.closeRate
  // C alone may jump open for comparison; every automatic step, including release
  // from C, follows the same exponential. No threshold latch or snap-to-zero.
  state.limiterOpen = debugOpen ? 1 : previous + (target - previous) * (1 - Math.exp(-rate * dt))
  envelope.limiterOpen = state.limiterOpen
  envelope.alphaLimitDeg = MathUtils.lerp(profile.aero.alphaNormalDeg, profile.aero.maxControllableAlphaDeg, state.limiterOpen)
  return { envelope, limiterStep: { previous, target, rate, automatic: !debugOpen } satisfies LimiterStep }
}

export type EnvelopeLabel = 'NORMAL' | 'HIGH_AOA' | 'POST_STALL' | 'RECOVERING' | 'DEPARTED'
/** Observer only: no stored label or hysteresis can feed back into flight. */
export function envelopeLabel(envelope: EnvelopeFactors, demand: number): EnvelopeLabel {
  if (demand < 0.1) {
    if (envelope.highAoa > 0.8 && envelope.separation > 0.8) return 'DEPARTED'
    if (envelope.highAoa > 0 || envelope.separation > 0.1) return 'RECOVERING'
  }
  if (envelope.highAoa > 0.5 && envelope.separation > 0.5) return 'POST_STALL'
  if (envelope.highAoa > 0) return 'HIGH_AOA'
  return envelope.separation > 0.5 ? 'DEPARTED' : 'NORMAL'
}
