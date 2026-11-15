import { describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { GameRuntime } from '../src/game/runtime/GameRuntime'
import { WORLD_STEP } from '../src/game/runtime/clock'
import { neutralCommand } from '../src/game/runtime/commands'
import type { AircraftState } from '../src/game/state/WorldState'
import { FlightInput, type InputPreset } from '../src/game/input/FlightInput'
import { defaultMouseSettings } from '../src/game/control/mouseSettings'
import { readFlight } from '../src/game/flight/readout'
import { FLIGHT } from '../src/game/arcadeCore/config'
import { ArcadeCamera } from '../src/render/ArcadeCamera'
import { PerspectiveCamera } from 'three'

/*
The 'arcade' flight core: example/flight-control's FlightModel + Fcs flying this project's
AircraftState (src/game/arcadeCore). Spawns at the example's cruise, PSM through the FCS from
the real input (Space + ↑), recovery back inside the limits, mouse aim converging on its own
rate limits, deterministic replays, and snapshot-safe state.
*/
const forwardOf = (q: { x: number; y: number; z: number; w: number }) => new Vector3(1, 0, 0).applyQuaternion(new Quaternion(q.x, q.y, q.z, q.w))
const speedOf = (s: AircraftState) => Math.hypot(s.velocity.x, s.velocity.y, s.velocity.z)

function arcade(aircraft: 'f22' | 'su57' = 'f22') {
  const runtime = new GameRuntime({ mode: 'playground', mapId: 'flat-range', aircraftIds: [aircraft], flightCore: 'arcade' })
  runtime.start()
  return runtime
}

function fly(runtime: GameRuntime, input: FlightInput, seconds: number, preset: InputPreset = 'keyboard', each?: (state: AircraftState, tick: number) => void) {
  for (let i = 0; i < Math.round(seconds / WORLD_STEP); i++) runtime.advance(WORLD_STEP, (tick, id) => {
    const live = runtime.snapshot().aircraft[0]
    input.pose = live
    each?.(live, tick)
    return input.command(tick, id, preset)
  })
  return runtime.snapshot().aircraft[0]
}

describe('arcade core', () => {
  it('spawns at the example\'s cruise and holds level flight hands-off', () => {
    const runtime = arcade(), input = new FlightInput()
    const start = runtime.snapshot().aircraft[0]
    expect(start.flightCore).toBe('arcade')
    expect(speedOf(start)).toBeCloseTo(FLIGHT.cruiseSpeed, 6)
    const after = fly(runtime, input, 5)
    expect(after.alive).toBe(true)
    expect(Math.abs(speedOf(after) - FLIGHT.cruiseSpeed)).toBeLessThan(5)
    expect(Math.abs(after.position.y - start.position.y)).toBeLessThan(60)
    // The HUD reads the example's km/h.
    expect(readFlight(after).hudSpeed).toBeCloseTo(speedOf(after) * 3.6, 6)
  })

  for (const id of ['f22', 'su57'] as const) {
    it(`Cobra from Space + ↑ at 500 km/h, then recovers inside the α limit on release (${id})`, () => {
      const runtime = arcade(id), input = new FlightInput()
      // Cobra ready: 500 km/h, where PSM is easiest (w = 1).
      runtime.reset('cobra')
      expect(speedOf(runtime.snapshot().aircraft[0]) * 3.6).toBeCloseTo(500, 6)
      expect(runtime.snapshot().aircraft[0].arcadeFlight).toBeDefined()
      let sigma = 0
      const modes = new Set<string>()
      input.press('Space'); input.press('ArrowUp')
      // Held 0.9 s the nose stands past 70° (a Cobra); held 1.6 s it goes on round (a Kulbit).
      fly(runtime, input, 0.9, 'keyboard', state => {
        sigma = Math.max(sigma, readFlight(state).incidenceDeg)
        if (state.arcadeFlight) modes.add(state.arcadeFlight.fcs.mode)
      })
      expect(modes.has('PSM')).toBe(true)
      expect(sigma).toBeGreaterThan(70)
      input.held.delete('Space'); input.held.delete('ArrowUp')
      const after = fly(runtime, input, 8, 'keyboard', state => { if (state.arcadeFlight) modes.add(state.arcadeFlight.fcs.mode) })
      expect(modes.has('RECOVERY')).toBe(true)
      expect(after.alive).toBe(true)
      expect(after.arcadeFlight!.fcs.mode).toBe('NORMAL')
      expect(readFlight(after).incidenceDeg).toBeLessThan(22)
    })
  }

  it('without Space the α limiter holds a full pull under the limit', () => {
    const runtime = arcade(), input = new FlightInput()
    let alpha = 0
    input.press('ArrowUp')
    fly(runtime, input, 3, 'keyboard', state => { alpha = Math.max(alpha, readFlight(state).alphaDeg) })
    expect(alpha).toBeLessThan(25)
  })

  it('flies the nose onto a mouse aim with its own rate limits, and settles', () => {
    const runtime = arcade(), input = new FlightInput({ ...defaultMouseSettings, aimLimit: 'limited' })
    let aim: Vector3 | null = null
    const errors: number[] = []
    fly(runtime, input, 6, 'mouse', (state, tick) => {
      if (tick === 2) {
        const q = new Quaternion().copy(state.orientation)
        const up = new Vector3(0, 1, 0).applyQuaternion(q), right = new Vector3(0, 0, 1).applyQuaternion(q)
        aim = forwardOf(state.orientation).applyAxisAngle(up, -40 * Math.PI / 180).applyAxisAngle(right, 10 * Math.PI / 180).normalize()
        input.mixer.aim.dir.copy(aim)
      }
      if (aim) errors.push(forwardOf(state.orientation).angleTo(aim) * 180 / Math.PI)
    })
    const last = errors.slice(-60)
    expect(Math.max(...last)).toBeLessThan(3)
    expect(Math.max(...last) - Math.min(...last)).toBeLessThan(1)
  })

  it('replays the same commands to the same flight, through snapshots', () => {
    const commands: ReturnType<typeof neutralCommand>[] = []
    const first = arcade(), input = new FlightInput()
    input.press('Space'); input.press('ArrowUp'); input.press('KeyD')
    fly(first, input, 1, 'keyboard', () => {})
    input.held.clear()
    for (let i = 0; i < 120; i++) first.advance(WORLD_STEP, (tick, id) => { const c = input.command(tick, id, 'keyboard'); commands.push(c); return c })
    const second = arcade(), again = new FlightInput()
    again.press('Space'); again.press('ArrowUp'); again.press('KeyD')
    fly(second, again, 1, 'keyboard', () => {})
    let i = 0
    for (let k = 0; k < 120; k++) second.advance(WORLD_STEP, () => commands[i++])
    const a = first.snapshot().aircraft[0], b = second.snapshot().aircraft[0]
    expect(b.position).toEqual(a.position)
    expect(b.orientation).toEqual(a.orientation)
    expect(structuredClone(b.arcadeFlight)).toEqual(b.arcadeFlight)
  })

  it('feeds the FCS mode to the chase camera', () => {
    const runtime = arcade(), input = new FlightInput()
    input.press('Space'); input.press('ArrowUp')
    const state = fly(runtime, input, 1)
    const camera = new PerspectiveCamera(60, 16 / 9, 0.5, 14000), rig = new ArcadeCamera()
    rig.update(camera, state, { mode: 'aim', roll: 'horizon', horizonStyle: 'balanced' }, 1 / 60)
    expect(state.arcadeFlight!.fcs.mode).not.toBe('NORMAL')
    expect(Number.isFinite(camera.position.x)).toBe(true)
  })
})
