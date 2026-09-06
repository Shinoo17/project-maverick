import type { SessionConfig } from '../../content/schemas'
import { validateSession } from '../../content/validate'
import type { WorldState } from '../state/WorldState'
import { FixedClock } from './clock'

// No RAF, timers, DOM or renderer: the future scene/session host owns the sole driver.
// P0 establishes lifecycle and time. Flight integration is deliberately left for P1.
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
        position: { x: index * 40, y: 200, z: 0 },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
        velocity: { x: 0, y: 0, z: 0 }, alive: true,
      })),
    }
  }

  start() { if (this.status === 'idle') this.status = 'running' }
  pause() { if (this.status === 'running') { this.status = 'paused'; this.clock.reset() } }
  resume() { if (this.status === 'paused') { this.clock.reset(); this.status = 'running' } }
  advance(delta: number) {
    if (this.status !== 'running') return 0
    return this.clock.advance(delta, () => { this.world.tick++ })
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
