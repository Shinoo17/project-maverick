import { describe, expect, it } from 'vitest'
import { GameRuntime } from '../src/game/runtime/GameRuntime'
import { neutralCommand, type PilotCommand } from '../src/game/runtime/commands'
import type { GameEvent } from '../src/game/runtime/events'
import type { SessionConfig } from '../src/content/schemas'
import { validateSession } from '../src/content/validate'
import { flightMaps } from '../src/content/maps'
import { botDifficulties, botLoadouts, type BotSetup } from '../src/game/bot/botSetup'
import { botProfiles } from '../src/game/bot/botPilot'
import type { TargetDroneMode } from '../src/game/playground/dronePath'

const base: SessionConfig = { mode: 'playground', mapId: 'flat-range', aircraftIds: ['f22'] }

/** Flies `seconds` with the player's `script`, collecting events and who owned the rounds in the air. */
function fly(config: SessionConfig, seconds: number, script: (tick: number, id: string) => PilotCommand = neutralCommand) {
  const runtime = new GameRuntime(config)
  runtime.start()
  const events: GameEvent[] = [], roundOwners = new Set<string>(), tactics = new Set<string>()
  for (let tick = 0; tick < seconds * 60; tick++) {
    runtime.advance(1 / 60, script)
    events.push(...runtime.drainEvents())
    const world = runtime.snapshot()
    for (const round of world.projectiles) roundOwners.add(round.ownerId)
    const tactic = world.aircraft[1]?.bot?.tactic
    if (tactic) tactics.add(tactic)
  }
  const of = <T extends GameEvent['type']>(type: T) => events.filter((event): event is Extract<GameEvent, { type: T }> => event.type === type)
  return { of, roundOwners, tactics, world: runtime.snapshot() }
}
const bot = (setup: BotSetup, seconds = 14) => fly({ ...base, targetDrone: 'bot', bot: setup }, seconds)
const botLaunches = (run: ReturnType<typeof fly>) => run.of('missile-launched').filter(event => event.entityId === 'drone-1')

describe('sortie setup: session config', () => {
  it('accepts every flyable map and rejects an unknown one', () => {
    expect(flightMaps.map(map => map.id)).toEqual(['flat-range', 'mountains', 'islands'])
    for (const map of flightMaps) expect(() => validateSession({ ...base, mapId: map.id })).not.toThrow()
    expect(() => validateSession({ ...base, mapId: 'nowhere' })).toThrow('session.mapId')
  })
  it('accepts every bot difficulty and loadout and rejects others', () => {
    for (const difficulty of botDifficulties) for (const loadout of botLoadouts) expect(() => validateSession({ ...base, targetDrone: 'bot', bot: { difficulty, loadout } })).not.toThrow()
    expect(() => validateSession({ ...base, targetDrone: 'bot', bot: { difficulty: 'ace', loadout: 'full' } as unknown as BotSetup })).toThrow('session.bot')
  })
  it('has a profile for every difficulty, sharper as it gets harder', () => {
    expect(botProfiles.easy.aimErrorDeg).toBeGreaterThan(botProfiles.normal.aimErrorDeg)
    expect(botProfiles.normal.aimErrorDeg).toBeGreaterThan(botProfiles.hard.aimErrorDeg)
    expect(botProfiles.easy.reactionSeconds[0]).toBeGreaterThan(botProfiles.hard.reactionSeconds[1])
  })
  it('gives the bot the chosen difficulty and loadout, on every life', () => {
    const runtime = new GameRuntime({ ...base, targetDrone: 'bot', bot: { difficulty: 'hard', loadout: 'gun' } })
    expect(runtime.snapshot().aircraft[1].bot).toMatchObject({ difficulty: 'hard', loadout: 'gun' })
    runtime.setTargetDrone('bot', { difficulty: 'easy', loadout: 'none' })
    expect(runtime.snapshot().aircraft[1].bot).toMatchObject({ difficulty: 'easy', loadout: 'none' })
    expect(runtime.exportReplay().config.bot).toEqual({ difficulty: 'easy', loadout: 'none' })
  })
})

describe('combat bot loadouts', () => {
  it('unarmed: never fires a round or a missile, and the player flying straight survives', () => {
    const run = bot({ difficulty: 'normal', loadout: 'none' })
    expect(botLaunches(run)).toEqual([])
    expect(run.roundOwners.has('drone-1')).toBe(false)
    expect(run.of('damage-applied').filter(event => event.sourceId === 'drone-1')).toEqual([])
    expect(run.world.aircraft[0].alive).toBe(true)
    // It has nothing to fight with: it breaks away from the player's nose and never turns to engage.
    expect(run.tactics.has('engage')).toBe(false)
    expect(run.tactics.has('evade')).toBe(true)
  })
  it('gun only: never launches a missile', () => {
    expect(botLaunches(bot({ difficulty: 'normal', loadout: 'gun' }))).toEqual([])
  })
  it('missiles only: launches, and never fires the gun', () => {
    const run = bot({ difficulty: 'normal', loadout: 'missile' })
    expect(botLaunches(run).length).toBeGreaterThan(0)
    expect(run.roundOwners.has('drone-1')).toBe(false)
  })
})

describe('flare drone', () => {
  /** The player selects its radar missile and holds the launch key, so it fires as soon as the seeker locks the drone. */
  const shooter = (mode: TargetDroneMode) => {
    let id = 1
    return fly({ ...base, targetDrone: mode }, 25, (tick, entity) => ({ ...neutralCommand(tick, entity),
      actions: [{ id: id++, type: 'select-secondary', slot: 1 }, { id: id++, type: 'fire-missile' }] }))
  }
  it('drops flares at a missile launched at it, and the plain circling drone does not', () => {
    const flares = shooter('flares'), plain = shooter('circle')
    const launched = (run: ReturnType<typeof fly>) => run.of('missile-launched').filter(event => event.entityId === 'aircraft-1' && event.targetId === 'drone-1')
    expect(launched(flares).length).toBeGreaterThan(0)
    expect(launched(plain).length).toBeGreaterThan(0)
    const dispensed = (run: ReturnType<typeof fly>) => run.of('countermeasure-dispensed').filter(event => event.entityId === 'drone-1')
    expect(dispensed(flares).length).toBeGreaterThan(0)
    expect(dispensed(plain)).toEqual([])
    // Never before a missile was in the air.
    expect(dispensed(flares)[0].tick).toBeGreaterThanOrEqual(launched(flares)[0].tick)
  })
})
