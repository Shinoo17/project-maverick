import { it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { aircraftIds, createAircraft, runScenario } from './harness'
import { measure } from './metrics'
import { energySweep, partialEntry, entryDiagnostics, limiter90SpeedBoundary } from './permissionProbes'
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

// Phase 6 retired the manual High-G fixture (Space) and the C comparisons (B17,
// allocationBound.cVsAuto) with their inputs; see docs/psm-phase6-implementation.md.
it('reports Phase 4 entries and limiter sweep without feel assertions', () => {
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
    const scenarios = ['cobra', 'kulbit', 'reversal180', 'pedal', 'psmIntent450', 'fullStick500', 'hardTurn900'] as const
    const traces = scenarios.map(scenario => runScenario(scenario, aircraftId))
    const rows = traces.map(trace => ({ scenario: trace.scenario, duration: trace.samples.at(-1)!.time, metrics: measure(trace) }))
    const sweeps = [false, true].map(boosted => ({ ...energySweep(aircraftId, boosted),
      control: energySweep(aircraftId, boosted, 0) }))
    const auto = traces.find(trace => trace.scenario === 'psmIntent450')!
    const partial = entryDiagnostics(partialEntry(aircraftId)), full = entryDiagnostics(auto)
    const onset = auto.samples.findIndex(s => (s.state.flightForces?.allocation.tvc.pitch ?? 0) > 1e-6)
    const before = auto.samples.slice(Math.max(0, onset - 24), onset + 1)
    const after = auto.samples.slice(onset, onset + 61)
    const limiter90Speed = limiter90SpeedBoundary(aircraftId)
    const metrics = [
      { id: 'breakout.maxSpeedLimiter90', value: limiter90Speed.reachesMps === null ? null : arcadeSpeed(limiter90Speed.reachesMps), unit: 'arcade km/h / fixed attached flow, Airbrake + Shift + full pull for 8 s' },
      { id: 'B16.limiter.chatterCount', value: sweeps.every(s => s.intendedReversalObserved && s.control.directionChanges === 1) ? Math.max(...sweeps.map(s => s.chatterCount!)) : null, unit: 'unintended reversals / 8 s' },
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
    return { aircraftId, scenarios: rows, metrics, regression, sweeps, partial, full, saturationSweep, limiter90Speed }
  })
  const report = { flightProfileVersion, baselineVersion: baseline.flightProfileVersion, results }
  const directory = new URL('./out/', import.meta.url); mkdirSync(directory, { recursive: true })
  writeFileSync(new URL('phase4.json', directory), JSON.stringify(report, null, 2) + '\n')
  const md = [`# Phase 4 — ${flightProfileVersion}`, '',
    'All feel targets are report-only. Automatic entry uses Airbrake (Space) + Shift + pull.',
    'B17 (C vs automatic) retired in Phase 6 with the C key. phase4.json keeps partial and full-stick entry diagnostics with unsaturated-step counts.',
    'B16 sweeps q in eight seconds with a 20%-of-band (0.26-q) 0.5 Hz ripple. A separate no-ripple control checks the intended reversal; missing reversals are invalid, never zero chatter.', '',
    '| Aircraft | Scenario | Metric | Value | Status |', '|---|---|---|---:|---|']
  for (const r of results) {
    for (const s of r.scenarios) for (const m of s.metrics) md.push(`| ${r.aircraftId} | ${s.scenario} | ${m.id} | ${m.value?.toFixed(4) ?? '—'} ${m.unit} | ${m.status} |`)
    for (const m of r.metrics) md.push(`| ${r.aircraftId} | comparison | ${m.id} | ${m.value?.toFixed(4) ?? '—'} ${m.unit} | ${m.status} |`)
  }
  md.push('', 'Existing B1–B5/B10/B11/B13/B15/B18/B19/B20 and B23–B25 remain in report.md, phase3.md and crossflow.md, all generated with the current physics version.',
    'The manual High-G fixture retired in Phase 6 with the Space High-G command; its last values are in docs/psm-phase6-implementation.md.')
  writeFileSync(new URL('phase4.md', directory), md.join('\n') + '\n')
  console.info('Phase 4 report: benchmarks/flight/out/phase4.md (full sweep samples: phase4.json)')
})
