// Bakes the leading-edge vortex path for each aircraft onto its real upper skin.
// Run: node scripts/measure-vapor-paths.mjs — paste the output into lexPaths in
// src/render/vapor/profile.ts. Uses the same normalization as the game (rotation,
// centered bounds, 18.9 units long) and casts rays straight down onto the mesh.
import { readFileSync } from 'node:fs'
import { Box3, Group, PropertyBinding, Raycaster, Vector3 } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'

/*
Per aircraft: the stations (+X nose) the vortex runs over, the span (Z) line it
follows, and how high its axis sits above the skin. Z changes slowly so the
line stays parallel to the fuselage.
*/
const aircraft = {
  f22: { file: 'F22_compact.glb', rotY: 0, remove: ['MLG_Bay_Fitting_01', 'MLG_Bay_Fitting_02'], x: [4.0, -3.2], z: [1.2, 2.1], lift: .02 },
  su57: { file: 'SU57_compact.glb', rotY: Math.PI / 2, remove: ['Nozzles_ORIG_backup', 'Gear_down', 'Probe_on', 'Prototype_su57_antenna_ng'], x: [3.4, -3.5], z: [1.25, 1.85], lift: .12 },
}
const POINTS = 6

// GLTFLoader cannot decode KTX2 textures in Node; geometry is all this needs.
function stripTextures(buffer) {
  const jsonLength = buffer.readUInt32LE(12)
  const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString())
  const bin = buffer.subarray(20 + jsonLength + 8)
  delete json.images; delete json.textures; delete json.samplers
  for (const material of json.materials ?? []) for (const key of Object.keys(material)) if (key !== 'name') delete material[key]
  for (const key of ['extensionsUsed', 'extensionsRequired']) if (json[key]) json[key] = json[key].filter(name => !name.includes('texture'))
  const text = JSON.stringify(json), chunk = Buffer.from(text.padEnd(Math.ceil(text.length / 4) * 4, ' '))
  const out = Buffer.alloc(28 + chunk.length + bin.length)
  out.write('glTF', 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(out.length, 8)
  out.writeUInt32LE(chunk.length, 12); out.write('JSON', 16); chunk.copy(out, 20)
  out.writeUInt32LE(bin.length, 20 + chunk.length); out.write('BIN\0', 24 + chunk.length); bin.copy(out, 28 + chunk.length)
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.length)
}

await MeshoptDecoder.ready
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
const raycaster = new Raycaster(), down = new Vector3(0, -1, 0)
for (const [id, spec] of Object.entries(aircraft)) {
  const data = stripTextures(readFileSync(new URL(`../public/assets/aircraft/${spec.file}`, import.meta.url)))
  const gltf = await new Promise((resolve, reject) => loader.parse(data, '', resolve, reject))
  for (const name of spec.remove) gltf.scene.getObjectByName(name)?.removeFromParent()
  // The game applies the first animation frame before measuring bounds (prepareAnimations).
  const applied = new Set()
  for (const clip of gltf.animations) for (const track of clip.tracks) {
    if (applied.has(track.name)) continue
    const binding = PropertyBinding.create(gltf.scene, track.name)
    binding.setValue(track.createInterpolant().evaluate(0), 0); binding.unbind()
    applied.add(track.name)
  }
  gltf.scene.updateMatrixWorld(true)
  const orientation = new Group(); orientation.rotation.set(0, spec.rotY, 0); orientation.add(gltf.scene)
  const bounds = new Box3().setFromObject(orientation), size = bounds.getSize(new Vector3())
  orientation.position.copy(bounds.getCenter(new Vector3())).negate()
  const root = new Group(); root.add(orientation); root.scale.setScalar(18.9 / Math.max(size.x, size.y, size.z)); root.updateMatrixWorld(true)
  const points = []
  for (let i = 0; i < POINTS; i++) {
    const t = i / (POINTS - 1), x = spec.x[0] + (spec.x[1] - spec.x[0]) * t, z = spec.z[0] + (spec.z[1] - spec.z[0]) * t
    raycaster.set(new Vector3(x, 5, z), down)
    const hit = raycaster.intersectObject(root, true)[0]
    if (!hit) throw new Error(`${id}: no skin under x ${x.toFixed(2)}, z ${z.toFixed(2)}`)
    points.push([x, hit.point.y + spec.lift, z].map(value => Number(value.toFixed(3))))
  }
  console.log(`${id}: ${JSON.stringify(points)}`)
}
