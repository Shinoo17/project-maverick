import type { AircraftFlightProfile } from './profileTypes'
import { resolveSpeedLimits } from './speedLimits'

function validateFinite(value: unknown, path: string) {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error(`${path}: expected finite number`)
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      validateFinite(child, `${path}.${key}`)
    }
  }
}

function positive(value: number, path: string) {
  if (value <= 0) throw new Error(`${path}: expected positive number`)
}

function nonnegative(value: number, path: string) {
  if (value < 0) throw new Error(`${path}: expected nonnegative number`)
}

export function validateFlightProfile(profile: AircraftFlightProfile, path = 'flightProfile') {
  validateFinite(profile, path)
  const { flight, maneuver, thrustVectoring } = profile

  for (const key of ['minPoweredMps', 'maxThrust', 'gravity', 'pitchRate', 'yawRate', 'rollRate'] as const) {
    positive(flight[key], `${path}.flight.${key}`)
  }
  resolveSpeedLimits(flight, {}, `${path}.flight`)
  for (const [key, value] of Object.entries(flight)) {
    if (typeof value === 'number') nonnegative(value, `${path}.flight.${key}`)
  }
  if (flight.turnRateReserve > 1) {
    throw new Error(`${path}.flight.turnRateReserve: expected fraction between 0 and 1`)
  }

  positive(maneuver.burnerSeconds, `${path}.maneuver.burnerSeconds`)
  positive(maneuver.burnerRecharge, `${path}.maneuver.burnerRecharge`)
  for (const [key, value] of Object.entries(maneuver)) {
    if (typeof value === 'number') nonnegative(value, `${path}.maneuver.${key}`)
  }
  // Disabled aircraft may leave PSM budgets at zero; shared high-G/burner tuning
  // remains valid independently. Enabled PSM requires a usable entry envelope.
  if (maneuver.psmEnabled) {
    positive(maneuver.entryMin, `${path}.maneuver.entryMin`)
    positive(maneuver.activeSeconds, `${path}.maneuver.activeSeconds`)
    positive(maneuver.maxRotation, `${path}.maneuver.maxRotation`)
    if (maneuver.entryMax <= maneuver.entryMin) {
      throw new Error(`${path}.maneuver.entryMax: must exceed entryMin`)
    }
  }

  if (thrustVectoring) {
    for (const [axis, value] of Object.entries(thrustVectoring.inertia)) {
      positive(value, `${path}.thrustVectoring.inertia.${axis}`)
    }
    for (const key of ['maxAngle', 'rollGain', 'actuatorRate', 'actuatorResponse', 'authorityResponse', 'spacing', 'lipArm'] as const) {
      nonnegative(thrustVectoring[key], `${path}.thrustVectoring.${key}`)
    }
  }
}
