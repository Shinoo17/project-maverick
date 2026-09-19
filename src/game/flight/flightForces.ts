import type { AirflowState } from './airflow'
import type { AeroAxes } from './profileTypes'

/** Last integrated substep, not a recomputation at the final pose.
 * Angular contributions are equivalent rad/s²; drag is m/s².
 * controller includes legacyNeutralDamping; tvc is actual minus legacy reservation.
 * This is diagnostics only, never an authority/allocation budget or physics input.
 */
export interface FlightForces {
  dt: number
  airflowStart: AirflowState
  separation: number
  highAoa: number
  neutralWeight: number
  ratesBefore: AeroAxes
  ratesAfter: AeroAxes
  controller: AeroAxes
  legacyNeutralDamping: AeroAxes
  naturalRestoring: AeroAxes
  naturalDamping: AeroAxes
  tvc: AeroAxes
  alphaDrag: number
  betaDrag: number
}
