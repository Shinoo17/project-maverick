import { it } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { Quaternion, Vector3 } from 'three'
import { createAircraft, liveScenario, runScenario, runTrack, type ArchivedScenarioName, type Trace } from './harness'
import { measure, firstTime } from './metrics'
import { getFlightProfile, flightProfileVersion } from '../../src/game/flight/profile'
import { tvcMomentCapacity } from '../../src/game/flight/thrustVectoring'
import { stepSpeed } from '../../src/game/flight/speed'
import { neutralCommand } from '../../src/game/runtime/commands'
import { envelopeLabel } from '../../src/game/flight/envelope'
import { runPsmNeutralRelease } from './releaseSafety'
import phase2 from './phase2-metrics.json'

const speed = (state: ReturnType<typeof createAircraft>) => Math.hypot(...Object.values(state.velocity))
const highSeed = (id: string, velocity = 20, incidence = 75) => {
  const state = createAircraft(id); state.position.y = 4000; state.velocity = { x: velocity, y: 0, z: 0 }; state.stall.severity = 1
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), incidence * Math.PI / 180)
  state.orientation = { x: q.x, y: q.y, z: q.z, w: q.w }
  return state
}
const peak = (trace: Trace, value: (state: Trace['initialState']) => number) => Math.max(...trace.samples.map(sample => value(sample.state)))
const metric = (trace: Trace, id: string) => measure(trace).find(row => row.id === id)?.value ?? null
const summary = (trace: Trace) => ({
  peakAoa: metric(trace, 'B1.cobra.peakAoa'), timeTo90: metric(trace, 'B2.cobra.timeTo90'),
  headingChange: metric(trace, 'B4.cobra.headingChange'),
  time360: metric(trace, 'B5.kulbit.time360'),
})
const handoffMetrics = (trace: Trace) => {
  const onset = trace.samples.findIndex(sample => (sample.state.flightForces?.allocation.tvc.pitch ?? 0) > 1e-6)
  if (onset < 0) return { rateDipRadPerSec: null, onsetSeconds: null, preOnsetAero: null, preOnsetQ: null }
  const before = trace.samples.slice(Math.max(0, onset - 24), onset + 1)
  const after = trace.samples.slice(onset, onset + 61)
  const prior = trace.samples[Math.max(0, onset - 1)].state.flightForces
  return { rateDipRadPerSec: Math.max(0, Math.max(...before.map(s => s.state.rates.pitch)) - Math.min(...after.map(s => s.state.rates.pitch))),
    onsetSeconds: trace.samples[onset].time, preOnsetAero: prior?.allocation.aero.pitch ?? null,
    preOnsetQ: prior?.airflowStart.dynamicPressure ?? null }
}

it('reports Phase 3 ownership, gain calibration and Phase 0–2 regression deltas', () => {
  const results = ['f22', 'su57', 'f22-notvc'].map(id => {
    const p = getFlightProfile(id)
    const metrics = (['cobra', 'kulbit', 'pedal'] as const).flatMap(scenario => measure(runScenario(scenario, id)))
    const initial = createAircraft(id); initial.position.y = 4000; initial.velocity.x = 450 / 5.4
    // Phase 6: probes that held C now hold Airbrake, the automatic entry key.
    const pull = runTrack(initial, 8, () => ({ pitch: 1, speedAdjust: 1, afterburner: true, airbrake: true }))
    // Same post-stall pitch incidence, speed, neutral engine spool and Q/E input for each airframe.
    const pedal = runTrack(highSeed(id), 2, () => ({ yaw: 1, airbrake: true, speedAdjust: 1, afterburner: true }))
    const shares = { aero: 0, tvc: 0, floor: 0, unmet: 0 }
    for (const sample of pedal.samples.slice(1)) for (const key of ['aero', 'tvc', 'floor', 'unmet'] as const) shares[key] += Math.abs(sample.state.flightForces!.allocation[key].yaw) / (pedal.samples.length - 1)
    const handoff = pull.samples.findIndex(sample => (sample.state.flightForces?.allocation.tvc.pitch ?? 0) > 1e-6)
    const before = handoff < 0 ? null : Math.max(...pull.samples.slice(Math.max(0, handoff - 24), handoff + 1).map(sample => sample.state.rates.pitch))
    const after = handoff < 0 ? null : Math.min(...pull.samples.slice(handoff, handoff + 61).map(sample => sample.state.rates.pitch))
    // Establish attached aerodynamic control before the Airbrake opens permission.
    // This probes a substantial aero -> TVC handoff, unlike the low-q pull.
    const moderate = createAircraft(id); moderate.position.y = 4000; moderate.velocity = { x: 140, y: 0, z: 0 }
    const moderateTrace = runTrack(moderate, 4, (_state, time) => ({ pitch: 1, airbrake: time >= 1, speedAdjust: 1, afterburner: true }))
    const brakeState = highSeed(id, 70, 80)
    brakeState.enginePower = 65 / 50; brakeState.engine.actualThrust = 65; brakeState.speedDrive = 1; brakeState.maneuver.airbrake = 1
    const brake = runTrack(brakeState, 0.5, () => ({ pitch: 1, speedAdjust: 1, afterburner: true, airbrake: true }))
    const low = highSeed(id, 5, 90); low.enginePower = 65 / 50; low.engine.actualThrust = 65
    const lowTrace = runTrack(low, 1, () => ({ airbrake: true, pitch: 1, afterburner: true, speedAdjust: 1 }))
    const first = lowTrace.samples[1].state, last = lowTrace.samples.at(-1)!.state
    const governor = [0, 80].map(alpha => {
      const state = highSeed(id, 100, alpha)
      const force = stepSpeed(state, neutralCommand(0, state.id), 1 / 120, 100)
      return { alpha, requestedPower: state.engine.requestedPower, actualThrust: force.thrust }
    })
    const release = id === 'f22-notvc' ? null : runPsmNeutralRelease(id, 1, 40)
    const final = release?.trace.samples.at(-1)!.state
    return { id, gain: p.thrustVectoring?.gain ?? 0, metrics,
      capacity: [3.5, 27.5, 50, 65].map(thrust => ({ thrust, ...tvcMomentCapacity(p.thrustVectoring, thrust) })),
      pedal: { peakYawRateDeg: peak(pedal, s => Math.abs(s.rates.yaw)) * 180 / Math.PI,
        yawRotationDeg: pedal.samples.slice(1).reduce((sum, sample) => sum + sample.state.rates.yaw / 120, 0) * 180 / Math.PI,
        finalYawRateDeg: pedal.samples.at(-1)!.state.rates.yaw * 180 / Math.PI, meanAllocationRadPerSec2: shares },
      handoff: { rateDipRadPerSec: before === null ? null : Math.max(0, before - after!), onsetSeconds: handoff < 0 ? null : pull.samples[handoff].time,
        window: 'pre-onset peak over 0.2 s minus minimum over following 0.5 s' },
      moderateHandoff: { ...handoffMetrics(moderateTrace), seed: '140 m/s attached pull, Airbrake from 1 s, W+Shift held' },
      limiterPull: { rotation3s: pull.samples[360].noseRotationDeg, rotation8s: pull.samples.at(-1)!.noseRotationDeg,
        time180: firstTime(pull.samples, s => s.noseRotationDeg >= 180), time360: firstTime(pull.samples, s => s.noseRotationDeg >= 360) },
      brakeBurner: { speedLossMps: speed(brakeState) - speed(brake.samples.at(-1)!.state), initialIncidence: 80,
        actualThrustStart: brake.samples[1].state.engine.actualThrust, actualThrustEnd: brake.samples.at(-1)!.state.engine.actualThrust,
        pitchCapacityStart: brake.samples[1].state.flightForces!.budget.tvc.positive.pitch },
      governor,
      lowSpeed: { controlHeadingRate: first.flightForces!.translation.controlPathRate, cap: first.flightForces!.translation.controlPathCap,
        uncappedRate: first.flightForces!.translation.uncappedControlPathRate, capActive: first.flightForces!.translation.pathCapActive,
        totalHeadingRateIncludingGravity: first.maneuver.pathRate * Math.PI / 180,
        energyStart: speed(low) ** 2 / 2 + p.flight.gravity * low.position.y, energyEnd: speed(last) ** 2 / 2 + p.flight.gravity * last.position.y,
        maxWorkResidual: Math.max(...lowTrace.samples.slice(1).map((sample, i) => {
          const a = lowTrace.samples[i].state, b = sample.state, work = b.flightForces!.translation
          return (speed(b) ** 2 - speed(a) ** 2) / 2 + p.flight.gravity * (b.position.y - a.position.y) - work.thrustWork + work.dragWork
        })) },
      release: final && release ? { firstNormal: firstTime(release.trace.samples, sample => !!sample.state.flightForces && envelopeLabel(sample.state.flightForces.envelope, sample.state.intent.activity) === 'NORMAL'),
        seconds: release.trace.samples.at(-1)!.time, speed: speed(final), incidence: final.maneuver.alpha,
        rate: final.rates, alive: final.alive, stopReason: final.stopReason ?? null } : null }
  })
  const calibration = ['f22', 'su57'].flatMap(id => {
    const p = getFlightProfile(id).thrustVectoring!, original = p.gain
    try {
      return [1, 1.5, 2, 2.5, 3].map(gain => {
        p.gain = gain
        const cobra = runScenario('cobra', id), kulbit = runScenario('kulbit', id)
        return { id, gain, selected: gain === original, cobra: summary(cobra), kulbit: summary(kulbit),
          initialPitchRateAt02s: cobra.samples[24].state.rates.pitch }
      })
    } finally { p.gain = original }
  })
  const regression = phase2.results.flatMap(aircraft => aircraft.scenarios.flatMap(scenario => {
    const rows = measure(runScenario(liveScenario(scenario.scenario as ArchivedScenarioName), aircraft.aircraftId))
    return rows.map(current => { const prior = scenario.metrics.find(row => row.id === current.id)?.value ?? null
      return { id: aircraft.aircraftId, scenario: scenario.scenario, metric: current.id, phase2: prior, phase3: current.value,
        delta: prior === null || current.value === null ? null : current.value - prior } })
  }))
  const golden = ['f22', 'su57'].map(id => ({ id, tracks: ['cobraC', 'kulbitC'].map(scenario => {
    const archive = JSON.parse(readFileSync(new URL(`./golden/${scenario}.${id}.json`, import.meta.url), 'utf8'))
    return { scenario, sampleIntervalSeconds: 0.25,
      timeTo90Sampled: archive.samples.find((s: { state: { maneuver: { alpha: number } } }) => s.state.maneuver.alpha >= 90)?.time ?? null,
      time360Sampled: archive.samples.find((s: { noseRotationDeg: number }) => s.noseRotationDeg >= 360)?.time ?? null }
  }) }))
  const yawRatio = results[0].pedal.peakYawRateDeg / results[1].pedal.peakYawRateDeg
  const report = { flightProfileVersion, phase2BaselineVersion: phase2.flightProfileVersion, phase2SourceCommit: phase2.sourceCommit,
    participation: 0, phase2Playtest: 'still pending', results, yawRatio, calibration, golden, regression }
  const directory = new URL('./out/', import.meta.url); mkdirSync(directory, { recursive: true })
  writeFileSync(new URL('phase3.json', directory), JSON.stringify(report, null, 2) + '\n')
  const md = [`# Phase 3 — ${flightProfileVersion}`, '', 'Tuning measurements are informational. See phase3.json for capacities, allocation shares, work/cap diagnostics and full regression deltas.', '',
    '| Aircraft | Gain | Pedal peak yaw °/s | Pull rotation at 3s / 8s | Time 180° / 360° | Handoff dip rad/s | Brake/burner speed loss m/s |', '|---|---:|---:|---:|---:|---:|---:|']
  for (const r of results) md.push(`| ${r.id} | ${r.gain} | ${r.pedal.peakYawRateDeg.toFixed(3)} | ${r.limiterPull.rotation3s.toFixed(3)} / ${r.limiterPull.rotation8s.toFixed(3)} | ${r.limiterPull.time180 ?? '—'} / ${r.limiterPull.time360 ?? '—'} | ${r.handoff.rateDipRadPerSec ?? '—'} | ${r.brakeBurner.speedLossMps.toFixed(3)} |`)
  md.push('', `B11 peak-yaw ratio F-22/Su-57 = ${yawRatio.toFixed(4)} (target ≤0.5).`, 'B19 no-TVC rotation at 3 s target <180°; B18 is report-only.', '',
    '## Moderate-q handoff', '', '| Aircraft | Onset s | Pre-onset q | Pre-onset aero rad/s² | Dip rad/s |', '|---|---:|---:|---:|---:|')
  for (const r of results) md.push(`| ${r.id} | ${r.moderateHandoff.onsetSeconds ?? '—'} | ${r.moderateHandoff.preOnsetQ?.toFixed(3) ?? '—'} | ${r.moderateHandoff.preOnsetAero?.toFixed(3) ?? '—'} | ${r.moderateHandoff.rateDipRadPerSec?.toFixed(4) ?? '—'} |`)
  md.push('', '## Gain calibration', '', '| Aircraft | Gain | Cobra peak ° | Cobra time 90° | Cobra heading ° (target ≤20) | Kulbit time 360° | Pitch rate at 0.2 s |', '|---|---:|---:|---:|---:|---:|---:|')
  for (const c of calibration) md.push(`| ${c.id} | ${c.gain}${c.selected ? ' (selected)' : ''} | ${c.cobra.peakAoa?.toFixed(3)} | ${c.cobra.timeTo90 ?? '—'} | ${c.cobra.headingChange?.toFixed(3)} | ${c.kulbit.time360 ?? '—'} | ${c.initialPitchRateAt02s.toFixed(4)} |`)
  md.push('', '## Phase 2 regression', '', '| Aircraft | Metric | Phase 2 | Phase 3 | Delta |', '|---|---|---:|---:|---:|')
  for (const r of regression) md.push(`| ${r.id} | ${r.metric} | ${r.phase2?.toFixed(4) ?? '—'} | ${r.phase3?.toFixed(4) ?? '—'} | ${r.delta?.toFixed(4) ?? '—'} |`)
  writeFileSync(new URL('phase3.md', directory), md.join('\n') + '\n')
  console.info('Phase 3 report: benchmarks/flight/out/phase3.md (full ledger: phase3.json)')
})
