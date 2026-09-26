# Phase 2 — Natural aerodynamics review

> **Historical pre-review snapshot (`p3-natural-aero-2`), superseded.** The independent
> review found a real low-speed neutral-damping blocker and an unauthorized stall-angle
> semantic change. Both are corrected in `p3-natural-aero-2.1`; see
> [the review-fix report](psm-phase2-review-fixes.md) for current code, tests and metrics.
> The earlier completion claim is withdrawn: Phase 2 acceptance remains pending owner
> playtest/B9 target authoring. Numbers and interpretations below describe the old draft.


Implemented against `docs/psm-implementation-plan.md`, Final Baseline Rev. 3. Read the complete plan and inspected Phase 0–1 runtime, tests and traces before editing. The untracked `docs/psm-architecture-review.md` was neither used as authority nor modified. No commit created. Stop here for review; Phase 3 is not implemented.

**1. Files changed**

All paths below are relative to the repository root. Generated `benchmarks/flight/out/` reports/traces are ignored and can be regenerated.

| File | Role |
|---|---|
| [benchmarks/flight/README.md](../benchmarks/flight/README.md) | Current Phase 2 commands, archive policy, diagnostic and migration documentation. |
| [benchmarks/flight/flightBenchmarks.report.ts](../benchmarks/flight/flightBenchmarks.report.ts) | Relabels the existing tuning report for the current physics version. |
| [benchmarks/flight/metrics.ts](../benchmarks/flight/metrics.ts) | Adds release incidence at entry/1 s and maximum attitude change per substep. |
| [benchmarks/flight/legacyFeel.ts](../benchmarks/flight/legacyFeel.ts) | Reports original migrated feel expectations without failing on target misses; preserves runtime errors. |
| [benchmarks/flight/legacyFlightHandling.report.ts](../benchmarks/flight/legacyFlightHandling.report.ts) | Retains backward-flight/heading-hold fixture and original expectations as a report. |
| [benchmarks/flight/legacyManeuvers.report.ts](../benchmarks/flight/legacyManeuvers.report.ts) | Retains Cobra/reversal, neutral PSM and yaw-reversal feel fixtures. |
| [benchmarks/flight/legacyPoweredPsm.report.ts](../benchmarks/flight/legacyPoweredPsm.report.ts) | Retains prolonged PSM/release feel fixture for both aircraft. |
| [benchmarks/flight/legacyStall.report.ts](../benchmarks/flight/legacyStall.report.ts) | Retains low-speed recovery, zero-speed fall, mixed-axis and pedal-turn feel fixtures. |
| [benchmarks/flight/phase1-metrics.json](../benchmarks/flight/phase1-metrics.json) | Captures the pre-edit Phase 1 benchmark run; archive goldens were not overwritten. |
| [benchmarks/flight/phase2.report.ts](../benchmarks/flight/phase2.report.ts) | Closed/open-loop comparisons, curve ablations, extended tail slides, incidence migration audit and per-substep JSONL diagnostics. |
| [src/content/flight-profiles/defaults.ts](../src/content/flight-profiles/defaults.ts) | Removes legacy PSM drag; leaves common observation/fade defaults. |
| [src/content/flight-profiles/f22.ts](../src/content/flight-profiles/f22.ts) | Authors F-22 restoring/damping/drag and preserves attached neutral roll response. |
| [src/content/flight-profiles/su57.ts](../src/content/flight-profiles/su57.ts) | Authors separate Su-57 restoring/damping/drag and attached neutral roll response. |
| [src/game/flight/aerodynamics.ts](../src/game/flight/aerodynamics.ts) | Pure natural restoring, pressure damping, alpha/beta drag and exact exponential damping step. |
| [src/game/flight/flightForces.ts](../src/game/flight/flightForces.ts) | Typed last-substep diagnostic ledger; no authority budget or allocator. |
| [src/game/flight/airflow.ts](../src/game/flight/airflow.ts) | Retires Phase 1 legacy near-rest incidence conventions. |
| [src/game/flight/envelope.ts](../src/game/flight/envelope.ts) | Documents active separation/highAoa factors and still-observed legacy limiter/recovery fields. |
| [src/game/flight/instrumentation.ts](../src/game/flight/instrumentation.ts) | Exposes the actual last integrated force ledger alongside end-pose observations. |
| [src/game/flight/maneuvers.ts](../src/game/flight/maneuvers.ts) | Consumes canonical incidence; preserves manual C entry/exit and powered-rate ownership. |
| [src/game/flight/profile.ts](../src/game/flight/profile.ts) | Bumps replay physics version to p3-natural-aero-2. |
| [src/game/flight/profileTypes.ts](../src/game/flight/profileTypes.ts) | Phase 2 curve/damping/drag contracts; migrates neutral flag to attached neutral roll response; documents separation parameter semantics. |
| [src/game/flight/stall.ts](../src/game/flight/stall.ts) | Continuous speed/incidence separation target and exponential memory; cause is presentation only. |
| [src/game/flight/stepFlight.ts](../src/game/flight/stepFlight.ts) | Combines natural contributions with existing rate/force integration; fades neutral damping; removes PSM drag discount; preserves gravity through zero. |
| [src/game/flight/validateProfile.ts](../src/game/flight/validateProfile.ts) | Required/finite/nonnegative curve, damping, drag and neutral-roll validation, ordered full-domain knots. |
| [src/game/state/WorldState.ts](../src/game/state/WorldState.ts) | Optional last-substep diagnostic record, never read back by physics. |
| [docs/psm-phase2-review.md](../docs/psm-phase2-review.md) | This review report, including all requested deliverables. |
| [tests/aerodynamics.test.ts](../tests/aerodynamics.test.ts) | 19 Phase 2 cases: natural signs/zeros, damping, continuity, boundaries, neutrality, gravity crossing, finiteness, deterministic tail slide, trim and profile validation. |
| [tests/airflow.test.ts](../tests/airflow.test.ts) | Canonical rest/near-rest semantics and end-step telemetry expectations. |
| [tests/envelope.test.ts](../tests/envelope.test.ts) | Incidence-based separation and now-active neutral-fade tuning with independent aircraft profiles. |
| [tests/flightHandling.test.ts](../tests/flightHandling.test.ts) | Keeps normal-flight regression checks; relocates only superseded backward-heading feel test. |
| [tests/flightInstrumentation.test.ts](../tests/flightInstrumentation.test.ts) | Fixed-flow equilibrium now balances the observed controller against natural damping. |
| [tests/invariants/goldenTracks.test.ts](../tests/invariants/goldenTracks.test.ts) | Explicitly retires I4 output equivalence; preserves 18 archived command tracks and exact frame-rate determinism. |
| [tests/maneuvers.test.ts](../tests/maneuvers.test.ts) | Keeps input/C/lifecycle/replay invariants; relocates three superseded maneuver feel fixtures. |
| [tests/phase1Profile.test.ts](../tests/phase1Profile.test.ts) | Removes retired psmDrag assertions; accounts for continuous separation in surface-rate observation. |
| [tests/poweredPsm.test.ts](../tests/poweredPsm.test.ts) | Keeps thrust, TVC, entry, brake, energy and replay checks; relocates prolonged-release feel fixture. |
| [tests/speedLimits.test.ts](../tests/speedLimits.test.ts) | Fixes the dive fixture to copy quaternion components correctly; preserves overspeed invariant. |
| [tests/stall.test.ts](../tests/stall.test.ts) | Replaces threshold/hysteresis assertions with continuous target/time-constant checks; preserves lifecycle/validation and relocates feel fixtures. |

**2. Natural aerodynamics architecture**

`observeAirflow(start pose)` → `stepStall` continuous separation memory → `interpretEnvelope` high-incidence factor → `naturalAerodynamics` restoring/damping/drag → existing rate controller + existing TVC correction + natural rate increments → existing quaternion/velocity integrator.

- Natural aero accepts **only** `AirflowState`, separation, body rates and `AeroProfile`. No input, C, PSM capability, engine, phase, aircraft-name branching, control floor or recovery assist.
- Pitch restoring is `−curve(incidence) × q × confidence × sin(alpha) × cos(beta)`. The projection prevents an undefined pitch plane at pure sideslip. Yaw is `+curve(incidence) × q × confidence × sin(beta)` because this observer defines positive beta as velocity to body-right; positive body yaw turns toward it. The minus sign in the conceptual baseline formula assumes the opposite beta convention.
- Curves are continuous piecewise-linear, cover 0–180°, and remain nonnegative. Restoring is zero within numerical epsilon at aligned and exactly reverse flow. Nearby reverse-flow perturbations move away from the antipode. No random noise or new tie-breaker was added. The existing pose-based lateral tie-breaker remains visible in `stepFlight`.
- Damping interpolates attached/separated coefficients and scales with q/confidence. Its integrated contribution uses `1 − exp(−coefficient × dt)`. Reported equivalent acceleration is the exact increment divided by dt; the natural helper also exposes instantaneous damping for inspection.
- Alpha drag uses projected pitch-flow squared plus authored reverse-flow residual; beta drag uses sideslip sine squared. Both scale with speed² and apply outside C/PSM. The old PSM-only drag and `turnLoss × 0.55` discount are removed. Existing separation-scaled base drag remains; governor trim still reads **only** `flight.drag × speed²` in the unchanged `speed.ts`.
- Continuous separation reuses `stall.severity` as memory, preventing a second smoothing clock. The former threshold pairs now define smooth bands: low-speed loss is `1 − smoothstep(stallSpeedKph, recoverySpeedKph, speedKph)`; incidence loss is `smoothstep(recoveryAoaDeg, criticalAoaDeg, incidence) × confidence`. Target = maximum of those factors. Entry/reattachment use the existing authored seconds as exponential time constants. Neither the diagnostic `cause` nor any regime label chooses physics. The low-speed factor is an arcade loss-of-support/control approximation, not a claim of physical aerodynamic force at zero q.
- Phase 1 did **not** implement separate physical/floor authority budgets. The existing 0.12 controller floor and `stall.controlAuthority = 0.25` are preserved and still identified as legacy. Natural aero has no floor. Phase 3 allocation, engine spool/capacity, and Phase 4 breakout remain absent. Legacy phase-based path grip, C, High-G, inputs and burner ownership remain intact.

**3. Neutral-damping resolution**

For a zero target, pitch/yaw use `neutralResponse × (1 − highAoa) × (1 − separation)`. Roll uses its attached neutral response with the same fade. At highAoa = 1, the entire controller's zero-target increment is zero, including the old PSM fallback `rateResponse = 5/s`. Removing only `neutralResponse` would have left that hidden damper fighting restoring. Nonzero targets retain the existing rate/counter-response pipeline.

`neutralDampingDuringPsm` is removed. The new `flight.neutralRollResponse` is 9/s for F-22 and 5/s for Su-57, preserving their **normal-flight** preexisting roll-release behavior without a PSM-specific flag. Natural damping/restoring are separate contributions; neutral handling returns smoothly as incidence/separation fall. The diagnostic `controller` includes `legacyNeutralDamping`; do not add that subcomponent a second time.

**4. Profile changes**

Numbers are initial arcade tuning, not real aircraft data or settled human-playtest acceptance.

| Field | F-22 | Su-57 |
|---|---|---|
| restoring knot incidence (degrees) | 0, 20, 45, 90, 180 | same |
| pitch stiffness at knots (rad/s² at q=1) | 1.2, 1.2, 1.0, 0.65, 0.45 | 1.2, 1.1, 0.6, 0.3, 0.25 |
| yaw stiffness at knots | 0.9, 0.9, 0.75, 0.5, 0.35 | 0.9, 0.85, 0.45, 0.25, 0.2 |
| attached damping P/Y/R (1/s at q=1) | 0.10 / 0.12 / 0.08 | same |
| separated damping P/Y/R | 0.65 / 0.55 / 0.35 | 0.45 / 0.40 / 0.30 |
| alphaDrag (1/m) | 0.0025 | 0.0027 |
| betaDrag (1/m) | 0.0030 | 0.0032 |
| reverseDrag (fraction of alphaDrag) | 0.4 | 0.4 |
| flight.neutralRollResponse (1/s) | 9 | 5 |

Reused separation fields: `stall.recoveryAoaDeg/criticalAoaDeg = 20/30°`, `stall.stallSpeedKph/recoverySpeedKph = 300/350 arcade km/h`, `entrySeconds/recoverySeconds = 0.4/1.2 s` now mean bands/time constants, not hysteresis/deadlines. Their values remain independent of `aero.alphaNormalDeg/alphaCriticalDeg = 20/30°`. That neutral-fade band remains provisional pending human playtest. Removed fields: `flight.neutralDampingDuringPsm`, `maneuver.psmDrag`. No engine/allocation profile fields were added.

**5. Hard invariant results**

| Invariant | Result | Evidence / qualification |
|---|---|---|
| I1 finite state / normalized quaternion | PASS | All 18 scenarios each substep, existing seeded zero/reverse/120°/170° fuzz, extended tail slides |
| I2 deterministic | PASS | All 18 archived command tracks, every state exactly equal at 30/60/144 render FPS; 120 Hz flight / 60 Hz world tick unchanged; runtime/replay exact checks |
| I3 replay/version | PASS | New physics version `p3-natural-aero-2`; old/mismatched versions rejected |
| I4 Phase 1 output neutrality | Deliberately retired | Physics change; archive untouched, archived commands still tested, deltas reported below |
| I5 airflow consistency | PASS | Signed alpha, sideslip independence of alpha, unsigned incidence, near-zero confidence and canonical telemetry |
| I6 restoring zeros / curve contracts | PASS | Aligned and reverse-flow zeros, restoring signs, continuous ordered full-domain knots, finite/nonnegative required values |
| I7 continuous factors | PASS | Separation increment bounded by authored exponential rate each substep; legacy limiter blend bounded by its existing `dt/blendSeconds` (Phase 4 model not introduced) |
| I8 natural-aero/input separation | PASS | Different commands, phases and powered state yield identical natural contributions; source/type dependency check |
| Existing I9 geometry / I11 actuators | PASS | Existing corrected geometry and travel/slew tests unchanged |
| Neutral/high-AoA ownership | PASS | HighAoa=1 → legacy neutral contribution zero; rate ledger exactly reconstructs integrated rates |
| Drag outside governor trim | PASS | Changing alpha/beta drag and brake does not increase thrust for the same speed/input |
| Gravity zero-crossing | PASS | Gravity can create reverse velocity; drag alone cannot reverse a level path |
| Normal flight | PASS | Existing sustained/combined/high-G/neutral/reverse-input regression checks, powered limits, energy-toggle checks |

Future I12–I22 systems are not claimed as implemented. Existing I9 uses the approved erratum bound, not the superseded universal zero-yaw claim.

**6. Benchmark results**

Full before/after and archived-input comparisons follow below. These are report-only. At 45°/70 m/s with **neutral input and no C**, initial F-22 pitch restoring is −0.427756 rad/s²; legacy neutral contribution is zero. Maximum per-step nose rotation is 0.04253° (F-22) / 0.03216° (Su-57), with a gradual angular response rather than a pose snap.

Do not attribute all incidence reduction to the new nose restoring: retained arcade path alignment still contributes. Ablating only restoring makes peak body angular response exactly 0°/s, with incidence at 0.5 s = 14.3805° / 14.3812°, versus 13.2671° / 13.5449° authored. Swapping **only restoring curves** gives peak rates 3.8400°/s for F-22 with Su-57 curves, and 5.1287°/s for Su-57 with F-22 curves (authored 5.1041 / 3.8589). The personality difference therefore follows profile data; there is no aircraft-name branch or Su-57-win condition.

Sideslip60 speed loss is 48.1621 / 52.2154 arcade km/h versus 2.3937 for both aircraft before Phase 2. This total includes separation/path/controller effects; first-step beta drag alone is 22.5 / 24 m/s² at beta=−60°. Alpha drag is zero on that initial pure-sideslip step.

Normal `hardTurn900` mean G drops 9.59% / 9.51%; speed loss drops 3.76% / 3.74%. Existing normal-handling tests pass, but this measurable difference still needs human feel review. No controller authority was increased to offset natural forces.

Tail-slide original 10 s benchmark still does not cross the horizon. Extended identical 90° seeds reach reverse flow at 5.9583 s; head crosses at 16.1083 / 19.05 s. Nearly vertical 89.9° variants cross at 16.10 / 19.0333 s. All remain finite and deterministic. B10 ≤4 s is **out of target**; even the apex occurs around 5.96 s with the specified initial 60 m/s upward velocity. No extra tail-slide torque was added to satisfy this target. The archive's no-flip result and post-apex timing are both retained.

`reversal180C` is materially changed: final velocity-heading change falls from 161.78° to 7.41° (F-22), and 153.24° to 103.99° (Su-57). The harness releases by cumulative nose rotation; with weak separated neutral damping, continued natural/body motion no longer holds the release attitude as before. This is disclosed, not retuned with hidden aero authority. C-driven Cobra and continuous rotation still run, but Cobra/Kulbit and heading-hold polish are not Phase 2 acceptance.

B7 is reported as **legacy** recovery-back-to-normal. There is no Phase 5 delay/assist system yet, so a literal B8 delayed-assist measurement is unavailable; release45 and the rate ledger verify immediate natural response without PSM/recovery assistance.

**7. Test results and superseded tests**

Before edits: `npm test` **25 suites / 339 passed**, `npm run flight:bench` **1 report suite / 1 passed**. I4 verified all Phase 0 output leaves before any code changed.

After implementation: `npm test` **26 suites / 343 passed / 0 failed**, including **19 Phase 2 cases**; `npm run flight:bench` **6 report suites / 15 passed**. `npm run typecheck` and production build pass. Determinism uses exact comparisons, not tolerance relaxation. Goldens were not regenerated. No browser/manual handling playtest was performed.

13 instantiated legacy feel tests moved intact into `legacy*.report.ts` (9 test definitions, some run for both aircraft). Their old expectation values remain executable and produce JSON reports; target misses do not fail builds. Hard finite-state, geometry, actuator, replay, C gating and normal-flight tests remain in `tests/`.

| Original test | Why superseded / replacement |
|---|---|
| `flightHandling`: backward flight without forcing the nose / chosen heading | Natural restoring now moves the nose; migrated fixture reports original expectations |
| `maneuvers`: Cobra OR reversal retaining heading | Neutral natural response replaces attitude-hold behavior; migrated fixture and C scenarios |
| `maneuvers`: neutral/opposite axes during PSM | Old `abs(pitchRate)<0.2` after 0.5 s encodes strong legacy damper; migrated, new contribution invariant replaces ownership assumption |
| `maneuvers`: yaw-led 180° reversal | Natural pitch/gravity/separation can alter a released turn plane; migrated fixture |
| `poweredPsm`: >3 s rotation and release recovery | Exact zero separation at fixed recovery time no longer follows exponential memory; migrated fixture |
| `stall`: height loss/control/W recovery, zero-speed fall, mixed axes, pedal recovery | Exact 0/1 severity deadlines and fixed maneuver outcomes no longer apply; original fixtures retained as reports |
| `stall`: threshold detection/hysteresis/lifecycle | Unit expectations now check continuous targets/exponential memory and lifecycle, not linear 0→1 deadlines |
| `airflow`: legacy 0.01 m/s and 90°-at-rest expectations | Explicit Phase 2 canonical migration; old/new formulas audited independently on archive poses |
| `envelope`: aero-band tuning must not affect physics | Observe-only contract ends in Phase 2: highAoa now drives neutral damping |
| `phase1Profile`: `psmDrag` required/used | Field intentionally retired; actual alpha/beta drag and trim boundaries tested in Phase 2 |
| `flightInstrumentation`: fixed-flow rate = legacy ceiling | Natural damping lowers equilibrium; test now balances exact controller/damping increments |
| `goldenTracks`: I4 state-output equivalence | Explicit physics-version change; replaced with preserved-input determinism plus reported deltas |

Legacy report misses include deliberately obsolete exact `severity == 0/1` checks; they are **not** current tuning goals. The test count changes by −13 migrated cases, −2 retired psmDrag cases, +19 new Phase 2 cases = 343.

**8. Baseline discrepancies and compatible decisions**

1. **Gravity could not cross zero on a vertical path.** Existing speed guard discarded the longitudinal gravitational overshoot and the cross-gravity correction then cancelled gravity at the apex. A small integration correction now retains only gravity's overshoot after clamping non-gravitational speed. This is necessary for the requested tail-slide/reverse-flow seed. Engine lateral path-rate capping and energy-model redesign remain Phase 3. Reviewer should inspect this correction particularly carefully.
2. **Separate physical/floor budgets did not exist after Phase 1.** Kept the visible legacy floor unexpanded; no speculative allocator or fake natural authority added.
3. **Separation configuration already existed under `stall`.** Reused bands/time constants there rather than duplicating an `aero.separation` configuration. `aero.alphaNormalDeg/alphaCriticalDeg` remain independent as M4 requires. Stall's angle fields now refer to unsigned incidence for separation; signed alpha remains in telemetry.
4. **Canonical incidence migration:** across all archived non-tail poses, differences are at most floating-point geometry noise; archive maximum PSM angle delta is 0.000000854°. Tail-slide near-rest telemetry intentionally changes by up to 90°. At rest: legacy telemetry 90° → canonical 0°. In reverse flow at 0.001–0.01 m/s: legacy PSM 0° → canonical 180°; confidence is zero, so this does not create aerodynamic restoring/damping. No forces were tuned to mimic these obsolete readings.
5. **The dive-limit test was not creating its intended dive attitude.** `Object.assign` from Three's Quaternion copies `_x/_y/_z/_w`, leaving the plain state's `x/y/z/w` untouched. Explicit component copying fixes the fixture, preserving its original gravity-overspeed assertion. The new drag exposed this preexisting fixture bug; the overspeed invariant was not weakened.
6. **B10 timing:** the 60 m/s vertical seed reaches its apex after the nominal ≤4 s flip target. Both absolute and post-apex times are reported; the target was not changed or enforced as an invariant.
7. Rev. 3 errata E1–E3 TVC pitch/yaw capacity decisions remain unresolved and untouched; no Phase 3 authority contract was selected. Existing phase-based path/recovery logic remains per the Phase 4 schedule.

**9. Review notes and instrumentation**

- Inspect natural yaw sign/projection, separation's reused parameter semantics, zero-target response fade, and the gravity overshoot correction.
- Inspect the normal-turn G delta and large neutral reversal/heading delta; these are the most material handling changes. The 20–30° fade band and coefficient tuning still need human playtest. Do not tune away these deltas by granting hidden maneuver authority.
- Review `FlightForces` as a **diagnostic decomposition**, not an `AllocationRecord`: `ratesAfter = ratesBefore + dt × (controller + tvc + naturalRestoring + naturalDamping)`. `tvc` is the existing actual-minus-reserved legacy correction, not a new budget. `legacyNeutralDamping` is already included in `controller`.
- `flightInstrumentation(state).airflow` samples the end pose; `.lastStep.airflowStart` and all contributions record the exact previous integration input. These are intentionally different timestamps. Diagnostics never feed physics.
- `benchmarks/flight/out/traces/<scenario>.<aircraft>.jsonl` records every 120 Hz sample: airspeed, alpha, beta, incidence, q, separation, rates, restoring, damping, alpha/beta drag, controller and neutral damping. `phase2.json` also includes curve ablations, canonical-incidence audit, and extended tail-slide samples.
- No engine spool, Aero/TVC allocation, participation blending, powered capability, breakout, input remapping, recovery-assist system, roster expansion, FX or audio work is included. C and High-G remain usable. Stop at Phase 2 for review.

**Applied-force excerpt — F-22 neutral release45**

All angular contributions are pitch rad/s²; rate is pitch rad/s. Alpha/beta/incidence are start-of-step degrees; drag is m/s².

| End time | Speed | α / β / incidence | q | Separation | Rate | Restoring | Natural damping | Legacy neutral | α drag / β drag |
|---|---:|---|---:|---:|---:|---:|---:|---:|---|
| 0.0083 | 70.000 | 45.000 / 0.000 / 45.000 | 0.60494 | 0.02062 | -0.00356 | -0.42776 | 0.00000 | 0.00000 | 6.12500 / 0.00000 |
| 0.5000 | 66.953 | 13.581 / 0.000 / 13.581 | 0.55343 | 0.38890 | -0.05514 | -0.15595 | 0.00980 | 0.30345 | 0.61794 / 0.00000 |
| 1.0000 | 63.806 | 3.244 / 0.000 / 3.244 | 0.50262 | 0.25789 | -0.01056 | -0.03414 | 0.00132 | 0.07066 | 0.03260 / 0.00000 |
| 1.5000 | 60.481 | 1.003 / 0.000 / 1.003 | 0.45159 | 0.28134 | -0.00220 | -0.00949 | 0.00026 | 0.01413 | 0.00280 / 0.00000 |

At high incidence the legacy neutral term is zero; once attached/low-incidence handling returns, it resumes damping as intended. Full P/Y/R data are in the JSONL traces.

**Complete benchmark comparison**

| Aircraft / scenario / metric | Phase 1 | Phase 2 | Delta | Archived-input Phase 2 |
|---|---:|---:|---:|---:|
| f22 / hardTurn900 / B13.hardTurn900.peakAoa (deg) | 4.0658 | 3.6559 | -0.4100 | 3.6559 |
| f22 / hardTurn900 / B13.hardTurn900.meanG (G) | 11.7722 | 10.6431 | -1.1290 | 10.6431 |
| f22 / hardTurn900 / B13.hardTurn900.speedLoss (arcade km/h) | 132.6610 | 127.6770 | -4.9840 | 127.6770 |
| f22 / fullStick500 / baseline.fullStick500.peakAoa (deg) | 4.2481 | 4.1073 | -0.1408 | 4.1073 |
| f22 / cobraC / B1.cobra.peakAoa (deg) | 98.1512 | 95.5278 | -2.6234 | 89.0915 |
| f22 / cobraC / B2.cobra.timeTo90 (s) | 1.1250 | 1.1833 | 0.0583 | — |
| f22 / cobraC / B3.cobra.speedLoss (arcade km/h) | 56.4412 | 75.4887 | 19.0475 | 55.1310 |
| f22 / cobraC / B4.cobra.headingChange (deg) | 29.8948 | 30.6550 | 0.7602 | 28.8671 |
| f22 / cobraC / legacy.recovery.backToNormal (s after C release) | 0.6083 | 0.6083 | 0.0000 | 0.6083 |
| f22 / kulbitC / B5.kulbit.time360 (s) | 2.8417 | 3.1500 | 0.3083 | 3.1500 |
| f22 / reversal180C / B15.reversal.headingChange (deg at 10 s / stop) | 161.7837 | 7.4066 | -154.3771 | 38.0210 |
| f22 / reversal180C / B15.reversal.altitudeLoss (m) | 115.9295 | 0.6171 | -115.3124 | 1.6678 |
| f22 / tailSlide / baseline.tailSlide.flipTime (s) | — | — | — | — |
| f22 / pedalC / baseline.pedal.yawRate (deg/s at 2 s) | 91.6526 | 79.4490 | -12.2036 | 79.4490 |
| f22 / release45 / B9.natural.release45.incidence0s (deg) | 45.0000 | 45.0000 | 0.0000 | 45.0000 |
| f22 / release45 / B9.natural.release45.incidence0.2s (deg) | 30.3840 | 29.3083 | -1.0758 | 29.3083 |
| f22 / release45 / B9.natural.release45.incidence0.5s (deg) | 21.9288 | 13.2671 | -8.6617 | 13.2671 |
| f22 / release45 / B9.natural.release45.incidence1s (deg) | 13.3864 | 3.1690 | -10.2175 | 3.1690 |
| f22 / release45 / B9.natural.release45.incidence1.5s (deg) | 9.1318 | 0.9923 | -8.1395 | 0.9923 |
| f22 / release45 / B9.natural.release45.maxAttitudeStep (deg/substep) | — | 0.0425 | — | 0.0425 |
| f22 / release45 / B9.natural.release45.maxRate (deg/s) | 0.0000 | 5.1041 | 5.1041 | 5.1041 |
| f22 / sideslip60 / baseline.sideslip60.speedLoss1s (arcade km/h) | 2.3937 | 48.1621 | 45.7685 | 48.1621 |
| su57 / hardTurn900 / B13.hardTurn900.peakAoa (deg) | 4.0543 | 3.6482 | -0.4061 | 3.6482 |
| su57 / hardTurn900 / B13.hardTurn900.meanG (G) | 11.7765 | 10.6568 | -1.1197 | 10.6568 |
| su57 / hardTurn900 / B13.hardTurn900.speedLoss (arcade km/h) | 134.2842 | 129.2578 | -5.0264 | 129.2578 |
| su57 / fullStick500 / baseline.fullStick500.peakAoa (deg) | 4.2173 | 4.0784 | -0.1390 | 4.0784 |
| su57 / cobraC / B1.cobra.peakAoa (deg) | 97.6148 | 95.8936 | -1.7212 | 90.9854 |
| su57 / cobraC / B2.cobra.timeTo90 (s) | 1.1250 | 1.1667 | 0.0417 | 1.1917 |
| su57 / cobraC / B3.cobra.speedLoss (arcade km/h) | 62.0897 | 93.7295 | 31.6398 | 78.3557 |
| su57 / cobraC / B4.cobra.headingChange (deg) | 29.1040 | 30.1084 | 1.0044 | 28.7550 |
| su57 / cobraC / legacy.recovery.backToNormal (s after C release) | 0.6083 | 0.6083 | 0.0000 | 0.6083 |
| su57 / kulbitC / B5.kulbit.time360 (s) | 2.8417 | 3.0167 | 0.1750 | 3.0167 |
| su57 / reversal180C / B15.reversal.headingChange (deg at 10 s / stop) | 153.2374 | 103.9902 | -49.2472 | 116.5416 |
| su57 / reversal180C / B15.reversal.altitudeLoss (m) | 200.6657 | 0.0000 | -200.6657 | 0.0000 |
| su57 / tailSlide / baseline.tailSlide.flipTime (s) | — | — | — | — |
| su57 / pedalC / baseline.pedal.yawRate (deg/s at 2 s) | 105.9679 | 98.9968 | -6.9710 | 98.9968 |
| su57 / release45 / B9.natural.release45.incidence0s (deg) | 45.0000 | 45.0000 | 0.0000 | 45.0000 |
| su57 / release45 / B9.natural.release45.incidence0.2s (deg) | 30.3840 | 29.4599 | -0.9242 | 29.4599 |
| su57 / release45 / B9.natural.release45.incidence0.5s (deg) | 21.9288 | 13.5449 | -8.3839 | 13.5449 |
| su57 / release45 / B9.natural.release45.incidence1s (deg) | 13.3864 | 3.2634 | -10.1230 | 3.2634 |
| su57 / release45 / B9.natural.release45.incidence1.5s (deg) | 9.1318 | 1.0351 | -8.0967 | 1.0351 |
| su57 / release45 / B9.natural.release45.maxAttitudeStep (deg/substep) | — | 0.0322 | — | 0.0322 |
| su57 / release45 / B9.natural.release45.maxRate (deg/s) | 0.0000 | 3.8589 | 3.8589 | 3.8589 |
| su57 / sideslip60 / baseline.sideslip60.speedLoss1s (arcade km/h) | 2.3937 | 52.2154 | 49.8218 | 52.2154 |

## Tail slide extended to 30 s

| Aircraft | Entry pitch | Reverse at | Head below horizon | After apex | Peak °/s |
|---|---:|---:|---:|---:|---:|
| f22 | 90 | 5.9583 | 16.1083 | 10.1500 | 22.5771 |
| f22 | 89.9 | 5.9583 | 16.1000 | 10.1417 | 22.5693 |
| su57 | 90 | 5.9583 | 19.0500 | 13.0917 | 16.9909 |
| su57 | 89.9 | 5.9583 | 19.0333 | 13.0750 | 16.9889 |

Release ablations and tail-slide samples: phase2.json. Every substep ledger: traces/*.jsonl.
Ledger controller includes legacyNeutralDamping; add controller + tvc + naturalRestoring + naturalDamping once to reconstruct rate change.
No Phase 5 recovery-delay system exists yet: release45 demonstrates natural response without C/assist; B8 delayed-assist timing is deferred.
