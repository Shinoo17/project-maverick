import { Box3, Group, Matrix4, Mesh, Object3D, Quaternion, Vector3 } from 'three'
import type { AircraftState } from '../../game/state/WorldState'
import { getFlightProfile } from '../../game/flight/profile'
import { clamp } from '../../game/flight/speed'
import type { ExhaustNozzles } from '../exhaust/profile'

const RAD = Math.PI / 180
const smooth = (x: number) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t) }

/** Presentation allocation: normal flight favors surfaces, slow/high-alpha flight TVC. */
export function su57ControlTargets(state: AircraftState) {
  const flightProfile = getFlightProfile(state.aircraftId).flight
  const speed = Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z)
  const slow = 1 - smooth((speed - 45) / 105)
  const alpha = smooth((state.maneuver.alpha - 12) / 58)
  const postStall = state.maneuver.phase === 'active'
  const recovering = state.maneuver.phase === 'recovery'
  const authority = Math.max(.12 + .65 * slow, alpha, postStall ? 1 : recovering ? .8 : 0)
  const pitch = clamp(state.rates.pitch / flightProfile.pitchRate, -1, 1)
  const yaw = clamp(state.rates.yaw / flightProfile.yawRate, -1, 1)
  const roll = clamp(state.rates.roll / flightProfile.rollRate, -1, 1)
  // Signed flow errors give small cruise trim and low-rate recovery corrections.
  const path = new Vector3().copy(state.velocity).applyQuaternion(new Quaternion().copy(state.orientation).invert())
  const pitchSlip = speed > 1 ? Math.atan2(-path.y, path.x) : 0
  const yawSlip = speed > 1 ? Math.atan2(-path.z, path.x) : 0
  const correction = recovering ? .32 : postStall ? 0 : .025
  const p = clamp(pitch - pitchSlip * correction * (1 - Math.abs(pitch)), -1, 1) * 18 * authority
  const y = clamp(yaw - yawSlip * correction * (1 - Math.abs(yaw)), -1, 1) * 14 * authority
  const r = roll * 12 * authority
  // Yaw also changes the lateral contribution per engine; roll uses differential pitch.
  const left = { pitch: p - r, yaw: y * (1 - .22 * yaw) }
  const right = { pitch: p + r, yaw: y * (1 + .22 * yaw) }
  const scale = Math.min(1, 18 / Math.max(.001, Math.hypot(left.pitch, left.yaw), Math.hypot(right.pitch, right.yaw)))
  for (const side of [left, right]) { side.pitch *= scale; side.yaw *= scale }
  // enginePower is thrust/max dry thrust, not the guide's 0..1 lever. Only the
  // accepted burner flag enters the opening branch; high dry thrust stays closed.
  const power = state.alive ? clamp(state.enginePower, 0, 1) : 0
  const area = state.alive && state.maneuver.burnerActive ? 1 : .6 - 1.6 * power
  return { pitch, yaw, roll, slow, alpha, left, right, area, authority }
}

// Verified leading-edge endpoints in the shipped compact GLB's glTF frame
// (+Z nose, +X port). Surface centers in the guide are NOT hinge locations.
const surfaces = [
  { name: 'Aileron', pivot: [12.128, 5.842, -9.554], axis: [3.382, -.077, -.657], pitch: 0, roll: -25, yaw: 0, flap: 0, limit: 25 },
  { name: 'Flap', pivot: [7.795, 5.635, -10.545], axis: [4.317, .207, .993], pitch: -5, roll: -12, yaw: 0, flap: 14, limit: 25 },
  // All-moving stabilator spindle, from the source Elevator_l origin.
  { name: 'Elevator', pivot: [6.56, 5.60, -14.45], axis: [1, 0, 0], pitch: 23, roll: -10, yaw: 0, flap: 0, limit: 28 },
  // Canted all-moving fin: pivot at the root, axis follows the fin span.
  { name: 'Rudder', pivot: [6.10, 6.70, -11.94], axis: [.42, 1, 0], pitch: 0, roll: 0, yaw: 24, flap: 0, limit: 24 },
] as const

function surfaceHinge(model: Object3D, name: string, point: Vector3, axis: Vector3) {
  const part = model.getObjectByName(name)
  if (!part?.parent) return null
  // React StrictMode may construct the controller twice for the same clone.
  let pivot = part.parent
  if (pivot.name !== `${name}_FlightHinge`) {
    pivot = new Group(); pivot.name = `${name}_FlightHinge`; pivot.position.copy(point)
    part.parent.add(pivot); pivot.updateWorldMatrix(true, false); pivot.attach(part)
  }
  return (degrees: number) => pivot.quaternion.setFromAxisAngle(axis, degrees * RAD)
}

// Cache the actual lip at rest and at both morph extremes. The compact asset
// differs slightly from the guide dimensions, and the petal tips also move aft.
function measureExit(mesh: Mesh) {
  mesh.updateMatrix()
  const weights = mesh.morphTargetInfluences!, dictionary = mesh.morphTargetDictionary!
  const saved = [...weights], vertex = new Vector3(), bounds = new Box3()
  weights.fill(0)
  const points = Array.from({ length: mesh.geometry.attributes.position.count }, (_, i) => mesh.getVertexPosition(i, new Vector3()).applyMatrix4(mesh.matrix))
  const end = Math.max(...points.map(point => point.y))
  const ring = points.flatMap((point, i) => point.y > end - .01 ? [i] : [])
  const sample = (name?: string) => {
    weights.fill(0)
    if (name && dictionary[name] !== undefined) weights[dictionary[name]] = 1
    bounds.makeEmpty()
    for (const i of ring) bounds.expandByPoint(mesh.getVertexPosition(i, vertex).applyMatrix4(mesh.matrix))
    const center = bounds.getCenter(new Vector3())
    let radius = 0
    for (const i of ring) {
      mesh.getVertexPosition(i, vertex).applyMatrix4(mesh.matrix).sub(center)
      radius = Math.max(radius, Math.hypot(vertex.x, vertex.z))
    }
    return { center, radius }
  }
  const rest = sample(), close = sample('Iris_Close'), open = sample('Iris_Open')
  weights.splice(0, weights.length, ...saved)
  close.center.sub(rest.center); open.center.sub(rest.center)
  close.radius -= rest.radius; open.radius -= rest.radius
  return { rest, close, open }
}

export function createSu57FlightRig(model: Object3D) {
  const controls = surfaces.flatMap(surface => ([1, -1] as const).map(sign => {
    const [x, y, z] = surface.pivot, [ax, ay, az] = surface.axis
    const axis = surface.yaw ? new Vector3(ax * sign, ay, az) : new Vector3(ax, ay * sign, az * sign)
    return { ...surface, sign, angle: 0, set: surfaceHinge(model, `${surface.name}_${sign === 1 ? 'l' : 'r'}`, new Vector3(x * sign, y, z), axis.normalize()) }
  }))
  const sides = (['L', 'R'] as const).map(name => {
    const gimbal = model.getObjectByName(`Gimbal_${name}`)!
    const mesh = model.getObjectByName(`Nozzle_${name}`) as Mesh
    // Apply rotations in airframe axes and conjugate into each mount's actual
    // basis. The compact GLB has +Y aft, unlike the guide helper's +Z aft.
    const mount = gimbal.parent!.quaternion.clone()
    return { gimbal, mesh, exit: measureExit(mesh), mount, inverseMount: mount.clone().invert(), rest: gimbal.quaternion.clone(), pitch: 0, yaw: 0 }
  })
  const frame = () => ({ origin: new Vector3(), axis: new Vector3(), up: new Vector3(), radius: 0 })
  const exhaust: ExhaustNozzles = { left: frame(), right: frame() }
  const inverse = new Matrix4(), transform = new Matrix4(), rotation = new Quaternion(), vector = new Vector3()
  let initialized = false, area = 0
  return Object.assign((state: AircraftState, dt = 1 / 60, reset = false) => {
    if (reset) initialized = false
    const target = su57ControlTargets(state), step = Math.max(0, dt)
    const blend = initialized ? 1 - Math.exp(-step * 7) : 1
    const irisBlend = initialized ? 1 - Math.exp(-step * 5) : 1
    for (const surface of controls) {
      const angle = clamp(target.pitch * surface.pitch + target.roll * surface.roll * surface.sign + target.yaw * surface.yaw - target.slow * (1 - target.alpha) * surface.flap, -surface.limit, surface.limit)
      surface.angle += (angle - surface.angle) * blend
      surface.set?.(surface.angle)
    }
    area += (target.area - area) * irisBlend
    sides.forEach((side, i) => {
      const demand = i === 0 ? target.left : target.right
      // 36 deg/s gives ~one second from one end of the cone to the other.
      const dp = (demand.pitch - side.pitch) * blend, dy = (demand.yaw - side.yaw) * blend
      const rate = initialized ? Math.min(1, 36 * step / Math.max(.00001, Math.hypot(dp, dy))) : 1
      side.pitch += dp * rate; side.yaw += dy * rate
      vector.set(side.pitch, side.yaw, 0)
      const angle = vector.length() * RAD
      rotation.setFromAxisAngle(vector.normalize(), angle)
      side.gimbal.quaternion.copy(side.inverseMount).multiply(rotation).multiply(side.mount).multiply(side.rest)
      const weights = side.mesh.morphTargetInfluences, dictionary = side.mesh.morphTargetDictionary
      if (weights && dictionary) {
        if (dictionary.Iris_Close !== undefined) weights[dictionary.Iris_Close] = Math.max(0, -area)
        if (dictionary.Iris_Open !== undefined) weights[dictionary.Iris_Open] = Math.max(0, area)
      }
    })
    model.updateWorldMatrix(true, true)
    if (model.parent) inverse.copy(model.parent.matrixWorld).invert()
    else inverse.identity()
    sides.forEach((side, i) => {
      transform.multiplyMatrices(inverse, side.gimbal.matrixWorld)
      const output = i === 0 ? exhaust.left : exhaust.right
      output.axis.set(0, 1, 0).transformDirection(transform)
      output.up.set(0, 0, -1).transformDirection(transform)
      const weights = side.mesh.morphTargetInfluences, dictionary = side.mesh.morphTargetDictionary
      const close = weights?.[dictionary?.Iris_Close ?? -1] ?? 0, open = weights?.[dictionary?.Iris_Open ?? -1] ?? 0
      output.origin.copy(side.exit.rest.center).addScaledVector(side.exit.close.center, close).addScaledVector(side.exit.open.center, open).applyMatrix4(transform)
      output.radius = (side.exit.rest.radius + side.exit.open.radius * open + side.exit.close.radius * close) * vector.setFromMatrixColumn(transform, 0).length()
    })
    initialized = true
  }, { exhaust })
}
