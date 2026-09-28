/*
Gun tracers: a view of the simulated rounds, one instanced mesh per layer for all of them.

Every fourth round is drawn, like belted tracer ammunition (real guns load one
in four or five); the rounds between still fly and hit in the simulation. A
streak ends where the round is drawn and trails back along its velocity, as
long as the round moves in a camera shutter of 1/50 s, so it reads as a motion
blurred light. Rounds are drawn between ticks like the aircraft: the tick
position moved back by the part of the tick not yet shown, never behind the
muzzle.

Each tracer is three layers, sized in screen pixels that shrink with distance,
more slowly than true perspective, so a far burst still reads as smaller and
farther but never drops under a drawn pixel and a half:
- a body: a wide yellow-orange glow, alpha blended, fading toward the tail. Over
  a bright daytime sky an additive light only pushes the sky toward white; an
  orange laid over blue stands out by colour even where brightness is equal.
- a core: a thin white-hot line, opaque, so the white holds over a bright sky
  and the glow around it frames it.
- a head: a small opaque white dot at the round, the part the eye finds at range.
There is no bloom pass; the body stands in for one.
*/
import { BoxGeometry, BufferAttribute, Color, DynamicDrawUsage, Group, IcosahedronGeometry, InstancedMesh, MathUtils, Matrix4, MeshBasicMaterial, NormalBlending, Quaternion, Vector3 } from 'three'
import type { BufferGeometry, Blending, PerspectiveCamera } from 'three'
import type { Projectile } from '../game/combat/projectiles'
import { WORLD_STEP } from '../game/runtime/clock'

const MAX_TRACERS = 256
const TRACER_EVERY = 4
// Streak length is the distance flown in this much time, capped.
const SHUTTER = 1 / 50
const MAX_STREAK = 30
// Widths in CSS pixels at REFERENCE metres. They scale by the square root of
// REFERENCE over distance: half the width at four times the distance. Closer
// than NEAR the width holds.
const REFERENCE = 100, NEAR = 25
const CORE_PX = 2, BODY_PX = 4.5, HEAD_PX = 4
// No layer under this many drawn pixels: thinner shimmers as the line crosses pixel rows
// (no antialiasing at low render scale).
const MIN_DRAWN_PX = 1.5
// Linear colours. Body head ≈ sRGB (1, 0.7, 0.22), tail ≈ (1, 0.54, 0.15). The glow
// stays saturated: a pale one turns mauve over blue sky. It is kept faint, a halo
// around the white core rather than a second colour of its own.
const BODY_HEAD = new Color(1, 0.45, 0.04), BODY_TAIL = new Color(1, 0.25, 0.02)
const BODY_ALPHA_HEAD = 0.55, BODY_ALPHA_TAIL = 0.15
// Core white at the head, cooling to pale yellow at the tail.
const CORE_HEAD = new Color(1, 1, 1), CORE_TAIL = new Color(1, 0.7, 0.25)
const CORE_ALPHA_TAIL = 0.6
const HEAD = new Color(1, 1, 0.95)
// Per-round glow tint, picked by round id: plain, redder, yellower. The white core stays white.
const TINTS = [new Color(1, 1, 1), new Color(1, 0.8, 0.7), new Color(1, 1.15, 1)]

// Unit box along +X, from -1 to 0, so scaling stretches it back from the head,
// with a colour and alpha blended from tail (x = -1) to head (x = 0).
function streakGeometry(head: Color, tail: Color, headAlpha: number, tailAlpha: number) {
  const geometry = new BoxGeometry(1, 1, 1).translate(-0.5, 0, 0)
  const x = geometry.getAttribute('position'), colors = new Float32Array(x.count * 4), blend = new Color()
  for (let index = 0; index < x.count; index++) {
    const f = x.getX(index) + 1
    blend.lerpColors(tail, head, f).toArray(colors, index * 4)
    colors[index * 4 + 3] = MathUtils.lerp(tailAlpha, headAlpha, f)
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 4))
  return geometry
}

function layer(geometry: BufferGeometry, blending: Blending, order: number, color = new Color(1, 1, 1)) {
  const material = new MeshBasicMaterial({ color, vertexColors: geometry.hasAttribute('color'), blending, transparent: true, depthWrite: false, toneMapped: false, fog: false })
  const mesh = new InstancedMesh(geometry, material, MAX_TRACERS)
  for (let index = 0; index < MAX_TRACERS; index++) mesh.setColorAt(index, TINTS[0])
  mesh.instanceMatrix.setUsage(DynamicDrawUsage)
  mesh.frustumCulled = false
  mesh.renderOrder = order
  mesh.count = 0
  return mesh
}

export function createTracers() {
  // Drawn body, then core, then head, so the white sits on top of the glow.
  const body = layer(streakGeometry(BODY_HEAD, BODY_TAIL, BODY_ALPHA_HEAD, BODY_ALPHA_TAIL), NormalBlending, 1)
  const core = layer(streakGeometry(CORE_HEAD, CORE_TAIL, 1, CORE_ALPHA_TAIL), NormalBlending, 2)
  const head = layer(new IcosahedronGeometry(0.5, 1), NormalBlending, 3, HEAD)
  const layers = [body, core, head]
  const mesh = new Group().add(...layers)
  const matrix = new Matrix4(), tip = new Vector3(), direction = new Vector3(), scale = new Vector3(), rotation = new Quaternion()
  const forward = new Vector3(1, 0, 0)

  // viewportHeight: the canvas height in CSS pixels; dpr: drawn pixels per CSS pixel.
  function update(projectiles: readonly Projectile[], alpha: number, camera: PerspectiveCamera, viewportHeight: number, dpr: number) {
    // Metres one pixel covers per metre of distance.
    const pixel = 2 * Math.tan(MathUtils.degToRad(camera.fov) / 2) / Math.max(1, viewportHeight)
    let count = 0
    for (const round of projectiles) {
      if (round.id % TRACER_EVERY !== 0) continue
      if (count === MAX_TRACERS) break
      const { velocity: v, position: p } = round
      const speed = Math.hypot(v.x, v.y, v.z)
      if (speed < 1) continue
      const back = Math.min((1 - alpha) * WORLD_STEP, round.age)
      tip.set(p.x - v.x * back, p.y - v.y * back, p.z - v.z * back)
      const length = Math.min(speed * SHUTTER, MAX_STREAK, round.travelled - back * speed)
      if (length <= 0) continue
      direction.set(v.x / speed, v.y / speed, v.z / speed)
      const distance = tip.distanceTo(camera.position)
      const perPixel = distance * pixel, falloff = Math.sqrt(REFERENCE / Math.max(NEAR, distance))
      const floor = MIN_DRAWN_PX / dpr
      const tint = TINTS[(round.id / TRACER_EVERY) % TINTS.length]
      rotation.setFromUnitVectors(forward, direction)
      const coreWidth = perPixel * Math.max(floor, CORE_PX * falloff)
      const bodyWidth = perPixel * Math.max(floor * 1.5, BODY_PX * falloff)
      const headSize = perPixel * Math.max(floor, HEAD_PX * falloff)
      body.setMatrixAt(count, matrix.compose(tip, rotation, scale.set(length, bodyWidth, bodyWidth)))
      core.setMatrixAt(count, matrix.compose(tip, rotation, scale.set(length, coreWidth, coreWidth)))
      head.setMatrixAt(count, matrix.compose(tip, rotation, scale.setScalar(headSize)))
      body.setColorAt(count, tint)
      count++
    }
    for (const layerMesh of layers) {
      layerMesh.count = count
      layerMesh.instanceMatrix.needsUpdate = true
      if (layerMesh.instanceColor) layerMesh.instanceColor.needsUpdate = true
    }
  }
  function dispose() {
    for (const layerMesh of layers) { layerMesh.geometry.dispose(); (layerMesh.material as MeshBasicMaterial).dispose(); layerMesh.dispose() }
  }
  return { mesh, update, dispose }
}
