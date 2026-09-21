import { gzipSync } from 'node:zlib'
import { it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { flightProfileVersion, getFlightProfile } from '../../src/game/flight/profile'
import { driftIds, driftTracks, driftMetrics, driftAblations, handoffSweep, dryPowerSweep } from './jetDrift'
import { jetDriftTargets, targetStatus } from './targets'
import { toGolden } from './harness'

it('archives repeatable no-C drift diagnostics (feel targets are report-only)', () => {
  const stage = process.env.DRIFT_STAGE ?? 'current'
  if (!/^[a-zA-Z0-9-]+$/.test(stage)) throw new Error('Invalid stage')
  const directory = stage === 'baseline' ? 'benchmarks/flight/jet-drift-baseline' : `benchmarks/flight/out/jet-drift-${stage}`
  if (stage === 'baseline' && existsSync(`${directory}/metrics.json`)) throw new Error('Baseline is immutable; choose another stage')
  mkdirSync(directory, { recursive: true })
  const metrics = []
  for (const id of driftIds) for (const trace of driftTracks(id)) {
    metrics.push(driftMetrics(trace))
    const recorded = toGolden(trace)
    if (trace.scenario.startsWith('cross-')) recorded.samples = trace.samples
    writeFileSync(`${directory}/${id}.${trace.scenario}.json.gz`, gzipSync(JSON.stringify(recorded)))
  }
  const targets = metrics.filter(row => row.aircraftId !== 'f22-notvc' && /^entry-pitch-(450|500|600|650|700)$/.test(row.scenario)).map(row => {
    const high = /-(650|700)$/.test(row.scenario), target = high ? jetDriftTargets.entry30Speed650to700 : jetDriftTargets.entry30Seconds450to600
    const value = high ? row.thresholds[1].speedKph : row.thresholds[1].time
    return { aircraftId: row.aircraftId, scenario: row.scenario, value, target, unit: high ? 'HUD km/h at 30°' : 'seconds to 30°', status: targetStatus(value, target) }
  })
  writeFileSync(`${directory}/metrics.json`, JSON.stringify({ sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), profileVersion: flightProfileVersion,
    stage, targets, dryPower: driftIds.map(id => ({ id, results: dryPowerSweep(id) })), ablations: driftIds.map(id => ({ id, results: driftAblations(id) })), handoff: driftIds.map(id => ({ id, results: handoffSweep(id) })), profiles: Object.fromEntries(driftIds.map(id => [id, getFlightProfile(id)])), metrics }, null, 2))
}, 60000)
