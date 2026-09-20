import type { AircraftState } from '../state/WorldState'
import { getFlightProfile } from './profile'
import { observeAirflow } from './airflow'
import { interpretEnvelope } from './envelope'
import { computeBudget } from './authority'

/** End-of-step observation; lastStep holds the allocation and force ledger
 * actually used at the start of the integrated substep. Never feeds physics. */
export function flightInstrumentation(state: AircraftState) {
  const p = getFlightProfile(state.aircraftId), airflow = observeAirflow(state, p)
  const actualThrust = state.engine.actualThrust
  return {
    airspeed: airflow.airspeed, alphaDeg: airflow.alphaDeg, betaDeg: airflow.betaDeg, incidenceDeg: airflow.incidenceDeg,
    dynamicPressureProxy: airflow.dynamicPressure, airflow,
    lastStep: state.flightForces ?? null, envelope: interpretEnvelope(state, airflow, p),
    actualThrust, budget: state.flightForces?.budget ?? computeBudget(airflow, state.stall.severity, actualThrust, p),
  }
}
