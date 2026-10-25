import { observeAirflow } from '../../game/flight/airflow'
import { getFlightProfile } from '../../game/flight/profile'
import { arcadeSpeed } from '../../game/flight/speedLimits'
import type { AircraftState } from '../../game/state/WorldState'
import { airDensity, flatRangeAtmosphere, machNumber, sampleAir, type VaporAtmosphere } from './atmosphere'

export interface VaporConditions {
  /** Simulation airspeed, m/s. */
  speed: number
  /** Signed AoA, degrees. */
  aoa: number
  g: number
  /** Radians. */
  sideslip: number
  mach: number
  /** ½ρV² from HUD speed, Pa. */
  dynamicPressure: number
  temperatureC: number
  /** Dew-point depression, K. */
  depression: number
  /** Water available to condense, 0–1. */
  water: number
}
export interface VaporSettings { density: number; noise: number; turbulence: number; fade: number; airflow: number }
/** Fade is the release time constant: real vapor clears in a fraction of a second. */
export const defaultVaporSettings: VaporSettings = { density: 1, noise: 1, turbulence: 1, fade: 0.12, airflow: 1 }

export interface VaporFlightSample { speed: number; aoa: number; g: number; sideslip: number }

/*
Mach and dynamic pressure use the HUD's arcade speed, not simulation m/s. The simulation tops out
near 259 m/s (M 0.76), so no flight would ever reach the vapor-cone band; the
arcade scale puts afterburner top speed at about M 1.1.
*/
export function vaporConditions(flight: VaporFlightSample, altitude: number, atmosphere: VaporAtmosphere = flatRangeAtmosphere): VaporConditions {
  const air = sampleAir(atmosphere, altitude), speed = arcadeSpeed(flight.speed) / 3.6
  return {
    ...flight,
    mach: machNumber(speed, altitude, atmosphere),
    dynamicPressure: .5 * airDensity(altitude) * speed * speed,
    temperatureC: air.temperatureC, depression: air.depression, water: air.water,
  }
}

// Use signed aerodynamic incidence, not maneuver.alpha (which also counts yaw).
// Velocity is in simulation metres/second, not the HUD's scaled arcade speed.
export function flightVaporConditions(state: AircraftState, atmosphere: VaporAtmosphere = flatRangeAtmosphere): VaporConditions {
  const airflow = observeAirflow(state, getFlightProfile(state.aircraftId))
  return vaporConditions({
    speed: airflow.airspeed,
    aoa: airflow.alphaDeg,
    sideslip: airflow.betaDeg * Math.PI / 180,
    g: state.maneuver.g,
  }, state.position.y, atmosphere)
}
