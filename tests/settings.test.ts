import { describe, expect, it } from 'vitest'
import { backRoute, openSettings, parentRoute } from '../src/app/routes'
import { parseCameraFov } from '../src/game/camera/cameraSettings'
import { FlightInput } from '../src/game/input/FlightInput'
import { defaultMouseSettings } from '../src/game/input/mouseStick'
import {
  assignBinding, defaultBindings, defaultKeyboardSettings, isBindableCode, parseBindings, parseKeyboardSettings, type KeyBindings,
} from '../src/game/input/keyBindings'
import { stepChoice, stepSlider, type ChoiceRow, type SliderRow } from '../src/features/settings/rows'
import { effectiveUiScale, parseDisplaySettings, parseSettings, resolveReducedMotion } from '../src/platform/storage'
import { defaultGraphicsSettings, graphicsPreset, parseGraphicsSettings, presetValues } from '../src/render/graphicsSettings'

describe('saved settings', () => {
  it('reads a save from before the Settings page with every new group at its default', () => {
    const settings = parseSettings(JSON.stringify({ version: 1, aircraftId: 'su57', locale: 'en' }))
    expect(settings.aircraftId).toBe('su57')
    expect(settings.keyboard).toEqual(defaultKeyboardSettings)
    expect(settings.graphics).toEqual(defaultGraphicsSettings)
    expect(settings.display).toEqual({ uiScale: 100, reducedMotion: 'auto' })
    expect(settings.cameraFov).toBe(56)
  })

  it('clamps and snaps out-of-range numbers', () => {
    expect(parseCameraFov(120)).toBe(70)
    expect(parseCameraFov(Number.NaN)).toBe(56)
    expect(parseDisplaySettings({ uiScale: 137, reducedMotion: 'maybe' })).toEqual({ uiScale: 120, reducedMotion: 'auto' })
    expect(parseDisplaySettings({ uiScale: 94 }).uiScale).toBe(90)
  })

  it('enlarges the UI only as far as the window has room', () => {
    expect(effectiveUiScale(80, 1280, 720)).toBe(0.8)
    expect(effectiveUiScale(120, 1280, 720)).toBe(1)
    expect(effectiveUiScale(120, 1440, 810)).toBeCloseTo(1.125)
    expect(effectiveUiScale(120, 1920, 1080)).toBe(1.2)
  })

  it('lets Reduced motion override the system setting only when not Auto', () => {
    expect(resolveReducedMotion('auto', true)).toBe(true)
    expect(resolveReducedMotion('auto', false)).toBe(false)
    expect(resolveReducedMotion('on', false)).toBe(true)
    expect(resolveReducedMotion('off', true)).toBe(false)
  })
})

describe('graphics presets', () => {
  it('names the preset the values match and calls anything else Custom', () => {
    expect(graphicsPreset(defaultGraphicsSettings)).toBe('high')
    expect(graphicsPreset({ ...presetValues.low, showFps: true })).toBe('low')
    expect(graphicsPreset({ ...presetValues.medium, vapor: 'high', showFps: false })).toBe('custom')
  })

  it('drops unknown values field by field', () => {
    expect(parseGraphicsSettings({ renderScale: 3, frameRate: 120, exhaust: 'ultra', antialias: false }))
      .toEqual({ ...defaultGraphicsSettings, frameRate: 120, antialias: false })
  })
})

describe('key bindings', () => {
  it('never lets a hand-edited save bind one key to two actions', () => {
    const parsed = parseBindings({ pitchUp: ['KeyW', null], speedUp: ['KeyW', null], airbrake: ['Escape', 'KeyB'] })
    expect(parsed.pitchUp).toEqual(['KeyW', null])
    // speedUp's W is taken, so the slot empties rather than stealing it.
    expect(parsed.speedUp).toEqual([null, null])
    // Esc is reserved: the slot falls back to its default.
    expect(parsed.airbrake).toEqual(['Space', 'KeyB'])
  })

  it('keeps Esc, P and function keys for the game and the browser', () => {
    expect(isBindableCode('Escape')).toBe(false)
    expect(isBindableCode('KeyP')).toBe(false)
    expect(isBindableCode('F5')).toBe(false)
    expect(isBindableCode('F12')).toBe(false)
    expect(isBindableCode('KeyF')).toBe(true)
    expect(assignBinding(defaultBindings, 'airbrake', 0, 'KeyP')).toEqual({ status: 'reserved' })
  })

  it('binds a free key at once', () => {
    const result = assignBinding(defaultBindings, 'airbrake', 1, 'KeyB')
    expect(result.status).toBe('done')
    expect(result.status === 'done' && result.bindings.airbrake).toEqual(['Space', 'KeyB'])
  })

  it('asks before taking a key from another action, and swaps on yes', () => {
    const result = assignBinding(defaultBindings, 'speedUp', 0, 'KeyE')
    expect(result.status).toBe('conflict')
    if (result.status !== 'conflict') return
    expect(result.owner).toBe('yawRight')
    expect(result.swap.speedUp[0]).toBe('KeyE')
    expect(result.swap.yawRight[0]).toBe('KeyW')
  })

  it('moves a key between the two slots of the same action', () => {
    const result = assignBinding(defaultBindings, 'rollLeft', 1, 'KeyA')
    expect(result.status === 'done' && result.bindings.rollLeft).toEqual(['ArrowLeft', 'KeyA'])
  })

  it('flies with rebound keys', () => {
    const bindings: KeyBindings = { ...defaultBindings, pitchUp: ['KeyI', null] }
    const input = new FlightInput(defaultMouseSettings, parseKeyboardSettings({ bindings }))
    input.press('KeyI')
    expect(input.command(0, 'a', 'keyboard').pitch).toBe(1)
    input.held.clear(); input.press('ArrowUp')
    expect(input.command(1, 'a', 'keyboard').pitch).toBe(0)
  })

  it('latches a toggle-mode afterburner on one press, ignores key repeat, and clears on pause', () => {
    const input = new FlightInput(defaultMouseSettings, { ...defaultKeyboardSettings, afterburner: 'toggle' })
    input.press('ShiftLeft'); input.held.delete('ShiftLeft')
    expect(input.command(0, 'a', 'keyboard').afterburner).toBe(true)
    input.press('ShiftLeft', true)
    expect(input.command(1, 'a', 'keyboard').afterburner).toBe(true)
    input.press('ShiftLeft')
    expect(input.command(2, 'a', 'keyboard').afterburner).toBe(false)
    input.press('ShiftLeft'); input.clear()
    expect(input.command(3, 'a', 'keyboard').afterburner).toBe(false)
  })
})

describe('settings rows and route', () => {
  const choice = (index: number, count = 3) => ({ index, options: Array.from({ length: count }, (_, value) => ({ value, label: '' })) }) as unknown as ChoiceRow
  it('steps choices without wrapping, and steps into the list from Custom', () => {
    expect(stepChoice(choice(0), -1)).toBeNull()
    expect(stepChoice(choice(0), 1)).toBe(1)
    expect(stepChoice(choice(2), 1)).toBeNull()
    expect(stepChoice(choice(-1), 1)).toBe(0)
    expect(stepChoice(choice(-1), -1)).toBe(2)
  })

  it('keeps slider steps on the grid and inside the range', () => {
    const slider = { value: 1.9, min: 0.5, max: 2, step: 0.1 } as SliderRow
    expect(stepSlider(slider, 1)).toBe(2)
    expect(stepSlider({ ...slider, value: 2 }, 1)).toBe(2)
    expect(stepSlider({ ...slider, value: 0.5 }, -1)).toBe(0.5)
  })

  it('goes back from Settings to the screen that opened it', () => {
    // navigate() writes location.hash; tests run without a browser.
    const global = globalThis as { location?: { hash: string } }
    global.location ??= { hash: '' }
    expect(parentRoute.settings).toBe('home')
    openSettings('hangar')
    expect(backRoute('settings')).toBe('hangar')
    openSettings('home')
    expect(backRoute('settings')).toBe('home')
  })
})
