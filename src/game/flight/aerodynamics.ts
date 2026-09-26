import type { AirflowState } from './airflow'
import type { AeroAxes, AeroProfile, EffectivenessCurve, RestoringCurve } from './profileTypes'

const curveAxes = ['pitch', 'yaw', 'roll'] as const

/** Continuous piecewise-linear knots; profile validation owns knot ordering. */
function sampleKnots<T extends { incidenceDeg: number }>(curve: readonly T[], read: (knot: T) => number, incidenceDeg: number) {
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1], b = curve[i]
    if (incidenceDeg <= b.incidenceDeg) {
      const t = Math.max(0, (incidenceDeg - a.incidenceDeg) / (b.incidenceDeg - a.incidenceDeg))
      return read(a) + (read(b) - read(a)) * t
    }
  }
  return read(curve[curve.length - 1])
}

export function restoringStiffness(curve: RestoringCurve, incidenceDeg: number) {
  return sampleKnots(curve, knot => knot.stiffness, incidenceDeg)
}

export function controlEffectivenessAt(curve: EffectivenessCurve, incidenceDeg: number) {
  return sampleKnots(curve, knot => knot.effectiveness, incidenceDeg)
}

/** Control-surface effectiveness (0..1) from measured flow geometry alone.
 * Unsigned incidence is deliberately the single crossflow measure: a 90° sideslip
 * is as unattached as a 90° alpha. Per-axis alpha-versus-beta differentiation (a
 * rudder broadside behaves unlike a stabilator) is deferred, not overlooked.
 * Near rest the measured angles carry no meaning, so confidence fades the curve
 * back to attached flow and dynamic pressure alone then governs authority; this is
 * not a second confidence term, because computeBudget's confidence gates angle
 * meaning rather than surface effectiveness.
 * Continuous by construction: incidence follows integrated velocity/orientation,
 * so effectiveness cannot step within a substep (I7).
 */
export function aeroFlowEffectiveness(flow: AirflowState, profile: AeroProfile): AeroAxes {
  const effectiveness = { pitch: 0, yaw: 0, roll: 0 }
  for (const axis of curveAxes) {
    const curve = controlEffectivenessAt(profile.controlEffectiveness[axis], flow.incidenceDeg)
    effectiveness[axis] = 1 + (curve - 1) * flow.confidence
  }
  return effectiveness
}

/** Natural accelerations only: no command, aircraft ID, phase, floor or TVC.
 * q is the unclamped dimensionless pressure from observeAirflow, not Pa.
 * Positive alpha needs negative pitch. Positive beta means flow to the right,
 * so positive body yaw restores it (the observer's beta sign differs from alpha).
 * Pitch projection cos(beta) removes the undefined pitch plane at pure sideslip.
 *
 * Restoring authority is intentionally NOT multiplied by separation. Post-stall
 * loss of static stability is represented by the aircraft-specific restoring
 * stiffness curve versus incidence (AD7). Separation may affect control
 * effectiveness, damping, lift/path forces and drag, but never automatically
 * zeroes the natural static restoring moment: doing so would double-count
 * post-stall degradation and would remove natural recovery and the tail-slide
 * flip exactly when they are needed. `restoringSeparationIndependence` in
 * tests/aerodynamics.test.ts pins this semantic.
 *
 * Departure is the separate nose-down channel for reverse flow, where restoring
 * has no moment; weighting, floor and consequences are in
 * docs/reverse-flow-departure.md.
 *
 * Damping blends attached→separated with max(separation, 1 − effectiveness), so
 * crossflow with no pitch-alpha stall (pure sideslip) still damps as separated flow.
 */
export function naturalAerodynamics(flow: AirflowState, separation: number, effectiveness: Readonly<AeroAxes>, rates: Readonly<AeroAxes>, profile: AeroProfile) {
  const alpha = flow.alphaDeg * Math.PI / 180, beta = flow.betaDeg * Math.PI / 180
  const q = flow.dynamicPressure * flow.confidence
  const pitchFlow = Math.sin(alpha) * Math.cos(beta)
  const yawFlow = Math.sin(beta)
  const restoring: AeroAxes = {
    pitch: -restoringStiffness(profile.restoring.pitch, flow.incidenceDeg) * q * pitchFlow,
    yaw: restoringStiffness(profile.restoring.yaw, flow.incidenceDeg) * q * yawFlow,
    roll: 0,
  }
  const departurePressure = Math.max(flow.dynamicPressure, profile.departure.minPressure) * flow.confidence
  const departure: AeroAxes = {
    pitch: -profile.departure.stiffness * departurePressure * flow.reverseFlow * (1 - Math.abs(Math.sin(alpha))) * Math.cos(beta),
    yaw: 0,
    roll: 0,
  }
  const dampingCoefficient = { pitch: 0, yaw: 0, roll: 0 }
  const damping = { pitch: 0, yaw: 0, roll: 0 }
  for (const axis of curveAxes) {
    const separated = Math.max(separation, 1 - effectiveness[axis])
    dampingCoefficient[axis] = q * (profile.damping.attached[axis]
      + (profile.damping.separated[axis] - profile.damping.attached[axis]) * separated)
    damping[axis] = -dampingCoefficient[axis] * rates[axis]
  }
  const speedSquared = flow.airspeed ** 2
  return {
    restoring, departure, damping, dampingCoefficient,
    alphaDrag: profile.alphaDrag * speedSquared * (pitchFlow ** 2 + profile.reverseDrag * flow.reverseFlow),
    betaDrag: profile.betaDrag * speedSquared * yawFlow ** 2,
  }
}

/** Exact damping cannot flip the supplied pre-controller rate by itself.
 * Other contributions are combined separately; this is not an unconditional
 * no-sign-flip guarantee for the final controller + TVC + aero rate.
 * The returned equivalent acceleration is what instrumentation records/applies.
 */
export function naturalRateStep(natural: ReturnType<typeof naturalAerodynamics>, rates: Readonly<AeroAxes>, dt: number) {
  const damping = { pitch: 0, yaw: 0, roll: 0 }
  for (const axis of curveAxes) {
    damping[axis] = dt > 0 ? -rates[axis] * (1 - Math.exp(-natural.dampingCoefficient[axis] * dt)) / dt : 0
  }
  return damping
}
