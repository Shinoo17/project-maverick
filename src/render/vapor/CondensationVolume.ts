import {
  Camera, Color, Data3DTexture, DepthTexture, HalfFloatType, LinearFilter, Matrix4, Mesh,
  NoBlending, PlaneGeometry, RedFormat, RepeatWrapping, Scene, ShaderMaterial,
  UnsignedByteType, UnsignedIntType, Vector2, Vector3, WebGLRenderer, WebGLRenderTarget,
} from 'three'
import type { AircraftId } from '../../content/schemas'
import { defaultVaporSettings, vaporActivation, type VaporConditions, type VaporSettings } from './conditions'
import { vaporFragment, vaporVertex } from './shaders'
import { vortexAirflow, vortexProfile, wingtipOrigins } from './profile'
import { CloudSideTransition } from './CloudSideTransition'

/** One opaque scene pass + bounded ray integration. Owns all of its GPU resources. */
export class CondensationVolume {
  readonly settings: VaporSettings = { ...defaultVaporSettings }
  private readonly target: WebGLRenderTarget
  private readonly noise: Data3DTexture
  private readonly material: ShaderMaterial
  private readonly quad: Mesh<PlaneGeometry, ShaderMaterial>
  private readonly scene = new Scene()
  private readonly camera = new Camera()
  private readonly size = new Vector2()
  private readonly flowDirection = new Vector3()
  private readonly cloudSide = new CloudSideTransition()
  private initialized = false
  private strength = 0
  private conditions: VaporConditions = { speed: 0, aoa: 0, g: 1, sideslip: 0, humidity: .78 }

  constructor(renderer: WebGLRenderer) {
    const data = new Uint8Array(32 ** 3)
    let seed = 271828
    for (let i = 0; i < data.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; data[i] = seed >>> 24 }
    this.noise = new Data3DTexture(data, 32, 32, 32)
    Object.assign(this.noise, { format: RedFormat, type: UnsignedByteType, minFilter: LinearFilter, magFilter: LinearFilter, wrapS: RepeatWrapping, wrapT: RepeatWrapping, wrapR: RepeatWrapping, unpackAlignment: 1, needsUpdate: true })
    this.target = new WebGLRenderTarget(1, 1, {
      type: renderer.extensions.has('EXT_color_buffer_float') ? HalfFloatType : UnsignedByteType,
      // Resolve depth as well as color so thin fins cleanly occlude the volume.
      samples: Math.min(4, renderer.capabilities.maxSamples), depthBuffer: true,
    })
    this.target.depthTexture = new DepthTexture(1, 1, UnsignedIntType)
    this.material = new ShaderMaterial({
      vertexShader: vaporVertex, fragmentShader: vaporFragment, depthTest: false, depthWrite: false, blending: NoBlending,
      uniforms: {
        solidBackground: { value: false }, sceneColor: { value: this.target.texture }, sceneDepth: { value: this.target.depthTexture }, noiseTex: { value: this.noise },
        inverseProjection: { value: new Matrix4() }, cameraWorld: { value: new Matrix4() }, worldToAircraft: { value: new Matrix4() },
        cameraLocal: { value: new Vector3() }, airflowDirection: { value: new Vector3(-1, 0, 0) }, flowPhase: { value: 0 },
        wingtipLeft: { value: new Vector3() }, wingtipRight: { value: new Vector3() },
        strength: { value: 0 }, trailLength: { value: 18 }, trailRadius: { value: .045 }, pixelAngle: { value: .001 },
        densityGain: { value: 1 }, noiseGain: { value: 1 }, turbulence: { value: 1 },
        cloudAdvection: { value: new Vector3() }, lightDirection: { value: new Vector3() },
        cloudUpperWeight: { value: .5 },
        alpha: { value: 0 }, load: { value: 0 }, speed: { value: 0 }, slip: { value: 0 }, humidity: { value: .78 },
        wingSpan: { value: 6.7 }, wingHeight: { value: -.74 },
      },
    })
    this.quad = new Mesh(new PlaneGeometry(2, 2), this.material)
    this.quad.frustumCulled = false
    this.scene.add(this.quad)
  }

  reset() {
    this.initialized = false; this.strength = 0
    this.cloudSide.reset()
    this.material.uniforms.flowPhase.value = 0
    this.material.uniforms.cloudAdvection.value.set(0, 0, 0)
  }

  update(next: VaporConditions, dt: number, reducedMotion = false, aircraft: AircraftId = 'f22', freezeFlow = false) {
    const target = vaporActivation(next)
    const blend = this.initialized ? 1 - Math.exp(-Math.max(0, dt) / (target > this.strength ? .16 : Math.max(.05, this.settings.fade))) : 1
    this.initialized = true
    this.strength += (target - this.strength) * blend
    for (const key of ['speed', 'aoa', 'g', 'sideslip', 'humidity'] as const) this.conditions[key] += (next[key] - this.conditions[key]) * blend
    const c = this.conditions, u = this.material.uniforms
    u.cloudUpperWeight.value = this.cloudSide.update(next.aoa, dt, this.settings.fade)
    const profile = vortexProfile(c), origins = wingtipOrigins[aircraft]
    u.strength.value = this.strength
    u.trailLength.value = profile.length; u.trailRadius.value = profile.radius
    u.wingtipLeft.value.fromArray(origins.left); u.wingtipRight.value.fromArray(origins.right)
    u.airflowDirection.value.copy(vortexAirflow(c, this.flowDirection))
    u.alpha.value = c.aoa; u.load.value = Math.min(1, Math.max(0, (Math.abs(c.g) - 1) / 7))
    u.speed.value = c.speed; u.slip.value = c.sideslip; u.humidity.value = c.humidity
    // Original pressure-sheet placement for the normalized F-22 / Su-57 wings.
    u.wingSpan.value = aircraft === 'su57' ? 6.4 : 6.7
    u.wingHeight.value = aircraft === 'su57' ? -.35 : -.74
    u.densityGain.value = this.settings.density; u.noiseGain.value = Math.min(1.5, this.settings.noise)
    u.turbulence.value = reducedMotion ? 0 : this.settings.turbulence * profile.turbulence
    if (!reducedMotion && !freezeFlow) {
      // Density travels downstream continuously; the core itself stays straight.
      u.flowPhase.value += c.speed * .35 * this.settings.airflow * Math.max(0, dt)
      const cloudFlow = Math.min(12, .7 + c.speed * .027) * this.settings.airflow * Math.max(0, dt)
      u.cloudAdvection.value.addScaledVector(this.flowDirection, cloudFlow)
    }
  }

  render(renderer: WebGLRenderer, scene: Scene, camera: Camera, aircraftMatrix: Matrix4) {
    const previousTarget = renderer.getRenderTarget()
    // Cruise costs no extra framebuffer or postprocessing pass.
    if (this.strength * this.settings.density < .002) { renderer.render(scene, camera); return }
    renderer.getDrawingBufferSize(this.size)
    if (this.target.width !== this.size.x || this.target.height !== this.size.y) this.target.setSize(this.size.x, this.size.y)
    const u = this.material.uniforms
    u.solidBackground.value = scene.background instanceof Color
    u.worldToAircraft.value.copy(aircraftMatrix).invert()
    u.cameraWorld.value.copy(camera.matrixWorld)
    u.inverseProjection.value.copy(camera.projectionMatrixInverse)
    u.cameraLocal.value.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(u.worldToAircraft.value)
    u.pixelAngle.value = 2 * camera.projectionMatrixInverse.elements[5] / this.size.y
    u.lightDirection.value.set(100, 600, 300).normalize().transformDirection(u.worldToAircraft.value)
    try {
      renderer.setRenderTarget(this.target)
      renderer.render(scene, camera)
      renderer.setRenderTarget(previousTarget)
      renderer.render(this.scene, this.camera)
    } finally { renderer.setRenderTarget(previousTarget) }
  }

  dispose() {
    this.target.dispose(); this.noise.dispose(); this.material.dispose(); this.quad.geometry.dispose()
  }
}
