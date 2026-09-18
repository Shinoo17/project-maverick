import { MathUtils } from 'three'
import { observeAirflow } from '../../game/flight/airflow'
import { getFlightProfile } from '../../game/flight/profile'
import type { AircraftState } from '../../game/state/WorldState'

export interface VaporConditions { speed: number; aoa: number; g: number; sideslip: number; humidity: number }
export interface VaporSettings { density: number; noise: number; turbulence: number; fade: number; airflow: number }
export const defaultVaporSettings: VaporSettings = { density: 1, noise: 1, turbulence: 1, fade: 0.45, airflow: 1 }

// The flight sandbox has no weather entity yet. Until it does, use a stable
// atmospheric lapse approximation: the low-level range is humid, while dry air
// at altitude naturally suppresses condensation instead of making it permanent.
export function ambientHumidity(altitude: number) {
  const altitudeMix = MathUtils.smoothstep(Math.max(0, altitude), 500, 6500)
  return MathUtils.clamp(.86 - altitudeMix * .4, .36, .86)
}

// Use signed aerodynamic incidence, not maneuver.alpha (which also counts yaw).
// Velocity is in simulation metres/second, not the HUD's scaled arcade speed.
export function flightVaporConditions(state: AircraftState): VaporConditions {
  const airflow = observeAirflow(state, getFlightProfile(state.aircraftId))
  return {
    speed: airflow.airspeed,
    aoa: airflow.alphaDeg,
    sideslip: airflow.betaDeg * Math.PI / 180,
    g: state.maneuver.g,
    humidity: ambientHumidity(state.position.y),
  }
}

// Humid-air artistic approximation, deliberately separate from flight physics.
export function vaporActivation({ speed, aoa, g, humidity }: VaporConditions) {
  const incidence = Math.abs(aoa)
  const moisture = MathUtils.smoothstep(MathUtils.clamp(humidity, 0, 1), .32, .72)
  const pressure = MathUtils.smoothstep(speed, 35, 155)
  const lift = MathUtils.smoothstep(incidence, 4, 28)
  const load = MathUtils.smoothstep(Math.abs(g), 1.6, 7)
  const attached = 1 - MathUtils.smoothstep(incidence, 55, 115)
  // Moisture is an atmospheric gate, not an opacity multiplier: dry air should
  // let an old trail dissipate and should not create a faint always-on exhaust.
  return MathUtils.clamp(pressure * moisture * (lift * 0.72 + load * 0.88) * attached, 0, 1.2)
}
