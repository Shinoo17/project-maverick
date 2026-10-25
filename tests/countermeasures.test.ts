import { describe, expect, it } from 'vitest'
import { GameRuntime } from '../src/game/runtime/GameRuntime'
import { neutralCommand, type PilotCommand } from '../src/game/runtime/commands'
import { WORLD_STEP } from '../src/game/runtime/clock'
import type { GameEvent } from '../src/game/runtime/events'
import { getAircraft, aircraft } from '../src/content/aircraft'
import { getWeapon } from '../src/content/weapons'
import { validateAircraft } from '../src/content/validate'
import { chaffReturn, countermeasureRules, flareHeat, releaseDecoys, startBurst, stepDecoy, type Decoy } from '../src/game/combat/countermeasures'
import { aircraftHeat, flarePull, launchMissile } from '../src/game/combat/missiles'
import type { AircraftState } from '../src/game/state/WorldState'
import { flyMissile, type Course } from './missileFlight'

/** The F-22 flying straight; `press` presses the countermeasure key on those ticks. Returns the
 * world after `ticks`, every event, and the decoys in the air at each tick. */
function fly(press: (tick: number) => boolean, ticks: number) {
  const runtime = new GameRuntime({ mode: 'playground', aircraftIds: ['f22'] })
  runtime.start()
  const events: GameEvent[] = [], seen: Decoy[][] = [], jet: AircraftState[] = []
  let id = 1
  const command = (tick: number, entityId: string): PilotCommand => ({ ...neutralCommand(tick, entityId),
    actions: press(tick) ? [{ id: id++, type: 'countermeasure' }] : [] })
  for (let tick = 0; tick < ticks; tick++) {
    runtime.advance(WORLD_STEP, command)
    events.push(...runtime.drainEvents())
    const world = runtime.snapshot()
    seen.push(world.decoys); jet.push(world.aircraft[0])
  }
  return { world: runtime.snapshot(), events, seen, jet }
}
const bursts = getAircraft('f22').countermeasures.bursts
const dispensed = (events: GameEvent[]) => events.filter(event => event.type === 'countermeasure-dispensed')
const flares = (decoys: Decoy[]) => decoys.filter(decoy => decoy.kind === 'flare')
const lastFlareTick = Math.round(countermeasureRules.burst.duration / WORLD_STEP)

describe('countermeasure bursts', () => {
  it('release 8 flares, 4 a side, spread over the burst, and the chaff at its start', () => {
    const { world, events, seen, jet } = fly(tick => tick === 0, lastFlareTick + 2)
    expect(dispensed(events)).toEqual([expect.objectContaining({ entityId: 'aircraft-1', bursts: bursts - 1 })])
    expect(world.aircraft[0].countermeasures.bursts).toBe(bursts - 1)
    // Never all at once: one flare on the press, the last one at the end of the burst.
    expect(flares(seen[0])).toHaveLength(1)
    expect(seen[0].filter(decoy => decoy.kind === 'chaff')).toHaveLength(countermeasureRules.burst.chaff)
    expect(flares(seen[lastFlareTick - 1]).length).toBe(countermeasureRules.burst.flares - 1)
    expect(flares(seen[lastFlareTick])).toHaveLength(countermeasureRules.burst.flares)
    const all = flares(seen[lastFlareTick])
    // Four each side of the jet (body z is world z here: it flies level along +X).
    const z = world.aircraft[0].position.z
    expect(all.filter(decoy => decoy.position.z < z)).toHaveLength(4)
    expect(all.filter(decoy => decoy.position.z > z)).toHaveLength(4)
    expect(new Set(seen.at(-1)!.map(decoy => decoy.id)).size).toBe(seen.at(-1)!.length)
    // Each falls away behind and below the jet that dropped it.
    const first = seen.at(-1)!.find(decoy => decoy.id === all[0].id)!, me = jet.at(-1)!
    expect(first.position.x).toBeLessThan(me.position.x - 3)
    expect(first.position.y).toBeLessThan(me.position.y)
  })

  it('keep their own physics: no two alike, and no two bursts the same', () => {
    const gap = lastFlareTick + Math.round(countermeasureRules.cooldown / WORLD_STEP)
    const { seen, jet } = fly(tick => tick === 0 || tick === gap, gap + lastFlareTick + 30)
    const pick = (tick: number, start: number) => flares(seen[tick]).filter(decoy => decoy.spawnTick >= start)
    // 30 ticks after each burst's first flare: where its flares are, from the jet.
    const shape = (tick: number, start: number) => pick(tick, start).slice(0, 4).map(decoy => [decoy.position.x - jet[tick].position.x, decoy.position.y - jet[tick].position.y, decoy.position.z - jet[tick].position.z])
    const one = shape(30, 0), two = shape(gap + 30, gap)
    expect(one).toHaveLength(4); expect(two).toHaveLength(4)
    expect(one.some((point, index) => Math.hypot(point[0] - two[index][0], point[1] - two[index][1], point[2] - two[index][2]) > 3)).toBe(true)
    const lives = flares(seen[lastFlareTick]).map(decoy => decoy.life)
    expect(new Set(lives).size).toBe(lives.length)
    for (const life of lives) expect(Math.abs(life - countermeasureRules.kinds.flare.life)).toBeLessThanOrEqual(countermeasureRules.kinds.flare.life * countermeasureRules.spread + 1e-9)
  })

  it('wait out the cooldown after a burst ends, and run out after five', () => {
    const ready = lastFlareTick + Math.round(countermeasureRules.cooldown / WORLD_STEP)
    expect(dispensed(fly(tick => tick === 0 || tick === ready - 1, ready + 5).events)).toHaveLength(1)
    expect(dispensed(fly(tick => tick === 0 || tick === ready, ready + 5).events)).toHaveLength(2)
    const held = fly(() => true, ready * (bursts + 2))
    expect(dispensed(held.events).map(event => event.type === 'countermeasure-dispensed' && event.bursts)).toEqual(Array.from({ length: bursts }, (_, i) => bursts - 1 - i))
    expect(held.world.aircraft[0].countermeasures.bursts).toBe(0)
  })

  it('a flare slows and falls, lights, then dims on its own life; chaff hangs in the air', () => {
    const decoy = (kind: Decoy['kind'], life: number): Decoy => ({ id: 1, kind, ownerId: 'a', spawnTick: 0, age: 0, life, drag: countermeasureRules.kinds[kind].drag,
      position: { x: 0, y: 2000, z: 0 }, velocity: { x: 250, y: 0, z: 0 } })
    const flare = decoy('flare', 2.5), chaff = decoy('chaff', 3)
    const heat: number[] = []
    for (let t = 0; t < 1 - 1e-9; t += WORLD_STEP) { stepDecoy(flare, WORLD_STEP); stepDecoy(chaff, WORLD_STEP); heat.push(flareHeat(flare)) }
    expect(flare.velocity.x).toBeGreaterThan(80)
    expect(flare.velocity.x).toBeLessThan(170)
    expect(flare.velocity.y).toBeLessThan(-5)
    expect(Math.hypot(chaff.velocity.x, chaff.velocity.y, chaff.velocity.z)).toBeLessThan(25)
    expect(heat[0]).toBeLessThan(1)
    expect(heat[10]).toBe(1)
    while (stepDecoy(flare, WORLD_STEP)) heat.push(flareHeat(flare))
    // Dims steadily to nothing by the end of its life.
    const tail = heat.slice(Math.ceil(2.5 * countermeasureRules.flareFull / WORLD_STEP) + 1)
    expect(tail.every((value, index) => index === 0 || value < tail[index - 1])).toBe(true)
    expect(tail.at(-1)!).toBeLessThan(0.02)
    expect(heat.length * WORLD_STEP).toBeCloseTo(2.5, 1)
    expect(flareHeat(chaff)).toBe(0)
  })

  it('are validated per aircraft', () => {
    expect(() => validateAircraft([{ ...aircraft[0], countermeasures: { bursts: 1.5, points: [[0, 0, 0]] } }])).toThrow('countermeasures.bursts')
    expect(() => validateAircraft([{ ...aircraft[0], countermeasures: { bursts: 5, points: [] } }])).toThrow('countermeasures.points')
  })
})

const ALT = 2000
/** An AIM-9 (or `weaponId`) fired from `range` metres behind an Su-57 at `power`, which pulls `g`
 * sideways from launch and drops a burst on `burstTick` (none if null). */
function chase({ range = 1200, g = 0, power = 1, burstTick = null as number | null, weaponId = 'aim9' }) {
  let nextId = 1000, decoyedAt: number | null = null, backAt: number | null = null
  const target: Course = { position: { x: range, y: ALT, z: 0 }, velocity: { x: 220, y: 0, z: 0 }, acceleration: { x: 0, y: 0, z: g * 9.81 } }
  const result = flyMissile(weaponId, { position: { x: 0, y: ALT, z: 0 }, velocity: { x: 220, y: 0, z: 0 } }, target, {
    prepare: (_, them) => { them.enginePower = power },
    onTick: (missile, [, them], tick, decoys) => {
      if (tick === burstTick) startBurst(them.countermeasures, tick, WORLD_STEP)
      decoys.push(...releaseDecoys(them, tick, WORLD_STEP, () => nextId++))
      if (decoyedAt === null && missile.seeker.decoyId !== null) decoyedAt = tick
      if (decoyedAt !== null && backAt === null && missile.seeker.tracking && missile.seeker.decoyId === null) backAt = tick
    },
  })
  return { ...result, decoyedAt, backAt, kill: result.burst?.entityId === result.target.id }
}

describe('flares against IR seekers', () => {
  it('a seeker sees an aircraft hotter from behind and in burner', () => {
    const world = new GameRuntime({ mode: 'playground', aircraftIds: ['su57'] }).snapshot()
    const jet = world.aircraft[0]
    jet.enginePower = 1
    const behind = aircraftHeat(jet, { x: jet.position.x - 1000, y: jet.position.y, z: jet.position.z })
    const ahead = aircraftHeat(jet, { x: jet.position.x + 1000, y: jet.position.y, z: jet.position.z })
    expect(behind).toBeGreaterThan(ahead * 2)
    jet.enginePower = 1.6
    expect(aircraftHeat(jet, { x: jet.position.x - 1000, y: jet.position.y, z: jet.position.z })).toBeGreaterThan(behind * 1.4)
  })

  it('a flare pulls each missile by a share fixed for the pair, never rerolled', () => {
    const world = new GameRuntime({ mode: 'playground', aircraftIds: ['f22', 'su57'] }).snapshot()
    const [me, them] = world.aircraft
    const profile = getWeapon('aim9').missile!
    const missiles = [1, 2, 3].map(id => launchMissile(id, 0, me, 'aim9', them, { stationId: 'test', mount: 'bay', point: [0, 0, 0] }, false))
    const flare: Decoy = { id: 77, kind: 'flare', ownerId: them.id, spawnTick: 0, age: 0.5, life: 2.5, drag: 0.004, position: { ...them.position }, velocity: { ...them.velocity } }
    const pulls = missiles.map(missile => flarePull(missile, profile, flare))
    expect(missiles.map(missile => flarePull(missile, profile, flare))).toEqual(pulls)
    expect(new Set(pulls).size).toBe(3)
  })

  // Provisional balance, measured 2026-10-25: a break turn alone never beats the AIM-9 from 800–1,200 m,
  // and flares alone do not either; flares in a break turn at military power do.
  it('flares in a break turn decoy an AIM-9 that the turn alone does not shake', () => {
    expect(chase({ g: 5 }).kill).toBe(true)
    const flared = chase({ g: 5, burstTick: 20 })
    expect(flared.decoyedAt).not.toBeNull()
    expect(flared.kill).toBe(false)
    // The same flares do the same every run.
    const again = chase({ g: 5, burstTick: 20 })
    expect([again.decoyedAt, again.kill, again.seconds]).toEqual([flared.decoyedAt, flared.kill, flared.seconds])
  })

  it('a target still in view when the flares dim is taken back: flying straight, or flares dropped too far out', () => {
    for (const setup of [{ burstTick: 20 }, { range: 2000, g: 5, burstTick: 20 }]) {
      const result = chase(setup)
      expect(result.decoyedAt).not.toBeNull()
      expect(result.backAt).toBeGreaterThan(result.decoyedAt!)
      expect(result.kill).toBe(true)
    }
  })

  it('a target in afterburner outshines the flares', () => {
    const burner = chase({ g: 5, power: 1.6, burstTick: 20 })
    expect(burner.decoyedAt).toBeNull()
    expect(burner.kill).toBe(true)
  })

  it('a radar missile ignores flares (and chaff off the beam)', () => {
    const radar = chase({ g: 5, burstTick: 20, weaponId: 'aim120' })
    expect(radar.decoyedAt).toBeNull()
  })
})

/** An AIM-120 fired at an Su-57 `range` metres ahead flying `velocity`; it drops a burst on `burstTick` (none if null). */
function radarShot(range: number, velocity: { x: number; y: number; z: number }, burstTick: number | null) {
  let nextId = 1000, decoyedAt: number | null = null, activeAt: number | null = null
  const result = flyMissile('aim120', { position: { x: 0, y: ALT, z: 0 }, velocity: { x: 220, y: 0, z: 0 } }, { position: { x: range, y: ALT, z: 0 }, velocity }, {
    onTick: (missile, [, them], tick, decoys) => {
      if (activeAt === null && missile.guidance === 'active') activeAt = tick
      if (tick === burstTick) startBurst(them.countermeasures, tick, WORLD_STEP)
      decoys.push(...releaseDecoys(them, tick, WORLD_STEP, () => nextId++))
      if (decoyedAt === null && missile.seeker.decoyId !== null) decoyedAt = tick
    },
  })
  return { ...result, decoyedAt, activeAt, kill: result.burst?.entityId === result.target.id }
}
const beam = { x: 0, y: 0, z: 220 }, away = { x: 220, y: 0, z: 0 }, head = { x: -220, y: 0, z: 0 }

describe('chaff against radar seekers', () => {
  it('a chaff cloud blooms, holds, then thins; a flare returns nothing', () => {
    const cloud: Decoy = { id: 1, kind: 'chaff', ownerId: 'a', spawnTick: 0, age: 0, life: 3, drag: 0.05, position: { x: 0, y: 2000, z: 0 }, velocity: { x: 0, y: 0, z: 0 } }
    expect(chaffReturn(cloud)).toBe(0)
    expect(chaffReturn({ ...cloud, age: countermeasureRules.chaffBloom / 2 })).toBeCloseTo(0.5)
    expect(chaffReturn({ ...cloud, age: 1 })).toBe(1)
    expect(chaffReturn({ ...cloud, age: 2.7 })).toBeLessThan(0.3)
    expect(chaffReturn({ ...cloud, kind: 'flare', age: 1 })).toBe(0)
  })

  // Provisional balance, measured 2026-10-25 (AIM-120 at 2.5 km, seeker active from launch).
  it('chaff dropped while beaming an active AIM-120 decoys it', () => {
    expect(radarShot(2500, beam, null).kill).toBe(true)
    const shot = radarShot(2500, beam, 30)
    expect(shot.activeAt).toBeLessThan(30)
    expect(shot.decoyedAt).not.toBeNull()
    expect(shot.kill).toBe(false)
  })

  it('chaff does nothing to a seeker that can tell the target by its Doppler: running away or coming head on', () => {
    for (const velocity of [away, head]) {
      const shot = radarShot(2500, velocity, 30)
      expect(shot.decoyedAt).toBeNull()
      expect(shot.kill).toBe(true)
    }
  })

  it('chaff dropped well before the missile goes active is wasted: the target has flown on from it', () => {
    const shot = radarShot(4000, beam, 30)
    expect(shot.activeAt).toBeGreaterThan(30 + 2 / WORLD_STEP)
    expect(shot.decoyedAt).toBeNull()
    expect(shot.kill).toBe(true)
  })

  it('an IR missile ignores chaff', () => {
    const world = new GameRuntime({ mode: 'playground', aircraftIds: ['f22', 'su57'] }).snapshot()
    const [me, them] = world.aircraft
    const missile = launchMissile(1, 0, me, 'aim9', them, { stationId: 'test', mount: 'bay', point: [0, 0, 0] }, false)
    const chaff: Decoy = { id: 5, kind: 'chaff', ownerId: them.id, spawnTick: 0, age: 1, life: 3, drag: 0.05, position: { ...them.position }, velocity: { x: 0, y: 0, z: 0 } }
    expect(flarePull(missile, getWeapon('aim9').missile!, chaff)).toBe(0)
  })
})
