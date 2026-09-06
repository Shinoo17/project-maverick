export const WORLD_STEP = 1 / 60
export const FLIGHT_STEP = WORLD_STEP / 2

export class FixedClock {
  private accumulator = 0
  droppedSeconds = 0

  advance(delta: number, step: () => void) {
    if (!Number.isFinite(delta) || delta < 0) throw new Error('clock.delta: expected finite non-negative seconds')
    this.droppedSeconds += Math.max(0, delta - 0.1)
    this.accumulator += Math.min(delta, 0.1)
    let ticks = 0
    while (this.accumulator + 1e-10 >= WORLD_STEP && ticks < 6) {
      step()
      this.accumulator = Math.max(0, this.accumulator - WORLD_STEP)
      ticks++
    }
    return this.accumulator / WORLD_STEP
  }

  reset() { this.accumulator = 0 }
}
