import { neutralCommand } from '../runtime/commands'
import { WORLD_STEP } from '../runtime/clock'
import { LEVEL_FRAME, clearStick, createMouseStick, engageStick, moveStick, readStickAxes, refitStick, stickGate, type ScreenFrame, type StickGate } from './mouseStick'
export type InputPreset = 'mouse' | 'keyboard'
// A held key is always full deflection and the shaped stick never is, so "strictly larger
// wins" gives the keyboard priority over the mouse without a special case for it.
const strongest = (digital: number, analog: number) => Math.abs(analog) > Math.abs(digital) ? analog : digital
/** Seconds for Q/E pedal travel from centre to full deflection. */
export const PEDAL_RAMP_SECONDS = 0.2
export class FlightInput {
  readonly held = new Set<string>()
  // Flow observation refreshed on simulation ticks.
  highAoa = 0
  // Q/E pedal travel. It advances one step per command tick, never per rendered frame,
  // and the recorded command carries the ramped value, so replays match exactly.
  // Linear, so a released pedal reaches exact neutral and the controller's neutral branch engages.
  pedal = 0
  private pedalTick = -1
  press(code: string) { this.held.add(code) }
  readonly stick = createMouseStick()
  // The flight surface in pixels, and the gate that spans it.
  width = 640; height = 480
  gate: StickGate = stickGate(640, 480)
  // How far the airframe appears rotated inside the frame, and how much of that applies.
  screen: ScreenFrame = LEVEL_FRAME
  clear() { this.highAoa = 0; this.pedal = 0; this.pedalTick = -1; this.held.clear(); clearStick(this.stick); this.screen = LEVEL_FRAME }
  // The surface has taken the pointer: neutral and live from the first frame.
  engage() { engageStick(this.stick) }
  setViewport(width: number, height: number) {
    if (!(width > 0 && height > 0) || (width === this.width && height === this.height)) return
    this.width = width; this.height = height
    this.gate = stickGate(width, height)
    refitStick(this.stick, this.gate)
  }
  move(x: number, y: number) { moveStick(this.stick, x, y, this.gate) }
  command(tick: number, entityId: string, preset: InputPreset) {
    const c = neutralCommand(tick, entityId)
    const has = (...codes: string[]) => codes.some(code => this.held.has(code))
    c.pitch = has('ArrowUp', 'ArrowDown') ? +has('ArrowUp') - +has('ArrowDown') : 0
    c.roll = has('KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight') ? +has('KeyD', 'ArrowRight') - +has('KeyA', 'ArrowLeft') : 0
    this.stepPedal(tick, +has('KeyE') - +has('KeyQ'))
    // Coordination is read off the keyboard roll before the mouse joins, so the keyboard
    // keeps the axes it was tuned on and a mouse roll adds no yaw of its own. A held pedal
    // key owns the axis (Q + E together is zero); a released pedal hands back to coordination.
    c.yaw = has('KeyQ', 'KeyE') ? this.pedal : this.pedal + (1 - Math.abs(this.pedal)) * c.roll * 0.12
    if (preset === 'mouse') {
      const axes = readStickAxes(this.stick, this.screen, this.highAoa)
      if (axes) { c.pitch = strongest(c.pitch, axes.pitch); c.roll = strongest(c.roll, axes.roll) }
    }
    c.speedAdjust = +has('KeyW') - +has('KeyS')
    c.airbrake = has('Space')
    c.afterburner = has('ShiftLeft', 'ShiftRight')
    return c
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
