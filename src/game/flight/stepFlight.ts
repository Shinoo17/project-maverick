import { MathUtils, Quaternion, Vector3 } from 'three'
import type { AircraftState } from '../state/WorldState'
import type { PilotCommand } from '../runtime/commands'
import { trainingMap } from '../../content/maps'
import { getFlightProfile } from './profile'
import { stepManeuvers } from './maneuvers'
import { poweredThrustForces, solveTvcAngles, stepThrustVectoring } from './thrustVectoring'
import { stepSpeed } from './speed'
import { stepStall } from './stall'
import { observeAirflow } from './airflow'
import { stepEnvelope } from './envelope'
import { aeroFlowEffectiveness, naturalAerodynamics, naturalRateStep } from './aerodynamics'

import { computeBudget, signedBudget } from './authority'
import { allocate, axes, zeroAxes } from './allocation'
import { measureControlDemand, requestControl } from './controller'
import { readIntent } from './intent'
import { physicalPathResponse } from './pathResponse'
import { integrateTranslation } from './engineForces'

// Canonical body axes: +X forward, +Y up, +Z right. Positive pitch raises nose;
// positive roll banks right; positive yaw turns right. This module maps these rates to quaternion axes.
export function stepFlight(state: AircraftState, command: PilotCommand, dt: number) {
  if (!state.alive || dt <= 0) return
  const profile = getFlightProfile(state.aircraftId)
  const { aero, flight: p, stall: stallProfile, maneuver: maneuverProfile, thrustVectoring: tvc } = profile
  const velocity = new Vector3().copy(state.velocity)
  const airflowStart = observeAirflow(state, profile)
  const speed = airflowStart.airspeed
  stepStall(state, stallProfile, airflowStart, dt)
  stepManeuvers(state, command, dt, airflowStart)
  const m = state.maneuver
  const demand = measureControlDemand(command, airflowStart, state.stall.severity, profile, state.limiterOpen)
  state.intent = readIntent(command, state.intent, dt, demand.saturationRatio, profile.breakout.handoffSeconds)
  const { envelope, limiterStep } = stepEnvelope(state, airflowStart, profile, dt, command.psmArm && maneuverProfile.psmEnabled)
  const rates = state.rates, ratesBefore = { ...rates }
  // One evaluation per substep feeds both the natural layer and the capability
  // budget; authority.ts stays free of any aerodynamics import.
  const effectiveness = aeroFlowEffectiveness(airflowStart, aero)
  const natural = naturalAerodynamics(airflowStart, envelope.separation, effectiveness, ratesBefore, aero)
  const { thrust, brakes, power, brakeSources } = stepSpeed(state, command, dt, speed, Math.max(envelope.intent, envelope.continuation))
  const budget = computeBudget(airflowStart, effectiveness, thrust, profile)
  const control = requestControl(command, ratesBefore, airflowStart, envelope, profile, dt, demand)
  const selectedBudget = signedBudget(budget, control.request)
  const allocation = allocate(control.request, selectedBudget, zeroAxes(), ratesBefore, dt)
  const targets = solveTvcAngles(allocation.tvc, thrust, tvc)
  const targetTorque = tvc ? poweredThrustForces(targets, thrust, tvc).angularAcceleration : zeroAxes()
  const coupledTarget = zeroAxes()
  // Reconcile ideal independent reservations with a reachable pair of nozzles.
  // Never spend the same moment twice or report unreachable torque as delivered.
  for (const axis of axes) {
    const reserved = allocation.tvc[axis]
    const achieved = Math.sign(reserved) * Math.min(Math.abs(reserved), Math.max(0, Math.sign(reserved) * targetTorque[axis]))
    allocation.unmet[axis] += reserved - achieved
    allocation.tvc[axis] = achieved || 0
    coupledTarget[axis] = targetTorque[axis] - achieved
  }
  stepThrustVectoring(state, targets, dt)
  const vectoredThrust = tvc ? poweredThrustForces(state.thrustVectoring, thrust, tvc) : null
  const actualTvc = vectoredThrust?.angularAcceleration ?? zeroAxes()
  const actuatorLag = zeroAxes()
  for (const axis of axes) actuatorLag[axis] = actualTvc[axis] - targetTorque[axis]
  const damping = naturalRateStep(natural, ratesBefore, dt)
  const controller = zeroAxes()
  for (const axis of axes) {
    controller[axis] = allocation.aero[axis] + allocation.floor[axis] + control.servoDamping[axis]
    rates[axis] += (controller[axis] + actualTvc[axis] + natural.restoring[axis] + damping[axis]) * dt
  }
  const neutralWeight = 1 - envelope.highAoa
  state.flightForces = {
    power, brakes: { ...brakes, ...brakeSources },
    dt, airflowStart, envelope, limiterStep, separation: envelope.separation, highAoa: envelope.highAoa, flowEffectiveness: effectiveness,
    ratesBefore, ratesAfter: { ...rates }, controller, stabilityDamping: control.servoDamping, neutralWeight,
    naturalRestoring: natural.restoring, naturalDamping: damping,
    alphaDrag: natural.alphaDrag, betaDrag: natural.betaDrag, tvc: actualTvc,
    budget, allocation, targetTorque, coupledTarget, actuatorLag, nozzleTargets: targets,
    translation: { thrustWork: 0, dragWork: 0, brakeWork: 0, brakeForce: { x: 0, y: 0, z: 0 }, brakePathRate: 0, brakePathCap: 0, controlPathRate: 0, controlPathCap: 0, uncappedControlPathRate: null, pathCapActive: false, longitudinalZeroCrossing: false },
  }
  const authority = demand.speedAuthority, normalLimit = control.normalLimit
  // Baseline arcade response follows flow/separation; explicit assistance below
  // may loosen it during entry. The physical contribution reads flow alone.
  // Reattachment restores the old recovery grip continuously; no delayed assist.
  const separation = envelope.separation
  const grip = 1 - separation
  const lift = demand.lift
  const reattachment = 1 - MathUtils.smoothstep(airflowStart.incidenceDeg, aero.alphaNormalDeg, aero.alphaCriticalDeg)
  const pathGrip = MathUtils.lerp(maneuverProfile.activeGrip, maneuverProfile.recoveryGrip, reattachment)
  const surfaceControl = demand.surfaceControl
  if (m.phase === 'active') m.rotation += Math.hypot(rates.pitch, rates.yaw) * dt
  const angular = new Vector3(rates.roll, -rates.yaw, rates.pitch)
  const orientation = new Quaternion().copy(state.orientation)
  const previousForward = new Vector3(1, 0, 0).applyQuaternion(orientation)
  const angle = angular.length() * dt
  if (angle > 0) orientation.multiply(new Quaternion().setFromAxisAngle(angular.normalize(), angle)).normalize()
  state.orientation = { x: orientation.x, y: orientation.y, z: orientation.z, w: orientation.w }
  const forward = new Vector3(1, 0, 0).applyQuaternion(orientation)
  const path = speed > 0.001 ? velocity.clone().divideScalar(speed) : forward.clone()
  // Attached flow anticipates nose rotation; separated flow retains loose grip.
  const alignment = forward.dot(path)
  const lateral = forward.clone().addScaledVector(path, -alignment)
  const reverseAlignment = MathUtils.smoothstep(-alignment, 0.8, 1)
  if (reverseAlignment > 0) {
    // At a 180° nose reversal the projection is zero. Choose the aircraft's up
    // plane to continue bending airflow rather than stalling at the antipode.
    if (lateral.lengthSq() < 1e-8) lateral.set(0, 1, 0).applyQuaternion(orientation).addScaledVector(path, -new Vector3(0, 1, 0).applyQuaternion(orientation).dot(path))
    const length = Math.max(lateral.length(), 1e-9)
    lateral.multiplyScalar(1 + (1 / length - 1) * reverseAlignment)
  }
  const normalLateral = lateral.clone()
  if (normalLateral.lengthSq() > 1e-8) normalLateral.setLength(speed * p.pathResponse * forward.angleTo(path))
  const anticipation = forward.clone().sub(previousForward).multiplyScalar(speed * p.turnAnticipation / dt)
  anticipation.addScaledVector(path, -anticipation.dot(path))
  const attachedAlignment = normalLateral.clone()
  normalLateral.add(anticipation).clampLength(0, normalLimit).multiplyScalar(surfaceControl)
  lateral.multiplyScalar(speed * maneuverProfile.pathResponse * authority * pathGrip * lift)
  const lateralLimit = MathUtils.lerp(maneuverProfile.lateralAcceleration, maneuverProfile.recoveryAcceleration, reattachment) * lift
  if (lateral.length() > lateralLimit) lateral.setLength(lateralLimit)
  const looseResponse = lateral.clone()
  lateral.lerp(normalLateral, grip)
  const physical = physicalPathResponse(airflowStart, previousForward, path, profile)
  const assist = lateral.clone().sub(physical).clampLength(0, p.pathAssistAcceleration).multiplyScalar(envelope.pathAssistWeight)
  lateral.copy(physical).add(assist)
  state.flightForces.path = { attachedAlignment, anticipation, looseResponse, physical, assist, assistWeight: envelope.pathAssistWeight, total: lateral.clone() }
  const turnLoss = p.turnDrag * (rates.pitch ** 2 + rates.yaw ** 2) * (1 + control.highG * (maneuverProfile.highGDrag - 1))
  const stallDrag = 1 + state.stall.severity * (stallProfile.dragMultiplier - 1)
  const drag = p.drag * speed * speed * stallDrag + turnLoss + natural.alphaDrag + natural.betaDrag
  const engineForce = vectoredThrust
    ? new Vector3().copy(vectoredThrust.acceleration).applyQuaternion(orientation)
    : forward.clone().multiplyScalar(thrust)
  // Attached lift need only support one G to hold the arcade horizon. At near
  // rest even attached flow cannot do that; separated flow lets gravity return.
  const gravityBlend = 1 - Math.min(1, p.turnAcceleration * lift / p.gravity) * (1 - separation)
  const translated = integrateTranslation(velocity, path, engineForce, lateral, drag,
    p.gravity, gravityBlend, aero.pathRateFloorMps, dt, { ...brakes, orientation })
  velocity.copy(translated.velocity)
  const { thrustWork, dragWork, brakeWork, brakeForce, brakePathRate, brakePathCap, controlPathRate, controlPathCap, uncappedControlPathRate, pathCapActive, longitudinalZeroCrossing } = translated
  state.flightForces.translation = { thrustWork, dragWork, brakeWork, brakeForce, brakePathRate, brakePathCap, controlPathRate, controlPathCap, uncappedControlPathRate, pathCapActive, longitudinalZeroCrossing }
  m.alpha = observeAirflow({ orientation: state.orientation, velocity }, profile).incidenceDeg
  m.pathRate = speed > 1 && velocity.length() > 1 ? path.angleTo(velocity) / dt * 180 / Math.PI : 0
  m.g = Math.sqrt(1 + (speed * m.pathRate * Math.PI / 180 / p.gravity) ** 2)
  m.drag = drag + Math.max(0, -brakeForce.dot(path))
  Object.assign(state.velocity, velocity)
  state.position.x += velocity.x * dt; state.position.y += velocity.y * dt; state.position.z += velocity.z * dt
  if (state.position.y <= 3) { state.position.y = 3; state.alive = false; state.stopReason = 'terrain' }
  if (Math.hypot(state.position.x, state.position.z) >= trainingMap.radius || state.position.y >= trainingMap.radius) {
    state.alive = false; state.stopReason = 'boundary'
  }
}
