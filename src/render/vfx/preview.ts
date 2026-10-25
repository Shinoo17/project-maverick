/*
vfx-preview.html: the combat effects on their own, over the training range's sky and haze.
A target flies past at 400 m and 150 m/s; the buttons fire hits on it, blow it up in the air,
or shoot it down so its wreck falls and explodes on the ground. Loop replays the shoot-down.
The sprite button swaps the sprite sets (atlas.ts) under the running effects; ?sprites=
picks the first.
Drives the same createCombatEffects as the flight scene, with made-up hits and events.
?scene=missile bursts a missile warhead beside the target every 3 s instead (with ?at, the moment
that many seconds after the first burst), while an AIM-9 under motor flies across in front of it
every 2.6 s, its plume seen side on.
*/
import { BoxGeometry, Color, FogExp2, Group, Mesh, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Scene, SRGBColorSpace, HemisphereLight, DirectionalLight, ACESFilmicToneMapping, WebGLRenderer } from 'three'
import type { ProjectileHit } from '../../game/combat/projectiles'
import type { GameEvent } from '../../game/runtime/events'
import type { WorldState } from '../../game/state/WorldState'
import { SPRITE_SETS, type SpriteSet } from './atlas'
import { createCombatEffects, WRECK_SLOTS } from './combatEffects'
import { distanceScale } from '../targetVisibility'
import { WORLD_STEP } from '../../game/runtime/clock'

const HAZE = '#c4d4de', FOG_DENSITY = 0.00016
const renderer = new WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.outputColorSpace = SRGBColorSpace; renderer.toneMapping = ACESFilmicToneMapping
document.getElementById('view')!.append(renderer.domElement)
const scene = new Scene()
scene.background = new Color(HAZE); scene.fog = new FogExp2(HAZE, FOG_DENSITY)
scene.add(new HemisphereLight('#dbe9ee', '#4a5a3a', 2), new DirectionalLight('#fff2d8', 2.5))
const ground = new Mesh(new PlaneGeometry(40000, 40000), new MeshStandardMaterial({ color: '#7d8a62', roughness: 1 }))
ground.rotation.x = -Math.PI / 2; scene.add(ground)
const camera = new PerspectiveCamera(56, 1, 0.5, 14000)

const params = new URLSearchParams(location.search)
const effects = createCombatEffects({ sprites: SPRITE_SETS.includes(params.get('sprites') as SpriteSet) ? params.get('sprites') as SpriteSet : 'smoke' })
scene.add(effects.mesh)
const target = new Mesh(new BoxGeometry(20, 3, 13), new MeshStandardMaterial({ color: '#ff7a2e', emissive: '#ff7a2e', emissiveIntensity: 0.35 }))
scene.add(target)
const wreckModels = Array.from({ length: WRECK_SLOTS }, () => {
  const group = new Group().add(new Mesh(new BoxGeometry(20, 3, 13), new MeshStandardMaterial({ color: '#2a2420', roughness: 1 })))
  group.visible = false; scene.add(group); return group
})

let clock = 0, paused = false, loop = true, alive = true, nextLoop = 0.5, eventId = 0
const SPEED = 150, START_X = -170
const pathX = () => START_X + ((clock * SPEED) % 1200)
const drone = () => ({ id: 'drone-1', control: 'path', alive, position: { x: pathX(), y: 400, z: 0 }, velocity: { x: SPEED, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } })
// Timed on the preview's own clock, so pause and ?at= replay it exactly.
let firingUntil = -1, destroyAt = -1, reviveAt = -1, nextBurst = 0.5
function fire(seconds: number, thenDestroy: boolean) { firingUntil = clock + seconds; if (thenDestroy) destroyAt = clock + seconds }
document.getElementById('hits')!.onclick = () => fire(1, false)
document.getElementById('burst')!.onclick = () => fire(0.2, true)
document.getElementById('down')!.onclick = () => fire(0.6, true)
const loopButton = document.getElementById('loop')!
loopButton.onclick = () => { loop = !loop; loopButton.setAttribute('aria-pressed', String(loop)) }
const pauseButton = document.getElementById('pause')!
pauseButton.onclick = () => { paused = !paused; pauseButton.setAttribute('aria-pressed', String(paused)) }
const distance = document.getElementById('distance') as HTMLInputElement, distanceValue = document.getElementById('distanceValue')!
const spritesButton = document.getElementById('sprites')!
const SPRITE_LABEL: Record<SpriteSet, string> = { classic: 'Sprite: ชุดเดิม (Particle Pack)', smoke: 'Sprite: ชุดใหม่ (Smoke Particles)' }
spritesButton.textContent = SPRITE_LABEL[effects.sprites]
spritesButton.onclick = () => {
  effects.useSprites(effects.sprites === 'smoke' ? 'classic' : 'smoke')
  spritesButton.textContent = SPRITE_LABEL[effects.sprites]
}
if (params.has('distance')) distance.value = params.get('distance')!

/** The ?scene=missile AIM-9: across the view in front of the target, slowly enough (250 m/s) to stay
 * in frame for its whole 2.2 s burn, a new one every 2.6 s. */
function crossing() {
  const loop = Math.floor(clock / 2.6), age = clock - loop * 2.6
  return { id: 100 + loop, weaponId: 'aim9', mount: 'pylon', age, position: { x: -350 + age * 250, y: 410, z: 60 }, velocity: { x: 250, y: 0, z: 0 } }
}

/** One step of the made-up world: hits while firing, the kill, the respawn. */
function step(dt: number) {
  clock += dt
  if (loop && clock >= nextLoop) { nextLoop = clock + 12; fire(0.6, true) }
  const events: GameEvent[] = [], hits: ProjectileHit[] = []
  if (params.get('scene') === 'missile') {
    if (clock >= nextBurst) {
      nextBurst += 3
      const at = drone().position
      events.push({ id: `e${eventId++}`, tick: 0, type: 'missile-detonated', missileId: eventId, ownerId: 'aircraft-1', weaponId: 'aim9', position: { x: at.x - 12, y: at.y + 4, z: 8 }, cause: 'proximity', targetId: null })
    }
    return { events, hits }
  }
  if (alive && clock < firingUntil) {
    // About two rounds arrive a frame while firing, on the box's side facing the camera (where a hitbox surface would be).
    for (let index = 0; index < 2; index++) {
      const at = drone().position
      hits.push({ tick: 0, projectileId: eventId++, ownerId: 'aircraft-1', weaponId: 'gun', hit: { kind: 'aircraft', entityId: 'drone-1', t: 0, point: { x: at.x + (Math.random() - 0.5) * 16, y: at.y + (Math.random() - 0.5) * 2, z: 6.5 } } })
    }
  }
  if (alive && destroyAt >= 0 && clock >= destroyAt) {
    events.push({ id: `e${eventId++}`, tick: 0, type: 'aircraft-destroyed', entityId: 'drone-1', sourceId: 'aircraft-1', cause: 'weapon' })
    alive = false; destroyAt = -1; reviveAt = clock + 3
  }
  if (!alive && reviveAt >= 0 && clock >= reviveAt && events.length === 0) { alive = true; reviveAt = -1 }
  return { events, hits }
}

function draw(frame: { events: GameEvent[]; hits: ProjectileHit[] }) {
  const metres = Number(distance.value); distanceValue.textContent = `${metres} m`
  const lookX = Number(params.get('lookX') ?? 0)
  camera.position.set(lookX - metres * 0.35, 430, metres)
  camera.lookAt(lookX, 330, 0)
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); camera.updateMatrixWorld()
  renderer.setSize(innerWidth, innerHeight, false)
  // The world as it stood when the frame's events happened: the kill reads the drone's pose.
  // Its tick is the clock's, so missiles are drawn where they are now.
  const world = { tick: clock / WORLD_STEP, aircraft: [{ ...drone(), alive: true }], missiles: params.get('scene') === 'missile' ? [crossing()] : [], decoys: [] } as unknown as WorldState
  target.visible = alive; target.position.set(pathX(), 400, 0)
  // Drawn larger with distance, like the drone in flight, so hits are checked against the drawn size.
  target.scale.setScalar(distanceScale(camera.position.distanceTo(target.position)))
  effects.update({ clock, events: frame.events, hits: frame.hits, world, camera, viewportHeight: innerHeight, wreckModels })
  renderer.render(scene, camera)
}

// ?at=seconds renders that moment once (for checks in a background tab, where animation frames stop).
const at = params.get('at')
if (at !== null) {
  loop = params.get('scene') !== 'hits'
  if (!loop) fire(Number(at) + 1, false)
  let merged = { events: [] as GameEvent[], hits: [] as ProjectileHit[] }
  while (clock < Number(at)) {
    const next = step(1 / 60)
    merged = next
    draw(merged)
  }
  // Wait for the atlas, then draw the moment again.
  setTimeout(() => draw({ events: [], hits: [] }), 800)
} else {
  let last = performance.now()
  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000); last = now
    draw(paused ? { events: [], hits: [] } : step(dt))
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}
