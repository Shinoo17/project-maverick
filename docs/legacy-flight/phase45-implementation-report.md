# Phase 4.5 implementation report

Baseline parent: `a581ee5c967c2aec7e4f8a00ed054125762f86d5` (planning revision after Phase 4).
Implementation commit: `05d50e0` (Phase 4.5A–C and archived evidence).
Implementation follows Rev. 4; Phase 5 recovery assistance and Phase 6 bindings are separate work.

## Baseline and intentional behavioral migrations

Before changing physics, added no-C benchmark tracks and observational path telemetry to the existing 120 Hz harness. Archived initial states, exact commands, profiles, metrics and 0.25-second diagnostic samples in `benchmarks/flight/jet-drift-baseline`; `.json.gz` files contain ordinary JSON. Source profile was `p4-automatic-envelope-2`. No Phase 0 golden is regenerated. Output-equivalence retirement remains explicit in `goldenPolicy.ts`.

Intentional assertion migrations (recorded before replacing old assertions):

- P4-2's five-degree sign proxy and mandatory zero first pitch request at alpha +10 / beta -60 are superseded by Rev. 4 §5.4. At 60 m/s, simultaneous pitch/yaw 0.5/1 and 1/1 previously requested zero pitch; the contribution projection requests approximately 1.396 and 2.164 rad/s² respectively, before allocation. At 120 m/s the corresponding requests are 2.046 and 3.414. Pure outward pitch remains restricted (roundoff tolerated). Tests instead check combined outward restriction, inward/tangent preservation, mirrored signs, finite endpoints and continuity when either input crosses zero. Projection weights use squared input travel so a tiny new input cannot abruptly unlock the other axis. Historical cross-axis traces were additionally reproduced from an isolated, untouched checkout of the source revision and stored under `jet-drift-baseline/cross-axis`; final short cross-axis traces retain every substep.
- I17 keeps base-drag-only trim, but an explicit maneuver power request is now authorized. A held pitch at zero speed may request real dry thrust. The zero-thrust capability fixture must explicitly disable the new control-power source; it still requires exactly zero TVC at zero actual thrust.
- The five-second C fixture now reaches deep incidence (initial C comparison measured peak 112° F-22 / 106° Su-57). Its old `<70°` expectation described the Phase 4 entry deadlock, not a safety limit. Retain its actuator, numerical, live recovery and rate-convergence checks; completion observation must reflect whether the flown trajectory crossed 70°.
- Legacy lateralAcceleration wiring is checked with assistance enabled; deliberate drift can fade that arcade term. Natural flow response has a separate tested profile budget.

## Implementation

4.5A: canonical HUD conversion authors q knots at 650/850 km/h; explicit S intent is weaker than Airbrake. Entry-demand shaping reaches full permission at 0.7 pitch/yaw command while leaving positional mouse shaping unchanged. A start-of-step flow-only translational model is separated from bounded arcade alignment/anticipation. Assistance permission is smoothed; gravity support retains the existing convention.

4.5B: immediate all-axis activity and finite linear release memory share one authored handoff window. Measured incidence/confidence gates continuation. Roll does not initiate attached breakout. The combined limiter projects the outward component and includes finite-step curvature near 0/180 degrees. Angular authority/allocation remains unchanged.

4.5C: bounded dry control-power request is independent of non-base drag and speed error; actual engine spool is shared by translation and TVC. Airbrake uses forward/crossflow coefficients, combined with S/overspeed using max per axis. Exponential body-axis impulses cannot reverse a component. Midpoint impulse work is charged once, then thrust/drag/gravity integration uses the braked path. The existing low-speed engine path cap and signed thrust zero crossing are retained.

Final profile version: `p4.5c-jet-drift-1`. Command schema remains 1 because bindings and normalized command shape are unchanged. New intent and assist memory is initialized by spawn/reset, cloned in snapshots and reproduced from deterministic commands; old public replays are rejected by profile version.

## Validation and measured results

Automated implementation gates passed; human feel acceptance remains pending. Human playtest is required for handling/motion comfort; automated traces do not establish that a named maneuver is achieved. Net horizontal headings (null at degenerate projection), 3D velocity direction change and cumulative nose rotation are reported separately.


### Entry measurements (attached, level, trim initialized, X + full pitch, no C/burner)

All speeds are HUD arcade km/h. `—` means 30° was not reached during the three-second track. Each run starts at 3000 m with identity orientation and zero rates; engine power is base-drag trim at the starting speed. Commands and the complete initial state are archived, not inferred from this table.

| Aircraft | Start speed | Baseline time to 30° | Final time to 30° | Speed at 30° |
|---|---:|---:|---:|---:|
| f22 | 350 | 1.533 s | 0.817 s | 325.0 |
| f22 | 450 | 1.925 s | 0.742 s | 418.0 |
| f22 | 500 | 2.158 s | 0.725 s | 464.5 |
| f22 | 600 | 2.725 s | 0.658 s | 559.4 |
| f22 | 650 | — s | 0.625 s | 607.5 |
| f22 | 700 | — s | 0.617 s | 651.8 |
| su57 | 350 | 1.533 s | 0.858 s | 324.4 |
| su57 | 450 | 1.925 s | 0.775 s | 416.9 |
| su57 | 500 | 2.158 s | 0.750 s | 463.1 |
| su57 | 600 | 2.725 s | 0.675 s | 557.6 |
| su57 | 650 | — s | 0.633 s | 605.8 |
| su57 | 700 | — s | 0.625 s | 649.7 |

All 450–600 pitch-entry samples meet the provisional 0.4–0.8 s report target. Both 650/700 samples enter above 350. These remain reports, not hard CI feel thresholds. At 350, entry is slower (about 0.82/0.86 s) and has less energy available.

### Hold, handoff and exit

At 500, full pitch + X for one second then 0.5 pitch + X for three seconds gives 3.28/3.26 s above 30° for F-22/Su-57 (includes entry). Final speeds are 176/168; altitude gains are 101/100 m. This is an incidence-duration proxy, not proof of useful control for that entire interval. The observation ends at the four-second track boundary while incidence remains above 30°; the full duration is right-censored. The 1.5–3 s useful-adjustment goal remains pending human playtest, with no automated target until useful control has a defined measure; `secondsAbove30` is not compared against that range. The reports include unmet angular demand and full actuator/allocation records.

Pitch → yaw → roll-only → pitch uses 0.1 s neutral handoffs and then neutral release. Across 0.15/0.22/0.30 s release tuning, minimum limiter during the roll segment is 0.933/0.954/0.966 on F-22 and 0.900/0.877/0.863 on Su-57. Different trajectories mean a longer release window does not monotonically improve the flown result. At the authored 0.22 s both accept roll continuation; release memory reaches exactly zero and renewed input has immediate priority. Real FlightInput cardinal/diagonal mouse, recenter, Q/E and mixed keyboard overrides are tested and replayed at 30/60/144 FPS. Q/E remains digital until Phase 6's deterministic ramp work.

Exit comparisons within each version share one saved state after 1.2 s of pitch + X. On F-22, brake-released/held-burner ends at 402 km/h and 4.1° incidence versus 226 km/h and 110.6° with burner off after four seconds; 3D velocity-direction changes are 132° versus 29°. Su-57 ends at 434 km/h and 3.1° versus 199 km/h and 24.2°; direction changes are 110° versus 34°. A 0.6 s burner pulse gives a different outcome from holding it. Holding X with burner lowers final speed to 257/289. Do not compare baseline and final exit numbers as identical starting states: the saved entry itself changed.

Both aircraft can overshoot toward 180° after neutral release because inherited rates, restoring moments and nozzle travel persist. Phase 5 delayed recovery assistance is intentionally absent. No unconditional recovery time or monotonically falling rate is asserted. The existing 14/40-second neutral safety fixtures still pass.

### Normal flight and ablations

| Three-second track | F-22 baseline → final speed | Su-57 baseline → final speed |
|---|---:|---:|
| Full stick, 500 | 357.7 → 417.3 | 356.4 → 415.3 |
| Hard turn, 900 | 753.8 → 759.6 | 751.7 → 757.8 |

Small-stick aiming, unbraked roll and cruise have unchanged final speed/height in the captured four-second comparisons. Full-stick 500 intentionally retains more energy because its limited unbraked entry request now requests some dry control power. It still does not reach 30° in the comparison window. No historical acceptance range is invented; the archived differences are candidates for owner playtest.

At 500 with dry power and directional brakes retained, full arcade assistance takes 1.83/2.14 s to reach 30°; flow-only assistance fade (15–60°) takes 1.77/2.07 s; explicit intent-sensitive assist separation takes 0.725/0.750 s. This isolates the assistance deadlock. Separate dry-power ablations at 0/0.1/0.7 retain the same braking model; they do not reproduce the scalar-brake Phase 4 baseline. Low-power and non-TVC results are reported rather than forced to match TVC feel.

### Known limits and presentation

- F-22 yaw-only at 350/450 does not reach 30° within three seconds (peaks 19°/27°); yaw at 500 takes 2.83 s. Su-57 reaches 30° across the yaw grid in about 0.97–1.94 s. F-22 commanded yaw TVC remains exactly zero; no floor inflation compensates for it. Deep F-22 combinations favor pitch/roll.
- Natural alpha/beta/reverse drag and stall's base-drag multiplier remain separate existing losses. Directional brake impulse work is additional, counted exactly once. S and overspeed combine with Airbrake by per-axis maximum, not addition.
- `translation.dragWork` is total dissipated drag + brake specific work; `brakeWork` is its brake subset. `maneuver.drag` now shows delivered axial brake deceleration plus natural drag. Work uses the existing split integration convention: brake midpoint impulse, axial thrust/drag displacement, energy-neutral bounded transverse rotation, then gravity constrained against final-velocity position integration. This is an arcade integration model, not a measured aircraft force law.
- Exhausted/locked reserve and full reserve are separate tracks; empty but initially unlocked reserve is retained as the original baseline comparison. Actual thrust, not requested power or reserve, owns both nozzle capacity and trajectory force.
- Flight Lab shows entry/activity/handoff, power sources, physical/assisted path, brake axes, specific work and limiting factors. Thai/English entry help now says X + pull in the 350–700 band; Shift is for exit. Existing X/Space/C bindings are retained.
- Add `?driftCamera` before the route hash to enable fixed-world diagnostic framing. It fits projected corners of the loaded normalized model bounds. The nose pipper has an edge indication like the distinct FPM. Normal camera behavior is unchanged. Automated camera tests cover 30/60/90/120/180°, several aspect ratios, both mode arguments and reduced motion; they use conservative bounding boxes, not skinned-vertex or comfort validation.
- A fresh browser session confirmed keyboard flight starts, the aircraft and new Flight Lab values render at desktop and 760 × 820, and the browser error log is empty. The existing narrow Flight Lab overlay covers much of the scene by design and can be disabled. Automated mouse command/replay checks do not replace pointer-lock handling and motion-comfort playtests. Final camera/HUD polish remains Phase 7.

### Post-implementation review corrections

Completed the all-axis activity migration in glass HUD and warning observers, including the observer parameter name and test fixtures. Roll-only drift remains POST_STALL without a false recovery/departure advisory; actual neutral release still restores advisories. Off-screen/behind-camera nose direction now uses a double edge chevron, distinct from the FPM's single chevron; the winged circle is reserved for on-screen direction.

Two observer choices are intentional for Phase 4.5. The instrumentation permission flag uses pitch/yaw `demand` to identify restricted entry permission, not every limitation during drift; roll-only continuation does not assert it. Stall/recovery warnings are suppressed for active high-AoA input, including roll at full separation. This avoids interrupting intentional drift but can also silence a departure advisory while the pilot fights a real departure. Activity is not proof of control; revisit this distinction in Phase 5 when recovery signals are available. Boundary and low-altitude warnings retain priority.

Removed the unused executable `usefulAdjustmentSeconds` target. The plan retains the human-playtest goal; incidence duration is only a proxy and does not establish useful control. Archived traces and source hashes describe implementation commit `05d50e0` and remain historical evidence.

Review validation: `npm run build` passed 536 tests in 38 files, TypeScript and production build. The focused `npm run flight:bench -- benchmarks/flight/jetDrift.report.ts` passed; metrics, entry target statuses, dry-power sweeps, ablations and handoff sweeps exactly match the archived Phase 4.5C report. Browser inspection of the real canvas painter covered on-screen, lateral and aft markers at desktop and narrow canvas sizes. `git diff --check` passed.

### Original implementation verification and reproduction

- `npm run build`: 532 tests passed in 38 files; TypeScript and production Vite build passed. Vite retains its Three.js chunk-size warning.
- `npm run flight:bench`: 23 benchmark execution/tests passed in 11 report files; this does not mean all feel targets passed. Entry targets emit report-only statuses, not pass/fail assertions. `DRIFT_STAGE=final npm run flight:bench -- benchmarks/flight/jetDrift.report.ts` captures the delivery corpus.
- Focused tests cover dimensional work and non-reversal, low-speed path bounds, contribution-aware incidence, command-independent physical response, smoothing/release, input routes, validation, actual-thrust power and replay rejection. Existing allocation, floor, coupled-torque, actuator, restoring and zero/reverse-flow checks remain active.
- `git diff --check` passed. Impeccable's mechanical detector reported no findings on the diagnostic HUD/camera edits.
- Before traces: `benchmarks/flight/jet-drift-baseline`. Intermediate A/B metrics and final C metrics/traces: `benchmarks/flight/jet-drift-results`. Normal report output remains under ignored `benchmarks/flight/out`. Sampled trace files contain initial state, run-length encoded 120 Hz commands and 0.25 s state/force snapshots; runTrack computes metrics on every substep. Use Python gzip/json or Node zlib to inspect `.json.gz`.

Implementation files: input/envelope/controller; physical path response and stepFlight; engineForces/speed; profile types/defaults/validation/version; spawn/state memory; instrumentation; diagnostic camera/scene and HUD/locales. Validation lives in `tests/jetDrift.test.ts`, extended camera checks, intentionally migrated historical assertions, the shared benchmark harness extensions and target/report files.

The preparation and 4.5A/B/C code and automated evidence are delivered. Human handling approval remains pending. Phase 5–9 are not marked complete.

Design tooling note: Impeccable found an existing unset `buildPath` preference; it is unrelated to this narrow diagnostic change and was left untouched. A future visual-design task can choose code-first or comp-first.
