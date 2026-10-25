/*
The combat effects, each a recipe of particles (particles.ts) in layers, like a film explosion:
a short flash, a fireball, sparks thrown out, then smoke that lingers. Sizes are metres at the
aircraft's scale (an airframe is ~20 m), so an air burst reads from a kilometre away.

- hitSpark: a round striking an airframe. A small flash, a few sparks and a puff of smoke,
  all carried along with the target so they stay on it at 150 m/s.
- groundHit: a round striking the ground: a dust puff.
- airExplosion: an aircraft destroyed in the air. Flash, shock ring, fireball, sparks, smoke.
- groundExplosion: a wreck hitting the ground. Bigger, with a dust ring and a smoke column.
- wreckTrail: the fire and smoke a falling wreck trails, emitted at a rate per simulation
  second.
- flareTrail / chaffBloom: a burning flare's orange ball and white smoke, and a chaff bundle bursting.

Particle colours are linear. Every value here is a look, not physics, and provisional.
*/
import { Vector3 } from 'three'
import { Sprite } from './atlas'
import { tint, type ParticleLayer, type ParticleSpec } from './particles'

type Vec3Like = { x: number; y: number; z: number }
export interface EffectLayers { glow: ParticleLayer; smoke: ParticleLayer }

const WHITE = tint(1, 1, 1), HOT = tint(1, 0.85, 0.5), SPARK = tint(1, 0.55, 0.12), EMBER = tint(0.9, 0.18, 0.02)
const YELLOW = tint(1, 0.72, 0.18), FLAME_CORE = tint(1, 0.86, 0.45)
const FIRE = tint(1, 0.42, 0.06), FIRE_DEEP = tint(0.75, 0.16, 0.02), CHAR = tint(0.09, 0.08, 0.07)
const SMOKE = tint(0.13, 0.12, 0.11), SMOKE_FADED = tint(0.32, 0.31, 0.3)
const LIGHT_SMOKE = tint(0.42, 0.41, 0.4), LIGHT_SMOKE_FADED = tint(0.62, 0.62, 0.62)
// A missile motor's exhaust: near white, so it shows against haze and sand alike.
const EXHAUST = tint(0.97, 0.97, 0.96), EXHAUST_FADED = tint(0.8, 0.8, 0.8)
// A flare's burning ball: deep orange, like magnesium seen through its own smoke.
const FLARE = tint(1, 0.5, 0.12), FLARE_DEEP = tint(1, 0.36, 0.06)
const DUST = tint(0.36, 0.3, 0.22), DUST_FADED = tint(0.55, 0.5, 0.42)

/** A seeded random stream, so an effect is the same each time it is replayed in a preview. */
export function randomStream(seed: number) {
  let state = (seed * 2654435761) >>> 0 || 1
  const next = () => { state ^= state << 13; state >>>= 0; state ^= state >>> 17; state ^= state << 5; state >>>= 0; return state / 4294967296 }
  const between = (from: number, to: number) => from + (to - from) * next()
  /** A random direction, scaled by a speed between `from` and `to`. */
  const scatter = (from: number, to: number) => {
    const z = between(-1, 1), angle = between(0, Math.PI * 2), r = Math.sqrt(1 - z * z), speed = between(from, to)
    return new Vector3(r * Math.cos(angle) * speed, z * speed, r * Math.sin(angle) * speed)
  }
  return { next, between, scatter }
}
type Random = ReturnType<typeof randomStream>

const add = (a: Vec3Like, b: Vec3Like, share = 1) => ({ x: a.x + b.x * share, y: a.y + b.y * share, z: a.z + b.z * share })

export function hitSpark(layers: EffectLayers, now: number, point: Vec3Like, carry: Vec3Like, random: Random) {
  layers.glow.spawn({ sprite: Sprite.flash, position: point, velocity: carry, life: 0.12, size: [5, 2.5], color: [WHITE, HOT], alpha: 1, fadeIn: 0, rotation: random.between(0, Math.PI), minPx: 14 }, now)
  // An orange flick under the flash: additive light alone barely shows on a pale sky.
  layers.smoke.spawn({ sprite: Sprite.puff, position: point, velocity: carry, life: 0.14, size: [1.5, 3.5], color: [FIRE, FIRE_DEEP], alpha: 0.9, fadeIn: 0, rotation: random.between(0, 6.3), minPx: 6 }, now)
  for (let index = 0; index < 3; index++) {
    layers.glow.spawn({ sprite: Sprite.streak, position: point, velocity: add(carry, random.scatter(40, 90)), drag: 3, lift: -9.81,
      life: random.between(0.18, 0.32), size: [0.5, 0.35], color: [HOT, SPARK], alpha: 1, fadeIn: 0, stretch: 0.04, minPx: 3 }, now)
  }
  layers.smoke.spawn({ sprite: Sprite.smoke, position: point, velocity: add(random.scatter(1, 4), carry, 0.85), drag: 1.5,
    life: 0.7, size: [1.2, 4.5], color: [LIGHT_SMOKE, LIGHT_SMOKE_FADED], alpha: 0.45, rotation: random.between(0, 6.3), minPx: 3 }, now)
}

export function groundHit(layers: EffectLayers, now: number, point: Vec3Like, random: Random) {
  layers.smoke.spawn({ sprite: Sprite.smoke, position: point, velocity: { x: 0, y: random.between(3, 7), z: 0 }, drag: 2,
    life: random.between(0.8, 1.3), size: [1.5, 6], color: [DUST, DUST_FADED], alpha: 0.55, rotation: random.between(0, 6.3), minPx: 3 }, now)
}

/** `scale` grows the whole burst (1 = a fighter in the air). */
export function airExplosion(layers: EffectLayers, now: number, point: Vec3Like, carry: Vec3Like, random: Random, scale = 1) {
  const drift = (share: number) => ({ x: carry.x * share, y: carry.y * share, z: carry.z * share })
  // A yellow flash, not a white one (user request 2026-10-26: explosions read orange-yellow). In the
  // alpha layer: light added to the pale sky burns out to white, whatever its colour.
  layers.smoke.spawn({ sprite: Sprite.glow, position: point, velocity: drift(0.5), drag: 3, life: 0.22, size: [50 * scale, 34 * scale], color: [YELLOW, FIRE], alpha: 0.85, fadeIn: 0, minPx: 40 }, now)
  layers.glow.spawn({ sprite: Sprite.ring, position: point, velocity: drift(0.5), drag: 3, life: 0.35, size: [10 * scale, 90 * scale], color: [HOT, SPARK], alpha: 0.25, fadeIn: 0 }, now)
  // The hot core: brief, under the fireball; alpha-blended like the flash, so it stays yellow.
  for (let index = 0; index < 4; index++) {
    layers.smoke.spawn({ sprite: Sprite.fire, position: point, velocity: add(drift(0.5), random.scatter(5, 15)), drag: 3,
      life: random.between(0.3, 0.5), size: [16 * scale, 32 * scale], color: [HOT, FIRE], alpha: 0.9, fadeIn: 0, rotation: random.between(0, 6.3), minPx: 12 }, now)
  }
  // Fireball: alpha-blended orange cooling to char, so it reads over a pale sky.
  for (let index = 0; index < 12; index++) {
    layers.smoke.spawn({ sprite: Sprite.puff, position: point, velocity: add(drift(0.45), random.scatter(10, 30 * scale)), drag: 2.2, lift: 2,
      life: random.between(0.9, 1.4), size: [14 * scale, random.between(34, 46) * scale], color: [FIRE, CHAR], alpha: 0.95, fadeIn: 0.04,
      rotation: random.between(0, 6.3), spin: random.between(-0.6, 0.6), minPx: 6, delay: random.between(0, 0.08) }, now)
  }
  // Sparks and fragments thrown out, falling.
  for (let index = 0; index < 16; index++) {
    layers.glow.spawn({ sprite: Sprite.streak, position: point, velocity: add(drift(0.6), random.scatter(45, 110)), drag: 0.9, lift: -9.81,
      life: random.between(0.9, 1.7), size: [0.9, 0.6], color: [HOT, EMBER], alpha: 1, fadeIn: 0, stretch: 0.05, minPx: 2 }, now)
  }
  // Smoke left hanging where it happened.
  for (let index = 0; index < 10; index++) {
    layers.smoke.spawn({ sprite: Sprite.smoke, position: point, velocity: add(drift(0.25), random.scatter(4, 14 * scale)), drag: 1.1, lift: 1.5,
      life: random.between(4, 6), size: [16 * scale, random.between(50, 70) * scale], color: [SMOKE, SMOKE_FADED], alpha: 0.85, fadeIn: 0.08,
      rotation: random.between(0, 6.3), spin: random.between(-0.25, 0.25), minPx: 5, delay: random.between(0.1, 0.35) }, now)
  }
}

export function groundExplosion(layers: EffectLayers, now: number, point: Vec3Like, random: Random) {
  // Raised so the lower half of the burst is not lost under the ground.
  airExplosion(layers, now, add(point, { x: 0, y: 12, z: 0 }), { x: 0, y: 0, z: 0 }, random, 1.8)
  // Dust thrown out along the ground.
  for (let index = 0; index < 12; index++) {
    const angle = random.between(0, Math.PI * 2), speed = random.between(30, 55)
    layers.smoke.spawn({ sprite: Sprite.smoke, position: point, velocity: { x: Math.cos(angle) * speed, y: random.between(2, 8), z: Math.sin(angle) * speed }, drag: 1.4,
      life: random.between(2.5, 3.5), size: [10, 36], color: [DUST, DUST_FADED], alpha: 0.75, rotation: random.between(0, 6.3), minPx: 4 }, now)
  }
  // Fire on the ground, then a column of smoke rising out of it for several seconds.
  for (let index = 0; index < 8; index++) {
    layers.smoke.spawn({ sprite: Sprite.puff, position: add(point, random.scatter(0, 8)), velocity: { x: 0, y: random.between(5, 12), z: 0 }, drag: 1,
      life: random.between(1.6, 2.6), size: [10, 20], color: [FIRE, FIRE_DEEP], alpha: 0.9, rotation: random.between(0, 6.3), minPx: 4, delay: random.between(0.2, 2.5) }, now)
  }
  for (let index = 0; index < 22; index++) {
    layers.smoke.spawn({ sprite: Sprite.smoke, position: add(point, random.scatter(0, 6)), velocity: { x: random.between(-3, 3), y: random.between(18, 32), z: random.between(-3, 3) }, drag: 0.35, lift: 1,
      life: random.between(8, 11), size: [18, random.between(70, 100)], color: [SMOKE, SMOKE_FADED], alpha: 0.75, fadeIn: 0.08,
      rotation: random.between(0, 6.3), spin: random.between(-0.15, 0.15), minPx: 5, delay: index * 0.2 }, now)
  }
}

/** Trail emitters keep their own carry-over, so the rate holds at any frame rate. */
export function createTrail(rate = { smoke: 22, fire: 30 }) {
  let smokeDue = 0, fireDue = 0
  /** Emits the particles due over `dt` simulation seconds, along the wreck's path. */
  function emit(layers: EffectLayers, now: number, dt: number, tail: Vec3Like, velocity: Vec3Like, random: Random) {
    smokeDue += rate.smoke * dt; fireDue += rate.fire * dt
    const along = (share: number) => ({ x: tail.x - velocity.x * dt * share, y: tail.y - velocity.y * dt * share, z: tail.z - velocity.z * dt * share })
    for (; smokeDue >= 1; smokeDue--) {
      const spec: ParticleSpec = { sprite: Sprite.smoke, position: along(random.next()), velocity: add(random.scatter(1, 4), velocity, 0.08), drag: 1.5, lift: 1,
        life: random.between(3, 4.2), size: [5, random.between(20, 28)], color: [SMOKE, SMOKE_FADED], alpha: 0.85, fadeIn: 0.06,
        rotation: random.between(0, 6.3), spin: random.between(-0.4, 0.4), minPx: 3 }
      layers.smoke.spawn(spec, now)
    }
    for (; fireDue >= 1; fireDue--) {
      layers.smoke.spawn({ sprite: Sprite.puff, position: along(random.next()), velocity: add(random.scatter(1, 5), velocity, 0.55), drag: 2,
        life: random.between(0.25, 0.45), size: [5, 9], color: [FIRE, FIRE_DEEP], alpha: 0.95, fadeIn: 0, rotation: random.between(0, 6.3), minPx: 3 }, now)
    }
  }
  return { emit }
}

/** A missile's motor, only while it burns: a solid rocket's plume, then its smoke (user request
 * 2026-10-26: no white star). Seen from outside, the plume is a short tongue of fire, pale yellow
 * at the nozzle going deep yellow and orange toward its tip, about `TONGUE` metres long and moving
 * with the missile; past its tip the exhaust is white smoke that hangs in the air for 5–7 s, so the
 * trail still marks the missile's path after burnout (an AIM-9 burns 2.2 s). The flame is drawn in
 * the alpha layer, like the explosions: light added to the pale sky burns out to white. The flame
 * is emitted at a rate per simulation second, the smoke one puff every `spacing` metres flown, so
 * a fast missile's trail is as solid as a slow one's. `scale` is how much larger the missile is
 * drawn with distance (targetVisibility.ts): the plume grows with it, so it stays on the model. */
export function createMissileTrail(rate = { flame: 400, spacing: 3 }) {
  const TONGUE = 6
  let smokeDue = 0, flameDue = 0
  function emit(layers: EffectLayers, now: number, dt: number, tail: Vec3Like, velocity: Vec3Like, random: Random, scale = 1) {
    const speed = Math.hypot(velocity.x, velocity.y, velocity.z) || 1
    smokeDue += speed * dt / rate.spacing; flameDue += rate.flame * dt
    // A point `metres` behind the nozzle, and `share` of this frame's travel further back.
    const behind = (metres: number, share = 0) => {
      const back = metres / speed + dt * share
      return { x: tail.x - velocity.x * back, y: tail.y - velocity.y * back, z: tail.z - velocity.z * back }
    }
    for (; smokeDue >= 1; smokeDue--) {
      layers.smoke.spawn({ sprite: Sprite.smoke, position: behind(TONGUE * 0.7 * scale, random.next()), velocity: random.scatter(0.5, 2.5), drag: 1.2, lift: 0.6,
        life: random.between(5, 7), size: [3.5, random.between(14, 19)], color: [EXHAUST, EXHAUST_FADED], alpha: 0.85, fadeIn: 0.04,
        rotation: random.between(0, 6.3), spin: random.between(-0.5, 0.5), minPx: 2 }, now)
    }
    for (; flameDue >= 1; flameDue--) {
      // Bunched toward the nozzle, where the plume is widest and brightest; it narrows and reddens to the tip.
      const share = random.next() ** 1.6, metres = share * TONGUE * scale
      const width = (2.8 - 1.8 * share) * scale
      layers.smoke.spawn({ sprite: Sprite.glow, position: behind(metres), velocity, life: 0.05, size: [width, width * 0.8],
        color: share < 0.3 ? [FLAME_CORE, YELLOW] : [YELLOW, FIRE], alpha: 1 - 0.4 * share, fadeIn: 0, minPx: 7 - 4 * share }, now)
    }
  }
  return { emit }
}

/** A flare: a round orange ball of fire (a soft glow sprite, never a star) with a white-hot
 * core, trailing thick white smoke, emitted at a rate per simulation second like the missile
 * trail. `heat` (0–1, flareHeat) shrinks and dims the ball and thins the smoke as it burns out. */
export function createFlareTrail(rate = { smoke: 80, head: 60 }) {
  let smokeDue = 0, headDue = 0
  function emit(layers: EffectLayers, now: number, dt: number, point: Vec3Like, velocity: Vec3Like, heat: number, random: Random) {
    smokeDue += rate.smoke * dt * (0.25 + 0.75 * heat); headDue += rate.head * dt
    const along = (share: number) => ({ x: point.x - velocity.x * dt * share, y: point.y - velocity.y * dt * share, z: point.z - velocity.z * dt * share })
    for (; smokeDue >= 1; smokeDue--) {
      layers.smoke.spawn({ sprite: Sprite.smoke, position: along(random.next()), velocity: random.scatter(0.4, 1.8), drag: 1.2, lift: 0.5,
        life: random.between(3, 4), size: [2.2, random.between(8, 12)], color: [EXHAUST, EXHAUST_FADED], alpha: 0.85 * (0.35 + 0.65 * heat), fadeIn: 0.04,
        rotation: random.between(0, 6.3), spin: random.between(-0.4, 0.4), minPx: 2 }, now)
    }
    if (heat <= 0.02) { headDue = 0; return }
    for (; headDue >= 1; headDue--) {
      const at = along(random.next() * 0.2)
      // The orange ball in the alpha layer, so it shows on a pale sky; a smaller hot core added over it.
      layers.smoke.spawn({ sprite: Sprite.glow, position: at, velocity, life: 0.06, size: [0.8 + 2.4 * heat, 0.8 + 2.4 * heat], color: [FLARE, FLARE_DEEP],
        alpha: Math.min(1, 0.4 + heat), fadeIn: 0, minPx: 3 + 6 * heat }, now)
      layers.glow.spawn({ sprite: Sprite.glow, position: at, velocity, life: 0.06, size: [0.4 + 1.2 * heat, 0.4 + 1.2 * heat], color: [HOT, HOT],
        alpha: heat, fadeIn: 0, minPx: 2 + 3 * heat }, now)
    }
  }
  return { emit }
}

/** A chaff bundle bursting into a cloud: a scatter of faint silver specks over a thin grey haze. */
export function chaffBloom(layers: EffectLayers, now: number, point: Vec3Like, carry: Vec3Like, random: Random) {
  for (let index = 0; index < 10; index++) {
    layers.glow.spawn({ sprite: Sprite.glow, position: point, velocity: add(random.scatter(4, 14), carry, 0.3), drag: 3, lift: -1,
      life: random.between(0.4, 1.1), size: [0.4, 0.3], color: [LIGHT_SMOKE_FADED, LIGHT_SMOKE], alpha: 0.6, fadeIn: 0, minPx: 2, delay: random.between(0, 0.15) }, now)
  }
  for (let index = 0; index < 3; index++) {
    layers.smoke.spawn({ sprite: Sprite.smoke, position: point, velocity: add(random.scatter(1, 4), carry, 0.3), drag: 2,
      life: random.between(2, 3), size: [2, random.between(9, 13)], color: [LIGHT_SMOKE_FADED, LIGHT_SMOKE_FADED], alpha: 0.22, fadeIn: 0.1,
      rotation: random.between(0, 6.3), spin: random.between(-0.3, 0.3), minPx: 2 }, now)
  }
}

/** A missile's warhead going off in the air: a yellow-orange fireball, not a white flash (user
 * request 2026-10-26). The flash is yellow, the core and fireball are drawn in the alpha layer so
 * they keep their colour on the pale sky, and the fireball cools through orange to soot. `scale`
 * grows it with distance like the aircraft (1 = close in). */
export function missileBurst(layers: EffectLayers, now: number, point: Vec3Like, random: Random, scale = 1) {
  layers.smoke.spawn({ sprite: Sprite.glow, position: point, life: 0.16, size: [20 * scale, 30 * scale], color: [YELLOW, FIRE], alpha: 0.85, fadeIn: 0, minPx: 18 }, now)
  // The hot core: yellow going orange, quick.
  for (let index = 0; index < 5; index++) {
    layers.smoke.spawn({ sprite: Sprite.puff, position: add(point, random.scatter(0, 2)), velocity: random.scatter(4, 12), drag: 3,
      life: random.between(0.35, 0.55), size: [7 * scale, random.between(17, 22) * scale], color: [YELLOW, FIRE], alpha: 1, fadeIn: 0,
      rotation: random.between(0, 6.3), spin: random.between(-1, 1), minPx: 8 }, now)
  }
  // The fireball: orange cooling to soot.
  for (let index = 0; index < 9; index++) {
    layers.smoke.spawn({ sprite: Sprite.puff, position: point, velocity: random.scatter(8, 22 * scale), drag: 2.4, lift: 1.5,
      life: random.between(0.8, 1.2), size: [10 * scale, random.between(22, 30) * scale], color: [FIRE, CHAR], alpha: 0.95, fadeIn: 0.03,
      rotation: random.between(0, 6.3), spin: random.between(-0.6, 0.6), minPx: 5, delay: random.between(0, 0.06) }, now)
  }
  // Fragments thrown out, glowing orange as they fall.
  for (let index = 0; index < 12; index++) {
    layers.glow.spawn({ sprite: Sprite.streak, position: point, velocity: random.scatter(50, 120), drag: 1, lift: -9.81,
      life: random.between(0.5, 1.1), size: [0.8, 0.5], color: [YELLOW, EMBER], alpha: 1, fadeIn: 0, stretch: 0.05, minPx: 2 }, now)
  }
  // Dark smoke left hanging.
  for (let index = 0; index < 5; index++) {
    layers.smoke.spawn({ sprite: Sprite.smoke, position: point, velocity: random.scatter(2, 7), drag: 1.1, lift: 1.2,
      life: random.between(3, 4.5), size: [10 * scale, random.between(30, 40) * scale], color: [SMOKE, SMOKE_FADED], alpha: 0.75, fadeIn: 0.1,
      rotation: random.between(0, 6.3), spin: random.between(-0.25, 0.25), minPx: 4, delay: random.between(0.15, 0.4) }, now)
  }
}
