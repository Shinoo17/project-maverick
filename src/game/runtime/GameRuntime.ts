import type { SessionConfig } from '../../content/schemas'
import { validateSession } from '../../content/validate'
import type { WorldState } from '../state/WorldState'
import { FixedClock, FLIGHT_STEP } from './clock'
import { neutralCommand, type PilotCommand } from './commands'
import { stepFlight } from '../flight/stepFlight'
import { trainingMap } from '../../content/maps'
import { flightProfile } from '../flight/profile'

// No RAF, timers, DOM or renderer: the future scene/session host owns the sole driver.
// Flight is integrated twice per world tick; presentation never drives an entity separately.
export class GameRuntime {
  readonly clock = new FixedClock()
  private status: 'idle' | 'running' | 'paused' | 'disposed' = 'idle'
  private world: WorldState
  private readonly config: SessionConfig

  constructor(config: SessionConfig) {
    validateSession(config)
    this.config = structuredClone(config)
    this.world = this.createWorld()
  }

  private createWorld(): WorldState {
    return {
      tick: 0,
      aircraft: this.config.aircraftIds.map((aircraftId, index) => ({
        id: `aircraft-${index + 1}`, aircraftId,
        position: { x: index * 40, y: trainingMap.spawnAltitude, z: 0 },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
        velocity: { x: trainingMap.spawnSpeed, y: 0, z: 0 }, alive: true,
        speedDrive: 0, enginePower: flightProfile.drag * trainingMap.spawnSpeed ** 2 / flightProfile.maxThrust,
        rates: { pitch: 0, yaw: 0, roll: 0 },
      })),
    }
  }

  start() { if (this.status === 'idle') this.status = 'running' }
  pause() { if (this.status === 'running') { this.status = 'paused'; this.clock.reset() } }
  resume() { if (this.status === 'paused') { this.clock.reset(); this.status = 'running' } }
  advance(delta: number, commandAtTick?: (tick: number, entityId: string) => PilotCommand) {
    if (this.status !== 'running') return 0
    return this.clock.advance(delta, () => {
      for (const entity of this.world.aircraft) {
        const command = commandAtTick?.(this.world.tick, entity.id) ?? neutralCommand(this.world.tick, entity.id)
        const safe = { ...command }
        for (const key of ['pitch', 'roll', 'yaw', 'speedAdjust'] as const) safe[key] = Number.isFinite(command[key]) ? Math.max(-1, Math.min(1, command[key])) : 0
        stepFlight(entity, safe, FLIGHT_STEP)
        stepFlight(entity, safe, FLIGHT_STEP)
      }
      this.world.tick++
    })
  }
  reset() {
    if (this.status === 'disposed') return
    this.world = this.createWorld()
    this.clock.reset()
    this.clock.droppedSeconds = 0
  }
  snapshot(): WorldState { return structuredClone(this.world) }
  dispose() { this.status = 'disposed'; this.clock.reset() }
}
