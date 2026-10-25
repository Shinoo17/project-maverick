import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Matrix4, type AnimationClip, type Object3D } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { getAircraft } from '../src/content/aircraft'
import { buildFlightModel } from '../src/render/aircraft/flightModel'
import { createBayDoors } from '../src/render/aircraft/bayDoors'

let asset: { scene: Object3D; animations: AnimationClip[] }
beforeAll(async () => {
  vi.stubGlobal('ProgressEvent', class {})
  const bytes = readFileSync(new URL(`../public/assets/aircraft/${getAircraft('f22').modelFile}`, import.meta.url))
  const length = bytes.readUInt32LE(12), doc = JSON.parse(bytes.subarray(20, 20 + length).toString())
  delete doc.images; delete doc.textures; delete doc.materials
  for (const mesh of doc.meshes) for (const primitive of mesh.primitives) delete primitive.material
  doc.buffers[0].uri = `data:application/octet-stream;base64,${bytes.subarray(28 + length).toString('base64')}`
  asset = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(JSON.stringify(doc), '')
}, 60000)
afterAll(() => { vi.unstubAllGlobals() })

describe('bay doors', () => {
  it('open the bay a missile left, on its side only, and close it after', () => {
    const model = buildFlightModel(asset, getAircraft('f22'))
    const doors = createBayDoors(model, asset.animations, 'f22')!
    const pose = (name: string) => { model.updateMatrixWorld(true); return new Matrix4().copy(model.getObjectByName(name)!.matrixWorld) }
    const rest = { left: pose('Bay_Side_Door_L_Outer'), right: pose('Bay_Side_Door_R_Outer'), main: pose('Bay_Center_Door_L') }
    doors.update(0)
    doors.open('side-bays', -1.3, 0)
    for (let t = 0; t <= 0.3; t += 1 / 60) doors.update(t)
    expect(pose('Bay_Side_Door_L_Outer').equals(rest.left)).toBe(false)
    expect(pose('Bay_Side_Door_R_Outer').equals(rest.right)).toBe(true)
    expect(pose('Bay_Center_Door_L').equals(rest.main)).toBe(true)
    for (let t = 0.3; t <= 3; t += 1 / 60) doors.update(t)
    expect(pose('Bay_Side_Door_L_Outer').equals(rest.left)).toBe(true)
    doors.dispose()
  })
  it('leaves an aircraft without bay clips alone', () => {
    expect(createBayDoors(buildFlightModel(asset, getAircraft('f22')), [], 'su57')).toBeNull()
  })
})
