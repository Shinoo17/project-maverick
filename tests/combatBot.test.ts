import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { GameRuntime } from '../src/game/runtime/GameRuntime'
import { neutralCommand, type PilotCommand } from '../src/game/runtime/commands'
import { runFlightReplay } from '../src/game/playground/replay'
import { botSpawnPose, combatBot } from '../src/game/playground/practice'
import { botCommand, createBotState, createBotSteering } from '../src/game/bot/botPilot'
import { createMouseAim, instruct, MOUSE_AIM, stepAim } from '../src/game/input/mouseAim'
import type { GameEvent } from '../src/game/runtime/events'
import type { AircraftState, WorldState } from '../src/game/state/WorldState'

type Pilot = (world: WorldState, tick: number, id: string) => PilotCommand
const straight: Pilot = (_, tick, id) => neutralCommand(tick, id)
/** A level turn flown by the mouse-aim instructor: the aim held `deg` off the flight path, flipped every `flip` seconds (0 never). */
function turning(deg: number, flip = 0): Pilot {
  const aim = createMouseAim()
  return (world, tick, id) => {
    const p = world.aircraft[0]
    const side = flip && Math.floor(tick / 60 / flip) % 2 ? -1 : 1
    const yaw = Math.atan2(p.velocity.z, p.velocity.x) + side * deg * Math.PI / 180
    const climb = Math.max(-0.2, Math.min(0.2, (600 - p.position.y) / 500))
    aim.direction.copy(new Vector3(Math.cos(yaw), climb, Math.sin(yaw)).normalize())
    stepAim(aim, p, tick, false, true)
    return { ...neutralCommand(tick, id), ...instruct(aim, p) }
  }
}
/** The player's aircraft flown by a second bot. */
function asBot(seed: number): Pilot {
  const bot = createBotState(seed), steering = createBotSteering()
  return (world, tick) => botCommand(bot, steering, world.aircraft[0], world.aircraft, tick, 0)
}

/** Flies `seconds` against the combat bot, watching the bot every tick. */
function fight(seconds: number, pilot: Pilot, aircraftId = 'f22') {
  const runtime = new GameRuntime({ mode: 'playground', mapId: 'flat-range', aircraftIds: [aircraftId], targetDrone: 'bot' })
  runtime.start()
  const events: GameEvent[] = []
  const watch = { maxAlpha: 0, minAltitude: Infinity, maxRadius: 0, lockouts: 0, tactics: new Set<string>() }
  for (let tick = 0; tick < seconds * 60; tick++) {
    const world = runtime.snapshot()
    runtime.advance(1 / 60, (t, id) => pilot(world, t, id))
    events.push(...runtime.drainEvents())
    const bot = runtime.snapshot().aircraft.find(entity => entity.id === 'drone-1')
    if (!bot?.alive) continue
    watch.maxAlpha = Math.max(watch.maxAlpha, bot.maneuver.alpha)
    watch.minAltitude = Math.min(watch.minAltitude, bot.position.y)
    watch.maxRadius = Math.max(watch.maxRadius, Math.hypot(bot.position.x, bot.position.z))
    if (bot.gun.cooling || bot.gun.overheated) watch.lockouts++
    watch.tactics.add(bot.bot!.tactic)
  }
  const deaths = events.filter((event): event is Extract<GameEvent, { type: 'aircraft-destroyed' }> => event.type === 'aircraft-destroyed')
  const hitsOn = (id: string) => events.filter(event => event.type === 'damage-applied' && event.targetId === id).length
  return { runtime, world: runtime.snapshot(), deaths, hitsOn, watch }
}
/** Incidence where post-stall begins (the instructor starts handing over): the bot never goes there. */
const postStall = MOUSE_AIM.handoverDeg[0]
const pose = (entity: AircraftState) => ({ position: entity.position, orientation: entity.orientation, velocity: entity.velocity, hp: entity.hp, alive: entity.alive })

describe('combat bot', () => {
  it('starts as a merge: 3 km ahead, flying straight at the player', () => {
    const world = new GameRuntime({ mode: 'playground', mapId: 'flat-range', aircraftIds: ['f22'], targetDrone: 'bot' }).snapshot()
    const [player, bot] = world.aircraft
    expect(bot).toMatchObject({ id: 'drone-1', control: 'bot', aircraftId: 'su57' })
    expect(bot.position.x - player.position.x).toBeCloseTo(3000)
    expect(bot.velocity.x).toBeCloseTo(-combatBot.speed)
  })

  it('comes from the range centre side when the player is near the edge, and in any preset flies at its own speed', () => {
    const runtime = new GameRuntime({ mode: 'playground', mapId: 'flat-range', aircraftIds: ['f22'], targetDrone: 'bot' })
    runtime.reset('recovery'); runtime.start()
    const bot = runtime.snapshot().aircraft[1]
    expect(Math.hypot(bot.velocity.x, bot.velocity.y, bot.velocity.z)).toBeCloseTo(combatBot.speed)
    // Player at 6.5 km flying outward: 3 km ahead of it would be past the range edge.
    const player = { ...runtime.snapshot().aircraft[0], position: { x: 6500, y: 400, z: 0 } }
    const spawn = botSpawnPose(player)
    expect(Math.hypot(spawn.position.x, spawn.position.z)).toBeLessThanOrEqual(combatBot.maxRadius)
    expect(spawn.position.x).toBeCloseTo(3500)
    expect(spawn.heading.x).toBeCloseTo(1)
    expect(botSpawnPose({ ...player, position: { x: 0, y: 7900, z: 0 } }).position.y).toBe(combatBot.maxAltitude)
  })

  it('shoots down a player flying straight, in bursts that never take the heat lockout', () => {
    const { deaths, watch } = fight(60, straight)
    expect(deaths[0]).toMatchObject({ entityId: 'aircraft-1', sourceId: 'drone-1', cause: 'weapon' })
    expect(watch.lockouts).toBe(0)
  })

  it('lands rounds on a player in a sustained level turn, and kills one that reverses its turn', () => {
    expect(fight(90, turning(40)).hitsOn('aircraft-1')).toBeGreaterThan(5)
    expect(fight(60, turning(60, 6)).deaths.some(death => death.entityId === 'aircraft-1')).toBe(true)
  })

  it('keeps clear of the ground, the range edge and post-stall for six minutes, patrolling once alone', () => {
    const { deaths, watch } = fight(360, straight)
    expect(deaths.filter(death => death.entityId === 'drone-1')).toEqual([])
    expect(watch.minAltitude).toBeGreaterThan(300)
    expect(watch.maxRadius).toBeLessThan(7000)
    expect(watch.maxAlpha).toBeLessThan(postStall)
    expect(watch.tactics.has('patrol')).toBe(true)
  }, 60000)

  it('fights a copy of itself without crashing: it can kill and be killed, and it breaks when chased', () => {
    const { deaths, watch } = fight(80, asBot(4))
    expect(deaths.filter(death => death.cause !== 'weapon')).toEqual([])
    expect(deaths).toContainEqual(expect.objectContaining({ entityId: 'drone-1', sourceId: 'aircraft-1' }))
    expect(deaths).toContainEqual(expect.objectContaining({ entityId: 'aircraft-1', sourceId: 'drone-1' }))
    expect(watch.tactics.has('evade')).toBe(true)
    expect(watch.maxAlpha).toBeLessThan(postStall)
  })

  it('is the same at any frame rate and comes back the same from a replay', () => {
    const at = (fps: number) => {
      const runtime = new GameRuntime({ mode: 'playground', mapId: 'flat-range', aircraftIds: ['f22'], targetDrone: 'bot' })
      runtime.start()
      while (runtime.snapshot().tick < 45 * 60) runtime.advance(1 / fps, neutralCommand)
      return runtime
    }
    const reference = at(60), world = reference.snapshot()
    for (const fps of [30, 144]) expect(at(fps).snapshot().aircraft.map(pose)).toEqual(world.aircraft.map(pose))
    // The bot shot the player down inside the replay window, and the replay repeats it.
    expect(world.aircraft[0].stopReason).toBe('weapon')
    expect(runFlightReplay(reference.exportReplay()).aircraft.map(pose)).toEqual(world.aircraft.map(pose))
  }, 60000)
})
