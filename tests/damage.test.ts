import { describe, expect, it } from 'vitest'
import { Euler, Quaternion, Vector3 } from 'three'
import { aimAtDrone } from './aim'
import { GameRuntime } from '../src/game/runtime/GameRuntime'
import { neutralCommand } from '../src/game/runtime/commands'
import { runFlightReplay } from '../src/game/playground/replay'
import { AIRCRAFT_HP, applyHits } from '../src/game/combat/damage'
import type { ProjectileHit } from '../src/game/combat/projectiles'
import type { GameEvent } from '../src/game/runtime/events'
import { droneRespawnPose, targetDrone } from '../src/game/playground/practice'
import { WORLD_STEP } from '../src/game/runtime/clock'

/** Two live aircraft straight from a new session: aircraft-1 (F-22) and aircraft-2 (Su-57). */
const pair = () => new GameRuntime({ mode: 'playground', mapId: 'flat-range', aircraftIds: ['f22', 'su57'] }).snapshot().aircraft
const point = { x: 0, y: 0, z: 0 }
let nextId = 1
const hitOn = (targetId: string, ownerId: string, weaponId: string): ProjectileHit =>
  ({ tick: 0, projectileId: nextId++, ownerId, weaponId, hit: { kind: 'aircraft', entityId: targetId, t: 0.5, point } })

describe('damage batch', () => {
  it('takes the weapon damage per hit and ignores ground hits', () => {
    const aircraft = pair()
    const ground: ProjectileHit = { tick: 0, projectileId: 99, ownerId: 'aircraft-1', weaponId: 'm61a2', hit: { kind: 'ground', t: 0.5, point } }
    const applied = applyHits(aircraft, [hitOn('aircraft-2', 'aircraft-1', 'm61a2'), ground, hitOn('aircraft-2', 'aircraft-1', 'm61a2')])
    expect(applied).toEqual([
      { targetId: 'aircraft-2', sourceId: 'aircraft-1', amount: 2, killed: false },
      { targetId: 'aircraft-2', sourceId: 'aircraft-1', amount: 2, killed: false },
    ])
    expect(aircraft.map(entity => entity.hp)).toEqual([AIRCRAFT_HP, AIRCRAFT_HP - 4])
  })
  it('removes only the HP left, kills once, and ignores later hits in the batch', () => {
    const aircraft = pair()
    aircraft[1].hp = 1
    const applied = applyHits(aircraft, [hitOn('aircraft-2', 'aircraft-1', 'm61a2'), hitOn('aircraft-2', 'aircraft-1', 'm61a2')])
    expect(applied).toEqual([{ targetId: 'aircraft-2', sourceId: 'aircraft-1', amount: 1, killed: true }])
    expect(aircraft[1]).toMatchObject({ hp: 0, alive: false, stopReason: 'weapon' })
    expect(applyHits(aircraft, [hitOn('aircraft-2', 'aircraft-1', 'm61a2')])).toEqual([])
  })
  it('lets two aircraft shoot each other down in the same tick', () => {
    const aircraft = pair()
    aircraft[0].hp = aircraft[1].hp = 2
    const applied = applyHits(aircraft, [hitOn('aircraft-2', 'aircraft-1', 'm61a2'), hitOn('aircraft-1', 'aircraft-2', 'su57-cannon')])
    expect(applied.map(entry => entry.killed)).toEqual([true, true])
    expect(aircraft.map(entity => entity.alive)).toEqual([false, false])
  })
})

function shootDrone(fps: number, seconds = 8) {
  const runtime = new GameRuntime({ mode: 'playground', mapId: 'flat-range', aircraftIds: ['f22'], targetDrone: true })
  runtime.start()
  const events: GameEvent[] = []
  const aim = aimAtDrone(runtime)
  for (let frame = 0; frame < fps * seconds; frame++) { runtime.advance(1 / fps, aim); events.push(...runtime.drainEvents()) }
  return { runtime, world: runtime.snapshot(), events }
}

describe('damage and death in the runtime', () => {
  it('shoots the drone down: 50 hits of 2 HP, then one destroyed event naming the shooter', () => {
    const { world, events } = shootDrone(60)
    const damage = events.filter(event => event.type === 'damage-applied')
    expect(damage).toHaveLength(50)
    expect(damage.every(event => event.targetId === 'drone-1' && event.sourceId === 'aircraft-1')).toBe(true)
    expect(damage.reduce((sum, event) => sum + event.amount, 0)).toBe(AIRCRAFT_HP)
    const destroyed = events.filter(event => event.type === 'aircraft-destroyed')
    expect(destroyed).toEqual([expect.objectContaining({ entityId: 'drone-1', sourceId: 'aircraft-1', cause: 'weapon', tick: damage.at(-1)!.tick })])
    expect(world.aircraft[1]).toMatchObject({ hp: 0, alive: false, stopReason: 'weapon' })
    expect(world.aircraft[0]).toMatchObject({ hp: AIRCRAFT_HP, alive: true })
    expect(new Set(events.map(event => event.id)).size).toBe(events.length)
  })
  it('gives the same damage and events at 30, 60 and 144 fps, and a replay matches', () => {
    const reference = shootDrone(60)
    for (const fps of [30, 144]) {
      const other = shootDrone(fps)
      expect(other.events).toEqual(reference.events)
      expect(other.world.aircraft).toEqual(reference.world.aircraft)
    }
    expect(runFlightReplay(reference.runtime.exportReplay()).aircraft).toEqual(reference.world.aircraft)
  })
  it('restores HP and clears events on reset', () => {
    const { runtime } = shootDrone(60)
    runtime.advance(1 / 60)
    runtime.reset()
    expect(runtime.snapshot().aircraft.map(entity => [entity.hp, entity.alive])).toEqual([[AIRCRAFT_HP, true], [AIRCRAFT_HP, true]])
    expect(runtime.drainEvents()).toEqual([])
  })
  it.each([
    // Nose down for a second, then hold the dive.
    ['terrain', (tick: number) => tick < 120 ? -0.6 : 0],
    // Straight and level until the range ends.
    ['boundary', () => 0],
  ] as const)('reports a stop at the %s once, with no source', (cause, pitch) => {
    const runtime = new GameRuntime({ mode: 'playground', mapId: 'flat-range', aircraftIds: ['f22'] })
    runtime.start()
    const events: GameEvent[] = []
    for (let frame = 0; frame < 60 * 70; frame++) {
      runtime.advance(1 / 60, (tick, id) => ({ ...neutralCommand(tick, id), pitch: pitch(tick) }))
      events.push(...runtime.drainEvents())
    }
    expect(runtime.snapshot().aircraft[0]).toMatchObject({ alive: false, stopReason: cause, hp: AIRCRAFT_HP })
    expect(events).toEqual([expect.objectContaining({ type: 'aircraft-destroyed', entityId: 'aircraft-1', sourceId: null, cause })])
  })
})

describe('target drone respawn', () => {
  it('brings a fresh drone back ahead of the player after the wait, and it can be shot down again', () => {
    const { runtime, events } = shootDrone(60, 6.5)
    const killTick = events.find(event => event.type === 'aircraft-destroyed')!.tick
    const waitTicks = Math.round(targetDrone.respawnSeconds / WORLD_STEP)
    // Run to the tick just before the drone is due, and check it is still down.
    const idle = (tick: number, id: string) => neutralCommand(tick, id)
    while (runtime.snapshot().tick < killTick + waitTicks) runtime.advance(WORLD_STEP, idle)
    expect(runtime.snapshot().aircraft[1].alive).toBe(false)
    const [player] = runtime.snapshot().aircraft
    runtime.advance(WORLD_STEP, idle)
    const drone = runtime.snapshot().aircraft[1]
    expect(drone).toMatchObject({ id: 'drone-1', control: 'hold', hp: AIRCRAFT_HP, alive: true, velocity: { x: 0, y: 0, z: 0 } })
    expect(drone.stopReason).toBeUndefined()
    expect(drone.position).toEqual(droneRespawnPose(player).position)
    // A longer run: it goes down again under the same gun.
    const twice = shootDrone(60, 30).events.filter(event => event.type === 'aircraft-destroyed')
    expect(twice.length).toBeGreaterThanOrEqual(2)
    expect(twice.every(event => event.entityId === 'drone-1' && event.cause === 'weapon')).toBe(true)
  })
  it('appears ahead along the compass heading, level, facing the same way, and never near the ground', () => {
    const player = new GameRuntime({ mode: 'playground', mapId: 'flat-range', aircraftIds: ['f22'] }).snapshot().aircraft[0]
    // Heading 90° left of +X (toward -Z), nose 30° up.
    const q = new Quaternion().setFromEuler(new Euler(0, Math.PI / 2, Math.PI / 6, 'YZX'))
    player.orientation = { x: q.x, y: q.y, z: q.z, w: q.w }
    player.position = { x: 100, y: 50, z: 200 }
    const pose = droneRespawnPose(player)
    expect(pose.position.x).toBeCloseTo(100, 6)
    expect(pose.position.z).toBeCloseTo(200 - targetDrone.ahead, 6)
    expect(pose.position.y).toBe(targetDrone.minAltitude)
    const nose = new Vector3(1, 0, 0).applyQuaternion(new Quaternion(pose.orientation.x, pose.orientation.y, pose.orientation.z, pose.orientation.w))
    expect(nose.x).toBeCloseTo(0, 9); expect(nose.y).toBeCloseTo(0, 9); expect(nose.z).toBeCloseTo(-1, 9)
  })
})
