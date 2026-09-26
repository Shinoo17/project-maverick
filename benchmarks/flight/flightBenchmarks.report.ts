import { phase2Playtest } from './targets'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { it } from 'vitest'
import { aircraftIds, scenarioNames, runScenario, toGolden } from './harness'
import { measure } from './metrics'
import { getFlightProfile, flightProfileVersion } from '../../src/game/flight/profile'
import { tvcCapacity } from '../../src/game/flight/thrustVectoring'

it('reports flight feel without asserting target ranges', () => {
  const directory = fileURLToPath(new URL('./', import.meta.url))
  mkdirSync(`${directory}out`, { recursive: true })
  const results = aircraftIds.map(aircraftId => ({ aircraftId, scenarios: scenarioNames.map(scenario => {
    const trace = runScenario(scenario, aircraftId)
    if (process.env.FLIGHT_GOLDEN === 'update') {
      mkdirSync(`${directory}golden`, { recursive: true })
      writeFileSync(`${directory}golden/${scenario}.${aircraftId}.json`, JSON.stringify(toGolden(trace), null, 2) + '\n')
    }
    return { scenario, duration: trace.samples.at(-1)!.time, alive: trace.samples.at(-1)!.state.alive, metrics: measure(trace) }
  }) }))
  const capacity = aircraftIds.map(aircraftId => ({ aircraftId, values: [3.5, 27.5, 65].map(thrust => ({ thrust, ...tvcCapacity(getFlightProfile(aircraftId).thrustVectoring, thrust) })) }))
  const report = { flightProfileVersion, sampleHz: 120, phase2Playtest, results, capacity }
  writeFileSync(`${directory}out/report.json`, JSON.stringify(report, null, 2) + '\n')
  const markdown = [`# Flight tuning report — ${flightProfileVersion}`, '',
    'Feel targets are informational; unreached thresholds are null (—). Samples use 120 Hz simulation time.',
    'Phase 2 acceptance is PENDING owner playtest/B9 targets. Legacy rates/labels are not Phase 3 authority. See ../README.md for metric windows.', '']
  for (const aircraft of results) {
    markdown.push(`## ${aircraft.aircraftId}`, '', '| Benchmark / metric | Value | Target | Status |', '|---|---:|---|---|')
    for (const scenario of aircraft.scenarios) for (const metric of scenario.metrics) {
      const target = metric.target ? `${metric.target.minExclusive ? '> ' : ''}${metric.target.min ?? '−∞'} … ${metric.target.max ?? '∞'}` : '—'
      markdown.push(`| ${metric.id} | ${metric.value === null ? '—' : metric.value.toFixed(3)} ${metric.unit} | ${target} | ${metric.status} |`)
    }
    markdown.push('')
  }
  markdown.push('## Full-travel geometry capacity', '', '| Aircraft | Thrust m/s² | Pitch rad/s² | Yaw rad/s² | Roll rad/s² |', '|---|---:|---:|---:|---:|')
  for (const aircraft of capacity) for (const value of aircraft.values) markdown.push(`| ${aircraft.aircraftId} | ${value.thrust} | ${value.pitch.toFixed(5)} | ${value.yaw.toFixed(5)} | ${value.roll.toFixed(5)} |`)
  writeFileSync(`${directory}out/report.md`, markdown.join('\n') + '\n')
  console.info(`Flight report: benchmarks/flight/out/report.md${process.env.FLIGHT_GOLDEN === 'update' ? ' (goldens updated explicitly)' : ''}`)
})
