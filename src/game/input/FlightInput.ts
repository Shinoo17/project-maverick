import { neutralCommand } from '../runtime/commands'
import { LEVEL_FRAME, MOUSE_SENSITIVITY, clampSensitivity, clearStick, createMouseStick, engageStick, moveStick, readStickAxes, refitStick, type ScreenFrame } from './mouseStick'
export type InputPreset = 'mouse' | 'keyboard'
// A held key is always full deflection and the shaped stick never is, so "strictly larger
// wins" gives the keyboard priority over the mouse without a special case for it.
const strongest = (digital: number, analog: number) => Math.abs(analog) > Math.abs(digital) ? analog : digital
export class FlightInput {
  readonly held = new Set<string>()
  readonly stick = createMouseStick()
  // Shorter side of the flight surface, in pixels; the gate is a fraction of it.
  extent = 480
  // Divides the gate radius: turn it up and less of the screen is a full deflection.
  sensitivity: number = MOUSE_SENSITIVITY.default
  // How far the airframe appears rotated inside the frame, and how much of that applies.
  screen: ScreenFrame = LEVEL_FRAME
  clear() { this.held.clear(); clearStick(this.stick); this.screen = LEVEL_FRAME }
  // The surface has taken the pointer: neutral and live from the first frame.
  engage() { engageStick(this.stick) }
  setViewport(width: number, height: number) {
    const extent = Math.min(width, height)
    if (!(extent > 0) || extent === this.extent) return
    this.extent = extent
    refitStick(this.stick, extent, this.sensitivity)
  }
  setSensitivity(value: number) {
    this.sensitivity = clampSensitivity(value)
    refitStick(this.stick, this.extent, this.sensitivity)
  }
  move(x: number, y: number) { moveStick(this.stick, x, y, this.extent, this.sensitivity) }
  command(tick: number, entityId: string, preset: InputPreset) {
    const c = neutralCommand(tick, entityId)
    const has = (...codes: string[]) => codes.some(code => this.held.has(code))
    c.pitch = has('ArrowUp', 'ArrowDown') ? +has('ArrowUp') - +has('ArrowDown') : 0
    c.roll = has('KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight') ? +has('KeyD', 'ArrowRight') - +has('KeyA', 'ArrowLeft') : 0
    // Coordination is read off the keyboard roll before the mouse joins, so the keyboard
    // keeps the axes it was tuned on and a mouse roll adds no yaw of its own.
    c.yaw = has('KeyQ', 'KeyE') ? +has('KeyE') - +has('KeyQ') : c.roll * 0.12
    if (preset === 'mouse') {
      const axes = readStickAxes(this.stick, this.screen)
      if (axes) { c.pitch = strongest(c.pitch, axes.pitch); c.roll = strongest(c.roll, axes.roll) }
    }
    c.speedAdjust = +has('KeyW') - +has('KeyS')
    c.airbrake = has('KeyX')
    return c
  }
}
