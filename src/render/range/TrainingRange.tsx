import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { BackSide, Color, Mesh, MeshStandardMaterial, ShaderMaterial, Vector3 } from 'three'
import { trainingMap } from '../../content/maps'
import { trainingRings } from '../../game/playground/practice'
import { groundFragmentPars, groundVertex, groundVertexPars, skyFragment, skyVertex } from './shaders'

// Must stay the vector CondensationVolume lights the vapor from.
export const SUN_POSITION = [100, 600, 300] as const
export const HAZE = '#c4d4de'
// Fog meets the dome's horizon colour just before the far plane, so the clipped ground edge vanishes.
export const FOG_DENSITY = 0.00016

function Sky() {
  const mesh = useRef<Mesh>(null)
  const material = useMemo(() => new ShaderMaterial({
    vertexShader: skyVertex, fragmentShader: skyFragment, side: BackSide,
    depthTest: false, depthWrite: false, fog: false, toneMapped: false,
    uniforms: {
      zenith: { value: new Color('#4f82bd') }, horizon: { value: new Color(HAZE) },
      sunColor: { value: new Color('#fff2d8') }, sunDirection: { value: new Vector3(...SUN_POSITION).normalize() },
    },
  }), [])
  useFrame(({ camera }) => { mesh.current?.position.copy(camera.position) })
  return <mesh ref={mesh} renderOrder={-1000} frustumCulled={false} material={material}><sphereGeometry args={[1000, 32, 16]} /></mesh>
}

function Ground() {
  const mesh = useRef<Mesh>(null)
  const material = useMemo(() => {
    const standard = new MeshStandardMaterial({ color: '#ffffff', roughness: 1 })
    standard.onBeforeCompile = shader => {
      shader.uniforms.rangeRadius = { value: trainingMap.radius }
      shader.vertexShader = groundVertexPars + shader.vertexShader.replace('#include <project_vertex>', groundVertex)
      shader.fragmentShader = groundFragmentPars + shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= rangeGround(vRangeWorld.xz);')
    }
    return standard
  }, [])
  // The plane rides under the camera; the pattern is keyed to world position, so it never slides.
  useFrame(({ camera }) => { mesh.current?.position.set(camera.position.x, 0, camera.position.z) })
  return <mesh ref={mesh} rotation={[-Math.PI / 2, 0, 0]} frustumCulled={false} material={material}><planeGeometry args={[30000, 30000]} /></mesh>
}

// A handful of vertical landmarks beside the apron for scale on approach.
function Airfield() {
  return <group>
    {[380, 550, 720].map(x => <group key={x} position={[x, 0, 178]}>
      <mesh position={[0, 9, 0]}><boxGeometry args={[70, 18, 46]} /><meshStandardMaterial color="#8d9394" roughness={.7} metalness={.2} /></mesh>
      <mesh position={[0, 18.4, 0]}><boxGeometry args={[72, 1, 48]} /><meshStandardMaterial color="#5f6668" roughness={.8} /></mesh>
    </group>)}
    <group position={[960, 0, 130]}>
      <mesh position={[0, 16, 0]}><cylinderGeometry args={[3.2, 4, 32, 12]} /><meshStandardMaterial color="#d9d6cc" roughness={.8} /></mesh>
      <mesh position={[0, 34, 0]}><cylinderGeometry args={[7, 6, 5, 12]} /><meshStandardMaterial color="#39474d" roughness={.3} metalness={.4} /></mesh>
    </group>
  </group>
}

export function TrainingRange() {
  return <>
    <color attach="background" args={[HAZE]} />
    <fogExp2 attach="fog" args={[HAZE, FOG_DENSITY]} />
    <hemisphereLight args={['#dce9f7', '#6b7552', 1.5]} />
    <directionalLight position={SUN_POSITION} color="#fff3e0" intensity={3.1} />
    <Sky /><Ground /><Airfield />
    {trainingRings.map(x => <mesh key={x} rotation={[0, Math.PI / 2, 0]} position={[x, 400, 0]}>
      <torusGeometry args={[65, 2.2, 10, 64]} />
      <meshStandardMaterial color="#f2b545" emissive="#7a4f0f" emissiveIntensity={.7} roughness={.45} metalness={.15} />
    </mesh>)}
  </>
}
