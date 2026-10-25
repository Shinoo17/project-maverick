import { describe, expect, it } from 'vitest'
import { GameRuntime } from '../src/game/runtime/GameRuntime'
import { neutralCommand, type PilotCommand } from '../src/game/runtime/commands'
import { getWeapon, missileStations } from '../src/content/weapons'
import { getAircraft } from '../src/content/aircraft'
import { missileRules, motorBurning, type Missile, type MissileGuidance } from '../src/game/combat/missiles'
import { validateAircraft } from '../src/content/validate'
import { weaponStations } from '../src/content/weapons'
import { WORLD_STEP } from '../src/game/runtime/clock'
import type { GameEvent } from '../src/game/runtime/events'
import { flyMissile, type Course } from './missileFlight'

const ALT = 2000
const level = (x: number, vx: number, vz = 0): Course => ({ position: { x, y: ALT, z: 0 }, velocity: { x: vx, y: 0, z: vz } })
const shooter = level(0, 200)

/** Sideways acceleration (less gravity's share) between two velocities a tick apart, m/s². */
function sideways(last: Missile['velocity'], now: Missile['velocity']) {
  const ax = (now.x - last.x) / WORLD_STEP, ay = (now.y - last.y) / WORLD_STEP + 9.81, az = (now.z - last.z) / WORLD_STEP
  const speed = Math.hypot(now.x, now.y, now.z)
  const along = (ax * now.x + ay * now.y + az * now.z) / speed
  return Math.sqrt(Math.max(0, ax * ax + ay * ay + az * az - along * along))
}
const speedOf = (velocity: Missile['velocity']) => Math.hypot(velocity.x, velocity.y, velocity.z)

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
        if (last) worst = Math.max(worst, sideways(last, missile.velocity))
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

describe('missile separation and arming', () => {
  const ticksOf = (seconds: number) => Math.round(seconds / WORLD_STEP)
  it('drops out of a bay with the motor cold, then lights it; off a pylon it lights at once', () => {
    const seen: Record<string, { burning: boolean[]; below: number; speed: number }> = {}
    for (const mount of ['bay', 'pylon'] as const) {
      const row = seen[mount] = { burning: [] as boolean[], below: 0, speed: 0 }
      flyMissile('aim9', shooter, level(3000, 0), { mount, seconds: 0.4, onTick: (missile, [me], tick) => {
        row.burning.push(motorBurning(missile, getWeapon('aim9').missile!))
        if (tick === ticksOf(0.2) - 1) { row.below = me.position.y - missile.position.y; row.speed = speedOf(missile.velocity) }
      } })
    }
    const separation = ticksOf(missileRules.mounts.bay.separation)
    expect(seen.bay.burning.slice(0, separation - 1).some(Boolean)).toBe(false)
    expect(seen.bay.burning.at(-1)).toBe(true)
    expect(seen.bay.below).toBeGreaterThan(2.5)
    expect(seen.bay.speed).toBeLessThan(205)
    expect(seen.pylon.burning.every(Boolean)).toBe(true)
    expect(seen.pylon.speed).toBeGreaterThan(250)
  })
  it('does not steer while it separates, then builds its pull up gradually', () => {
    const pulls: number[] = []
    let last: Missile['velocity'] | null = null
    // 40° off the nose, inside the seeker's gimbal: guidance wants a hard turn from the start.
    flyMissile('aim9', shooter, { position: { x: 1500 * Math.cos(0.7), y: ALT, z: 1500 * Math.sin(0.7) }, velocity: { x: 0, y: 0, z: 0 } }, { seconds: 1, onTick: missile => {
      if (last) pulls.push(sideways(last, missile.velocity))
      last = { ...missile.velocity }
    } })
    const separation = ticksOf(missileRules.mounts.bay.separation)
    expect(Math.max(...pulls.slice(0, separation - 2))).toBeLessThan(0.5)
    const { maxG, rampSeconds } = getWeapon('aim9').missile!
    expect(pulls[separation + 2]).toBeLessThan(maxG * 9.81 * (3 / 60 / rampSeconds) + 15)
    expect(Math.max(...pulls)).toBeGreaterThan(20 * 9.81)
  })
  it('turns no faster than its turn rate when slow', () => {
    const { turnRateDeg } = getWeapon('aim9').missile!
    let last: Missile['velocity'] | null = null, worst = 0
    // Launched slow (100 m/s) at a target well off the nose.
    flyMissile('aim9', level(0, 100), { position: { x: 800, y: ALT, z: 600 }, velocity: { x: 0, y: 0, z: 0 } }, { seconds: 1.2, onTick: missile => {
      if (last) worst = Math.max(worst, sideways(last, missile.velocity) / (turnRateDeg * Math.PI / 180 * speedOf(missile.velocity)))
      last = { ...missile.velocity }
    } })
    expect(worst).toBeGreaterThan(0.5)
    expect(worst).toBeLessThanOrEqual(1.05)
  })
  it('bleeds more speed the harder it pulls', () => {
    // 40° off the nose: a hard turn onto the target first.
    const offside = { position: { x: 2500 * Math.cos(0.7), y: ALT, z: 2500 * Math.sin(0.7) }, velocity: { x: 0, y: 0, z: 0 } }
    const speed = (turnDrag: number) => speedOf(flyMissile('aim9', shooter, offside, { seconds: 2, profile: { turnDrag } }).missile.velocity)
    expect(speed(getWeapon('aim9').missile!.turnDrag)).toBeLessThan(speed(0) - 20)
  })
  it('is a dud inside its arming time, and kills just past it', () => {
    // Head-on, 400 m/s closing, a little below the launcher so the missile strikes the airframe.
    const close = flyMissile('aim9', shooter, { position: { x: 40, y: ALT - 1.2, z: 0.5 }, velocity: { x: -200, y: 0, z: 0 } })
    expect(close.burst).toMatchObject({ cause: 'dud', entityId: 'aircraft-2' })
    const far = flyMissile('aim9', shooter, { position: { x: 200, y: ALT - 1.2, z: 0.5 }, velocity: { x: -200, y: 0, z: 0 } })
    expect(far.burst?.cause).not.toBe('dud')
    expect(far.burst?.entityId).toBe('aircraft-2')
  })
  for (const weaponId of ['aim9', 'aim120']) {
    it(`${weaponId} out of a bay kills close in: dead ahead and tail chase at 150 and 300 m, 15° off the nose at 300 m`, () => {
      const ahead = (r: number, vx: number) => level(r, vx)
      const off = (r: number): Course => ({ position: { x: r * Math.cos(15 * Math.PI / 180), y: ALT, z: r * Math.sin(15 * Math.PI / 180) }, velocity: { x: 0, y: 0, z: 0 } })
      for (const target of [ahead(150, 0), ahead(300, 0), ahead(150, 200), ahead(300, 200), off(300)]) {
        const { burst } = flyMissile(weaponId, shooter, target)
        expect(burst?.cause).not.toBe('dud')
        expect(burst?.entityId).toBe('aircraft-2')
      }
    })
  }
  it('arms by distance from the launcher before its time when the launcher pulls away', () => {
    let armedAt = -1
    flyMissile('aim120', shooter, level(5000, 0), { mount: 'pylon', seconds: 0.3, onTick: (missile, [me], tick) => {
      // The launcher reverses at once: 100 m opens in well under the 0.25 s arming time.
      if (tick === 0) me.velocity = { x: -400, y: 0, z: 0 }
      if (missile.armed && armedAt < 0) armedAt = missile.age
    } })
    expect(armedAt).toBeGreaterThan(0)
    expect(armedAt).toBeLessThan(getWeapon('aim120').missile!.arm.seconds - 0.02)
  })
})

describe('missile seeker in flight', () => {
  const ticksOf = (seconds: number) => Math.round(seconds / WORLD_STEP)
  /** An IR shot at a still target 2 km ahead that leaves the seeker's view at 0.5 s for `away` seconds. */
  function breakaway(away: number) {
    const guidance: MissileGuidance[] = []
    const home = { x: 2000, y: ALT, z: 0 }, out = ticksOf(0.5), back = out + ticksOf(away)
    const result = flyMissile('aim9', shooter, level(2000, 0), { seconds: 3, onTick: (missile, [, them], tick) => {
      if (tick === out) them.position = { x: missile.position.x, y: ALT, z: missile.position.z + 1500 }
      if (tick === back) them.position = { ...home }
      guidance.push(missile.guidance)
    } })
    return { guidance, back, result }
  }
  it('takes an IR target back only after holding it in view, within its search time', () => {
    const { guidance, back } = breakaway(0.3)
    const { acquireSeconds } = getWeapon('aim9').missile!
    expect(guidance[back - 1]).toBe('lost')
    expect(guidance.slice(back, back + ticksOf(acquireSeconds) - 1).every(state => state === 'lost')).toBe(true)
    expect(guidance.slice(back + ticksOf(acquireSeconds) + 1).includes('active')).toBe(true)
  })
  it('gives an IR target up for good once it stays out of view past the search time', () => {
    const { guidance, back, result } = breakaway(getWeapon('aim9').missile!.searchSeconds + 0.2)
    expect(guidance.slice(back).every(state => state === 'lost')).toBe(true)
    expect(result.missile.seeker.gaveUp).toBe(true)
    expect(result.burst?.entityId ?? null).toBeNull()
  })
  it('finds nothing on memory when the target turned away from where it was heading', () => {
    const seen: MissileGuidance[] = []
    const { burst, missile } = flyMissile('aim120', shooter, level(6000, 0, 0), {
      onTick: (missile, [me, them], tick) => {
        // The launcher turns tail (memory), then the target slips 800 m sideways.
        if (tick === 60) me.velocity = { x: -200, y: 0, z: 0 }
        if (tick === 90) them.position = { ...them.position, z: 800 }
        if (seen.at(-1) !== missile.guidance) seen.push(missile.guidance)
      },
    })
    expect(seen).not.toContain('active')
    expect(seen.at(-1)).toBe('lost')
    expect(missile.seeker.gaveUp).toBe(true)
    expect(burst?.entityId ?? null).toBeNull()
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
  it('leaves from the station\'s hardpoints in turn, left then right', () => {
    const second = lockTicks + Math.ceil(missileRules.interval / WORLD_STEP) + 1
    const { world, events } = range(tick => tick === lockTicks || tick === second, second + 1)
    const points = weaponStations.f22.find(station => station.id === irStation)!.launch!.points
    expect(world.missiles.map(missile => [missile.hardpoint.x, missile.hardpoint.y, missile.hardpoint.z])).toEqual(points)
    expect(events.filter(event => event.type === 'missile-launched')).toMatchObject([{ stationId: irStation }, { stationId: irStation }])
  })
  it('requires every missile station to name its hardpoints', () => {
    const station = weaponStations.f22.find(entry => entry.id === irStation)!, launch = station.launch
    delete station.launch
    try { expect(() => validateAircraft([getAircraft('f22')])).toThrow('stations.launch') }
    finally { station.launch = launch }
  })
  it('gives the same flight at 30, 60 and 144 fps', () => {
    const at = (fps: number) => range(tick => tick === lockTicks, lockTicks + 120, 1 / fps).world.missiles
    const reference = at(60)
    expect(reference).toHaveLength(1)
    for (const fps of [30, 144]) expect(at(fps)).toEqual(reference)
  })
})
