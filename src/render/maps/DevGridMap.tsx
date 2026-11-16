/*
A dev-grid placeholder map: the shared sky over a flat plane painted as a coloured survey
grid from the map's palette (content/maps). It marks where a real map will go; there is no
terrain height, so the flat ground at 0 m is still the only thing to hit.
*/
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Color, Mesh, MeshStandardMaterial, Vector3 } from 'three'
import { trainingMap, type DevGridPalette } from '../../content/maps'
import { RangeAtmosphere } from '../range/TrainingRange'
import { devGridFragmentPars, devGridVertex, devGridVertexPars } from './devGridShader'

export function DevGridMap({ palette }: { palette: DevGridPalette }) {
  const mesh = useRef<Mesh>(null)
  // One program for every dev-grid map: the palette goes in through uniforms.
  const uniforms = useMemo(() => ({
    devRadius: { value: trainingMap.radius }, devScale: { value: 1 }, devLevels: { value: new Vector3() },
    devLow: { value: new Color() }, devMid: { value: new Color() }, devHigh: { value: new Color() }, devPeak: { value: new Color() }, devLine: { value: new Color() },
  }), [])
  const material = useMemo(() => {
    const standard = new MeshStandardMaterial({ color: '#ffffff', roughness: 1 })
    standard.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, uniforms)
      shader.vertexShader = devGridVertexPars + shader.vertexShader.replace('#include <project_vertex>', devGridVertex)
      shader.fragmentShader = devGridFragmentPars + shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= devGround(vDevWorld.xz);')
    }
    standard.customProgramCacheKey = () => 'dev-grid-map'
    return standard
  }, [uniforms])
  useEffect(() => () => material.dispose(), [material])
  useEffect(() => {
    const [low, mid, high, peak] = palette.bands
    // Colours are authored as sRGB hex; Color converts them to the linear space the shader works in.
    uniforms.devLow.value.set(low); uniforms.devMid.value.set(mid); uniforms.devHigh.value.set(high); uniforms.devPeak.value.set(peak)
    uniforms.devLine.value.set(palette.line); uniforms.devLevels.value.set(...palette.levels); uniforms.devScale.value = palette.scale
  }, [palette, uniforms])
  // The plane rides under the camera; the pattern is keyed to world position, so it never slides.
  useFrame(({ camera }) => { mesh.current?.position.set(camera.position.x, 0, camera.position.z) })
  return <>
    <RangeAtmosphere />
    <mesh ref={mesh} rotation={[-Math.PI / 2, 0, 0]} frustumCulled={false} material={material}><planeGeometry args={[30000, 30000]} /></mesh>
  </>
}
