import { MathUtils } from 'three'
import type { PilotCommand } from '../runtime/commands'
import type { CoreAssist, CoreProfile } from './profile'
import type { CoreFlightState, SpeedMode } from './state'

export interface SpeedInput {
  airspeed: number
  /** Load factor this step's forces make (G). */
  g: number
  /** Every acceleration along the path except thrust (m/s², drag and gravity), and how much of
   * the thrust reaches the path (cos of the nose–path angle). */
  alongPath: number
  thrustShare: number
}

/*
Hybrid speed, the middle way (docs/flight-rewrite-plan.md §3.6). One owner for the throttle:

- W accelerates (full dry throttle), S decelerates (idle plus a soft brake). Either sets the
  held speed to the current speed, so releasing holds where the key left it. W + S cancel
  (FlightInput sends 0) and hold.
- Released, the hold flies the throttle to the held speed through climbs and dives, never past
  dry thrust. It is a controller, not `speed = target`: feed-forward of the drag and gravity it
  must cancel, plus PI on the error, with the integral frozen while the throttle is pinned
  (anti-windup).
- Above ratchetG, or while PSM is asked (Space), the held speed follows the actual speed down
  (ratchet): speed a turn spends stays spent. Only W and the burner raise it.
- Shift lights the burner over full dry throttle and carries the held speed with it. X deploys
  the airbrake and suspends the hold (idle unless W is held); the held speed follows.
*/
/** Before the forces: the airbrake and burner move, and the S key's soft brake share is set. */
export function stepDevices(core: CoreFlightState, command: PilotCommand, p: CoreProfile, dt: number) {
  core.airbrake += (+command.airbrake - core.airbrake) * (1 - Math.exp(-12 * dt))
  stepBurner(core.burner, command.afterburner, p, dt)
  return { brake: command.speedAdjust < 0 && !core.burner.active ? -command.speedAdjust : 0 }
}

/** After the forces: the throttle and the engine. Returns this step's thrust (m/s²). */
export function stepThrottle(core: CoreFlightState, command: PilotCommand, input: SpeedInput, p: CoreProfile, assist: CoreAssist, dt: number) {
  const { airspeed: v } = input
  const burning = core.burner.active
  let mode: SpeedMode = 'hold', throttle: number
  const ratchet = !burning && command.speedAdjust <= 0 && (input.g > assist.ratchetG || command.psm)
  if (command.speedAdjust > 0) { mode = 'accelerate'; throttle = command.speedAdjust }
  else if (burning) { mode = 'burner'; throttle = 1 }
  else if (command.speedAdjust < 0) { mode = 'decelerate'; throttle = 0 }
  else if (command.airbrake) { mode = 'airbrake'; throttle = 0 }
  else {
    if (ratchet) core.speedTarget = Math.min(core.speedTarget, v)
    const error = core.speedTarget - v
    const feedForward = -input.alongPath / (p.thrustDry * Math.max(input.thrustShare, 0.2))
    const unclamped = feedForward + assist.holdGain * error + core.holdIntegral
    throttle = MathUtils.clamp(unclamped, 0, 1)
    // Integrate only while the throttle can still act on the error.
    if (unclamped === throttle || (unclamped > 1 && error < 0) || (unclamped < 0 && error > 0))
      core.holdIntegral = MathUtils.clamp(core.holdIntegral + assist.holdIntegral * error * dt, -0.3, 0.3)
  }
  if (mode !== 'hold') { core.speedTarget = v; core.holdIntegral = 0 }
  core.throttle = throttle
  const demand = throttle + (burning ? p.thrustBurner / p.thrustDry - 1 : 0)
  core.power += (demand - core.power) * (1 - Math.exp(-p.spool * dt))
  core.diag.speed = { mode, ratchet: mode === 'hold' && ratchet, throttle, integral: core.holdIntegral }
  return core.power * p.thrustDry
}

/** The burner's reserve: burnerSeconds of burn, refilling over burnerRecharge after a second's rest,
 * locked out when empty until a quarter is back. */
function stepBurner(b: CoreFlightState['burner'], requested: boolean, p: CoreProfile, dt: number) {
  b.active = requested && !b.locked && b.reserve > 0
  if (b.active) {
    b.reserve = Math.max(0, b.reserve - dt / p.burnerSeconds); b.rest = 0
    if (b.reserve === 0) b.locked = true
  } else {
    b.rest += dt
    if (b.rest > 1) b.reserve = Math.min(1, b.reserve + dt / p.burnerRecharge)
    if (b.reserve >= 0.25) b.locked = false
  }
}
