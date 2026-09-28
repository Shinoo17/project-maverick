/*
Builds a flight-scale copy of an aircraft GLB: the listed nodes removed, the
first animation frame applied, turned so +X is forward and scaled so the longest
side is `flightModelLength` metres around the bounding-box centre. Hitboxes
(src/content/hitboxes.ts) are fitted to exactly this frame.
*/
import { Box3, Group, Vector3, type AnimationClip, type Object3D } from 'three'
import { clone } from 'three/addons/utils/SkeletonUtils.js'
import { flightModelLength } from '../../content/aircraft'
import type { AircraftDefinition } from '../../content/schemas'
import { prepareAnimations } from './animationStages'

export function buildFlightModel(asset: { scene: Object3D; animations: AnimationClip[] }, definition: AircraftDefinition) {
  const copy = clone(asset.scene)
  for (const name of definition.removeNodes) copy.getObjectByName(name)?.removeFromParent()
  prepareAnimations(copy, asset.animations)
  const orientation = new Group(); orientation.rotation.set(...definition.rotation); orientation.add(copy)
  const bounds = new Box3().setFromObject(orientation), size = bounds.getSize(new Vector3())
  const root = new Group(); root.add(orientation); root.scale.setScalar(flightModelLength / Math.max(size.x, size.y, size.z))
  orientation.position.copy(bounds.getCenter(new Vector3())).negate()
  return root
}
