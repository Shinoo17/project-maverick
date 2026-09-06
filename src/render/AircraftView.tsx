import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Box3, Group, Mesh, Vector3 } from 'three'
import { clone } from 'three/addons/utils/SkeletonUtils.js'
import { modelUrl } from '../content/aircraft'
import type { AircraftDefinition } from '../content/schemas'
import { useAircraftAsset } from './aircraft/assetLoader'
import { AnimationStages, prepareAnimations, type Stage } from './aircraft/animationStages'

export interface AircraftViewProps {
  aircraft: AircraftDefinition
  targets: Record<string, boolean>
  playing: boolean
  speed: number
  resetId: number
  onReady: (stages: Stage[]) => void
}

export function AircraftView({ aircraft, targets, playing, speed, resetId, onReady }: AircraftViewProps) {
  const asset = useAircraftAsset(modelUrl(aircraft))
  const invalidate = useThree((state) => state.invalidate)
  const player = useRef<AnimationStages | null>(null)
  const { root, model, clips } = useMemo(() => {
    const model = clone(asset.scene)
    for (const name of aircraft.removeNodes) model.getObjectByName(name)?.removeFromParent()
    const clips = prepareAnimations(model, asset.animations)
    const orientation = new Group()
    orientation.rotation.set(...aircraft.rotation)
    orientation.add(model)
    const bounds = new Box3().setFromObject(orientation)
    const size = bounds.getSize(new Vector3())
    const center = bounds.getCenter(new Vector3())
    const scale = 10 / Math.max(size.x, size.y, size.z)
    const root = new Group()
    root.add(orientation)
    root.scale.setScalar(scale)
    root.position.copy(center).multiplyScalar(-scale)
    root.position.y += 0.35
    model.traverse((object) => {
      if (object instanceof Mesh) { object.castShadow = true; object.receiveShadow = true }
    })
    return { root, model, clips }
  }, [aircraft, asset])

  useEffect(() => {
    const controller = new AnimationStages(model, clips)
    player.current = controller
    onReady(controller.stages)
    invalidate()
    return () => { controller.dispose(); player.current = null }
  }, [model, clips, onReady, invalidate])
  useEffect(() => { player.current?.reset(); invalidate() }, [resetId, invalidate])
  useEffect(() => { invalidate() }, [targets, playing, speed, invalidate])
  useFrame((_, delta) => {
    if (player.current?.update(delta, targets, playing, speed)) invalidate()
  })

  // Geometry/materials belong to the bounded loader cache, skeleton/pose to this instance.
  useEffect(() => () => {
    model.traverse((object) => {
      if ('isSkinnedMesh' in object && object.isSkinnedMesh && 'skeleton' in object) {
        (object.skeleton as { dispose(): void }).dispose()
      }
    })
  }, [model])
  return <primitive object={root} dispose={null} />
}
