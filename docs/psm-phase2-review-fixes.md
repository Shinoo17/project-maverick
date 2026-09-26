# Phase 2 — response to independent review

Current physics: `p3-natural-aero-2.1`. **Code corrections are implemented; Phase 2 acceptance is still pending owner playtest and B9 target authoring.** This supersedes the completion claim and current-behavior descriptions in [the initial report](psm-phase2-review.md). [The independent review](psm-phase2-code-review.md) is preserved unchanged. No commit, engine allocation, breakout or Phase 3 work.

**Findings 1 and 2 — corrected**

The extra `(1 - separation)` neutral fade was incorrect. It made low-speed separation suppress the controller at exactly the point where q-based natural damping vanishes. The solver now uses **only `1 - highAoa`**, as Rev. 3 specifies. Since highAoa includes airflow confidence, pitch/yaw neutral damping returns to the authored 9/s near rest; roll returns to its authored 9/s (F-22) / 5/s (Su-57). The natural layer remains independent of player input and does not acquire an artificial control floor.

The new rate-decay regression was run **before** the fix: 10 of its 12 cases failed, including both aircraft's zero/near-zero contraction checks and the actual C-release reproduction. After the correction, all 12 pass. Fixed-flow tests seed rates `{pitch: 2.9, yaw: -2.3, roll: 1.7}` at speeds 0, 0.5 and 1.999 m/s, with separation=1 and legacy PSM active. Every step must contract by the profile's exact exponential and converge below 1e-9 within a time derived from `log(initial/epsilon)/response`; no game-feel deadline was promoted to an invariant.

The real reproduction is shared by tests/reports in `releaseSafety.ts`: 105 m/s at 4000 m, C + pitch 1 + W for 5 s, then neutral axes with W released or held. Powered release remains alive/recoverable for 40 s and must return to `normal` and count the qualifying maneuver. Unpowered CI checks the original 14 s recovery window; the extended report continues until 40 s or actual terrain impact. Finite state, normalized quaternion and actuator slew remain hard throughout.

The owner explicitly selected **“คืน pitch-alpha ตาม Rev. 3”**. `stall.recoveryAoaDeg/criticalAoaDeg` therefore again evaluate **`abs(alphaDeg)`**, while `aero.alphaNormalDeg/alphaCriticalDeg` evaluate **unsigned incidence**. Exponential separation memory stays; beta restoring/drag still act. A new test holds pitch alpha fixed while changing beta, requiring identical separation targets but different highAoa factors. Pure sideslip no longer falsely satisfies the pitch-alpha stall band. No profile curve or band values were retuned in this fix.

**Finding 3.1 — explicit version policy restored**

`goldenPolicy.ts` centralizes the Phase 0 archive version and version-scoped I4 retirement reasons. Equal physics/archive versions require output equivalence; reviewed Phase 2 retirements allow archived-input comparison. Any unknown physics or archive version throws a message requiring deliberate **regenerate goldens or retire I4** action. The current literal is no longer pinned in 18 scenario tests. A negative test verifies future-version failure and its instructions. The physics version was bumped so replays from the defective draft are not silently accepted. All 18 archives remain unchanged and exact 30/60/144 FPS checks remain.

**Finding 3.2 — benchmark wiring corrected**

- **B8 `recovery.naturalDuringDelay`** now measures entry incidence minus incidence after a documented **0.2 s benchmark observation window** in neutral release45, with C/assist inactive; target is strictly >0. It measures combined flight response and does not pretend that Phase 5 delayed assistance already exists or that all incidence reduction comes from natural restoring. Natural-only contribution evidence remains the ablation and per-step ledger.
- **B10 `tailSlide.flipTime`** uses the plan ID and ≤4 s target in the standard report. Null/unreached and >4 s values produce `⚠ out`. Extended tail-slide reporting reuses the same target.
- **B20 `sideslip60.speedLoss1s`** uses the plan ID and each aircraft's captured Phase 1 baseline ×1.3, with a strict lower bound. Its archived baseline is 2.393652 arcade km/h, so the target is >3.111748. Threshold wiring, including equality/null behavior, is tested without asserting feel outcomes in CI.
- **B9** now prints `pending playtest`, and JSON/Markdown explicitly expose pending Phase 2 acceptance instead of treating missing targets as a completed report-only task.

**Finding 3.3 — remains open**

No human/browser handling playtest was performed in this fix. B9 ranges and the provisional 20–30° neutral-fade band cannot be approved from automated traces alone. They remain unmodified. The owner playtest checklist below is ready to use; Phase 2 must not be marked complete or merged as playtest-approved on the basis of these passing tests.

**Safety assertions recovered from report-only fixtures**

`reportExpect` now accepts only finite numeric feel values. It does not swallow nonfinite values or unexpected matcher errors. Call sites explicitly use real assertions for alive, phase, completion and finite state. `stepLegacyFlight` validates state/quaternion/alive after **every** integration, including the previously single-line loops. The numeric orientation-hold expectation is reported as angular displacement rather than sending a state object through a permissive matcher. Tests exercise nonfinite/stopped-state failures directly.

The reverse-flow fixture's original monotonic-speed check is back in CI alongside kinetic-plus-potential energy and actuator/state checks. Monotonic speed is asserted for that exact neutral backward-flow fixture, not generalized to gravity-driven dives. The no-authority rate-decay and shipped C-release lifecycle checks are also in CI, independent of report matchers.

One original Cobra PD pilot still misses its *desired* completion count. This is now demonstrably different from the tumble defect: at 12 s it is `normal`, speed=199.967 m/s, pitch rate=−0.0000568 rad/s, with peakAlpha=67.74045°. The existing legacy counting gate is ≥70°, so completed=0 is correct for this run. Recovery/phase remain hard, and a hard assertion checks completion against that existing gate. The original desired count of 1 remains a visible numeric feel miss. The C5 test does exceed the gate and **must** complete, protecting the defect exposed by review. No torque/authority was added to force the Cobra fixture over 70°.

**Current reproduction results**

Times are seconds **after** releasing C. “Settled” is a report-only <0.05 rad/s total-rate window that remains below the threshold afterward; the hard no-q contraction test uses profile coefficients and numerical epsilon instead.

| Aircraft | W after release | Settled | First normal | Outcome |
|---|---:|---:|---:|---|
| F-22 | held | 2.8750 s | 5.0833 s | alive and normal at 40 s |
| Su-57 | held | 2.5333 s | 5.3500 s | alive and normal at 40 s |
| F-22 | released | 4.6667 s | 8.6917 s | normal flight resumes; unattended descent hits terrain at 36.050 s |
| Su-57 | released | 4.2250 s | 8.8500 s | normal flight resumes; unattended descent hits terrain at 35.775 s |

At t=4 s with W held: pitch rate F-22=0.003832 rad/s, Su-57=0.003954 rad/s. At t=6 s both are normal, at 89.039 / 78.399 m/s. This replaces the reviewed ~2.9 rad/s sustained tumble and low-speed hover. The underlying legacy energy clamp is **not** claimed fixed in general; Phase 3 energy/path-rate work remains deferred.

**Disposition of the ten accepted-with-disclosure findings**

| Review item | Current disposition |
|---|---|
| 4.1 reversal payoff | Still an open feel gap: final B15 heading is now 18.539° / 19.750°, versus Phase 1 161.784° / 153.237° and reviewed draft 7.407° / 103.990°. Legacy phase-based recovery grip and natural restoring still compete. No hidden authority or early Phase 4 port. |
| 4.2 high-q sustained rates | Unchanged: hardTurn900 mean G is 10.643 / 10.657, −9.59% / −9.51% versus Phase 1. The high-q equilibrium still reduces rate ceiling (about 18% at 300 m/s). Human handling review remains necessary. |
| 4.3 diagnostic state cost | `flightForces` remains on `AircraftState`, enters snapshots/replay checks and allocates per substep. It never feeds physics. Defer return-value/debug-gating design until allocation work; no unrelated state refactor here. |
| 4.4 report matcher swallowed hard assertions | Fixed with numeric-only matcher, real safety/lifecycle assertions, checked integration wrapper and CI negative tests. |
| 4.5 monotonic-speed invariant relocated | Restored to CI for the exact original reverse-flow fixture, alongside an energy bound. |
| 4.6 pre-controller damping guarantee | Comment corrected: exponential damping alone cannot reverse its supplied pre-controller rate; no unconditional guarantee is claimed for the combined final rate. Integration order unchanged. |
| 4.7 instantaneous natural damping unused by solver | Retained as a diagnostic/test output; the integrator uses the damping coefficient through `naturalRateStep`. Its per-step computation cost is acknowledged. |
| 4.8 earlier stall presentation | Retained: the label now describes onset of the continuous speed/pitch-alpha band (below 350 arcade km/h or above 20° absolute alpha). It is informational and never switches physics. Full separation thresholds remain 300 km/h / 30° alpha. |
| 4.9 fragile controller fixture | Fixed: observes the prepared pre-step separation state, starts with nonzero roll rate, and explicitly includes natural damping; no post-integration velocity mutation to reconstruct expectations. |
| 4.10 README title | Updated to “Flight instrumentation and Phase 2 tuning”; current version, version policy, hard/report distinction and pending playtest documented. |

**Other current benchmarks**

- Release45 at 0 / 0.5 / 1 / 1.5 s: F-22 **45 / 13.386 / 3.265 / 1.022°**, Su-57 **45 / 13.639 / 3.348 / 1.063°**. Peak rate **4.862 / 3.616°/s**. B9 remains pending, not accepted from these values.
- B8 0.2 s incidence reduction: **15.692 / 15.540°**, target >0, `ok`.
- B20 one-second energy loss: **32.539 / 34.985 arcade km/h**, target >3.111748, `ok`. This is lower than the reviewed draft's 48.162 / 52.215 because pure beta no longer drives the pitch-alpha separation band; beta drag/restoring remain effective.
- **B10 is out of target.** Reverse flow begins at 5.9583 s, but neither the exact 90° nor 89.9° vertical seed drops below the horizon in the 30 s extended observation after the damper fix. At 30 s F-22/Su-57 exact seeds have finite speed 27.648 / 26.522 m/s, incidence 19.978 / 21.457°, and pitch rate 0.004428 / 0.004161 rad/s. The prior 16.11 / 19.05 s flip results were from the defective draft and are superseded. No fast-tail-slide torque or new recovery mechanism was introduced to meet B10.

Full current closed-loop and archived-input tables: `benchmarks/flight/out/phase2.md`. Target statuses: `out/report.md`. Actual review-reproduction ledgers: `out/traces/neutralAfterC5.<aircraft>.W0|W1.jsonl`. These generated files are ignored and regenerated by `npm run flight:bench`.

**Validation**

- `npm test`: **29 suites / 363 passed / 0 failed** (reviewed draft: 26 / 343).
- New checks: 12 neutral-release safety cases; 4 target-wiring cases; 2 report-safety cases; 1 version-policy case; 1 pitch-alpha/beta independence case.
- `npm run flight:bench`: **6 suites / 15 passed / 0 failed**. Numeric feel misses remain visible. Safety/lifecycle failures are no longer swallowed.
- Typecheck and production build: **PASS**. Vite still reports the existing >500 kB chunk advisory; no bundling changes made.
- All 18 archived tracks: exact **30/60/144 render FPS** substep equality; fixed 120 Hz flight / 60 Hz world tick unchanged. Public replay/version tests pass. Golden files unchanged; `git diff --check` clean.

**Review-specific files**

| File | Role in this fix |
|---|---|
| `src/game/flight/stepFlight.ts` | Single highAoa neutral fade and low-confidence rationale |
| `src/game/flight/stall.ts` | Restore pitch-alpha separation semantics |
| `src/game/flight/profileTypes.ts` | Correct stall field documentation |
| `src/game/flight/profile.ts` | Reject old draft replays via version 2.1 |
| `src/game/flight/aerodynamics.ts` | Correct damping guarantee comment only |
| `benchmarks/flight/goldenPolicy.ts` | Explicit, version-scoped I4 retirement policy and actionable errors |
| `benchmarks/flight/releaseSafety.ts` | Shared C5→neutral regression reproduction |
| `benchmarks/flight/targets.ts` | B8/B10/B20 targets, strict minimum, pending B9/playtest metadata |
| `benchmarks/flight/metrics.ts` | B8 observation and B10/B20 IDs/status wiring |
| `benchmarks/flight/flightBenchmarks.report.ts` | Visible pending acceptance and strict target formatting |
| `benchmarks/flight/phase2.report.ts` | Current comparisons, target reuse, C-release metrics/ledgers |
| `benchmarks/flight/legacyFeel.ts` | Restrict reporting to finite numeric feel failures |
| `benchmarks/flight/legacyStep.ts` | Hard per-integration state/alive validation |
| `benchmarks/flight/legacyFlightHandling.report.ts` | Real hard assertions; numeric orientation-hold report |
| `benchmarks/flight/legacyManeuvers.report.ts` | Hard recovery/counting gates, explicit below-70° feel miss |
| `benchmarks/flight/legacyPoweredPsm.report.ts` | Restore hard lifecycle/alive assertions |
| `benchmarks/flight/legacyStall.report.ts` | Restore hard lifecycle/finite/alive assertions |
| `tests/invariants/neutralRelease.test.ts` | No-q contraction, C-release liveness, original speed/energy safety |
| `tests/invariants/goldenTracks.test.ts` | Consume explicit policy and test unknown-version rejection |
| `tests/flightBenchmarks.test.ts` | Verify target wiring and pending B9 without feel thresholds in CI |
| `tests/legacyBenchmarkSafety.test.ts` | Ensure nonfinite and stopped/invalid state always fail |
| `tests/envelope.test.ts` | Pitch-alpha/beta separation and independent incidence envelope |
| `tests/stall.test.ts` | Restore pure-beta non-stall expectation |
| `tests/phase1Profile.test.ts` | Robust nonzero-rate pre-step controller/damping fixture |
| `benchmarks/flight/README.md` | Current semantics, guard, report policy and acceptance status |
| `docs/psm-phase2-review.md` | Mark prior report historical and withdraw completion claim |
| `docs/psm-phase2-review-fixes.md` | Current review response and pending playtest checklist |

**Owner playtest still required**

Use the existing Playground and detailed telemetry; run both aircraft with the same controls. The current automated report is the numerical reference, not a playtest substitute.

1. At approximately 45° incidence / 70 m/s, release every axis without C. Assess onset, overshoot, any snap, and how nose rotation differs from path alignment. Compare F-22/Su-57; do not rank one as a required winner.
2. Hold C + full pitch + W for 5 s at the documented entry condition. Release axes/C with W held, then repeat releasing W too. Confirm controllability after decay and distinguish normal unpowered descent from a hover/tumble trap.
3. Compare normal/high-speed pull, neutral release and reversal against the prior feel, including 900 arcade km/h and the upper-speed envelope. Decide whether the ~9.5% mean-G loss and high-q damping are acceptable.
4. Review the B15 reversal payoff gap and B10 slow/no-flip result explicitly. Do not silently treat them as accepted because reports are non-blocking.
5. Record approved per-aircraft B9 target ranges and any revised independent neutral-fade bands, with aircraft, scenario, date and observations. Re-run tests/benchmarks after tuning. Until then, keep `phase2Playtest.status = 'pending'` and Phase 2 acceptance open.
