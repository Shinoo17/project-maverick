import phase1Baseline from './phase1-metrics.json'

export type Target = { min?: number; max?: number; minExclusive?: boolean }
/** Benchmark-only pre-assist observation window; no Phase 5 delay is implemented. */
export const naturalObservationWindowSeconds = 0.2
export const phase2Playtest = { status: 'pending', b9Targets: 'pending owner playtest', fadeBand: 'provisional 20–30 degrees' } as const
/** Feel targets warn in reports only. Missing ranges intentionally mean report-only. */
export const targets: Record<string, Target> = {
  'B1.cobra.peakAoa': { min: 75, max: 95 },
  'B2.cobra.timeTo90': { min: 0.7, max: 1.2 },
  'B4.cobra.headingChange': { max: 20 },
  'B5.kulbit.time360': { min: 3, max: 4.5 },
  'B8.recovery.naturalDuringDelay': { min: 0, minExclusive: true },
  'B10.tailSlide.flipTime': { max: 4 },
  // B9 cannot be signed off until the Phase 2 owner playtest authors targets.
  // B13's future alphaNormal + 5 and G > golden have no Phase 0 equivalents.
}

/** Compare B20 against the archived metric of this aircraft, not a copied tuning constant. */
export function benchmarkTarget(id: string, aircraftId: string): Target | undefined {
  if (id !== 'B20.sideslip60.speedLoss1s') return targets[id]
  const baseline = phase1Baseline.results.find(a => a.aircraftId === aircraftId)?.scenarios
    .find(s => s.scenario === 'sideslip60')?.metrics.find(m => m.id === 'baseline.sideslip60.speedLoss1s')?.value
  if (baseline == null) throw new Error(`Missing archived B20 baseline for ${aircraftId}`)
  return { min: baseline * 1.3, minExclusive: true }
}

export function targetStatus(value: number | null, target?: Target): 'ok' | '⚠ out' | 'report' {
  if (!target || (target.min === undefined && target.max === undefined)) return 'report'
  return value === null || (target.min !== undefined && (target.minExclusive ? value <= target.min : value < target.min)) || (target.max !== undefined && value > target.max) ? '⚠ out' : 'ok'
}
