/*
Keyboard key icons from Kenney's Input Prompts (CC0, public/assets/input_prompts).
The SVG is used as a CSS mask, so the icon takes the text colour of wherever it sits.
Keys without an icon (numpad, media keys) fall back to their name in mono type.
A controller set can be added next to this later and chosen by the last device used.
*/
import { flightActions, type FlightAction, type KeyBindings } from '../../game/input/keyBindings'

const iconBase = `${import.meta.env.BASE_URL}assets/input_prompts/Keyboard_and_Mouse/Vector/`

// Single-glyph keys only. Wide keys (Shift, Space, Esc…) draw their name too small in a
// 64 px icon, so they are shown as text chips instead.
const named: Record<string, string> = {
  ArrowUp: 'arrow_up', ArrowDown: 'arrow_down', ArrowLeft: 'arrow_left', ArrowRight: 'arrow_right',
  Minus: 'minus', Equal: 'equals', BracketLeft: 'bracket_open', BracketRight: 'bracket_close', Semicolon: 'semicolon',
  Quote: 'apostrophe', Comma: 'comma', Period: 'period', Slash: 'slash_forward', Backslash: 'slash_back', Backquote: 'tilde',
}

function iconName(code: string): string | null {
  const letter = /^Key([A-Z])$/.exec(code)?.[1] ?? /^Digit(\d)$/.exec(code)?.[1]
  const name = letter ? letter.toLowerCase() : named[code]
  return name ? `${iconBase}keyboard_${name}_outline.svg` : null
}

/** A short readable name for a key code: 'KeyA' → 'A', 'ShiftLeft' → 'Shift L'. */
export function keyName(code: string): string {
  const letter = /^Key([A-Z])$/.exec(code)?.[1] ?? /^Digit(\d)$/.exec(code)?.[1]
  if (letter) return letter
  const arrows: Record<string, string> = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' }
  if (arrows[code]) return arrows[code]
  const side = /^(Shift|Control|Alt|Meta)(Left|Right)$/.exec(code)
  if (side) return `${side[1] === 'Control' ? 'Ctrl' : side[1]} ${side[2] === 'Left' ? 'L' : 'R'}`
  const short: Record<string, string> = { Escape: 'Esc', Backspace: 'Bksp', Delete: 'Del', PageUp: 'PgUp', PageDown: 'PgDn' }
  return short[code] ?? code.replace(/^Numpad/, 'Num ')
}

/** Primary key name per action, for text that names keys (e.g. the flight `controlsHint`). */
export function bindingNames(bindings: KeyBindings): Record<FlightAction, string> {
  return Object.fromEntries(flightActions.map(action => {
    const code = bindings[action][0] ?? bindings[action][1]
    return [action, code ? keyName(code) : '—']
  })) as Record<FlightAction, string>
}

export function KeyPrompt({ code }: { code: string }) {
  const icon = iconName(code)
  const name = keyName(code)
  if (!icon) return <kbd className="key-prompt is-text">{name}</kbd>
  return <kbd className="key-prompt" title={name} aria-label={name}>
    <span className="key-prompt-icon" style={{ maskImage: `url("${icon}")`, WebkitMaskImage: `url("${icon}")` }} aria-hidden="true" />
  </kbd>
}

/** Key icons followed by a label, e.g. [Q][E] Tab. */
export function PromptHints({ hints }: { hints: [codes: string[], label: string][] }) {
  return <ul className="prompt-hints">
    {hints.map(([codes, label]) => <li key={label}>{codes.map(code => <KeyPrompt key={code} code={code} />)}<span>{label}</span></li>)}
  </ul>
}
