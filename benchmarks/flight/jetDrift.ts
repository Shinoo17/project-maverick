import { MathUtils, Vector3 } from 'three'
import { createAircraft, forward, runScenario, runTrack, type Controller, type Trace } from './harness'
import { getFlightProfile } from '../../src/game/flight/profile'
import { observeAirflow } from '../../src/game/flight/airflow'
import { arcadeSpeed, simulationSpeed } from '../../src/game/flight/speedLimits'
import { dryThrustLimit } from '../../src/game/flight/speed'

export const driftIds = ['f22', 'su57', 'f22-notvc'] as const
export const entrySpeeds = [350, 450, 500, 600, 650, 700] as const
export function driftSpawn(id: string, kph = 500) {
  const state = createAircraft(id), p = getFlightProfile(id)
  state.position = { x: 0, y: 3000, z: 0 }
  state.orientation = { x: 0, y: 0, z: 0, w: 1 }
  state.velocity = { x: simulationSpeed(kph), y: 0, z: 0 }
  state.enginePower = p.flight.drag * simulationSpeed(kph) ** 2 / dryThrustLimit(p.flight, state.speedLimits)
  return state
}
export function driftTracks(id: string) {
  const tracks: Trace[] = []
  const add = (name: string, controller: Controller, seconds = 4, kph = 500) => tracks.push(runTrack(driftSpawn(id, kph), seconds, controller, undefined, name))
  for (const kph of entrySpeeds) for (const axis of ['pitch', 'yaw']) add(`entry-${axis}-${kph}`, () => ({ [axis]: 1, airbrake: true }), 3, kph)
  for (const mode of ['plain', 'S', 'brake', 'burner']) add(`compare-${mode}`, () => ({ pitch: 1, speedAdjust: mode === 'S' ? -1 : 0, airbrake: mode === 'brake' || mode === 'burner', afterburner: mode === 'burner' }))
  for (const partial of [0.35, 0.5, 0.7]) add(`hold-${partial}`, (_s, t) => ({ pitch: t < 1 ? 1 : partial, airbrake: true }))
  for (const sign of [-1, 1]) add(`handoff-${sign}`, (_s, t) => ({ airbrake: t < 3.6,
    pitch: t < 1 ? sign : t >= 2.8 && t < 3.6 ? sign * 0.5 : 0,
    yaw: t >= 1.1 && t < 1.9 ? sign * 0.5 : 0, roll: t >= 2 && t < 2.7 ? sign * 0.7 : 0 }), 6)
  // Identical saved entry for every exit treatment (no regeneration per branch).
  const entry = runTrack(driftSpawn(id), 1.2, () => ({ pitch: 1, airbrake: true })).samples.at(-1)!.state
  for (const brake of [false, true]) for (const burner of ['off', 'pulse', 'held']) tracks.push(runTrack(entry, 4, (_s, t) => ({ airbrake: brake, afterburner: burner === 'held' || burner === 'pulse' && t < 0.6 }), undefined, `exit-${brake}-${burner}`))
  for (const empty of [false, true]) {
    const state = driftSpawn(id); if (empty) state.maneuver.burner = 0
    tracks.push(runTrack(state, 4, () => ({ pitch: 1, airbrake: true, afterburner: true }), undefined, `reserve-${empty ? 'empty' : 'full'}`))
  }
  const exhausted = driftSpawn(id); exhausted.maneuver.burner = 0; exhausted.maneuver.burnerLocked = true
  tracks.push(runTrack(exhausted, 4, () => ({ pitch: 1, airbrake: true, afterburner: true }), undefined, 'reserve-exhausted'))
  add('release-reapply', (_s, t) => ({ pitch: t < 1 ? 1 : t >= 1.15 && t < 2 ? -0.5 : 0, airbrake: t < 1 }))
  add('aim', () => ({ pitch: 0.15, yaw: 0.1 }))
  add('roll', () => ({ roll: 0.7 }))
  add('cruise', () => ({}))
  tracks.push(runScenario('hardTurn900', id), runScenario('fullStick500', id))
  for (const speed of [60, 120]) for (const sign of [-1, 1]) for (const pitch of [0.5, 1]) {
    const state = driftSpawn(id), a = sign * 10 * Math.PI / 180, b = -sign * 60 * Math.PI / 180
    state.velocity = { x: speed * Math.cos(a) * Math.cos(b), y: -speed * Math.sin(a) * Math.cos(b), z: speed * Math.sin(b) }
    tracks.push(runTrack(state, 0.2, () => ({ pitch: sign * pitch, yaw: sign }), undefined, `cross-${speed}-${sign}-${pitch}`))
  }
  return tracks
}
export function driftMetrics(trace: Trace) {
  const p = getFlightProfile(trace.aircraftId), samples = trace.samples
  const flows = samples.map(s => observeAirflow(s.state, p))
  const first = samples[0], last = samples.at(-1)!
  const lastAbove30 = flows.map(f => f.incidenceDeg >= 30).lastIndexOf(true)
  const initialVelocity = new Vector3().copy(first.state.velocity), finalVelocity = new Vector3().copy(last.state.velocity)
  const heading = (a: Vector3, b: Vector3) => Math.hypot(a.x, a.z) < 1e-6 || Math.hypot(b.x, b.z) < 1e-6 ? null
    : Math.atan2(a.x * b.z - a.z * b.x, a.x * b.x + a.z * b.z) * 180 / Math.PI
  return { scenario: trace.scenario, aircraftId: trace.aircraftId,
    thresholds: [20, 30, 60].map(degrees => { const i = flows.findIndex(f => f.incidenceDeg >= degrees); return { degrees, time: i < 0 ? null : samples[i].time, speedKph: i < 0 ? null : arcadeSpeed(flows[i].airspeed) } }),
    firstPitchRequest: samples[1]?.state.flightForces?.allocation.request.pitch ?? null,
    peakIncidence: Math.max(...flows.map(f => f.incidenceDeg)), secondsAbove30: flows.slice(1).filter(f => f.incidenceDeg >= 30).length / 120,
    finalSpeedKph: arcadeSpeed(finalVelocity.length()), heightLoss: first.state.position.y - last.state.position.y,
    cumulativeNoseDegrees: last.noseRotationDeg, netNoseHeadingDegrees: heading(forward(first.state), forward(last.state)),
    netVelocityHeadingDegrees: heading(initialVelocity, finalVelocity), velocityDirection3d: initialVelocity.length() < 1 || finalVelocity.length() < 1 ? null : initialVelocity.angleTo(finalVelocity) * 180 / Math.PI,
    finalIncidence: flows.at(-1)!.incidenceDeg,
    // Convergence window: time after which incidence stays below 30°; null while still above at track end.
    settledBelow30: lastAbove30 === flows.length - 1 ? null : samples[lastAbove30 + 1].time,
    thrustWork: samples.slice(1).reduce((sum, s) => sum + s.state.flightForces!.translation.thrustWork, 0),
    dragWork: samples.slice(1).reduce((sum, s) => sum + s.state.flightForces!.translation.dragWork, 0),
    unmet: Object.fromEntries(['pitch', 'yaw', 'roll'].map(axis => [axis, Math.max(...samples.slice(1).map(s => Math.abs(s.state.flightForces!.allocation.unmet[axis as 'pitch'])))])),
  }
}

/** Diagnostic ablations use the same solver. Pin only the explicit assist memory;
 * no alternate simulator or authority budget is introduced. */
export function driftAblations(id: string) {
  return ['explicit', 'full-assist', 'flow-only'].map(mode => {
    const trace = runTrack(driftSpawn(id), 3, (state, time) => {
      if (time === 0 && mode !== 'explicit') Object.defineProperty(state, 'pathAssistWeight', {
        configurable: true, enumerable: true, set: () => {},
        get: () => mode === 'full-assist' ? 1 : 1 - MathUtils.smoothstep(observeAirflow(state, getFlightProfile(id)).incidenceDeg, 15, 60),
      })
      return { pitch: 1, airbrake: true }
    }, undefined, `ablation-${mode}`)
    return driftMetrics(trace)
  })
}
export function handoffSweep(id: string) {
  const p = getFlightProfile(id), original = p.breakout.handoffSeconds
  try {
    return [0.15, 0.22, 0.3].map(seconds => {
      p.breakout.handoffSeconds = seconds
      const trace = runTrack(driftSpawn(id), 4, (_s, t) => ({ pitch: t < 1 ? 1 : t > 3 ? 0.5 : 0,
        yaw: t >= 1.1 && t < 1.9 ? 0.5 : 0, roll: t >= 2 && t < 2.9 ? 0.7 : 0, airbrake: true }))
      return { seconds, ...driftMetrics(trace), rollOnlyMinLimiter: Math.min(...trace.samples.filter(s => s.time >= 2 && s.time < 2.9).map(s => s.state.limiterOpen)) }
    })
  } finally { p.breakout.handoffSeconds = original }
}

export function dryPowerSweep(id: string) {
  const p = getFlightProfile(id), original = p.flight.controlPower
  try {
    return [0, 0.1, original].map(power => {
      p.flight.controlPower = power
      return { power, ...driftMetrics(runTrack(driftSpawn(id), 4,
        (_s, time) => ({ pitch: time < 1 ? 1 : 0.5, airbrake: true }), undefined, 'dry-power-hold')) }
    })
  } finally { p.flight.controlPower = original }
}
