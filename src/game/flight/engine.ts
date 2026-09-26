import type { AircraftState } from '../state/WorldState'
import type { EngineProfile, ManeuverProfile } from './profileTypes'

export interface EngineState { requestedPower: number; actualThrust: number }

/** Reserve is consumed by the engine; neither incidence nor nozzle travel affects it. */
export function stepBurner(m: AircraftState['maneuver'], requested: boolean, p: ManeuverProfile, dt: number) {
  m.burnerActive = requested && !m.burnerLocked && m.burner > 0
  if (m.burnerActive) {
    m.burner = Math.max(0, m.burner - dt / p.burnerSeconds); m.burnerRest = 0
    if (m.burner === 0) m.burnerLocked = true
  } else {
    m.burnerRest += dt
    if (m.burnerRest > 1) m.burner = Math.min(1, m.burner + dt / p.burnerRecharge)
    if (m.burner >= 0.25) m.burnerLocked = false
  }
}

/** enginePower is actual power in dry-thrust units, shared by physics, rig and FX. */
export function stepEngine(state: Pick<AircraftState, 'engine' | 'enginePower'>, requestedPower: number,
  dryThrust: number, p: EngineProfile, dt: number) {
  state.engine.requestedPower = Math.max(0, requestedPower)
  const response = requestedPower > state.enginePower ? p.spoolUpResponse : p.spoolDownResponse
  state.enginePower += (state.engine.requestedPower - state.enginePower) * (1 - Math.exp(-response * dt))
  state.engine.actualThrust = state.enginePower * dryThrust
  return state.engine.actualThrust
}
