import {
  AdditiveBlending, AddEquation, Camera, Color, CustomBlending, CylinderGeometry, DataTexture, DoubleSide, FrontSide,
  Group, LinearFilter, Matrix4, Mesh, OneFactor, OneMinusSrcAlphaFactor, PlaneGeometry, RGBAFormat, Scene, ShaderMaterial, Sprite, SpriteMaterial,
  Texture, Vector2, Vector3, type BufferGeometry, type IUniform,
} from 'three'
import type { EffectQuality } from '../graphicsSettings'
import { ExhaustResponse, getExhaustProfile, nozzleShapes, type ExhaustConditions, type ExhaustNozzleShape } from './profile'
import { flameFragment, flameVertex, heatFragment, heatVertex, interiorFragment, interiorVertex, shockFragment, shockVertex } from './flameShaders'
import { SIM_FX, type ExhaustStyle, type FlameLayerStyle } from './style'

/*
Afterburner flame as a component: add `group` under the aircraft's group and call
`update` each frame after the rig has posed the nozzles. Every mesh follows its
nozzle (thrust vectoring included) because it lives in that nozzle's frame.

Heat haze is drawn separately: `heatScene` holds refraction volumes that write
screen-space offsets. CondensationVolume renders it after the opaque scene (it needs
that depth) and refracts the scene with it in its composite.
*/

/** Exit radius of the demo's nozzle; all style lengths and radii are relative to it. */
const DEMO_EXIT_RADIUS = .585
const LAYERS = ['glow', 'cone', 'core', 'sheath'] as const
type Layer = typeof LAYERS[number]
type Uniforms = Record<string, IUniform>
const SIDES = [{ key: 'left', phase: 6.1, flow: 1 }, { key: 'right', phase: 44.2, flow: 1.04 }] as const
const smooth01 = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t) }

/** Unit tube: xy on the unit circle, z in [0, 1]. Shaders build the real shape. */
function unitTube(radial: number, axial: number) {
  const geometry = new CylinderGeometry(1, 1, 1, radial, axial, true)
  geometry.rotateX(Math.PI / 2); geometry.translate(0, 0, .5)
  return geometry
}

/** Soft radial falloff for the halo sprites, built without a canvas so it also runs in tests. */
function haloTexture() {
  const size = 64, data = new Uint8Array(size * size * 4)
  const stops = [[0, 1], [.12, .55], [.4, .12], [1, 0]]
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const r = Math.min(1, Math.hypot(x + .5 - size / 2, y + .5 - size / 2) / (size / 2))
    const i = stops.findIndex(stop => stop[0] >= r), [r0, a0] = stops[Math.max(0, i - 1)], [r1, a1] = stops[i]
    const value = Math.round(255 * (a0 + (a1 - a0) * (r1 > r0 ? (r - r0) / (r1 - r0) : 0))), o = (y * size + x) * 4
    data[o] = data[o + 1] = data[o + 2] = data[o + 3] = value
  }
  const texture = new DataTexture(data, size, size, RGBAFormat)
  texture.minFilter = texture.magFilter = LinearFilter
  texture.needsUpdate = true
  return texture
}

const additive = { transparent: true, depthWrite: false, side: DoubleSide, blending: AdditiveBlending } as const
/** Premultiplied light over the background: alpha 0 is plain additive, alpha 1 replaces what is behind. */
const covering = { ...additive, blending: CustomBlending, blendEquation: AddEquation, blendSrc: OneFactor, blendDst: OneMinusSrcAlphaFactor } as const

interface Nozzle {
  anchor: Group
  /** Flame shells only, moved upstream into the nozzle by style.flameStart. */
  flame: Group
  heatAnchor: Group
  shape: ExhaustNozzleShape
  phase: number
  flow: number
  layers: Record<Layer, Mesh<BufferGeometry, ShaderMaterial>>
  shock: Mesh<BufferGeometry, ShaderMaterial>
  interior: Mesh<PlaneGeometry, ShaderMaterial>
  halo: Sprite
  hotspot: Sprite
  heat: Mesh<BufferGeometry, ShaderMaterial>
}

export class JetExhaust {
  /** Child of the aircraft group: flame shells, nozzle interior and glow sprites. */
  readonly group = new Group()
  /** Refraction volumes only; rendered into the distortion buffer, never to the screen. */
  readonly heatScene = new Scene()
  readonly response = new ExhaustResponse()
  private readonly heatRoot = new Group()
  private readonly nozzles: Nozzle[]
  private readonly geometry = { high: unitTube(48, 96), low: unitTube(24, 48), heat: unitTube(40, 56), exit: new PlaneGeometry(2, 2) }
  private readonly halo = haloTexture()
  /** Shared by both heat materials; set by the haze pass before it renders. */
  readonly heatShared = {
    tDepth: { value: null as Texture | null }, uRes: { value: new Vector2(1, 1) },
    uNear: { value: .1 }, uFar: { value: 1000 }, uOrtho: { value: 0 }, uSoftDistance: { value: .6 }, uCameraFade: { value: 3 },
  }
  private style: ExhaustStyle = SIM_FX
  private quality: EffectQuality = 'high'
  private worldScale = 1
  private hazeLevel = 0
  private readonly basis = new Matrix4()
  private readonly across = new Vector3()
  private readonly toCamera = new Vector3()
  private readonly exit = new Vector3()
  private readonly white = new Color(1, 1, 1)

  constructor(style: ExhaustStyle = SIM_FX) {
    this.group.name = 'JetExhaust'
    this.heatRoot.matrixAutoUpdate = false
    this.heatScene.add(this.heatRoot)
    this.nozzles = SIDES.map(side => this.buildNozzle(side.phase, side.flow))
    this.setStyle(style)
  }

  get activeStyle(): Readonly<ExhaustStyle> { return this.style }

  get hazeActive() { return this.quality === 'high' && this.style.haze.enabled && this.hazeLevel > 1e-5 }

  setQuality(quality: EffectQuality) {
    if (quality === this.quality) return
    this.quality = quality
    for (const nozzle of this.nozzles) for (const layer of LAYERS) nozzle.layers[layer].geometry = quality === 'low' ? this.geometry.low : this.geometry.high
    this.group.visible = quality !== 'off'
  }

  setStyle(style: ExhaustStyle) {
    this.style = style
    for (const nozzle of this.nozzles) {
      for (const name of LAYERS) {
        const layer = style.layers[name], u = nozzle.layers[name].material.uniforms
        u.uColA.value.setRGB(...layer.colors[0]); u.uColB.value.setRGB(...layer.colors[1])
        u.uColC.value.setRGB(...layer.colors[2]); u.uColD.value.setRGB(...layer.colors[3])
        u.uMid.value = layer.mids[0]; u.uMid2.value = layer.mids[1]
        u.uR0.value = layer.r0; u.uR1.value = layer.r1; u.uShape.value = layer.shape
        u.uEdge.value = layer.edge; u.uAxial.value = layer.axial; u.uFalloff.value = layer.falloff
        u.uFadeIn.value = layer.fadeIn; u.uFlicker.value = layer.flicker; u.uRim.value = layer.rim
        u.uTailCut.value = layer.tail; u.uBumpRamp.value = layer.ramp
        u.uInnerTint.value.setRGB(...layer.tint); u.uTintAmt.value = layer.tintAmount; u.uPatch.value = layer.patch; u.uCover.value = layer.cover
      }
      const s = nozzle.shock.material.uniforms
      s.uColA.value.setRGB(...style.shock.colors[0]); s.uColB.value.setRGB(...style.shock.colors[1]); s.uCells.value = style.shock.cells
      const d = nozzle.interior.material.uniforms, interior = style.interior
      d.uC0.value.setRGB(...interior.colors[0]); d.uC1.value.setRGB(...interior.colors[1]); d.uC2.value.setRGB(...interior.colors[2])
      d.uRingAmt.value = interior.rings; d.uTaper.value = interior.taper; d.uWall.value = interior.wall; d.uGas.value = interior.gas; d.uCore.value = interior.core
    }
  }

  reset() { this.response.reset(); this.hazeLevel = 0 }

  /**
   * `aircraftMatrix` is the aircraft group's world matrix (the heat volumes copy it);
   * `camera` aims the nozzle glow. Never writes to the simulation.
   */
  update(conditions: ExhaustConditions, dt: number, camera: Camera, aircraftMatrix: Matrix4, reducedMotion = false) {
    const response = this.response, style = this.style
    response.update(conditions, dt, reducedMotion)
    nozzleShapes(conditions, { left: this.nozzles[0].shape, right: this.nozzles[1].shape })
    this.heatRoot.matrix.copy(aircraftMatrix)
    this.heatRoot.matrixWorldNeedsUpdate = true
    this.worldScale = aircraftMatrix.getMaxScaleOnAxis()
    const off = this.quality === 'off' || response.power < .002
    this.group.visible = !off
    this.hazeLevel = 0
    if (off) return
    const t = response.power, ab = smooth01(response.burner), time = response.time
    const tm = style.turbulence
    const round = getExhaustProfile(conditions.aircraftId).round > .5 ? 1 : 0
    for (const nozzle of this.nozzles) {
      const { shape } = nozzle
      // Exit frame: +Z down the exhaust axis, +X across the nozzle width, +Y up.
      const axis = shape.axis.normalize(), up = shape.up.addScaledVector(axis, -shape.up.dot(axis)).normalize()
      this.across.crossVectors(up, axis).normalize()
      this.basis.makeBasis(this.across, up, axis).setPosition(shape.origin)
      for (const anchor of [nozzle.anchor, nozzle.heatAnchor]) { anchor.matrix.copy(this.basis); anchor.matrixWorldNeedsUpdate = true }
      const tail = Math.max(shape.width, shape.height) / DEMO_EXIT_RADIUS
      const rootX = shape.width / DEMO_EXIT_RADIUS, rootY = shape.height / DEMO_EXIT_RADIUS
      const tremor = 1 + .02 * Math.sin(time * 7.3 + nozzle.phase) * t
      const abI = ab * (.3 + .7 * t) * tremor
      const scroll = response.scroll * nozzle.flow
      // Dry thrust: a short glow cone that stretches into a long afterburner cone.
      const length = style.flameLength * ((1.1 + 1.6 * t) * (1 - ab) + (2.6 + 5.4 * t) * ab)
      const dry = .16 * t * t * (1 - ab), freq = 1 + .9 * t
      // The shells start inside the nozzle and grow by that much, so the tip stays where it was.
      const start = style.flameStart * DEMO_EXIT_RADIUS
      nozzle.flame.position.z = -start * tail
      for (const name of LAYERS) {
        const layer: FlameLayerStyle = style.layers[name], mesh = nozzle.layers[name], u = mesh.material.uniforms
        const intensity = style.flameBrightness * layer.intensity * (layer.burner * abI + layer.dry * dry), hybrid = layer.hybrid
        u.uTime.value = time; u.uScroll.value = scroll; u.uLength.value = length * layer.length + start; u.uIntensity.value = intensity
        u.uInside.value = start / Math.max(u.uLength.value, 1e-4); u.uInsideAxial.value = style.insideAxial
        // Hybrid layers get SIM-style boundary motion, faded in by uBumpRamp so the root stays tight.
        u.uWobble.value = (layer.wobble + .25 * hybrid) * tm + .12 * hybrid
        u.uBump.value = (layer.bump + .1 * hybrid) * tm + .06 * hybrid
        u.uFreq.value = freq
        u.uHybrid.value = hybrid * Math.min(1.3, .8 + .6 * tm)
        u.uRootScale.value.set(rootX, rootY); u.uTailScale.value = tail
        mesh.visible = intensity > .002
      }
      const s = nozzle.shock.material.uniforms
      s.uTime.value = time; s.uScroll.value = scroll
      s.uSpan.value = length * .55; s.uStart.value = .45 + .1 * t
      s.uRmax.value = .24 * (.8 + .2 * t) * (.6 + .4 * ab)
      s.uIntensity.value = style.shock.enabled ? style.shock.intensity * abI * (.35 + .65 * t) : 0
      s.uRootScale.value.set(rootX, rootY); s.uTailScale.value = tail
      nozzle.shock.visible = s.uIntensity.value > .002

      // Nozzle glow: the lit duct behind the exit, halo and hot spot strongest looking into the nozzle.
      const glow = style.nozzleGlow, exitSize = Math.max(shape.width, shape.height)
      const d = nozzle.interior.material.uniforms
      d.uIntensity.value = style.interior.enabled ? glow * style.interior.intensity * (.05 + .45 * t * t + .5 * abI) : 0
      d.uAB.value = abI; d.uTime.value = time; d.uScroll.value = scroll; d.uRound.value = round
      d.uDepth.value = style.interior.depth * exitSize
      // The plane covers the exit; the virtual duct behind it is wider, so its walls and
      // corners fall outside the opening and the airframe's lip draws the outline.
      const plane = style.interior.plane
      nozzle.interior.scale.set(shape.width * plane, shape.height * plane, 1)
      d.uPlane.value = plane / style.interior.oversize
      nozzle.interior.position.z = -style.interior.inset * exitSize
      nozzle.interior.visible = d.uIntensity.value > .003
      this.exit.copy(shape.origin).applyMatrix4(aircraftMatrix)
      this.toCamera.setFromMatrixPosition(camera.matrixWorld).sub(this.exit).normalize()
      const look = Math.max(0, this.toCamera.dot(this.exit.copy(axis).transformDirection(aircraftMatrix)))
      const flick = .92 + .08 * Math.sin(time * 19 + nozzle.phase) * Math.sin(time * 5.3 + nozzle.phase)
      // Sized by the exit area, not its widest side, so a flat nozzle gets no oversized round glow.
      const aperture = Math.sqrt(shape.width * shape.height) / DEMO_EXIT_RADIUS
      const glowZ = -style.halo.depth * exitSize
      const halo = glow * .6 * style.halo.intensity * (.04 * t * t + .3 * abI) * (.25 + .75 * look * look) * flick
      nozzle.halo.material.color.setRGB(...style.halo.color).multiplyScalar(halo)
      nozzle.halo.scale.setScalar((2.6 + .5 * abI) * style.halo.scale * aperture)
      nozzle.halo.position.z = glowZ
      nozzle.halo.visible = halo > .003
      const spot = glow * style.hotspot.intensity * (.03 * t * t + .15 * abI) * (.35 + .65 * look) * flick
      nozzle.hotspot.material.color.setRGB(...style.halo.color).lerp(this.white, style.hotspot.white).multiplyScalar(spot)
      nozzle.hotspot.scale.setScalar(1.25 * style.hotspot.scale * aperture)
      nozzle.hotspot.position.z = glowZ
      nozzle.hotspot.visible = spot > .003

      // Heat haze grows with throttle and burner; it vanishes as the engine winds down.
      const h = nozzle.heat.material.uniforms
      const level = (.2 + .8 * Math.pow(t, 1.1)) * (1 + .25 * ab) * Math.min(1, t / .05)
      h.uTime.value = time; h.uScroll.value = scroll * .85
      h.uStrength.value = style.haze.enabled ? style.haze.strength * .0044 * level : 0
      h.uLength.value = (7 + 7 * t) * (1 + .35 * ab)
      h.uR1.value = 1.4 + 1.3 * t + .8 * ab
      h.uFreq.value = .75 + .85 * t + .3 * ab
      h.uWobble.value = (.5 + .9 * t) * tm
      h.uRootScale.value.set(rootX, rootY); h.uTailScale.value = tail
      nozzle.heat.visible = h.uStrength.value > 1e-5
      this.hazeLevel = Math.max(this.hazeLevel, h.uStrength.value)
    }
    const scale = this.worldScale * Math.max(...this.nozzles.map(n => Math.max(n.shape.width, n.shape.height))) / DEMO_EXIT_RADIUS
    this.heatShared.uSoftDistance.value = .6 * scale
    this.heatShared.uCameraFade.value = 3 * scale
  }

  dispose() {
    this.group.removeFromParent()
    for (const geometry of Object.values(this.geometry)) geometry.dispose()
    this.halo.dispose()
    for (const nozzle of this.nozzles) {
      for (const layer of LAYERS) nozzle.layers[layer].material.dispose()
      nozzle.shock.material.dispose(); nozzle.interior.material.dispose()
      nozzle.halo.material.dispose(); nozzle.hotspot.material.dispose(); nozzle.heat.material.dispose()
    }
  }

  private buildNozzle(phase: number, flow: number): Nozzle {
    const anchor = new Group(), heatAnchor = new Group()
    anchor.matrixAutoUpdate = heatAnchor.matrixAutoUpdate = false
    this.group.add(anchor); this.heatRoot.add(heatAnchor)
    const scale = () => ({ uRootScale: { value: new Vector2(1, 1) }, uTailScale: { value: 1 } })
    const motion = (seed: number) => ({ uTime: { value: 0 }, uScroll: { value: 0 }, uPhase: { value: seed } })
    const flame = new Group()
    anchor.add(flame)
    const place = <T extends Mesh | Sprite>(object: T, order: number, parent: Group = anchor) => { object.frustumCulled = false; object.renderOrder = order; parent.add(object); return object }
    const layers = {} as Nozzle['layers']
    for (const name of LAYERS) {
      const uniforms: Uniforms = {
        ...motion(phase + name.length * 5.1), ...scale(),
        uLength: { value: 1 }, uR0: { value: 0 }, uR1: { value: 0 }, uShape: { value: 1 }, uWobble: { value: 0 }, uBump: { value: 0 },
        uFreq: { value: 1 }, uBumpRamp: { value: .12 }, uIntensity: { value: 0 }, uEdge: { value: 1 }, uAxial: { value: 0 },
        uFalloff: { value: 1 }, uFadeIn: { value: .02 }, uMid: { value: .4 }, uMid2: { value: .98 }, uFlicker: { value: 0 },
        uRim: { value: 0 }, uHybrid: { value: 0 }, uTailCut: { value: 1 }, uInnerTint: { value: new Color(1, 1, 1) },
        uTintAmt: { value: 0 }, uPatch: { value: 0 }, uCover: { value: 0 }, uInside: { value: 0 }, uInsideAxial: { value: 1 },
        uColA: { value: new Color() }, uColB: { value: new Color() }, uColC: { value: new Color() }, uColD: { value: new Color() },
      }
      layers[name] = place(new Mesh(this.geometry.high, new ShaderMaterial({ vertexShader: flameVertex, fragmentShader: flameFragment, uniforms, ...covering })), 2, flame)
    }
    const shock = place(new Mesh(this.geometry.high, new ShaderMaterial({
      vertexShader: shockVertex, fragmentShader: shockFragment, ...additive,
      uniforms: { ...motion(phase * 1.3), ...scale(), uStart: { value: .5 }, uSpan: { value: 3 }, uRmax: { value: .25 }, uCells: { value: 4 },
        uBreath: { value: .03 }, uIntensity: { value: 0 }, uColA: { value: new Color() }, uColB: { value: new Color() } },
    })), 3)
    // Front side only: the duct is seen from behind the aircraft, never through the airframe.
    const interior = place(new Mesh(this.geometry.exit, new ShaderMaterial({
      vertexShader: interiorVertex, fragmentShader: interiorFragment, ...additive, side: FrontSide,
      uniforms: { ...motion(phase), uIntensity: { value: 0 }, uAB: { value: 0 }, uRingAmt: { value: 1 }, uDepth: { value: 1 }, uPlane: { value: 1 }, uTaper: { value: 1 }, uRound: { value: 0 },
        uWall: { value: 1 }, uGas: { value: 0 }, uCore: { value: .3 }, uC0: { value: new Color() }, uC1: { value: new Color() }, uC2: { value: new Color() } },
    })), 1)
    const sprite = (order: number) => place(new Sprite(new SpriteMaterial({ map: this.halo, color: 0x000000, blending: AdditiveBlending, depthWrite: false, transparent: true, fog: false })), order)
    const heat = new Mesh(this.geometry.heat, new ShaderMaterial({
      vertexShader: heatVertex, fragmentShader: heatFragment, transparent: true, depthWrite: false, depthTest: false, side: DoubleSide,
      blending: CustomBlending, blendEquation: AddEquation, blendSrc: OneFactor, blendDst: OneFactor, blendSrcAlpha: OneFactor, blendDstAlpha: OneFactor,
      uniforms: { ...motion(phase * .7 + 11), ...scale(), ...this.heatShared, uLength: { value: 10 }, uR0: { value: .5 }, uR1: { value: 2 },
        uStart: { value: -.35 }, uWobble: { value: .6 }, uStrength: { value: 0 }, uFreq: { value: 1 } },
    }))
    heat.frustumCulled = false
    heatAnchor.add(heat)
    return { anchor, flame, heatAnchor, shape: { origin: new Vector3(), axis: new Vector3(-1, 0, 0), up: new Vector3(0, 1, 0), width: .5, height: .5 },
      phase, flow, layers, shock, interior, halo: sprite(5), hotspot: sprite(6), heat }
  }
}
