import type { AuthorityBudget } from './authority'
import type { AllocationRecord } from './allocation'
import type { AirflowState } from './airflow'
import type { AeroAxes } from './profileTypes'

/** Last integrated substep, not a recomputation at the final pose.
 * Angular contributions are equivalent rad/s²; drag is m/s².
 * controller = allocated aero + floor + neutral damping; tvc = actual actuator torque.
 * Commanded TVC shares exclude coupled torque and actuator lag, both explicitly recorded.
 * This is diagnostics only, never an authority/allocation budget or physics input.
 */
export interface FlightForces {
  budget: AuthorityBudget
  allocation: AllocationRecord
  nozzleTargets: { left: number; right: number }
  targetTorque: AeroAxes
  coupledTarget: AeroAxes
  actuatorLag: AeroAxes
  translation: { thrustWork: number; dragWork: number; controlPathRate: number; controlPathCap: number; uncappedControlPathRate: number | null; pathCapActive: boolean; longitudinalZeroCrossing: boolean }
  dt: number
  airflowStart: AirflowState
  separation: number
  highAoa: number
  neutralWeight: number
  ratesBefore: AeroAxes
  ratesAfter: AeroAxes
  controller: AeroAxes
  stabilityDamping: AeroAxes
  naturalRestoring: AeroAxes
  naturalDamping: AeroAxes
  tvc: AeroAxes
  alphaDrag: number
  betaDrag: number
}
