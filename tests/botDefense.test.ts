import { describe, expect, it } from 'vitest'
import { GameRuntime } from '../src/game/runtime/GameRuntime'
import { neutralCommand, type PilotCommand } from '../src/game/runtime/commands'
import type { GameEvent } from '../src/game/runtime/events'
import type { WorldState } from '../src/game/state/WorldState'
import { botCommand, botRules, createBotState, createBotSteering } from '../src/game/bot/botPilot'
import { launchMissile, type Missile } from '../src/game/combat/missiles'

/** The player, flying straight at the combat bot's merge, fires one missile from `slot` (0 IR, 1 radar) as soon as it locks.
 * `stock` sets the bot's countermeasure bursts at the start. */
function duel(slot: number, stock?: number, seconds = 25) {
  const runtime = new GameRuntime({ mode: 'playground', mapId: 'flat-range', aircraftIds: ['f22'], targetDrone: 'bot' })
  runtime.start()
  // Reaching into the runtime's own world, for this setup only: nothing public sets a stock.
  if (stock !== undefined) (runtime as unknown as { world: WorldState }).world.aircraft.find(entity => entity.id === 'drone-1')!.countermeasures.bursts = stock
  const events: GameEvent[] = [], tactics = new Set<string>()
  let id = 1, fired = false
  for (let tick = 0; tick < seconds * 60; tick++) {
    runtime.advance(1 / 60, (t, entityId): PilotCommand => ({ ...neutralCommand(t, entityId), actions: [
      ...(t === 0 ? [{ id: id++, type: 'select-secondary' as const, slot }] : []),
      ...(fired ? [] : [{ id: id++, type: 'fire-missile' as const }])] }))
    const drained = runtime.drainEvents()
    events.push(...drained)
    if (drained.some(event => event.type === 'missile-launched')) fired = true
    const bot = runtime.snapshot().aircraft.find(entity => entity.id === 'drone-1')
    if (bot?.bot) tactics.add(bot.bot.tactic)
  }
  const of = <T extends GameEvent['type']>(type: T) => events.filter((event): event is Extract<GameEvent, { type: T }> => event.type === type)
  return { events, of, tactics, fired }
}

describe('combat bot missile defence', () => {
  it('beams an AIM-9 and drops flares that decoy it; with none left, the same shot kills it', () => {
    const defended = duel(0)
    expect(defended.fired).toBe(true)
    expect(defended.tactics).toContain('defend')
    const bursts = defended.of('countermeasure-dispensed').filter(event => event.entityId === 'drone-1')
    expect(bursts.length).toBeGreaterThan(0)
    expect(bursts.length).toBeLessThanOrEqual(botRules.burstsPerMissile)
    expect(defended.of('missile-decoyed').some(event => event.decoyId !== null)).toBe(true)
    expect(defended.of('missile-detonated').every(event => event.targetId !== 'drone-1')).toBe(true)

    const bare = duel(0, 0)
    expect(bare.of('countermeasure-dispensed')).toHaveLength(0)
    expect(bare.of('missile-detonated').some(event => event.targetId === 'drone-1')).toBe(true)
  })

  it('drops nothing on a radar launch warning alone, and bursts once the missile itself shows', () => {
    const world = new GameRuntime({ mode: 'playground', aircraftIds: ['f22', 'su57'] }).snapshot()
    const [shooter, bot] = world.aircraft
    bot.control = 'bot'; bot.bot = createBotState(1)
    bot.position = { x: 0, y: 3000, z: 0 }; bot.velocity = { x: 200, y: 0, z: 0 }
    // The shooter 6 km off the bot's right side, its nose on the bot, so its radar paints it.
    shooter.position = { x: 0, y: 3000, z: 6000 }; shooter.orientation = { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 }
    const fired = launchMissile(9, 0, shooter, 'aim120', bot, { stationId: 'test', mount: 'pylon', point: [0, 0, 0] }, true)
    const at = (guidance: Missile['guidance']): Missile => ({ ...fired, guidance, age: 6, position: { x: 0, y: 3000, z: 2500 }, velocity: { x: 0, y: 0, z: -900 } })
    const run = (missiles: Missile[]) => {
      const state = createBotState(1), steering = createBotSteering()
      bot.bot = state
      let dropped = 0
      for (let tick = 0; tick < 180; tick++) dropped += botCommand(state, steering, bot, world.aircraft, tick, 0, missiles).actions.filter(action => action.type === 'countermeasure').length
      return { tactic: state.tactic, dropped }
    }
    expect(run([at('datalink')])).toEqual({ tactic: 'defend', dropped: 0 })
    // Never stepped by a runtime here, so no burst ever starts its cooldown: only the per-missile cap stops it.
    expect(run([at('active')])).toEqual({ tactic: 'defend', dropped: botRules.burstsPerMissile })
  })
})
