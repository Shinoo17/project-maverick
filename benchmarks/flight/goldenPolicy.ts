/** An intentional retirement is scoped to a reviewed physics version. A future
 * bump must decide whether to regenerate outputs or explicitly extend retirement.
 */
export const phase0ArchiveVersion = 'p3-powered-psm-1'
const retiredI4: Record<string, { archiveVersion: string; reason: string }> = {
  'p5-recovery-assist-1': { archiveVersion: phase0ArchiveVersion, reason: 'Phase 5 delayed recovery assist steers the nose toward the airflow after neutral release at high incidence. Phase 0 archived inputs remain safety tracks, not output equivalence.' },
  'p4.7-banked-drift-1': { archiveVersion: phase0ArchiveVersion, reason: 'Knife-edge incidence cap turns high-bank pull into a horizontal drift instead of a cobra. Phase 0 archived inputs remain safety tracks, not output equivalence.' },
  'p4.6-reverse-departure-1': { archiveVersion: phase0ArchiveVersion, reason: 'Reverse-flow departure bias intentionally changes nose-drop behavior past 90 degrees incidence. Phase 0 archived inputs remain safety tracks, not output equivalence.' },
  'p4.5c-jet-drift-1': { archiveVersion: phase0ArchiveVersion, reason: 'Rev. 4 explicit dry control power and dissipative directional braking with specific-work accounting. Phase 0 archived inputs remain safety tracks, not output equivalence.' },
  'p4.5b-continuation-1': { archiveVersion: phase0ArchiveVersion, reason: 'Rev. 4 continuation/release and combined contribution-aware limiter supersede P4-2 behavior; archives preserved.' },
  'p4.5a-entry-path-1': { archiveVersion: phase0ArchiveVersion, reason: 'Rev. 4 entry window and explicit physical/path assist separation; Phase 0 outputs remain archived.' },
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
