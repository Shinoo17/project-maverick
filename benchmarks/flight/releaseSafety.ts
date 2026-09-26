import { createAircraft, runTrack, type StepObserver } from './harness'

/** Review reproduction shared by CI and the report: residual powered rate near
 * zero airspeed, followed by neutral axes with W either released or held.
 * Phase 6: the archived C hold became Airbrake (Space), the automatic entry key.
 */
export function runPsmNeutralRelease(aircraftId: string, speedAdjust: number, seconds = 40, observer?: StepObserver) {
  const state = createAircraft(aircraftId)
  state.position.y = 4000
  state.velocity = { x: 105, y: 0, z: 0 }
  const held = runTrack(state, 5, () => ({ airbrake: true, pitch: 1, speedAdjust: 1 }), observer, 'heldBrake5')
  const trace = runTrack(held.samples.at(-1)!.state, seconds, () => ({ speedAdjust }), observer, 'neutralAfterBrake5')
  return { held, trace }
}
