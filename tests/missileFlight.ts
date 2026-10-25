// Test harness: one missile against one aircraft flying a set course, stepped like the runtime.
import { Quaternion, Vector3 } from 'three'
import { GameRuntime } from '../src/game/runtime/GameRuntime'
import { getWeapon } from '../src/content/weapons'
import { hitboxes } from '../src/content/hitboxes'
import { boundingRadius } from '../src/game/combat/collision'
import { launchMissile, stepMissile, type Missile, type MissileBurst } from '../src/game/combat/missiles'
import type { CombatBody } from '../src/game/combat/projectiles'
import type { AircraftState, Vec3 } from '../src/game/state/WorldState'
import { WORLD_STEP } from '../src/game/runtime/clock'

export interface Course {
  /** Metres and m/s. */
  position: Vec3
  velocity: Vec3
  /** m/s², constant; the velocity turns with it. */
  acceleration?: Vec3
}
const facing = (velocity: Vec3) => {
  const v = new Vector3(velocity.x, velocity.y, velocity.z)
  const q = v.lengthSq() < 1e-6 ? new Quaternion() : new Quaternion().setFromUnitVectors(new Vector3(1, 0, 0), v.normalize())
  return { x: q.x, y: q.y, z: q.z, w: q.w }
}
const body = (entity: AircraftState, from: CombatBody['from']): CombatBody => {
  const shapes = hitboxes[entity.aircraftId]
  return { id: entity.id, shapes, radius: boundingRadius(shapes), from, to: { position: { ...entity.position }, orientation: { ...entity.orientation }, velocity: { ...entity.velocity } } }
}
function move(entity: AircraftState, course: Course, dt: number) {
  const a = course.acceleration
  if (a) {
    // Turn the velocity without changing its speed: only the part square to it acts.
    const v = new Vector3(entity.velocity.x, entity.velocity.y, entity.velocity.z), speed = v.length()
    v.addScaledVector(new Vector3(a.x, a.y, a.z), dt).setLength(speed)
    entity.velocity = { x: v.x, y: v.y, z: v.z }
  }
  entity.position = { x: entity.position.x + entity.velocity.x * dt, y: entity.position.y + entity.velocity.y * dt, z: entity.position.z + entity.velocity.z * dt }
  entity.orientation = facing(entity.velocity)
}

/** Launches `weaponId` from an F-22 on `shooter`'s course at an Su-57 on `target`'s, and flies it out. */
export function flyMissile(weaponId: string, shooter: Course, target: Course, options: { seconds?: number; onTick?: (missile: Missile, aircraft: AircraftState[], tick: number) => void } = {}) {
  const world = new GameRuntime({ mode: 'playground', aircraftIds: ['f22', 'su57'] }).snapshot()
  const [me, them] = world.aircraft
  for (const [entity, course] of [[me, shooter], [them, target]] as const) {
    entity.position = { ...course.position }; entity.velocity = { ...course.velocity }; entity.orientation = facing(course.velocity)
  }
  const weapon = getWeapon(weaponId)
  const missile = launchMissile(1, 0, me, weaponId, them)
  let burst: MissileBurst | null = null, tick = 0
  const limit = Math.round((options.seconds ?? weapon.missile!.lifetime + 1) / WORLD_STEP)
  for (; tick < limit && !burst; tick++) {
    const before = [me, them].map(entity => ({ position: { ...entity.position }, orientation: { ...entity.orientation }, velocity: { ...entity.velocity } }))
    move(me, shooter, WORLD_STEP); move(them, target, WORLD_STEP)
    burst = stepMissile(missile, weapon.missile!, weapon.kind === 'radar', [me, them], [body(me, before[0]), body(them, before[1])], WORLD_STEP)
    options.onTick?.(missile, [me, them], tick)
  }
  return { burst, seconds: tick * WORLD_STEP, missile, shooter: me, target: them }
}
