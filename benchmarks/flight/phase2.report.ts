import { runPsmNeutralRelease } from './releaseSafety'
import { phase2Playtest, targets, targetStatus } from './targets'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { it } from 'vitest'
import { aircraftIds, scenarioNames, runScenario, runTrack, replayGolden, scenarioSetup, type Golden } from './harness'
import { measure } from './metrics'
import { observeAirflow } from '../../src/game/flight/airflow'
import { getFlightProfile, flightProfileVersion } from '../../src/game/flight/profile'
import { flightInstrumentation } from '../../src/game/flight/instrumentation'
import { Quaternion, Vector3 } from 'three'

it('reports Phase 2 deltas, ablations and exact substep force ledgers without feel assertions', () => {
  const out = new URL('./out/', import.meta.url)
  mkdirSync(new URL('traces/', out), { recursive: true })
  const baseline = JSON.parse(readFileSync(new URL('./phase1-metrics.json', import.meta.url), 'utf8')) as {
    results: { aircraftId: string; scenarios: { scenario: string; metrics: { id: string; value: number | null }[] }[] }[]
  }
  const comparisons = aircraftIds.flatMap(id => scenarioNames.map(scenario => {
    const trace = runScenario(scenario, id)
    const golden: Golden = JSON.parse(readFileSync(new URL(`./golden/${scenario}.${id}.json`, import.meta.url), 'utf8'))
    const replay = replayGolden(golden)
    const old = baseline.results.find(a => a.aircraftId === id)!.scenarios.find(s => s.scenario === scenario)!
    const after = measure(trace)
    const openLoopAfter = measure(replay)
    // Every executed step, no end-of-step reconstruction of the natural forces.
    writeFileSync(new URL(`traces/${scenario}.${id}.jsonl`, out), trace.samples.map(sample => JSON.stringify({
      time: sample.time, rates: sample.state.rates, telemetry: flightInstrumentation(sample.state),
    })).join('\n') + '\n')
    return { aircraftId: id, scenario, metrics: after.map(metric => {
      const oldId = metric.id === 'B10.tailSlide.flipTime' ? 'baseline.tailSlide.flipTime'
        : metric.id === 'B20.sideslip60.speedLoss1s' ? 'baseline.sideslip60.speedLoss1s' : metric.id
      const recorded = old.metrics.find(m => m.id === oldId)?.value
        ?? (metric.id === 'B8.recovery.naturalDuringDelay'
          ? 45 - old.metrics.find(m => m.id === 'B9.natural.release45.incidence0.2s')!.value! : null)
        ?? (metric.id.startsWith('B9.natural.release45.incidence') ? (() => {
          const time = Number(metric.id.match(/incidence([\d.]+)s/)![1])
          const sample = golden.samples.find(s => s.time === time)
          return sample ? observeAirflow(sample.state, getFlightProfile(id)).incidenceDeg : null
        })() : null)
      const current = metric.value
      return { id: metric.id, unit: metric.unit, before: recorded, after: current,
        delta: recorded !== null && current !== null ? current - recorded : null,
        openLoopAfter: openLoopAfter.find(m => m.id === metric.id)?.value ?? null }
    }) }
  }))

  // Isolate canonical-incidence migration from the new forces using archived poses.
  const migrationAt = (state: Parameters<typeof observeAirflow>[0], id: string) => {
    const flow = observeAirflow(state, getFlightProfile(id))
    const forward = new Vector3(1, 0, 0).applyQuaternion(new Quaternion().copy(state.orientation))
    const velocity = new Vector3().copy(state.velocity)
    const oldPath = flow.airspeed > 0.01 ? velocity.clone().normalize() : forward
    return { speed: flow.airspeed, canonical: flow.incidenceDeg,
      legacyPsm: forward.angleTo(oldPath) * 180 / Math.PI,
      legacyTelemetry: forward.angleTo(velocity) * 180 / Math.PI }
  }
  const observationMigration = aircraftIds.flatMap(id => scenarioNames.map(scenario => {
    const golden: Golden = JSON.parse(readFileSync(new URL(`./golden/${scenario}.${id}.json`, import.meta.url), 'utf8'))
    const values = golden.samples.map(sample => migrationAt(sample.state, id))
    return { aircraftId: id, scenario,
      maxPsmDeltaDeg: Math.max(...values.map(v => Math.abs(v.canonical - v.legacyPsm))),
      maxTelemetryDeltaDeg: Math.max(...values.map(v => Math.abs(v.canonical - v.legacyTelemetry))) }
  }))
  const nearRestMigration = [0, 0.0001, 0.001, 0.01, 0.0101].map(speed => migrationAt({
    orientation: { x: 0, y: 0, z: 0, w: 1 }, velocity: { x: -speed, y: 0, z: 0 },
  }, 'f22'))

  const releaseAblations = aircraftIds.map(id => {
    const profile = getFlightProfile(id), original = structuredClone(profile.aero)
    const metric = () => measure(runScenario('release45', id))
    const authored = metric()
    let noRestoring, otherCurve
    try {
      profile.aero.restoring = { pitch: [{ incidenceDeg: 0, stiffness: 0 }, { incidenceDeg: 180, stiffness: 0 }], yaw: [{ incidenceDeg: 0, stiffness: 0 }, { incidenceDeg: 180, stiffness: 0 }] }
      noRestoring = metric()
      profile.aero.restoring = structuredClone(getFlightProfile(id === 'f22' ? 'su57' : 'f22').aero.restoring)
      otherCurve = metric()
    } finally { profile.aero = original }
    return { aircraftId: id, authored, noRestoring, otherCurve }
  })

  const tailSlides = aircraftIds.flatMap(id => [90, 89.9].map(pitch => {
    const { state } = scenarioSetup('tailSlide', id)
    const orientation = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), pitch * Math.PI / 180)
    state.orientation = { x: orientation.x, y: orientation.y, z: orientation.z, w: orientation.w }
    const trace = runTrack(state, 30, () => ({}), undefined, 'tailSlide')
    const profile = getFlightProfile(id)
    const flipTime = trace.samples.find(s => new Vector3(1, 0, 0).applyQuaternion(new Quaternion().copy(s.state.orientation)).y < 0)?.time ?? null
    const apex = trace.samples.reduce((best, s) => observeAirflow(s.state, profile).airspeed < observeAirflow(best.state, profile).airspeed ? s : best)
    const verticalApex = trace.samples.find(s => s.state.velocity.y <= 0)?.time ?? null
    const flipAfterApex = flipTime === null || verticalApex === null ? null : flipTime - verticalApex
    return { aircraftId: id, pitch, flipTime, flipAfterApex,
      targetSeconds: targets['B10.tailSlide.flipTime'].max, status: targetStatus(flipAfterApex, targets['B10.tailSlide.flipTime']),
      minSpeed: observeAirflow(apex.state, profile).airspeed, apexTime: apex.time,
      firstReverse: trace.samples.find(s => observeAirflow(s.state, profile).reverseFlow > 0)?.time ?? null,
      finalIncidence: observeAirflow(trace.samples.at(-1)!.state, profile).incidenceDeg,
      maxRate: Math.max(...trace.samples.map(s => Math.hypot(...Object.values(s.state.rates)))) * 180 / Math.PI,
      samples: trace.samples.filter(s => s.step % 120 === 0).map(s => ({ time: s.time, ...flightInstrumentation(s.state) })),
    }
  }))
  const psmReleases = aircraftIds.flatMap(id => [0, 1].map(speedAdjust => {
    const { trace } = runPsmNeutralRelease(id, speedAdjust)
    // Tuning threshold only: actual no-q contraction is checked from profile + epsilon in CI.
    const settledRate = 0.05
    const lastUnsettled = trace.samples.reduce((last, s, i) => Math.hypot(...Object.values(s.state.rates)) > settledRate ? i : last, -1)
    const snapshot = (sample: typeof trace.samples[number]) => ({ time: sample.time,
      ...observeAirflow(sample.state, getFlightProfile(id)), rates: sample.state.rates,
      separation: sample.state.stall.severity, phase: sample.state.maneuver.phase,
      completed: sample.state.maneuver.completed, altitude: sample.state.position.y,
      lastStep: sample.state.flightForces ?? null,
    })
    writeFileSync(new URL(`traces/neutralAfterC5.${id}.W${speedAdjust}.jsonl`, out), trace.samples.map(s => JSON.stringify(snapshot(s))).join('\n') + '\n')
    const final = trace.samples.at(-1)!
    return { aircraftId: id, speedAdjust, settledRate,
      settledAt: trace.samples[lastUnsettled + 1]?.time ?? null,
      normalAt: trace.samples.find(s => s.state.maneuver.phase === 'normal')?.time ?? null,
      alive: final.state.alive, stopReason: final.state.stopReason ?? null, duration: final.time,
      samples: [0, 2, 4, 6, 10, 20, 40].map(time => trace.samples.find(s => s.time === time))
        .filter((s): s is typeof trace.samples[number] => !!s).map(snapshot), final: snapshot(final) }
  }))
  const result = { flightProfileVersion, phase2Playtest, baselineVersion: 'p3-powered-psm-1', comparisons, observationMigration, nearRestMigration, releaseAblations, tailSlides, psmReleases }
  writeFileSync(new URL('phase2.json', out), JSON.stringify(result, null, 2) + '\n')
  const fmt = (v: number | null) => v === null ? '—' : v.toFixed(4)
  const md = ['# Phase 2 comparison', '', 'Acceptance: PENDING owner playtest and B9 target authoring. B10 is out of target.', '', 'Phase 0 goldens remain unchanged. Before = Phase 1 (339 tests and I4 passed before edits).',
    'Closed-loop metrics compare the same pilot; open-loop replays the archived commands. Feel values are reports, not assertions.', '',
    '| Aircraft / scenario / metric | Phase 1 | Phase 2 | Delta | Archived-input Phase 2 |', '|---|---:|---:|---:|---:|']
  for (const row of comparisons) for (const metric of row.metrics) md.push(`| ${row.aircraftId} / ${row.scenario} / ${metric.id} (${metric.unit}) | ${fmt(metric.before)} | ${fmt(metric.after)} | ${fmt(metric.delta)} | ${fmt(metric.openLoopAfter)} |`)
  md.push('', '## Tail slide extended to 30 s', '', '| Aircraft | Entry pitch | Reverse at | Head below horizon | After apex | Peak °/s |', '|---|---:|---:|---:|---:|---:|')
  for (const t of tailSlides) md.push(`| ${t.aircraftId} | ${t.pitch} | ${fmt(t.firstReverse)} | ${fmt(t.flipTime)} | ${fmt(t.flipAfterApex)} | ${fmt(t.maxRate)} |`)
  md.push('', '## Neutral release after C + pull + W for 5 s', '',
    '| Aircraft | W after release | Settled below 0.05 rad/s | First normal | Last pitch rate | Stop |',
    '|---|---:|---:|---:|---:|---|')
  for (const row of psmReleases) md.push(`| ${row.aircraftId} | ${row.speedAdjust} | ${fmt(row.settledAt)} | ${fmt(row.normalAt)} | ${fmt(row.final.rates.pitch)} | ${row.stopReason ?? 'alive'} at ${fmt(row.duration)} s |`)
  md.push('', 'Release ablations and tail-slide samples: phase2.json. Every substep ledger: traces/*.jsonl.',
    'Ledger controller includes stabilityDamping; add controller + tvc + naturalRestoring + naturalDamping once to reconstruct rate change.',
    'B8 reports incidence reduction during a 0.2 s neutral/no-C window inside the Phase 5 recovery delay. B9 and Phase 2 acceptance remain pending owner playtest.')
  writeFileSync(new URL('phase2.md', out), md.join('\n') + '\n')
})
