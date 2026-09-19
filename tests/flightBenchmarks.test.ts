import { describe, expect, it } from 'vitest'
import { aircraftIds, runScenario } from '../benchmarks/flight/harness'
import { measure } from '../benchmarks/flight/metrics'
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
