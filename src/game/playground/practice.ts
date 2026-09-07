import type { AircraftState } from '../state/WorldState'
import type { PilotCommand } from '../runtime/commands'
export const practiceSpawns = {
  free: { altitude: 400, speed: 130 },
  cobra: { altitude: 700, speed: 105 },
  highG: { altitude: 900, speed: 155 },
  recovery: { altitude: 700, speed: 45 },
} as const
export type PracticePreset = keyof typeof practiceSpawns
export const trainingRings = [800, 1800, 2800]
export function createPracticeState() { return { rings: 0, pitch: 0, roll: 0, yaw: 0, brakeSeconds: 0, highGDegrees: 0, recovered: false, wasLow: false } }
export type PracticeState = ReturnType<typeof createPracticeState>
export function stepPractice(p: PracticeState, s: AircraftState, c: PilotCommand, previousX: number, dt: number) {
  p.pitch += Math.abs(c.pitch) * dt; p.roll += Math.abs(c.roll) * dt; p.yaw += Math.abs(c.yaw) * dt
  if (c.airbrake) p.brakeSeconds += dt
  if (s.maneuver.highG > 0.5) p.highGDegrees += s.maneuver.pathRate * dt
  const speed = Math.hypot(s.velocity.x, s.velocity.y, s.velocity.z)
  if (speed < 60) p.wasLow = true
  if (p.wasLow && speed >= 90 && s.maneuver.alpha < 20 && s.alive) p.recovered = true
  const ring = trainingRings[p.rings]
  if (ring !== undefined && previousX < ring && s.position.x >= ring) {
    // Evaluate the crossing point, not the end of the integration step.
    const fraction = (ring - previousX) / (s.position.x - previousX)
    const y = s.position.y - s.velocity.y * dt * (1 - fraction)
    const z = s.position.z - s.velocity.z * dt * (1 - fraction)
    if (Math.hypot(y - 400, z) < 60) p.rings++
  }
}
