import { neutralCommand } from '../runtime/commands'
import { LEVEL_FRAME, clearStick, createMouseStick, engageStick, moveStick, readStickAxes, refitStick, stickGate, type ScreenFrame, type StickGate } from './mouseStick'
export type InputPreset = 'mouse' | 'keyboard'
// A held key is always full deflection and the shaped stick never is, so "strictly larger
// wins" gives the keyboard priority over the mouse without a special case for it.
const strongest = (digital: number, analog: number) => Math.abs(analog) > Math.abs(digital) ? analog : digital
export class FlightInput {
  readonly held = new Set<string>()
  // Body-axis stick in PSM allows a continuous pull through vertical/inverted.
  psmControl = false
  press(code: string) { this.held.add(code) }
  readonly stick = createMouseStick()
  // The flight surface in pixels, and the gate that spans it.
  width = 640; height = 480
  gate: StickGate = stickGate(640, 480)
  // How far the airframe appears rotated inside the frame, and how much of that applies.
  screen: ScreenFrame = LEVEL_FRAME
  clear() { this.psmControl = false; this.held.clear(); clearStick(this.stick); this.screen = LEVEL_FRAME }
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
    // Coordination is read off the keyboard roll before the mouse joins, so the keyboard
    // keeps the axes it was tuned on and a mouse roll adds no yaw of its own.
    c.yaw = has('KeyQ', 'KeyE') ? +has('KeyE') - +has('KeyQ') : c.roll * 0.12
    if (preset === 'mouse') {
      const axes = readStickAxes(this.stick, has('KeyC') || this.psmControl ? LEVEL_FRAME : this.screen)
      if (axes) { c.pitch = strongest(c.pitch, axes.pitch); c.roll = strongest(c.roll, axes.roll) }
    }
    c.speedAdjust = +has('KeyW') - +has('KeyS')
    c.airbrake = has('KeyX')
    c.highG = has('Space')
    c.afterburner = has('ShiftLeft', 'ShiftRight')
    c.psmArm = has('KeyC')
    return c
  }
}
