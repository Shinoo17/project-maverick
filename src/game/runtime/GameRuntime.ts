import type { SessionConfig } from '../../content/schemas'
import { validateSession } from '../../content/validate'
import type { WorldState } from '../state/WorldState'
import { FixedClock, FLIGHT_STEP, WORLD_STEP } from './clock'
import { commandSchemaVersion, neutralCommand, type PilotCommand } from './commands'
import { stepFlight } from '../flight/stepFlight'
import { createPracticeState, droneRespawnPose, practiceSpawns, stepPractice, targetDrone, type PracticePreset } from '../playground/practice'
import { circleFrom, dronePose, racetrackFrom, type TargetDroneMode } from '../playground/dronePath'
import { createThrustVectoringState } from '../flight/thrustVectoring'
import { createPilotIntent } from '../flight/intent'
import { createManeuverState } from '../flight/maneuvers'
import { createStallState } from '../flight/stall'
import { fullArmament, getWeapon, gunStation } from '../../content/weapons'
import { hitboxes } from '../../content/hitboxes'
import { createGunState, stepGun } from '../combat/gun'
import { spawnRound, stepRound, type CombatBody, type Projectile, type ProjectileHit } from '../combat/projectiles'
import { boundingRadius } from '../combat/collision'
import { AIRCRAFT_HP, applyHits } from '../combat/damage'
import { createTargetingState, stepTargeting } from '../combat/targeting'
import type { GameEvent } from './events'
import { getAircraft } from '../../content/aircraft'
import { getFlightProfile, flightProfileVersion } from '../flight/profile'
import { resolveSpeedLimits } from '../flight/speedLimits'
import { dryThrustLimit } from '../flight/speed'
import type { AircraftState, Vec3 } from '../state/WorldState'

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

const gunOf = (aircraftId: string) => gunStation(getAircraft(aircraftId))
const radii = new Map<string, number>()
function combatBody(entity: AircraftState, from: CombatBody['from'], to: CombatBody['to']): CombatBody {
  const profileId = getAircraft(entity.aircraftId).hitboxProfileId
  const shapes = hitboxes[profileId]
  if (!radii.has(profileId)) radii.set(profileId, boundingRadius(shapes))
  return { id: entity.id, shapes, radius: radii.get(profileId)!, from, to }
}
const poseOf = (entity: AircraftState): CombatBody['from'] =>
  ({ position: { ...entity.position }, orientation: { ...entity.orientation }, velocity: { ...entity.velocity } })

// No RAF, timers, DOM or renderer: the future scene/session host owns the sole driver.
// Flight is integrated twice per world tick; presentation never drives an entity separately.
export class GameRuntime {
  readonly clock = new FixedClock()
  private status: 'idle' | 'running' | 'paused' | 'disposed' = 'idle'
  private preset: PracticePreset = 'free'
  private track: PilotCommand[] = []
  private world: WorldState
  private config: SessionConfig
  // Gun hits since the last drainHits(), for hit effects. Damage is already applied in the tick.
  private hits: ProjectileHit[] = []
  // Game events since the last drainEvents(). Ids count up per session, so a replay gives the same ids.
  private events: GameEvent[] = []
  private nextEventId = 1

  constructor(config: SessionConfig) {
    validateSession(config)
    // Keep only supported session fields, including when reading older replays.
    this.config = { mode: config.mode, aircraftIds: [...config.aircraftIds],
      ...(config.mapId === undefined ? {} : { mapId: config.mapId }),
      // `true` from older sessions is the still drone.
      ...(config.targetDrone ? { targetDrone: config.targetDrone === true ? 'still' as const : config.targetDrone } : {}),
      ...(config.flightOverrides === undefined ? {} : { flightOverrides: structuredClone(config.flightOverrides) }) }
    this.world = this.createWorld()
  }

  private createWorld(): WorldState {
    const spawn = practiceSpawns[this.preset]
    const aircraft = this.config.aircraftIds.map((aircraftId, index) => this.createAircraft(`aircraft-${index + 1}`, aircraftId, { x: index * 40, y: spawn.altitude, z: 0 }))
    // The drone is not in aircraftIds: those are the flown aircraft, and ids aircraft-1..n stay theirs.
    if (this.config.targetDrone) aircraft.push(this.createDrone({ x: targetDrone.ahead, y: spawn.altitude + targetDrone.above, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 }, 0))
    return { tick: 0, practice: createPracticeState(), aircraft, projectiles: [], nextProjectileId: 1 }
  }
  /** A still drone keeps `orientation`; a moving one starts its path at `position`, heading `heading`, on `tick`. */
  private createDrone(position: Vec3, heading: Vec3, orientation: AircraftState['orientation'], tick: number) {
    const drone = this.createAircraft('drone-1', targetDrone.aircraftId, position)
    drone.control = 'hold'; drone.velocity = { x: 0, y: 0, z: 0 }; drone.orientation = orientation
    const mode = this.config.targetDrone as TargetDroneMode
    if (mode !== 'still') {
      drone.control = 'path'
      drone.path = mode === 'racetrack' ? racetrackFrom(position, heading, tick) : circleFrom(position, position.y, tick)
      Object.assign(drone, dronePose(drone.path, 0))
    }
    return drone
  }
  /** Brings a shot-down drone back, fresh, in front of the player once its wait is over. */
  private respawnDrone() {
    const world = this.world
    if (world.droneRespawnTick === undefined || world.tick < world.droneRespawnTick) return
    delete world.droneRespawnTick
    const index = world.aircraft.findIndex(entity => entity.id === 'drone-1')
    const { position, heading, orientation } = droneRespawnPose(world.aircraft[0])
    if (index >= 0) world.aircraft[index] = this.createDrone(position, heading, orientation, world.tick)
  }

  private createAircraft(id: string, aircraftId: string, position: AircraftState['position']): AircraftState {
    const flight = getFlightProfile(aircraftId).flight
    const speedLimits = resolveSpeedLimits(flight, this.config.flightOverrides?.[aircraftId])
    return {
      id, aircraftId, control: 'pilot', speedLimits,
      stores: fullArmament(getAircraft(aircraftId)), gun: createGunState(gunOf(aircraftId).weapon.id),
      position,
      orientation: { x: 0, y: 0, z: 0, w: 1 },
      velocity: { x: practiceSpawns[this.preset].speed, y: 0, z: 0 }, acceleration: { x: 0, y: 0, z: 0 }, targeting: createTargetingState(), hp: AIRCRAFT_HP, alive: true,
      maneuver: createManeuverState(), stall: createStallState(), thrustVectoring: createThrustVectoringState(),
      speedDrive: 0, intent: createPilotIntent(), limiterOpen: 0, pathAssistWeight: 1,
      engine: { requestedPower: flight.drag * practiceSpawns[this.preset].speed ** 2 / dryThrustLimit(flight, speedLimits), actualThrust: flight.drag * practiceSpawns[this.preset].speed ** 2 },
      enginePower: flight.drag * practiceSpawns[this.preset].speed ** 2 / dryThrustLimit(flight, speedLimits),
      rates: { pitch: 0, yaw: 0, roll: 0 },
    }
  }

  start() { if (this.status === 'idle') this.status = 'running' }
  pause() { if (this.status === 'running') { this.status = 'paused'; this.clock.reset() } }
  resume() { if (this.status === 'paused') { this.clock.reset(); this.status = 'running' } }
  advance(delta: number, commandAtTick?: (tick: number, entityId: string) => PilotCommand) {
    if (this.status !== 'running') return 0
    return this.clock.advance(delta, () => {
      // Before the tick's poses are taken, so rounds see the new drone from its first tick.
      this.respawnDrone()
      const before = this.world.aircraft.map(poseOf)
      const wasAlive = this.world.aircraft.map(entity => entity.alive)
      const triggers = new Map<string, boolean>()
      const nextTarget = new Set<string>()
      for (const entity of this.world.aircraft) {
        // The drone has no pilot: it is never asked for a command, so player input is read once per tick.
        // A moving one is put where its path is at the end of this tick.
        if (entity.control !== 'pilot') {
          if (entity.path && entity.alive) Object.assign(entity, dronePose(entity.path, (this.world.tick + 1 - entity.path.startTick) * WORLD_STEP))
          continue
        }
        const command = commandAtTick?.(this.world.tick, entity.id) ?? neutralCommand(this.world.tick, entity.id)
        const safe = { ...command }
        for (const key of ['pitch', 'roll', 'yaw', 'speedAdjust'] as const) safe[key] = Number.isFinite(command[key]) ? Math.max(-1, Math.min(1, command[key])) : 0
        safe.gunHeld = command.gunHeld === true
        triggers.set(entity.id, safe.gunHeld)
        safe.actions = Array.isArray(command.actions) ? command.actions.filter(action => action?.type === 'next-target') : []
        if (safe.actions.length > 0) nextTarget.add(entity.id)
        if (entity.id === 'aircraft-1' && this.track.length < 3600) this.track.push(structuredClone(safe))
        for (let substep = 0; substep < 2; substep++) {
          const previousX = entity.position.x
          if (!entity.alive) break
          stepFlight(entity, safe, FLIGHT_STEP)
          if (entity.id === 'aircraft-1') stepPractice(this.world.practice, entity, safe, previousX, FLIGHT_STEP)
        }
      }
      // After every aircraft has moved, so rounds see each one at the start and end of the same tick.
      const killers = this.stepGuns(before, triggers)
      this.reportDeaths(wasAlive, killers)
      // After deaths, so a target shot down this tick is never still selected.
      this.world.aircraft.forEach((entity, index) => {
        const v = entity.velocity, w = before[index].velocity
        entity.acceleration = { x: (v.x - w.x) / WORLD_STEP, y: (v.y - w.y) / WORLD_STEP, z: (v.z - w.z) / WORLD_STEP }
        if (entity.control !== 'pilot') return
        if (entity.alive) stepTargeting(entity, this.world.aircraft, nextTarget.has(entity.id), WORLD_STEP)
        else entity.targeting = { targetId: null, outside: 0 }
      })
      this.world.tick++
    })
  }
  /** Moves rounds in flight, then fires this tick's new rounds. */
  private stepGuns(before: CombatBody['from'][], triggers: Map<string, boolean>): Map<string, string> {
    const world = this.world
    const bodies = new Map<string, CombatBody>()
    world.aircraft.forEach((entity, index) => { if (entity.alive) bodies.set(entity.id, combatBody(entity, before[index], poseOf(entity))) })
    const live = [...bodies.values()]
    const hits: ProjectileHit[] = []
    const fly = (round: Projectile, offset: number) => {
      const { hit, done } = stepRound(round, getWeapon(round.weaponId).gun!, offset, WORLD_STEP, live)
      if (hit) hits.push({ tick: world.tick, projectileId: round.id, ownerId: round.ownerId, weaponId: round.weaponId, hit })
      return !done
    }
    world.projectiles = world.projectiles.filter(round => fly(round, 0))
    for (const entity of world.aircraft) {
      const shooter = bodies.get(entity.id)
      if (!shooter || entity.control !== 'pilot') continue
      const gun = gunOf(entity.aircraftId)
      const firstShot = entity.gun.shots
      // Spread follows the heat the gun had when the tick began.
      const heat = entity.gun.heat
      stepGun(entity.gun, gun.profile, triggers.get(entity.id) ?? false, WORLD_STEP).forEach((birth, index) => {
        const round = spawnRound(world.nextProjectileId++, world.tick, shooter, birth / WORLD_STEP, gun.muzzle, gun.weapon.id, gun.profile, heat, firstShot + index, gun.elevationDeg)
        if (fly(round, birth)) world.projectiles.push(round)
      })
    }
    // One batch after every round has moved: an aircraft alive at the start of the tick takes all
    // its hits, so two aircraft can shoot each other down in the same tick.
    // Returns who fired the killing round, by the aircraft it destroyed.
    const killers = new Map<string, string>()
    for (const { killed, ...damage } of applyHits(world.aircraft, hits)) {
      this.emit({ type: 'damage-applied', ...damage })
      if (killed) killers.set(damage.targetId, damage.sourceId)
    }
    this.hits.push(...hits)
    return killers
  }
  /** The single place deaths are reported, whatever the cause, so each aircraft is reported once. */
  private reportDeaths(wasAlive: boolean[], killers: Map<string, string>) {
    this.world.aircraft.forEach((entity, index) => {
      if (!wasAlive[index] || entity.alive) return
      // Terrain and boundary deaths have no source.
      this.emit({ type: 'aircraft-destroyed', entityId: entity.id, sourceId: killers.get(entity.id) ?? null, cause: entity.stopReason ?? 'terrain' })
      if (entity.id === 'drone-1') this.world.droneRespawnTick = this.world.tick + Math.round(targetDrone.respawnSeconds / WORLD_STEP)
    })
  }
  private emit(event: DistributiveOmit<GameEvent, 'id' | 'tick'>) {
    this.events.push({ ...event, id: `event-${this.nextEventId++}`, tick: this.world.tick } as GameEvent)
  }
  /** Gun hits recorded since the last call, oldest first. */
  drainHits(): ProjectileHit[] { const hits = this.hits; this.hits = []; return hits }
  /** Game events (damage, deaths) since the last call, oldest first. */
  drainEvents(): GameEvent[] { const events = this.events; this.events = []; return events }
  singleStep(command?: PilotCommand) {
    if (this.status !== 'paused') return
    this.status = 'running'
    this.advance(1 / 60, (tick, id) => command ?? neutralCommand(tick, id))
    this.status = 'paused'; this.clock.reset()
  }
  exportReplay() {
    return { schemaVersion: commandSchemaVersion, profileVersion: flightProfileVersion, config: structuredClone(this.config), preset: this.preset, hz: 60, durationTicks: this.track.length, truncated: this.world.tick > this.track.length, commands: structuredClone(this.track) }
  }
  /** Playground modifier: sets the target drone (null removes it), then restarts the flight like reset(). */
  setTargetDrone(mode: TargetDroneMode | null) {
    if (this.status === 'disposed') return
    const { targetDrone: _, ...rest } = this.config
    const next = mode ? { ...rest, targetDrone: mode } : rest
    validateSession(next)
    this.config = next
    this.reset()
  }
  reset(preset: PracticePreset = this.preset) {
    if (this.status === 'disposed') return
    this.preset = preset; this.track = []; this.hits = []; this.events = []; this.nextEventId = 1
    this.world = this.createWorld()
    this.clock.reset()
    this.clock.droppedSeconds = 0
  }
  snapshot(): WorldState { return structuredClone(this.world) }
  dispose() { this.status = 'disposed'; this.clock.reset() }
}
