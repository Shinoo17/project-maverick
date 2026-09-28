import { describe, expect, it } from 'vitest'
import { GameRuntime } from '../src/game/runtime/GameRuntime'
import { neutralCommand, type PilotCommand } from '../src/game/runtime/commands'
import { runFlightReplay } from '../src/game/playground/replay'
import { validateSession } from '../src/content/validate'
import { targetDrone } from '../src/game/playground/practice'

// A short scripted input: climb, roll and accelerate, so the player's path is not trivial.
const script = (tick: number, entityId: string): PilotCommand => ({ ...neutralCommand(tick, entityId), pitch: tick < 90 ? 0.6 : -0.2, roll: tick % 120 < 40 ? 0.8 : 0, speedAdjust: 1 })

function fly(targetDroneOn: boolean, fps: number, seconds = 5) {
  const runtime = new GameRuntime({ mode: 'playground', mapId: 'flat-range', aircraftIds: ['f22'], targetDrone: targetDroneOn })
  const asked: string[] = []
  runtime.start()
  for (let frame = 0; frame < fps * seconds; frame++) runtime.advance(1 / fps, (tick, id) => { asked.push(id); return script(tick, id) })
  return { world: runtime.snapshot(), asked, runtime }
}

describe('target drone', () => {
  it('holds its pose ahead of the spawn and is never asked for a command', () => {
    const { world, asked } = fly(true, 60)
    const drone = world.aircraft.find(entity => entity.id === 'drone-1')!
    expect(drone).toMatchObject({ control: 'hold', aircraftId: targetDrone.aircraftId, alive: true })
    expect(drone.position).toEqual({ x: targetDrone.ahead, y: 400 + targetDrone.above, z: 0 })
    expect(drone.velocity).toEqual({ x: 0, y: 0, z: 0 })
    expect(asked.every(id => id === 'aircraft-1')).toBe(true)
  })
  it('does not change the player flight, at any frame rate', () => {
    const without = fly(false, 60).world.aircraft[0]
    for (const fps of [30, 60, 144]) expect(fly(true, fps).world.aircraft[0]).toEqual(without)
  })
  it('keeps the flown aircraft ids and adds the drone only when asked', () => {
    expect(fly(false, 60, 0).world.aircraft.map(entity => entity.id)).toEqual(['aircraft-1'])
    expect(fly(true, 60, 0).world.aircraft.map(entity => entity.id)).toEqual(['aircraft-1', 'drone-1'])
  })
  it('toggles in place, restarting the flight', () => {
    const { runtime } = fly(false, 60, 1)
    runtime.setTargetDrone(true)
    expect(runtime.snapshot().tick).toBe(0)
    expect(runtime.snapshot().aircraft.map(entity => entity.id)).toEqual(['aircraft-1', 'drone-1'])
    runtime.setTargetDrone(false)
    expect(runtime.snapshot().aircraft.map(entity => entity.id)).toEqual(['aircraft-1'])
  })
  it('is a Playground modifier only, and replays keep it', () => {
    expect(() => validateSession({ mode: 'offline', aircraftIds: ['f22'], targetDrone: true })).toThrow('session.targetDrone')
    const { runtime, world } = fly(true, 60, 2)
    const replay = runtime.exportReplay()
    expect(replay.config.targetDrone).toBe(true)
    expect(runFlightReplay(replay).aircraft).toEqual(world.aircraft)
  })
})
