import { expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { driftSpawn, driftIds } from '../benchmarks/flight/jetDrift'
import { runTrack } from '../benchmarks/flight/harness'
import { FlightInput, PEDAL_RAMP_SECONDS } from '../src/game/input/FlightInput'
import { centreStick } from '../src/game/input/mouseStick'
import { readIntent, createPilotIntent } from '../src/game/flight/intent'
import { interpretEnvelope } from '../src/game/flight/envelope'
import { observeAirflow } from '../src/game/flight/airflow'
import { getFlightProfile, validateFlightProfile } from '../src/game/flight/profile'
import { physicalPathResponse } from '../src/game/flight/pathResponse'
import { restrictIncidence } from '../src/game/flight/controller'
import { directionalBrakeStep, integrateTranslation } from '../src/game/flight/engineForces'
import { stepFlight } from '../src/game/flight/stepFlight'
import { stepSpeed } from '../src/game/flight/speed'
import { neutralCommand } from '../src/game/runtime/commands'
import { FLIGHT_STEP as dt, WORLD_STEP } from '../src/game/runtime/clock'
import { runAtFps, positionalHorizon } from './invariants/helpers'
import { runFlightReplay } from '../src/game/playground/replay'

it('real cardinal/diagonal mouse paths reach entry without changing fine aim or body-axis meaning', () => {
  for (const [x, y] of [[0, -240], [240, -240], [-240, -240]]) {
    const input = new FlightInput(positionalHorizon); input.engage(); input.move(x, y); input.press('Space')
    const command = input.command(0, 'a', 'mouse')
    expect(readIntent(command, createPilotIntent(), dt, 0).demand).toBe(1)
    expect(command.yaw).toBe(0)
    expect(input.command(1, 'a', 'mouse').pitch).toBe(command.pitch) // Stopping movement is held input.
    centreStick(input.stick)
    expect(readIntent(input.command(2, 'a', 'mouse'), createPilotIntent(), dt, 0).activity).toBe(0)
  }
  const input = new FlightInput(positionalHorizon); input.engage(); input.move(0, -30)
  expect(readIntent(input.command(0, 'a', 'mouse'), createPilotIntent(), dt, 0).demand).toBe(0)
  // Q/E ramp on the command timeline (Phase 6) and reverse through exact centre.
  const pedalStep = WORLD_STEP / PEDAL_RAMP_SECONDS
  input.press('ArrowDown'); input.press('KeyE')
  expect(input.command(1, 'a', 'mouse')).toMatchObject({ pitch: -1, yaw: pedalStep })
  input.held.delete('KeyE'); input.press('KeyQ')
  expect(input.command(2, 'a', 'mouse').yaw).toBe(0)
  expect(input.command(3, 'a', 'mouse').yaw).toBe(-pedalStep)
})

it.each([0.15, 0.22, 0.3])('all-axis continuation bridges handoff but reaches genuine release (%s s)', seconds => {
  const state = driftSpawn('f22'), p = getFlightProfile('f22')
  state.velocity = { x: 0, y: 0, z: 80 }
  const flow = observeAirflow(state, p)
  state.intent = readIntent({ ...neutralCommand(0, state.id), roll: 0.35 }, state.intent, dt, 0, seconds)
  expect(state.intent.demand).toBe(0); expect(state.intent.activity).toBe(1)
  expect(interpretEnvelope(state, flow, p).limiterTarget).toBe(1)
  expect(interpretEnvelope(state, { ...flow, incidenceDeg: 0 }, p).limiterTarget).toBe(0)
  expect(interpretEnvelope(state, { ...flow, confidence: 0 }, p).limiterTarget).toBe(0)
  for (let i = 0; i < Math.ceil(seconds / dt) + 1; i++) {
    state.intent = readIntent({ ...neutralCommand(i, state.id), airbrake: true }, state.intent, dt, 0, seconds)
    expect(state.intent.activity).toBe(0)
    if (i < 5) expect(state.intent.continuation).toBeGreaterThan(0)
  }
  expect(state.intent.continuation).toBe(0)
  expect(interpretEnvelope(state, flow, p).limiterTarget).toBe(0)
  state.intent = readIntent({ ...neutralCommand(0, state.id), pitch: -0.5 }, state.intent, dt, 0, seconds)
  expect(state.intent.activity).toBe(1); expect(state.intent.releaseSeconds).toBe(0)
})

it('physical path response is flow-only and bounded; assistance has a separate authored transition/cap', () => {
  const initial = driftSpawn('f22'), p = getFlightProfile('f22')
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.3)
  initial.orientation = { x: q.x, y: q.y, z: q.z, w: q.w }
  const flow = observeAirflow(initial, p), path = new Vector3(1, 0, 0), nose = path.clone().applyQuaternion(new Quaternion().copy(initial.orientation))
  const expected = physicalPathResponse(flow, nose, path, p)
  for (const patch of [{}, { pitch: 1, airbrake: true }, { roll: 1, yaw: 1, afterburner: true }]) {
    const state = structuredClone(initial)
    stepFlight(state, { ...neutralCommand(0, state.id), ...patch }, dt)
    const f = state.flightForces!
    expect(new Vector3().copy(f.path!.physical).distanceTo(expected)).toBeLessThan(1e-12)
    expect(new Vector3().copy(f.path!.assist).length()).toBeLessThanOrEqual(p.flight.pathAssistAcceleration + 1e-10)
    expect(Math.abs(state.pathAssistWeight - initial.pathAssistWeight)).toBeLessThanOrEqual(1 - Math.exp(-p.flight.pathAssistResponse * dt))
  }
})

it('combined limiter preserves inward/cross-axis rotation and handles mirrored/degenerate flow', () => {
  const p = getFlightProfile('f22')
  for (const alpha of [-180, -90, -10, 0, 10, 90, 180]) for (const beta of [-89.999, -60, 0, 60, 89.999]) {
    const a = alpha * Math.PI / 180, b = beta * Math.PI / 180
    const state = driftSpawn('f22'); state.velocity = { x: 100 * Math.cos(a) * Math.cos(b), y: -100 * Math.sin(a) * Math.cos(b), z: 100 * Math.sin(b) }
    const flow = observeAirflow(state, p), v = new Vector3().copy(state.velocity).normalize()
    for (const pitch of [-1, 0, 1]) for (const yaw of [-1, 0, 1]) {
      const target = { pitch, yaw, roll: 0.5 }, out = restrictIncidence(target, flow, 20, dt)
      expect(Object.values(out).every(Number.isFinite)).toBe(true)
      expect(out.roll).toBe(target.roll)
      expect(Math.hypot(out.pitch, out.yaw)).toBeLessThanOrEqual(Math.hypot(pitch, yaw) + 1e-12)
      const derivative = v.y * pitch + v.z * yaw
      if (flow.incidenceDeg > 25 && derivative < -0.01) {
        expect(v.y * out.pitch + v.z * out.yaw).toBeGreaterThanOrEqual(-0.02) // finite-step curvature tolerance
      }
      if (derivative > 0.02) expect(out).toEqual(target)
    }
  }
  const state = driftSpawn('f22'); state.velocity = { x: 0, y: 0, z: 0 }
  const target = { pitch: 1, yaw: 1, roll: 1 }
  expect(restrictIncidence(target, observeAirflow(state, p), 20, dt)).toEqual(target)
})

it('I17 allows bounded explicit control power, never non-base drag or speed-hold compensation', () => {
  const p = getFlightProfile('f22'), original = structuredClone(p), initial = driftSpawn('f22')
  const command = { ...neutralCommand(0, initial.id), pitch: 1, airbrake: true }
  const get = (intent: number) => { const state = structuredClone(initial); return { result: stepSpeed(state, command, dt, 100, intent), state } }
  const plain = get(0), active = get(1)
  expect(active.result.power.controlPower).toBe(p.flight.controlPower)
  expect(active.state.engine.requestedPower).toBeGreaterThan(plain.state.engine.requestedPower)
  expect(active.state.engine.requestedPower).toBeLessThanOrEqual(1)
  expect(active.state.engine.actualThrust).toBeLessThan(active.state.engine.requestedPower * 50)
  try {
    p.aero.alphaDrag *= 10; p.aero.betaDrag *= 10; p.aero.reverseDrag *= 10
    p.flight.turnDrag *= 10; p.flight.airbrakeDeceleration *= 10; p.stall.dragMultiplier *= 10
    expect(get(1).state.engine).toEqual(active.state.engine)
    p.flight.controlPower = 0.1
    expect(get(1).result.power.controlPower).toBe(0.1)
  } finally { Object.assign(p, original) }
})

it('I18 directional brake has exact dissipative impulse work and cannot reverse any body component', () => {
  for (const speed of [0, 0.001, 5, 100]) for (const sign of [-1, 1]) for (const duration of [dt, 1, 20]) {
    const q = new Quaternion().setFromAxisAngle(new Vector3(1, 2, 3).normalize(), 1.2)
    const body = new Vector3(speed * sign, speed * 0.5, -speed * 0.7), v = body.clone().applyQuaternion(q)
    const brake = { orientation: q, forward: 300, crossflow: 75 }
    const result = directionalBrakeStep(v, brake, 40, duration)
    const after = result.velocity.clone().applyQuaternion(q.clone().invert())
    for (const axis of ['x', 'y', 'z'] as const) expect(after[axis] * body[axis]).toBeGreaterThanOrEqual(-1e-10)
    expect(result.force.dot(v)).toBeLessThanOrEqual(1e-10)
    expect((v.lengthSq() - result.velocity.lengthSq()) / 2).toBeCloseTo(result.work, 9)
    expect(result.work).toBeGreaterThanOrEqual(0)
    expect(result.pathRate).toBeLessThanOrEqual(result.pathCap + 1e-10)
    const path = speed > 0 ? v.clone().normalize() : new Vector3(1, 0, 0)
    const out = integrateTranslation(v, path, new Vector3(30, 20, -40), new Vector3(5, -5, 0), 5, 9.81, 1, 40, dt, brake)
    const delta = (out.velocity.lengthSq() - v.lengthSq()) / 2 + 9.81 * out.velocity.y * dt
    expect(delta).toBeLessThanOrEqual(out.thrustWork - out.dragWork + 1e-8)
    expect(out.controlPathRate).toBeLessThanOrEqual(out.controlPathCap + 1e-10)
  }
})

it.each(driftIds)('%s actual keyboard/mouse handoffs replay with all new memory at 30/60/144 FPS', id => {
  const run = (fps: number) => {
    const input = new FlightInput(positionalHorizon); input.engage()
    return runAtFps(fps, id, (tick, entityId) => {
      input.held.clear(); centreStick(input.stick)
      if (tick < 60) { input.move(240, -240); input.press('Space') }
      else if (tick < 120) input.press('KeyE')
      else if (tick < 180) input.move(240, 0)
      else if (tick < 210) input.move(0, -180)
      return input.command(tick, entityId, 'mouse')
    }, 4)
  }
  const reference = run(60)
  expect(run(30)).toEqual(reference); expect(run(144)).toEqual(reference)
  expect(runFlightReplay(reference.replay)).toEqual(reference.snapshot)
  expect(() => runFlightReplay({ ...reference.replay, profileVersion: 'p4-automatic-envelope-2' })).toThrow()
})

it.each(driftIds)('%s no-C handoff obeys capability, brake-work and thrust ledgers every substep', id => {
  const initial = driftSpawn(id), p = getFlightProfile(id)
  runTrack(initial, 5, (_s, t) => ({ pitch: t < 1 ? 1 : t > 3 && t < 4 ? -0.5 : 0,
    yaw: t >= 1 && t < 2 ? 0.5 : 0, roll: t >= 2 && t < 3 ? 0.7 : 0, airbrake: t < 3 }), (s, previous) => {
    const f = s.flightForces!, energy = (state: typeof s) => new Vector3().copy(state.velocity).lengthSq() / 2 + p.flight.gravity * state.position.y
    expect(energy(s) - energy(previous)).toBeLessThanOrEqual(f.translation.thrustWork - f.translation.dragWork + 1e-7)
    expect(new Vector3().copy(f.translation.brakeForce).dot(new Vector3().copy(previous.velocity))).toBeLessThanOrEqual(1e-8)
    expect(f.power.actualThrust).toBe(s.engine.actualThrust)
    if (id === 'f22-notvc') expect(f.budget.poweredControlAvailable).toBe(0)
    if (id !== 'su57') expect(Math.abs(f.allocation.tvc.yaw)).toBe(0)
    for (const axis of ['pitch', 'yaw', 'roll'] as const) {
      const a = f.allocation
      expect(a.aero[axis] + a.tvc[axis] + a.floor[axis] + a.unmet[axis]).toBeCloseTo(a.request[axis], 10)
      expect(Math.abs(a.aero[axis])).toBeLessThanOrEqual(f.budget.physicalAero[axis] + 1e-9)
    }
  })
})

it('validates new tuning including absent fields, negative coefficients, and power caps', () => {
  for (const key of ['physicalPathResponse', 'physicalPathAcceleration', 'pathAssistAcceleration', 'pathAssistResponse', 'controlPower', 'airbrakeCrossflow'] as const) {
    for (const value of [undefined, NaN, Infinity, -1]) {
      const p = structuredClone(getFlightProfile('f22')); p.flight[key] = value as number
      expect(() => validateFlightProfile(p)).toThrow()
    }
  }
  for (const key of ['controlPower', 'airbrakeCrossflow'] as const) {
    const p = structuredClone(getFlightProfile('f22')); p.flight[key] = 1.01
    expect(() => validateFlightProfile(p)).toThrow()
  }
})


it('cross-axis limiter is continuous as pitch/yaw input crosses zero', () => {
  const state = driftSpawn('f22'), p = getFlightProfile('f22')
  for (const alpha of [-10, 0, 10]) for (const beta of [-90, -60, 60, 90]) {
    const a = alpha * Math.PI / 180, b = beta * Math.PI / 180
    state.velocity = { x: 100 * Math.cos(a) * Math.cos(b), y: -100 * Math.sin(a) * Math.cos(b), z: 100 * Math.sin(b) }
    const flow = observeAirflow(state, p)
    for (const axis of ['pitch', 'yaw'] as const) {
      const center = { pitch: 1, yaw: -1, roll: 0.5, [axis]: 0 }
      const baseline = restrictIncidence(center, flow, 20, dt)
      expect(baseline[axis]).toBe(0)
      for (const input of [-1e-9, 1e-9]) {
        const result = restrictIncidence({ ...center, [axis]: input }, flow, 20, dt)
        expect(Math.hypot(result.pitch - baseline.pitch, result.yaw - baseline.yaw)).toBeLessThan(1e-5)
      }
    }
  }
})
