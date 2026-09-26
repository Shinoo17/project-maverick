import { createAircraft, runTrack, scenarioSetup, type Trace } from './harness'
import { limiterDirectionChanges } from './metrics'
import { getFlightProfile } from '../../src/game/flight/profile'
import { observeAirflow } from '../../src/game/flight/airflow'
import { measureControlDemand } from '../../src/game/flight/controller'
import { stepEnvelope } from '../../src/game/flight/envelope'
import { readIntent } from '../../src/game/flight/intent'
import { neutralCommand } from '../../src/game/runtime/commands'
import { FLIGHT_STEP as dt } from '../../src/game/runtime/clock'

/** Prescribed flow isolates permission from flight dynamics. The ripple's 0.5 Hz
 * frequency is near the authored filter corner, with amplitude 20% of the q band.
 * The no-ripple control verifies that the intended open/close reversal exists. */
export function energySweep(aircraftId: string, boosted: boolean, rippleFraction = 0.2) {
  const state = createAircraft(aircraftId), p = getFlightProfile(aircraftId), b = p.breakout
  const command = { ...neutralCommand(0, state.id), pitch: 1, airbrake: boosted, afterburner: boosted }
  const samples = [{ time: 0, q: b.qHigh + 0.1, limiterOpen: 0 }]
  for (let i = 0; i < 8 / dt; i++) {
    const time = (i + 1) * dt
    const sweep = (1 + Math.cos(time * Math.PI / 4)) / 2
    const q = Math.max(0, b.qLow - 0.1 + (b.qHigh - b.qLow + 0.2) * sweep
      + rippleFraction * (b.qHigh - b.qLow) * Math.sin(time * Math.PI))
    state.velocity.x = p.aero.referenceSpeedMps * Math.sqrt(q)
    const flow = observeAirflow(state, p)
    const demand = measureControlDemand(command, flow, 0, p, state.limiterOpen)
    state.intent = readIntent(command, state.intent, dt, demand.saturationRatio)
    stepEnvelope(state, flow, p, dt)
    samples.push({ time, q, limiterOpen: state.limiterOpen })
  }
  const values = samples.map(s => s.limiterOpen)
  const directionChanges = limiterDirectionChanges(values)
  const deltas = values.slice(1).map((v, i) => v - values[i]).filter(v => Math.abs(v) > 16 * Number.EPSILON)
  const intendedReversalObserved = deltas.length > 0 && deltas[0] > 0 && deltas.at(-1)! < 0 && directionChanges >= 1
  return { boosted, rippleFraction, rippleHz: 0.5, directionChanges, intendedReversalObserved,
    chatterCount: intendedReversalObserved ? directionChanges - 1 : null, samples }
}

/** Partial-stick automatic entry. Its Phase 4 C twin (B17) retired with the C key in Phase 6. */
export function partialEntry(aircraftId: string) {
  const { state, seconds } = scenarioSetup('psmIntent450', aircraftId)
  return runTrack(state, seconds, () => ({ pitch: 0.7, airbrake: true, afterburner: true }), undefined, 'psmPartial450')
}

/** Report whether the comparison actually exercises available controller range. */
export function entryDiagnostics(trace: Trace) {
  const profile = getFlightProfile(trace.aircraftId)
  const driven = trace.samples.slice(1)
  return {
    peakIncidence: Math.max(...trace.samples.map(s => observeAirflow(s.state, profile).incidenceDeg)),
    unsaturatedPitchSteps: driven.filter(s => Math.abs(s.state.flightForces!.allocation.unmet.pitch) <= 16 * Number.EPSILON).length,
    totalSteps: driven.length,
    firstPitchDrive: driven[0].state.flightForces!.controller.pitch + driven[0].state.flightForces!.tvc.pitch,
  }
}

/** Permission-only speed boundary: attached, fixed flow; X+Shift+full pull for
 * eight seconds from a closed limiter and fresh intent. No deceleration or H
 * latch can make a high initial speed look eligible after slowing down. */
export function limiter90SpeedBoundary(aircraftId: string) {
  const p = getFlightProfile(aircraftId), initial = createAircraft(aircraftId)
  const holdSeconds = 8, resolutionMps = 0.001
  const command = { ...neutralCommand(0, initial.id), pitch: 1, airbrake: true, afterburner: true }
  const atSpeed = (speed: number) => {
    const state = structuredClone(initial)
    state.velocity = { x: speed, y: 0, z: 0 }
    const flow = observeAirflow(state, p)
    for (let tick = 0; tick < holdSeconds / dt; tick++) {
      // S affects only G; this rig isolates low-energy limiter permission.
      state.intent = readIntent(command, state.intent, dt, 0)
      stepEnvelope(state, flow, p, dt)
    }
    return state.limiterOpen
  }
  let reachesMps = p.aero.referenceSpeedMps * Math.sqrt(p.breakout.qLow)
  let missesMps = p.aero.referenceSpeedMps * Math.sqrt(p.breakout.qHigh)
  let reachesLimiter = atSpeed(reachesMps), missesLimiter = atSpeed(missesMps)
  if (reachesLimiter < 0.9) return { holdSeconds, resolutionMps, reachesMps: null, missesMps, reachesLimiter, missesLimiter }
  while (missesMps - reachesMps > resolutionMps) {
    const speed = (reachesMps + missesMps) / 2, limiter = atSpeed(speed)
    if (limiter >= 0.9) { reachesMps = speed; reachesLimiter = limiter }
    else { missesMps = speed; missesLimiter = limiter }
  }
  return { holdSeconds, resolutionMps, reachesMps, missesMps, reachesLimiter, missesLimiter }
}
