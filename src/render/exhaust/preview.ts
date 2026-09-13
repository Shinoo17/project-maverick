// Developer visual fixture: uses the actual flight model, normalization and volume.
import { ACESFilmicToneMapping, Box3, Color, DirectionalLight, Group, HemisphereLight, Mesh, PerspectiveCamera, Scene, SRGBColorSpace, Texture, Vector3, WebGLRenderer } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { getAircraft, modelUrl } from '../../content/aircraft'
import type { AircraftId } from '../../content/schemas'
import { prepareAnimations } from '../aircraft/animationStages'
import { CondensationVolume } from '../vapor/CondensationVolume'
import { createFlightRig } from '../aircraft/flightRig'
import { GameRuntime } from '../../game/runtime/GameRuntime'
import { stepThrustVectoring } from '../../game/flight/thrustVectoring'
import { FLIGHT_STEP } from '../../game/runtime/clock'
import { flightProfile } from '../../game/flight/profile'
import { flightExhaustConditions } from './profile'

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
controls.target.set(0, .4, 0); controls.minDistance = 2; controls.maxDistance = 70; controls.enableDamping = true
const jet = new Group(); scene.add(jet)
const volume = new CondensationVolume(renderer)
const params = new URLSearchParams(location.search)
const scenario = params.get('scenario')
let paused = false, modelReady = false, aircraft: AircraftId = params.get('aircraft') === 'su57' ? 'su57' : 'f22', loadId = 0
let power = Number(params.get('power') ?? 1), burner = params.get('burner') !== 'off', vector = Number(params.get('pitch') ?? 0), clouds = false, dark = false
let actuatorTime = 0
let updateRig: ReturnType<typeof createFlightRig> | undefined
let state = new GameRuntime({ mode: 'playground', mapId: 'flat-range', aircraftIds: ['f22'] }).snapshot().aircraft[0]
element<HTMLSelectElement>('aircraft').value = aircraft
element<HTMLInputElement>('power').value = String(power)
element<HTMLInputElement>('vector').value = String(vector)
element('vectorValue').textContent = `${vector}°`
element('powerValue').textContent = `${Math.round(power * 100)}%`
element('burner').textContent = `Afterburner: ${burner ? 'ON' : 'OFF'}`
element('burner').setAttribute('aria-pressed', String(burner))
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
    modelReady = true; actuatorTime = 0; volume.reset(); updateRig = createFlightRig(root)
    state = new GameRuntime({ mode: 'playground', mapId: 'flat-range', aircraftIds: [aircraft] }).snapshot().aircraft[0]
    element('error').textContent = ''; document.querySelector('h1')!.textContent = `${definition.designation} / Exhaust`
  } catch (error) { element('error').textContent = String(error) }
}
const views = { quarter: [-19, 3.2, 12], rear: [-17, -.45, 0], side: [-9, 1.2, 19], front: [22, 3, 12] } as const
function view(id: keyof typeof views) { camera.position.fromArray(views[id]); controls.target.set(-6.5, -.45, 0); controls.update() }
for (const id of Object.keys(views) as (keyof typeof views)[]) element(id).onclick = () => view(id)
view('quarter')
element('power').oninput = () => { power = Number(element<HTMLInputElement>('power').value); element('powerValue').textContent = `${Math.round(power * 100)}%` }
element('vector').oninput = () => { vector = Number(element<HTMLInputElement>('vector').value); element('vectorValue').textContent = `${vector}°` }
element('burner').onclick = () => { burner = !burner; element('burner').textContent = `Afterburner: ${burner ? 'ON' : 'OFF'}`; element('burner').setAttribute('aria-pressed', String(burner)) }
element('pause').onclick = () => { paused = !paused; element('pause').textContent = paused ? 'ให้ไอพ่นไหลต่อ' : 'หยุดการไหล'; element('pause').setAttribute('aria-pressed', String(paused)) }
element('cloud').onclick = () => { clouds = !clouds; element('cloud').textContent = `Condensation: ${clouds ? 'ON' : 'OFF'}`; element('cloud').setAttribute('aria-pressed', String(clouds)) }
element('background').onclick = () => { dark = !dark; scene.background = new Color(dark ? '#131e29' : '#527da0'); element('background').textContent = `พื้นหลัง: ${dark ? 'มืด' : 'สว่าง'}` }
element('aircraft').onchange = () => { aircraft = element<HTMLSelectElement>('aircraft').value as AircraftId; void loadModel() }
function resize() { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix() }
addEventListener('resize', resize); resize(); void loadModel()
let previous = performance.now(), frames = 0, duration = 0
function frame(now: number) {
  requestAnimationFrame(frame)
  const rawDelta = (now - previous) / 1000; previous = now
  if (document.hidden) return
  const dt = paused ? 0 : Math.min(.05, rawDelta)
  controls.update(); camera.updateMatrixWorld()
  state.enginePower = power; state.maneuver.burnerActive = burner
  state.maneuver.phase = vector ? 'recovery' : 'normal'; state.rates.pitch = -vector / 14 * flightProfile.pitchRate
  if (aircraft === 'su57') {
    state.velocity = { x: scenario === 'slow' || scenario === 'cobra' || scenario === 'recovery' ? 55 : 180, y: scenario === 'recovery' ? -80 : 0, z: 0 }
    state.maneuver.alpha = scenario === 'cobra' ? 100 : scenario === 'recovery' ? 60 : 0
    state.maneuver.phase = scenario === 'cobra' ? 'active' : scenario === 'recovery' ? 'recovery' : 'normal'
    state.rates.pitch = (scenario === 'pitch-up' || scenario === 'slow' || scenario === 'cobra' ? 1 : scenario === 'pitch-down' ? -1 : vector / 14) * flightProfile.pitchRate
    state.rates.roll = scenario === 'roll' ? flightProfile.rollRate : 0
    state.rates.yaw = scenario === 'yaw' ? flightProfile.yawRate : 0
  } else {
    const pitch = scenario === 'pitch-up' || scenario === 'slow' || scenario === 'cobra' ? 1 : scenario === 'pitch-down' ? -1 : vector / 20
    const roll = scenario === 'roll' ? 1 : Number(params.get('roll') ?? 0)
    const speed = Number(params.get('speed') ?? (scenario === 'slow' || scenario === 'cobra' ? 45 : 220))
    const aoa = Number(params.get('aoa') ?? (scenario === 'cobra' ? 90 : 0))
    state.maneuver.phase = scenario === 'cobra' ? 'active' : scenario === 'recovery' ? 'recovery' : 'normal'
    state.rates.pitch = pitch * flightProfile.pitchRate; state.rates.roll = roll * flightProfile.rollRate
    state.rates.yaw = scenario === 'yaw' ? flightProfile.yawRate : 0
    // The fixture holds airspeed/AoA while exercising the same fixed-step
    // actuator simulation as flight; rendering never computes a second angle.
    actuatorTime += dt
    while (actuatorTime >= FLIGHT_STEP) {
      stepThrustVectoring(state, { pitch, roll }, FLIGHT_STEP, speed, aoa)
      actuatorTime -= FLIGHT_STEP
    }
  }
  updateRig?.(state, dt); jet.updateMatrixWorld(true)
  volume.update({ speed: 180, aoa: clouds ? 21 : 3, g: clouds ? 6.8 : 1, sideslip: 0, humidity: .78 }, dt, false, aircraft)
  volume.updateExhaust({ ...flightExhaustConditions(state), nozzles: updateRig?.exhaust }, dt)
  if (modelReady) volume.render(renderer, scene, camera, jet.matrixWorld)
  else renderer.render(scene, camera)
  frames++; duration += rawDelta
  if (duration > 1 && modelReady) { element('status').textContent = `${Math.round(frames / duration)} FPS · ${paused ? 'หยุดการไหล' : 'ไอพ่นไหลต่อเนื่อง'}${aircraft === 'f22' ? ` · L ${state.thrustVectoring.left.toFixed(1)}° / R ${state.thrustVectoring.right.toFixed(1)}°` : ''}`; frames = 0; duration = 0 }
}
requestAnimationFrame(frame)
addEventListener('pagehide', event => { if (event.persisted) return; volume.dispose(); controls.dispose(); ktx2.dispose(); disposeModel(jet); renderer.dispose() }, { once: true })
