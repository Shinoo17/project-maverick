import type { FlightProfile, FlightSpeedOverride } from './profileTypes'

// One scale for authoring and the HUD. These are arcade km/h, not real km/h.
const ARCADE_KPH_PER_MPS = 3.6 * 1.5
export const arcadeSpeed = (mps: number) => mps * ARCADE_KPH_PER_MPS
export const simulationSpeed = (arcadeKph: number) => arcadeKph / ARCADE_KPH_PER_MPS

export interface SpeedLimits {
  topSpeedMps: number
  afterburnerTopSpeedMps: number
}

/** Resolve once per spawn; never mutate the aircraft's shared profile. */
export function resolveSpeedLimits(flight: FlightProfile, override: FlightSpeedOverride = {}, path = 'flightProfile.flight'): SpeedLimits {
  const { topSpeedKph, afterburnerTopSpeedKph } = { ...flight, ...override }
  for (const [key, value] of Object.entries({ topSpeedKph, afterburnerTopSpeedKph })) {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${path}.${key}: expected positive finite number`)
  }
  if (simulationSpeed(topSpeedKph) <= flight.minPoweredMps) {
    throw new Error(`${path}.topSpeedKph: must exceed the minimum powered speed`)
  }
  if (afterburnerTopSpeedKph < topSpeedKph) {
    throw new Error(`${path}.afterburnerTopSpeedKph: must be at least topSpeedKph`)
  }
  return {
    topSpeedMps: simulationSpeed(topSpeedKph),
    afterburnerTopSpeedMps: simulationSpeed(afterburnerTopSpeedKph),
  }
}
