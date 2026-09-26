import { mkdirSync, writeFileSync } from 'node:fs'
import { it } from 'vitest'
import { MathUtils, Vector3 } from 'three'
import { forward, runScenario, runTrack, scenarioSetup, type Controller, type Sample } from './harness'
import { driftSpawn } from './jetDrift'
import { measure } from './metrics'
import { phase8Targets, targetStatus } from './targets'
import { flightProfileVersion, getFlightProfile } from '../../src/game/flight/profile'
import { arcadeSpeed } from '../../src/game/flight/speedLimits'
import type { AircraftState } from '../../src/game/state/WorldState'

/** Phase 8: B11 pedal turn and B22 personality ordering. Report only, never a CI gate.
 * Owner decisions (26 Sep 2026): B11 counts body-axis yaw travel (a cartwheel through
 * nose-down counts), the Su-57 must reach 360° and the F-22 stays at or below ~60% of it.
 * Speed tolerance ±30 km/h over the turn. All speeds are arcade km/h. */
const ids = ['f22', 'su57', 'f22-notvc'] as const
const pedalKph = 150, pedalSeconds = 8, ratioSeconds = 6
const yawWeights = [1, 0.8, 0.6, 0.4]

const kph = (s: AircraftState) => arcadeSpeed(new Vector3().copy(s.velocity).length())
const nosePitch = (s: AircraftState) => Math.asin(MathUtils.clamp(forward(s).y, -1, 1)) * 180 / Math.PI
const round = (value: number | null, digits = 1) => value === null ? null : Math.round(value * 10 ** digits) / 10 ** digits

/** Body-axis yaw travel over a window of samples, the turn time and the speed band until 360°. */
function pedalMetrics(samples: Sample[]) {
  const start = samples[0]
  let travel = 0, travelAtRatio = 0, time360: number | null = null, kph360: number | null = null
  let low = kph(start.state), high = low
  for (let i = 1; i < samples.length; i++) {
    const sample = samples[i]
    travel += Math.abs(sample.state.rates.yaw) * (sample.time - samples[i - 1].time) * 180 / Math.PI
    if (sample.time - start.time <= ratioSeconds) travelAtRatio = travel
    if (time360 !== null) continue
    low = Math.min(low, kph(sample.state)); high = Math.max(high, kph(sample.state))
    if (travel >= 360) { time360 = sample.time - start.time; kph360 = kph(sample.state) }
  }
  const last = samples.at(-1)!
  return {
    startKph: round(kph(start.state), 0), travel6sDeg: round(travelAtRatio, 0), travel8sDeg: round(travel, 0),
    time360: round(time360, 2), kphAt360: round(kph360, 0),
    speedLowKph: round(low - kph(start.state), 0), speedHighKph: round(high - kph(start.state), 0),
    endKph: round(kph(last.state), 0), nosePitchEndDeg: round(nosePitch(last.state), 0),
    altitudeLossM: round(start.state.position.y - last.state.position.y, 0),
    peakControlPowerPct: round(Math.max(...samples.map(s => s.state.flightForces?.power.controlPower ?? 0)) * 100, 0),
  }
}

/** Space + full yaw from level flight at 150 km/h. The turn the owner judges energy on. */
function levelPedal(id: string) {
  const trace = runTrack(driftSpawn(id, pedalKph), pedalSeconds, () => ({ airbrake: true, yaw: 1 }), undefined, 'phase8.pedal.level')
  return pedalMetrics(trace.samples)
}

/** The findings flow: 550 km/h, hold the nose at 88° until 150 km/h, then Space + full yaw. */
function verticalPedal(id: string) {
  let pedalStart: number | null = null
  const controller: Controller = (s, t) => {
    if (pedalStart === null && kph(s) <= pedalKph) pedalStart = t
    return pedalStart === null ? { pitch: MathUtils.clamp((88 - nosePitch(s)) / 15, -1, 1) } : { airbrake: true, yaw: 1 }
  }
  const trace = runTrack(driftSpawn(id, 550), 30, controller, undefined, 'phase8.pedal.vertical')
  const from = trace.samples.findIndex(s => pedalStart !== null && s.time >= pedalStart)
  return pedalMetrics(trace.samples.slice(from, from + Math.round(pedalSeconds * 120) + 1))
}

function personality(id: string) {
  const metric = (scenario: Parameters<typeof runScenario>[0], name: string) => measure(runScenario(scenario, id)).find(m => m.id === name)?.value ?? null
  return {
    cobraTimeTo90: round(metric('cobra', 'B2.cobra.timeTo90'), 3),
    cobraSpeedLoss: round(metric('cobra', 'B3.cobra.speedLoss'), 0),
    kulbitTime360: round(metric('kulbit', 'B5.kulbit.time360'), 3),
    // The release45 seed sits below the separation speed band, so B7 (label NORMAL) never
    // arrives without throttle. Recovery personality is the nose's return to the airflow.
    timeToAlphaNormal: round(runTrack(scenarioSetup('release45', id).state, 4, () => ({})).samples
      .find(s => s.state.flightForces && s.state.flightForces.airflowStart.incidenceDeg <= getFlightProfile(id).aero.alphaNormalDeg)?.time ?? null, 3),
    release45Incidence15: round(metric('release45', 'B9.natural.release45.incidence1.5s'), 1),
  }
}

function yawWeightSweep(id: string) {
  const weights = getFlightProfile(id).flight.controlPowerAxisWeight, saved = weights.yaw
  try {
    return yawWeights.map(weight => {
      weights.yaw = weight
      const level = levelPedal(id), vertical = verticalPedal(id)
      return { aircraft: id, yawWeight: weight, levelTime360: level.time360, levelKphAt360: level.kphAt360, levelEndKph: level.endKph,
        verticalTravel8s: vertical.travel8sDeg, verticalLow: vertical.speedLowKph, verticalHigh: vertical.speedHighKph }
    })
  } finally { weights.yaw = saved }
}

it('reports Phase 8 pedal turn and personality ordering', () => {
  const pedal = ids.flatMap(id => [{ aircraft: id, flow: 'level', ...levelPedal(id) }, { aircraft: id, flow: 'vertical', ...verticalPedal(id) }])
  const traits = Object.fromEntries(ids.map(id => [id, personality(id)]))
  const level = (id: string) => pedal.find(row => row.aircraft === id && row.flow === 'level')!
  const ratio = level('f22').travel6sDeg! / level('su57').travel6sDeg!
  const speedBand = Math.max(Math.abs(level('su57').speedLowKph!), Math.abs(level('su57').speedHighKph!))
  const lower = (a: number | null, b: number | null) => a !== null && b !== null && a <= b
  const checks = [
    { id: 'B11.pedal.su57Time360', value: level('su57').time360, status: targetStatus(level('su57').time360, phase8Targets.su57Time360) },
    { id: 'B11.pedal.f22ToSu57Travel6s', value: round(ratio, 3), status: targetStatus(ratio, phase8Targets.f22ToSu57Travel) },
    { id: 'B11.pedal.su57LevelSpeedBand', value: speedBand, status: targetStatus(speedBand, phase8Targets.speedBandKph) },
    { id: 'B22.yaw: Su-57 > F-22 (pedal travel)', value: null, status: level('su57').travel6sDeg! > level('f22').travel6sDeg! ? 'ok' : '⚠ out' },
    { id: 'B22.pitch: F-22 ≤ Su-57 (Kulbit 360° time)', value: null, status: lower(traits.f22.kulbitTime360, traits.su57.kulbitTime360) ? 'ok' : '⚠ out' },
    { id: 'B22.recovery: F-22 ≤ Su-57 (release45 time to alphaNormal)', value: null, status: lower(traits.f22.timeToAlphaNormal, traits.su57.timeToAlphaNormal) ? 'ok' : '⚠ out' },
    { id: 'B22.stability: F-22 ≤ Su-57 (incidence 1.5 s after release45)', value: null, status: lower(traits.f22.release45Incidence15, traits.su57.release45Incidence15) ? 'ok' : '⚠ out' },
  ]
  const sweep = ['f22', 'su57'].flatMap(yawWeightSweep)
  const table = (rows: Record<string, unknown>[]) => {
    const keys = Object.keys(rows[0])
    return [`| ${keys.join(' | ')} |`, `|${keys.map(() => '---').join('|')}|`, ...rows.map(row => `| ${keys.map(key => row[key] ?? '—').join(' | ')} |`)].join('\n')
  }
  mkdirSync('benchmarks/flight/out', { recursive: true })
  writeFileSync('benchmarks/flight/out/phase8.json', JSON.stringify({ flightProfileVersion, pedal, traits, checks, sweep }, null, 2) + '\n')
  writeFileSync('benchmarks/flight/out/phase8.md', [`# Phase 8 — ${flightProfileVersion}`,
    'Report only. Speed columns are arcade km/h; speedLow/High are the change from pedal start until 360° (or the whole window).',
    '## B11 pedal turn (Space + full yaw, 8 s)', table(pedal),
    '## B22 personality traits', table(ids.map(id => ({ aircraft: id, ...traits[id] }))),
    '## Checks', table(checks),
    '## Yaw control-power weight sweep', table(sweep)].join('\n\n') + '\n')
  console.table(pedal); console.table(checks); console.table(sweep)
})
