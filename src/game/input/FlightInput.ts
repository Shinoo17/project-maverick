import { neutralCommand } from '../runtime/commands'
import { WORLD_STEP } from '../runtime/clock'
import { LEVEL_FRAME, MOUSE_RELATIVE, MOUSE_STICK, clearStick, createMouseStick, defaultMouseSettings, engageStick, moveRelativeStick, moveStick, readStickAxes, springStick, stickGate, type MouseSettings, type ScreenFrame, type StickGate } from './mouseStick'
import { actionForCode, defaultKeyboardSettings, type FlightAction, type KeyboardSettings } from './keyBindings'
export type { InputPreset } from './keyBindings'
import type { InputPreset } from './keyBindings'
// A held key is always full deflection and the shaped stick never is, so "strictly larger
// wins" gives the keyboard priority over the mouse without a special case for it.
const strongest = (digital: number, analog: number) => Math.abs(analog) > Math.abs(digital) ? analog : digital
/** Seconds for Q/E pedal travel from centre to full deflection. */
export const PEDAL_RAMP_SECONDS = 0.2
export class FlightInput {
  readonly held = new Set<string>()
  /** Mouse mode, control frame and shaping settings (MR1). Input only: the command contract
   * and physics are unchanged, and a replay records the commands these produce. */
  mouse: MouseSettings
  private springTick = -1
  // Pixels of motion since the last command tick (relative mode).
  private since = { x: 0, y: 0 }
  /** Key bindings and hold/toggle choices. Input only, like `mouse`. */
  keyboard: KeyboardSettings
  // Afterburner/airbrake switched on by a toggle-mode key press.
  private readonly latched = new Set<FlightAction>()
  constructor(mouse: MouseSettings = defaultMouseSettings, keyboard: KeyboardSettings = defaultKeyboardSettings) { this.mouse = { ...mouse }; this.keyboard = keyboard }
  // Flow observation refreshed on simulation ticks.
  highAoa = 0
  // Q/E pedal travel. It advances one step per command tick, never per rendered frame,
  // and the recorded command carries the ramped value, so replays match exactly.
  // Linear, so a released pedal reaches exact neutral and the controller's neutral branch engages.
  pedal = 0
  private pedalTick = -1
  /** A key went down. Repeats keep a held key held but never flip a toggle again. */
  press(code: string, repeat = false) {
    this.held.add(code)
    const bound = repeat ? null : actionForCode(this.keyboard.bindings, code)
    if (bound && (bound.action === 'afterburner' || bound.action === 'airbrake') && this.keyboard[bound.action] === 'toggle') {
      if (this.latched.has(bound.action)) this.latched.delete(bound.action)
      else this.latched.add(bound.action)
    }
  }
  /** True while any key bound to the action is held. */
  holds(action: FlightAction) { return this.keyboard.bindings[action].some(code => code !== null && this.held.has(code)) }
  readonly stick = createMouseStick()
  // The flight surface in pixels, and the gate that spans it.
  width = 640; height = 480
  gate: StickGate = stickGate(640, 480)
  // How far the airframe appears rotated inside the frame, and how much of that applies.
  screen: ScreenFrame = LEVEL_FRAME
  clear() { this.highAoa = 0; this.pedal = 0; this.pedalTick = -1; this.springTick = -1; this.since = { x: 0, y: 0 }; this.held.clear(); this.latched.clear(); clearStick(this.stick); this.screen = LEVEL_FRAME }
  // The surface has taken the pointer: neutral and live from the first frame.
  engage() { engageStick(this.stick); this.since = { x: 0, y: 0 } }
  setViewport(width: number, height: number) {
    if (!(width > 0 && height > 0) || (width === this.width && height === this.height)) return
    this.width = width; this.height = height
    this.gate = stickGate(width, height)
    this.move(0, 0)
  }
  move(x: number, y: number) {
    const k = this.mouse.sensitivity
    if (this.mouse.mode === 'relative') {
      const { px, py } = this.stick
      moveRelativeStick(this.stick, x * k, y * k, this.gate)
      this.since.x += this.stick.px - px; this.since.y += this.stick.py - py
    }
    else moveStick(this.stick, x * k, y * k, this.gate)
  }
  command(tick: number, entityId: string, preset: InputPreset) {
    const c = neutralCommand(tick, entityId)
    const has = (action: FlightAction) => this.holds(action)
    c.pitch = +has('pitchUp') - +has('pitchDown')
    c.roll = +has('rollRight') - +has('rollLeft')
    this.stepPedal(tick, +has('yawRight') - +has('yawLeft'))
    // Coordination is read off the keyboard roll before the mouse joins, so the keyboard
    // keeps the axes it was tuned on and a mouse roll adds no yaw of its own. A held pedal
    // key owns the axis (Q + E together is zero); a released pedal hands back to coordination.
    c.yaw = has('yawLeft') || has('yawRight') ? this.pedal : this.pedal + (1 - Math.abs(this.pedal)) * c.roll * 0.12
    if (preset === 'mouse') {
      const relative = this.mouse.mode === 'relative'
      if (relative) this.stepSpring(tick)
      // The body frame reads the stick as drawn: mouse up is nose up at every bank.
      const body = this.mouse.frame === 'body'
      const axes = readStickAxes(this.stick, body ? LEVEL_FRAME : this.screen, body ? 0 : this.highAoa, relative ? MOUSE_RELATIVE : MOUSE_STICK)
      if (axes) {
        c.pitch = strongest(c.pitch, this.mouse.invertPitch ? -axes.pitch : axes.pitch)
        if (this.mouse.xAxis === 'yaw') c.yaw = strongest(c.yaw, axes.roll)
        else c.roll = strongest(c.roll, axes.roll)
      }
    }
    c.speedAdjust = +has('speedUp') - +has('speedDown')
    c.airbrake = this.keyboard.airbrake === 'toggle' ? this.latched.has('airbrake') : has('airbrake')
    c.afterburner = this.keyboard.afterburner === 'toggle' ? this.latched.has('afterburner') : has('afterburner')
    return c
  }
  // Like the pedal: once per command tick, however many frames or reads fall inside it.
  // The stick carried from the last tick springs for the ticks in between; motion since then
  // does not, so what the hand just did is read in full.
  private stepSpring(tick: number) {
    if (tick === this.springTick) return
    const ticks = this.springTick < 0 || tick < this.springTick ? 0 : tick - this.springTick
    this.springTick = tick
    springStick(this.stick, ticks, this.gate, this.since)
    this.since = { x: 0, y: 0 }
  }
  private stepPedal(tick: number, target: number) {
    if (tick === this.pedalTick) return
    // A tick that goes backwards is a runtime reset: start again from centre.
    if (tick < this.pedalTick) this.pedal = 0
    const ticks = this.pedalTick < 0 || tick < this.pedalTick ? 1 : tick - this.pedalTick
    this.pedalTick = tick
    const travel = ticks * WORLD_STEP / PEDAL_RAMP_SECONDS
    this.pedal = Math.abs(target - this.pedal) <= travel ? target : this.pedal + Math.sign(target - this.pedal) * travel
  }
}
