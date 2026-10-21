// Developer visual fixture: uses the actual flight model, normalization and volume.
import { ACESFilmicToneMapping, Box3, Color, DirectionalLight, Group, HemisphereLight, Mesh, PerspectiveCamera, Scene, SRGBColorSpace, Texture, Vector3, WebGLRenderer } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { aircraft as roster, getAircraft, modelUrl } from '../../content/aircraft'
import type { AircraftId } from '../../content/schemas'
import { prepareAnimations } from '../aircraft/animationStages'
import { CondensationVolume } from './CondensationVolume'
import { vaporConditions, type VaporSettings } from './conditions'
import { arcadeSpeed } from '../../game/flight/speedLimits'
import { getVaporProfile } from './profile'
import { vaporCooling, vaporTargets, vortexIncidence } from './vaporModel'

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const renderer = new WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.outputColorSpace = SRGBColorSpace
renderer.toneMapping = ACESFilmicToneMapping
renderer.debug.onShaderError = (_gl, _program, vertex, fragment) => {
  element('error').textContent = `Shader error: ${_gl.getShaderInfoLog(vertex)} ${_gl.getShaderInfoLog(fragment)}`
}
element('view').appendChild(renderer.domElement)
const scene = new Scene(); scene.background = new Color('#527da0')
scene.add(new HemisphereLight('#edf5ff', '#707958', 2))
const sun = new DirectionalLight('#ffffff', 3); sun.position.set(100, 600, 300); scene.add(sun)
const camera = new PerspectiveCamera(38, 1, .2, 300)
const controls = new OrbitControls(camera, renderer.domElement)
controls.target.set(0, .4, 0); controls.minDistance = 13; controls.maxDistance = 70; controls.enableDamping = true
const jet = new Group(); scene.add(jet)
const volume = new CondensationVolume(renderer)
// Flight plus the air it flies in. Altitude feeds temperature, humidity and Mach.
const values = { speed: 130, aoa: 14, g: 6, sideslip: 0, temperatureC: 26, humidity: .82, altitude: 400 }
type Slider = 'speed' | 'aoa' | 'g' | 'temperatureC' | 'humidity' | 'altitude'
const sliders: readonly Slider[] = ['speed', 'aoa', 'g', 'temperatureC', 'humidity', 'altitude']
const conditions = () => vaporConditions(values, values.altitude, values)
let paused = false, modelReady = false, aircraft: AircraftId = roster[0].id, loadId = 0
element<HTMLSelectElement>('aircraft').replaceChildren(...roster.map(entry => new Option(entry.designation, entry.id)))
const ktx2 = new KTX2Loader().setTranscoderPath('/basis/').detectSupport(renderer)
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(ktx2)
function disposeModel(root: Group) { root.traverse(object => { if (object instanceof Mesh) { object.geometry.dispose(); const materials = Array.isArray(object.material) ? object.material : [object.material]; materials.forEach(m => { for (const value of Object.values(m)) if (value instanceof Texture) value.dispose(); m.dispose() }); if ('skeleton' in object) (object.skeleton as { dispose(): void }).dispose() } }) }
async function loadModel() {
  const id = ++loadId; modelReady = false; element('status').textContent = 'กำลังโหลดโมเดล…'
  try {
    const definition = getAircraft(aircraft), asset = await loader.loadAsync(modelUrl(definition))
    if (id !== loadId) { disposeModel(asset.scene); return }
    for (const child of [...jet.children]) { jet.remove(child); disposeModel(child as Group) }
    for (const name of definition.removeNodes) asset.scene.getObjectByName(name)?.removeFromParent()
    prepareAnimations(asset.scene, asset.animations)
    const orientation = new Group(); orientation.rotation.set(...definition.rotation); orientation.add(asset.scene)
    const bounds = new Box3().setFromObject(orientation), size = bounds.getSize(new Vector3())
    orientation.position.copy(bounds.getCenter(new Vector3())).negate()
    const root = new Group(); root.add(orientation); root.scale.setScalar(18.9 / Math.max(size.x, size.y, size.z)); jet.add(root)
    modelReady = true; volume.reset()
    element('error').textContent = ''; document.querySelector('h1')!.textContent = `${definition.designation} / Condensation`
  } catch (error) { element('error').textContent = String(error) }
}
function resetView() { camera.position.set(24, 17, 26); controls.target.set(-.5, .4, 0); controls.update() }
function referenceView() { camera.position.set(2, 6, -52); controls.target.set(-13, 1, 0); controls.update() }
referenceView()
const sliderText: Record<Slider, (value: number) => string> = {
  speed: value => `${Math.round(arcadeSpeed(value))} km/h`, aoa: value => `${value.toFixed(1)}°`, g: value => `${value.toFixed(1)} G`,
  temperatureC: value => `${value.toFixed(0)} °C`, humidity: value => `${Math.round(value * 100)}%`, altitude: value => `${Math.round(value)} m`,
}
// The physics readout: D against each effect's ΔT, then the target intensity.
function readout() {
  const c = conditions(), rig = getVaporProfile(aircraft).rig, cooling = vaporCooling(c, rig, c), target = vaporTargets(c, rig, c)
  const row = (name: string, key: 'lex' | 'fog' | 'tip' | 'cone') => `${name.padEnd(5)} ΔT ${cooling[key].toFixed(1).padStart(5)} K → ${target[key].toFixed(2)}`
  element('model').textContent = [
    `M ${c.mach.toFixed(2)} · T ${c.temperatureC.toFixed(1)} °C`,
    `vortex α ${vortexIncidence(c, rig).toFixed(1)}° (lift + AoA)`,
    `D ${c.depression.toFixed(1)} K · W ${c.water.toFixed(2)}`,
    row('LEX', 'lex'), row('Fog', 'fog'), row('Tip', 'tip'), row('Cone', 'cone'),
    `burst ${target.burst.toFixed(2)} · shock ${target.shock.toFixed(2)}`,
  ].join('\n')
}
function refresh() {
  for (const key of sliders) {
    element<HTMLInputElement>(key).value = String(values[key])
    element(`${key}Value`).textContent = sliderText[key](values[key])
  }
  readout()
  for (const key of Object.keys(volume.settings) as (keyof VaporSettings)[]) element(`${key}Value`).textContent = volume.settings[key].toFixed(2) + (key === 'fade' ? ' s' : '')
}
for (const key of sliders) element(key).oninput = () => { values[key] = Number(element<HTMLInputElement>(key).value); refresh() }
for (const key of Object.keys(volume.settings) as (keyof VaporSettings)[]) element(key).oninput = () => { volume.settings[key] = Number(element<HTMLInputElement>(key).value); refresh() }
// Plan §8 test scenarios. Speeds are simulation m/s; the label shows HUD km/h.
const sea = { temperatureC: 26, humidity: .82, altitude: 400 }
const scenarios: Record<string, Partial<typeof values>> = {
  cruise: { ...sea, speed: 180, aoa: 3, g: 1 },
  highG: { ...sea, speed: 130, aoa: 14, g: 6 },
  alpha: { ...sea, speed: 60, aoa: 62, g: 2.5 },
  transonic: { ...sea, speed: 220, aoa: 2, g: 1 },
  supersonic: { ...sea, speed: 266, aoa: 2, g: 1 },
  high: { temperatureC: 26, humidity: .82, altitude: 10000, speed: 130, aoa: 14, g: 6 },
  desert: { temperatureC: 38, humidity: .15, altitude: 400, speed: 130, aoa: 14, g: 6 },
}
for (const [id, preset] of Object.entries(scenarios)) element(id).onclick = () => { Object.assign(values, preset); refresh() }
element('pause').onclick = () => { paused = !paused; element('pause').textContent = paused ? 'ให้เมฆไหลต่อ' : 'หยุดการไหล'; element('pause').setAttribute('aria-pressed', String(paused)) }
element('viewReset').onclick = resetView
element('reference').onclick = referenceView
for (const [id, point] of Object.entries({ top: [2, 33, 0], underside: [18, -19, 25], rear: [-29, -.35, 0] })) element(id).onclick = () => { camera.position.set(...point as [number, number, number]); controls.target.set(-.5, .4, 0); controls.update() }
element('aircraft').onchange = () => { aircraft = element<HTMLSelectElement>('aircraft').value as AircraftId; readout(); void loadModel() }
function resize() { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix() }
addEventListener('resize', resize); resize(); refresh(); void loadModel()
let previous = performance.now(), frames = 0, duration = 0
function frame(now: number) {
  requestAnimationFrame(frame)
  const rawDelta = (now - previous) / 1000; previous = now
  if (document.hidden) return
  const dt = Math.min(.05, rawDelta)
  controls.update(); camera.updateMatrixWorld()
  // Hold the photographed attitude so incidence can be compared in one view.
  jet.updateMatrixWorld(true)
  volume.update(conditions(), dt, false, aircraft, paused)
  if (modelReady) volume.render(renderer, scene, camera, jet.matrixWorld)
  else renderer.render(scene, camera)
  frames++; duration += rawDelta
  if (duration > 1 && modelReady) { element('status').textContent = `${Math.round(frames / duration)} FPS · ${paused ? 'หยุดการไหล' : 'ไอน้ำไหลตามลมสัมพัทธ์'}`; frames = 0; duration = 0 }
}
requestAnimationFrame(frame)
addEventListener('pagehide', event => { if (event.persisted) return; volume.dispose(); controls.dispose(); ktx2.dispose(); disposeModel(jet); renderer.dispose() }, { once: true })
