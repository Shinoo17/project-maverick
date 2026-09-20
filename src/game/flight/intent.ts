import type { PilotCommand } from '../runtime/commands'

export interface PilotIntent {
  demand: number
  saturation: number
  sustained: number
  brakeIntent: number
  powerIntent: number
}
export const createPilotIntent = (): PilotIntent => ({ demand: 0, saturation: 0, sustained: 0, brakeIntent: 0, powerIntent: 0 })
const smooth = (v: number, lo: number, hi: number) => {
  const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo)))
  return t * t * (3 - 2 * t)
}
/** Player inputs only. Saturation is controller feedback against normal path support,
 * never a TVC/engine capability or governor request. No airframe/profile access. */
export function readIntent(command: PilotCommand, previous: PilotIntent, dt: number, requestedToLimitedRate: number): PilotIntent {
  const demand = smooth(Math.hypot(command.pitch, command.yaw), 0.6, 1)
  const saturation = smooth(requestedToLimitedRate, 1, 1.6)
  return {
    demand, saturation,
    // Sustained demand is deliberately low-weight; S belongs only to the G path.
    sustained: previous.sustained + (demand - previous.sustained) * (1 - Math.exp(-dt / 0.4)),
    brakeIntent: previous.brakeIntent + (+command.airbrake - previous.brakeIntent) * (1 - Math.exp(-12 * dt)),
    powerIntent: Math.max(+command.afterburner, Math.max(0, command.speedAdjust) * 0.4),
  }
}
