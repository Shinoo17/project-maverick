import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Box3, Group, Mesh, Quaternion, Vector3 } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { clone } from 'three/addons/utils/SkeletonUtils.js'
import { getAircraft } from '../src/content/aircraft'
import { GameRuntime } from '../src/game/runtime/GameRuntime'
import { getFlightProfile } from '../src/game/flight/profile'
import { createFlightRig } from '../src/render/aircraft/flightRig'
import { stepThrustVectoring, tvcTargets, thrustForces } from '../src/game/flight/thrustVectoring'
import { neutralCommand } from '../src/game/runtime/commands'
import { su57ControlTargets } from '../src/render/aircraft/su57Rig'

const flightProfile = getFlightProfile('su57').flight

const state = () => {
  const s = new GameRuntime({ mode: 'playground', mapId: 'flat-range', aircraftIds: ['su57'] }).snapshot().aircraft[0]
  s.velocity = { x: 180, y: 0, z: 0 }; s.orientation = { x: 0, y: 0, z: 0, w: 1 }; s.enginePower = .5
  return s
}
describe('Su-57 control allocation', () => {
  it('renders actual nozzle angles regardless of body rate, speed or PSM phase', () => {
    const s = state()
    s.thrustVectoring = { left: 12, right: -9, authority: 0.7 }
    const expected = su57ControlTargets(s)
    s.rates.pitch = -100; s.rates.yaw = 100; s.velocity.x = 20; s.maneuver.phase = 'active'
    expect(su57ControlTargets(s).left).toEqual(expected.left)
    expect(su57ControlTargets(s).right).toEqual(expected.right)
    expect(Math.hypot(expected.left.pitch, expected.left.yaw)).toBeCloseTo(12)
    expect(Math.hypot(expected.right.pitch, expected.right.yaw)).toBeCloseTo(9)
  })
  it('uses shared, bounded travel for differential roll/yaw and mirrors the cant', () => {
    const s = state(), p = getFlightProfile('su57').thrustVectoring!
    Object.assign(s.thrustVectoring, tvcTargets({ pitch: 0, roll: 1, yaw: 1 }, 1, p))
    const t = su57ControlTargets(s)
    expect(t.left.pitch).toBeLessThan(0); expect(t.right.pitch).toBeGreaterThan(0)
    expect(t.left.yaw).toBeGreaterThan(0); expect(t.right.yaw).toBeGreaterThan(0)
    expect(Math.hypot(t.left.pitch, t.left.yaw)).toBeCloseTo(p.maxAngle)
    expect(Math.hypot(t.right.pitch, t.right.yaw)).toBeCloseTo(p.maxAngle)
    const force = thrustForces(s.thrustVectoring, 30, p)
    expect(force.angularAcceleration.yaw).toBeGreaterThan(0)
    expect(force.angularAcceleration.roll).toBeGreaterThan(0)
    expect(force.acceleration.z).toBeLessThan(0)
  })
  it('never invents recovery nozzle motion from slip or angular velocity', () => {
    const s = state(); s.maneuver.phase = 'recovery'; s.maneuver.alpha = 60
    s.velocity = { x: 40, y: -60, z: -20 }; s.rates.pitch = 1
    const t = su57ControlTargets(s)
    expect(t.left.pitch).toBe(0); expect(t.left.yaw).toBe(0)
  })
  it('uses the V-shaped iris schedule and accepted burner state without simulation writes', () => {
    const s = state(); s.enginePower = 0
    expect(su57ControlTargets(s).area).toBe(.6)
    s.enginePower = 1
    expect(su57ControlTargets(s).area).toBe(-1)
    s.maneuver.burnerActive = true
    const before = structuredClone(s)
    expect(su57ControlTargets(s).area).toBe(1)
    expect(s).toEqual(before)
    s.alive = false
    expect(su57ControlTargets(s).area).toBe(.6)
  })
})

let asset: Group
beforeAll(async () => {
  vi.stubGlobal('ProgressEvent', class {})
  const bytes = readFileSync(new URL('../public/assets/aircraft/SU57_compact.glb', import.meta.url))
  const length = bytes.readUInt32LE(12), doc = JSON.parse(bytes.subarray(20, 20 + length).toString())
  delete doc.images; delete doc.textures; delete doc.materials
  for (const mesh of doc.meshes) for (const primitive of mesh.primitives) delete primitive.material
  doc.buffers[0].uri = `data:application/octet-stream;base64,${bytes.subarray(28 + length).toString('base64')}`
  asset = (await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(JSON.stringify(doc), '')).scene
  for (const name of getAircraft('su57').removeNodes) asset.getObjectByName(name)?.removeFromParent()
})
afterAll(() => {
  asset?.traverse(o => { if (o instanceof Mesh) { o.geometry.dispose(); for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose() } })
  vi.unstubAllGlobals()
})
function fixture() {
  const model = clone(asset), orientation = new Group(); orientation.rotation.y = Math.PI / 2; orientation.add(model)
  const bounds = new Box3().setFromObject(orientation), size = bounds.getSize(new Vector3())
  orientation.position.copy(bounds.getCenter(new Vector3())).negate()
  const root = new Group(); root.scale.setScalar(18.9 / Math.max(size.x, size.y, size.z)); root.add(orientation)
  const displayed = new Group(); displayed.add(root); displayed.position.set(100, 400, -300); displayed.rotation.set(.2, .3, .4)
  displayed.updateMatrixWorld(true)
  return { root, model, displayed }
}
describe('Su-57 shipped model articulation', () => {
  it('inserts eight hinges without moving rest geometry, and leaves the source asset untouched', () => {
    const { root } = fixture()
    const names = ['Aileron_l', 'Aileron_r', 'Flap_l', 'Flap_r', 'Elevator_l', 'Elevator_r', 'Rudder_l', 'Rudder_r']
    const before = names.map(name => root.getObjectByName(name)!.matrixWorld.clone())
    createFlightRig(root, 'su57'); createFlightRig(root, 'su57'); root.updateMatrixWorld(true)
    let hinges = 0
    root.traverse(o => { if (o.name.endsWith('_FlightHinge')) hinges++ })
    expect(hinges).toBe(8)
    names.forEach((name, i) => {
      const part = root.getObjectByName(name)!
      expect(part.parent!.name).toBe(`${name}_FlightHinge`)
      part.matrixWorld.elements.forEach((value, j) => expect(value).toBeCloseTo(before[i].elements[j], 9))
      expect(asset.getObjectByName(name)!.parent!.name).not.toBe(`${name}_FlightHinge`)
    })
  })
  it('moves real nozzle lips upward for nose-up and keeps exhaust attached through combined TVC and iris motion', () => {
    const { root, displayed } = fixture(), rig = createFlightRig(root, 'su57'), s = state()
    const mounts = ['L', 'R'].map(side => root.getObjectByName(`NozzleMount_${side}`)!.quaternion.clone())
    s.enginePower = 1; rig(s, 0, true)
    const neutral = [rig.exhaust!.left.origin.clone(), rig.exhaust!.right.origin.clone()]
    s.maneuver.phase = 'active'; s.rates.pitch = flightProfile.pitchRate
    s.thrustVectoring.left = s.thrustVectoring.right = 18
    rig(s, 0, true)
    expect(rig.exhaust!.left.origin.y).toBeGreaterThan(neutral[0].y)
    expect(rig.exhaust!.right.origin.y).toBeGreaterThan(neutral[1].y)
    const rings = ['L', 'R'].map(name => {
      const mesh = root.getObjectByName(`Nozzle_${name}`) as Mesh
      mesh.morphTargetInfluences!.fill(0)
      const points = Array.from({ length: mesh.geometry.attributes.position.count }, (_, i) => mesh.getVertexPosition(i, new Vector3()).applyMatrix4(mesh.matrix))
      const end = Math.max(...points.map(v => v.y))
      return points.flatMap((v, i) => v.y > end - .01 ? [i] : [])
    })
    s.rates.roll = flightProfile.rollRate; s.rates.yaw = flightProfile.yawRate; s.maneuver.burnerActive = true
    s.thrustVectoring.left = -8; s.thrustVectoring.right = 18
    rig(s, 0, true)
    for (const [i, name] of ['L', 'R'].entries()) {
      const gimbal = root.getObjectByName(`Gimbal_${name}`)!, mesh = root.getObjectByName(`Nozzle_${name}`) as Mesh
      const frame = i === 0 ? rig.exhaust!.left : rig.exhaust!.right
      const tips = rings[i].map(vertex => mesh.getVertexPosition(vertex, new Vector3()).applyMatrix4(mesh.matrix))
      const center = new Box3().setFromPoints(tips).getCenter(new Vector3())
      const lip = displayed.worldToLocal(gimbal.localToWorld(center.clone()))
      expect(frame.origin.distanceTo(lip)).toBeLessThan(1e-8)
      expect(frame.axis.length()).toBeCloseTo(1); expect(frame.axis.dot(frame.up)).toBeCloseTo(0)
      expect(gimbal.quaternion.angleTo(new Quaternion()) / (Math.PI / 180)).toBeLessThanOrEqual(18.00001)
      expect(gimbal.parent!.quaternion.angleTo(mounts[i])).toBeLessThan(1e-7)
      expect(mesh.morphTargetInfluences![mesh.morphTargetDictionary!.Iris_Open]).toBe(1)
      // Measure the animated exit ring itself, not the nozzle's wider fixed collar.
      const radius = Math.max(...tips.map(v => Math.hypot(v.x - center.x, v.z - center.z)))
      expect(frame.radius / root.scale.x).toBeCloseTo(radius, 5)
    }
    expect(rig.exhaust!.left.axis.distanceTo(rig.exhaust!.right.axis)).toBeGreaterThan(.1)
  })
  it('turns both real rudder trailing edges and nozzle axes starboard for positive yaw', () => {
    const { root, model } = fixture(), rig = createFlightRig(root, 'su57'), s = state()
    rig(s, 0, true)
    const before = rig.exhaust!.left.axis.clone()
    // Choose the aft-most vertex in the fin, including the multi-mesh port fin.
    const trailing = ['l', 'r'].map(side => {
      const fin = model.getObjectByName(`Rudder_${side}`)!
      let aft = Infinity, selected = { mesh: null as Mesh | null, index: 0, port: 0 }
      fin.traverse(o => {
        if (!(o instanceof Mesh)) return
        for (let i = 0; i < o.geometry.attributes.position.count; i++) {
          const v = model.worldToLocal(o.localToWorld(o.getVertexPosition(i, new Vector3())))
          if (v.z < aft) { aft = v.z; selected = { mesh: o, index: i, port: v.x } }
        }
      })
      return selected
    })
    s.rates.yaw = flightProfile.yawRate
    s.thrustVectoring.left = -14; s.thrustVectoring.right = 14
    rig(s, 0, true)
    for (const point of trailing) {
      const mesh = point.mesh!
      const v = model.worldToLocal(mesh.localToWorld(mesh.getVertexPosition(point.index, new Vector3())))
      expect(v.x).toBeLessThan(point.port)
    }
    expect(rig.exhaust!.left.axis.z).toBeGreaterThan(before.z)
  })
  it('freezes actuators at pause, clears old poses on reset, and never changes Body', () => {
    const { root } = fixture(), rig = createFlightRig(root, 'su57'), s = state()
    const body = root.getObjectByName('Body')!, bodyPose = body.matrix.clone()
    rig(s, 0, true)
    const gimbal = root.getObjectByName('Gimbal_L')!, initial = gimbal.quaternion.clone()
    s.maneuver.phase = 'active'; s.rates.pitch = flightProfile.pitchRate; s.enginePower = 1
    rig(s, 0)
    expect(gimbal.quaternion.angleTo(initial)).toBeLessThan(1e-7)
    stepThrustVectoring(s, { ...neutralCommand(0, s.id), pitch: 1 }, 1 / 120, 40, 90)
    rig(s, 1 / 120)
    expect(gimbal.quaternion.angleTo(initial)).toBeGreaterThan(0)
    expect(gimbal.quaternion.angleTo(initial)).toBeLessThanOrEqual(36 / 120 * Math.PI / 180 + 1e-7)
    rig(state(), 0, true)
    expect(gimbal.quaternion.angleTo(initial)).toBeLessThan(1e-7)
    expect(body.matrix.elements).toEqual(bodyPose.elements)
  })
})
