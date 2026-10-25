import { describe, expect, it } from 'vitest'
import { GameRuntime } from '../src/game/runtime/GameRuntime'
import { neutralCommand, type PilotCommand } from '../src/game/runtime/commands'
import type { GameEvent } from '../src/game/runtime/events'
import { rwrPicture } from '../src/game/combat/rwr'
import { botCommand, botRules, createBotState, createBotSteering } from '../src/game/bot/botPilot'
import { missileStations } from '../src/content/weapons'
import { getAircraft } from '../src/content/aircraft'

/** The player flying straight at the combat bot's merge; `flare` presses the countermeasure key once a second while a missile is after it. */
function merge(seconds: number, flare = false) {
  const runtime = new GameRuntime({ mode: 'playground', mapId: 'flat-range', aircraftIds: ['f22'], targetDrone: 'bot' })
  runtime.start()
  const events: GameEvent[] = [], levels = new Set<string>()
  let id = 1
  for (let tick = 0; tick < seconds * 60; tick++) {
    const world = runtime.snapshot()
    const chased = world.missiles.some(missile => missile.targetId === 'aircraft-1')
    runtime.advance(1 / 60, (t, entityId): PilotCommand => ({ ...neutralCommand(t, entityId),
      actions: flare && chased && t % 60 === 0 ? [{ id: id++, type: 'countermeasure' }] : [] }))
    events.push(...runtime.drainEvents())
    const after = runtime.snapshot()
    for (const threat of rwrPicture(after.aircraft[0], after)) levels.add(threat.level)
  }
  const of = <T extends GameEvent['type']>(type: T) => events.filter((event): event is Extract<GameEvent, { type: T }> => event.type === type)
  return { of, levels }
}

describe('combat bot missiles', () => {
  it('locks and launches at the player through the same seeker, one at a time, and kills one flying straight', () => {
    const { of, levels } = merge(12)
    const launches = of('missile-launched').filter(event => event.entityId === 'drone-1')
    expect(launches.length).toBeGreaterThan(0)
    expect(launches[0]).toMatchObject({ targetId: 'aircraft-1', weaponId: 'training-ir' })
    expect(of('aircraft-destroyed')).toContainEqual(expect.objectContaining({ entityId: 'aircraft-1', sourceId: 'drone-1' }))
    // Its IR missile shows on the player's MAWS; its radar paints the player on the way in.
    expect(levels).toContain('missile')
    expect(levels).toContain('search')
  })

  it('a player dropping flares decoys it', () => {
    const { of } = merge(12, true)
    expect(of('missile-decoyed').some(event => event.ownerId === 'drone-1' && event.decoyId !== null)).toBe(true)
    expect(of('missile-detonated').filter(event => event.ownerId === 'drone-1').every(event => event.targetId !== 'aircraft-1')).toBe(true)
  })

  it('picks the radar missile far out and the IR missile close in', () => {
    const irReach = missileStations(getAircraft('su57')).find(row => row.weapon.kind === 'ir')!.weapon.missile!.launchRangeM
    /** The slot the bot asks for with the player `range` metres ahead of it, both still, over a second of commands. */
    const pick = (range: number) => {
      const world = new GameRuntime({ mode: 'playground', aircraftIds: ['su57', 'f22'] }).snapshot()
      const [bot, player] = world.aircraft
      bot.control = 'bot'; bot.position = { x: 0, y: 3000, z: 0 }
      player.position = { x: range, y: 3000, z: 0 }
      const state = createBotState(3), steering = createBotSteering()
      const slots = new Set<number>()
      for (let tick = 0; tick < 60; tick++) for (const action of botCommand(state, steering, bot, world.aircraft, tick).actions) if (action.type === 'select-secondary') slots.add(action.slot)
      return [...slots].map(slot => missileStations(getAircraft('su57'))[slot].weapon.kind)
    }
    // The seeker starts on slot 0, the IR missile: far out it asks for the radar one, close in for nothing new.
    expect(pick(irReach + 1500)).toEqual(['radar'])
    expect(pick(irReach * botRules.irHandover - 300)).toEqual([])
  })
})
