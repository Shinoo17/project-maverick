import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { GameRuntime } from '../../src/game/runtime/GameRuntime'
import { commandSchemaVersion, neutralCommand } from '../../src/game/runtime/commands'
import { createManeuverState } from '../../src/game/flight/maneuvers'
import { FlightInput } from '../../src/game/input/FlightInput'
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
    // FR1 (flight rewrite) added `psm`, the Space PSM override (schema 3); the gun lock added the optional `gunTrack` (schema 4).
    expect(Object.keys(command).sort()).toEqual(['actions', 'afterburner', 'airbrake', 'entityId', 'gunHeld', 'pitch', 'psm', 'roll', 'speedAdjust', 'tick', 'yaw'])
    expect(commandSchemaVersion).toBe(4)
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

describe('live key input', () => {
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
