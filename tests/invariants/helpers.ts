import { Quaternion } from 'three'
import { GameRuntime } from '../../src/game/runtime/GameRuntime'
import { FixedClock, FLIGHT_STEP, WORLD_STEP } from '../../src/game/runtime/clock'
import type { PilotCommand } from '../../src/game/runtime/commands'
import type { AircraftState } from '../../src/game/state/WorldState'
import { getFlightProfile } from '../../src/game/flight/profile'
import { stepFlight } from '../../src/game/flight/stepFlight'
import type { Golden } from '../../benchmarks/flight/harness'

export function assertAircraftValid(state: AircraftState) {
  const visit = (value: unknown, path: string) => {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`I1: ${path} is ${value}`)
    if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) visit(child, `${path}.${key}`)
  }
  visit(state, state.aircraftId)
  const length = new Quaternion().copy(state.orientation).length()
  if (Math.abs(length - 1) > 1e-6) throw new Error(`I1: quaternion length ${length}`)
}

export function assertActuatorStep(state: AircraftState, previous: AircraftState, dt = FLIGHT_STEP) {
  const profile = getFlightProfile(state.aircraftId).thrustVectoring
  if (!profile) return
  for (const side of ['left', 'right'] as const) {
    const angle = state.thrustVectoring[side]
    if (Math.abs(angle) > profile.maxAngle + 1e-9) throw new Error(`I11: ${side} angle ${angle}`)
    if (Math.abs(angle - previous.thrustVectoring[side]) > profile.actuatorRate * dt + 1e-9) throw new Error(`I11: ${side} actuator slew exceeded`)
  }
}

export function mulberry32(seed: number) {
  return () => {
    let value = seed += 0x6D2B79F5
    value = Math.imul(value ^ value >>> 15, value | 1)
    value ^= value + Math.imul(value ^ value >>> 7, value | 61)
    return ((value ^ value >>> 14) >>> 0) / 4294967296
  }
}

export function runAtFps(fps: number, aircraftId: string, command: (tick: number, id: string) => PilotCommand, seconds = 6) {
  const runtime = new GameRuntime({ mode: 'playground', mapId: 'flat-range', aircraftIds: [aircraftId] })
  runtime.start()
  for (let frame = 0; frame < seconds * fps; frame++) runtime.advance(1 / fps, command)
  const result = { snapshot: runtime.snapshot(), replay: runtime.exportReplay() }
  runtime.dispose()
  return result
}

/** Every recorded substep is delivered even when a frame contains multiple world ticks. */
export function goldenAtFps(golden: Golden, fps: number) {
  const state = structuredClone(golden.initialState)
  const samples = [structuredClone(state)]
  const clock = new FixedClock()
  let step = 0, runIndex = 0
  const frames = Math.ceil(golden.totalSteps * FLIGHT_STEP * fps) + 1
  for (let frame = 0; frame < frames && step < golden.totalSteps; frame++) clock.advance(1 / fps, () => {
    for (let substep = 0; substep < WORLD_STEP / FLIGHT_STEP && step < golden.totalSteps; substep++) {
      while (step >= golden.commands[runIndex].startStep + golden.commands[runIndex].steps) runIndex++
      stepFlight(state, { ...golden.commands[runIndex].command, tick: step }, FLIGHT_STEP)
      samples.push(structuredClone(state))
      step++
    }
  })
  return samples
}
