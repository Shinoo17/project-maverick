import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Box3, Mesh, Vector3, type Object3D } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { aircraft } from '../src/content/aircraft'
import { hitboxes, type HitShape } from '../src/content/hitboxes'
import { validateAircraft } from '../src/content/validate'
import { buildFlightModel } from '../src/render/aircraft/flightModel'

// Distance from a body-frame point to the nearest hitbox surface; 0 inside.
function distance(point: Vector3, shapes: readonly HitShape[]) {
  return Math.min(...shapes.map(shape => {
    if (shape.kind === 'box') {
      return Math.hypot(...[0, 1, 2].map(axis => Math.max(0, Math.abs(point.getComponent(axis) - shape.center[axis]) - shape.half[axis])))
    }
    const from = new Vector3(...shape.from), axis = new Vector3(...shape.to).sub(from)
    const along = axis.lengthSq() ? Math.min(1, Math.max(0, point.clone().sub(from).dot(axis) / axis.lengthSq())) : 0
    return Math.max(0, point.distanceTo(from.addScaledVector(axis, along)) - shape.radius)
  }))
}
function vertices(root: Object3D) {
  const points: Vector3[] = []
  root.updateMatrixWorld(true)
  root.traverse(object => {
    if (!(object instanceof Mesh)) return
    const position = object.geometry.attributes.position
    for (let index = 0; index < position.count; index++) points.push(new Vector3().fromBufferAttribute(position, index).applyMatrix4(object.matrixWorld))
  })
  return points
}

const models = new Map<string, Object3D>()
beforeAll(async () => {
  vi.stubGlobal('ProgressEvent', class {})
  for (const entry of aircraft) {
    const bytes = readFileSync(new URL(`../public/assets/aircraft/${entry.modelFile}`, import.meta.url))
    const length = bytes.readUInt32LE(12), doc = JSON.parse(bytes.subarray(20, 20 + length).toString())
    delete doc.images; delete doc.textures; delete doc.materials
    for (const mesh of doc.meshes) for (const primitive of mesh.primitives) delete primitive.material
    doc.buffers[0].uri = `data:application/octet-stream;base64,${bytes.subarray(28 + length).toString('base64')}`
    const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(JSON.stringify(doc), '')
    models.set(entry.id, buildFlightModel(gltf, entry))
  }
}, 60000)
afterAll(() => {
  for (const model of models.values()) model.traverse(object => { if (object instanceof Mesh) object.geometry.dispose() })
  vi.unstubAllGlobals()
})

describe('hitbox content', () => {
  it('rejects unknown profiles and malformed shapes', () => {
    expect(() => validateAircraft([{ ...aircraft[0], hitboxProfileId: 'none' }])).toThrow('aircraft[0].hitboxProfileId')
    hitboxes.broken = [{ kind: 'capsule', from: [0, 0, 0], to: [1, 0, 0], radius: 0 }]
    try { expect(() => validateAircraft([{ ...aircraft[0], hitboxProfileId: 'broken' }])).toThrow('aircraft[0].hitboxes[0].radius') }
    finally { delete hitboxes.broken }
  })
})

describe.each(aircraft.map(entry => [entry.id, entry] as const))('%s hitboxes against the flight model', (_, entry) => {
  const shapes = hitboxes[entry.hitboxProfileId]
  it('stay inside the model bounds', () => {
    const bounds = new Box3().setFromObject(models.get(entry.id)!).expandByScalar(0.3)
    for (const shape of shapes) {
      const corners = shape.kind === 'box'
        ? [new Vector3(...shape.center).sub(new Vector3(...shape.half)), new Vector3(...shape.center).add(new Vector3(...shape.half))]
        : [new Vector3(...shape.from).subScalar(shape.radius), new Vector3(...shape.to).addScalar(shape.radius)]
      for (const corner of corners) expect(bounds.containsPoint(corner), `${JSON.stringify(shape)} leaves the model`).toBe(true)
    }
  })
  it('reach the nose, tail, wingtips and fin tops', () => {
    const points = vertices(models.get(entry.id)!)
    const extreme = (score: (point: Vector3) => number) => points.reduce((best, point) => score(point) > score(best) ? point : best)
    const probes = {
      nose: extreme(point => point.x), tail: extreme(point => -point.x),
      rightWingtip: extreme(point => point.z), leftWingtip: extreme(point => -point.z), finTop: extreme(point => point.y),
    }
    for (const [name, point] of Object.entries(probes)) expect(distance(point, shapes), name).toBeLessThan(0.6)
  })
})
