import { describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { GameRuntime } from '../src/game/runtime/GameRuntime'
import { neutralCommand, type PilotCommand } from '../src/game/runtime/commands'
import { FLIGHT_STEP } from '../src/game/runtime/clock'
import { readFlight } from '../src/game/flight/readout'
import { stepCoreFlight, createCoreFlight } from '../src/game/flightCore/step'
import { coreAssistOf, coreProfileOf, f22Core, validateCoreAssist, validateCoreProfile, type CoreTuning } from '../src/game/flightCore/profile'
import { FlightInput } from '../src/game/input/FlightInput'
import { GRAVITY } from '../src/game/flightCore/aero'
import { practiceSpawns, type PracticePreset } from '../src/game/playground/practice'
import type { AircraftState } from '../src/game/state/WorldState'
import { runFlightReplay } from '../src/game/playground/replay'

/* FR1 (docs/flight-rewrite-plan.md §3.3–§3.6, §6): the rewrite core's hard invariants and the
   FR1 acceptance cases FC-01, FC-10 and FC-16. */

const DEG = Math.PI / 180
type Script = (tick: number) => Partial<PilotCommand>
const config = (aircraftId = 'f22') => ({ mode: 'playground' as const, mapId: 'flat-range' as const, aircraftIds: [aircraftId], flightCore: 'new' as const })

/** A fresh aircraft on the new core, at `speed` and `altitude`, nose pitched `pitchDeg` up, flying along its nose. */
function aircraft(aircraftId = 'f22', speed = 130, altitude = 2000, pitchDeg = 0): AircraftState {
  const state = new GameRuntime(config(aircraftId)).snapshot().aircraft[0]
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), pitchDeg * DEG)
  state.orientation = { x: q.x, y: q.y, z: q.z, w: q.w }
  const v = new Vector3(speed, 0, 0).applyQuaternion(q)
  state.velocity = { x: v.x, y: v.y, z: v.z }
  state.position = { x: 0, y: altitude, z: 0 }
  state.coreFlight = createCoreFlight(aircraftId, speed)
  return state
}
/** Steps the core directly at FLIGHT_STEP; `each` sees the state after every step. */
function fly(state: AircraftState, seconds: number, script: Script, each?: (state: AircraftState, step: number) => void, tuning?: CoreTuning) {
  const steps = Math.round(seconds / FLIGHT_STEP)
  for (let step = 0; step < steps; step++) {
    stepCoreFlight(state, { ...neutralCommand(step, state.id), ...script(step) }, FLIGHT_STEP, tuning)
    each?.(state, step)
  }
  return state
}
const energy = (s: AircraftState) => 0.5 * (s.velocity.x ** 2 + s.velocity.y ** 2 + s.velocity.z ** 2) + GRAVITY * s.position.y
const speedOf = (s: AircraftState) => Math.hypot(s.velocity.x, s.velocity.y, s.velocity.z)
function finite(value: unknown, path = 'state'): string[] {
  if (typeof value === 'number') return Number.isFinite(value) ? [] : [path]
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([key, entry]) => finite(entry, `${path}.${key}`))
  return []
}
// A deterministic stick-stirring script: every axis jumps to a new full or partial deflection each half second.
function stirred(seed: number): Script {
  let s = seed
  const next = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32 * 2 - 1 }
  const table = Array.from({ length: 200 }, () => ({ pitch: Math.sign(next()) * Math.min(1, Math.abs(next()) * 1.5), roll: next(), yaw: next(), speedAdjust: Math.round(next()), afterburner: next() > 0.5, airbrake: next() > 0.6, psm: next() > 0.7 }))
  return tick => table[Math.floor(tick * FLIGHT_STEP * 2) % table.length]
}

describe('new core hard invariants', () => {
  it('is deterministic', () => {
    const run = () => {
      const runtime = new GameRuntime({ ...config('su57'), targetDrone: 'bot' })
      runtime.start()
      const script = stirred(7)
      for (let frame = 0; frame < 600; frame++) runtime.advance(1 / 60, (tick, id) => ({ ...neutralCommand(tick, id), ...script(tick * 2) }))
      return runtime.snapshot()
    }
    expect(run()).toEqual(run())
  })

  it.each([
    ['stirred sticks', () => aircraft('f22', 130, 3000), stirred(1), 40],
    ['stirred sticks, Su-57', () => aircraft('su57', 90, 3000), stirred(2), 40],
    ['vertical climb hands-off into a tail slide', () => aircraft('f22', 100, 3000, 90), () => ({}), 25],
    ['vertical climb, stick held back through zero speed', () => aircraft('f22', 80, 3000, 90), () => ({ pitch: 1, roll: 0.3 }), 25],
    ['from rest', () => aircraft('f22', 0, 3000), () => ({ pitch: 1, yaw: 1 }), 20],
    ['nose straight down at rest', () => aircraft('f22', 0, 3000, -90), () => ({ roll: 1 }), 10],
    ['flying backwards', () => { const s = aircraft('f22', 60, 3000); s.velocity.x = -60; return s }, () => ({ pitch: -1 }), 15],
  ] as const)('stays finite: %s', (_name, start, script, seconds) => {
    const bad: string[] = []
    fly(start(), seconds, script, state => { if (!bad.length) bad.push(...finite(state), ...finite(readFlight(state), 'readout')) })
    expect(bad).toEqual([])
  })

  it('makes no energy: with no thrust, turning only ever loses it', () => {
    const tuning: CoreTuning = { profiles: { f22: { thrustDry: 1e-9, thrustBurner: 1e-9 } } }
    const state = aircraft('f22', 150, 3000)
    state.coreFlight!.power = 0
    let previous = energy(state), worst = -Infinity
    fly(state, 40, stirred(3), s => { const e = energy(s); worst = Math.max(worst, e - previous); previous = e }, tuning)
    expect(worst).toBeLessThanOrEqual(1e-9)
  })

  it('makes no energy beyond the thrust work', () => {
    const state = aircraft('f22', 150, 3000)
    let worst = -Infinity
    const steps = Math.round(40 / FLIGHT_STEP), script = stirred(4)
    for (let step = 0; step < steps; step++) {
      const before = energy(state), speed = speedOf(state)
      stepCoreFlight(state, { ...neutralCommand(step, state.id), ...script(step) }, FLIGHT_STEP)
      worst = Math.max(worst, energy(state) - before - state.coreFlight!.diag.thrust * speed * FLIGHT_STEP)
    }
    expect(worst).toBeLessThanOrEqual(1e-6)
  })

  // e^-3 is 5%; maxAccel slows the first moments a little, so 3τ is held to 10% and 4τ to 2%.
  it.each(['f22', 'su57'])('%s: a released stick stops pitch and roll within ~3τ', aircraftId => {
    const p = coreProfileOf(aircraftId)
    for (const axis of ['pitch', 'roll'] as const) {
      const state = fly(aircraft(aircraftId, 130, 3000), 1, () => ({ [axis]: 1 }))
      expect(Math.abs(state.rates[axis]) / DEG).toBeGreaterThan(0.5 * p.maxRate[axis])
      fly(state, 3 * p.tau[axis], () => ({}))
      expect(Math.abs(state.rates[axis]) / DEG).toBeLessThan(0.1 * p.maxRate[axis])
      fly(state, p.tau[axis], () => ({}))
      expect(Math.abs(state.rates[axis]) / DEG).toBeLessThan(0.02 * p.maxRate[axis])
    }
  })

  it('validates profiles: the alpha limit must stay below the stall', () => {
    expect(() => validateCoreProfile(f22Core)).not.toThrow()
    expect(() => validateCoreProfile({ ...f22Core, aoaLimitDeg: 30 })).toThrow('aoaLimitDeg')
    expect(() => validateCoreProfile({ ...f22Core, thrustBurner: 10 })).toThrow('thrustBurner')
    expect(() => validateCoreAssist(coreAssistOf({ assist: { digitalRise: 0 } }))).toThrow('digitalRise')
    expect(() => new GameRuntime(config()).tuneCore({ assist: { turnHoldSeconds: -1 } })).toThrow('turnHoldSeconds')
  })
})

describe('new core readout', () => {
  it('ends a step on its own observation, and fills every field', () => {
    const state = fly(aircraft('su57', 120, 3000), 2, () => ({ pitch: 1, roll: 0.4 }))
    const flight = readFlight(state)
    expect(flight.incidenceDeg).toBe(flight.noseVelocityDeg)
    expect(finite(flight)).toEqual([])
    expect(flight.psmAuthority).toBe(0)
    expect(readFlight(aircraft('f22-notvc')).nozzle).toBeNull()
    expect(readFlight(aircraft('f22')).nozzle).not.toBeNull()
  })
})

describe('FC-01: a held pull never enters PSM by accident', () => {
  it.each((Object.keys(practiceSpawns) as PracticePreset[]).flatMap(preset => [[preset, false], [preset, true]] as const))('%s spawn, PSM key %s', (preset, psm) => {
    const runtime = new GameRuntime(config())
    runtime.reset(preset); runtime.start()
    let peak = 0, postStall = 0
    for (let frame = 0; frame < 60 * 15; frame++) {
      runtime.advance(1 / 60, (tick, id) => ({ ...neutralCommand(tick, id), pitch: 1, psm }))
      const state = runtime.snapshot().aircraft[0], flight = readFlight(state)
      // Still flying the whole time: a wreck would pass the alpha checks for nothing.
      expect(state.alive).toBe(true)
      if (flight.angleConfidence > 0.5) peak = Math.max(peak, flight.incidenceDeg)
      postStall = Math.max(postStall, flight.postStall)
      expect(flight.psmAuthority).toBe(0)
    }
    const p = coreProfileOf('f22')
    // The pull reached the alpha limit (it bleeds below corner speed in every case), and never past the stall.
    expect(peak).toBeGreaterThan(p.aoaLimitDeg - 3)
    expect(peak).toBeLessThan(p.alphaCritDeg)
    expect(postStall).toBe(0)
  })
})

describe('FC-10: S + airbrake before PSM slows by physics, and the hold never fights it', () => {
  it('bleeds speed with the throttle idle, then holds the new speed', () => {
    const state = aircraft('f22', 140, 3000)
    let last = speedOf(state), rising = 0
    fly(state, 5, () => ({ speedAdjust: -1, airbrake: true }), s => {
      expect(s.coreFlight!.throttle).toBe(0)
      rising = Math.max(rising, speedOf(s) - last); last = speedOf(s)
    })
    expect(rising).toBeLessThanOrEqual(0)
    const released = speedOf(state)
    expect(released).toBeLessThan(110)
    let lowest = Infinity, highest = 0
    fly(state, 10, () => ({}), s => { lowest = Math.min(lowest, speedOf(s)); highest = Math.max(highest, speedOf(s)) })
    expect(state.coreFlight!.speedTarget).toBeCloseTo(released, 0)
    expect(highest).toBeLessThan(released + 3)
    expect(lowest).toBeGreaterThan(released - 6)
    expect(Math.abs(speedOf(state) - released)).toBeLessThan(1.5)
  })
})

describe('FC-16: the same input script flies the same at 30, 60 and 144 FPS', () => {
  it('is exact at every frame rate', () => {
    const script = stirred(11)
    const at = (fps: number) => {
      const runtime = new GameRuntime({ ...config('su57'), targetDrone: 'bot' })
      runtime.start()
      while (runtime.snapshot().tick < 600) runtime.advance(1 / fps, (tick, id) => ({ ...neutralCommand(tick, id), ...script(tick * 2) }))
      return runtime.snapshot()
    }
    const at60 = at(60)
    expect(at60.tick).toBe(600)
    expect(at(30)).toEqual(at60)
    expect(at(144)).toEqual(at60)
  })
  it('is exact with the keyboard too: shaped keys and the coordinated turn, pose refreshed per tick as the flight scene does', () => {
    const at = (fps: number) => {
      const runtime = new GameRuntime(config())
      runtime.reset('highG'); runtime.start()
      const input = new FlightInput(); input.core = { profile: coreProfileOf('f22'), assist: coreAssistOf() }
      while (runtime.snapshot().tick < 720) runtime.advance(1 / fps, (tick, id) => {
        const keys = tick < 300 ? ['ArrowRight', 'KeyW'] : tick < 420 ? ['ArrowUp', 'KeyA'] : []
        input.held.clear(); keys.forEach(code => input.held.add(code))
        input.pose = runtime.snapshot().aircraft[0]
        return input.command(tick, id, 'keyboard')
      })
      return runtime.snapshot()
    }
    const at60 = at(60)
    expect(at(30)).toEqual(at60)
    expect(at(144)).toEqual(at60)
  })
})

describe('new core replays and tuning', () => {
  const script = stirred(5)
  const fly60 = (tuning?: CoreTuning, retuneAt?: number) => {
    const runtime = new GameRuntime(config('su57'))
    if (tuning) runtime.tuneCore(tuning)
    runtime.reset(); runtime.start()
    for (let frame = 0; frame < 300; frame++) {
      if (frame === retuneAt) runtime.tuneCore({ profiles: { su57: { gLimit: 7 } } })
      runtime.advance(1 / 60, (tick, id) => ({ ...neutralCommand(tick, id), ...script(tick * 2) }))
    }
    return { replay: runtime.exportReplay(), snapshot: runtime.snapshot() }
  }
  it('replays exactly, tuned from the start or not', () => {
    for (const tuning of [undefined, { profiles: { su57: { maxRate: { pitch: 40, roll: 120, yaw: 30 }, gLimit: 6 } }, assist: { ratchetG: 2 } }]) {
      const { replay, snapshot } = fly60(tuning)
      expect(replay.coreTuning).toEqual(tuning)
      expect(runFlightReplay(replay)).toEqual(snapshot)
    }
    expect(fly60({ profiles: { su57: { gLimit: 6 } } }).snapshot).not.toEqual(fly60().snapshot)
  })
  it('refuses a tuning the core cannot fly, and marks a flight retuned mid-way as not replayable', () => {
    expect(() => new GameRuntime(config()).tuneCore({ profiles: { f22: { aoaLimitDeg: 40 } } })).toThrow('aoaLimitDeg')
    const { replay } = fly60(undefined, 120)
    expect(replay.coreTunedTick).toBe(120)
    expect(() => runFlightReplay(replay)).toThrow('Unsupported flight replay')
  })
  it('never touches the content profiles', () => {
    const before = structuredClone(coreProfileOf('su57'))
    fly60({ profiles: { su57: { gLimit: 5 } } })
    expect(coreProfileOf('su57')).toEqual(before)
  })
})
