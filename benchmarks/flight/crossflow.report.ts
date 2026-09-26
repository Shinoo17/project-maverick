import { it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { Quaternion, Vector3 } from 'three'
import { createAircraft, runTrack } from './harness'
import { flightProfileVersion, getFlightProfile } from '../../src/game/flight/profile'
import { observeAirflow } from '../../src/game/flight/airflow'
import { aeroFlowEffectiveness, naturalAerodynamics } from '../../src/game/flight/aerodynamics'
import { computeBudget } from '../../src/game/flight/authority'

const axes = ['pitch', 'yaw', 'roll'] as const
// 100 m/s leaves authority above demand, so only the budget moves; 45 m/s saturates
// the full-stick request, so B25 shows the behavioural consequence of the budget loss.
const speedsMps = [100, 45]
const seedSeconds = 1
const probeRates = { pitch: 0.4, yaw: -0.4, roll: 0.4 }

/** Yaw the nose off the velocity vector by betaDeg with alpha held at zero, so the
 * pitch-alpha separation band stays closed and only crossflow is measured.
 */
function sideslipSeed(aircraftId: string, betaDeg: number, speedMps: number) {
  const state = createAircraft(aircraftId)
  state.position.y = 4000
  state.velocity = { x: speedMps, y: 0, z: 0 }
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -betaDeg * Math.PI / 180)
  state.orientation = { x: q.x, y: q.y, z: q.z, w: q.w }
  return state
}

/** B23–B25 measure what B20's one-second speed loss cannot see: whether an aircraft
 * flying broadside still commands attached-flow authority, damping and rate.
 */
it('reports crossflow control authority, damping and rate response versus sideslip', () => {
  const results = ['f22', 'su57', 'f22-notvc'].flatMap(aircraftId => speedsMps.map(speedMps => {
    const profile = getFlightProfile(aircraftId)
    const angles = [0, 30, 60, 90].map(betaDeg => {
      const state = sideslipSeed(aircraftId, betaDeg, speedMps)
      const flow = observeAirflow(state, profile)
      const effectiveness = aeroFlowEffectiveness(flow, profile.aero)
      const budget = computeBudget(flow, effectiveness, 0, profile)
      const natural = naturalAerodynamics(flow, 0, effectiveness, probeRates, profile.aero)
      const rates = Object.fromEntries(axes.map(axis => {
        const command = { [axis]: 1, speedAdjust: 1 } as Record<string, number>
        const trace = runTrack(sideslipSeed(aircraftId, betaDeg, speedMps), seedSeconds, () => command)
        const last = trace.samples.at(-1)!.state
        return [axis, { achievedRate: last.rates[axis], allocatedAero: last.flightForces!.allocation.aero[axis],
          allocatedFloor: last.flightForces!.allocation.floor[axis], unmet: last.flightForces!.allocation.unmet[axis] }]
      }))
      return { betaDeg, incidenceDeg: flow.incidenceDeg, separation: state.stall.severity,
        effectiveness, physicalAero: budget.physicalAero,
        dampingCoefficient: natural.dampingCoefficient, rates }
    })
    const attached = angles[0]
    return { aircraftId, speedMps, angles: angles.map(angle => ({ ...angle,
      authorityFraction: Object.fromEntries(axes.map(axis => [axis, angle.physicalAero[axis] / attached.physicalAero[axis]])),
      dampingFraction: Object.fromEntries(axes.map(axis => [axis, angle.dampingCoefficient[axis] / attached.dampingCoefficient[axis]])),
      rateFraction: Object.fromEntries(axes.map(axis => [axis, Math.abs(angle.rates[axis].achievedRate) / Math.max(Math.abs(attached.rates[axis].achievedRate), 1e-9)])) })) }
  }))
  const metrics = results.flatMap(aircraft => aircraft.angles.filter(angle => angle.betaDeg > 0).flatMap(angle => axes.map(axis => ({
    aircraftId: aircraft.aircraftId, id: `B23.crossflow.authorityFraction.${axis}.beta${angle.betaDeg}.v${aircraft.speedMps}`, value: angle.authorityFraction[axis],
  })).concat(axes.map(axis => ({
    aircraftId: aircraft.aircraftId, id: `B24.crossflow.dampingFraction.${axis}.beta${angle.betaDeg}.v${aircraft.speedMps}`, value: angle.dampingFraction[axis],
  })), axes.map(axis => ({
    aircraftId: aircraft.aircraftId, id: `B25.crossflow.rateFraction.${axis}.beta${angle.betaDeg}.v${aircraft.speedMps}`, value: angle.rateFraction[axis],
  })))))
  const directory = new URL('./out/', import.meta.url); mkdirSync(directory, { recursive: true })
  writeFileSync(new URL('crossflow.json', directory), JSON.stringify({ flightProfileVersion, speedsMps, seedSeconds, probeRates, results, metrics }, null, 2) + '\n')
  const md = [`# Crossflow — ${flightProfileVersion}`, '',
    `Pure sideslip at ${speedsMps.join(' and ')} m/s with alpha held at zero; the pitch-alpha separation band stays closed throughout.`,
    'Fractions are relative to the same airframe at beta = 0 and the same speed. At 100 m/s authority still exceeds the',
    'full-stick request, so only the budget moves; at 45 m/s the request saturates and the rate fraction follows the budget.',
    'Report only: no target range is authored before the Phase 8 playtest.', '',
    '| Aircraft | Speed m/s | Beta ° | Incidence ° | Separation | Authority P/Y/R | Damping P/Y/R | Rate P/Y/R |', '|---|---:|---:|---:|---:|---|---|---|']
  for (const aircraft of results) for (const angle of aircraft.angles) {
    const trio = (values: Record<string, number>) => axes.map(axis => values[axis].toFixed(3)).join(' / ')
    md.push(`| ${aircraft.aircraftId} | ${aircraft.speedMps} | ${angle.betaDeg} | ${angle.incidenceDeg.toFixed(1)} | ${angle.separation.toFixed(3)} | ${trio(angle.authorityFraction)} | ${trio(angle.dampingFraction)} | ${trio(angle.rateFraction)} |`)
  }
  writeFileSync(new URL('crossflow.md', directory), md.join('\n') + '\n')
  console.info('Crossflow report: benchmarks/flight/out/crossflow.md (full ledger: crossflow.json)')
})
