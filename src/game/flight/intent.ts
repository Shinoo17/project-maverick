import type { PilotCommand } from '../runtime/commands'

export interface PilotIntent {
  demand: number
  /** Immediate activity, including roll; shared release signal for recovery. */
  activity: number
  continuation: number
  releaseSeconds: number
  saturation: number
  sustained: number
  brakeIntent: number
  decelerationIntent: number
  powerIntent: number
  /** Each stick axis's share of squared deflection (sums to 1). Holds the last
   * non-neutral split, so releasing the stick never re-weights continuation.
   * All zero before any input. Input only; profiles read it in speed.ts. */
  axisShare: { pitch: number; yaw: number; roll: number }
}
export const createPilotIntent = (): PilotIntent => ({ activity: 0, continuation: 0, releaseSeconds: 0, demand: 0, saturation: 0, sustained: 0, brakeIntent: 0, powerIntent: 0, decelerationIntent: 0, axisShare: { pitch: 0, yaw: 0, roll: 0 } })
const smooth = (v: number, lo: number, hi: number) => {
  const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo)))
  return t * t * (3 - 2 * t)
}
/** Player inputs only. Saturation is controller feedback against normal path support,
 * never a TVC/engine capability or governor request. No airframe/profile access. */
export function readIntent(command: PilotCommand, previous: PilotIntent, dt: number, requestedToLimitedRate: number, handoffSeconds = 0.22): PilotIntent {
  const demand = smooth(Math.hypot(command.pitch, command.yaw), 0.25, 0.7)
  const saturation = smooth(requestedToLimitedRate, 1, 1.6)
  const activity = smooth(Math.hypot(command.pitch, command.yaw, command.roll), 0.05, 0.35)
  // Immediate activation/counter-steer, bounded linear release to EXACT neutral.
  // No force/rate is held by this memory; only continuation permission uses it.
  const continuation = Math.max(activity, previous.continuation - dt / handoffSeconds)
  const deflection = command.pitch ** 2 + command.yaw ** 2 + command.roll ** 2
  const axisShare = deflection > 0
    ? { pitch: command.pitch ** 2 / deflection, yaw: command.yaw ** 2 / deflection, roll: command.roll ** 2 / deflection }
    : { ...previous.axisShare }
  return {
    demand, saturation, activity, continuation,
    releaseSeconds: activity > 0 ? 0 : previous.releaseSeconds + dt,
    // Sustained demand is deliberately low-weight; S belongs only to the G path.
    sustained: previous.sustained + (demand - previous.sustained) * (1 - Math.exp(-dt / 0.4)),
    brakeIntent: previous.brakeIntent + (+command.airbrake - previous.brakeIntent) * (1 - Math.exp(-12 * dt)),
    decelerationIntent: previous.decelerationIntent + (Math.max(0, -command.speedAdjust) - previous.decelerationIntent) * (1 - Math.exp(-12 * dt)),
    powerIntent: Math.max(+command.afterburner, Math.max(0, command.speedAdjust) * 0.4),
    axisShare,
  }
}
