/*
Billboard particles for combat effects: one instanced quad mesh per layer, sprites from the
atlas (atlas.ts), every particle a camera-facing square, or a streak stretched along its
motion for sparks. A particle names a sprite role; where the atlas has several cells for it,
particles take them in turn by spawn order, so a replay draws the same shapes.

Particles are a view only. Each one is a pure function of its age: position under linear drag
and a constant vertical acceleration (gravity, or smoke's lift) has a closed form, so nothing
is integrated per frame. Ages come from the simulation clock the scene passes in, so pause
freezes every effect and practice time scale slows them with the world.

Two layers, because the training range's sky is pale (#c4d4de):
- glow, additive: flashes and sparks. Light added to a pale sky barely shows, so only short,
  bright things use it. Fog fades their alpha instead of tinting them toward the haze.
- smoke, normal alpha: fireballs and smoke, saturated orange to dark grey, which read against
  a pale sky by colour and darkness. Fog blends them into the haze like the terrain.

A layer holds a fixed number of particles; a new one over the cap replaces the oldest.
A minimum size in screen pixels keeps far effects visible: a 3 m flash at 1 km is under five
pixels, so small marks are given a floor.
*/
import {
  AdditiveBlending, Color, DynamicDrawUsage, InstancedBufferAttribute, InstancedBufferGeometry, MathUtils, Mesh, NormalBlending,
  PlaneGeometry, ShaderMaterial, UniformsLib, UniformsUtils, type PerspectiveCamera,
} from 'three'
import { ATLAS, type ParticleAtlas, type SpriteIndex } from './atlas'

type Vec3Like = { x: number; y: number; z: number }

export interface ParticleSpec {
  sprite: SpriteIndex
  position: Vec3Like
  velocity?: Vec3Like
  /** 1/s: how fast the velocity decays (linear drag). */
  drag?: number
  /** m/s² straight up: negative falls (gravity), positive rises (hot smoke). */
  lift?: number
  /** Seconds. */
  life: number
  /** Metres across, at birth and at the end of life (eased out). */
  size: readonly [number, number]
  /** Linear colour at birth and at the end of life. */
  color: readonly [Color, Color]
  /** Peak opacity. */
  alpha: number
  /** Share of life spent fading in. */
  fadeIn?: number
  /** Radians, and radians per second. */
  rotation?: number
  spin?: number
  /** CSS pixels: never drawn smaller than this. */
  minPx?: number
  /** Seconds of motion drawn as the streak's length; 0 or unset draws a square. */
  stretch?: number
  /** Seconds after the spawn time before it appears. */
  delay?: number
}
interface Particle { spec: ParticleSpec; born: number; order: number }

export interface ParticleState { x: number; y: number; z: number; vx: number; vy: number; vz: number; size: number; alpha: number; r: number; g: number; b: number }

/** Where a particle is and how it looks `age` seconds after it appears. */
export function particleAt(spec: ParticleSpec, age: number, out: ParticleState): ParticleState {
  const t = Math.max(0, age), k = spec.drag ?? 0, a = spec.lift ?? 0
  const v = spec.velocity ?? { x: 0, y: 0, z: 0 }, p = spec.position
  if (k > 1e-6) {
    const decay = Math.exp(-k * t), terminal = a / k, travel = (1 - decay) / k
    out.x = p.x + v.x * travel; out.z = p.z + v.z * travel
    out.y = p.y + terminal * t + (v.y - terminal) * travel
    out.vx = v.x * decay; out.vz = v.z * decay; out.vy = terminal + (v.y - terminal) * decay
  } else {
    out.x = p.x + v.x * t; out.z = p.z + v.z * t; out.y = p.y + v.y * t + a * t * t / 2
    out.vx = v.x; out.vz = v.z; out.vy = v.y + a * t
  }
  const f = MathUtils.clamp(t / spec.life, 0, 1)
  out.size = MathUtils.lerp(spec.size[0], spec.size[1], 1 - (1 - f) * (1 - f))
  const fadeIn = spec.fadeIn ?? 0.05
  out.alpha = spec.alpha * (f < fadeIn ? f / fadeIn : Math.pow(1 - (f - fadeIn) / (1 - fadeIn), 1.3))
  out.r = MathUtils.lerp(spec.color[0].r, spec.color[1].r, f)
  out.g = MathUtils.lerp(spec.color[0].g, spec.color[1].g, f)
  out.b = MathUtils.lerp(spec.color[0].b, spec.color[1].b, f)
  return out
}

const vertexShader = /* glsl */`
attribute vec3 iPosition;
attribute vec4 iColor;
attribute vec4 iShape;   // size (m), rotation (rad), sprite, minimum size (CSS px)
attribute vec4 iStretch; // world direction, extra length (m); length 0 draws a square
uniform float uPixel;    // metres one CSS pixel covers per metre of distance
uniform vec4 uPainted[${ATLAS.columns * ATLAS.rows}]; // per cell: reference tint, 1 if painted
varying vec2 vUv;
varying vec4 vColor;
varying vec4 vPainted;
varying float vFogDepth;
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(iPosition, 1.0);
  float distance = max(-mvPosition.z, 0.001);
  float size = max(iShape.x, iShape.w * uPixel * distance);
  vec2 corner = position.xy;
  if (iStretch.w > 0.0) {
    // A streak: the sprite's long (vertical) axis laid along the motion seen on screen.
    vec2 along = (viewMatrix * vec4(iStretch.xyz, 0.0)).xy;
    float seen = length(along);
    vec2 axis = seen > 1e-4 ? along / seen : vec2(0.0, 1.0);
    vec2 across = vec2(axis.y, -axis.x);
    mvPosition.xy += across * corner.x * size + axis * corner.y * (size + iStretch.w * seen);
  } else {
    float c = cos(iShape.y), s = sin(iShape.y);
    mvPosition.xy += mat2(c, s, -s, c) * corner * size;
  }
  gl_Position = projectionMatrix * mvPosition;
  float column = mod(iShape.z, ${ATLAS.columns}.0), row = floor(iShape.z / ${ATLAS.columns}.0);
  // The canvas texture is flipped: row 0 (top of the canvas) is the top of v.
  vUv = vec2((column + uv.x) / ${ATLAS.columns}.0, 1.0 - (row + 1.0 - uv.y) / ${ATLAS.rows}.0);
  vColor = iColor;
  vPainted = uPainted[int(iShape.z + 0.5)];
  vFogDepth = distance;
}`

const fragmentShader = /* glsl */`
uniform sampler2D map;
uniform float uAdditive;
uniform vec3 fogColor;
uniform float fogDensity;
uniform float fogNear;
uniform float fogFar;
varying vec2 vUv;
varying vec4 vColor;
varying vec4 vPainted;
varying float vFogDepth;
void main() {
  vec4 sprite = texture2D(map, vUv);
  vec3 color;
  // A painted sprite keeps its colour, shifted by the tint relative to the cell's reference.
  if (vPainted.w > 0.5) color = sRGBTransferEOTF(vec4(sprite.rgb, 1.0)).rgb * vColor.rgb / max(vPainted.rgb, vec3(0.02));
  // A grey sprite's shading gives smoke its lumps; tint carries the colour.
  else color = vColor.rgb * mix(0.55, 1.25, sprite.r);
  float alpha = sprite.a * vColor.a;
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
    if (uAdditive > 0.5) alpha *= 1.0 - fogFactor;
    else color = mix(color, fogColor, fogFactor);
  #endif
  if (alpha < 0.003) discard;
  gl_FragColor = vec4(color, alpha);
  #include <colorspace_fragment>
}`

export function createParticleLayer({ capacity, additive, order }: { capacity: number; additive: boolean; order: number }) {
  const quad = new PlaneGeometry(1, 1), geometry = new InstancedBufferGeometry()
  geometry.setIndex(quad.getIndex()).setAttribute('position', quad.getAttribute('position')).setAttribute('uv', quad.getAttribute('uv'))
  const position = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3)
  const color = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4)
  const shape = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4)
  const stretch = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4)
  for (const attribute of [position, color, shape, stretch]) attribute.setUsage(DynamicDrawUsage)
  geometry.setAttribute('iPosition', position).setAttribute('iColor', color).setAttribute('iShape', shape).setAttribute('iStretch', stretch)
  geometry.instanceCount = 0
  const material = new ShaderMaterial({
    uniforms: UniformsUtils.merge([UniformsLib.fog, {
      map: { value: null }, uPixel: { value: 0.001 }, uAdditive: { value: additive ? 1 : 0 }, uPainted: { value: new Float32Array(ATLAS.columns * ATLAS.rows * 4) },
    }]),
    vertexShader, fragmentShader,
    transparent: true, depthWrite: false, fog: true, toneMapped: false,
    blending: additive ? AdditiveBlending : NormalBlending,
  })
  const mesh = new Mesh(geometry, material)
  mesh.frustumCulled = false
  mesh.renderOrder = order
  // Nothing to draw until the atlas has loaded.
  mesh.visible = false

  const particles: Particle[] = []
  let atlas: ParticleAtlas | null = null, spawned = 0
  const state: ParticleState = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, size: 0, alpha: 0, r: 0, g: 0, b: 0 }

  /** Adds a particle born at `now` (simulation seconds). Over the cap it replaces the oldest. */
  function spawn(spec: ParticleSpec, now: number) {
    const particle = { spec, born: now + (spec.delay ?? 0), order: spawned++ }
    if (particles.length < capacity) { particles.push(particle); return }
    let oldest = 0
    for (let index = 1; index < particles.length; index++) if (particles[index].born < particles[oldest].born) oldest = index
    particles[oldest] = particle
  }

  /** Drops expired particles and writes the rest for drawing. `viewportHeight` is in CSS pixels. */
  function update(now: number, camera?: PerspectiveCamera, viewportHeight = 1) {
    let kept = 0, drawn = 0
    for (const particle of particles) {
      const age = now - particle.born
      if (age > particle.spec.life) continue
      particles[kept++] = particle
      if (age < 0) continue
      const s = particleAt(particle.spec, age, state)
      const spec = particle.spec
      position.setXYZ(drawn, s.x, s.y, s.z)
      color.setXYZW(drawn, s.r, s.g, s.b, s.alpha)
      const cells = atlas?.cells[spec.sprite], cell = cells?.length ? cells[particle.order % cells.length] : spec.sprite
      shape.setXYZW(drawn, s.size, (spec.rotation ?? 0) + (spec.spin ?? 0) * age, cell, spec.minPx ?? 0)
      const speed = Math.hypot(s.vx, s.vy, s.vz)
      if (spec.stretch && speed > 1e-3) stretch.setXYZW(drawn, s.vx / speed, s.vy / speed, s.vz / speed, speed * spec.stretch)
      else stretch.setXYZW(drawn, 0, 0, 0, 0)
      drawn++
    }
    particles.length = kept
    geometry.instanceCount = drawn
    for (const attribute of [position, color, shape, stretch]) {
      attribute.clearUpdateRanges(); attribute.addUpdateRange(0, drawn * attribute.itemSize); attribute.needsUpdate = true
    }
    if (camera) material.uniforms.uPixel.value = 2 * Math.tan(MathUtils.degToRad(camera.fov) / 2) / Math.max(1, viewportHeight)
  }

  /** Draws with this atlas from the next update on, live particles included. */
  function setAtlas(next: ParticleAtlas) {
    atlas = next
    material.uniforms.map.value = next.texture; material.uniforms.uPainted.value = next.painted
    mesh.visible = true
  }
  function clear() { particles.length = 0; geometry.instanceCount = 0; spawned = 0 }
  function dispose() { geometry.dispose(); material.dispose() }
  return { mesh, spawn, update, setAtlas, clear, dispose, get count() { return particles.length } }
}
export type ParticleLayer = ReturnType<typeof createParticleLayer>

/** Shorthand for a linear colour. */
export const tint = (r: number, g: number, b: number) => new Color(r, g, b)
