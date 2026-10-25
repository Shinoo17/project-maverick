import { describe, expect, it } from 'vitest'
import { GameRuntime } from '../src/game/runtime/GameRuntime'
import { launchMissile, type Missile } from '../src/game/combat/missiles'
import { rwrPicture, rwrRules } from '../src/game/combat/rwr'
import { getWeapon, missileStations } from '../src/content/weapons'
import { getAircraft } from '../src/content/aircraft'
import type { AircraftState, Vec3 } from '../src/game/state/WorldState'

// Facing −X: a half turn about the vertical.
const AWAY = { x: 0, y: 1, z: 0, w: 0 }
/** The F-22 at the origin flying +X, and an Su-57 at `at` (on its height) facing it unless `facing` says otherwise. */
function scene(at: Vec3, facing = AWAY) {
  const world = new GameRuntime({ mode: 'playground', aircraftIds: ['f22', 'su57'] }).snapshot()
  const [me, them] = world.aircraft
  me.position = { x: 0, y: me.position.y, z: 0 }; me.velocity = { x: 220, y: 0, z: 0 }
  them.position = { x: at.x, y: me.position.y + at.y, z: at.z }; them.orientation = { ...facing }
  them.velocity = { x: facing === AWAY ? -220 : 220, y: 0, z: 0 }
  return { world, me, them }
}
const slotOf = (aircraftId: string, kind: 'ir' | 'radar') => missileStations(getAircraft(aircraftId)).findIndex(row => row.weapon.kind === kind)
/** `owner`'s missile of `kind` at `target`, placed at `position` flying `velocity`, `age` seconds into its flight. */
function missile(owner: AircraftState, target: AircraftState, kind: 'ir' | 'radar', position: Vec3, velocity: Vec3, age = 1, guidance?: Missile['guidance']): Missile {
  const weaponId = missileStations(getAircraft(owner.aircraftId))[slotOf(owner.aircraftId, kind)].weapon.id
  const fired = launchMissile(7, 0, owner, weaponId, target, { stationId: 'test', mount: 'pylon', point: [0, 0, 0] }, kind === 'radar')
  return { ...fired, position: { ...position }, velocity: { ...velocity }, age, guidance: guidance ?? fired.guidance }
}

describe('radar warning receiver', () => {
  it('warns of a radar that paints us, on its bearing, and of none that does not', () => {
    const { world, me } = scene({ x: 5000, y: 0, z: 0 })
    expect(rwrPicture(me, world)).toEqual([expect.objectContaining({ sourceId: 'aircraft-2', kind: 'aircraft', level: 'search', label: 'Su-57', maws: false })])
    expect(Math.abs(rwrPicture(me, world)[0].bearing)).toBeLessThan(1e-6)
    // Turned away: its radar looks the other way.
    const away = scene({ x: 5000, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 })
    expect(rwrPicture(away.me, away.world)).toEqual([])
    // Out past its radar's reach.
    const far = scene({ x: getAircraft('su57').radar.rangeM + 500, y: 0, z: 0 })
    expect(rwrPicture(far.me, far.world)).toEqual([])
  })

  it('gives bearing in our own frame: right is positive, behind is ±180, and never a range', () => {
    const right = scene({ x: 0, y: 0, z: 3000 }, { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 })
    const [threat] = rwrPicture(right.me, right.world)
    expect(threat.bearing).toBeCloseTo(90, 3)
    expect(threat).not.toHaveProperty('range')
    const behind = scene({ x: -3000, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 })
    expect(Math.abs(rwrPicture(behind.me, behind.world)[0].bearing)).toBeCloseTo(180, 3)
  })

  it('a radar lock with a radar missile selected is a lock; with an IR missile it stays a search', () => {
    const { world, me, them } = scene({ x: 4000, y: 0, z: 0 })
    them.targeting.targetId = me.id
    them.targeting.seeker.slot = slotOf('su57', 'radar')
    expect(rwrPicture(me, world)[0].level).toBe('lock')
    them.targeting.seeker.slot = slotOf('su57', 'ir')
    expect(rwrPicture(me, world)[0].level).toBe('search')
  })

  it('a radar missile on its datalink is a launch on the launcher; gone active, the missile itself', () => {
    const { world, me, them } = scene({ x: 6000, y: 0, z: 0 })
    world.missiles = [missile(them, me, 'radar', { x: 5000, y: me.position.y, z: 0 }, { x: -800, y: 0, z: 0 }, 6, 'datalink')]
    expect(rwrPicture(me, world)).toEqual([expect.objectContaining({ sourceId: 'aircraft-2', level: 'launch' })])
    world.missiles[0] = { ...world.missiles[0], guidance: 'active', position: { x: 2000, y: me.position.y, z: 1000 } }
    const [first, second] = rwrPicture(me, world)
    expect(first).toMatchObject({ sourceId: 'missile-7', kind: 'missile', level: 'missile', maws: false })
    expect(first.bearing).toBeCloseTo(Math.atan2(1000, 2000) * 180 / Math.PI, 3)
    expect(second).toMatchObject({ sourceId: 'aircraft-2', level: 'search' })
    // On memory, past its burn and outside MAWS reach: unseen.
    world.missiles[0] = { ...world.missiles[0], guidance: 'memory', position: { x: 4000, y: me.position.y, z: 0 } }
    expect(rwrPicture(me, world).map(threat => threat.sourceId)).toEqual(['aircraft-2'])
  })

  it('an IR missile shows only on MAWS: close, motor burning and closing', () => {
    // Behind us and turned away, so the Su-57's radar never paints us.
    const { world, me, them } = scene({ x: -4000, y: 0, z: 0 })
    const burning = getWeapon(missileStations(getAircraft('su57'))[slotOf('su57', 'ir')].weapon.id).missile!.burnSeconds / 2
    const ir = (x: number, vx: number, age = burning) => missile(them, me, 'ir', { x, y: me.position.y, z: 0 }, { x: vx, y: 0, z: 0 }, age)
    world.missiles = [ir(-2000, 600)]
    expect(rwrPicture(me, world)).toEqual([expect.objectContaining({ sourceId: 'missile-7', level: 'missile', maws: true })])
    for (const missiles of [[ir(-rwrRules.mawsRange - 200, 600)], [ir(-2000, 600, 10)], [ir(-2000, 100)]]) {
      world.missiles = missiles
      expect(rwrPicture(me, world)).toEqual([])
    }
    // Its own missiles never warn it.
    world.missiles = [missile(me, them, 'ir', { x: -1000, y: me.position.y, z: 0 }, { x: -600, y: 0, z: 0 }, burning)]
    expect(rwrPicture(me, world)).toEqual([])
  })
})
