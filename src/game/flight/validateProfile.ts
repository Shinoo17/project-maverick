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
  const { flight, stall, maneuver, thrustVectoring } = profile

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

  for (const key of ['stallSpeedKph', 'recoverySpeedKph', 'criticalAoaDeg', 'recoveryAoaDeg',
    'controlAuthority', 'dragMultiplier', 'entrySeconds', 'recoverySeconds'] as const) {
    if (!Number.isFinite(stall[key])) throw new Error(`${path}.stall.${key}: expected finite number`)
    if (key === 'controlAuthority' || key === 'recoveryAoaDeg') nonnegative(stall[key], `${path}.stall.${key}`)
    else positive(stall[key], `${path}.stall.${key}`)
  }
  if (stall.recoverySpeedKph <= stall.stallSpeedKph || stall.recoverySpeedKph > flight.topSpeedKph) {
    throw new Error(`${path}.stall.recoverySpeedKph: must exceed stallSpeedKph and not exceed topSpeedKph`)
  }
  if (stall.criticalAoaDeg > 180) throw new Error(`${path}.stall.criticalAoaDeg: must not exceed 180`)
  if (stall.recoveryAoaDeg >= stall.criticalAoaDeg) {
    throw new Error(`${path}.stall.recoveryAoaDeg: must be below criticalAoaDeg`)
  }
  if (stall.controlAuthority > 1) throw new Error(`${path}.stall.controlAuthority: expected fraction between 0 and 1`)
  if (stall.dragMultiplier < 1) throw new Error(`${path}.stall.dragMultiplier: must be at least 1`)

  positive(maneuver.burnerSeconds, `${path}.maneuver.burnerSeconds`)
  positive(maneuver.burnerRecharge, `${path}.maneuver.burnerRecharge`)
  positive(maneuver.blendSeconds, `${path}.maneuver.blendSeconds`)
  positive(maneuver.fullControlThrust, `${path}.maneuver.fullControlThrust`)
  for (const [key, value] of Object.entries(maneuver)) {
    if (typeof value === 'number') nonnegative(value, `${path}.maneuver.${key}`)
  }
  // Disabled aircraft may leave PSM budgets at zero; shared high-G/burner tuning
  // remains valid independently. Enabled PSM requires a usable entry envelope.
  if (maneuver.psmEnabled) {
    positive(maneuver.entryMin, `${path}.maneuver.entryMin`)
    if (maneuver.entryMax <= maneuver.entryMin) {
      throw new Error(`${path}.maneuver.entryMax: must exceed entryMin`)
    }
    if (maneuver.exitSpeed <= maneuver.entryMax) {
      throw new Error(`${path}.maneuver.exitSpeed: must exceed entryMax`)
    }
  }

  if (thrustVectoring) {
    for (const [axis, value] of Object.entries(thrustVectoring.inertia)) {
      positive(value, `${path}.thrustVectoring.inertia.${axis}`)
    }
    for (const key of ['maxAngle', 'rollGain', 'yawGain', 'cantDeg', 'actuatorRate', 'actuatorResponse', 'authorityResponse', 'spacing', 'lipArm'] as const) {
      if (!Number.isFinite(thrustVectoring[key])) throw new Error(`${path}.thrustVectoring.${key}: expected finite number`)
      nonnegative(thrustVectoring[key], `${path}.thrustVectoring.${key}`)
    }
    if (thrustVectoring.maxAngle > 45 || thrustVectoring.cantDeg > 90) {
      throw new Error(`${path}.thrustVectoring: expected maxAngle <= 45 and cantDeg <= 90`)
    }
  }
}
