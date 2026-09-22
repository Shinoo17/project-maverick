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
  const { aero, flight, stall, maneuver, thrustVectoring, engine } = profile
  const b = profile.breakout
  for (const key of ['handoffSeconds', 'qLow', 'qHigh', 'baseWeight', 'brakeWeight', 'decelerationWeight', 'powerWeight', 'comboWeight',
    'sustainWeight', 'openRate', 'closeRate', 'brakeBoost', 'powerBoost', 'hardTurnG'] as const) {
    if (!Number.isFinite(b?.[key]) || b[key] < 0) throw new Error(`${path}.breakout.${key}: expected finite nonnegative number`)
  }
  if (b.qHigh <= b.qLow) throw new Error(`${path}.breakout.qHigh: must exceed qLow`)
  positive(b.handoffSeconds, `${path}.breakout.handoffSeconds`)
  positive(b.openRate, `${path}.breakout.openRate`)
  positive(b.closeRate, `${path}.breakout.closeRate`)
  if (!Number.isFinite(b.openRate * (1 + b.brakeBoost + b.powerBoost))) throw new Error(`${path}.breakout: opening rate overflow`)
  if (!Number.isFinite(b.hardTurnG * flight.turnAcceleration)) throw new Error(`${path}.breakout.hardTurnG: turn budget overflow`)
  if (b.hardTurnG < 1) throw new Error(`${path}.breakout.hardTurnG: must be at least 1`)
  for (const key of ['baseWeight', 'brakeWeight', 'decelerationWeight', 'powerWeight', 'comboWeight', 'sustainWeight'] as const) {
    if (b[key] > 1) throw new Error(`${path}.breakout.${key}: expected 0..1`)
  }
  for (const key of ['spoolUpResponse', 'spoolDownResponse'] as const) {
    if (!Number.isFinite(engine?.[key])) throw new Error(`${path}.engine.${key}: expected finite number`)
    positive(engine[key], `${path}.engine.${key}`)
  }

  for (const axis of ['pitch', 'yaw', 'roll'] as const) {
    const values = {
      [`flight.minRateTarget.${axis}`]: flight.minRateTarget?.[axis],
      [`aero.controlAcceleration.${axis}`]: aero.controlAcceleration?.[axis],
      [`arcadeControlFloor.acceleration.${axis}`]: profile.arcadeControlFloor?.acceleration?.[axis],
      [`arcadeControlFloor.maxRate.${axis}`]: profile.arcadeControlFloor?.maxRate?.[axis],
    }
    for (const [key, value] of Object.entries(values)) {
      if (!Number.isFinite(value) || value < 0) throw new Error(`${path}.${key}: expected finite nonnegative number`)
    }
  }
  for (const key of ['referenceSpeedMps', 'highSpeedMps', 'pathRateFloorMps'] as const) {
    if (!Number.isFinite(aero?.[key])) throw new Error(`${path}.aero.${key}: expected finite number`)
    positive(aero[key], `${path}.aero.${key}`)
  }
  if (aero.highSpeedMps < aero.referenceSpeedMps) {
    throw new Error(`${path}.aero.highSpeedMps: must not be below referenceSpeedMps`)
  }
  for (const key of ['alphaNormalDeg', 'alphaCriticalDeg'] as const) {
    if (!Number.isFinite(aero[key])) throw new Error(`${path}.aero.${key}: expected finite number`)
    nonnegative(aero[key], `${path}.aero.${key}`)
    if (aero[key] > 180) throw new Error(`${path}.aero.${key}: must not exceed 180`)
  }
  if (aero.alphaCriticalDeg <= aero.alphaNormalDeg) {
    throw new Error(`${path}.aero.alphaCriticalDeg: must exceed alphaNormalDeg`)
  }
  if (!Number.isFinite(aero.maxControllableAlphaDeg) || aero.maxControllableAlphaDeg < aero.alphaNormalDeg || aero.maxControllableAlphaDeg > 180) {
    throw new Error(`${path}.aero.maxControllableAlphaDeg: expected alphaNormalDeg..180`)
  }
  const drift = profile.bankedDrift
  if (!(drift?.bankStartDeg >= 0 && drift.bankFullDeg > drift.bankStartDeg && drift.bankFullDeg <= 90)) {
    throw new Error(`${path}.bankedDrift: expected 0 <= bankStartDeg < bankFullDeg <= 90`)
  }
  if (!(drift.speedStartKph >= 0 && drift.speedFullKph > drift.speedStartKph)) {
    throw new Error(`${path}.bankedDrift: expected 0 <= speedStartKph < speedFullKph`)
  }
  if (!(drift.maxAlphaDeg > 0 && drift.maxAlphaDeg <= 180)) throw new Error(`${path}.bankedDrift.maxAlphaDeg: expected 0 < value <= 180`)
  if (!(drift.pathGrip >= 0 && drift.pathGrip <= 1)) throw new Error(`${path}.bankedDrift.pathGrip: expected 0..1`)
  for (const axis of ['pitch', 'yaw'] as const) {
    const curve = aero.restoring?.[axis], curvePath = `${path}.aero.restoring.${axis}`
    if (!Array.isArray(curve) || curve.length < 2) throw new Error(`${curvePath}: expected at least two knots`)
    let previous = -1
    for (const [i, knot] of curve.entries()) {
      if (!Number.isFinite(knot?.incidenceDeg) || knot.incidenceDeg <= previous || knot.incidenceDeg > 180
        || !Number.isFinite(knot?.stiffness) || knot.stiffness < 0) throw new Error(`${curvePath}.${i}: invalid incidence/stiffness`)
      previous = knot.incidenceDeg
    }
    if (curve[0].incidenceDeg !== 0 || curve.at(-1)!.incidenceDeg !== 180) throw new Error(`${curvePath}: must span 0..180 degrees`)
  }
  for (const axis of ['pitch', 'yaw', 'roll'] as const) {
    const curve = aero.controlEffectiveness?.[axis], curvePath = `${path}.aero.controlEffectiveness.${axis}`
    if (!Array.isArray(curve) || curve.length < 2) throw new Error(`${curvePath}: expected at least two knots`)
    let previous = -1
    for (const [i, knot] of curve.entries()) {
      if (!Number.isFinite(knot?.incidenceDeg) || knot.incidenceDeg <= previous || knot.incidenceDeg > 180
        || !Number.isFinite(knot?.effectiveness) || knot.effectiveness < 0 || knot.effectiveness > 1) {
        throw new Error(`${curvePath}.${i}: invalid incidence/effectiveness`)
      }
      previous = knot.incidenceDeg
    }
    if (curve[0].incidenceDeg !== 0 || curve.at(-1)!.incidenceDeg !== 180) throw new Error(`${curvePath}: must span 0..180 degrees`)
  }
  for (const regime of ['attached', 'separated'] as const) for (const axis of ['pitch', 'yaw', 'roll'] as const) {
    const value = aero.damping?.[regime]?.[axis]
    if (!Number.isFinite(value) || value < 0) throw new Error(`${path}.aero.damping.${regime}.${axis}: expected finite nonnegative number`)
  }
  for (const key of ['stiffness', 'minPressure'] as const) {
    const value = aero.departure?.[key]
    if (!Number.isFinite(value) || value < 0) throw new Error(`${path}.aero.departure.${key}: expected finite nonnegative number`)
  }
  for (const key of ['alphaDrag', 'betaDrag', 'reverseDrag'] as const) {
    if (!Number.isFinite(aero[key]) || aero[key] < 0) throw new Error(`${path}.aero.${key}: expected finite nonnegative number`)
  }
  for (const key of ['afterburnerAcceleration', 'airbrakeDeceleration', 'neutralRollResponse', 'physicalPathResponse', 'physicalPathAcceleration', 'pathAssistAcceleration', 'pathAssistResponse', 'airbrakeCrossflow', 'controlPower'] as const) {
    if (!Number.isFinite(flight[key])) throw new Error(`${path}.flight.${key}: expected finite number`)
    nonnegative(flight[key], `${path}.flight.${key}`)
  }
  positive(flight.pathAssistResponse, `${path}.flight.pathAssistResponse`)
  for (const key of ['airbrakeCrossflow', 'controlPower'] as const) {
    if (flight[key] > 1) throw new Error(`${path}.flight.${key}: expected 0..1`)
  }
  for (const key of ['lateralAcceleration', 'recoveryIncidenceRad', 'recoverySpeedMps',
    'highGMinSpeedMps', 'highGMaxSpeedMps', 'highGSpeedFadeMps'] as const) {
    if (!Number.isFinite(maneuver[key])) throw new Error(`${path}.maneuver.${key}: expected finite number`)
    nonnegative(maneuver[key], `${path}.maneuver.${key}`)
  }
  positive(maneuver.highGSpeedFadeMps, `${path}.maneuver.highGSpeedFadeMps`)
  if (maneuver.highGMaxSpeedMps <= maneuver.highGMinSpeedMps) {
    throw new Error(`${path}.maneuver.highGMaxSpeedMps: must exceed highGMinSpeedMps`)
  }
  if (maneuver.recoveryIncidenceRad > Math.PI) {
    throw new Error(`${path}.maneuver.recoveryIncidenceRad: must not exceed PI`)
  }

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

  for (const key of ['stallSpeedKph', 'separationAttachedSpeedKph', 'criticalAoaDeg', 'separationAttachedAoaDeg',
    'controlAuthority', 'dragMultiplier', 'separationEntrySeconds', 'separationRecoverySeconds'] as const) {
    if (!Number.isFinite(stall[key])) throw new Error(`${path}.stall.${key}: expected finite number`)
    if (key === 'controlAuthority' || key === 'separationAttachedAoaDeg') nonnegative(stall[key], `${path}.stall.${key}`)
    else positive(stall[key], `${path}.stall.${key}`)
  }
  if (stall.separationAttachedSpeedKph <= stall.stallSpeedKph || stall.separationAttachedSpeedKph > flight.topSpeedKph) {
    throw new Error(`${path}.stall.separationAttachedSpeedKph: must exceed stallSpeedKph and not exceed topSpeedKph`)
  }
  if (stall.criticalAoaDeg > 180) throw new Error(`${path}.stall.criticalAoaDeg: must not exceed 180`)
  if (stall.separationAttachedAoaDeg >= stall.criticalAoaDeg) {
    throw new Error(`${path}.stall.separationAttachedAoaDeg: must be below criticalAoaDeg`)
  }
  if (stall.controlAuthority > 1) throw new Error(`${path}.stall.controlAuthority: expected fraction between 0 and 1`)
  if (stall.dragMultiplier < 1) throw new Error(`${path}.stall.dragMultiplier: must be at least 1`)

  positive(maneuver.burnerSeconds, `${path}.maneuver.burnerSeconds`)
  positive(maneuver.burnerRecharge, `${path}.maneuver.burnerRecharge`)
  positive(maneuver.blendSeconds, `${path}.maneuver.blendSeconds`)
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
    for (const axis of ['pitch', 'yaw', 'roll'] as const) {
      const value = thrustVectoring.inertia?.[axis]
      if (!Number.isFinite(value)) throw new Error(`${path}.thrustVectoring.inertia.${axis}: expected finite number`)
      positive(value, `${path}.thrustVectoring.inertia.${axis}`)
    }
    for (const key of ['pivotX', 'height'] as const) {
      if (!Number.isFinite(thrustVectoring[key])) throw new Error(`${path}.thrustVectoring.${key}: expected finite number`)
    }
    positive(thrustVectoring.maxAngle, `${path}.thrustVectoring.maxAngle`)
    positive(thrustVectoring.gain, `${path}.thrustVectoring.gain`)
    for (const key of ['maxAngle', 'rollGain', 'yawGain', 'cantDeg', 'actuatorRate', 'actuatorResponse', 'gain', 'spacing', 'lipArm'] as const) {
      if (!Number.isFinite(thrustVectoring[key])) throw new Error(`${path}.thrustVectoring.${key}: expected finite number`)
      nonnegative(thrustVectoring[key], `${path}.thrustVectoring.${key}`)
    }
    if (thrustVectoring.maxAngle > 45 || thrustVectoring.cantDeg > 90) {
      throw new Error(`${path}.thrustVectoring: expected maxAngle <= 45 and cantDeg <= 90`)
    }
  }
}
