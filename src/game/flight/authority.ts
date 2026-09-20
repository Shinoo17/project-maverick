import type { AirflowState } from './airflow'
import type { AircraftFlightProfile, AeroAxes } from './profileTypes'
import { tvcMomentCapacity, type DirectionalCapacity } from './thrustVectoring'

export interface AuthorityBudget {
  physicalAero: AeroAxes
  tvc: DirectionalCapacity
  actualMomentBounds: DirectionalCapacity
  arcadeFloor: { acceleration: AeroAxes; maxRate: AeroAxes }
  poweredControlAvailable: number
}
/** Capability only: no PilotCommand, player intent, phase or governor request. */
export function computeBudget(flow: AirflowState, separation: number, actualThrust: number, profile: AircraftFlightProfile): AuthorityBudget {
  const physicalAero = { pitch: 0, yaw: 0, roll: 0 }
  const attached = Math.max(0, 1 - separation)
  for (const axis of ['pitch', 'yaw', 'roll'] as const) physicalAero[axis] = flow.dynamicPressure * flow.confidence * attached * profile.aero.controlAcceleration[axis]
  const capacity = tvcMomentCapacity(profile.thrustVectoring, actualThrust)
  const reference = tvcMomentCapacity(profile.thrustVectoring, profile.flight.maxThrust).commanded
  const referenceSum = Object.values(reference.positive).reduce((sum, value) => sum + value, 0)
  return { physicalAero, tvc: capacity.commanded, actualMomentBounds: capacity.moments,
    arcadeFloor: { acceleration: { ...profile.arcadeControlFloor.acceleration }, maxRate: { ...profile.arcadeControlFloor.maxRate } },
    poweredControlAvailable: referenceSum > 0 ? Math.min(1, Object.values(capacity.commanded.positive).reduce((sum, value) => sum + value, 0) / referenceSum) : 0 }
}
/** Select each signed budget outside the capability layer, after controller demand. */
export function signedBudget(budget: AuthorityBudget, request: AeroAxes) {
  const tvc = { pitch: 0, yaw: 0, roll: 0 }
  for (const axis of ['pitch', 'yaw', 'roll'] as const) tvc[axis] = budget.tvc[request[axis] < 0 ? 'negative' : 'positive'][axis]
  return { physicalAero: budget.physicalAero, tvc, arcadeFloor: budget.arcadeFloor }
}
