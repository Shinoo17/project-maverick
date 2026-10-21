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

DroneWrecks builds the falling wrecks' models (vfx/wreck.ts): the same airframe, scorched.
The combat effects place and show them; one per wreck slot.
*/
import { useEffect, useMemo, type RefObject } from 'react'
import { useThree } from '@react-three/fiber'
import { Color, Mesh, MeshStandardMaterial, type Group, type Material, type Object3D } from 'three'
import { getAircraft, modelUrl } from '../content/aircraft'
import { targetDrone } from '../game/playground/practice'
import { useAircraftAsset } from './aircraft/assetLoader'
import { buildFlightModel } from './aircraft/flightModel'
import { HitboxWireframe } from './HitboxWireframe'
import { WRECK_SLOTS } from './vfx/combatEffects'

const highVisibility = new Color('#ff7a2e')
const scorched = new Color('#2a2420')

/** The drone airframe on its own copies of the materials, recoloured by `paint` (a module-level function, so it never changes). */
function usePaintedModel(paint: (material: Material) => void) {
  const definition = getAircraft(targetDrone.aircraftId)
  const asset = useAircraftAsset(modelUrl(definition))
  const built = useMemo(() => {
    const model = buildFlightModel(asset, definition), painted: Material[] = []
    const copy = (material: Material) => { const own = material.clone(); paint(own); painted.push(own); return own }
    model.traverse(object => {
      if (object instanceof Mesh) object.material = Array.isArray(object.material) ? object.material.map(copy) : copy(object.material)
    })
    return { model, painted }
  }, [asset, definition, paint])
  useEffect(() => () => disposeModel(built.model, built.painted), [built])
  return { definition, model: built.model }
}
function disposeModel(model: Object3D, painted: Material[]) {
  painted.forEach(material => material.dispose())
  model.traverse(object => {
    if ('isSkinnedMesh' in object && object.isSkinnedMesh && 'skeleton' in object) (object.skeleton as { dispose(): void }).dispose()
  })
}

function paintHighVisibility(material: Material) {
  if ('color' in material && material.color instanceof Color) material.color.lerp(highVisibility, 0.6)
  // The airframe textures are dark grey, so the colour alone reads brown; a faint glow keeps it orange in any light.
  if (material instanceof MeshStandardMaterial) { material.emissive.copy(highVisibility); material.emissiveIntensity = 0.35 }
}
function paintScorched(material: Material) {
  if ('color' in material && material.color instanceof Color) material.color.lerp(scorched, 0.75)
  if (material instanceof MeshStandardMaterial) { material.emissive.set(0, 0, 0); material.roughness = 1 }
}

export function TargetDrone({ group, scaled, showHitboxes }: { group: RefObject<Group | null>; scaled: RefObject<Group | null>; showHitboxes: boolean }) {
  const { definition, model } = usePaintedModel(paintHighVisibility)
  const invalidate = useThree(state => state.invalidate)
  // Paused, the canvas draws on demand: draw once the model has loaded.
  useEffect(() => { invalidate() }, [model, invalidate])
  return <group ref={group} visible={false}>
    <group ref={scaled}><primitive object={model} dispose={null} /></group>
    {showHitboxes && <HitboxWireframe profileId={definition.hitboxProfileId} />}
  </group>
}

function Wreck({ slot, models }: { slot: number; models: RefObject<(Group | null)[]> }) {
  const { model } = usePaintedModel(paintScorched)
  return <group ref={group => { models.current[slot] = group }} visible={false}><primitive object={model} dispose={null} /></group>
}
export function DroneWrecks({ models }: { models: RefObject<(Group | null)[]> }) {
  return <>{Array.from({ length: WRECK_SLOTS }, (_, slot) => <Wreck key={slot} slot={slot} models={models} />)}</>
}
