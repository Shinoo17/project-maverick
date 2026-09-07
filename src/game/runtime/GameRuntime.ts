import type { SessionConfig } from '../../content/schemas'
import { validateSession } from '../../content/validate'
import type { WorldState } from '../state/WorldState'
import { FixedClock, FLIGHT_STEP } from './clock'
import { neutralCommand, type PilotCommand } from './commands'
import { stepFlight } from '../flight/stepFlight'
import { createPracticeState, practiceSpawns, stepPractice, type PracticePreset } from '../playground/practice'
import { createManeuverState } from '../flight/maneuvers'
import { flightProfile } from '../flight/profile'

// No RAF, timers, DOM or renderer: the future scene/session host owns the sole driver.
// Flight is integrated twice per world tick; presentation never drives an entity separately.
export class GameRuntime {
  readonly clock = new FixedClock()
  private status: 'idle' | 'running' | 'paused' | 'disposed' = 'idle'
  private preset: PracticePreset = 'free'
  private track: PilotCommand[] = []
  private world: WorldState
  private readonly config: SessionConfig

  constructor(config: SessionConfig) {
    validateSession(config)
    this.config = structuredClone(config)
    this.world = this.createWorld()
  }

  private createWorld(): WorldState {
    return {
      tick: 0, practice: createPracticeState(),
      aircraft: this.config.aircraftIds.map((aircraftId, index) => ({
        id: `aircraft-${index + 1}`, aircraftId,
        position: { x: index * 40, y: practiceSpawns[this.preset].altitude, z: 0 },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
        velocity: { x: practiceSpawns[this.preset].speed, y: 0, z: 0 }, alive: true,
        maneuver: createManeuverState(),
        speedDrive: 0, enginePower: flightProfile.drag * practiceSpawns[this.preset].speed ** 2 / flightProfile.maxThrust,
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
        if (entity.id === 'aircraft-1' && this.track.length < 3600) this.track.push(structuredClone(safe))
        for (let substep = 0; substep < 2; substep++) {
          const previousX = entity.position.x
          if (!entity.alive) break
          stepFlight(entity, safe, FLIGHT_STEP)
          if (entity.id === 'aircraft-1') stepPractice(this.world.practice, entity, safe, previousX, FLIGHT_STEP)
        }
      }
      this.world.tick++
    })
  }
  singleStep(command?: PilotCommand) {
    if (this.status !== 'paused') return
    this.status = 'running'
    this.advance(1 / 60, (tick, id) => command ?? neutralCommand(tick, id))
    this.status = 'paused'; this.clock.reset()
  }
  exportReplay() {
    return { schemaVersion: 1, profileVersion: 'p2-manual-2', config: structuredClone(this.config), preset: this.preset, hz: 60, durationTicks: this.track.length, truncated: this.world.tick > this.track.length, commands: structuredClone(this.track) }
  }
  reset(preset: PracticePreset = this.preset) {
    if (this.status === 'disposed') return
    this.preset = preset; this.track = []
    this.world = this.createWorld()
    this.clock.reset()
    this.clock.droppedSeconds = 0
  }
  snapshot(): WorldState { return structuredClone(this.world) }
  dispose() { this.status = 'disposed'; this.clock.reset() }
}
