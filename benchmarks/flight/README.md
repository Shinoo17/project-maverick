# Flight instrumentation and Phase 3 allocation

> **Phase 6 (`p6-legacy-gates-1`, command schema 2):** the C debug limiter and Space High-G
> command are gone. `archivedScenarioNames` (including `cobraC`, `kulbitC`, `reversal180C`,
> `pedalC`) name the Phase 0 golden archives and are replayed only; their recorded
> `psmArm`/`highG` fields are dropped on replay. Live runs use `scenarioNames`, where each
> archived `*C` track becomes its automatic twin via `liveScenario()` (held C maps to
> Airbrake + Afterburner). `FLIGHT_GOLDEN=update` writes goldens under the live names and never
> overwrites the `*C` archives. B17 and the manual High-G fixture are retired; see
> [the Phase 6 report](../../docs/psm-phase6-implementation.md).

Current physics: `p3-flow-effectiveness-4`. Phase 0 archives (`p3-powered-psm-1`)
remain unchanged. See [the Phase 3 report](../../docs/psm-phase3-implementation.md)
for ownership contracts, signed capacity, gain calibration, regressions and discrepancies.
Automatic breakout/recovery migration remains deferred. Phase 2 B9/playtest acceptance
is still pending; this implementation does not approve its provisional tuning.

```sh
npm test                         # Hard invariants and the existing handling tests
npm run typecheck
npm run build                    # Runs hard tests first, then typecheck and production bundle
npm run flight:bench             # Informational report; does not overwrite goldens
FLIGHT_GOLDEN=update npm run flight:bench  # Overwrites archives: do not use for cross-phase comparison
```

Reports are written to ignored `out/` files. `report.json`/`.md` retain standard
scenario metrics. `phase3.json`/`.md` add directional capacities, post-stall pedal
shares, no-TVC 3/8-second rotation, brake/burner, governor, 5 m/s path/work results,
handoff dips at low and substantial q, gain sweeps (including Cobra heading change)
and every Phase 2 scenario's deltas. `phase2-metrics.json` captures the clean
pre-Phase-3 HEAD baseline with its commit/version. `phase1-metrics.json` remains the
older baseline. `phase2.report.ts` continues archived-input replay, natural ablations,
and the extended tail-slide and neutral-release traces; its name denotes the harness,
not the physics version being executed. Reports have a 30 s timeout because their
120 Hz diagnostic JSONL traces now include allocation, engine and work ledgers.

`crossflow.json`/`.md` report B23–B25: physical aero authority, damping coefficient
and achieved full-stick rate at beta 30/60/90 with alpha held at zero, each as a
fraction of the same airframe at beta 0. They exist because B20's one-second speed
loss cannot show whether a broadside aircraft still commands attached-flow authority.

`pedal-energy.json`/`.md` report trim power by speed, a vertical climb → bleed → Airbrake +
yaw → W + Shift flow, and a level 150 km/h input matrix. They are Phase 8 input; see
[the pedal energy findings](../../docs/psm-phase8-pedal-energy-findings.md).
Report only; target ranges wait for the Phase 8 playtest.

`phase8.json`/`.md` report B11 (Phase 8 pedal turn: body yaw travel, time to 360° and
speed band for Space + full yaw from level 150 km/h and from the vertical climb), B22
personality ordering against the plan's G2 table, and a yaw control-power weight sweep.
Report only; targets are `phase8Targets` in `targets.ts`. See
[the Phase 8 report](../../docs/psm-phase8-implementation.md).

`maneuvers.json`/`.md` (MR0, [plan](../../docs/psm-maneuver-control-plan.md)) report the
maneuver catalogue M1–M7 plus Kulbit as closed-loop recipes (`maneuvers.ts`): roll rate by
speed, Cobra entry and exit, pedal turn, Herbst, loops and the vertical power loop, Bell,
Immelmann and Kulbit. They add per-axis smoothness (latency, overshoot, request step at the
rate zero crossing, jerk) and the RC5 mouse bank-sweep probe, and check `maneuverTargets`.
Report only. `MANEUVER_REPORT_LABEL` names `out/<label>.json`/`.md`. `mr-baseline/` is the
tracked copy of every report at `77333d9` that the MR evidence gates compare against.
`mr-results/mrN/` holds each MR phase's reviewed results (markdown, maneuvers JSON and
gzipped jet-drift metrics), next to the baseline they are compared with.

`camera.report.ts` reports B21 (Phase 7): the public `FlightCamera` driven from live F-22/Su-57
traces (Cobra, Kulbit, tail slide, reversal, pedal, drift entries, handoff, roll + pull) at
30/60/144 fps, four aspect ratios and both roll modes. It measures nose pipper/FPM visibility
by the HUD's own on-screen rule, projected airframe extent, camera roll/view rates and the
stick-frame mismatch (rendered screen-up versus the up the mouse mapping assumes). It is
presentation-only. Run it alone with
`CAMERA_REPORT_LABEL=camera npx vitest run --config vitest.bench.config.ts benchmarks/flight/camera.report.ts`;
the label names `out/<label>.json`/`.md`, so a before/after pair can sit side by side.

`releaseSafety.ts` shares the five-second Airbrake+pull+W reproduction (C+pull+W before Phase 6). Powered CI requires
recovery before any terminal collision; it permits a recovered, unattended nose-down
flight to reach terrain later in the 40 s observation. The unpowered 14 s liveness
window remains hard. A future recovery assist must not be silently simulated here.

`flightInstrumentation(...).lastStep` records the integrated start-of-step flow,
authority budget, signed allocation, target/actual/coupled/lagging TVC torque, rate-servo
damping, natural moments and translation work/cap. `budget` uses that same tick;
main airflow fields observe the end pose. Actual acceleration reconstructs from
`aero + floor + actualTvc + stabilityDamping + naturalRestoring + naturalDeparture + naturalDamping`.
The TVC reservation is not added again. Its unresolved portion is kept in `unmet`.

Numeric feel targets produce `ok`, `⚠ out` or `report`. B9 explicitly reports
`pending playtest`; Phase 2 acceptance is not complete. `reportExpect` accepts only
finite numeric feel values. Every migrated integration uses `stepLegacyFlight` for
hard finite/quaternion/alive checks; phase lifecycle and detector-gate consistency
remain hard. The old powered yaw completion target is a feel measurement.
Unreached thresholds are JSON `null`, rendered as `—`, not zero or the track timeout.
B8 reports incidence reduction over a 0.2 s window inside the Phase 5 recovery delay (>0).
B6 reports when recovery assist reaches 0.9 after release; B7 reports the first NORMAL label.
B10 warns for a missing or >4 s head drop. B20 compares against each aircraft's archived
sideslip loss ×1.3 with a strict lower bound. B9 ranges must come from owner playtest;
do not derive them from this automated run. Recovery labels are still legacy.

## Observer and HUD

Enable **Pause → Flight lab → Show detailed telemetry** for the new readouts.
The original winged-circle nose pipper is preserved; a winged diamond marks velocity
(owner-approved FIX 7). A chevron at the inset edge
points toward an off-screen/behind-camera flight path; below 1 m/s the marker hides.
Directly aft flow has no unique edge direction and deterministically uses the bottom edge.
The marker reads the existing interpolated pose/velocity and scene camera.

`flightInstrumentation` samples the current (normally end-of-step) state. Its alpha
uses the shared `observeAirflow` source (also behind `angleOfAttack`); beta is
`atan2(body.z, hypot(body.x, body.y))`, signed toward body
+Z. Incidence is the unsigned nose/velocity angle. Zero-speed angles report zero.
`stall.aoaDeg` remains the runtime's **start-of-step** reading, intentionally separate.
q is a dimensionless `(v / profile.aero.referenceSpeedMps)²` proxy (default 90 m/s).
Thrust is acceleration (F/m), in m/s², read from the engine's actual output.
`enginePower` is actual power in dry-thrust units, not the governor request.

Legacy rate-ceiling overlay rows have been replaced by acceleration budgets and
allocations. TVC command capacity has positive/negative bounds; actual coupled torque
has a separate full-travel bound. Yaw/roll maxima are not simultaneously additive.
`geometryCapacity()` is the explicitly raw, gain=1 archive reference helper;
`tvcMomentCapacity()` is the runtime signed/gain-scaled contract.

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
the public replay reader. **I4 output equivalence was explicitly retired for Phase 2 and Phase 3**:
natural aero is an intentional physics change. `goldenPolicy.ts` records the archive
version and each reviewed retirement with a reason. An unknown physics/archive version
fails with explicit regenerate/retire instructions; equality still enables output-leaf
comparison. Every current-physics substep is compared exactly at 30/60/144 FPS. Old numeric/categorical outputs remain preserved for benchmark comparison;
`compareRecordedLeaves` and its strict leaf tests remain available. No golden was
regenerated and no numerical tolerance was widened. Public replay version rejection
remains unchanged.

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
  Release45 reports incidence at 0/0.2/0.5/1/1.5 s, maximum body-rate vector magnitude and maximum attitude step.
  Tail slide reports the first nose-below-horizon sample measured from the apex, the
  first sample with non-positive vertical speed; the entry climb is scenario setup.
  Sideslip reports 1 s speed loss.
- Tracks stop on `alive = false`; reports include actual duration/alive status.
  Speed loss uses the existing arcade km/h conversion (5.4 × simulation m/s).

## Historical Phase 0 findings and Phase 3 resolution

The measurements below describe the archived Phase 0 runtime, not current authority.
The owner has since approved directional command capacities and separate coupled
physical moment bounds; Phase 3 implements that resolution at scalar gain 2.

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
   Phase 3 resolves the capacity contract with positive/negative command capacities
   before tuning `thrustVectoring.gain` against the Cobra/Kulbit goldens.
   Treating the displayed nose-down maximum as pull authority would overstate the
   nose-up authority those maneuvers use. Raw archive geometry helpers remain at gain 1;
   the runtime contract includes the authored gain and directional signs explicitly.

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
The old fixed-flow legacy-overlay equality fixture has been superseded by Phase 3
allocation conservation and actual-moment reconstruction checks. The new engine,
allocation and path/work tests enforce ownership without retaining obsolete generic
PSM rate expectations. See the implementation report for every migrated assertion.


## Jet Drift / Phase 4.5

Run `npm run flight:bench -- benchmarks/flight/jetDrift.report.ts` for the no-C entry grid, partial holds, mirrored handoffs, release/reapply, matched-state exit treatments, normal flight, reserve and ablation diagnostics. Runs use the existing 120 Hz harness. Targets in `targets.ts` are report-only.

Immutable Phase 4 starting measurements live in `jet-drift-baseline/`; reviewed implementation measurements live in `jet-drift-results/`. Compressed traces are JSON (`gzip -dc <trace.json.gz>`), including exact initial states/commands and sampled force records. Fresh output goes to ignored `out/jet-drift-current/`. `DRIFT_STAGE=baseline` refuses to overwrite the archive. See `docs/phase45-implementation-report.md` for units, version policy and limitations.
