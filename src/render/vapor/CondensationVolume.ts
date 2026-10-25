import {
  Camera, Color, Data3DTexture, DepthTexture, HalfFloatType, LinearFilter, MathUtils, Matrix4, Mesh,
  NoBlending, PlaneGeometry, RedFormat, RepeatWrapping, Scene, ShaderMaterial,
  UnsignedByteType, UnsignedIntType, Vector2, Vector3, WebGLRenderer, WebGLRenderTarget,
} from 'three'
import type { AircraftId } from '../../content/schemas'
import { defaultVaporSettings, type VaporConditions, type VaporSettings } from './conditions'
import { ConeTrigger, CONE_EVENT, vaporTargets } from './vaporModel'
import { vaporFragment, vaporVertex } from './shaders'
import { vortexAirflow, vortexProfile, getVaporProfile, LEX_PATH_POINTS, type ConeShape, type LexPath } from './profile'
import { CloudSideTransition } from './CloudSideTransition'
import { ExhaustResponse, getExhaustProfile, nozzleShapes, type ExhaustConditions } from '../exhaust/profile'
import { HeatHazePass } from '../exhaust/heatHaze'
import type { JetExhaust } from '../exhaust/JetExhaust'
import type { EffectQuality } from '../graphicsSettings'

/** Ray samples per quality step. Off skips the effect (and its rays, when both are off). */
const VAPOR_SAMPLES: Record<EffectQuality, number> = { off: 0, low: 12, high: 24 }
/** LEX vortex and vapor-cone ray samples per quality. */
const LEX_SAMPLES: Record<EffectQuality, number> = { off: 0, low: 16, high: 28 }
/** Vapor builds in ~0.07 s; it clears over settings.fade. */
const ATTACK_SECONDS = .07
/** The pressure cloud's upper/lower crossfade keeps its original pace. */
const SIDE_FADE_SECONDS = .45
type Effect = 'lex' | 'fog' | 'tip' | 'cone'
const EFFECTS: readonly Effect[] = ['lex', 'fog', 'tip', 'cone']
const EXHAUST_SAMPLE_SCALE: Record<EffectQuality, number> = { off: 0, low: 0.5, high: 1 }
const MSAA_SAMPLES = 4

/** One opaque scene pass + bounded ray integration. Owns all of its GPU resources. */
export class CondensationVolume {
  readonly settings: VaporSettings = { ...defaultVaporSettings }
  /** Graphics settings. The studio keeps the defaults (High, antialiased). */
  quality: { vapor: EffectQuality; exhaust: EffectQuality } = { vapor: 'high', exhaust: 'high' }
  /** Ray-marched plume (ExhaustStyle.volumePlume). Off: only the hot nozzle cavity; JetExhaust draws the flame. */
  exhaustPlume = false
  /** Ray-marched nozzle cavity glow, 0–1 (ExhaustStyle.volumeCavity). */
  exhaustCavity = 1
  private readonly haze: HeatHazePass
  private readonly shapes = { left: { origin: new Vector3(), axis: new Vector3(), up: new Vector3(), width: 0, height: 0 }, right: { origin: new Vector3(), axis: new Vector3(), up: new Vector3(), width: 0, height: 0 } }
  private readonly target: WebGLRenderTarget
  private readonly noise: Data3DTexture
  private readonly material: ShaderMaterial
  private readonly quad: Mesh<PlaneGeometry, ShaderMaterial>
  private readonly scene = new Scene()
  private readonly camera = new Camera()
  private readonly size = new Vector2()
  private readonly flowDirection = new Vector3()
  private fogFlicker = 1
  private readonly cloudSide = new CloudSideTransition()
  private readonly exhaust = new ExhaustResponse()
  private initialized = false
  /** Smoothed intensity of each effect, 0–1 (vaporModel.ts). */
  readonly levels: Record<Effect, number> = { lex: 0, fog: 0, tip: 0, cone: 0 }
  private burst = 1.2
  private shock = 0
  private shotSweep = 0
  private flicker = 0
  private readonly coneTrigger = new ConeTrigger()
  private conditions: VaporConditions = { speed: 0, aoa: 0, g: 1, sideslip: 0, mach: 0, dynamicPressure: 0, temperatureC: 15, depression: 10, water: .5 }

  constructor(renderer: WebGLRenderer) {
    const data = new Uint8Array(32 ** 3)
    let seed = 271828
    for (let i = 0; i < data.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; data[i] = seed >>> 24 }
    this.noise = new Data3DTexture(data, 32, 32, 32)
    Object.assign(this.noise, { format: RedFormat, type: UnsignedByteType, minFilter: LinearFilter, magFilter: LinearFilter, wrapS: RepeatWrapping, wrapT: RepeatWrapping, wrapR: RepeatWrapping, unpackAlignment: 1, needsUpdate: true })
    this.target = new WebGLRenderTarget(1, 1, {
      type: renderer.extensions.has('EXT_color_buffer_float') ? HalfFloatType : UnsignedByteType,
      // Resolve depth as well as color so thin fins cleanly occlude the volume.
      samples: Math.min(MSAA_SAMPLES, renderer.capabilities.maxSamples), depthBuffer: true,
    })
    this.target.depthTexture = new DepthTexture(1, 1, UnsignedIntType)
    this.material = new ShaderMaterial({
      vertexShader: vaporVertex, fragmentShader: vaporFragment, depthTest: false, depthWrite: false, blending: NoBlending,
      uniforms: {
        nozzleLeft: { value: new Vector3() }, nozzleRight: { value: new Vector3() },
        nozzleRadiusLeft: { value: new Vector2() }, nozzleRadiusRight: { value: new Vector2() },
        nozzleAxisLeft: { value: new Vector3(-1, 0, 0) }, nozzleAxisRight: { value: new Vector3(-1, 0, 0) },
        nozzleUpLeft: { value: new Vector3(0, 1, 0) }, nozzleUpRight: { value: new Vector3(0, 1, 0) },
        exhaustResolution: { value: new Vector2(1, 1) },
        exhaustPower: { value: 0 }, burnerStrength: { value: 0 }, exhaustTime: { value: 0 },
        nozzleInset: { value: 0 }, nozzleRound: { value: 0 },
        chamberRadius: { value: 0 }, burnerViolet: { value: 0 },
        exhaustLength: { value: 0 }, exhaustTurbulence: { value: 0 }, exhaustPlume: { value: 0 }, exhaustCavity: { value: 1 },
        heatDistort: { value: null }, heatOn: { value: false }, exhaustSampleScale: { value: 1 }, vaporSamples: { value: VAPOR_SAMPLES.high },
        solidBackground: { value: false }, passThrough: { value: false }, sceneColor: { value: this.target.texture }, sceneDepth: { value: this.target.depthTexture }, noiseTex: { value: this.noise },
        inverseProjection: { value: new Matrix4() }, cameraWorld: { value: new Matrix4() }, worldToAircraft: { value: new Matrix4() },
        cameraLocal: { value: new Vector3() }, airflowDirection: { value: new Vector3(-1, 0, 0) }, flowPhase: { value: 0 },
        wingtipLeft: { value: new Vector3() }, wingtipRight: { value: new Vector3() },
        strength: { value: 0 }, trailLength: { value: 18 }, trailRadius: { value: .045 }, pixelAngle: { value: .001 },
        densityGain: { value: 1 }, noiseGain: { value: 1 }, turbulence: { value: 1 },
        cloudAdvection: { value: new Vector3() }, lightDirection: { value: new Vector3() },
        cloudUpperWeight: { value: .5 },
        alpha: { value: 0 }, load: { value: 0 }, speed: { value: 0 }, slip: { value: 0 }, fogStrength: { value: 0 },
        wingSpan: { value: 6.7 }, wingHeight: { value: -.74 },
        lexStrength: { value: 0 }, lexBurst: { value: 1.2 }, lexFlow: { value: 0 }, lexSamples: { value: LEX_SAMPLES.high },
        lexPath: { value: Array.from({ length: LEX_PATH_POINTS }, () => new Vector3()) }, lexPathS: { value: new Array<number>(LEX_PATH_POINTS).fill(0) },
        lexBoxMin: { value: new Vector3() }, lexBoxMax: { value: new Vector3() }, lexRadius: { value: new Vector2() },
        coneStrength: { value: 0 }, coneFront: { value: 0 }, coneBack: { value: 0 }, coneAxisY: { value: 0 },
        coneRadius: { value: new Vector2() }, coneBoxMin: { value: new Vector3() }, coneBoxMax: { value: new Vector3() },
      },
    })
    this.haze = new HeatHazePass(renderer)
    this.quad = new Mesh(new PlaneGeometry(2, 2), this.material)
    this.quad.frustumCulled = false
    this.scene.add(this.quad)
  }

  /** Graphics › Anti-aliasing. The multisampled target is rebuilt on its next use. */
  setAntialias(renderer: WebGLRenderer, on: boolean) {
    const samples = on ? Math.min(MSAA_SAMPLES, renderer.capabilities.maxSamples) : 0
    if (this.target.samples === samples) return
    this.target.samples = samples
    this.target.dispose()
  }

  reset() {
    this.initialized = false
    for (const effect of EFFECTS) this.levels[effect] = 0
    this.coneTrigger.reset()
    this.exhaust.reset()
    this.material.uniforms.exhaustPower.value = 0
    this.material.uniforms.burnerStrength.value = 0
    this.cloudSide.reset()
    this.material.uniforms.flowPhase.value = 0
    this.material.uniforms.lexFlow.value = 0
    this.material.uniforms.cloudAdvection.value.set(0, 0, 0)
  }

  updateExhaust(next: ExhaustConditions, dt: number, reducedMotion = false) {
    this.exhaust.update(next, dt, reducedMotion)
    const p = getExhaustProfile(next.aircraftId), u = this.material.uniforms
    nozzleShapes(next, this.shapes)
    for (const side of ['Left', 'Right'] as const) {
      const shape = this.shapes[side === 'Left' ? 'left' : 'right']
      u[`nozzle${side}`].value.copy(shape.origin)
      u[`nozzleAxis${side}`].value.copy(shape.axis)
      u[`nozzleUp${side}`].value.copy(shape.up)
      u[`nozzleRadius${side}`].value.set(shape.width, shape.height)
    }
    u.nozzleInset.value = p.inset; u.nozzleRound.value = p.round
    u.chamberRadius.value = p.chamberRadius; u.burnerViolet.value = p.burnerViolet
    u.exhaustLength.value = p.length; u.exhaustTurbulence.value = p.turbulence
    u.exhaustPower.value = this.exhaust.power; u.burnerStrength.value = this.exhaust.burner
    u.exhaustTime.value = this.exhaust.time
  }

  update(next: VaporConditions, dt: number, reducedMotion = false, aircraft: AircraftId = 'f22', freezeFlow = false) {
    const wing = getVaporProfile(aircraft), targets = vaporTargets(next, wing.rig, next)
    const step = Math.max(0, dt), first = !this.initialized
    this.initialized = true
    // The cone is a one-shot event; its envelope already rises and fades smoothly.
    const coneShot = this.coneTrigger.update(next.mach, next.g, step)
    targets.cone *= coneShot
    for (const effect of EFFECTS) {
      const target = targets[effect], level = this.levels[effect]
      const seconds = target > level ? ATTACK_SECONDS : Math.max(.03, this.settings.fade)
      this.levels[effect] = first || effect === 'cone' ? target : level + (target - level) * -Math.expm1(-step / seconds)
    }
    // Shape inputs follow the air a little slower than intensity, so the geometry does not twitch.
    const shapeBlend = first ? 1 : -Math.expm1(-step / .1)
    for (const key of ['speed', 'aoa', 'g', 'sideslip', 'mach', 'dynamicPressure', 'water'] as const) this.conditions[key] += (next[key] - this.conditions[key]) * shapeBlend
    this.burst += (targets.burst - this.burst) * shapeBlend
    this.shock += (targets.shock - this.shock) * shapeBlend
    // During a shot the shock runs a little aft, so the collar sweeps down the fuselage.
    this.shotSweep = Math.min(1, this.coneTrigger.age / CONE_EVENT.seconds) * .25
    const c = this.conditions, u = this.material.uniforms
    u.cloudUpperWeight.value = this.cloudSide.update(next.aoa, dt, SIDE_FADE_SECONDS)
    const profile = vortexProfile(c), origins = wing.origins
    u.trailLength.value = profile.length; u.trailRadius.value = profile.radius
    u.wingtipLeft.value.fromArray(origins.left); u.wingtipRight.value.fromArray(origins.right)
    u.airflowDirection.value.copy(vortexAirflow(c, this.flowDirection))
    u.alpha.value = c.aoa; u.load.value = Math.min(1, Math.max(0, (Math.abs(c.g) - 1) / 7))
    u.speed.value = c.speed; u.slip.value = c.sideslip
    // Original pressure-sheet placement for the normalized F-22 / Su-57 wings.
    u.wingSpan.value = wing.span
    u.wingHeight.value = wing.height
    u.densityGain.value = this.settings.density; u.noiseGain.value = Math.min(1.5, this.settings.noise)
    u.turbulence.value = reducedMotion ? 0 : this.settings.turbulence * profile.turbulence
    // Upper-surface fog flickers 8–15 Hz by about 15%: the real flow there is unsteady.
    if (!reducedMotion && !freezeFlow) this.flicker += step
    const t = this.flicker * Math.PI * 2
    this.fogFlicker = reducedMotion ? 1 : 1 + .15 * (Math.sin(t * 9.3) * .6 + Math.sin(t * 13.1 + 1.7) * .4)
    this.placeLex(wing.lex)
    this.placeCone(wing.cone)
    u.lexBurst.value = this.burst
    if (!reducedMotion && !freezeFlow) {
      // Density travels downstream continuously; the core itself stays straight.
      u.flowPhase.value += c.speed * .35 * this.settings.airflow * step
      u.lexFlow.value += Math.min(14, 1 + c.speed * .05) * this.settings.airflow * step
      const cloudFlow = Math.min(12, .7 + c.speed * .027) * this.settings.airflow * step
      u.cloudAdvection.value.addScaledVector(this.flowDirection, cloudFlow)
    }
  }

  /** The baked skin path, its normalized arc length, and a box that covers the burst cloud. */
  private placeLex(path: LexPath) {
    const u = this.material.uniforms, points: Vector3[] = u.lexPath.value, arc: number[] = u.lexPathS.value
    const min = u.lexBoxMin.value.setScalar(Infinity), max = u.lexBoxMax.value.setScalar(-Infinity)
    let length = 0
    points.forEach((point, i) => {
      point.fromArray(path.points[i])
      if (i) length += point.distanceTo(points[i - 1])
      arc[i] = length
      min.min(point); max.max(point)
    })
    for (let i = 0; i < arc.length; i++) arc[i] /= Math.max(.001, length)
    u.lexRadius.value.fromArray(path.radius)
    // 3.5 radii (3 plus the turbulence push), ÷ .65 for the burst cloud's sideways spread (vortexShader.ts).
    const margin = path.radius[1] * (this.burst < 1.15 ? 2.4 / .65 : 1) * 3.5
    min.subScalar(margin); max.addScalar(margin)
    min.z = -max.z
  }

  private placeCone(shape: ConeShape) {
    const u = this.material.uniforms
    const back = MathUtils.lerp(shape.back[0], shape.back[1], Math.min(1, this.shock + this.shotSweep)), r = shape.radius[1]
    u.coneFront.value = shape.front; u.coneBack.value = back; u.coneAxisY.value = shape.axisY
    u.coneRadius.value.fromArray(shape.radius)
    u.coneBoxMin.value.set(back - r * 1.6 * .18 - .6, shape.axisY - r * 1.6, -r * 1.6)
    u.coneBoxMax.value.set(shape.front + .1, shape.axisY + r * 1.6, r * 1.6)
  }

  /** `exhausts` add their heat haze; the composite refracts the scene through it. */
  render(renderer: WebGLRenderer, scene: Scene, camera: Camera, aircraftMatrix: Matrix4, exhausts: readonly JetExhaust[] = []) {
    const previousTarget = renderer.getRenderTarget()
    // The scene always resolves through the multisampled target, so the canvas itself
    // needs no antialiasing; with exhaust and condensation both off, the rays are skipped.
    renderer.getDrawingBufferSize(this.size)
    if (this.target.width !== this.size.x || this.target.height !== this.size.y) this.target.setSize(this.size.x, this.size.y)
    const u = this.material.uniforms
    u.exhaustResolution.value.copy(this.size)
    u.solidBackground.value = scene.background instanceof Color
    // Off zeroes an effect for this frame only; its state keeps running, so switching back is seamless.
    const on = this.quality.vapor !== 'off' ? 1 : 0, exhaust = this.quality.exhaust !== 'off' ? this.exhaust.power : 0
    const l = this.levels
    u.strength.value = l.tip * on
    u.fogStrength.value = l.fog * this.fogFlicker * on
    u.lexStrength.value = l.lex * on
    u.coneStrength.value = l.cone * on
    u.exhaustPower.value = exhaust
    u.vaporSamples.value = VAPOR_SAMPLES[this.quality.vapor]
    u.lexSamples.value = LEX_SAMPLES[this.quality.vapor]
    u.exhaustSampleScale.value = EXHAUST_SAMPLE_SCALE[this.quality.exhaust]
    u.exhaustPlume.value = this.exhaustPlume ? 1 : 0
    u.exhaustCavity.value = this.exhaustCavity
    u.passThrough.value = on * Math.max(l.tip, l.fog, l.lex, l.cone) * this.settings.density < .002 && exhaust < .002
    u.worldToAircraft.value.copy(aircraftMatrix).invert()
    u.cameraWorld.value.copy(camera.matrixWorld)
    u.inverseProjection.value.copy(camera.projectionMatrixInverse)
    u.cameraLocal.value.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(u.worldToAircraft.value)
    u.pixelAngle.value = 2 * camera.projectionMatrixInverse.elements[5] / this.size.y
    u.lightDirection.value.set(100, 600, 300).normalize().transformDirection(u.worldToAircraft.value)
    try {
      renderer.setRenderTarget(this.target)
      renderer.render(scene, camera)
      // Needs the resolved opaque depth, so it runs between the scene and the composite.
      const distortion = this.haze.render(renderer, camera, this.target.depthTexture!, exhausts)
      u.heatDistort.value = distortion; u.heatOn.value = !!distortion
      renderer.setRenderTarget(previousTarget)
      renderer.render(this.scene, this.camera)
    } finally { renderer.setRenderTarget(previousTarget) }
  }

  dispose() {
    this.target.dispose(); this.haze.dispose(); this.noise.dispose(); this.material.dispose(); this.quad.geometry.dispose()
  }
}
