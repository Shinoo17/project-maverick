import { MathUtils, Quaternion, Vector3 } from 'three'
import type { AircraftState } from '../state/WorldState'
import type { PilotCommand } from '../runtime/commands'
import { trainingMap } from '../../content/maps'
import { GRAVITY, aeroScale, flowAxes, liftCoefficient, liftSlope, observeAir } from './aero'
import { coreAssistOf, coreProfileOf, type CoreTuning } from './profile'
import { stepRotation } from './rotation'
import { stepDevices, stepThrottle } from './speed'
import { createCoreFlightState } from './state'

const DEG = Math.PI / 180

/** A fresh core state at `speed`, the engine trimmed for level flight there and the hold set to it. */
export function createCoreFlight(aircraftId: string, speed: number, tuning?: CoreTuning) {
  const p = coreProfileOf(aircraftId, tuning), q = aeroScale(p) * speed * speed
  const cl = q > 1e-9 ? Math.min(GRAVITY / q, p.clMax) : 0
  return createCoreFlightState(speed, Math.min(1, q * (p.cd0 + p.inducedK * cl * cl) / p.thrustDry))
}

/*
The rewrite core's flight step. Rotation is rate
command; translation is the sum of real forces on the velocity. The nose's direction is never
copied onto the velocity, and there is no separate lateral damping: side force from sideslip
is the only thing that bends the path toward a yawed nose (spec §7.5).

  a = thrust (along the nose) + lift (normal to the path, q·CL(α), capped at the G limit)
    + drag (q·(cd0 + k·CL² + cdHigh·(sin²α + sin²β) + brakes), against the path)
    + side (from β) + gravity

Forces are taken at the pose the step starts on. The part normal to the path turns the
velocity without changing its length, so lift does no work however hard the turn; only the part
along the path (thrust's share, drag) and gravity change the energy.

Body axes as the legacy core: +X forward, +Y up, +Z right; rates are body rad/s, positive pitch
raises the nose, positive roll banks right, positive yaw turns right.
*/
export function stepCoreFlight(state: AircraftState, command: PilotCommand, dt: number, tuning?: CoreTuning) {
  if (!state.alive || dt <= 0) return
  const p = coreProfileOf(state.aircraftId, tuning), assist = coreAssistOf(tuning)
  const velocity = new Vector3().copy(state.velocity), speed = velocity.length()
  const core = state.coreFlight ??= createCoreFlight(state.aircraftId, speed, tuning)
  const orientation = new Quaternion().copy(state.orientation)
  const air = observeAir(state.orientation, state.velocity)
  const { brake } = stepDevices(core, command, p, dt)

  const forward = new Vector3(1, 0, 0).applyQuaternion(orientation)
  const up = new Vector3(0, 1, 0).applyQuaternion(orientation)
  const right = new Vector3(0, 0, 1).applyQuaternion(orientation)
  const path = speed > 0.001 ? velocity.clone().divideScalar(speed) : forward.clone()
  const axes = flowAxes(up, right, path)

  // Aerodynamic forces (m/s²).
  const q = aeroScale(p) * speed * speed
  const cl = liftCoefficient(air.alphaDeg, p)
  const liftRaw = q * cl
  const lift = MathUtils.clamp(liftRaw, -p.gLimitNeg * GRAVITY, p.gLimit * GRAVITY)
  const clFlown = q > 1e-9 ? lift / q : 0
  const sinA = Math.sin(air.alphaDeg * DEG), sinB = Math.sin(air.betaDeg * DEG)
  const side = -q * p.cyBeta * sinB
  const drag = q * (p.cd0 + p.inducedK * clFlown * clFlown + p.cdHigh * (sinA * sinA + sinB * sinB) + core.airbrake * p.airbrakeCd + brake * p.brakeCd)
  const aero = axes.lift.clone().multiplyScalar(lift).addScaledVector(axes.side, side).addScaledVector(path, -drag)

  // Throttle and engine, against what the air and gravity do along the path.
  const thrust = stepThrottle(core, command, {
    airspeed: speed, g: aero.dot(up) / GRAVITY,
    alongPath: -drag - GRAVITY * path.y, thrustShare: forward.dot(path),
  }, p, assist, dt)
  const total = aero.addScaledVector(forward, thrust)

  // Rotation: the path's own turn toward the body's up feeds the FBW band.
  const pathRatePitch = speed > 1 ? (total.dot(axes.lift) - GRAVITY * axes.lift.y) / speed : 0
  const rotation = stepRotation(state.rates, {
    command: { pitch: command.pitch, roll: command.roll, yaw: command.yaw }, air, pathRatePitch,
    liftAccel: liftRaw, liftPerCl: q, liftSlope: liftSlope(air.alphaDeg, p), psmAuthority: core.psmAuthority,
  }, p, dt)

  // FD7 skeleton: at high alpha roll moves from the body axis toward the velocity vector.
  const rollAxisShare = p.rollAxisWeight * MathUtils.smoothstep(air.incidenceDeg, 15, 30) * air.confidence
  const rollAxis = new Vector3(1, 0, 0)
  if (rollAxisShare > 0) {
    const flow = path.clone().applyQuaternion(orientation.clone().invert())
    rollAxis.lerp(flow, rollAxisShare)
    if (rollAxis.length() < 0.2) rollAxis.set(1, 0, 0)
    rollAxis.normalize()
  }
  const angular = rollAxis.multiplyScalar(state.rates.roll).add(new Vector3(0, -state.rates.yaw, state.rates.pitch))
  const angle = angular.length() * dt
  if (angle > 0) orientation.multiply(new Quaternion().setFromAxisAngle(angular.normalize(), angle)).normalize()

  // Translation: the normal part turns the velocity, the along-path part and gravity add.
  const before = velocity.clone()
  if (speed > 1) {
    const along = total.dot(path)
    const normal = total.clone().addScaledVector(path, -along)
    const turn = Math.min(normal.length() * dt / speed, Math.PI / 2)
    const direction = path.clone().multiplyScalar(Math.cos(turn))
    if (turn > 0) direction.addScaledVector(normal.normalize(), Math.sin(turn))
    velocity.copy(direction.normalize().multiplyScalar(Math.max(0, speed + along * dt)))
  } else velocity.addScaledVector(total, dt)
  velocity.y -= GRAVITY * dt

  state.orientation = { x: orientation.x, y: orientation.y, z: orientation.z, w: orientation.w }
  Object.assign(state.velocity, { x: velocity.x, y: velocity.y, z: velocity.z })
  state.position.x += velocity.x * dt; state.position.y += velocity.y * dt; state.position.z += velocity.z * dt

  core.noseVelocityDeg = observeAir(state.orientation, state.velocity).incidenceDeg
  core.g = total.dot(up) / GRAVITY
  core.pathRateDeg = speed > 1 && velocity.length() > 1 ? before.angleTo(velocity) / dt / DEG : 0
  Object.assign(core.diag, {
    target: rotation.target, pilot: rotation.pilot, weathervane: rotation.weathervane, limit: rotation.limit,
    pitchBand: rotation.pitchBand, control: rotation.control, rollAxis: rollAxisShare,
    lift: Math.abs(lift), side: Math.abs(side), drag, thrust, liftCapped: lift !== liftRaw,
  })

  if (state.position.y <= 3) { state.position.y = 3; state.alive = false; state.stopReason = 'terrain' }
  if (Math.hypot(state.position.x, state.position.z) >= trainingMap.radius || state.position.y >= trainingMap.radius) {
    state.alive = false; state.stopReason = 'boundary'
  }
}
