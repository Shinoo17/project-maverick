import type { AeroAxes as Axes } from './profileTypes'

export const axes = ['pitch', 'yaw', 'roll'] as const
export const zeroAxes = (): Axes => ({ pitch: 0, yaw: 0, roll: 0 })
/** Signed accelerations (rad/s²), including unmet demand. This is commanded
 * allocation, not a claim that a lagging/coupled actuator achieved the demand. */
export interface AllocationRecord { request: Axes; aero: Axes; tvc: Axes; floor: Axes; unmet: Axes }
export interface AllocationBudget {
  physicalAero: Axes
  tvc: Axes
  arcadeFloor: { acceleration: Axes; maxRate: Axes }
}
export type AllocationStrategy = (request: Axes, budget: AllocationBudget, participation: Axes,
  rates: Axes, dt: number) => AllocationRecord

/** Aero-first at participation=0; lead blending can be supplied later without
 * changing controller/actuator contracts. Phase 3 has no participation tuning. */
export const allocate: AllocationStrategy = (request, budget, participation, rates, dt) => {
  const record = { request: { ...request }, aero: zeroAxes(), tvc: zeroAxes(), floor: zeroAxes(), unmet: zeroAxes() }
  for (const axis of axes) {
    const sign = Math.sign(request[axis]), demand = Math.abs(request[axis])
    const lead = Math.min(budget.tvc[axis], Math.max(0, Math.min(1, participation[axis])) * demand)
    const aero = Math.min(budget.physicalAero[axis], demand - lead)
    const tvc = lead + Math.min(budget.tvc[axis] - lead, demand - lead - aero)
    const available = Math.max(0, budget.arcadeFloor.acceleration[axis] - budget.physicalAero[axis] - budget.tvc[axis])
    // Account for all reserved real authority before spending floor headroom.
    const headroom = dt > 0 ? Math.max(0, (budget.arcadeFloor.maxRate[axis] - sign * rates[axis]) / dt - aero - tvc) : 0
    const floor = Math.min(available, Math.max(0, demand - aero - tvc), headroom)
    record.aero[axis] = sign * aero; record.tvc[axis] = sign * tvc; record.floor[axis] = sign * floor
    record.unmet[axis] = sign * Math.max(0, demand - aero - tvc - floor)
  }
  return record
}
