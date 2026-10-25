/*
Missiles in flight, drawn from the simulation's `missiles` (game/combat/missiles.ts) between the
last two ticks, like the drone. A fixed pool of MISSILE_SLOTS, each holding one model per seeker
kind (training rounds have no model of their own and borrow the AIM-9 or AIM-120 by kind); slots
past the missiles in the air are hidden. A missile born on the last tick has no earlier pose, so
it is drawn where it is.

Each model is scaled to its real length and then, like other aircraft, drawn larger with distance
(targetVisibility.ts), so a missile stays visible a few hundred metres out. Nose along +X.
*/
import { useEffect, useMemo, type RefObject } from 'react'
import { Box3, Group, Quaternion, Vector3 } from 'three'
import { clone } from 'three/addons/utils/SkeletonUtils.js'
import { getWeapon, weaponModelUrl, type WeaponDefinition } from '../content/weapons'
import type { WorldState } from '../game/state/WorldState'
import { useAircraftAsset } from './aircraft/assetLoader'
import { distanceScale } from './targetVisibility'

export const MISSILE_SLOTS = 8
const MODELS = { ir: getWeapon('aim9'), radar: getWeapon('aim120') } as const

function fitted(scene: Group, weapon: WeaponDefinition) {
  const copy = clone(scene)
  const turned = new Group(); turned.rotation.set(...weapon.model!.rotation); turned.add(copy)
  const bounds = new Box3().setFromObject(turned), size = bounds.getSize(new Vector3())
  turned.position.copy(bounds.getCenter(new Vector3())).negate()
  const root = new Group(); root.add(turned)
  root.scale.setScalar(weapon.model!.length / Math.max(size.x, size.y, size.z))
  return root
}

export type MissilePool = { group: Group; models: Record<'ir' | 'radar', Group> }[]

export function MissileModels({ pool }: { pool: RefObject<MissilePool | null> }) {
  const ir = useAircraftAsset(weaponModelUrl(MODELS.ir)!), radar = useAircraftAsset(weaponModelUrl(MODELS.radar)!)
  const slots = useMemo<MissilePool>(() => Array.from({ length: MISSILE_SLOTS }, () => {
    const models = { ir: fitted(ir.scene, MODELS.ir), radar: fitted(radar.scene, MODELS.radar) }
    const group = new Group(); group.add(models.ir, models.radar); group.visible = false
    return { group, models }
  }), [ir, radar])
  useEffect(() => { pool.current = slots; return () => { pool.current = null } }, [pool, slots])
  return <>{slots.map((slot, index) => <primitive key={index} object={slot.group} dispose={null} />)}</>
}

const from = new Vector3(), to = new Vector3(), nose = new Vector3(), forward = new Vector3(1, 0, 0), turn = new Quaternion()
/** Places the pool on the missiles in flight, `alpha` of the way from `before` to `now`. */
export function placeMissiles(pool: MissilePool | null, before: WorldState | null, now: WorldState | null, alpha: number, eye: Vector3) {
  if (!pool) return
  const missiles = now?.missiles ?? []
  pool.forEach((slot, index) => {
    const missile = missiles[index]
    slot.group.visible = !!missile
    if (!missile) return
    const last = before?.missiles.find(entry => entry.id === missile.id) ?? missile
    from.set(last.position.x, last.position.y, last.position.z)
    to.set(missile.position.x, missile.position.y, missile.position.z)
    slot.group.position.copy(from).lerp(to, alpha)
    nose.set(last.velocity.x, last.velocity.y, last.velocity.z).lerp(to.set(missile.velocity.x, missile.velocity.y, missile.velocity.z), alpha)
    if (nose.lengthSq() > 1e-6) slot.group.quaternion.copy(turn.setFromUnitVectors(forward, nose.normalize()))
    slot.group.scale.setScalar(distanceScale(eye.distanceTo(slot.group.position)))
    const kind = getWeapon(missile.weaponId).kind === 'radar' ? 'radar' : 'ir'
    slot.models.ir.visible = kind === 'ir'; slot.models.radar.visible = kind === 'radar'
  })
}
