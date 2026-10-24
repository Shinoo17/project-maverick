import type { AircraftState, Quat, Vec3 } from '../state/WorldState'
import type { PilotCommand } from '../runtime/commands'
export const practiceSpawns = {
  free: { altitude: 400, speed: 130 },
  cobra: { altitude: 700, speed: 105 },
  highG: { altitude: 900, speed: 155 },
  recovery: { altitude: 700, speed: 45 },
} as const
export type PracticePreset = keyof typeof practiceSpawns
export const trainingRings = [800, 1800, 2800]
/** Target drone (Playground modifier): a Su-57 that holds still ahead of the spawn, above the ring line.
 * Shot down, a new one appears `respawnSeconds` later, `ahead` metres in front of the player. Provisional.
 * A moving drone starts a new path from there (src/game/playground/dronePath.ts). */
export const targetDrone = { aircraftId: 'su57', ahead: 1300, above: 25, respawnSeconds: 3, minAltitude: 150 } as const
/** The player's compass heading, unit (x, z): the nose, or the flight path when the nose points straight up or down. */
function compassHeading(player: AircraftState) {
  const { x, y, z, w } = player.orientation
  // Body +X (the nose) in the world, flattened onto the ground plane.
  let fx = 1 - 2 * (y * y + z * z), fz = 2 * (x * z - w * y)
  if (Math.hypot(fx, fz) < 0.1) { fx = player.velocity.x; fz = player.velocity.z }
  if (Math.hypot(fx, fz) < 1e-6) { fx = 1; fz = 0 }
  const length = Math.hypot(fx, fz)
  return { fx: fx / length, fz: fz / length }
}
/** Level orientation with the nose along (fx, 0, fz): a yaw about world +Y. */
function facing(fx: number, fz: number): Quat {
  const yaw = Math.atan2(-fz, fx)
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }
}
/**
 * Where a respawned drone appears: `ahead` metres along the player's compass heading and `above` metres
 * higher, kept above `minAltitude`, level and facing the same way, so the player comes up behind it
 * as at the start.
 */
export function droneRespawnPose(player: AircraftState): { position: Vec3; heading: Vec3; orientation: Quat } {
  const { fx, fz } = compassHeading(player)
  return {
    position: { x: player.position.x + fx * targetDrone.ahead, y: Math.max(targetDrone.minAltitude, player.position.y + targetDrone.above), z: player.position.z + fz * targetDrone.ahead },
    heading: { x: fx, y: 0, z: fz },
    orientation: facing(fx, fz),
  }
}
/** The combat bot (target drone 'bot') starts every life as a merge: `ahead` metres along the
 * player's heading, level, flying straight at the player at `speed`, between `minAltitude` and
 * `maxAltitude`. Where that point would lie past `maxRadius` (the bot's edge guard; the range ends at
 * 8 km), it comes from the range centre's side of the player instead, so it never spawns at the
 * edge and dies there. Provisional. */
export const combatBot = { ahead: 3000, above: 100, minAltitude: 500, maxAltitude: 6000, maxRadius: 5000, speed: 150 } as const
export function botSpawnPose(player: AircraftState): { position: Vec3; heading: Vec3; orientation: Quat } {
  let { fx, fz } = compassHeading(player)
  const p = player.position
  if (Math.hypot(p.x + fx * combatBot.ahead, p.z + fz * combatBot.ahead) > combatBot.maxRadius) {
    const toCentre = Math.hypot(p.x, p.z)
    if (toCentre > 1e-6) { fx = -p.x / toCentre; fz = -p.z / toCentre }
  }
  return {
    position: { x: p.x + fx * combatBot.ahead, y: Math.min(combatBot.maxAltitude, Math.max(combatBot.minAltitude, p.y + combatBot.above)), z: p.z + fz * combatBot.ahead },
    heading: { x: -fx, y: 0, z: -fz },
    orientation: facing(-fx, -fz),
  }
}
export function createPracticeState() { return { rings: 0, pitch: 0, roll: 0, yaw: 0, brakeSeconds: 0, highGDegrees: 0, recovered: false, wasLow: false, highAoaPeak: 0, highAoaRecoveries: 0 } }
export type PracticeState = ReturnType<typeof createPracticeState>
export function stepPractice(p: PracticeState, s: AircraftState, c: PilotCommand, previousX: number, dt: number) {
  p.pitch += Math.abs(c.pitch) * dt; p.roll += Math.abs(c.roll) * dt; p.yaw += Math.abs(c.yaw) * dt
  if (c.airbrake) p.brakeSeconds += dt
  if ((s.flightForces?.envelope.gAllowance ?? 1) > 1.3) p.highGDegrees += s.maneuver.pathRate * dt
  const speed = Math.hypot(s.velocity.x, s.velocity.y, s.velocity.z)
  if (speed < 60) p.wasLow = true
  if (p.wasLow && speed >= 90 && s.maneuver.alpha < 20 && s.alive) p.recovered = true
  // Lesson observer only: incidence past 70° that returns to flying flight counts once.
  p.highAoaPeak = Math.max(p.highAoaPeak, s.maneuver.alpha)
  if (p.highAoaPeak >= 70 && s.maneuver.alpha < 20 && speed > 60 && s.alive) { p.highAoaRecoveries++; p.highAoaPeak = 0 }
  const ring = trainingRings[p.rings]
  if (ring !== undefined && previousX < ring && s.position.x >= ring) {
    // Evaluate the crossing point, not the end of the integration step.
    const fraction = (ring - previousX) / (s.position.x - previousX)
    const y = s.position.y - s.velocity.y * dt * (1 - fraction)
    const z = s.position.z - s.velocity.z * dt * (1 - fraction)
    if (Math.hypot(y - 400, z) < 60) p.rings++
  }
}
