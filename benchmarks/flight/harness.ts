import { Quaternion, Vector3 } from 'three'
import { GameRuntime } from '../../src/game/runtime/GameRuntime'
import { FLIGHT_STEP } from '../../src/game/runtime/clock'
import { neutralCommand, type PilotCommand } from '../../src/game/runtime/commands'
import type { AircraftState } from '../../src/game/state/WorldState'
import { stepFlight } from '../../src/game/flight/stepFlight'
import { flightProfileVersion, getFlightProfile } from '../../src/game/flight/profile'
import { dryThrustLimit } from '../../src/game/flight/speed'
import { simulationSpeed } from '../../src/game/flight/speedLimits'
import { observeAirflow } from '../../src/game/flight/airflow'

export const aircraftIds = ['f22', 'su57'] as const
export const scenarioNames = ['hardTurn900', 'fullStick500', 'cobraC', 'kulbitC', 'reversal180C', 'tailSlide', 'pedalC', 'release45', 'sideslip60'] as const
export type ScenarioName = typeof scenarioNames[number]
export type Sample = { step: number; time: number; state: AircraftState; noseRotationDeg: number }
export type CommandRun = { startStep: number; steps: number; command: PilotCommand }
export interface Trace {
  scenario: string
  aircraftId: string
  initialState: AircraftState
  commands: CommandRun[]
  samples: Sample[] // Every flight substep, including entry. Goldens retain 0.25 s samples.
}
export interface Golden extends Omit<Trace, 'samples'> {
  recordedWithProfileVersion: string
  flightStep: number
  totalSteps: number
  samples: Sample[]
}
export type Controller = (state: Readonly<AircraftState>, time: number, noseRotationDeg: number) => Partial<PilotCommand>
export type StepObserver = (state: AircraftState, previous: AircraftState, step: number) => void
export const forward = (state: AircraftState) => new Vector3(1, 0, 0).applyQuaternion(new Quaternion().copy(state.orientation))

export function createAircraft(aircraftId: string) {
  const runtime = new GameRuntime({ mode: 'playground', mapId: 'flat-range', aircraftIds: [aircraftId] })
  const state = runtime.snapshot().aircraft[0]
  runtime.dispose()
  return state
}

export function scenarioSetup(name: ScenarioName, aircraftId: string) {
  const state = createAircraft(aircraftId)
  state.position = { x: 0, y: name === 'tailSlide' ? 2500 : 2000, z: 0 }
  const kph = name === 'hardTurn900' ? 900 : name === 'fullStick500' ? 500 : 450
  state.velocity = { x: simulationSpeed(kph), y: 0, z: 0 }
  if (name === 'tailSlide') {
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2)
    state.orientation = { x: q.x, y: q.y, z: q.z, w: q.w }
    state.velocity = { x: 0, y: 60, z: 0 }
  } else if (name === 'release45') {
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 4)
    state.orientation = { x: q.x, y: q.y, z: q.z, w: q.w }
    state.velocity.x = 70
  } else if (name === 'sideslip60') {
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -Math.PI / 3)
    state.orientation = { x: q.x, y: q.y, z: q.z, w: q.w }
    state.velocity.x = 100
  }
  const flight = getFlightProfile(aircraftId).flight
  state.enginePower = flight.drag * new Vector3().copy(state.velocity).lengthSq() / dryThrustLimit(flight, state.speedLimits)
  const seconds = name === 'kulbitC' ? 8 : name === 'release45' ? 2 : name === 'sideslip60' ? 1
    : ['hardTurn900', 'fullStick500', 'pedalC'].includes(name) ? 3 : 10
  let cobraStage = 0
  let reversalReleased = false
  const controller: Controller = (current, time, rotation) => {
    switch (name) {
      case 'hardTurn900': case 'fullStick500': return { pitch: 1 }
      case 'kulbitC': return { psmArm: true, pitch: 1, speedAdjust: 1, afterburner: true }
      case 'pedalC': return { psmArm: true, yaw: 1, speedAdjust: 1 }
      case 'reversal180C':
        reversalReleased ||= rotation >= 180
        return { psmArm: !reversalReleased, pitch: reversalReleased ? 0 : 1, speedAdjust: 1 }
      case 'cobraC': {
        const incidence = observeAirflow(current, getFlightProfile(current.aircraftId)).incidenceDeg
        if (cobraStage === 0 && (incidence >= 90 || time >= 2.5)) cobraStage = 1
        if (cobraStage === 1 && (incidence <= 25 || time >= 5)) cobraStage = 2
        return { psmArm: cobraStage < 2, pitch: cobraStage === 0 ? 1 : cobraStage === 1 ? -1 : 0, speedAdjust: 1 }
      }
      default: return {}
    }
  }
  return { state, seconds, controller }
}

export function runTrack(initialState: AircraftState, seconds: number, controller: Controller, observer?: StepObserver, scenario = 'custom'): Trace {
  const state = structuredClone(initialState)
  const samples: Sample[] = [{ step: 0, time: 0, state: structuredClone(state), noseRotationDeg: 0 }]
  const commands: CommandRun[] = []
  let noseRotationDeg = 0
  for (let step = 0; step < Math.round(seconds / FLIGHT_STEP) && state.alive; step++) {
    const previous = structuredClone(state)
    // Harness command ticks are flight substeps, unlike the public 60 Hz replay.
    const command = { ...neutralCommand(step, state.id), ...controller(state, step * FLIGHT_STEP, noseRotationDeg), tick: step, entityId: state.id }
    const last = commands.at(-1)
    if (last && JSON.stringify({ ...last.command, tick: 0 }) === JSON.stringify({ ...command, tick: 0 })) last.steps++
    else commands.push({ startStep: step, steps: 1, command: structuredClone(command) })
    stepFlight(state, command, FLIGHT_STEP)
    noseRotationDeg += forward(previous).angleTo(forward(state)) * 180 / Math.PI
    observer?.(state, previous, step + 1)
    samples.push({ step: step + 1, time: (step + 1) * FLIGHT_STEP, state: structuredClone(state), noseRotationDeg })
  }
  return { scenario, aircraftId: state.aircraftId, initialState: structuredClone(initialState), commands, samples }
}

export function runScenario(name: ScenarioName, aircraftId: string, observer?: StepObserver) {
  const { state, seconds, controller } = scenarioSetup(name, aircraftId)
  return runTrack(state, seconds, controller, observer, name)
}

export function toGolden(trace: Trace): Golden {
  const totalSteps = trace.samples.at(-1)!.step
  return { ...trace, recordedWithProfileVersion: flightProfileVersion, flightStep: FLIGHT_STEP, totalSteps,
    samples: trace.samples.filter(sample => sample.step % 30 === 0 || sample.step === totalSteps) }
}

// Merge recorded fields onto today's spawn, preserving fields introduced by later phases.
function mergeState(base: unknown, recorded: unknown): unknown {
  if (recorded === null || typeof recorded !== 'object' || Array.isArray(recorded)) return structuredClone(recorded)
  const result = { ...(base as Record<string, unknown>) }
  for (const [key, value] of Object.entries(recorded)) result[key] = mergeState(result[key], value)
  return result
}

/** Intentionally bypasses public replay version rejection; the golden CI test owns policy. */
export function replayGolden(golden: Golden, observer?: StepObserver) {
  if (golden.flightStep !== FLIGHT_STEP) throw new Error('Unsupported golden flight step')
  let expectedStep = 0
  for (const run of golden.commands) {
    if (run.startStep !== expectedStep || !Number.isInteger(run.steps) || run.steps < 1) throw new Error('Invalid golden command runs')
    expectedStep += run.steps
  }
  if (expectedStep !== golden.totalSteps) throw new Error('Incomplete golden command track')
  const initial = mergeState(createAircraft(golden.aircraftId), golden.initialState) as AircraftState
  let runIndex = 0
  return runTrack(initial, golden.totalSteps * FLIGHT_STEP, (_state, time) => {
    const step = Math.round(time / FLIGHT_STEP)
    while (step >= golden.commands[runIndex].startStep + golden.commands[runIndex].steps) runIndex++
    return golden.commands[runIndex].command
  }, observer, golden.scenario)
}

/** Recorded numbers use relative tolerance; other recorded leaves must match exactly.
 * New fields are intentionally ignored, so later phases can add state explicitly.
 */
export function compareRecordedLeaves(actual: unknown, expected: unknown, path = 'state'): string[] {
  if (typeof expected === 'number') {
    return typeof actual !== 'number' || !Number.isFinite(actual) || Math.abs(actual - expected) > 1e-9 * Math.max(1, Math.abs(expected))
      ? [`${path}: expected ${expected}, received ${actual}`] : []
  }
  if (!expected || typeof expected !== 'object') {
    return actual === expected ? [] : [`${path}: expected ${expected}, received ${actual}`]
  }
  return Object.entries(expected).flatMap(([key, value]) => compareRecordedLeaves((actual as Record<string, unknown> | undefined)?.[key], value, `${path}.${key}`))
}
