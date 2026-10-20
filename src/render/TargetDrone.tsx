/*
The target drone (Playground practice modifier). It is an ordinary aircraft
entity that the runtime holds still or moves along a path. This view only
builds the model: FlightWorld places `group` each frame, interpolated between
ticks like the player's aircraft (a useFrame here would run a frame late), scales
`model` up with distance (targetVisibility.ts), and hides it while it is shot down.
The hitbox wireframe sits outside the scaled group, so `?hitboxes` shows the true hitbox. Painted high-visibility orange,
like real aerial targets, on its own copies of the materials: the GLB cache
shares materials with the player's aircraft and the menu scene, which must
keep their colours.
*/
import { useEffect, useMemo, type RefObject } from 'react'
import { useThree } from '@react-three/fiber'
import { Color, Mesh, MeshStandardMaterial, type Group, type Material } from 'three'
import { getAircraft, modelUrl } from '../content/aircraft'
import { targetDrone } from '../game/playground/practice'
import { useAircraftAsset } from './aircraft/assetLoader'
import { buildFlightModel } from './aircraft/flightModel'
import { HitboxWireframe } from './HitboxWireframe'

const highVisibility = new Color('#ff7a2e')

export function TargetDrone({ group, scaled, showHitboxes }: { group: RefObject<Group | null>; scaled: RefObject<Group | null>; showHitboxes: boolean }) {
  const definition = getAircraft(targetDrone.aircraftId)
  const asset = useAircraftAsset(modelUrl(definition))
  const invalidate = useThree(state => state.invalidate)
  const { model, painted } = useMemo(() => {
    const model = buildFlightModel(asset, definition), painted: Material[] = []
    const paint = (material: Material) => {
      const copy = material.clone()
      if ('color' in copy && copy.color instanceof Color) copy.color.lerp(highVisibility, 0.6)
      // The airframe textures are dark grey, so the colour alone reads brown; a faint glow keeps it orange in any light.
      if (copy instanceof MeshStandardMaterial) { copy.emissive.copy(highVisibility); copy.emissiveIntensity = 0.35 }
      painted.push(copy)
      return copy
    }
    model.traverse(object => {
      if (object instanceof Mesh) object.material = Array.isArray(object.material) ? object.material.map(paint) : paint(object.material)
    })
    return { model, painted }
  }, [asset, definition])
  useEffect(() => () => {
    painted.forEach(material => material.dispose())
    model.traverse(object => {
      if ('isSkinnedMesh' in object && object.isSkinnedMesh && 'skeleton' in object) (object.skeleton as { dispose(): void }).dispose()
    })
  }, [model, painted])
  // Paused, the canvas draws on demand: draw once the model has loaded.
  useEffect(() => { invalidate() }, [model, invalidate])
  return <group ref={group} visible={false}>
    <group ref={scaled}><primitive object={model} dispose={null} /></group>
    {showHitboxes && <HitboxWireframe profileId={definition.hitboxProfileId} />}
  </group>
}
