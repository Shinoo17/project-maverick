import { describe, expect, it } from 'vitest'
import { FlightInput } from '../src/game/input/FlightInput'
import { defaultBindings, defaultKeyboardSettings, parseKeyboardSettings, type KeyBindings } from '../src/game/input/keyBindings'
import { parseSettings } from '../src/platform/storage'
import { GameRuntime } from '../src/game/runtime/GameRuntime'
import { coreAssist, coreProfileOf } from '../src/game/flightCore/profile'
import type { AircraftState } from '../src/game/state/WorldState'

/* FR1 (docs/flight-rewrite-plan.md §4.2, §4.4, §4.5): bindings version 2 and its migration, and
   the new core's keyboard: shaping, cancelling opposite keys, PSM and the coordinated turn. */

// Every version 1 default, as a version 1 save holds them.
const v1Defaults = {
  ...structuredClone(defaultBindings) as Record<string, unknown>,
  rollLeft: ['KeyA', 'ArrowLeft'], rollRight: ['KeyD', 'ArrowRight'], airbrake: ['Space', null],
} as Record<string, unknown>
delete v1Defaults.psm; delete v1Defaults.turnLeft; delete v1Defaults.turnRight
const v1 = (bindings: Record<string, unknown>) => ({ preset: 'keyboard', afterburner: 'hold', airbrake: 'hold', bindings: { ...v1Defaults, ...bindings } })

describe('bindings version 2', () => {
  it('moves a version 1 save onto the new defaults', () => {
    const parsed = parseKeyboardSettings(v1({}))
    expect(parsed.bindingsVersion).toBe(2)
    expect(parsed.bindings).toEqual(defaultBindings)
    expect(parsed.psm).toBe('hold')
  })
  it('never moves a key the player chose', () => {
    const b = parseKeyboardSettings(v1({ airbrake: ['KeyB', null], rollLeft: ['KeyA', 'KeyZ'] })).bindings
    expect(b.airbrake).toEqual(['KeyB', null])
    expect(b.rollLeft).toEqual(['KeyA', 'KeyZ'])
    expect(b.psm).toEqual(['Space', null])
    expect(b.turnLeft).toEqual(['ArrowLeft', null])
  })
  it('never takes a key the player put elsewhere', () => {
    // X already fires the gun: the airbrake's Space empties instead, and Space goes to PSM.
    let b: KeyBindings = parseKeyboardSettings(v1({ fireGun: ['KeyX', null] })).bindings
    expect(b.fireGun).toEqual(['KeyX', null])
    expect(b.airbrake).toEqual([null, null])
    expect(b.psm).toEqual(['Space', null])
    // Space fires the gun and the airbrake is on B: PSM starts unbound rather than stealing Space.
    b = parseKeyboardSettings(v1({ fireGun: ['Space', null], airbrake: ['KeyB', null] })).bindings
    expect(b.fireGun).toEqual(['Space', null])
    expect(b.psm).toEqual([null, null])
    // ← yaws: the coordinated turn left starts unbound.
    b = parseKeyboardSettings(v1({ yawLeft: ['KeyQ', 'ArrowLeft'] })).bindings
    expect(b.yawLeft).toEqual(['KeyQ', 'ArrowLeft'])
    expect(b.turnLeft).toEqual([null, null])
    expect(b.turnRight).toEqual(['ArrowRight', null])
  })
  it('migrates once: a version 2 save that chose Space for the airbrake keeps it through every edit', () => {
    const chosen = { ...defaultKeyboardSettings, bindings: { ...defaultBindings, airbrake: ['Space', null], psm: [null, null] } as KeyBindings }
    const parsed = parseKeyboardSettings(JSON.parse(JSON.stringify(chosen)))
    expect(parsed.bindings.airbrake).toEqual(['Space', null])
    // The settings store merges a patch over the parsed settings and parses again.
    expect(parseKeyboardSettings({ ...parsed, psm: 'toggle' }).bindings).toEqual(parsed.bindings)
    expect(parseKeyboardSettings(parseKeyboardSettings(v1({})))).toEqual(parseKeyboardSettings(v1({})))
  })
  it('migrates inside a whole saved settings blob without touching the rest', () => {
    const settings = parseSettings(JSON.stringify({ version: 1, aircraftId: 'su57', locale: 'en', keyboard: v1({ speedUp: ['KeyI', null] }) }))
    expect(settings.aircraftId).toBe('su57')
    expect(settings.keyboard.bindingsVersion).toBe(2)
    expect(settings.keyboard.bindings.airbrake).toEqual(['KeyX', null])
    expect(settings.keyboard.bindings.speedUp).toEqual(['KeyI', null])
  })
})

const newCore = () => { const input = new FlightInput(); input.core = { profile: coreProfileOf('f22'), assist: { ...coreAssist } }; return input }

describe('new core keyboard', () => {
  it('ramps a digital key over the rise and release times, once per command tick', () => {
    const input = newCore()
    input.press('ArrowUp')
    const rise = Array.from({ length: 12 }, (_, tick) => input.command(tick, 'a', 'keyboard').pitch)
    expect(rise[0]).toBeCloseTo(1 / 60 / coreAssist.digitalRise, 12)
    // Read twice in one tick: the same value (frames never step it).
    expect(input.command(11, 'a', 'keyboard').pitch).toBe(rise[11])
    expect(rise.findIndex(value => value === 1)).toBe(Math.ceil(coreAssist.digitalRise * 60) - 1)
    input.held.delete('ArrowUp')
    const release = Array.from({ length: 10 }, (_, tick) => input.command(12 + tick, 'a', 'keyboard').pitch)
    expect(release.findIndex(value => value === 0)).toBe(Math.ceil(coreAssist.digitalRelease * 60) - 1)
    // The legacy core keeps its unshaped keys.
    const legacy = new FlightInput(); legacy.press('ArrowUp')
    expect(legacy.command(0, 'a', 'keyboard').pitch).toBe(1)
  })
  it('cancels opposite keys', () => {
    const input = newCore()
    for (const [a, b] of [['ArrowUp', 'ArrowDown'], ['KeyA', 'KeyD'], ['KeyQ', 'KeyE'], ['KeyW', 'KeyS'], ['ArrowLeft', 'ArrowRight']]) {
      input.clear(); input.press(a); input.press(b)
      for (let tick = 0; tick < 20; tick++) {
        const c = input.command(tick, 'a', 'keyboard')
        expect([c.pitch, c.roll, c.yaw, c.speedAdjust]).toEqual([0, 0, 0, 0])
      }
      expect(input.turnAssist).toBe('off')
    }
  })
  it('holds or toggles PSM on Space', () => {
    const input = newCore()
    input.press('Space'); expect(input.command(0, 'a', 'keyboard').psm).toBe(true)
    input.held.delete('Space'); expect(input.command(1, 'a', 'keyboard').psm).toBe(false)
    input.keyboard = { ...input.keyboard, psm: 'toggle' }
    input.press('Space'); input.held.delete('Space'); expect(input.command(2, 'a', 'keyboard').psm).toBe(true)
    input.press('Space'); input.held.delete('Space'); expect(input.command(3, 'a', 'keyboard').psm).toBe(false)
  })
})

describe('coordinated turn (←/→)', () => {
  const bank = (s: AircraftState) => { const { x, y, z, w } = s.orientation; return Math.atan2(-2 * (y * z - w * x), 1 - 2 * (x * x + z * z)) * 180 / Math.PI }
  it('banks about 60°, holds height, and levels the wings once released', () => {
    const runtime = new GameRuntime({ mode: 'playground', mapId: 'flat-range', aircraftIds: ['f22'], flightCore: 'new' })
    runtime.reset('highG'); runtime.start()
    const input = newCore()
    const flyFor = (seconds: number, each?: (s: AircraftState) => void) => {
      for (let frame = 0; frame < seconds * 60; frame++) {
        runtime.advance(1 / 60, (tick, id) => { input.pose = runtime.snapshot().aircraft[0]; return input.command(tick, id, 'keyboard') })
        each?.(runtime.snapshot().aircraft[0])
      }
    }
    flyFor(1)
    const start = runtime.snapshot().aircraft[0]
    input.press('ArrowRight')
    let lowest = Infinity, highest = -Infinity
    flyFor(8, s => { if (s.coreFlight!.diag.limit.pitch === 'none') { lowest = Math.min(lowest, s.position.y); highest = Math.max(highest, s.position.y) } })
    const turning = runtime.snapshot().aircraft[0]
    expect(input.turnAssist).toBe('turning')
    expect(bank(turning)).toBeGreaterThan(52); expect(bank(turning)).toBeLessThan(65)
    expect(Math.abs(turning.position.y - start.position.y)).toBeLessThan(40)
    expect(highest - lowest).toBeLessThan(60)
    // Turning right from +X heads toward +Z.
    expect(turning.position.z).toBeGreaterThan(start.position.z + 100)
    input.held.delete('ArrowRight')
    flyFor(0.5)
    expect(input.turnAssist).toBe('levelling')
    flyFor(2.5)
    expect(Math.abs(bank(runtime.snapshot().aircraft[0]))).toBeLessThan(3)
    expect(input.turnAssist).toBe('off')
  })
})
