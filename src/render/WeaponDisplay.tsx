import { Suspense, useEffect, useMemo } from 'react'
import { Box3, Group, Mesh, Vector3 } from 'three'
import { clone } from 'three/addons/utils/SkeletonUtils.js'
import { useThree } from '@react-three/fiber'
import { type WeaponDefinition, type WeaponModelStatus, weaponModelUrl } from '../content/weapons'
import { SceneBoundary } from '../ui/components/SceneBoundary'
import { useAircraftAsset } from './aircraft/assetLoader'

/** fan: crossed in depth (studio). stack: one above another, all in side view (menu Armament). */
export type WeaponLayout = 'fan' | 'stack'
/** Vertical gap between stacked weapons, in scene units. */
const STACK_GAP = 1.7

function WeaponModel({ weapon, index, count, layout, onStatus }: {
  weapon: WeaponDefinition; index: number; count: number; layout: WeaponLayout; onStatus: (id: string, status: WeaponModelStatus) => void
}) {
  const asset = useAircraftAsset(weaponModelUrl(weapon)!)
  const invalidate = useThree(state => state.invalidate)
  const model = useMemo(() => {
    const copy = clone(asset.scene)
    const orientation = new Group(); orientation.rotation.set(...weapon.model!.rotation); orientation.add(copy)
    const bounds = new Box3().setFromObject(orientation), size = bounds.getSize(new Vector3())
    const root = new Group(); root.add(orientation)
    root.scale.setScalar((weapon.model!.length / 3.66 * 8) / Math.max(size.x, size.y, size.z))
    orientation.position.copy(bounds.getCenter(new Vector3())).negate()
    copy.traverse(child => { if (child instanceof Mesh) { child.castShadow = true; child.receiveShadow = true } })
    return root
  }, [asset, weapon])
  useEffect(() => { onStatus(weapon.id, 'ready'); invalidate() }, [weapon.id, onStatus, invalidate])
  useEffect(() => () => model.traverse(object => {
    if ('isSkinnedMesh' in object && object.isSkinnedMesh && 'skeleton' in object) (object.skeleton as { dispose(): void }).dispose()
  }), [model])
  if (layout === 'stack') {
    const offset = ((count - 1) / 2 - index) * STACK_GAP
    return <group position={[0, 0.35 + offset, 0]}><primitive object={model} dispose={null} /></group>
  }
  const spread = count > 1 ? index / (count - 1) * 2 - 1 : 0
  return <group rotation={[0, 0, spread * Math.PI / 7.5]} position={[0, .35, spread * .6]}><primitive object={model} dispose={null} /></group>
}
export function WeaponDisplay({ weapons, statuses, onStatus, retryId, layout = 'fan' }: {
  weapons: WeaponDefinition[]; statuses: Record<string, WeaponModelStatus>; onStatus: (id: string, status: WeaponModelStatus) => void; retryId: number; layout?: WeaponLayout
}) {
  // Each asset has its own suspense/error boundary: one failed file must never
  // hide a successfully loaded weapon, and selection unmounts every other model.
  const { invalidate } = useThree()
  useEffect(() => { invalidate() }, [weapons, statuses, invalidate])
  // Room environment brightness for metallic missile skins is owned by the
  // scene's Lighting, so it stays consistent with the studio-lights toggle.
  const models = weapons.filter(weapon => weapon.model && statuses[weapon.id] !== 'missing')
  return <>
    {/* Soft camera-side fill and top light so the near flank is never in shadow. */}
    <hemisphereLight args={['#dfe9f2', '#1a1d22', 0.9]} />
    <directionalLight position={[10, 6, -12]} intensity={1.6} />
    {models.map((weapon, index) => <SceneBoundary key={`${weapon.id}-${retryId}`} fallback={null} onError={() => onStatus(weapon.id, 'missing')}>
      <Suspense fallback={null}><WeaponModel weapon={weapon} index={index} count={models.length} layout={layout} onStatus={onStatus} /></Suspense>
    </SceneBoundary>)}
  </>
}
