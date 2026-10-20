import { describe, expect, it } from 'vitest'
import { GameRuntime } from '../src/game/runtime/GameRuntime'
import { neutralCommand, type PilotCommand } from '../src/game/runtime/commands'
import { runFlightReplay } from '../src/game/playground/replay'
import { candidates, stepTargeting, targetingRules } from '../src/game/combat/targeting'
import { FlightInput } from '../src/game/input/FlightInput'
import { WORLD_STEP } from '../src/game/runtime/clock'
import { dronePaths } from '../src/game/playground/dronePath'
import type { TargetDroneMode } from '../src/game/playground/dronePath'
import { targetDrone } from '../src/game/playground/practice'
import { aimAtDrone } from './aim'

/** Two flown aircraft and, optionally, the drone. Entity 1 is at the origin facing +X. */
const world = (drone?: TargetDroneMode) => new GameRuntime({ mode: 'playground', aircraftIds: ['f22', 'su57'], ...(drone ? { targetDrone: drone } : {}) }).snapshot()

describe('target selection', () => {
  it('picks the aircraft nearest the nose inside the cone and range, and nothing behind', () => {
    const [me, other, drone] = world('still').aircraft
    other.position = { x: 0, y: 400, z: 300 }
    // aircraft-2 moved 300 m to the side: 90° off the nose, outside the cone.
    expect(candidates(me, [me, other, drone]).map(option => option.entity.id)).toEqual(['drone-1'])
    stepTargeting(me, [me, other, drone], false, WORLD_STEP)
    expect(me.targeting.targetId).toBe('drone-1')
    drone.position = { x: -1300, y: 425, z: 0 }
    me.targeting.targetId = null
    stepTargeting(me, [me, other, drone], false, WORLD_STEP)
    expect(me.targeting.targetId).toBeNull()
  })
  it('keeps a target outside the cone for the grace time, then drops it; drops a dead one at once', () => {
    const [me, , drone] = world('still').aircraft
    stepTargeting(me, [me, drone], false, WORLD_STEP)
    drone.position = { x: 0, y: 425, z: 1300 }
    const graceTicks = Math.round(targetingRules.keepGraceSeconds / WORLD_STEP)
    for (let tick = 1; tick < graceTicks; tick++) stepTargeting(me, [me, drone], false, WORLD_STEP)
    expect(me.targeting.targetId).toBe('drone-1')
    stepTargeting(me, [me, drone], false, WORLD_STEP)
    expect(me.targeting.targetId).toBeNull()
    drone.position = { x: 1300, y: 425, z: 0 }
    stepTargeting(me, [me, drone], false, WORLD_STEP)
    drone.alive = false
    stepTargeting(me, [me, drone], false, WORLD_STEP)
    expect(me.targeting.targetId).toBeNull()
  })
  it('steps to the next candidate by angle and wraps', () => {
    const [me, other, drone] = world('still').aircraft
    other.position = { x: 900, y: 400, z: 120 }
    stepTargeting(me, [me, other, drone], false, WORLD_STEP)
    expect(me.targeting.targetId).toBe('drone-1')
    stepTargeting(me, [me, other, drone], true, WORLD_STEP)
    expect(me.targeting.targetId).toBe('aircraft-2')
    stepTargeting(me, [me, other, drone], true, WORLD_STEP)
    expect(me.targeting.targetId).toBe('drone-1')
  })
  it('reaches the circle drone where it spawns', () => {
    expect(dronePaths.circleRadius).toBeLessThanOrEqual(targetingRules.acquireRange)
  })
})

describe('targeting in the runtime', () => {
  it('selects the drone, the same at any frame rate and in a replay', () => {
    const run = (fps: number) => {
      const runtime = new GameRuntime({ mode: 'playground', aircraftIds: ['f22'], targetDrone: 'racetrack' })
      runtime.start()
      for (let frame = 0; frame < fps * 2; frame++) runtime.advance(1 / fps, (tick, id) => neutralCommand(tick, id))
      return runtime
    }
    const reference = run(60)
    expect(reference.snapshot().aircraft[0].targeting.targetId).toBe('drone-1')
    for (const fps of [30, 144]) expect(run(fps).snapshot().aircraft).toEqual(reference.snapshot().aircraft)
    expect(runFlightReplay(reference.exportReplay()).aircraft).toEqual(reference.snapshot().aircraft)
  })
  it('turns one T press into exactly one next-target action at 30, 60 and 144 fps', () => {
    for (const fps of [30, 60, 144]) {
      const input = new FlightInput()
      const runtime = new GameRuntime({ mode: 'playground', aircraftIds: ['f22'], targetDrone: 'still' })
      runtime.start()
      const actions: PilotCommand['actions'] = []
      for (let frame = 0; frame < fps; frame++) {
        if (frame === 5) { input.press('KeyT'); input.press('KeyT', true) }
        runtime.advance(1 / fps, (tick, id) => { const command = input.command(tick, id, 'keyboard'); actions.push(...command.actions); return command })
      }
      expect(actions).toHaveLength(1)
      expect(actions[0].type).toBe('next-target')
    }
  })
  it('clears the target in the tick it is shot down, and picks the respawned drone up again', () => {
    const runtime = new GameRuntime({ mode: 'playground', aircraftIds: ['f22'], targetDrone: 'still' })
    runtime.start()
    const aim = aimAtDrone(runtime)
    let killed = false
    for (let tick = 0; tick < 60 * 8 && !killed; tick++) {
      runtime.advance(WORLD_STEP, aim)
      killed = runtime.drainEvents().some(event => event.type === 'aircraft-destroyed')
    }
    expect(killed).toBe(true)
    expect(runtime.snapshot().aircraft[0].targeting.targetId).toBeNull()
    for (let tick = 0; tick < 60 * (targetDrone.respawnSeconds + 0.5); tick++) runtime.advance(WORLD_STEP, (t, id) => neutralCommand(t, id))
    expect(runtime.snapshot().aircraft[0].targeting.targetId).toBe('drone-1')
  })
  it('records the target acceleration of a turning drone, with no jump at its start', () => {
    const runtime = new GameRuntime({ mode: 'playground', aircraftIds: ['f22'], targetDrone: 'circle' })
    runtime.start()
    runtime.advance(WORLD_STEP)
    const drone = runtime.snapshot().aircraft[1]
    const centripetal = dronePaths.speed ** 2 / dronePaths.circleRadius
    expect(Math.hypot(drone.acceleration.x, drone.acceleration.y, drone.acceleration.z)).toBeCloseTo(centripetal, 2)
  })
})
