import type { AirflowState } from './airflow'
import type { AeroAxes, AeroProfile, RestoringCurve } from './profileTypes'

/** Continuous piecewise-linear stiffness; profile validation owns knot ordering. */
export function restoringStiffness(curve: RestoringCurve, incidenceDeg: number) {
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1], b = curve[i]
    if (incidenceDeg <= b.incidenceDeg) {
      const t = Math.max(0, (incidenceDeg - a.incidenceDeg) / (b.incidenceDeg - a.incidenceDeg))
      return a.stiffness + (b.stiffness - a.stiffness) * t
    }
  }
  return curve[curve.length - 1].stiffness
}

/** Natural accelerations only: no command, aircraft ID, phase, floor or TVC.
 * q is the unclamped dimensionless pressure from observeAirflow, not Pa.
 * Positive alpha needs negative pitch. Positive beta means flow to the right,
 * so positive body yaw restores it (the observer's beta sign differs from alpha).
 * Pitch projection cos(beta) removes the undefined pitch plane at pure sideslip.
 */
export function naturalAerodynamics(flow: AirflowState, separation: number, rates: Readonly<AeroAxes>, profile: AeroProfile) {
  const alpha = flow.alphaDeg * Math.PI / 180, beta = flow.betaDeg * Math.PI / 180
  const q = flow.dynamicPressure * flow.confidence
  const pitchFlow = Math.sin(alpha) * Math.cos(beta)
  const yawFlow = Math.sin(beta)
  const restoring: AeroAxes = {
    pitch: -restoringStiffness(profile.restoring.pitch, flow.incidenceDeg) * q * pitchFlow,
    yaw: restoringStiffness(profile.restoring.yaw, flow.incidenceDeg) * q * yawFlow,
    roll: 0,
  }
  const dampingCoefficient = { pitch: 0, yaw: 0, roll: 0 }
  const damping = { pitch: 0, yaw: 0, roll: 0 }
  for (const axis of ['pitch', 'yaw', 'roll'] as const) {
    dampingCoefficient[axis] = q * (profile.damping.attached[axis]
      + (profile.damping.separated[axis] - profile.damping.attached[axis]) * separation)
    damping[axis] = -dampingCoefficient[axis] * rates[axis]
  }
  const speedSquared = flow.airspeed ** 2
  return {
    restoring, damping, dampingCoefficient,
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
  for (const axis of ['pitch', 'yaw', 'roll'] as const) {
    damping[axis] = dt > 0 ? -rates[axis] * (1 - Math.exp(-natural.dampingCoefficient[axis] * dt)) / dt : 0
  }
  return damping
}
