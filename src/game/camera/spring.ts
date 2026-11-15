/*
Critically damped springs in closed form (C4; spec §9.5).

One frame advances `offset` (current − target) and `rate` (d current / dt) exactly for a target
held still over the frame, so the result does not depend on how the frame time is split: two
frames of dt/2 land where one frame of dt does. No overshoot, no blow-up on a long frame.

`lag` is the spring's following lag for a target moving at a steady rate: a critically damped
spring trails a ramp by 2/ω, so ω = 2 / lag. That is how spec §9.2's "camera lag" figures are read.
*/
export const omegaOfLag = (lag: number) => 2 / Math.max(lag, 1e-3)

/** One frame of a critically damped spring at `omega` (1/s): the new offset and rate. */
export function springStep(offset: number, rate: number, omega: number, dt: number) {
  if (dt <= 0) return { offset, rate }
  const decay = Math.exp(-omega * dt), b = rate + omega * offset
  return { offset: (offset + b * dt) * decay, rate: (rate - omega * b * dt) * decay }
}

/** A scalar value following its target. */
export class Spring {
  value: number
  rate = 0
  constructor(value = 0) { this.value = value }
  step(target: number, lag: number, dt: number) {
    const next = springStep(this.value - target, this.rate, omegaOfLag(lag), dt)
    this.value = target + next.offset; this.rate = next.rate
    return this.value
  }
  snap(value: number) { this.value = value; this.rate = 0; return value }
}
