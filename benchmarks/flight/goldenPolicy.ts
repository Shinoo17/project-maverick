/** An intentional retirement is scoped to a reviewed physics version. A future
 * bump must decide whether to regenerate outputs or explicitly extend retirement.
 */
export const phase0ArchiveVersion = 'p3-powered-psm-1'
const retiredI4: Record<string, { archiveVersion: string; reason: string }> = {
  'p4-automatic-envelope-2': { archiveVersion: phase0ArchiveVersion, reason: 'Phase 4 review fixes controller permission continuity and owner-approved saturation for G only. Preserve historical golden outputs and replay archived inputs under the new version.' },
  'p4-automatic-envelope-1': { archiveVersion: phase0ArchiveVersion, reason: 'Phase 4 automatic permission, shared G allowance and continuous flow-based path/gravity intentionally change physics. Preserve every Phase 0 golden output.' },
  'p3-flow-effectiveness-4': { archiveVersion: phase0ArchiveVersion, reason: 'Airflow-derived control effectiveness replaces the separation factor in physical aero authority and adds crossflow damping. Preserve Phase 0 archives for calibration.' },
  'p3-engine-allocation-3': { archiveVersion: phase0ArchiveVersion, reason: 'Phase 3 engine spool, allocated body control, physical TVC and work/path guards intentionally change physics. Preserve Phase 0 archives for calibration.' },
  'p3-natural-aero-2': { archiveVersion: phase0ArchiveVersion, reason: 'Phase 2 natural aerodynamics replaces Phase 1 output neutrality.' },
  'p3-natural-aero-2.1': { archiveVersion: phase0ArchiveVersion, reason: 'Phase 2 review: restore low-q neutral damping and pitch-alpha stall contract.' },
}

export function goldenComparisonPolicy(currentVersion: string, recordedVersion: string): 'equivalence' | 'archived-inputs' {
  if (currentVersion === recordedVersion) return 'equivalence'
  if (retiredI4[currentVersion]?.archiveVersion === recordedVersion) return 'archived-inputs'
  throw new Error(`Physics version changed: ${recordedVersion} → ${currentVersion}. Deliberately regenerate goldens (FLIGHT_GOLDEN=update npm run flight:bench) or retire I4 for this version in goldenPolicy.ts with a review reason; never silently skip.`)
}
