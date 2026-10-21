/*
Turns what the simulation reports into combat effects (effects.ts) and falling wrecks
(wreck.ts). A view only: it reads the hits and events the scene drains each frame and the
latest world snapshot, and changes nothing in the simulation.

- Gun hits on an aircraft spark on it, moved onto the model as drawn (it is drawn larger with
  distance, targetVisibility.ts); hits on the ground kick up dust. At most
  MAX_HITS_PER_FRAME are shown per frame: the gun fires ~100 rounds a second.
- An aircraft without a pilot (the target drone) shot down explodes where it died and its
  wreck falls, trailing fire and smoke, until it hits the ground and explodes again. It
  crashing into terrain itself explodes on the ground. The player's own death has no effect
  yet.
- Up to WRECK_SLOTS wrecks fall at once. Another death then blows up the oldest in the air.

Everything is timed by the simulation clock passed in, so pause freezes it, and reset() clears
it when the flight is reset.
*/
import { Group, Vector3, type PerspectiveCamera } from 'three'
import type { ProjectileHit } from '../../game/combat/projectiles'
import { GROUND_Y } from '../../game/combat/projectiles'
import type { GameEvent } from '../../game/runtime/events'
import type { WorldState } from '../../game/state/WorldState'
import { distanceScale } from '../targetVisibility'
import { loadParticleAtlas } from './atlas'
import { airExplosion, createTrail, groundExplosion, groundHit, hitSpark, randomStream, type EffectLayers } from './effects'
import { createParticleLayer } from './particles'
import { advanceWreck, createWreck, type Wreck } from './wreck'

export const WRECK_SLOTS = 2
const MAX_HITS_PER_FRAME = 6
/** Metres a hit effect is drawn toward the camera from the hit point. */
const HIT_LIFT = 2.5
/** Metres behind the wreck's centre that its fire and smoke stream from. */
const TAIL = 7

export interface EffectsFrame {
  /** Simulation seconds now, between ticks. */
  clock: number
  events: readonly GameEvent[]
  hits: readonly ProjectileHit[]
  world: WorldState | null
  camera: PerspectiveCamera
  /** CSS pixels. */
  viewportHeight: number
  /** One model per wreck slot, hidden while the slot is empty. */
  wreckModels: readonly (Group | null)[]
}

export function createCombatEffects() {
  const layers: EffectLayers = {
    smoke: createParticleLayer({ capacity: 700, additive: false, order: 5 }),
    glow: createParticleLayer({ capacity: 400, additive: true, order: 6 }),
  }
  // Smoke first, then the glow over it.
  const mesh = new Group().add(layers.smoke.mesh, layers.glow.mesh)
  const random = randomStream(7)
  const slots: ({ wreck: Wreck; trail: ReturnType<typeof createTrail>; started: number } | null)[] = Array(WRECK_SLOTS).fill(null)
  let lastClock: number | null = null, deaths = 0, disposed = false
  const atlas = loadParticleAtlas()
  atlas.then(texture => {
    if (disposed) { texture.dispose(); return }
    layers.glow.setAtlas(texture); layers.smoke.setAtlas(texture)
  }).catch(error => console.warn(error))

  const eye = new Vector3(), at = new Vector3(), nose = new Vector3(), centre = new Vector3()
  const scaleAt = (point: { x: number; y: number; z: number }) => distanceScale(eye.distanceTo(at.set(point.x, point.y, point.z)))

  function startWreck(entity: WorldState['aircraft'][number], clock: number) {
    let index = slots.findIndex(slot => slot === null)
    if (index < 0) {
      // All slots falling: the oldest blows up where it is.
      index = slots.reduce((oldest, slot, i) => slot!.started < slots[oldest]!.started ? i : oldest, 0)
      const old = slots[index]!.wreck
      airExplosion(layers, clock, old.position, old.velocity, random, scaleAt(old.position))
    }
    slots[index] = { wreck: createWreck(entity, clock, deaths++), trail: createTrail(), started: clock }
  }

  function update(frame: EffectsFrame) {
    const { clock, world } = frame
    eye.copy(frame.camera.position)
    let shown = 0
    for (const record of frame.hits) {
      if (shown >= MAX_HITS_PER_FRAME) break
      const { hit } = record
      if (hit.kind === 'aircraft') {
        const target = world?.aircraft.find(entity => entity.id === hit.entityId)
        // The hit point is on the true-size hitbox; the model is drawn larger with distance, so the
        // point is scaled out from the target's centre onto the drawn skin, then pulled a little toward the eye.
        at.set(hit.point.x, hit.point.y, hit.point.z)
        if (target) {
          centre.set(target.position.x, target.position.y, target.position.z)
          at.sub(centre).multiplyScalar(distanceScale(eye.distanceTo(centre))).add(centre)
        }
        at.addScaledVector(nose.copy(eye).sub(at).normalize(), HIT_LIFT)
        hitSpark(layers, clock, { x: at.x, y: at.y, z: at.z }, target?.velocity ?? { x: 0, y: 0, z: 0 }, random)
      } else groundHit(layers, clock, hit.point, random)
      shown++
    }
    for (const event of frame.events) {
      if (event.type !== 'aircraft-destroyed') continue
      const entity = world?.aircraft.find(candidate => candidate.id === event.entityId)
      if (!entity || entity.control === 'pilot') continue
      if (event.cause === 'weapon') {
        airExplosion(layers, clock, entity.position, entity.velocity, random, scaleAt(entity.position))
        startWreck(entity, clock)
      } else if (event.cause === 'terrain') groundExplosion(layers, clock, { ...entity.position, y: GROUND_Y + 2 }, random)
    }
    const dt = lastClock === null ? 0 : Math.max(0, clock - lastClock)
    lastClock = clock
    slots.forEach((slot, index) => {
      const model = frame.wreckModels[index]
      if (!slot) { if (model) model.visible = false; return }
      const { wreck } = slot
      if (advanceWreck(wreck, clock)) {
        groundExplosion(layers, clock, { x: wreck.position.x, y: GROUND_Y + 2, z: wreck.position.z }, random)
        slots[index] = null
        if (model) model.visible = false
        return
      }
      // Drawn ahead of its last fixed step by the time since, so it moves smoothly between steps.
      const ahead = clock - wreck.time
      at.copy(wreck.position).addScaledVector(wreck.velocity, ahead)
      nose.set(1, 0, 0).applyQuaternion(wreck.orientation)
      slot.trail.emit(layers, clock, dt, { x: at.x - nose.x * TAIL, y: at.y - nose.y * TAIL, z: at.z - nose.z * TAIL }, wreck.velocity, random)
      if (model) {
        model.visible = true
        model.position.copy(at); model.quaternion.copy(wreck.orientation)
        model.scale.setScalar(distanceScale(eye.distanceTo(at)))
      }
    })
    layers.smoke.update(clock, frame.camera, frame.viewportHeight)
    layers.glow.update(clock, frame.camera, frame.viewportHeight)
  }

  function reset() {
    layers.smoke.clear(); layers.glow.clear()
    slots.fill(null)
    lastClock = null
  }
  function dispose() {
    disposed = true
    layers.smoke.dispose(); layers.glow.dispose()
    atlas.then(texture => texture.dispose()).catch(() => {})
  }
  return { mesh, update, reset, dispose }
}
