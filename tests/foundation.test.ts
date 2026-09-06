import { describe, expect, it } from 'vitest'
import { GameRuntime } from '../src/game/runtime/GameRuntime'
import { FixedClock } from '../src/game/runtime/clock'
import { aircraft, getAircraft } from '../src/content/aircraft'
import { validateAircraft, validateSession } from '../src/content/validate'
import { parseSettings } from '../src/platform/storage'

describe('headless foundation', () => {
  it('creates independent entity IDs, even for the same aircraft, and serializes safely', () => {
    const runtime = new GameRuntime({ mode: 'playground', aircraftIds: ['f22', 'f22'] })
    const snapshot = runtime.snapshot()
    expect(new Set(snapshot.aircraft.map((item) => item.id)).size).toBe(2)
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot)
    snapshot.aircraft[0].position.x = 999
    expect(runtime.snapshot().aircraft[0].position.x).toBe(0)
  })
  it('ticks identically at 30, 60 and 144 render FPS', () => {
    const results = [30, 60, 144].map((fps) => {
      const runtime = new GameRuntime({ mode: 'playground', aircraftIds: ['f22', 'su57'] })
      runtime.start()
      for (let frame = 0; frame < fps * 10; frame++) runtime.advance(1 / fps)
      return runtime.snapshot()
    })
    expect(results[0].tick).toBe(600)
    expect(results[1]).toEqual(results[0])
    expect(results[2]).toEqual(results[0])
  })
  it('is safe through 20 setup/cleanup cycles and never creates a clock driver', () => {
    for (let cycle = 0; cycle < 20; cycle++) {
      const runtime = new GameRuntime({ mode: 'offline', aircraftIds: ['f22', 'su57'] })
      runtime.start(); runtime.start(); runtime.advance(1 / 60)
      expect(runtime.snapshot().tick).toBe(1)
      runtime.advance(1 / 120); runtime.pause(); runtime.advance(30)
      runtime.resume(); runtime.advance(1 / 120)
      expect(runtime.snapshot().tick).toBe(1)
      runtime.reset(); expect(runtime.snapshot().tick).toBe(0)
      runtime.dispose(); runtime.dispose(); runtime.start(); runtime.resume(); runtime.advance(1)
      expect(runtime.snapshot().tick).toBe(0)
    }
  })
  it('bounds catchup and rejects invalid time', () => {
    const clock = new FixedClock()
    let ticks = 0
    clock.advance(2, () => ticks++)
    expect(ticks).toBe(6)
    expect(clock.droppedSeconds).toBeCloseTo(1.9)
    for (const value of [NaN, Infinity, -1]) expect(() => clock.advance(value, () => {})).toThrow('clock.delta')
  })
})

describe('content and persisted settings', () => {
  it('validates the registry and reports field paths for invalid content', () => {
    expect(() => validateAircraft(aircraft)).not.toThrow()
    expect(() => getAircraft('unknown')).toThrow('aircraftId')
    expect(() => validateAircraft([{ ...aircraft[0], rotation: [0, NaN, 0] }])).toThrow('aircraft[0].rotation')
    expect(() => validateAircraft([{ ...aircraft[0], modelFile: '../outside.glb' }])).toThrow('modelFile')
    expect(() => validateAircraft([aircraft[0], aircraft[0]])).toThrow('aircraft[1].id')
    expect(() => validateSession({ mode: 'offline', aircraftIds: [] })).toThrow('session.aircraftIds')
  })
  it('recovers from corrupt, unknown and future settings; preserves valid choices', () => {
    for (const raw of ['{', 'null', '[]', '{"version":2}', '{"version":1,"aircraftId":"missing"}']) {
      expect(parseSettings(raw)).toEqual({ version: 1, aircraftId: 'f22', locale: 'th' })
    }
    expect(parseSettings('{"version":1,"aircraftId":"su57","locale":"en"}')).toEqual({ version: 1, aircraftId: 'su57', locale: 'en' })
  })
})
