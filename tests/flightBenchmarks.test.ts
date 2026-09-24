import { describe, expect, it } from 'vitest'
import { aircraftIds, runScenario, scenarioSetup } from '../benchmarks/flight/harness'
import { measure, limiterDirectionChanges } from '../benchmarks/flight/metrics'
import { benchmarkTarget, targetStatus, phase2Playtest } from '../benchmarks/flight/targets'
import baseline from '../benchmarks/flight/phase1-metrics.json'

describe('Phase 2 benchmark wiring (not feel acceptance)', () => {
  it('B10 marks an unreached or late threshold out of target', () => {
    const target = benchmarkTarget('B10.tailSlide.flipTime', 'f22')!
    expect(target).toEqual({ max: 4 })
    expect(targetStatus(null, target)).toBe('⚠ out')
    expect(targetStatus(target.max!, target)).toBe('ok')
    expect(targetStatus(target.max! + 1e-6, target)).toBe('⚠ out')
  })
  it.each(aircraftIds)('B20 uses %s archived energy loss +30%% with a strict lower bound', id => {
    const old = baseline.results.find(a => a.aircraftId === id)!.scenarios.find(s => s.scenario === 'sideslip60')!.metrics[0].value!
    const target = benchmarkTarget('B20.sideslip60.speedLoss1s', id)!
    expect(target.min).toBe(old * 1.3)
    expect(targetStatus(target.min!, target)).toBe('⚠ out')
    expect(targetStatus(target.min! + 1e-6, target)).toBe('ok')
  })
  it('B8 is measured and zero response warns; B9 explicitly awaits owner playtest', () => {
    const rows = measure(runScenario('release45', 'f22'))
    const b8 = rows.find(row => row.id === 'B8.recovery.naturalDuringDelay')!
    expect(Number.isFinite(b8.value)).toBe(true)
    expect(b8.target).toEqual({ min: 0, minExclusive: true })
    expect(targetStatus(0, b8.target!)).toBe('⚠ out')
    expect(rows.filter(row => row.id.startsWith('B9.')).every(row => row.status === 'pending playtest')).toBe(true)
    expect(phase2Playtest.status).toBe('pending')
  })
})

it('Phase 4 reports new feel targets without turning them into flight acceptance assertions', () => {
  for (const id of ['B12.fullStick500.peakIncidence', 'B12.fullStick500.limiterOpen', 'B14.psmIntent.timeTo70', 'B16.limiter.chatterCount']) {
    const target = benchmarkTarget(id, 'f22')!
    expect(target.max).toBeDefined()
    expect(targetStatus(null, target)).toBe('⚠ out')
  }
  expect(limiterDirectionChanges([0, 0, 0.2, 0.5, 0.4, 0.3, 0.3])).toBe(1)
  expect(limiterDirectionChanges([0, 0.2, 0.1, 0.3, 0.2])).toBe(3)
  for (const name of ['cobra', 'kulbit', 'reversal180', 'pedal', 'psmIntent450'] as const) {
    const setup = scenarioSetup(name, 'f22')
    expect(setup.controller(setup.state, 0, 0)).toMatchObject({ airbrake: true, afterburner: true })
    expect(setup.controller(setup.state, 0, 0)).not.toHaveProperty('psmArm')
  }
})
