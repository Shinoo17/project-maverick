/*
Keyboard bindings for flight, as plain data.

Every flight action has two slots (primary, secondary) holding a `KeyboardEvent.code`
('KeyW', 'ShiftLeft', …) or null. Codes name the physical key, so a Thai keyboard layout
flies the same way. Afterburner, airbrake and PSM can be held or toggled.

Bindings version 2 (flight rewrite FR1, docs/flight-rewrite-plan.md §4.2): Space became the
PSM override, the airbrake moved to X, and ←/→ became the coordinated turn instead of a second
roll key. A version 1 save is migrated once, before it is read (migrateBindingsV1).

Ids are stable save-file values. Labels come from the locale files (`bindAction_<id>`).
*/

export const flightActions = [
  'pitchUp', 'pitchDown', 'rollLeft', 'rollRight', 'yawLeft', 'yawRight',
  'speedUp', 'speedDown', 'afterburner', 'airbrake', 'cameraCycle', 'lookBack',
  // Newer actions go last: a saved key wins over a new action's default (parseBindings claims in this order).
  'fireGun', 'nextTarget', 'fireMissile', 'selectMissile1', 'selectMissile2', 'freeLook', 'countermeasure',
  'selectMissile3', 'selectMissile4',
  'psm', 'turnLeft', 'turnRight',
] as const
export type FlightAction = typeof flightActions[number]
/** The keys that pick missile slot 0, 1, 2 and 3 (the seeker's slot, in missileStations order). */
export const missileSelectActions = ['selectMissile1', 'selectMissile2', 'selectMissile3', 'selectMissile4'] as const satisfies readonly FlightAction[]

export type BindingSlots = [primary: string | null, secondary: string | null]
export type KeyBindings = Record<FlightAction, BindingSlots>
export type PressMode = 'hold' | 'toggle'
export type InputPreset = 'mouse' | 'keyboard'

export interface KeyboardSettings {
  /** The bindings layout this save was written with (see the header). */
  bindingsVersion: typeof bindingsVersion
  preset: InputPreset
  bindings: KeyBindings
  afterburner: PressMode
  airbrake: PressMode
  psm: PressMode
}
export const bindingsVersion = 2

export const defaultBindings: Readonly<KeyBindings> = {
  pitchUp: ['ArrowUp', null], pitchDown: ['ArrowDown', null],
  rollLeft: ['KeyA', null], rollRight: ['KeyD', null],
  yawLeft: ['KeyQ', null], yawRight: ['KeyE', null],
  speedUp: ['KeyW', null], speedDown: ['KeyS', null],
  // Space holds the PSM override; X is the airbrake (not Ctrl: Ctrl+W closes the tab).
  afterburner: ['ShiftLeft', 'ShiftRight'], airbrake: ['KeyX', null], psm: ['Space', null],
  // ←/→ bank to a set angle and pull to hold height; released, the wings come back level.
  turnLeft: ['ArrowLeft', null], turnRight: ['ArrowRight', null],
  // Left mouse also fires in the mouse preset (FlightInput.mouseGun); J is the keyboard gun key (doc 02).
  fireGun: ['KeyJ', null],
  // T steps the gun's selected target (doc 02).
  nextTarget: ['KeyT', null],
  // Right mouse also launches in the mouse preset; 1–4 pick missile slot 1–4 (short range first).
  fireMissile: ['KeyK', null], selectMissile1: ['Digit1', null], selectMissile2: ['Digit2', null],
  selectMissile3: ['Digit3', null], selectMissile4: ['Digit4', null],
  // C held turns the camera with the mouse; R held looks back. Both leave the jet on its course.
  cameraCycle: ['KeyV', null], lookBack: ['KeyR', null], freeLook: ['KeyC', null],
  // F drops a salvo of flares and chaff together (doc 02).
  countermeasure: ['KeyF', null],
}

export const defaultKeyboardSettings: Readonly<KeyboardSettings> = {
  bindingsVersion, preset: 'mouse', bindings: defaultBindings, afterburner: 'hold', airbrake: 'hold', psm: 'hold',
}

/** Actions whose key does nothing yet. The Settings page lists them as pending. */
export const pendingActions: readonly FlightAction[] = []

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

/*
Version 1 → 2, on the raw saved bindings before parseBindings reads them. A slot moves only
while it still holds its version 1 default, so a key the player chose is never touched:
- airbrake Space → X, if no saved binding has X (else the slot empties);
- the second roll keys ArrowLeft/ArrowRight empty.
That leaves Space and the arrows free for psm and turnLeft/turnRight, which are new and so
take their defaults in parseBindings, unless the player had already put those keys elsewhere
(then the new action starts unbound rather than stealing them).
*/
export function migrateBindingsV1(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const data = Object.fromEntries(Object.entries(value).map(([action, slots]) => [action, Array.isArray(slots) ? [...slots] : slots])) as Record<string, unknown>
  const slots = (action: string) => Array.isArray(data[action]) ? data[action] as unknown[] : null
  const used = new Set(Object.values(data).flatMap(entry => Array.isArray(entry) ? entry : []))
  const airbrake = slots('airbrake')
  if (airbrake?.[0] === 'Space') airbrake[0] = used.has('KeyX') ? null : 'KeyX'
  if (slots('rollLeft')?.[1] === 'ArrowLeft') slots('rollLeft')![1] = null
  if (slots('rollRight')?.[1] === 'ArrowRight') slots('rollRight')![1] = null
  return data
}

export function parseKeyboardSettings(value: unknown): KeyboardSettings {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  // Anything before version 2 (no version field) is version 1. Read once, saved back as 2.
  const saved = data.bindingsVersion === bindingsVersion ? data.bindings : migrateBindingsV1(data.bindings)
  return {
    bindingsVersion,
    preset: data.preset === 'keyboard' ? 'keyboard' : 'mouse',
    bindings: parseBindings(saved),
    afterburner: data.afterburner === 'toggle' ? 'toggle' : 'hold',
    airbrake: data.airbrake === 'toggle' ? 'toggle' : 'hold',
    psm: data.psm === 'toggle' ? 'toggle' : 'hold',
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
