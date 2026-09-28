/*
The target drone (Playground practice modifier). It is an ordinary aircraft
entity that the runtime holds still; this view only draws it where the latest
world snapshot says it is. Painted high-visibility orange, like real aerial
targets, on its own copies of the materials: the GLB cache shares materials
with the player's aircraft and the menu scene, which must keep their colours.
*/
import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Color, Group, Mesh, MeshStandardMaterial, type Material } from 'three'
import { getAircraft, modelUrl } from '../content/aircraft'
import { targetDrone } from '../game/playground/practice'
import type { WorldState } from '../game/state/WorldState'
import { useAircraftAsset } from './aircraft/assetLoader'
import { buildFlightModel } from './aircraft/flightModel'
import { HitboxWireframe } from './HitboxWireframe'

const highVisibility = new Color('#ff7a2e')

export function TargetDrone({ world, showHitboxes }: { world: RefObject<WorldState | null>; showHitboxes: boolean }) {
  const definition = getAircraft(targetDrone.aircraftId)
  const asset = useAircraftAsset(modelUrl(definition))
  const group = useRef<Group>(null)
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
  useFrame(() => {
    const drone = world.current?.aircraft.find(entity => entity.control === 'hold')
    if (!group.current) return
    group.current.visible = !!drone
    if (!drone) return
    group.current.position.set(drone.position.x, drone.position.y, drone.position.z)
    group.current.quaternion.set(drone.orientation.x, drone.orientation.y, drone.orientation.z, drone.orientation.w)
  })
  return <group ref={group} visible={false}>
    <primitive object={model} dispose={null} />
    {showHitboxes && <HitboxWireframe profileId={definition.hitboxProfileId} />}
  </group>
}
