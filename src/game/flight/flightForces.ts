import type { stepSpeed } from './speed'
import type { EnvelopeFactors, LimiterStep } from './envelope'
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
  power: ReturnType<typeof stepSpeed>['power']
  brakes: { forward: number; crossflow: number; airbrake: number; deceleration: number; overspeed: number }
  envelope: EnvelopeFactors
  limiterStep: LimiterStep
  budget: AuthorityBudget
  allocation: AllocationRecord
  nozzleTargets: { left: number; right: number }
  targetTorque: AeroAxes
  coupledTarget: AeroAxes
  actuatorLag: AeroAxes
  path?: { attachedAlignment: { x: number; y: number; z: number }; anticipation: { x: number; y: number; z: number }; looseResponse: { x: number; y: number; z: number }; physical: { x: number; y: number; z: number }; assist: { x: number; y: number; z: number }; assistWeight: number; total: { x: number; y: number; z: number } }
  translation: { thrustWork: number; dragWork: number; brakeWork: number; brakeForce: { x: number; y: number; z: number }; brakePathRate: number; brakePathCap: number; controlPathRate: number; controlPathCap: number; uncappedControlPathRate: number | null; pathCapActive: boolean; longitudinalZeroCrossing: boolean }
  dt: number
  airflowStart: AirflowState
  separation: number
  highAoa: number
  /** Measured control-surface effectiveness per axis (0..1); not a gameplay factor. */
  flowEffectiveness: AeroAxes
  neutralWeight: number
  ratesBefore: AeroAxes
  ratesAfter: AeroAxes
  controller: AeroAxes
  stabilityDamping: AeroAxes
  naturalRestoring: AeroAxes
  naturalDeparture: AeroAxes
  naturalDamping: AeroAxes
  tvc: AeroAxes
  alphaDrag: number
  betaDrag: number
}
