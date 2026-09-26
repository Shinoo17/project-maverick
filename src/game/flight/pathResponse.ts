import { Vector3 } from 'three'
import type { AirflowState } from './airflow'
import type { AircraftFlightProfile } from './profileTypes'

/** Authored flow model, not measured aerodynamics. Start-of-step observations only:
 * neither commands, post-control attitude, G permission nor separation timers. */
export function physicalPathResponse(flow: AirflowState, forward: Vector3, path: Vector3, profile: AircraftFlightProfile) {
  const p = profile.flight
  const coupling = flow.confidence * Math.min(1, flow.dynamicPressure) * (0.1 + 0.9 * flow.forwardFlow ** 2)
  return forward.clone().addScaledVector(path, -forward.dot(path))
    .multiplyScalar(flow.airspeed * p.physicalPathResponse * coupling).clampLength(0, p.physicalPathAcceleration)
}
