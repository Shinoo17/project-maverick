import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PerspectiveCamera, Quaternion, Vector3 } from 'three'
import { createAircraft, runScenario } from '../benchmarks/flight/harness'
import { readFlight } from '../src/game/flight/readout'
import { flightCoreAvailable, getFlightCore } from '../src/game/flight/core'
import { stepFlight } from '../src/game/flight/stepFlight'
import { observeAirflow } from '../src/game/flight/airflow'
import { getFlightProfile } from '../src/game/flight/profile'
import { GameRuntime } from '../src/game/runtime/GameRuntime'
import { runFlightReplay } from '../src/game/playground/replay'
import { neutralCommand } from '../src/game/runtime/commands'
import { FLIGHT_STEP } from '../src/game/runtime/clock'
import { FlightCamera } from '../src/render/FlightCamera'
import { CameraTrace } from '../src/render/cameraTrace'
import type { CameraSettings } from '../src/game/camera/cameraSettings'
import type { SessionConfig } from '../src/content/schemas'

/* FR0: the FlightReadout seam, the flight core dispatch and
   CAMERA_TRACE. The legacy core still flies; these pin that the seam changes nothing. */

describe('legacy FlightReadout', () => {
  it('passes the step values through and observes the air at the pose', () => {
    const trace = runScenario('cobra', 'su57')
    const state = trace.samples[200].state, profile = getFlightProfile(state.aircraftId)
    const flight = readFlight(state), flow = observeAirflow(state, profile)
    expect(flight.noseVelocityDeg).toBe(state.maneuver.alpha)
    expect(flight.g).toBe(state.maneuver.g)
    expect(flight.pathRateDeg).toBe(state.maneuver.pathRate)
    expect(flight.power).toBe(state.enginePower)
    expect(flight.psmAuthority).toBe(state.limiterOpen)
    expect(flight.postStall).toBe(state.stall.severity)
    expect(flight.nozzle).toEqual({ left: state.thrustVectoring.left, right: state.thrustVectoring.right })
    expect(flight.gAllowance).toBe(state.flightForces!.envelope.gAllowance)
    expect([flight.airspeed, flight.alphaDeg, flight.betaDeg, flight.incidenceDeg, flight.angleConfidence])
      .toEqual([flow.airspeed, flow.alphaDeg, flow.betaDeg, flow.incidenceDeg, flow.confidence])
    // A stepped state's own pose ends where its step ended.
    expect(flight.incidenceDeg).toBe(flight.noseVelocityDeg)

    // Another pose moves only the air values.
    const pitched = new Quaternion().copy(state.orientation).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.3))
    const posed = readFlight(state, { orientation: pitched })
    expect(posed.incidenceDeg).not.toBeCloseTo(flight.incidenceDeg, 3)
    expect(posed.incidenceDeg).toBe(observeAirflow({ orientation: pitched, velocity: state.velocity }, profile).incidenceDeg)
    for (const key of ['noseVelocityDeg', 'g', 'pathRateDeg', 'power', 'burner', 'airbrake', 'psmAuthority', 'nozzle', 'postStall', 'gAllowance'] as const) expect(posed[key]).toEqual(flight[key])
  })
  it('reports no nozzle without thrust vectoring, and reads the burner states', () => {
    expect(readFlight(createAircraft('f22-notvc')).nozzle).toBeNull()
    const state = createAircraft('f22')
    expect(readFlight(state).burner.status).toBe('ready')
    state.maneuver.burnerActive = true; expect(readFlight(state).burner.status).toBe('engaged')
    state.maneuver.burnerActive = false; state.maneuver.burnerLocked = true; expect(readFlight(state).burner.status).toBe('depleted')
    state.maneuver.burnerLocked = false; state.maneuver.burner = 0.5; state.maneuver.burnerRest = 2; expect(readFlight(state).burner.status).toBe('recharging')
    expect(readFlight(state).burner.seconds).toBe(0.5 * getFlightProfile('f22').maneuver.burnerSeconds)
  })
})

describe('flight core dispatch', () => {
  const config: SessionConfig = { mode: 'playground', mapId: 'flat-range', aircraftIds: ['su57'], targetDrone: 'bot' }
  const fly = (session: SessionConfig) => {
    const runtime = new GameRuntime(session)
    runtime.reset('free'); runtime.start()
    for (let tick = 0; tick < 240; tick++) runtime.advance(1 / 60, (t, id) => ({ ...neutralCommand(t, id), pitch: Math.sin(t / 30), roll: 0.4, afterburner: t < 90 }))
    const result = { snapshot: runtime.snapshot(), replay: runtime.exportReplay() }
    runtime.dispose()
    return result
  }
  it("flies 'legacy' exactly as no setting, without tagging the state or the replay", () => {
    const plain = fly(config), legacy = fly({ ...config, flightCore: 'legacy' })
    expect(legacy.snapshot).toEqual(plain.snapshot)
    expect(legacy.replay).toEqual(plain.replay)
    expect(legacy.snapshot.aircraft.every(entity => entity.flightCore === undefined)).toBe(true)
    expect('flightCore' in legacy.replay.config).toBe(false)
  })
  it('the legacy core steps through stepFlight itself', () => {
    const a = createAircraft('f22'), b = structuredClone(a), core = getFlightCore('legacy')
    for (let i = 0; i < 120; i++) {
      const command = { ...neutralCommand(i, a.id), pitch: 1, yaw: 0.3 }
      core.step(a, command, FLIGHT_STEP); stepFlight(b, command, FLIGHT_STEP)
    }
    expect(a).toEqual(b)
  })
  // FR1 registered the new core; before it, 'new' was refused here.
  it("flies the new core once registered, and refuses any unknown core", () => {
    expect(flightCoreAvailable('new')).toBe(true)
    expect(getFlightCore('new')).not.toBe(getFlightCore('legacy'))
    const runtime = new GameRuntime({ ...config, flightCore: 'new' })
    expect(runtime.snapshot().aircraft.every(entity => entity.flightCore === 'new' && entity.coreFlight)).toBe(true)
    expect(() => new GameRuntime({ ...config, flightCore: 'old' as never })).toThrow(/session.flightCore: expected legacy or new/)
  })
  it('replays recorded before the setting existed still run', () => {
    const { replay, snapshot } = fly({ ...config, targetDrone: undefined })
    expect(runFlightReplay(replay)).toEqual(snapshot)
  })
})

describe('CAMERA_TRACE', () => {
  const views: CameraSettings[] = [{ mode: 'horizon', roll: 'horizon', horizonStyle: 'balanced' }, { mode: 'horizon', roll: 'horizon', horizonStyle: 'dynamic' }, { mode: 'aircraft', roll: 'aircraft', horizonStyle: 'balanced' }]
  it.each(views)('records every frame without changing the shot (%o)', view => {
    const samples = runScenario('kulbit', 'su57').samples.filter((_, index) => index % 2 === 0)
    const shoot = (trace: CameraTrace | null) => {
      const camera = new PerspectiveCamera(56, 16 / 9, 0.5, 14000), rig = new FlightCamera()
      rig.trace = trace
      return samples.map(sample => { rig.update(camera, sample.state, view, 1 / 60); return [camera.position.toArray(), camera.quaternion.toArray(), camera.fov] })
    }
    const trace = new CameraTrace()
    expect(shoot(trace)).toEqual(shoot(null))
    expect(trace.frames).toHaveLength(samples.length)
    const last = trace.frames.at(-1)!, state = samples.at(-1)!.state
    expect(last.frame).toBe(samples.length - 1)
    expect(last.t).toBeCloseTo(samples.length / 60, 9)
    expect(last.style).toBe(view.roll === 'aircraft' ? 'aircraft' : view.horizonStyle)
    expect(new Vector3(...last.look).length()).toBeCloseTo(1, 9)
    expect(last.flight.incidenceDeg).toBe(readFlight(state).incidenceDeg)
    expect(last.flight.rates).toEqual(state.rates)
    // The Kulbit ends post-stall: the PSM shot is in, every weight inside its range.
    const legacy = trace.frames.flatMap(frame => frame.rig === 'legacy' ? [frame] : [])
    expect(legacy).toHaveLength(samples.length)
    expect(Math.max(...legacy.map(frame => frame.blend.handover))).toBeGreaterThan(0.5)
    for (const frame of legacy) for (const key of ['decouple', 'handover', 'drift', 'driftLag', 'psm', 'decoupled', 'aimShare', 'gunZoom'] as const) {
      expect(frame.blend[key]).toBeGreaterThanOrEqual(0); expect(frame.blend[key]).toBeLessThanOrEqual(1)
    }
    expect(JSON.parse(JSON.stringify(trace)).frames).toHaveLength(samples.length)
  })
  it('keeps the newest frames once full, and starts over on clear', () => {
    const trace = new CameraTrace(3), camera = new PerspectiveCamera(), rig = new FlightCamera(), state = createAircraft('f22')
    rig.trace = trace
    for (let i = 0; i < 5; i++) rig.update(camera, state, views[0], 1 / 60)
    expect(trace.frames.map(frame => frame.frame)).toEqual([2, 3, 4])
    trace.clear()
    rig.update(camera, state, views[0], 1 / 60)
    expect(trace.frames.map(frame => frame.frame)).toEqual([0])
  })
})

/* The seam holds: outside the flight core nothing reads the legacy core's own state. Named
   exceptions are the legacy core's debug ledger, and the HUD preview, whose fixtures write that
   state (both go with the core at FR7), plus the runtime and the state type that create it.
   The arcade core (example/flight-control's physics) is a core itself: its own `PSM.stall`
   tuning and telemetry `stall` flag are not the legacy state. */
describe('FlightReadout seam', () => {
  const root = join(__dirname, '../src')
  const files = (dir: string): string[] => readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : []
  })
  const allowed = ['game/flight/', 'game/arcadeCore/', 'game/state/WorldState.ts', 'game/runtime/GameRuntime.ts', 'features/flight/LegacyFlightLab.tsx', 'features/flight/hudPreview.tsx']
  it('reads flight through readFlight only', () => {
    const offenders = files(root).map(path => relative(root, path)).filter(path => !allowed.some(prefix => path.startsWith(prefix))).flatMap(path =>
      readFileSync(join(root, path), 'utf8').split('\n').flatMap((line, index) => {
        // `profile.stall` and the like are aircraft data, not core state.
        const hits = [...line.matchAll(/\b(\w+)\.(maneuver|stall|intent|thrustVectoring|flightForces|limiterOpen|enginePower)\b/g)].filter(match => !/profile$/i.test(match[1]))
        return hits.length ? [`${path}:${index + 1}`] : []
      }))
    expect(offenders).toEqual([])
  })
})
