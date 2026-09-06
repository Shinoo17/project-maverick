import { copyFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
for (const name of ['F22_compact.glb', 'SU57_compact.glb']) {
  await mkdir(new URL('public/assets/aircraft/', root), { recursive: true })
  await copyFile(new URL(`model/${name}`, root), new URL(`public/assets/aircraft/${name}`, root))
}
await mkdir(new URL('public/basis/', root), { recursive: true })
for (const name of ['basis_transcoder.js', 'basis_transcoder.wasm']) {
  await copyFile(new URL(`node_modules/three/examples/jsm/libs/basis/${name}`, root), new URL(`public/basis/${name}`, root))
}
console.log(`Prepared aircraft and local texture decoders in ${fileURLToPath(new URL('public/', root))}`)
