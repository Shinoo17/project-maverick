/*
Keyboard bindings for flight, as plain data.

Every flight action has two slots (primary, secondary) holding a `KeyboardEvent.code`
('KeyW', 'ShiftLeft', …) or null. Codes name the physical key, so a Thai keyboard layout
flies the same way. Afterburner and airbrake can be held or toggled.

Ids are stable save-file values. Labels come from the locale files (`bindAction_<id>`).
*/

export const flightActions = [
  'pitchUp', 'pitchDown', 'rollLeft', 'rollRight', 'yawLeft', 'yawRight',
  'speedUp', 'speedDown', 'afterburner', 'airbrake', 'cameraCycle', 'lookBack',
] as const
export type FlightAction = typeof flightActions[number]

export type BindingSlots = [primary: string | null, secondary: string | null]
export type KeyBindings = Record<FlightAction, BindingSlots>
export type PressMode = 'hold' | 'toggle'
export type InputPreset = 'mouse' | 'keyboard'

export interface KeyboardSettings {
  preset: InputPreset
  bindings: KeyBindings
  afterburner: PressMode
  airbrake: PressMode
}

export const defaultBindings: Readonly<KeyBindings> = {
  pitchUp: ['ArrowUp', null], pitchDown: ['ArrowDown', null],
  rollLeft: ['KeyA', 'ArrowLeft'], rollRight: ['KeyD', 'ArrowRight'],
  yawLeft: ['KeyQ', null], yawRight: ['KeyE', null],
  speedUp: ['KeyW', null], speedDown: ['KeyS', null],
  afterburner: ['ShiftLeft', 'ShiftRight'], airbrake: ['Space', null],
  cameraCycle: ['KeyV', null], lookBack: ['KeyR', null],
}

export const defaultKeyboardSettings: Readonly<KeyboardSettings> = {
  preset: 'mouse', bindings: defaultBindings, afterburner: 'hold', airbrake: 'hold',
}

/** Actions whose key does nothing yet. The Settings page lists them as pending. */
export const pendingActions: readonly FlightAction[] = ['lookBack']

/** Keys a binding may never take: Esc and P always pause. */
export const reservedCodes: readonly string[] = ['Escape', 'KeyP']

/** Keys the browser or OS keeps for itself, or that make no sense as a flight control. */
const unusableCodes = new Set(['MetaLeft', 'MetaRight', 'ContextMenu', 'Tab', 'CapsLock', 'NumLock', 'ScrollLock', 'PrintScreen', 'Fn'])

export function isBindableCode(code: string): boolean {
  return code.length > 0 && !reservedCodes.includes(code) && !unusableCodes.has(code) && !/^F\d{1,2}$/.test(code)
}

const isCode = (value: unknown): value is string => typeof value === 'string' && isBindableCode(value)

/**
 * Reads saved bindings slot by slot. A bad slot falls back to its default, and a key that
 * appears twice keeps only its first place, so a hand-edited save cannot bind one key to two actions.
 */
export function parseBindings(value: unknown): KeyBindings {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const used = new Set<string>()
  const result = {} as KeyBindings
  for (const action of flightActions) {
    const saved = Array.isArray(data[action]) ? data[action] as unknown[] : null
    const slots = [0, 1].map(slot => {
      const code = saved ? (saved[slot] === null ? null : isCode(saved[slot]) ? saved[slot] : defaultBindings[action][slot]) : defaultBindings[action][slot]
      if (code === null || used.has(code)) return null
      used.add(code)
      return code
    })
    result[action] = [slots[0], slots[1]]
  }
  return result
}

export function parseKeyboardSettings(value: unknown): KeyboardSettings {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return {
    preset: data.preset === 'keyboard' ? 'keyboard' : 'mouse',
    bindings: parseBindings(data.bindings),
    afterburner: data.afterburner === 'toggle' ? 'toggle' : 'hold',
    airbrake: data.airbrake === 'toggle' ? 'toggle' : 'hold',
  }
}

/** The action (and slot) that a key is bound to, if any. */
export function actionForCode(bindings: KeyBindings, code: string): { action: FlightAction; slot: 0 | 1 } | null {
  for (const action of flightActions) {
    const slot = bindings[action].indexOf(code)
    if (slot === 0 || slot === 1) return { action, slot }
  }
  return null
}

export type AssignResult =
  | { status: 'done'; bindings: KeyBindings }
  | { status: 'reserved' }
  /** The key already belongs to another action. `swap` is the result if the player agrees. */
  | { status: 'conflict'; owner: FlightAction; swap: KeyBindings }

/**
 * Puts `code` into one slot. A key that is already in use is never overwritten silently:
 * the caller gets a conflict and the swapped bindings to confirm. Swapping gives the other
 * action this slot's old key (or leaves it empty).
 */
export function assignBinding(bindings: KeyBindings, action: FlightAction, slot: 0 | 1, code: string): AssignResult {
  if (!isBindableCode(code)) return { status: 'reserved' }
  const owner = actionForCode(bindings, code)
  const next = Object.fromEntries(flightActions.map(id => [id, [...bindings[id]]])) as KeyBindings
  if (owner && owner.action === action) {
    // Same action: move the key to the chosen slot and swap the two slots.
    next[action][owner.slot] = bindings[action][slot]
    next[action][slot] = code
    return { status: 'done', bindings: next }
  }
  next[action][slot] = code
  if (!owner) return { status: 'done', bindings: next }
  next[owner.action][owner.slot] = bindings[action][slot]
  return { status: 'conflict', owner: owner.action, swap: next }
}

export function clearBinding(bindings: KeyBindings, action: FlightAction, slot: 0 | 1): KeyBindings {
  const next = { ...bindings, [action]: [...bindings[action]] as BindingSlots }
  next[action][slot] = null
  return next
}

export function sameBindings(a: KeyBindings, b: KeyBindings): boolean {
  return flightActions.every(action => a[action][0] === b[action][0] && a[action][1] === b[action][1])
}
