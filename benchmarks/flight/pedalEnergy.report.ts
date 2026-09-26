import { mkdirSync, writeFileSync } from 'node:fs'
import { it } from 'vitest'
import { MathUtils, Vector3 } from 'three'
import { forward, runTrack, type Trace } from './harness'
import { driftSpawn } from './jetDrift'
import { flightProfileVersion, getFlightProfile } from '../../src/game/flight/profile'
import { dryThrustLimit } from '../../src/game/flight/speed'
import { arcadeSpeed, simulationSpeed } from '../../src/game/flight/speedLimits'
import type { PilotCommand } from '../../src/game/runtime/commands'
import type { AircraftState } from '../../src/game/state/WorldState'

/** Phase 8 input: energy during a pedal turn. See docs/psm-phase8-pedal-energy-findings.md.
 * Intended flow: ~550 km/h → pitch 90° → bleed to ~150 km/h → Space + full yaw at roughly constant
 * speed → W + Shift to recover. Report only: no targets, no CI gate. All speeds are arcade km/h. */
const ids = ['f22', 'su57'] as const
const entryKph = 550, pedalStartKph = 150, pedalSeconds = 5, recoverSeconds = 6, climbPitchDeg = 88
const levelKph = 150, levelSeconds = 6
const trimKph = [150, 250, 351, 450, 550]
const levelCases = { neutral: {}, yaw: { yaw: 1 }, yawBrake: { yaw: 1, airbrake: true }, pullBrake: { pitch: 1, airbrake: true } } satisfies Record<string, Partial<PilotCommand>>

const kph = (s: AircraftState) => arcadeSpeed(new Vector3().copy(s.velocity).length())
const nosePitch = (s: AircraftState) => Math.asin(MathUtils.clamp(forward(s).y, -1, 1)) * 180 / Math.PI
const round = (value: number, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits
const pct = (value: number) => round(value * 100)

/** Engine power (dry-thrust units) that trim alone requests at a steady speed. */
function trimPower(id: string, arcadeKph: number) {
  const p = getFlightProfile(id).flight, limits = driftSpawn(id).speedLimits
  return p.drag * simulationSpeed(arcadeKph) ** 2 / dryThrustLimit(p, limits)
}

function verticalPedal(id: string) {
  let phase: 'climb' | 'pedal' | 'recover' = 'climb', phaseStart = 0
  const marks: Record<string, number> = {}
  const trace = runTrack(driftSpawn(id, entryKph), 30, (s, t) => {
    if (phase === 'climb' && kph(s) <= pedalStartKph) { phase = 'pedal'; phaseStart = t; marks.pedal = t }
    if (phase === 'pedal' && t - phaseStart >= pedalSeconds) { phase = 'recover'; phaseStart = t; marks.recover = t }
    if (phase === 'recover' && t - phaseStart >= recoverSeconds) marks.end ??= t
    if (phase === 'climb') return { pitch: MathUtils.clamp((climbPitchDeg - nosePitch(s)) / 15, -1, 1) }
    if (phase === 'pedal') return { airbrake: true, yaw: 1 }
    return { speedAdjust: 1, afterburner: true }
  }, undefined, 'pedalEnergy.vertical')
  const window = (from = 0, to = Infinity) => trace.samples.filter(s => s.time >= from && s.time < to)
  const pedal = window(marks.pedal, marks.recover), recover = window(marks.recover, marks.end)
  const first = pedal[0], last = pedal.at(-1)!
  const yawTravel = pedal.reduce((sum, s) => sum + Math.abs(s.state.rates.yaw), 0) * (pedal[1].time - first.time)
  const time351 = recover.find(s => kph(s.state) >= 351)
  return {
    aircraft: id,
    climbSeconds: round(marks.pedal),
    pedalStartKph: round(kph(first.state), 0),
    pedalEndKph: round(kph(last.state), 0),
    pedalPeakKph: round(Math.max(...pedal.map(s => kph(s.state))), 0),
    pedalPeakEnginePct: pct(Math.max(...pedal.map(s => s.state.enginePower))),
    pedalControlPowerPct: pct(last.state.flightForces?.power.controlPower ?? 0),
    pedalYawTravelDeg: round(yawTravel * 180 / Math.PI, 0),
    pedalNoseRotationDeg: round(last.noseRotationDeg - first.noseRotationDeg, 0),
    pedalNosePitchStartDeg: round(nosePitch(first.state), 0),
    pedalNosePitchEndDeg: round(nosePitch(last.state), 0),
    recoverEndKph: round(kph(recover.at(-1)!.state), 0),
    recoverTo351Seconds: time351 ? round(time351.time - marks.recover, 2) : null,
    recoverEndStall: round(recover.at(-1)!.state.stall.severity, 2),
  }
}

function levelMatrix(id: string) {
  return Object.entries(levelCases).map(([name, command]) => {
    const trace: Trace = runTrack(driftSpawn(id, levelKph), levelSeconds, () => command, undefined, `pedalEnergy.level.${name}`)
    const last = trace.samples.at(-1)!
    return {
      aircraft: id, case: name,
      endKph: round(kph(last.state), 0),
      peakEnginePct: pct(Math.max(...trace.samples.map(s => s.state.enginePower))),
      noseRotationDeg: round(last.noseRotationDeg, 0),
      nosePitchEndDeg: round(nosePitch(last.state), 0),
      altitudeLossM: round(trace.samples[0].state.position.y - last.state.position.y, 0),
    }
  })
}

it('reports pedal-turn energy for Phase 8', () => {
  const trim = ids.flatMap(id => trimKph.map(speed => ({ aircraft: id, kph: speed, trimEnginePct: round(trimPower(id, speed) * 100, 2) })))
  const vertical = ids.map(verticalPedal)
  const level = ids.flatMap(levelMatrix)
  const table = (rows: Record<string, unknown>[]) => {
    const keys = Object.keys(rows[0])
    return [`| ${keys.join(' | ')} |`, `|${keys.map(() => '---').join('|')}|`, ...rows.map(row => `| ${keys.map(key => row[key] ?? '—').join(' | ')} |`)].join('\n')
  }
  mkdirSync('benchmarks/flight/out', { recursive: true })
  writeFileSync('benchmarks/flight/out/pedal-energy.json', JSON.stringify({ profileVersion: flightProfileVersion, trim, vertical, level }, null, 2))
  writeFileSync('benchmarks/flight/out/pedal-energy.md', [`# Pedal energy (${flightProfileVersion})`,
    '## Trim power', table(trim), '## Vertical pedal flow', table(vertical), `## Level ${levelKph} km/h, ${levelSeconds} s`, table(level)].join('\n\n') + '\n')
  console.table(trim); console.table(vertical); console.table(level)
})
