# Phase 0 flight instrumentation

Implements only Phase 0 of [the final implementation plan](../../docs/psm-implementation-plan.md).
The runtime flight step, input, camera, profiles, replay schema and `flightProfileVersion`
remain unchanged (`p3-powered-psm-1`). No Phase 1–3 airflow, engine, allocation or physics is installed.

```sh
npm test                         # Hard invariants and the existing handling tests
npm run typecheck
npm run flight:bench             # Informational report; does not overwrite goldens
FLIGHT_GOLDEN=update npm run flight:bench  # Deliberate baseline capture/replacement
```

Reports are written to `out/report.json` and `out/report.md` (ignored by git).
Targets in `targets.ts` produce `ok`, `⚠ out` or `report`; feel never fails the build.
Unreached thresholds are JSON `null`, rendered as `—`, not zero or the track timeout.
Future-phase targets (including B9) remain report-only. Phase 0 reports legacy recovery,
not the continuous NORMAL label or recovery assist that do not exist yet.

## Observer and HUD

Enable **Pause → Flight lab → Show detailed telemetry** for the new readouts.
The original winged-circle nose pipper is preserved; a winged diamond marks velocity
(owner-approved FIX 7). A chevron at the inset edge
points toward an off-screen/behind-camera flight path; below 1 m/s the marker hides.
Directly aft flow has no unique edge direction and deterministically uses the bottom edge.
The marker reads the existing interpolated pose/velocity and scene camera.

`flightInstrumentation` samples the current (normally end-of-step) state. Its alpha
uses `angleOfAttack`; beta is `atan2(body.z, hypot(body.x, body.y))`, signed toward body
+Z. Incidence is the unsigned nose/velocity angle. Zero-speed angles report zero.
`stall.aoaDeg` remains the runtime's **start-of-step** reading, intentionally separate.
q is a dimensionless `(v / 90)²` proxy. Thrust is acceleration (F/m), in m/s², recovered
from the last engine output; it is not a new engine model.

Legacy aero/floor/PSM are full-stick **rate ceilings before turn budget and High-G**,
in rad/s internally and °/s in the HUD. They are not Phase 3 authority shares and must
not be compared across phases as though their semantics were unchanged. Capacity
uses full-travel geometry, not current nozzle travel or mixer gains. Differential yaw
and roll are coupled, so the displayed axis maxima are not simultaneously additive.

## Harness and goldens

Nine scenarios run on F-22 and Su-57. Fresh `GameRuntime` snapshots supply the complete
spawn state; each scenario sets its entry pose/speed, altitude and matching trim output.
Controllers read state at each 1/120 s flight substep. C, W, Shift, X and Space retain
their existing meanings; `hardTurn900` uses pitch alone as specified.

`runScenario` records every substep, actual commands and cumulative nose rotation.
Commands are run-length encoded with `startStep`, `steps` and a complete first command.
Harness `command.tick` means flight substep, not the public replay's 60 Hz world tick;
replay expands it for each substep. Each golden file contains:

- Complete `initialState` and informational `recordedWithProfileVersion`.
- `flightStep`, `totalSteps`, the actual open-loop commands, and samples every 0.25 s
  (also entry and the final/death sample).
- Complete aircraft state at each sample, plus time/step and cumulative nose rotation.

`replayGolden` merges recorded initial fields onto a fresh spawn so newly added fields
survive. Arrays are replaced. It ignores profile versions by design; it does not use
the public replay reader. The **CI test** requires the recorded/current versions to
match and fails explicitly after a version bump. A physics-changing PR must deliberately
regenerate or retire the baseline, never skip silently. The public replay version rejection
is unchanged and separately tested.

Numeric state leaves present in a golden are checked with
`1e-9 * max(1, abs(recorded))`; added fields are ignored. No global tolerance relaxation
is allowed for long rotation tracks. I2 also compares **every** substep state exactly at
30/60/144 rendered FPS, delivering the recorded commands through the fixed clock.
The actual `GameRuntime` snapshot/public replay path has its own exact FPS checks.

## Metric windows

- Angles/threshold times use every 120 Hz sample, not the decimated golden samples.
  Time-to-threshold is the first qualifying sample; resolution is 1/120 s.
- Cobra peak, time-to-90, maximum speed loss and 3D velocity heading change use entry
  through C release (including the last C-driven sample). Heading change is entry to
  release; speed loss is entry minus the minimum within that window. Pull times out at
  2.5 s; push times out at 5 s from entry; recovery continues through 10 s.
- Kulbit rotation is the sum of angles between successive forward vectors, not Euler
  wrapping or the legacy maneuver rotation counter. Time360 is the first 360° crossing.
- Hard turn mean G averages the post-step legacy path-G samples over 3 s. Speed loss
  is entry minus final speed. Peak incidence includes entry.
- Reversal heading change is entry to the final 10 s sample; altitude loss is entry
  minus the minimum altitude over the whole track. Heading uses a 3D velocity angle
  and is unavailable below 1 m/s.
- Legacy back-to-normal is measured after C release. Pedal yaw rate is sampled at 2 s.
  Release45 reports incidence at 0.2/0.5/1.5 s and maximum body-rate vector magnitude.
  Tail slide reports the first nose-below-horizon sample; sideslip reports 1 s speed loss.
- Tracks stop on `alive = false`; reports include actual duration/alive status.
  Speed loss uses the existing arcade km/h conversion (5.4 × simulation m/s).

## Spec discrepancies resolved against the unchanged runtime

1. §0.7 says legacy floor is positive at **45 m/s**, but §0.1 and `stepFlight` give
   `max(0, 0.12 - v/90)`. It is positive only below **10.8 m/s**, and zero at 45 and
   150 m/s. Tests cover 0, 5, 10.8, 45, 90, 150 and 300 m/s without changing physics.
2. The §3 pitch table records **nose-up** authority: F-22 gives 1.45774 / 3.44557
   rad/s² at thrust 27.5 / 65, matching table entries 1.46 / 3.45; Su-57 gives
   1.30219 / 3.07790, matching 1.30 / 3.08. The table includes the engine-height
   moment. In contrast, §0.1 requires `max |pitch|`, which selects **nose-down**:
   F-22 1.54376 / 3.64888 and Su-57 1.34722 / 3.18433 rad/s². Nose-down magnitude
   is **+5.9% (F-22) / +3.5% (Su-57)** relative to nose-up. The asymmetry comes from
   `−height·dx`, where `dx = engine·(cosθ−1)`: reduced axial thrust contributes the
   same signed pitch moment for ± deflection, reducing nose-up and increasing the
   magnitude of nose-down. The discrepancy is a direction mismatch, not an omitted
   term or an approximate solver. Tests now retain independent hard-coded references
   for **both** signed directions from the reviewed 0.5° full-grid sweep.

   Thus §0.1's max, §3's nose-up table and §0.7's ±1% agreement cannot all hold.
   Phase 3 must resolve the capacity contract and explicitly choose the calibration
   direction before tuning `thrustVectoring.gain` against the Cobra/Kulbit goldens.
   Treating the displayed nose-down maximum as pull authority would overstate the
   nose-up authority those maneuvers use. This fix round leaves the helper, geometry,
   profiles and gains unchanged; no contract alternative has been selected.

Both issues are recorded in the source-of-truth plan's **Errata — Rev. 3.1 candidates**
([plan](../../docs/psm-implementation-plan.md)), along with the F-22 yaw/budget issue:
zero yaw holds only for equal-magnitude nozzle angles. The full-grid I9 test calls
`thrustForces` directly and bounds asymmetric yaw at 1% of nose-up pitch; a separate
mixer sweep covers reachable deflections. See the erratum for the Phase 3 owner decisions.

The original 189 tests passed before implementation. New tests cover pure observation,
marker bounds, I1/I2/I3/I9/I11, golden reproduction and instrumentation neutrality.
The seeded I1/I11 fuzz retains four entry-speed seeds per aircraft (zero, near-zero,
reverse and random), and adds four seeds at each of 120° and 170° incidence per aircraft.
The added poses randomize the turn plane and forward speed, assert reverse flow at entry
and after the first substep, and randomize commands every 0.25 s for 6 s.
A fixed-flow fixture also runs the real `stepFlight` to convergence and compares body
rates with the legacy overlay sum where the turn budget is inactive and TVC moments
cancel (or thrust is zero). Its tolerance is numerical, not a feel target. Any future discovery of
an existing physics bug must be reported separately, not fixed under Phase 0.
