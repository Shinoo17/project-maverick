/*
Sky reflections for the airframe in flight. The aircraft GLBs are largely metallic
(metalness 1 through their metalness maps), and a metal surface with nothing to reflect
renders black: without this the engine nacelles and nozzles read as black boxes.

The environment is applied to the aircraft's own copies of its materials, not to the
scene, so the ground and range keep their tuned lighting. The hangar lights the shared
materials through scene.environment (StudioEnvironment), which these copies never touch.
*/
import { BackSide, Color, Mesh, MeshStandardMaterial, PMREMGenerator, Scene, ShaderMaterial, SphereGeometry, type Material, type Object3D, type Texture, type WebGLRenderer } from 'three'

/** Defaults follow the flat range: its sky dome and hemisphere ground colour. */
export interface SkyEnvironmentColors { zenith: string; horizon: string; ground: string }
const RANGE_SKY: SkyEnvironmentColors = { zenith: '#4f82bd', horizon: '#c4d4de', ground: '#857761' }

/** Prefiltered gradient sky. The caller disposes the texture. */
export function createSkyEnvironment(renderer: WebGLRenderer, colors: SkyEnvironmentColors = RANGE_SKY): Texture {
  const material = new ShaderMaterial({
    side: BackSide, depthWrite: false,
    uniforms: { zenith: { value: new Color(colors.zenith) }, horizon: { value: new Color(colors.horizon) }, ground: { value: new Color(colors.ground) } },
    vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 zenith, horizon, ground; varying vec3 vDir;
      void main() {
        float y = normalize(vDir).y;
        vec3 sky = mix(horizon, zenith, smoothstep(0.0, 0.6, y));
        gl_FragColor = vec4(mix(sky, mix(horizon, ground, 0.7), smoothstep(0.0, -0.25, y)), 1.0);
      }`,
  })
  const scene = new Scene(), sphere = new Mesh(new SphereGeometry(10, 32, 16), material)
  scene.add(sphere)
  const generator = new PMREMGenerator(renderer)
  const texture = generator.fromScene(scene, .02).texture
  generator.dispose(); sphere.geometry.dispose(); material.dispose()
  return texture
}

/** Gives every standard material under `root` its own copy reflecting `envMap`; returns the copies for disposal. */
export function applyEnvironment(root: Object3D, envMap: Texture, intensity: number): Material[] {
  const copies = new Map<Material, Material>()
  const copy = (material: Material) => {
    if (!(material instanceof MeshStandardMaterial)) return material
    let own = copies.get(material) as MeshStandardMaterial | undefined
    if (!own) { own = material.clone(); own.envMap = envMap; own.envMapIntensity = intensity; copies.set(material, own) }
    return own
  }
  root.traverse(object => {
    if (object instanceof Mesh) object.material = Array.isArray(object.material) ? object.material.map(copy) : copy(object.material)
  })
  return [...copies.values()]
}
