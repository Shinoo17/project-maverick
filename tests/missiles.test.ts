import { describe, expect, it } from 'vitest'
import { GameRuntime } from '../src/game/runtime/GameRuntime'
import { neutralCommand, type PilotCommand } from '../src/game/runtime/commands'
import { getWeapon, missileStations } from '../src/content/weapons'
import { getAircraft } from '../src/content/aircraft'
import { missileRules, type MissileGuidance } from '../src/game/combat/missiles'
import { WORLD_STEP } from '../src/game/runtime/clock'
import type { GameEvent } from '../src/game/runtime/events'
import { flyMissile, type Course } from './missileFlight'

const ALT = 2000
const level = (x: number, vx: number, vz = 0): Course => ({ position: { x, y: ALT, z: 0 }, velocity: { x: vx, y: 0, z: vz } })
const shooter = level(0, 200)

describe('missile flight', () => {
  for (const weaponId of ['aim9', 'aim120', 'training-ir', 'training-radar']) {
    const { launchRangeM } = getWeapon(weaponId).missile!
    it(`${weaponId} reaches a target holding its course from its launch range, head-on, still, crossing and from behind`, () => {
      for (const target of [level(launchRangeM, -200), level(launchRangeM, 0), level(launchRangeM, 0, 200), level(launchRangeM, 200)]) {
        const { burst } = flyMissile(weaponId, shooter, target)
        expect(burst?.entityId).toBe('aircraft-2')
      }
    })
  }
  it('runs out of energy well past its launch range', () => {
    const { burst } = flyMissile('aim9', shooter, level(getWeapon('aim9').missile!.launchRangeM * 2.5, 0))
    expect(burst).toMatchObject({ cause: 'expired', entityId: null })
  })
  it('turns wider the faster it flies, never past its g limit', () => {
    let worst = 0
    const { maxG } = getWeapon('aim9').missile!
    let last: { x: number; y: number; z: number } | null = null
    flyMissile('aim9', shooter, { position: { x: 2000, y: ALT, z: 600 }, velocity: { x: 0, y: 0, z: 250 }, acceleration: { x: 0, y: 0, z: 0 } }, {
      onTick: missile => {
        if (last) {
          const ax = (missile.velocity.x - last.x) / WORLD_STEP, ay = (missile.velocity.y - last.y) / WORLD_STEP + 9.81, az = (missile.velocity.z - last.z) / WORLD_STEP
          const speed = Math.hypot(missile.velocity.x, missile.velocity.y, missile.velocity.z)
          const along = (ax * missile.velocity.x + ay * missile.velocity.y + az * missile.velocity.z) / speed
          worst = Math.max(worst, Math.sqrt(Math.max(0, ax * ax + ay * ay + az * az - along * along)))
        }
        last = { ...missile.velocity }
      },
    })
    expect(worst / 9.81).toBeLessThanOrEqual(maxG + 0.5)
  })
  it('loses a target outside its seeker\'s gimbal and flies on unsteered (IR)', () => {
    const guidance: MissileGuidance[] = []
    const { burst } = flyMissile('aim9', shooter, { position: { x: 0, y: ALT, z: 1500 }, velocity: { x: 0, y: 0, z: 0 } }, { onTick: missile => guidance.push(missile.guidance) })
    expect(guidance.slice(0, 30).every(state => state === 'lost')).toBe(true)
    expect(burst?.entityId ?? null).toBeNull()
  })
  it('flies a radar missile on the datalink, on memory once the launcher turns away, then active', () => {
    const seen: MissileGuidance[] = []
    const { burst } = flyMissile('aim120', shooter, level(6000, 0, 0), {
      onTick: (missile, [me], tick) => {
        // One second after launch the launcher turns tail: its radar no longer paints the target.
        if (tick === 60) me.velocity = { x: -200, y: 0, z: 0 }
        if (seen.at(-1) !== missile.guidance) seen.push(missile.guidance)
      },
    })
    expect(seen).toEqual(['datalink', 'memory', 'active'])
    expect(burst?.entityId).toBe('aircraft-2')
  })
})

/** The F-22 behind the still drone (1,300 m ahead), flying straight; `fire` presses launch on those ticks. */
function range(fire: (tick: number) => boolean, ticks: number, step = WORLD_STEP, extra?: (tick: number) => PilotCommand['actions']) {
  const runtime = new GameRuntime({ mode: 'playground', aircraftIds: ['f22'], targetDrone: 'still' })
  runtime.start()
  const events: GameEvent[] = []
  let id = 1
  const command = (tick: number, entityId: string): PilotCommand => ({ ...neutralCommand(tick, entityId),
    actions: [...(fire(tick) ? [{ id: id++, type: 'fire-missile' as const }] : []), ...(extra?.(tick) ?? [])] })
  for (let elapsed = 0; elapsed < ticks * WORLD_STEP - 1e-9; elapsed += step) { runtime.advance(step, command); events.push(...runtime.drainEvents()) }
  return { world: runtime.snapshot(), events }
}
const irStation = missileStations(getAircraft('f22'))[0].station.id
const lockTicks = Math.ceil(1.7 / WORLD_STEP)

describe('missile launch', () => {
  it('does nothing without a lock', () => {
    const { world, events } = range(tick => tick === 5, 30)
    expect(world.missiles).toEqual([])
    expect(events.some(event => event.type === 'missile-launched')).toBe(false)
    expect(world.aircraft[0].stores.find(store => store.stationId === irStation)!.count).toBe(2)
  })
  it('fires one missile per press once locked, takes it from the station and keeps the interval', () => {
    const { world, events } = range(tick => tick === lockTicks || tick === lockTicks + 1, lockTicks + 3)
    expect(events.filter(event => event.type === 'missile-launched')).toHaveLength(1)
    expect(world.missiles).toHaveLength(1)
    expect(world.missiles[0]).toMatchObject({ ownerId: 'aircraft-1', targetId: 'drone-1', weaponId: 'aim9' })
    expect(world.aircraft[0].stores.find(store => store.stationId === irStation)!.count).toBe(1)
  })
  it('shoots the drone down, and the kill is the launcher\'s', () => {
    const { events } = range(tick => tick === lockTicks, lockTicks + 400)
    expect(events.find(event => event.type === 'missile-detonated')).toMatchObject({ ownerId: 'aircraft-1', targetId: 'drone-1' })
    expect(events.find(event => event.type === 'aircraft-destroyed')).toMatchObject({ entityId: 'drone-1', sourceId: 'aircraft-1', cause: 'weapon' })
  })
  it('ends the lock quietly when the last missile on the station is fired', () => {
    const second = lockTicks + Math.ceil(missileRules.interval / WORLD_STEP) + 1
    const { world } = range(tick => tick === lockTicks || tick === second, second + 2)
    expect(world.aircraft[0].stores.find(store => store.stationId === irStation)!.count).toBe(0)
    expect(world.aircraft[0].targeting.seeker).toMatchObject({ locked: false, lost: null, progress: 0 })
  })
  it('gives the same flight at 30, 60 and 144 fps', () => {
    const at = (fps: number) => range(tick => tick === lockTicks, lockTicks + 120, 1 / fps).world.missiles
    const reference = at(60)
    expect(reference).toHaveLength(1)
    for (const fps of [30, 144]) expect(at(fps)).toEqual(reference)
  })
})
