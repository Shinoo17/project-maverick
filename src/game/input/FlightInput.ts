import { neutralCommand } from '../runtime/commands'
export type InputPreset = 'mouse' | 'keyboard'
export class FlightInput {
  readonly held = new Set<string>()
  stick = { x: 0, y: 0 }
  clear() { this.held.clear(); this.stick = { x: 0, y: 0 } }
  move(x: number, y: number) {
    this.stick.x += x / 240; this.stick.y -= y / 240
    const length = Math.hypot(this.stick.x, this.stick.y)
    if (length > 1) { this.stick.x /= length; this.stick.y /= length }
  }
  command(tick: number, entityId: string, preset: InputPreset) {
    const c = neutralCommand(tick, entityId)
    const has = (...codes: string[]) => codes.some(code => this.held.has(code))
    const axis = (v: number) => Math.sign(v) * Math.pow(Math.max(0, (Math.abs(v) - 0.05) / 0.95), 1.4)
    const pitchKeys = has('ArrowUp', 'ArrowDown'), rollKeys = has('KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight')
    c.pitch = pitchKeys ? +has('ArrowUp') - +has('ArrowDown') : preset === 'mouse' ? axis(this.stick.y) : 0
    c.roll = rollKeys ? +has('KeyD', 'ArrowRight') - +has('KeyA', 'ArrowLeft') : preset === 'mouse' ? axis(this.stick.x) : 0
    c.yaw = has('KeyQ', 'KeyE') ? +has('KeyE') - +has('KeyQ') : c.roll * 0.12
    c.speedAdjust = +has('KeyW') - +has('KeyS')
    c.airbrake = has('KeyX')
    return c
  }
}
