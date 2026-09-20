import { Quaternion, Vector3 } from 'three'
import type { AircraftState } from '../state/WorldState'
import type { PilotCommand } from '../runtime/commands'
import { trainingMap } from '../../content/maps'
import { getFlightProfile } from './profile'
import { stepManeuvers } from './maneuvers'
import { poweredThrustForces, solveTvcAngles, stepThrustVectoring } from './thrustVectoring'
import { stepSpeed } from './speed'
import { stepStall } from './stall'
import { observeAirflow } from './airflow'
import { interpretEnvelope } from './envelope'
import { aeroFlowEffectiveness, naturalAerodynamics, naturalRateStep } from './aerodynamics'

import { computeBudget, signedBudget } from './authority'
import { allocate, axes, zeroAxes } from './allocation'
import { requestControl } from './controller'
import { readIntent } from './intent'
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
  // C is debug permission only; legacy labels cannot grant angular authority.
  state.limiterOpen = command.psmArm && maneuverProfile.psmEnabled ? 1 : 0
  const envelope = interpretEnvelope(state, airflowStart, profile)
  const rates = state.rates, ratesBefore = { ...rates }
  // One evaluation per substep feeds both the natural layer and the capability
  // budget; authority.ts stays free of any aerodynamics import.
  const effectiveness = aeroFlowEffectiveness(airflowStart, aero)
  const natural = naturalAerodynamics(airflowStart, envelope.separation, effectiveness, ratesBefore, aero)
  const { thrust, braking } = stepSpeed(state, command, dt, speed)
  const budget = computeBudget(airflowStart, effectiveness, thrust, profile)
  const control = requestControl(command, ratesBefore, airflowStart, envelope, profile, m.highG, dt)
  state.intent = readIntent(command, state.intent, dt, control.saturationRatio)
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
    allocation.tvc[axis] = achieved
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
    dt, airflowStart, separation: envelope.separation, highAoa: envelope.highAoa, flowEffectiveness: effectiveness,
    ratesBefore, ratesAfter: { ...rates }, controller, stabilityDamping: control.servoDamping, neutralWeight,
    naturalRestoring: natural.restoring, naturalDamping: damping,
    alphaDrag: natural.alphaDrag, betaDrag: natural.betaDrag, tvc: actualTvc,
    budget, allocation, targetTorque, coupledTarget, actuatorLag, nozzleTargets: targets,
    translation: { thrustWork: 0, dragWork: 0, controlPathRate: 0, controlPathCap: 0, uncappedControlPathRate: null, pathCapActive: false, longitudinalZeroCrossing: false },
  }
  const authority = control.speedAuthority, normalLimit = control.normalLimit
  // Phase 4 will port these path/gravity weights away from legacy phase/blend.
  const grip = 1 - m.blend
  const surfaceControl = 1 - state.stall.severity * (1 - stallProfile.controlAuthority)
  if (m.phase === 'active') m.rotation += Math.hypot(rates.pitch, rates.yaw) * dt
  const angular = new Vector3(rates.roll, -rates.yaw, rates.pitch)
  const orientation = new Quaternion().copy(state.orientation)
  const previousForward = new Vector3(1, 0, 0).applyQuaternion(orientation)
  const angle = angular.length() * dt
  if (angle > 0) orientation.multiply(new Quaternion().setFromAxisAngle(angular.normalize(), angle)).normalize()
  state.orientation = { x: orientation.x, y: orientation.y, z: orientation.z, w: orientation.w }
  const forward = new Vector3(1, 0, 0).applyQuaternion(orientation)
  const path = speed > 0.001 ? velocity.clone().divideScalar(speed) : forward.clone()
  // The PSM branch retains its original loose airflow. Normal flight anticipates
  // nose rotation and closes the remaining slip, within the same budget as rates.
  const lateral = forward.clone().addScaledVector(path, -forward.dot(path))
  if (m.phase !== 'active' && forward.dot(path) < -0.8) {
    // At a 180° nose reversal the projection is zero. Choose the aircraft's up
    // plane to continue bending airflow rather than stalling at the antipode.
    if (lateral.lengthSq() < 1e-8) lateral.set(0, 1, 0).applyQuaternion(orientation).addScaledVector(path, -new Vector3(0, 1, 0).applyQuaternion(orientation).dot(path))
    lateral.normalize()
  }
  const normalLateral = lateral.clone()
  if (normalLateral.lengthSq() > 1e-8) normalLateral.setLength(speed * p.pathResponse * forward.angleTo(path))
  const anticipation = forward.clone().sub(previousForward).multiplyScalar(speed * p.turnAnticipation / dt)
  anticipation.addScaledVector(path, -anticipation.dot(path))
  normalLateral.add(anticipation).clampLength(0, normalLimit).multiplyScalar(surfaceControl)
  lateral.multiplyScalar(speed * maneuverProfile.pathResponse * authority * (m.phase === 'active' ? maneuverProfile.activeGrip : maneuverProfile.recoveryGrip))
  const lateralLimit = m.phase === 'recovery' ? maneuverProfile.recoveryAcceleration : maneuverProfile.lateralAcceleration * (1 + m.highG * 0.6)
  if (lateral.length() > lateralLimit) lateral.setLength(lateralLimit)
  lateral.lerp(normalLateral, grip)
  const turnLoss = p.turnDrag * (rates.pitch ** 2 + rates.yaw ** 2) * (1 + m.highG * (maneuverProfile.highGDrag - 1))
  const stallDrag = 1 + state.stall.severity * (stallProfile.dragMultiplier - 1)
  const drag = p.drag * speed * speed * stallDrag + turnLoss + natural.alphaDrag + natural.betaDrag
  const engineForce = vectoredThrust
    ? new Vector3().copy(vectoredThrust.acceleration).applyQuaternion(orientation)
    : forward.clone().multiplyScalar(thrust)
  const gravityBlend = Math.max(state.stall.severity, 0.5 * (1 - grip))
  const translated = integrateTranslation(velocity, path, engineForce, lateral, drag + braking,
    p.gravity, gravityBlend, aero.pathRateFloorMps, dt)
  velocity.copy(translated.velocity)
  const { thrustWork, dragWork, controlPathRate, controlPathCap, uncappedControlPathRate, pathCapActive, longitudinalZeroCrossing } = translated
  state.flightForces.translation = { thrustWork, dragWork, controlPathRate, controlPathCap, uncappedControlPathRate, pathCapActive, longitudinalZeroCrossing }
  m.alpha = observeAirflow({ orientation: state.orientation, velocity }, profile).incidenceDeg
  m.pathRate = speed > 1 && velocity.length() > 1 ? path.angleTo(velocity) / dt * 180 / Math.PI : 0
  m.g = Math.sqrt(1 + (speed * m.pathRate * Math.PI / 180 / p.gravity) ** 2)
  m.drag = drag + braking
  Object.assign(state.velocity, velocity)
  state.position.x += velocity.x * dt; state.position.y += velocity.y * dt; state.position.z += velocity.z * dt
  if (state.position.y <= 3) { state.position.y = 3; state.alive = false; state.stopReason = 'terrain' }
  if (Math.hypot(state.position.x, state.position.z) >= trainingMap.radius || state.position.y >= trainingMap.radius) {
    state.alive = false; state.stopReason = 'boundary'
  }
}
