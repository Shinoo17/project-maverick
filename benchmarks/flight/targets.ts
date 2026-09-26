import phase1Baseline from './phase1-metrics.json'

export type Target = { min?: number; max?: number; minExclusive?: boolean }
/** Natural-only observation window; must lie inside every profile's recovery.delaySeconds. */
export const naturalObservationWindowSeconds = 0.2
export const phase2Playtest = { status: 'pending', b9Targets: 'pending owner playtest', fadeBand: 'provisional 20–30 degrees' } as const
/** Feel targets warn in reports only. Missing ranges intentionally mean report-only. */
export const targets: Record<string, Target> = {
  'B12.fullStick500.peakIncidence': { max: 25 },
  'B12.fullStick500.limiterOpen': { max: 0.35 },
  'B14.psmIntent.timeTo70': { max: 1.2 },
  'B16.limiter.chatterCount': { max: 2 },
  'B1.cobra.peakAoa': { min: 75, max: 95 },
  'B2.cobra.timeTo90': { min: 0.7, max: 1.2 },
  'B4.cobra.headingChange': { max: 20 },
  'B5.kulbit.time360': { min: 3, max: 4.5 },
  'B6.recovery.assistFull': { min: 0.5, max: 1.5 },
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

/** Rev. 4 playtest candidates. Never CI gates or unconditional maneuver promises.
 * Useful-adjustment duration remains a human-playtest goal in the plan;
 * secondsAbove30 does not measure useful control and cannot score that goal. */
export const jetDriftTargets = {
  entry30Seconds450to600: { min: 0.4, max: 0.8 },
  entry30Speed650to700: { min: 350 },
} satisfies Record<string, Target>

/** Phase 8 owner decisions (26 Sep 2026). Report only until the pedal-turn playtest. */
export const phase8Targets = {
  su57Time360: { max: 8 },
  f22ToSu57Travel: { max: 0.6 },
  speedBandKph: { max: 30 },
} satisfies Record<string, Target>
