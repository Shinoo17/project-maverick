export type Target = { min?: number; max?: number }
/** Feel targets warn in reports only. Missing ranges intentionally mean report-only. */
export const targets: Record<string, Target> = {
  'B1.cobra.peakAoa': { min: 75, max: 95 },
  'B2.cobra.timeTo90': { min: 0.7, max: 1.2 },
  'B4.cobra.headingChange': { max: 20 },
  'B5.kulbit.time360': { min: 3, max: 4.5 },
  // B9 has no feel baseline until the Phase 2 playtest.
  // B13's future alphaNormal + 5 and G > golden have no Phase 0 equivalents.
}

export function targetStatus(value: number | null, target?: Target): 'ok' | '⚠ out' | 'report' {
  if (!target || (target.min === undefined && target.max === undefined)) return 'report'
  return value === null || (target.min !== undefined && value < target.min) || (target.max !== undefined && value > target.max) ? '⚠ out' : 'ok'
}
