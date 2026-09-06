import { Object3D, Quaternion, Vector3 } from 'three'
import type { AircraftState } from '../../game/state/WorldState'
import { flightProfile } from '../../game/flight/profile'
import { clamp } from '../../game/flight/speed'

// Mesh/hinge facts are adapted from example/F22's verified rig manifest. All
// transforms are local to a cloned presentation model; no simulation writes.
const surfaces = [
  { mesh: 'Tail_Stabilator_L', pitch: -20, roll: 8, yaw: 0, limit: 20 },
  { mesh: 'Tail_Stabilator_R', pitch: -20, roll: -8, yaw: 0, limit: 20 },
  { mesh: 'Wing_Aileron_L', pitch: 0, roll: 25, yaw: 0, limit: 25 },
  { mesh: 'Wing_Aileron_R', pitch: 0, roll: -25, yaw: 0, limit: 25 },
  { mesh: 'Wing_Flaperon_L', pitch: -10, roll: 15, yaw: 0, limit: 23 },
  { mesh: 'Wing_Flaperon_R', pitch: -10, roll: -15, yaw: 0, limit: 23 },
  { mesh: 'Tail_VerticalFin_L', pitch: 0, roll: 0, yaw: 22, limit: 23 },
  { mesh: 'Tail_VerticalFin_R', pitch: 0, roll: 0, yaw: 22, limit: 23 },
] as const
function hinge(model: Object3D, name: string, axis: Vector3, reference: Vector3) {
  const bone = model.getObjectByName(name)?.parent
  if (!bone) return null
  const body = new Quaternion()
  for (let node: Object3D | null = bone; node; node = node.parent) { body.premultiply(node.quaternion); if (node === model) break }
  if (axis.clone().applyQuaternion(body).dot(reference) < 0) axis.negate()
  const rest = bone.quaternion.clone(), rotation = new Quaternion()
  return (degrees: number) => bone.quaternion.copy(rest).multiply(rotation.setFromAxisAngle(axis, degrees * Math.PI / 180))
}
export function createFlightRig(model: Object3D) {
  const controls = surfaces.map(surface => ({ ...surface, set: hinge(model, surface.mesh, new Vector3(0, 1, 0), surface.yaw ? new Vector3(0, 1, 0) : new Vector3(0, 0, 1)) }))
  const nozzles = ['L', 'R'].flatMap(side => ['Upper', 'Lower'].map((part, index) => ({
    direction: index === 0 ? 1 : -1,
    set: hinge(model, `Engine_Nozzle_${side}_Flap_${part}`, new Vector3(1, 0, 0), new Vector3(0, 0, -1)),
  })))
  return (state: AircraftState) => {
    const pitch = state.rates.pitch / flightProfile.pitchRate, roll = state.rates.roll / flightProfile.rollRate, yaw = state.rates.yaw / flightProfile.yawRate
    controls.forEach(surface => surface.set?.(clamp(pitch * surface.pitch + roll * surface.roll + yaw * surface.yaw, -surface.limit, surface.limit)))
    nozzles.forEach(nozzle => nozzle.set?.(nozzle.direction * state.enginePower * 5))
  }
}
