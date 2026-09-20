import { it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { Quaternion, Vector3 } from 'three'
import { aircraftIds, automaticScenarioNames, createAircraft, runScenario, runTrack } from './harness'
import { measure } from './metrics'
import { energySweep, partialEntryComparison, entryDiagnostics, limiter90SpeedBoundary } from './permissionProbes'
import { benchmarkTarget, targetStatus } from './targets'
import { flightProfileVersion, getFlightProfile } from '../../src/game/flight/profile'
import { observeAirflow } from '../../src/game/flight/airflow'
import { measureControlDemand } from '../../src/game/flight/controller'
import { interpretEnvelope } from '../../src/game/flight/envelope'
import { createPilotIntent, readIntent } from '../../src/game/flight/intent'
import { neutralCommand } from '../../src/game/runtime/commands'
import { arcadeSpeed } from '../../src/game/flight/speedLimits'
import { FLIGHT_STEP as dt } from '../../src/game/runtime/clock'
import baseline from './phase3-metrics.json'

// Retained Phase 3 feel fixture, no longer a CI requirement: fast full-stick
// now requests automatic G, so its ratio to manual High-G can change by design.
function highGComparison() {
  const turns = [130, 130, 200].map((speed, index) => {
    const state = createAircraft('f22'); state.position.y = 3000; state.velocity.x = speed
    const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2)
    state.orientation = { x: q.x, y: q.y, z: q.z, w: q.w }
    const trace = runTrack(state, 3, () => ({ pitch: 1, highG: index === 1 }))
    return { pathDegrees: trace.samples.slice(1).reduce((sum, s) => sum + s.state.maneuver.pathRate * dt, 0),
      finalSpeed: new Vector3().copy(trace.samples.at(-1)!.state.velocity).length() }
  })
  return { normal: turns[0], manual: turns[1], fast: turns[2],
    oldTargets: { manualPathRatioMin: 1.2, manualSpeedLossMin: 10, fastPathRatioMax: 0.75 },
    manualPathRatio: turns[1].pathDegrees / turns[0].pathDegrees,
    manualExtraSpeedLoss: turns[0].finalSpeed - turns[1].finalSpeed,
    fastPathRatio: turns[2].pathDegrees / turns[0].pathDegrees }
}

it('reports Phase 4 entries, limiter sweep, and equivalent C/automatic comparisons without feel assertions', () => {
  const results = [...aircraftIds, 'f22-notvc'].map(aircraftId => {
    const profile = getFlightProfile(aircraftId), probe = createAircraft(aircraftId)
    const saturationSweep = [20, 60, 83.333333, 100, 120, 150, 166.7, 200, 259].flatMap(speed => [0.7, 1].map(pitch => {
      probe.velocity.x = speed
      const flow = observeAirflow(probe, profile), command = { ...neutralCommand(0, probe.id), pitch }
      const { saturationRatio } = measureControlDemand(command, flow, 0, profile, 0)
      probe.intent = readIntent(command, createPilotIntent(), dt, saturationRatio)
      const envelope = interpretEnvelope(probe, flow, profile)
      return { speed, pitch, saturationRatio, saturation: probe.intent.saturation,
        energyPermission: envelope.energyPermission, gAllowance: envelope.gAllowance, limiterTarget: envelope.limiterTarget }
    }))
    const scenarios = [...automaticScenarioNames, 'fullStick500', 'hardTurn900'] as const
    const traces = scenarios.map(scenario => runScenario(scenario, aircraftId))
    const rows = traces.map(trace => ({ scenario: trace.scenario, duration: trace.samples.at(-1)!.time, metrics: measure(trace) }))
    const peak = (name: string) => rows.find(s => s.scenario === name)!.metrics.find(m => m.id === 'psmIntent.peakIncidence')!.value!
    const sweeps = [false, true].map(boosted => ({ ...energySweep(aircraftId, boosted),
      control: energySweep(aircraftId, boosted, 0) }))
    const partialComparison = partialEntryComparison(aircraftId).map(entryDiagnostics)
    const fullComparison = traces.filter(t => t.scenario.startsWith('psmIntent450')).map(entryDiagnostics)
    const auto = traces.find(trace => trace.scenario === 'psmIntent450')!
    const onset = auto.samples.findIndex(s => (s.state.flightForces?.allocation.tvc.pitch ?? 0) > 1e-6)
    const before = auto.samples.slice(Math.max(0, onset - 24), onset + 1)
    const after = auto.samples.slice(onset, onset + 61)
    const limiter90Speed = limiter90SpeedBoundary(aircraftId)
    const metrics = [
      { id: 'breakout.maxSpeedLimiter90', value: limiter90Speed.reachesMps === null ? null : arcadeSpeed(limiter90Speed.reachesMps), unit: 'arcade km/h / fixed attached flow, X + Shift + full pull for 8 s' },
      { id: 'B16.limiter.chatterCount', value: sweeps.every(s => s.intendedReversalObserved && s.control.directionChanges === 1) ? Math.max(...sweeps.map(s => s.chatterCount!)) : null, unit: 'unintended reversals / 8 s' },
      { id: 'allocationBound.cVsAuto.peakDelta', value: Math.abs(peak('psmIntent450C') - peak('psmIntent450')), unit: 'deg / full pull: authority saturation control' },
      { id: 'B17.cVsAuto.peakDelta', value: Math.abs(partialComparison[0].peakIncidence - partialComparison[1].peakIncidence), unit: 'deg / identical 8 s X + Shift + 0.7 pull' },
      { id: 'B18.auto.handoffRateDip', value: onset < 0 ? null : Math.max(0, Math.max(...before.map(s => s.state.rates.pitch)) - Math.min(...after.map(s => s.state.rates.pitch))), unit: 'rad/s' },
      { id: 'B19.auto.maxRotation3s', value: auto.samples[360].noseRotationDeg, unit: 'deg' },
    ].map(m => {
      const target = m.id === 'B19.auto.maxRotation3s' && aircraftId === 'f22-notvc' ? { max: 180 } : benchmarkTarget(m.id, aircraftId)
      return { ...m, target: target ?? null, status: targetStatus(m.value, target) }
    })
    const regression = rows.flatMap(s => s.metrics.flatMap(m => {
      const before = baseline.metrics.find(row => row.aircraftId === aircraftId && row.scenario === s.scenario && row.id === m.id)
      return before ? [{ scenario: s.scenario, id: m.id, before: before.value, after: m.value }] : []
    }))
    return { aircraftId, scenarios: rows, metrics, regression, sweeps, partialComparison, fullComparison, saturationSweep, limiter90Speed }
  })
  const report = { flightProfileVersion, baselineVersion: baseline.flightProfileVersion, results, highGComparison: highGComparison() }
  const directory = new URL('./out/', import.meta.url); mkdirSync(directory, { recursive: true })
  writeFileSync(new URL('phase4.json', directory), JSON.stringify(report, null, 2) + '\n')
  const md = [`# Phase 4 — ${flightProfileVersion}`, '',
    'All feel targets are report-only. Automatic entry uses X + Shift + pull; Space remains High-G.',
    'B17 uses identical 450 arcade km/h starts and eight-second 0.7-stick X+Shift commands, differing only in psmArm. Full-stick comparison is retained as an allocation saturation control; both include unsaturated-step diagnostics.',
    'B16 sweeps q in eight seconds with a 20%-of-band (0.26-q) 0.5 Hz ripple. A separate no-ripple control checks the intended reversal; missing reversals are invalid, never zero chatter.', '',
    '| Aircraft | Scenario | Metric | Value | Status |', '|---|---|---|---:|---|']
  for (const r of results) {
    for (const s of r.scenarios) for (const m of s.metrics) md.push(`| ${r.aircraftId} | ${s.scenario} | ${m.id} | ${m.value?.toFixed(4) ?? '—'} ${m.unit} | ${m.status} |`)
    for (const m of r.metrics) md.push(`| ${r.aircraftId} | comparison | ${m.id} | ${m.value?.toFixed(4) ?? '—'} ${m.unit} | ${m.status} |`)
  }
  md.push('', 'Existing B1–B5/B10/B11/B13/B15/B18/B19/B20 and B23–B25 remain in report.md, phase3.md and crossflow.md, all generated with the current physics version.',
    'The original manual/fast High-G feel fixture is retained in phase4.json (highGComparison), with its old numeric targets for comparison only.')
  writeFileSync(new URL('phase4.md', directory), md.join('\n') + '\n')
  console.info('Phase 4 report: benchmarks/flight/out/phase4.md (full sweep samples: phase4.json)')
})
