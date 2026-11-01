import { MathUtils } from 'three'
import { simulationSpeed } from '../flight/speedLimits'
import { GRAVITY, type Air } from './aero'
import type { AxisSet, CoreProfile } from './profile'
import type { RateLimit } from './state'

const DEG = Math.PI / 180
const axisNames = ['pitch', 'roll', 'yaw'] as const

export interface RotationInput {
  /** Rate requests −1..1 from the PilotCommand. */
  command: AxisSet
  air: Air
  /** The path's turn toward the body's up over this step (rad/s), from this step's forces. */
  pathRatePitch: number
  /** Lift this step's alpha makes before the G cap (m/s², signed), and lift per unit CL. */
  liftAccel: number
  liftPerCl: number
  /** dCL/dα at this alpha (per radian). */
  liftSlope: number
  psmAuthority: number
}

/*
Rate command (docs/flight-rewrite-plan.md §3.3), one law per axis, every step:

  target = pilot (input × available rate, kept inside the FBW band) + weathervane
  rate  += (target − rate)·(1 − e^(−dt/τ)), never faster than maxAccel

Available rate is the profile's maxRate above controlSpeedKph and falls with dynamic pressure
below it; psmRate × psmAuthority floors it (FR4; authority is 0 in FR1).

The FBW band is pitch only, and continuous. It is the pitch rate that walks alpha to the
nearer of two marks within 2τ: the alpha limit, and the alpha at which lift reaches the G limit
(linearized on the lift slope). Above corner speed the G mark is the nearer, below it the alpha
limit, and corner speed falls out where they meet. The band includes the path's own turn, so
alpha holds on the mark rather than lagging it, and it may go negative: when gravity bends the
path under a held nose at low speed, a held pull is turned into the push that keeps alpha on
its limit. It only ever narrows what the pilot asks; a released stick is never moved by it.

The weathervane turns the nose back toward the path, ∝ q · sin(angle), with q capped at twice
corner-speed q so the yaw loop stays damped at top speed. Pitch weathervanes only above the
alpha limit: below it, a released stick holds attitude and the path comes to the nose by
itself (lift above 1 g bends it up, below lets it sag), so hands-off flight trims straight
instead of nosing over. Yaw weathervanes at any sideslip.
*/
export function stepRotation(rates: AxisSet, input: RotationInput, p: CoreProfile, dt: number) {
  const { air, command } = input
  const control = MathUtils.clamp((air.airspeed / simulationSpeed(p.controlSpeedKph)) ** 2, 0, 1)
  const available = {} as AxisSet
  for (const axis of axisNames) available[axis] = Math.max(p.maxRate[axis] * control, p.psmRate[axis] * input.psmAuthority) * DEG

  // Pitch band from the alpha limit and the G limit.
  const tauAlpha = 2 * p.tau.pitch, alpha = air.alphaDeg * DEG
  const limitAlpha = p.aoaLimitDeg * DEG
  const perAlpha = input.liftPerCl * input.liftSlope
  const gHigh = perAlpha > 1e-6 ? alpha + (p.gLimit * GRAVITY - input.liftAccel) / perAlpha : Infinity
  const gLow = perAlpha > 1e-6 ? alpha + (-p.gLimitNeg * GRAVITY - input.liftAccel) / perAlpha : -Infinity
  const markHigh = Math.min(limitAlpha, gHigh), markLow = Math.max(-limitAlpha, gLow)
  // Angles mean nothing near rest: the band opens to the full rate as confidence goes.
  const open = (bound: number, full: number) => air.confidence * bound + (1 - air.confidence) * full
  const high = open(input.pathRatePitch + (markHigh - alpha) / tauAlpha, available.pitch)
  const low = open(input.pathRatePitch + (markLow - alpha) / tauAlpha, -available.pitch)

  const pilot = {} as AxisSet
  const limit: Record<keyof AxisSet, RateLimit> = { pitch: 'none', roll: 'none', yaw: 'none' }
  for (const axis of axisNames) pilot[axis] = command[axis] * available[axis]
  if (command.pitch > 0 && pilot.pitch > high) { pilot.pitch = Math.max(high, -available.pitch); limit.pitch = gHigh < limitAlpha ? 'g' : 'alpha' }
  else if (command.pitch < 0 && pilot.pitch < low) { pilot.pitch = Math.min(low, available.pitch); limit.pitch = gLow > -limitAlpha ? 'g' : 'alpha' }

  const q = Math.min((air.airspeed / simulationSpeed(p.cornerSpeedKph)) ** 2, 2) * air.confidence
  const weathervane: AxisSet = {
    pitch: -p.weathervane * q * Math.sin(alpha) * MathUtils.smoothstep(Math.abs(air.alphaDeg), p.aoaLimitDeg, p.alphaCritDeg),
    roll: 0,
    yaw: p.weathervane * q * Math.sin(air.betaDeg * DEG),
  }
  const target = {} as AxisSet
  for (const axis of axisNames) {
    target[axis] = pilot[axis] + weathervane[axis]
    const step = (target[axis] - rates[axis]) * (1 - Math.exp(-dt / p.tau[axis])), most = p.maxAccel[axis] * DEG * dt
    if (Math.abs(step) > most) limit[axis] = limit[axis] === 'none' ? 'rate' : limit[axis]
    rates[axis] += MathUtils.clamp(step, -most, most)
  }
  return { target, pilot, weathervane, limit, pitchBand: { low, high }, control }
}
