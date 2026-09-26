import { describe, expect, it } from 'vitest'
import { FlightInput } from '../src/game/input/FlightInput'
import { MOUSE_RELATIVE, MOUSE_STICK, defaultMouseSettings, parseMouseSettings, readStickAxes, type MouseSettings } from '../src/game/input/mouseStick'
import { neutralCommand } from '../src/game/runtime/commands'
import { WORLD_STEP } from '../src/game/runtime/clock'
import { parseSettings } from '../src/platform/storage'
import { runFlightReplay } from '../src/game/playground/replay'
import { positionalHorizon, runAtFps } from './invariants/helpers'

/* MR1 (docs/psm-maneuver-control-plan.md §4, §5 MR1): relative spring stick, body control
   frame, shaping settings. Input only: no PilotCommand field, schema or physics change. */
const relative = (patch: Partial<MouseSettings> = {}) => {
  const input = new FlightInput({ ...defaultMouseSettings, ...patch }); input.setViewport(1000, 1000); input.engage()
  return input
}
const full = 1000 / 2 * MOUSE_RELATIVE.reach

describe('MR1 mouse modes', () => {
  it('defaults to the relative stick in the body frame (owner decision D5)', () => {
    expect(defaultMouseSettings).toEqual({ mode: 'relative', frame: 'body', sensitivity: 1, invertPitch: false, xAxis: 'roll' })
    expect(new FlightInput().mouse).toEqual(defaultMouseSettings)
  })

  it('springs back to exact neutral once per command tick, however often a tick is read', () => {
    const input = relative()
    input.move(0, -full)
    const first = input.command(0, 'a', 'mouse')
    // A second read of the same tick (another frame, the same tick) does not spring again.
    expect(input.command(0, 'a', 'mouse')).toEqual(first)
    // Motion since the last tick is read in full, so a sweep held at full stick reads full.
    expect(first.pitch).toBeCloseTo(1, 9)
    const decay = Math.exp(-WORLD_STEP / MOUSE_RELATIVE.returnSeconds)
    input.command(1, 'a', 'mouse')
    expect(input.stick.py).toBeCloseTo(-full * decay, 9)
    // Ticks nobody read still spring: tick 3 after tick 1 springs twice.
    input.command(3, 'a', 'mouse')
    expect(input.stick.py).toBeCloseTo(-full * decay ** 3, 9)
    // A resting hand reaches exact neutral, so the controller's neutral branch engages.
    let tick = 4
    while (tick < 400 && input.stick.py !== 0) input.command(tick++, 'a', 'mouse')
    expect(tick).toBeLessThan(120)
    expect(input.command(tick, 'a', 'mouse')).toEqual(neutralCommand(tick, 'a'))
  })

  // Inside the full-deflection circle. At the circle the radial clamp acts per motion event,
  // exactly as the positional stick's gate does: the event stream, not the frame rate, decides.
  it('depends only on the motion inside each tick, not on how it arrived', () => {
    const run = (chunks: number) => {
      const input = relative()
      return Array.from({ length: 90 }, (_, tick) => {
        const dx = tick < 30 ? 3 : tick < 50 ? -6 : 0, dy = tick < 40 ? -4 : 1
        for (let i = 0; i < chunks; i++) input.move(dx / chunks, dy / chunks)
        return input.command(tick, 'a', 'mouse')
      })
    }
    const reference = run(1)
    expect(run(2)).toEqual(reference); expect(run(4)).toEqual(reference)
  })

  it.each(['f22', 'su57'])('%s relative stick replays identically at 30/60/144 FPS (I2)', id => {
    const run = (fps: number) => {
      const input = relative()
      return runAtFps(fps, id, (tick, entityId) => {
        if (tick < 40) input.move(18, -22)
        else if (tick < 70) input.move(-30, 0)
        return input.command(tick, entityId, 'mouse')
      }, 3)
    }
    const reference = run(60)
    expect(run(30)).toEqual(reference); expect(run(144)).toEqual(reference)
    expect(runFlightReplay(reference.replay)).toEqual(reference.snapshot)
  })

  it('clamps to full deflection, so a reversal answers at once', () => {
    const input = relative()
    input.move(10000, 0)
    // One tick of spring as headroom: a held full sweep still reads full after the spring.
    expect(Math.hypot(input.stick.px, input.stick.py)).toBeCloseTo(full * Math.exp(WORLD_STEP / MOUSE_RELATIVE.returnSeconds), 9)
    input.command(0, 'a', 'mouse'); input.move(10000, 0)
    expect(input.command(1, 'a', 'mouse').roll).toBe(1)
    input.move(-3 * full, 0)
    expect(input.command(1, 'a', 'mouse').roll).toBe(-1)
  })

  it('reads the body frame at every bank and incidence: mouse up is nose up', () => {
    for (const mode of ['relative', 'stick'] as const) {
      const input = relative({ mode })
      input.move(0.3 * full, -0.6 * full)
      const reference = input.command(0, 'a', 'mouse')
      expect(reference.pitch).toBeGreaterThan(0)
      for (const angle of [-Math.PI, -2, -1, 0.5, 1.5, Math.PI]) for (const highAoa of [0, 0.4, 1]) {
        input.screen = { angle, blend: 1 }; input.highAoa = highAoa
        expect(input.command(0, 'a', 'mouse')).toEqual(reference)
      }
    }
    // The horizon frame keeps the pre-MR1 polar mapping.
    const horizon = relative({ frame: 'horizon' })
    horizon.move(0, -full); horizon.screen = { angle: Math.PI, blend: 1 }
    expect(horizon.command(0, 'a', 'mouse').pitch).toBeCloseTo(-1, 9)
  })

  it('keeps keyboard priority, inverts pitch and can fly mouse X as yaw', () => {
    const input = relative()
    input.move(full, -full)
    input.press('ArrowDown'); input.press('KeyA')
    expect(input.command(0, 'a', 'mouse')).toMatchObject({ pitch: -1, roll: -1 })
    input.held.clear()
    const mouse = input.command(0, 'a', 'mouse')
    expect(mouse.pitch).toBeGreaterThan(0); expect(mouse.roll).toBeGreaterThan(0)

    const inverted = relative({ invertPitch: true })
    inverted.move(0, -full)
    expect(inverted.command(0, 'a', 'mouse').pitch).toBeCloseTo(-1, 9)

    const yaw = relative({ xAxis: 'yaw' })
    yaw.move(full, 0)
    expect(yaw.command(0, 'a', 'mouse')).toMatchObject({ roll: 0, yaw: 1 })
    yaw.press('KeyQ'); yaw.move(10000, 0)
    expect(yaw.command(1, 'a', 'mouse').yaw).toBe(1) // a held full sweep outranks a ramping pedal
    yaw.move(-full, 0); yaw.held.clear(); yaw.press('KeyA')
    expect(yaw.command(2, 'a', 'mouse').roll).toBe(-1)
  })

  it('scales motion by sensitivity', () => {
    const slow = relative({ sensitivity: 0.5 }), fast = relative({ sensitivity: 2 })
    slow.move(0, -full / 2); fast.move(0, -full / 8)
    expect(slow.stick.py).toBeCloseTo(fast.stick.py, 9)
  })

  it('reshapes the positional stick: half its reach is about a third of full deflection', () => {
    const stick = { px: 0, py: 0, x: MOUSE_STICK.reach * 0.5, y: 0, live: true }
    const roll = readStickAxes(stick)!.roll
    expect(roll).toBeGreaterThan(0.3); expect(roll).toBeLessThan(0.35)
    expect(positionalHorizon).toMatchObject({ mode: 'stick', frame: 'horizon' })
  })

  it('persists settings field by field and falls back on anything unreadable', () => {
    expect(parseMouseSettings(undefined)).toEqual(defaultMouseSettings)
    expect(parseMouseSettings({ mode: 'stick', frame: 'horizon', sensitivity: 9, invertPitch: true, xAxis: 'yaw' }))
      .toEqual({ mode: 'stick', frame: 'horizon', sensitivity: 2, invertPitch: true, xAxis: 'yaw' })
    expect(parseMouseSettings({ mode: 'spin', frame: 3, sensitivity: NaN, invertPitch: 'yes', xAxis: null })).toEqual(defaultMouseSettings)
    const stored = parseSettings(JSON.stringify({ version: 1, aircraftId: 'su57', locale: 'en', controls: { mode: 'stick', sensitivity: 0.1 } }))
    expect(stored.controls).toEqual({ ...defaultMouseSettings, mode: 'stick', sensitivity: 0.5 })
  })
})
