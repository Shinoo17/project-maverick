import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { Box3, Group, Mesh, Quaternion, Vector3 } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { aircraft } from '../src/content/aircraft'
import { prepareAnimations } from '../src/render/aircraft/animationStages'
import { ExhaustResponse, getExhaustProfile, flightExhaustConditions } from '../src/render/exhaust/profile'
import { createFlightRig } from '../src/render/aircraft/flightRig'
import { GameRuntime } from '../src/game/runtime/GameRuntime'

const conditions = { aircraftId: 'f22' as const, power: 1, afterburner: false, vectorAngle: 0 }
describe('exhaust simulation coupling', () => {
  it('uses the accepted burner state and shuts down for a dead engine without mutating flight state', () => {
    const state = new GameRuntime({ mode: 'playground', mapId: 'flat-range', aircraftIds: ['f22'] }).snapshot().aircraft[0]
    state.enginePower = .7; state.maneuver.burnerActive = true
    const before = structuredClone(state)
    expect(flightExhaustConditions(state)).toMatchObject({ power: .7, afterburner: true })
    expect(state).toEqual(before)
    state.maneuver.burnerActive = false
    expect(flightExhaustConditions(state).afterburner).toBe(false)
    state.alive = false; state.maneuver.burnerActive = true
    expect(flightExhaustConditions(state)).toMatchObject({ power: 0, afterburner: false })
  })
  it('smoothly ignites and extinguishes at the same rate across frame rates', () => {
    const responses = [30, 120].map(fps => {
      const response = new ExhaustResponse(); response.update(conditions, 0)
      for (let i = 0; i < fps / 2; i++) response.update({ ...conditions, afterburner: true }, 1 / fps)
      expect(response.burner).toBeGreaterThan(.98)
      for (let i = 0; i < fps; i++) response.update(conditions, 1 / fps)
      return response
    })
    expect(responses[0].burner).toBeCloseTo(responses[1].burner, 10)
    expect(responses[0].burner).toBeLessThan(.004)
  })
  it('freezes at pause, removes flicker with reduced motion, and clears stale state on reset', () => {
    const response = new ExhaustResponse(); response.update(conditions, .2)
    response.update({ ...conditions, afterburner: true }, 0)
    expect(response.burner).toBe(0); expect(response.time).toBe(.2)
    response.update({ ...conditions, afterburner: true }, .2, true)
    expect(response.burner).toBeGreaterThan(.5); expect(response.time).toBe(.2)
    response.reset(); expect(response.power + response.burner + response.time).toBe(0)
  })
})

// Load real mesh/animation data but omit textures, which need a browser. This
// guards against anchoring to export-pose bounds or to the tail instead of the
// nozzle: both can pass visual checks from a distant chase camera.
describe('nozzle anchors on shipped GLBs', () => {
  for (const definition of aircraft) it(`${definition.id} starts inside the prepared nozzle geometry`, async () => {
    vi.stubGlobal('ProgressEvent', class { constructor(_type: string, data: object) { Object.assign(this, data) } })
    const bytes = readFileSync(new URL(`../public/assets/aircraft/${definition.modelFile}`, import.meta.url))
    const jsonLength = bytes.readUInt32LE(12), document = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString())
    delete document.images; delete document.textures; delete document.materials
    for (const mesh of document.meshes) for (const primitive of mesh.primitives) delete primitive.material
    document.buffers[0].uri = `data:application/octet-stream;base64,${bytes.subarray(28 + jsonLength).toString('base64')}`
    const asset = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(JSON.stringify(document), '')
    try {
      for (const name of definition.removeNodes) asset.scene.getObjectByName(name)?.removeFromParent()
      prepareAnimations(asset.scene, asset.animations)
      const orientation = new Group(); orientation.rotation.set(...definition.rotation); orientation.add(asset.scene)
      const bounds = new Box3().setFromObject(orientation), size = bounds.getSize(new Vector3())
      orientation.position.copy(bounds.getCenter(new Vector3())).negate()
      const root = new Group(); root.add(orientation); root.scale.setScalar(18.9 / Math.max(size.x, size.y, size.z)); root.updateMatrixWorld(true)
      const p = getExhaustProfile(definition.id)
      for (const [side, sign] of [['L', -1], ['R', 1]] as const) {
        const nozzle = new Box3()
        const names = definition.id === 'f22' ? [`Engine_Nozzle_${side}_Flap_Upper`, `Engine_Nozzle_${side}_Flap_Lower`] : [`Nozzle_${side}`]
        for (const name of names) nozzle.union(new Box3().setFromObject(root.getObjectByName(name)!))
        expect(p.lipX).toBeCloseTo(nozzle.min.x, 1)
        expect(p.height).toBeCloseTo(nozzle.getCenter(new Vector3()).y, 2)
        expect(p.centerZ + sign * p.spacing).toBeCloseTo(nozzle.getCenter(new Vector3()).z, 2)
        expect(nozzle.containsPoint(new Vector3(p.lipX + p.inset, p.height, p.centerZ + sign * p.spacing))).toBe(true)
        expect(p.width * 2).toBeLessThan(nozzle.max.z - nozzle.min.z)
      }
      if (definition.id === 'f22') {
        const s = new GameRuntime({ mode: 'playground', aircraftIds: ['f22'] }).snapshot().aircraft[0]
        s.enginePower = 0 // isolate vector angle from symmetric exit-area motion
        const bones = ['L', 'R'].flatMap(side => ['Upper', 'Lower'].map(part => ({ side, bone: root.getObjectByName(`Engine_Nozzle_${side}_Flap_${part}`)!.parent! })))
        const rest = bones.map(({ bone }) => bone.getWorldQuaternion(new Quaternion()).normalize())
        const rig = createFlightRig(root, definition.id)
        for (const angles of [{ left: 20, right: 20 }, { left: -20, right: -20 }, { left: -6, right: 6 }, { left: 14, right: 20 }]) {
          Object.assign(s.thrustVectoring, angles)
          const before = structuredClone(s)
          rig(s, 0); root.updateMatrixWorld(true)
          for (const [i, { side, bone }] of bones.entries()) {
            const angle = (side === 'L' ? angles.left : angles.right) * Math.PI / 180
            const actual = bone.getWorldQuaternion(new Quaternion()).normalize().multiply(rest[i].clone().invert()).normalize()
            const expected = new Quaternion().setFromAxisAngle(new Vector3(0, 0, -1), angle)
            expect(actual.angleTo(expected)).toBeLessThan(.0001)
            const direction = new Vector3(-1, 0, 0).applyQuaternion(actual)
            // Exported parent scales introduce less than 0.006 degrees of decomposition error.
            expect(Math.abs(direction.y - Math.sin(angle))).toBeLessThan(.0001)
            expect(Math.abs(direction.z)).toBeLessThan(.0001)
          }
          expect(s).toEqual(before)
        }
        // Rendering may be repeated or paused: it must not damp or advance TVC.
        const pose = bones[0].bone.quaternion.clone()
        rig(s, 10)
        expect(bones[0].bone.quaternion.angleTo(pose)).toBeLessThan(1e-7)
      }
    } finally {
      asset.scene.traverse(o => { if (o instanceof Mesh) { o.geometry.dispose(); for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose() } })
      vi.unstubAllGlobals()
    }
  })
})
