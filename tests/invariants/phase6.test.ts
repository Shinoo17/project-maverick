import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { GameRuntime } from '../../src/game/runtime/GameRuntime'
import { commandSchemaVersion, neutralCommand } from '../../src/game/runtime/commands'
import { WORLD_STEP } from '../../src/game/runtime/clock'
import { createManeuverState } from '../../src/game/flight/maneuvers'
import { FlightInput, PEDAL_RAMP_SECONDS } from '../../src/game/input/FlightInput'
import { runFlightReplay } from '../../src/game/playground/replay'

// Code only: comments may still name the retired fields to explain their removal.
const source = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
const files = (directory: string) => readdirSync(new URL(`../../${directory}`, import.meta.url))
  .filter(name => /\.tsx?$/.test(name)).map(name => `${directory}/${name}`)

describe('I21: no legacy gates', () => {
  it('PilotCommand has no psmArm or highG field', () => {
    const command = neutralCommand(0, 'a')
    // @ts-expect-error psmArm was removed from the command contract in Phase 6.
    expect(command.psmArm).toBeUndefined()
    // @ts-expect-error highG was removed from the command contract in Phase 6.
    expect(command.highG).toBeUndefined()
    expect(Object.keys(command).sort()).toEqual(['actions', 'afterburner', 'airbrake', 'entityId', 'gunHeld', 'pitch', 'roll', 'speedAdjust', 'tick', 'yaw'])
    expect(commandSchemaVersion).toBe(2)
  })

  it('flight, input, camera and HUD never read a PSM phase or a retired command field', () => {
    const checked = [...files('src/game/flight'), ...files('src/game/input'), ...files('src/game/runtime'),
      ...files('src/game/playground'), 'src/render/FlightCamera.ts', ...files('src/features/flight')]
    for (const path of checked) expect(source(path), path).not.toMatch(/psmArm|maneuver\.phase|PsmPhase|\bm\.phase\b|command\.highG\b|maneuver\.highG\b/)
    expect(Object.keys(createManeuverState())).not.toEqual(expect.arrayContaining(['phase']))
    for (const key of ['phase', 'blend', 'blocked', 'highG', 'completed', 'peakAlpha', 'rotation', 'timer']) {
      expect(createManeuverState()).not.toHaveProperty(key)
    }
  })

  it('replays reject the pre-Phase 6 command schema', () => {
    const runtime = new GameRuntime({ mode: 'playground', aircraftIds: ['f22'] })
    runtime.start()
    for (let i = 0; i < 30; i++) runtime.advance(1 / 60, (tick, id) => ({ ...neutralCommand(tick, id), pitch: 1, airbrake: true }))
    const replay = runtime.exportReplay()
    expect(replay.schemaVersion).toBe(commandSchemaVersion)
    expect(runFlightReplay(replay)).toEqual(runtime.snapshot())
    expect(() => runFlightReplay({ ...replay, schemaVersion: 1 })).toThrow('Unsupported flight replay')
  })
})

describe('Q/E pedal ramp', () => {
  const step = WORLD_STEP / PEDAL_RAMP_SECONDS
  const ticksToFull = Math.ceil(PEDAL_RAMP_SECONDS / WORLD_STEP)

  it('ramps linearly per command tick to exactly full deflection and back to exact neutral', () => {
    const input = new FlightInput()
    input.press('KeyE')
    for (let tick = 0; tick < ticksToFull + 3; tick++) {
      expect(input.command(tick, 'a', 'keyboard').yaw).toBeCloseTo(Math.min(1, (tick + 1) * step), 12)
    }
    expect(input.command(ticksToFull + 3, 'a', 'keyboard').yaw).toBe(1)
    input.held.delete('KeyE')
    let tick = ticksToFull + 4, previous = 1
    for (; previous > 0; tick++) {
      const yaw = input.command(tick, 'a', 'keyboard').yaw
      expect(previous - yaw).toBeCloseTo(Math.min(previous, step), 12)
      previous = yaw
    }
    // Exact zero, so the controller's neutral branch (command[axis] === 0) engages.
    expect(input.command(tick, 'a', 'keyboard')).toEqual(neutralCommand(tick, 'a'))
  })

  it('is idempotent within a tick, reverses through centre, and restarts on clear or a runtime reset', () => {
    const input = new FlightInput()
    input.press('KeyQ')
    const first = input.command(5, 'a', 'keyboard').yaw
    expect(input.command(5, 'a', 'keyboard').yaw).toBe(first)
    expect(first).toBeCloseTo(-step, 12)
    for (let tick = 6; tick < 6 + ticksToFull; tick++) input.command(tick, 'a', 'keyboard')
    expect(input.pedal).toBe(-1)
    input.held.delete('KeyQ'); input.press('KeyE')
    const reversed = [0, 1, 2].map(i => input.command(6 + ticksToFull + i, 'a', 'keyboard').yaw)
    expect(reversed[1] - reversed[0]).toBeCloseTo(step, 12)
    expect(reversed[2] - reversed[1]).toBeCloseTo(step, 12)
    // GameRuntime.reset restarts ticks at zero: the pedal starts again from centre.
    expect(input.command(0, 'a', 'keyboard').yaw).toBeCloseTo(step, 12)
    input.clear(); input.press('KeyE')
    expect(input.command(1, 'a', 'keyboard').yaw).toBeCloseTo(step, 12)
  })

  it('keeps keyboard roll coordination at centre, full pedal and Q + E exactly as before', () => {
    const input = new FlightInput()
    input.press('KeyD')
    expect(input.command(0, 'a', 'keyboard').yaw).toBe(0.12)
    input.press('KeyQ')
    for (let tick = 1; tick <= ticksToFull; tick++) input.command(tick, 'a', 'keyboard')
    expect(input.command(ticksToFull + 1, 'a', 'keyboard').yaw).toBe(-1)
    // Opposite keys cancel the axis, with no coordination leaking in (02-controls resolve rule).
    const both = new FlightInput()
    both.press('KeyD'); both.press('KeyQ'); both.press('KeyE')
    for (let tick = 0; tick < 3; tick++) expect(both.command(tick, 'a', 'keyboard').yaw).toBe(0)
  })

  it('I2/I3: live key input replays exactly at 30/60/144 render FPS', () => {
    const run = (fps: number) => {
      const input = new FlightInput(), runtime = new GameRuntime({ mode: 'playground', aircraftIds: ['su57'] })
      runtime.start()
      for (let frame = 0; frame < fps * 3; frame++) runtime.advance(1 / fps, (tick, id) => {
        if (tick === 10) { input.press('KeyE'); input.press('Space') }
        if (tick === 60) { input.held.delete('KeyE'); input.press('KeyQ') }
        if (tick === 100) { input.held.delete('KeyQ'); input.held.delete('Space') }
        return input.command(tick, id, 'keyboard')
      })
      const replay = runtime.exportReplay()
      expect(replay.commands.some(command => command.yaw > 0 && command.yaw < 1)).toBe(true)
      expect(runFlightReplay(replay)).toEqual(runtime.snapshot())
      return runtime.snapshot()
    }
    const at60 = run(60)
    expect(run(30)).toEqual(at60)
    expect(run(144)).toEqual(at60)
  })
})
