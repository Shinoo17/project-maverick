# Phase 3 Independent Review — Engine + Aero/TVC Authority Allocation

Reviewer: independent agent review, 20 September 2026
Subject: working tree on `feat/psm-phase-0-instrumentation`, physics version `p3-engine-allocation-3`
Authority: [psm-implementation-plan.md](psm-implementation-plan.md) Final Baseline Rev. 3
Report under review: [psm-phase3-implementation.md](psm-phase3-implementation.md) (treated as claims, not evidence)

All conclusions below are from source inspection, the test suite, a reproduced benchmark run, and
independent probe runs written for this review. Probe scripts were run from a temporary file and
deleted; no repository file was modified by this review other than this document.

## Executive Summary

Phase 3 achieved its architectural objective. Aircraft rotational authority now demonstrably flows
through `Pilot Request → Authority Budget → (Aero + TVC + Arcade Floor + Unmet) → Actual Response`,
and the old `PSM mode → generic rate boost` path is gone rather than renamed.

The decisive evidence is empirical, not structural. A 30-second full-pull run with C, burner, W and
airbrake from the 450 arcade km/h seed produces:

| Aircraft | Time to 360° nose rotation | Peak incidence | Pitch drive at t = 3 s (aero / TVC / floor / unmet, rad/s²) |
|---|---:|---:|---|
| f22 | 4.91 s | 179.5° | 0.001 / **6.616** / 0 / 7.34 |
| su57 | 5.40 s | 180.0° | 0.001 / **5.802** / 0 / 8.15 |
| f22-notvc | 27.4 s | **33.3°** | 3.964 / **0** / 0 / 9.99 |

Deleting the physical TVC capability (`thrustVectoring: null`) removes powered post-stall capability
entirely. `f22-notvc` never leaves the attached-flow regime: it holds 118 m/s, peaks at 33° incidence,
and its eventual 360° at 27.4 s is an ordinary high-speed aerodynamic loop driven by `physicalAero`
at q ≈ 1.7, not a Kulbit. That is the intended answer to the central review question.

Two supporting results confirm the plumbing rather than just the outcome. First, the rate integration
reconstructs exactly: over 360 substeps of a forced post-stall pull I recomputed
`aero + floor + servoDamping + poweredThrustForces(actualNozzleAngles, actualThrust) + restoring + damping`
independently and compared it with the integrated `Δrate/dt`; worst residual was **1.33e-14 rad/s²**.
Nothing outside the allocation record and the actual actuator torque touches body rates. Second, the
debug limiter provably adds no authority: at 25 m/s with pitch held, C on versus C off produces
identical rotation (11.294° over 4 s), identical `aero`, `tvc` and `floor` shares, and differs only in
`unmet`, which rises from 1.04 to 13.71 rad/s². C enlarges the request; the budget refuses it.

The findings below are real but none of them invalidates the architecture. The most substantive are a
floor tuning constant leaking into the request path, an undisclosed benchmark regression in Cobra and
reversal path-heading metrics, and a small set of self-certifying energy assertions.

## Verdict

```text
PASS WITH FIXES
```

The fixes required before Phase 4 are small and listed at the end. None of them requires a
re-architecture, and none requires Phase 4 features.

## Findings

### CRITICAL

None.

### MAJOR

None.

I actively searched for the failure modes the brief names — generic PSM authority still driving the
maneuver, TVC authority at zero thrust, an allocation record that is telemetry only, double-counted
TVC, governor-granted free thrust, floor supplying post-stall authority, and a `f22-notvc` that can
still perform a powered Kulbit. Each is refuted by direct evidence recorded in the Architecture
Verification section. Two items that a stricter reading of the review brief would score as MAJOR —
C still selecting legacy translation grip, and the literal I19 wording — are explicitly scheduled or
explicitly qualified by the Final Baseline, and are classified as LATER PHASE accordingly, with the
conflict stated openly in that section.

---

**F1 — Arcade floor `maxRate` is reused as a lower bound on the *request*, so a floor tuning constant
sizes demand that TVC and aero then satisfy**

- Severity: MINOR
- Files: [controller.ts:23-26](../src/game/flight/controller.ts#L23-L26)
- Evidence: the controller raises the rate target whenever it falls below the floor ceiling:
  `if (Math.abs(target[axis]) < Math.abs(input) * profile.arcadeControlFloor.maxRate[axis]) target[axis] = input * profile.arcadeControlFloor.maxRate[axis]`.
  The resulting `target` becomes `request` at [controller.ts:43](../src/game/flight/controller.ts#L43) and is
  allocated to aero and TVC first, with the floor only filling the gap. The clause therefore raises how
  much *real* authority the allocator will spend, not just how much floor is available.
  I A/B-tested it by zeroing `arcadeControlFloor.maxRate.pitch` at 25 m/s held: the request was
  identical in both runs (1.2923 rad/s² total), so the clause was inactive there. It becomes active only
  when `target < maxRate`, i.e. `speedAuthority < 0.21` on pitch, which is airspeed below roughly 19 m/s.
  Below that speed the clause roughly doubles the achievable low-q pitch rate ceiling, and TVC supplies
  the power to reach it.
- Why it matters: Rev. 3 §0 separates `Arcade Control Floor` from `Physical Aero` and `TVC`. Using the
  floor's `maxRate` to size the demand that TVC fills couples two layers that the baseline requires to
  stay independent. It is bounded and small today; it becomes a hidden tuning coupling the moment the
  floor is retuned or Phase 4 opens the limiter automatically at low speed.
- Required fix: none before Phase 4. Either introduce an explicit `flight.minRateTarget` (or equivalent)
  per axis so the low-q request floor has its own name and tuning, or document at the call site that
  this deliberately reuses the floor ceiling as a demand floor and add a test pinning the ~19 m/s
  activation boundary. Note that the roll axis skips the incidence gate at
  [controller.ts:27](../src/game/flight/controller.ts#L27), so on roll the clause is not additionally
  limited by incidence.

**F2 — `thrustVectoring.gain` is validated as non-negative, so `gain: 0` silently disables all TVC**

- Severity: MINOR
- Files: [validateProfile.ts:148-151](../src/game/flight/validateProfile.ts#L148-L151)
- Evidence: `gain` is checked by the shared `nonnegative(...)` loop. `maxAngle` was given its own
  `positive(...)` check on the line above; `gain` was not. With `gain: 0`, `poweredThrustForces` returns
  zero angular acceleration and `tvcMomentCapacity` returns zero commanded capacity, so a TVC aircraft
  becomes silently equivalent to `f22-notvc` while every other validation passes.
- Why it matters: this is exactly the "defaults hide missing data" case §19 asks about, inverted — a
  present-but-zero value produces a valid-looking profile with no capability.
- Required fix: `positive(thrustVectoring.gain, ...)`.

**F3 — I18/I19 energy and path assertions are bounded by the ledger produced by the same function**

- Severity: MINOR
- Files: [tests/engineForces.test.ts:27](../tests/engineForces.test.ts#L27),
  [tests/invariants/phase3.test.ts:45](../tests/invariants/phase3.test.ts#L45),
  [tests/poweredPsm.test.ts:104-115](../tests/poweredPsm.test.ts#L104-L115)
- Evidence: all three compare the measured energy change against `translation.thrustWork - translation.dragWork`,
  which `integrateTranslation` itself computes at
  [engineForces.ts:37-39](../src/game/flight/engineForces.ts#L37-L39). The `poweredPsm` energy test was
  changed from an absolute bound (`initial + 0.1`) to this accumulating ledger bound.
- Why it matters: a systematically over-generous `thrustWork` — for example a displacement term that
  overestimates the integrated interval — would satisfy every one of these assertions while permitting
  real energy creation. The invariant currently proves internal consistency, not conservation.
- Required fix: none before Phase 4. Add one test that computes work independently of the module, for
  example `axialThrust × (position change projected on path)` measured from the integrated state, and
  compare with the reported `thrustWork` within tolerance for a handful of seeds.

**F4 — The debug overlay omits two of the six terms the report says it shows**

- Severity: MINOR
- Files: [PlaygroundHud.tsx:45-70](../src/features/flight/PlaygroundHud.tsx#L45-L70), report §3
- Evidence: report §3 gives the rate equation as
  `aero + floor + actualTvc + stabilityDamping + naturalRestoring + naturalDamping` and states "The
  overlay shows all of these sources". The overlay renders `allocation.aero`, `allocation.tvc`,
  `allocation.floor`, `allocation.unmet`, `stabilityDamping`, actual torque, actuator lag and coupled
  torque, but there is no row for `naturalRestoring` or `naturalDamping`; `grep` for either field or a
  matching locale key in `PlaygroundHud.tsx` and `en.ts` returns nothing.
- Why it matters: everything the overlay *does* show is read from `state.flightForces`, the genuine
  integrated tick, with no parallel recomputation — that part is correct and I verified it. But a tuner
  reading the overlay during post-stall cannot reconcile the displayed allocation with the observed rate,
  because the two largest opposing terms at high incidence are absent. In my forced post-stall sample
  `naturalRestoring.pitch` was −0.47 rad/s² against an allocated TVC of 6.43 — not negligible.
- Required fix: add the two rows with locale keys in both `en.ts` and `th.ts`, or correct the report's
  claim to name what is actually displayed.

**F5 — `interpretEnvelope`'s `limiterOpen` is a hard 0/1 step with no continuity coverage**

- Severity: MINOR
- Files: [stepFlight.ts:33](../src/game/flight/stepFlight.ts#L33),
  [tests/aerodynamics.test.ts:57-68](../tests/aerodynamics.test.ts#L57-L68),
  [tests/airflow.test.ts:122-126](../tests/airflow.test.ts#L122-L126)
- Evidence: `state.limiterOpen = command.psmArm && psmEnabled ? 1 : 0` steps discontinuously. Rev. 3
  I7 requires `separation` and `limiterOpen` not to jump more than ε per substep, enforced from Phase 2.
  The I7 test now checks `stall.severity` and `maneuver.blend` only; its comment explicitly excludes the
  debug limiter, and the `airflow.test.ts` expectation was changed from `limiterOpen: 0.6` (aliased to
  `maneuver.blend`) to `limiterOpen: 0`. No test anywhere constrains `limiterOpen` continuity.
- Why it matters: the report's invariant table marks I5–I8 PASS with a prose qualification, which is
  honest, but the coverage gap is now permanent rather than temporary. Phase 4 introduces smoothed
  automatic opening with `1 − exp(−k·dt)`; the invariant that will police it does not exist yet.
- Required fix: none before Phase 4. When Phase 4 lands the smoothed limiter, restore an I7 clause over
  `limiterOpen` with ε derived from the profile open/close rates.

**F6 — Weakened assertions in `poweredPsm.test.ts` no longer pin thrust-dependence meaningfully**

- Severity: MINOR
- Files: [tests/poweredPsm.test.ts:54-68](../tests/poweredPsm.test.ts#L54-L68)
- Evidence: `expect(powered.maneuver.controlAuthority).toBeGreaterThan(0.9)` became
  `expect(powered.flightForces!.budget.poweredControlAvailable).toBeGreaterThan(0)`. The surviving
  comparison `expect(powered.rates.pitch).toBeGreaterThan(idle.rates.pitch * 3)` is also weak, because
  `idle.rates.pitch` at zero thrust and full separation comes only from the arcade floor and is near zero,
  which makes `× 3` a low bar.
- Why it matters: this test is the named guard for "thrust buys post-stall control, zero thrust buys
  none". The zero-thrust half is still strong (`poweredControlAvailable === 0` exactly). The powered
  half no longer asserts a magnitude.
- Required fix: none before Phase 4. Replace `> 0` with a bound derived from the profile, for example
  `budget.tvc.positive.pitch` at the spooled thrust compared with `tvcMomentCapacity(profile, thrust)`,
  or assert an absolute rate rather than a ratio against a near-zero denominator.

**F7 — The implementation report's regression section omits two benchmark metrics that moved
substantially in the wrong direction**

- Severity: MINOR (reporting); see T1 for the underlying behaviour
- Files: report §10, `benchmarks/flight/out/report.json`, `benchmarks/flight/phase2-metrics.json`
- Evidence: I reran `npm run flight:bench` and diffed against the committed Phase 2 baseline. Every
  number in report §4, §6, §9 and §10 reproduced exactly. But §10's "selected deltas" table omits:

  | Metric | Phase 2 | Phase 3 | Target |
  |---|---:|---:|---|
  | f22 `B4.cobra.headingChange` | 30.65° | **47.07°** | ≤ 20° |
  | su57 `B4.cobra.headingChange` | 30.11° | **48.63°** | ≤ 20° |
  | f22 `B15.reversal.headingChange` | 18.54° | **75.75°** | report |
  | su57 `B15.reversal.headingChange` | 19.75° | **63.38°** | report |
  | f22 `B15.reversal.altitudeLoss` | 229.02 m | **0.00 m** | report |
  | su57 `B15.reversal.altitudeLoss` | 247.08 m | **0.00 m** | report |

  The report does disclose the Cobra peak-AoA and Kulbit-time misses, so the omission looks like
  selection rather than concealment, but B4 is a targeted benchmark that moved 54% further outside its
  target, and a reversal altitude loss of exactly 0.000 m is the kind of number a reviewer must be shown.
- Why it matters: §10 presents itself as the regression record. A reader who trusts it will not know
  that the path-versus-nose quality of the Cobra got worse.
- Required fix: extend report §10 with these rows and the attribution in T1.

### TUNING

**T1 — Cobra and reversal now bend the flight path far more than before**

- Files: benchmark output above; mechanism at
  [stepFlight.ts:102-105](../src/game/flight/stepFlight.ts#L102-L105) and
  [engineForces.ts:41](../src/game/flight/engineForces.ts#L41)
- Evidence and attribution: this is a consequence of slower nose rotation, not of a new free-turn path.
  The path-rotation math is behaviourally equivalent to Phase 2 above the speed floor — old code added
  the transverse force then re-normalised to `poweredSpeed`, giving `atan(F_t·dt / speed)`; new code
  rotates by `atan(F_t·dt / max(speed, floorMps))`, identical for `speed > 40`. What changed is dwell:
  `B1.cobra.peakAoa` fell from 95.5° to 73.5°, `B2.cobra.timeTo90` is now never reached, so the C stage-0
  pull runs to its 2.5 s timeout instead of ending at 1.18 s, and the aircraft spends roughly twice as
  long with thrust and lateral grip acting off-path. `B15.reversal.altitudeLoss = 0` is the same effect
  measured differently: the 180° rotation now completes later inside the fixed 10 s window, so the
  post-release descent falls outside the sampled track.
- Recommendation: do not treat this as a reason to restore generic PSM rates. **Corrected in follow-up —
  see FU-T1.** My original suggestion that raising `thrustVectoring.gain` would shorten the dwell and
  recover B4 is wrong; the follow-up sweep measures B4 rising with gain. The dwell mechanism holds, but
  gain is not the lever. Levers are TVC participation (Phase 4) and the maneuver path-grip port (Phase 4).

**T2 — `pathRateFloorMps = 40` still permits ~1.8 rad/s of powered path rotation at 5 m/s**

- Files: [engineForces.ts:6-13](../src/game/flight/engineForces.ts#L6-L13),
  [f22.ts:27](../src/content/flight-profiles/f22.ts#L27)
- Evidence: my probe at 5 m/s, 90° incidence, burner, full pitch, C on, measured
  `controlPathRate = 1.7921 rad/s` against `controlPathCap = 1.7922` with `pathCapActive = true` and
  `uncappedControlPathRate = 14.3377 rad/s`. The report's 1.644 / 13.154 figures are the same
  phenomenon at its slightly different seed. The cap works: it removes an 8× instant-turn exploit.
- Recommendation: 1.79 rad/s is still 103°/s of path rotation, a 2.8 m turn radius at 5 m/s. That is the
  authored arcade value, and §5.1 forbids putting a feel number in an invariant, so this is correctly a
  profile constant rather than a test threshold. Flagging it so the owner reviews `pathRateFloorMps`
  during the Phase 2/3 playtest rather than discovering it in Phase 4.

**T3 — Gain 2 leaves both headline maneuvers outside target; the sweep is sound**

- Evidence: reproduced exactly. Gain 2 gives Cobra peaks 73.53°/72.54° (target 75–95°) and Kulbit 360°
  in 5.01 s/5.37 s (target 3–4.5 s). Gain 2.5 gives 85.0°/82.5° and 4.03/4.35 s; gain 3 gives 91.3°/91.2°
  and 3.44/3.73 s. The 0.2 s pitch rate barely moves across the sweep (0.5502 → 0.5644 for f22), which
  confirms the report's claim that aero, spool and actuator onset dominate the initial response and that
  gain is not a disguised initial-acceleration match.
- Recommendation: the gain is a scalar applied uniformly in `poweredThrustForces`
  ([thrustVectoring.ts:88-92](../src/game/flight/thrustVectoring.ts#L88-L92)), so geometry ratios are
  preserved and F-22 yaw stays exactly zero at every gain. I saw no nozzle saturation pathology, no
  oscillation and no overshoot in the traces at gain 2 or 3, and `maxPitchRate` stayed at 1.667 rad/s for
  f22 across a 30 s continuous pull. Gain 2.5 or 3 is defensible on the evidence; this is an owner
  playtest decision, not a review finding.

### LATER PHASE

**L1 — C still selects legacy translation grip and gravity weights**

- Files: [stepFlight.ts:77](../src/game/flight/stepFlight.ts#L77),
  [stepFlight.ts:91](../src/game/flight/stepFlight.ts#L91),
  [stepFlight.ts:102-105](../src/game/flight/stepFlight.ts#L102-L105),
  [stepFlight.ts:112](../src/game/flight/stepFlight.ts#L112)
- The review brief's §11 states C must not "enable special drag/grip physics". Taken literally, that
  criterion fails today: `m.phase === 'active'` (reachable only through C) still selects
  `maneuverProfile.activeGrip` over `recoveryGrip`, selects `lateralAcceleration` over
  `recoveryAcceleration`, changes the 180°-reversal lateral fallback branch, and feeds
  `gravityBlend = max(stall.severity, 0.5·(1 − grip))`.
- The Final Baseline wins this conflict, and it explicitly schedules exactly these symbols —
  `activeGrip/recoveryGrip/recoveryAcceleration` and `gravityBlend` — for the Phase 4 port (plan §4,
  Phase 4 bullet 2, and D1). Report §11 discloses the same gap and states no claim of phase-free
  translation. Classifying as LATER PHASE is therefore correct, and I am recording the literal criterion
  failure so the conflict is visible rather than silently resolved.
- Constraint for Phase 4: these branches must be ported *before* automatic breakout is enabled,
  otherwise the same incidence reached without C receives different path treatment than with C. The
  report says the same thing; I agree and would treat it as a hard ordering constraint.

**L2 — I19's literal wording versus the implemented transverse-only cap**

- The implemented guarantee is: engine and lateral *transverse* path rotation is bounded by
  `|F_t| / max(speed, pathRateFloorMps)`. A signed *longitudinal* passage through zero is permitted and
  logged as `longitudinalZeroCrossing`. Drag alone can never reverse the path
  ([engineForces.ts:32-36](../src/game/flight/engineForces.ts#L32-L36); pinned by
  [tests/engineForces.test.ts:34-45](../tests/engineForces.test.ts#L34-L45)).
- The report argues, correctly in my reading, that a blanket "no engine reversal of any kind" would
  forbid legitimate force-driven crossings and reintroduces the trap where opposing thrust erases each
  gravity step and pins a release near 0.08 m/s. The stronger reading needs an owner decision, not a
  silent invariant claim.
- Phase 4+ should record the chosen reading in the plan so I19's text and its test agree.

**L3 — Known inherited gaps**

`B10.tailSlide.flipTime` remains unreached for both aircraft (unchanged from Phase 2, so not a Phase 3
regression). B9's 20–30° band and the Phase 2 owner playtest remain pending. `PilotIntent` is recorded
but unused; the breakout formula, automatic permission, input remapping, recovery assist and TVC
participation are correctly absent.

## Architecture Verification

| Check | Result | Evidence |
|---|---|---|
| Engine request → spool → actual thrust | **PASS** | `stepEngine` applies `1 − exp(−response·dt)` between `requestedPower` and `enginePower`, then `actualThrust = enginePower × dryThrust` ([engine.ts:20-27](../src/game/flight/engine.ts#L20-L27)); spool-up 4/s, spool-down 6/s; exact exponential pinned by [tests/engine.test.ts:13-24](../tests/engine.test.ts#L13-L24). I verified the renderer path rather than taking the report's word: `flightRig.ts:49`, `su57Rig.ts:26-28`, `exhaust/profile.ts:25` and `FlightInstruments.tsx:45` all read `state.enginePower`, and no renderer computes thrust of its own. Note the consequence — those consumers now see *spooled* power where they previously saw instantaneous power, so exhaust and nozzle-glow FX inherit the 4/s and 6/s lag. That is correct behaviour, but it is an unremarked FX timing change. |
| Actual thrust ≠ forward acceleration | **PASS** | Probe at 70 m/s, 80° incidence, brake + burner over 0.5 s: f22 thrust 60.60 m/s² while speed fell 70 → 65.33; su57 59.64 with 70 → 63.91; f22-notvc 60.54 with 70 → 63.18. High thrust, high TVC capacity and falling airspeed coexist. |
| Governor compensates base drag only | **PASS** | `trim = p.drag × speed²` is the only drag term in `requestedPower` ([speed.ts:36-41](../src/game/flight/speed.ts#L36-L41)). Probe at 100 m/s with no W/Shift: `requestedPower = 0.070000` at both 0° and 80° incidence, identical actual thrust; airbrake does not change it. I17 additionally forces `alphaDrag`/`betaDrag` to 10 and asserts `dirty.engine` equals `plain.engine` ([tests/engine.test.ts:25-39](../tests/engine.test.ts#L25-L39)). No AoA-drag → power → TVC feedback path exists. |
| TVC capacity from geometry × max deflection × actual thrust × gain | **PASS** | `tvcMomentCapacity` uses analytic extrema over full nozzle travel and `e = thrust/2`, reads no command, no phase and no current nozzle angle ([thrustVectoring.ts:111-138](../src/game/flight/thrustVectoring.ts#L111-L138)). Linearity in thrust pinned to 12 digits; capacity is exactly zero at zero thrust, verified both as a unit call and through an integrated 120-step run with velocity and engine forced to zero. No circular capacity-from-angle bug. |
| Available capacity vs applied moment kept distinct | **PASS** | Capacity comes from full travel; the applied moment comes from `poweredThrustForces(state.thrustVectoring, thrust, tvc)` at the *actual* angles ([stepFlight.ts:56-57](../src/game/flight/stepFlight.ts#L56-L57)). `actuatorLag` records the difference explicitly. |
| F-22 commanded yaw TVC ≈ 0, with no other layer restoring it | **PASS** | `commanded.yaw` is forced to 0 for `cantDeg === 0` and the solver weights yaw at 0 for that case ([thrustVectoring.ts:136](../src/game/flight/thrustVectoring.ts#L136), [thrustVectoring.ts:148](../src/game/flight/thrustVectoring.ts#L148)). Probe at 20 m/s, 75° incidence, full pedal, C + burner: f22 peak yaw 13.555°/s with `allocation.tvc.yaw = 0` and `actualTvc.yaw = 0.00000`, **exactly equal** to f22-notvc's 13.555°/s; su57 reaches 31.892°/s with `tvc.yaw = 1.78`. Coupled asymmetric-axial yaw is retained as bounded physics at 0.063866 rad/s² full travel at thrust 65, which is 0.927% of nose-up pitch, and `actualMomentBounds` bounds it every tick. |
| Su-57 mixed-axis TVC per canted geometry | **PASS** | Reproduced capacities at thrust 65: pitch 6.156/6.369, yaw 3.616, roll 3.434 rad/s². F-22/Su-57 peak-yaw ratio 0.2520 against B11's ≤ 0.5. |
| `AuthorityBudget` separation (physicalAero / tvc / arcadeFloor) | **PASS** | `computeBudget` takes `(flow, separation, actualThrust, profile)` only; it cannot see `PilotCommand`, intent, phase or governor request, and a source-level import check forbids `commands`/`intent`/`WorldState` imports ([authority.ts:13-23](../src/game/flight/authority.ts#L13-L23), [tests/invariants/phase3.test.ts:93-105](../tests/invariants/phase3.test.ts#L93-L105)). `physicalAero` has no minimum floor. `arcadeFloor` is copied verbatim from the profile with no thrust, burner or intent term. Sign selection happens after demand in `signedBudget`, outside the capability layer. |
| Arcade floor is gap-fill, not a bonus | **PASS** | `available = max(0, floor.acceleration − physicalAero − tvc)` ([allocation.ts:25](../src/game/flight/allocation.ts#L25)); an aircraft with sufficient real authority gets exactly zero floor. Note that floor *availability* legitimately varies with thrust through the `tvc` subtraction — that is the baseline's own formula; what is thrust-independent is the floor *tuning*, which it is. |
| Floor `maxRate` ceiling | **PASS** | `headroom = max(0, (maxRate − sign·rate)/dt − aero − tvc)` subtracts reserved real authority before spending floor ([allocation.ts:27](../src/game/flight/allocation.ts#L27)). A 1200-step property test drives full demand from `rate = ±0.1999` and asserts the rate never exceeds 0.2 ([tests/allocation.test.ts:24-38](../tests/allocation.test.ts#L24-L38)). Prolonged low-speed full input confirms it: a zero-q no-TVC rig held for 600 steps with C + burner keeps every axis within `maxRate`, and my 4 s held-25 m/s probe peaked at 0.0505 rad/s against a 0.2 ceiling. No slow-Kulbit accumulation. |
| Allocation accounting (`request ≈ aero + tvc + floor + unmet`) | **PASS** | Enforced per axis per tick to 10 decimal places across every scenario, every aircraft and seeded fuzz ([tests/invariants/phase3.test.ts:26](../tests/invariants/phase3.test.ts#L26)). Unmet demand is preserved and is never quietly satisfied: unreachable nozzle reservations are returned to `unmet` at [stepFlight.ts:48-54](../src/game/flight/stepFlight.ts#L48-L54). |
| Allocation record represents the real driving path | **PASS** | The record is not telemetry-only. `rates[axis] += (aero + floor + servoDamping + actualTvc + restoring + damping)·dt` is the single rate line ([stepFlight.ts:62-65](../src/game/flight/stepFlight.ts#L62-L65)), and the invariant test reconstructs `ratesAfter` from exactly those six terms to 11 decimals, so any extra term would fail. My independent recomputation over 360 post-stall substeps agreed to 1.33e-14 rad/s². |
| C only opens limiter — **angular authority only; translation deferred, see L1** | **PASS (angular)** | `state.limiterOpen = command.psmArm && psmEnabled ? 1 : 0`; it reaches `alphaLimitDeg` and `ratePermission`, i.e. the *request*, and never `computeBudget`, `tvcMomentCapacity` or the floor. Empirically: C on versus C off at 25 m/s gives byte-identical `aero`, `tvc`, `floor` and rotation (11.294°), differing only in `unmet` (1.04 → 13.71). C multiplies the pitch *target* by roughly 13× at low speed through `incidencePermission = sqrt(alphaLimitDeg/alphaNormalDeg) = 3`, but that enlarged request is simply unmet unless TVC exists. See L1 for translation. |
| Generic PSM angular authority removed | **PASS** | `maneuver.pitchRate/yawRate/rollRate`, `fullControlThrust`, `ManeuverState.controlAuthority`, `poweredBlend`, `tvcAuthority` and the subtract-requested/add-actual compensation are all gone from the diff. `grep` finds `controlAuthority` surviving only as `stall.controlAuthority`, used at [stepFlight.ts:78](../src/game/flight/stepFlight.ts#L78) as a *translation* `surfaceControl` factor on `normalLateral`, not as angular authority. `maneuvers.ts` returns no rates and no longer mutates burner state. |
| Single authoritative TVC command path | **PASS** | `solveTvcAngles(allocation.tvc, thrust, tvc)` → `stepThrustVectoring` → `poweredThrustForces(actual angles)`. `grep` confirms `stepThrustVectoring` has exactly one flight caller; the only other callers are `HangarFlightView.tsx` and `render/exhaust/preview.ts`, both presentation-only and both fed by the legacy `tvcTargets` mixer, which no longer touches flight. |
| No TVC double-counting | **PASS** | `allocation.tvc` is never added to rates; only `actualTvc` is. The old "subtract requested, add actual" pattern is deleted. The reconciliation loop reduces `allocation.tvc` to what the reachable nozzle pair achieves and returns the remainder to `unmet`, so the record cannot over-claim either. Verified numerically under aero = 0 and floor = 0 with TVC only (residual 1.33e-14). |
| `f22-notvc` receives no powered PSM | **PASS** | The profile is `{ ...structuredClone(f22Profile), thrustVectoring: null }` — a genuine controlled experiment where only TVC differs ([flight-profiles/index.ts:8](../src/content/flight-profiles/index.ts#L8)). It is `playgroundOnly` and rejected outside Playground sessions ([validate.ts:44](../src/content/validate.ts#L44)). Budget, allocation and actual torque are exactly zero under C, Shift, brake and fuzz. Its floor and physical aero remain, as the baseline allows. It reaches 360° only after 27.4 s at 33° peak incidence and 118 m/s — an aerodynamic loop, not a Kulbit. |
| Low-speed path-rate protection | **PASS** | Cap active and effective (1.79 vs 14.34 rad/s uncapped at 5 m/s); path direction is not frozen, since rotation continues at the capped rate; gravity is integrated separately and uncapped; drag alone cannot reverse the path; no NaN at any seed including exact zero speed. Specific energy may rise when the engine does positive work, which is correct. See T2 for the magnitude question and L2 for the wording question. |
| Tail slide / reverse flow still possible | **PASS** | Independently sampled rather than taken from report §7: a 10 s neutral tail slide from nose-up 90° at 60 m/s reaches `reverseFlow = 1.0000` at t = 6.05 s and incidence 180.0° on all three aircraft, passing through a minimum airspeed of 0.001 m/s with every state value finite. The cap does not lock the velocity direction, and near-zero speed produces no NaN. The flip itself (`B10.tailSlide.flipTime`) is still unreached — inherited from Phase 2, unchanged by Phase 3. |
| Deterministic replay / simulation | **PASS** | 30/60/144 FPS snapshot equality including the non-TVC variant with C, burner and brake ([tests/invariants/phase3.test.ts:106-111](../tests/invariants/phase3.test.ts#L106-L111)); all 18 archived tracks replay. New mutable state (`engine`, `intent`, `limiterOpen`) is declared in `AircraftState`, initialised in `GameRuntime` and reset by `runtime.reset()`. `limiterOpen` is recomputed from the command every step, so it carries no hidden memory. `flightProfileVersion` bumped to `p3-engine-allocation-3`; stale replays are rejected. |
| No NaN | **PASS** | Fuzz across three seeds and three aircraft in the suite, plus my own 10 s runs from 0.001 m/s with full three-axis input, C, burner and W: all state finite throughout. |

## Test Quality Review

**Strong — these genuinely enforce the architecture**

- [tests/invariants/phase3.test.ts:36](../tests/invariants/phase3.test.ts#L36) is the single most valuable
  assertion in the phase. Reconstructing `ratesAfter` from the six named terms across every scenario and
  fuzz seed makes any future hidden authority term a build failure. Keep it and never relax its tolerance.
- The same `audit` function bounding `|aero| ≤ physicalAero`, `|tvc| ≤ signed cap`, `|floor| ≤ floorGap`,
  conservation to 10 decimals, and actual torque inside `actualMomentBounds` is thorough, and applying it
  to `f22-notvc` as well is what turns the no-TVC profile into a real control.
- The full actual-angle grid sweep at 0.5° resolution confirming every reachable moment lies inside the
  analytic bounds ([phase3.test.ts:74-80](../tests/invariants/phase3.test.ts#L74-L80)) closes the E3 gap
  properly, rather than asserting a declared budget that does not bound real torque.
- I17 in [tests/engine.test.ts:25-39](../tests/engine.test.ts#L25-L39) forces `alphaDrag`/`betaDrag` to 10
  and asserts engine state equality — a real adversarial construction, not a tautology.
- The floor ceiling property test with 1200 iterations from just below the boundary, in both signs, plus
  the reversal case ([tests/allocation.test.ts:24-38](../tests/allocation.test.ts#L24-L38)).
- The zero-q no-TVC rig comparing C + burner against neither, step by step for 600 steps, asserting rate
  *equality* between the two ([phase3.test.ts:113-131](../tests/invariants/phase3.test.ts#L113-L131)).
- `controlledPathStep` unit coverage across speeds 0 to 100 including `speed = 0`, with direction unit
  length checked to 14 digits.

**Weak**

- `poweredPsm.test.ts` powered-half assertions (F6): `> 0` and `> idle × 3` where `idle ≈ 0`.
- The energy assertions in three files are bounded by the ledger under test (F3).
- `tests/thrustVectoring.test.ts` actuator tests now drive `stepThrustVectoring` through the *preview*
  mixer `f22TvcTargets`, not through `solveTvcAngles`. Actuator travel and rate limits are still checked
  correctly, but the tests no longer exercise the authoritative command path they used to approximate.
  The zero-thrust check at [thrustVectoring.test.ts:73-82](../tests/thrustVectoring.test.ts#L73-L82) and the
  gain-aware torque equality are both good and should be kept.
- `neutralRelease.test.ts` now permits terminal collisions provided recovery completed first. The
  justification (no Phase 5 attitude-leveling autopilot exists) is sound and the added `recovered` gate
  keeps it meaningful, but the test's name over-promises relative to what it now asserts.

**Missing**

- No test pins where `controller.ts:26`'s request floor activates (F1), so a floor retune silently changes
  low-speed demand.
- No `limiterOpen` continuity coverage (F5).
- No independent work computation to validate the energy ledger (F3).
- No test asserts that `thrustVectoring.gain` is scalar across axes — that is, that scaling `gain` scales
  all three commanded capacities by the same factor. This is the property that keeps F-22 yaw at zero for
  any gain, and it is currently guaranteed only by reading
  [thrustVectoring.ts:90](../src/game/flight/thrustVectoring.ts#L90). A three-line test would pin it.
- No invariant covers `f22-notvc` in the FPS-determinism *scenario* set beyond the one dedicated
  30/60/144 case; the scenario matrix `describe.each(ids)` does include it for the audit, so this is a
  small gap, not a hole.

**Correctly kept as benchmarks rather than invariants**

Cobra peak AoA, time to 90°, Kulbit 360° time, pedal yaw rate, handoff dip, no-TVC rotation at 3 s, and
the instant-thrust acceleration/settling/top-speed numbers moved to `legacySpeed.report.ts`. All of these
are feel numbers and belong in the report per §5.0. The I4 retirement is version-scoped with a recorded
reason in `goldenPolicy.ts` and throws a clear regenerate-or-retire error on any unregistered version
change — that is the right mechanism, not a blanket skip.

## Benchmark Review

I reran `npm run flight:bench` (8 suites, 20 tests, pass) and `npx vitest run` (34 files, 403 tests, pass).
Every number quoted in the implementation report's §4, §6, §9 and §10 reproduced exactly, including the
capacity tables, the 0.2520 yaw ratio, the gain sweep and the Phase 2 deltas. That is a good sign for the
report's factual reliability; the issue in F7 is selection, not accuracy.

Meaningful metrics:

- **Capacity, F-22 at thrust 65**: pitch +6.891 / −7.298, commanded yaw 0.000, roll 2.415 rad/s². Coupled
  yaw bound 0.063866, ratio 0.00927 to nose-up pitch. The nose-down/nose-up asymmetry (E1) is the
  engine-height moment and is now explicit in the signed capacities rather than hidden in a scalar max.
- **Capacity, Su-57 at thrust 65**: pitch +6.156 / −6.369, yaw 3.616, roll 3.434 rad/s². Yaw and roll share
  differential travel and are not simultaneously attainable, which the solver enforces and a dedicated
  test asserts.
- **Post-stall pedal (20 m/s, 75°, 2 s)**: f22 peak 6.283°/s with shares aero 0.1192 / TVC 0 / floor 0.1319 /
  unmet 5.9195; f22-notvc identical to six digits; su57 24.938°/s with aero 0.1070 / TVC 1.4895 / floor 0 /
  unmet 5.4556. The identity between f22 and f22-notvc is the cleanest possible demonstration that F-22
  yaw authority is not being restored anywhere downstream.
- **Brake + burner + high AoA (70 m/s, 80°, 0.5 s)**: thrust stays near 64–65 m/s² while speed drops
  6.27 / 7.86 / 9.05 m/s for f22 / su57 / f22-notvc. Exactly the required coexistence.
- **`handoffRateDip`**: 0 rad/s for both TVC aircraft, null for no-TVC. Suspicious at first reading, but the
  metric definition is defensible (pre-onset 0.2 s peak minus the following 0.5 s minimum, clamped at
  zero) and the report itself warns it does not prove all handoffs are invisible. The reason there is no
  dip in this pull is that aero saturates at very low q where its contribution is already near zero, so
  there is no plateau to fall from. A dip is more likely at moderate q where aero is substantial and then
  saturates. I would not treat "0" as evidence the aero-first risk is absent; I would treat it as evidence
  this particular pilot does not exercise the risky region. Not a Phase 3 defect — §9 of the plan
  explicitly says the dip is a benchmark, not a reason to pre-blend participation — but the seed should be
  fixed so the metric becomes informative; see Optional Improvements.
- **Suspicious results**: `B15.reversal.altitudeLoss = 0.000 m` for both aircraft (F7/T1 — attributable to
  the sampling window, not to energy creation, since I18 holds per step), and `B4.cobra.headingChange`
  moving from 30.7° to 47.1° against a 20° target (T1).
- **Governor**: `requestedPower = 0.070000` at both 0° and 80° incidence at 100 m/s. No free power.
- **Low-speed path rate at 5 m/s**: 1.7921 rad/s capped against 14.3377 uncapped, `pathCapActive = true`.

## Runtime / Physics Risks

These pass today but deserve attention before or during Phase 4.

1. **Double lag is real but currently benign.** Engine spool (4/s up) and nozzle actuator (45°/s, response 7)
   compose, so TVC moment ramps behind the stick twice. The gain sweep shows the 0.2 s pitch response is
   nearly gain-independent (0.5360 → 0.5644 across gains 1 to 3), which confirms onset is dominated by
   spool and actuator, not by capacity. If the owner picks a higher gain to fix Cobra peaks, the onset will
   still feel soft; the correct lever there is `spoolUpResponse` or `actuatorResponse`, not gain. Tuning
   risk, not an architecture bug.
2. **Capacity can exist slightly before thrust is meaningful and vice versa.** Capacity is computed from
   the *same-tick* actual thrust, so there is no instant-capacity-at-zero-thrust bug. But the nozzle
   actuator begins moving in the same tick the allocation reserves TVC, before the moment has grown, so
   visual nozzle deflection leads physical authority by roughly the spool time constant during a burner
   spool-up. Cosmetic today; worth a look during Phase 7 camera/HUD polish.
3. **C's ~13× request amplification meets Phase 4's automatic limiter.** Today the enormous `unmet` values
   (13.7 rad/s² at 25 m/s) are harmless because the budget clamps them. When Phase 4 opens the limiter
   automatically and continuously, the same amplification will apply without a deliberate keypress, and the
   `incidencePermission = sqrt(alphaLimit/alphaNormal)` mapping — which the report itself calls provisional
   — becomes handling tuning rather than a debug affordance. Review that mapping as part of Phase 4 rather
   than inheriting it.
4. **Aero-first plus the reconciliation loop interacts with saturation.** When the two-nozzle least-squares
   solve cannot reach the reserved torque, the shortfall returns to `unmet` in the same tick. Under
   sustained saturation with a large request this is stable in every trace I ran, but the solve is a
   10-iteration damped Gauss-Newton with a backtracking line search and an early `break` when no fraction
   improves. It is deterministic, which is what matters for replay, but it is not guaranteed to reach the
   same optimum under a future profile with different geometry. Worth a regression pin on solver output for
   both profiles before Phase 8 adds aircraft.
5. **Floor and restoring interaction at moderate incidence.** The floor stops contributing at `maxRate`, but
   `naturalRestoring` scales with q, so between roughly 15 and 30 m/s there is a band where the floor is
   the dominant authority and restoring is weak. My 40 s no-burner C pull produced 88° (f22) and 85°
   (f22-notvc) of rotation at decaying speed — slow and bounded, not a slow Kulbit, but it is the regime
   where F1's request floor also becomes active. Re-check this band after any floor retune.

## Required Fixes Before Phase 4

Only two are genuinely blocking, and both are small:

1. **F2** — make `thrustVectoring.gain` a positive validation, so `gain: 0` cannot silently produce a
   TVC-shaped aircraft with no TVC.
2. **F7** — extend report §10 with the `B4.cobra.headingChange` and `B15.reversal.*` deltas and the T1
   attribution, so the owner's playtest decision on gain is made with the path-bending regression visible.

Everything else below can be scheduled.

## Optional Improvements

- **F1** — give the low-q request floor its own profile field, or document the reuse and pin its activation
  boundary with a test.
- **F3** — add one independent work computation to stop the energy invariants from being self-certifying.
- **F4** — add `naturalRestoring` and `naturalDamping` rows to the overlay (with `en`/`th` keys), or correct
  the report's "shows all of these sources" claim.
- **F6** — restore a magnitude-bearing assertion to the powered half of the `poweredPsm` thrust-dependence
  test.
- Add the scalar-gain test described under Missing, and a deterministic solver-output pin for both TVC
  profiles.
- **B18 seed** — add a moderate-q `handoffRateDip` seed. The current pull enters at very low q where the
  aero contribution is already near zero, so there is no plateau to fall from and the metric necessarily
  reports 0. The aero-first risk the plan describes lives at moderate q, where aero is substantial and then
  saturates. A seed at the `fullStick500` entry condition (roughly 90–140 m/s) pulling into saturation would
  make B18 measure the region it was created for; as written it reports 0 and tells the owner nothing.
- **T2** — review `pathRateFloorMps = 40` during the Phase 2/3 playtest rather than in Phase 4.

## Expected Later-Phase Work

Owned by Phase 4: the `activeGrip` / `recoveryGrip` / `recoveryAcceleration` / `gravityBlend` port away
from `maneuver.phase` (L1, and a hard ordering constraint before automatic breakout); the automatic,
smoothed limiter and the `limiterOpen` continuity invariant that must accompany it (F5); review of the
`incidencePermission` rate mapping; `powerIntent`-based breakout permission; Brake + Shift natural entry;
High-G merge; and the input-frame migration.

Owned by Phase 5: full recovery assist, including anything that would keep an unattended recovered dive
from reaching terrain.

Owned by Phase 6: removal of `psmArm`/`highG` and the remaining legacy gates.

Deferred by decision, not by defect: TVC participation blending (the `AllocationStrategy` signature already
accepts `participation` and `tests/allocation.test.ts:19-23` proves a non-zero participation produces the
expected split, so this needs no controller rewrite); `B10.tailSlide.flipTime`; B9 band selection; and the
I19 wording decision (L2).

## Closing Answer

> If I delete or disable physical TVC capability, does the powered post-stall maneuver capability
> disappear as intended?

Yes, clearly. `f22-notvc` — an exact `structuredClone` of the F-22 profile with only `thrustVectoring: null`
— cannot exceed 33° incidence under maximum provocation, holds 118 m/s where the TVC aircraft decay to
29–32 m/s, produces exactly zero TVC budget, zero allocated TVC and zero actual TVC torque at every tick,
and completes a 360° only as a conventional loop after 27.4 s versus 4.9 s for the F-22. Powered post-stall
capability is owned by the new authority architecture.

---

# Follow-up Review — fixes verified, 20 September 2026

Scope: the review fixes in the working tree on top of commit `7a618d7`. I re-read every changed file,
re-ran `npx vitest run` (**34 files / 419 tests passed**, up from 403), `npm run flight:bench`
(**8 suites / 20 passed**) and `npx tsc -b` (clean), and reproduced every number the updated
implementation report added. This section supplements the review above; the original text is unchanged
except for one correction flagged inline under T1.

## Follow-up Verdict

```text
PASS
```

Both blocking fixes are complete and correct. Five of the seven findings are fully fixed, one (F5) is
honestly scoped as partial with the remainder assigned to Phase 4, and the one item that is not a
"fix" — the handoff seed — produced a genuinely new and useful measurement. Phase 3 is ready for Phase 4,
subject to the unchanged ordering constraint in L1.

## Fix Verification

| ID | Claim | Verified | Evidence |
|---|---|---|---|
| F1 | `flight.minRateTarget` separates the low-speed request floor from floor tuning | **CONFIRMED** | [controller.ts:27](../src/game/flight/controller.ts#L27) now reads `p.minRateTarget[axis]`; `grep` confirms `controller.ts` no longer references `arcadeControlFloor` at all, so the coupling is gone at the source rather than renamed. New field is required and validated finite non-negative per axis ([validateProfile.ts:33](../src/game/flight/validateProfile.ts#L33)), not defaulted in `flightDefaults`, so a new airframe cannot omit it. `phase3Boundaries.test.ts:15-33` sets `arcadeControlFloor` to 100 on every axis and asserts the returned request is `toEqual` the reference at speeds 0/5/18/19/25/100 — a direct test of the property the finding was about. The activation boundary is derived, not hardcoded: `referenceSpeedMps × minRateTarget.pitch / pitchRate` = 90 × 0.2 / 0.95 = 18.947 m/s, checked on both sides at ±0.01. |
| F1 | Initial values preserve previous response | **CONFIRMED** | `minRateTarget` is `{0.2, 0.15, 0.3}`, identical to the old `arcadeControlFloor.maxRate`. The benchmark run confirms behavioural identity to the digit: f22 pull rotation 215.717 / 515.622, pedal peak yaw 6.283, notvc 66.249 / 131.516 — unchanged from the pre-fix run. |
| F2 | `gain` strictly positive | **CONFIRMED** | `positive(thrustVectoring.gain, ...)` added at [validateProfile.ts:150](../src/game/flight/validateProfile.ts#L150). `phase1Profile.test.ts:14-17` rejects `0, -1, NaN, Infinity, undefined` and states `null` remains the explicit no-TVC contract. |
| F3 | Independent work oracles | **CONFIRMED** | `tests/engineForces.test.ts:5-28` adds five constant-force seeds with hand-derived displacement and distance constants, asserting `thrustWork === thrust × displacement` and `dragWork === drag × distance` against literals, not against the returned ledger. I verified two by hand: seed 1 (10 m/s, thrust 20, drag 5, dt 0.2) gives end speed 13, distance 2.3, and ΔKE 34.5 = 46 − 11.5 ✓; the axial-reversal seed (1 m/s, thrust −4, dt 1) gives end speed −3, signed displacement −1, drag distance 1.25, ΔKE 4 = −4 × −1 ✓. The reversal, stopping and braking cases are all covered, which is exactly where a mis-integrated interval would hide. Caveat, correctly stated in the report: gravity and transverse force are disabled in the oracle, so the coupled path still relies on the self-referential inequality. That residue is acceptable — the oracle pins the term that could have been inflated. |
| F4 | Overlay completeness | **CONFIRMED** | `labNaturalRestoring` and `labNaturalDamping` rows added, reading `lastStep.naturalRestoring` / `lastStep.naturalDamping` from the real integrated tick. Keys present in both `en.ts:145-146` and `th.ts:146-147`, so the existing locale-parity test covers them. All six terms of the rate equation are now displayed; the report's §3 claim is now true. |
| F5 | Limiter continuity | **CONFIRMED AS PARTIAL** | The report's PARTIAL / PHASE 4 label is accurate and I endorse it. `phase3Boundaries.test.ts:35-47` sweeps `limiterOpen` over 101 fractional values and asserts `alphaLimitDeg` advances by a constant increment while `computeBudget` returns `toEqual` the same budget — so the mapping is proven continuous and proven not to touch capability. `phase3Boundaries.test.ts:49-59` asserts the C-driven step is exactly 0/1 and that both branches produce identical budgets. What is still absent — runtime smoothing and its profile-derived per-step ε — is correctly deferred, and the report explicitly disclaims continuity for debug C. This is the right disposition, not a deferral of work that should have happened now. |
| F6 | Powered assertion strengthened | **CONFIRMED** | `poweredPsm.test.ts:64-75` now asserts `budget.tvc` equals an independently computed `tvcMomentCapacity(profile, actualThrust).commanded`, that `poweredControlAvailable` equals `min(1, actualThrust / maxThrust)` to 12 digits, and that both `budget.tvc.positive.pitch` and `allocation.tvc.pitch` exceed 30% of dry geometric capacity. The epsilon-passes-trivially hole is closed on both the budget and the allocation side. |
| F7 | Omitted regressions | **CONFIRMED** | Report §10 now carries B1, B2, B4 and both B15 rows with Phase 2 → Phase 3 values and attribution. More importantly the generated report no longer *can* omit them: the scenario filter was deleted from `phase3.report.ts:105`, so the regression table iterates every Phase 2 scenario, and the gain sweep gained a B4 heading column. That is a structural fix, not a one-time table edit. |
| — | Scalar gain coverage | **CONFIRMED** | `phase3Boundaries.test.ts:61-72` scales gain 1 → 2.5 and asserts every `commanded` and `moments` entry, both signs, all three axes, scales by exactly 2.5, and that `poweredThrustForces` translation acceleration is *unchanged* while all three angular axes scale. This pins the property that keeps F-22 yaw at zero for any gain, which was the gap I named under Missing. |
| — | Moderate-q handoff seed | **CONFIRMED, and it found something** | See FU-1. |

## New Findings

**FU-1 — The moderate-q handoff benchmark exposes a real ~1 rad/s response dip**

- Severity: TUNING (Phase 4 input), not a Phase 3 defect
- Evidence: reproduced exactly. A 140 m/s attached pull with W + Shift, opening debug C at 1 s:

  | Aircraft | TVC onset | Pre-onset q | Pre-onset aero pitch | Dip |
  |---|---:|---:|---:|---:|
  | f22 | 1.583 s | 4.640 | 13.957 rad/s² | 1.0266 rad/s |
  | su57 | 1.575 s | 4.533 | 13.957 rad/s² | 0.8676 rad/s |
  | f22-notvc | none | — | — | null |

- Interpretation: a 1.03 rad/s dip is roughly 59°/s of lost pitch rate across the transition. The cause is
  structural, not a bug: pre-onset aero supplies 13.957 rad/s², and no TVC capacity at any reachable
  thrust replaces that — F-22 commanded pitch capacity is 6.89 rad/s² even at burner thrust 65. When the
  limiter opens, demand jumps, incidence rises, separation collapses `physicalAero`, and TVC covers well
  under half of what was lost. Actuator slew adds to it but is not the dominant term.
- This is precisely the aero-first risk the Final Baseline §3.3 recorded as B18, and it is the answer the
  original `handoffRateDip = 0` could not give. The report's framing — that the metric measures the
  combined transition rather than isolated actuator lag, and that no participation blending or gain
  retune was introduced in response — is correct, and adding either now would be premature Phase 4 work.
- Required action before Phase 4: none. Required action *during* Phase 4: this number is the input to the
  TVC participation decision. Re-measure it with any non-zero participation before accepting that tuning.

**FU-T1 — Correction to my own T1: gain does not fix B4, and the dwell mechanism is now quantitative**

- My original T1 recommended `thrustVectoring.gain` as the first lever for B4, reasoning that gain 3
  reaches 90° at 2.23 s and would restore the short dwell. The new sweep refutes the recommendation.
  F-22 B4 by gain: 30.563 / 38.970 / 47.071 / 55.005 / 53.556 at gains 1 / 1.5 / 2 / 2.5 / 3. Su-57:
  48.625 / 55.618 / 59.368 at gains 2 / 2.5 / 3. B4 rises with gain. The report states this plainly and
  is right; I was wrong.
- The underlying attribution survives and is now measurable. Heading change per second of pull:
  Phase 2 f22 30.655° / 1.183 s = **25.9 °/s**; Phase 3 gain 2 47.071° / 2.5 s = **18.8 °/s**; Phase 3
  gain 3 53.556° / 2.225 s = **24.1 °/s**. Phase 3 bends the path no faster per unit time than Phase 2 —
  slightly slower — which independently confirms that no new free-turn source was introduced. The total
  is worse purely because even gain 3 needs 2.225 s to reach 90° against Phase 2's 1.183 s, and gain 2.5
  never reaches it at all so it runs to the pilot's 2.5 s timeout. Gain buys nose rate but not enough to
  halve the dwell, and it raises per-second bending along the way.
- Consequence for the owner: B4 cannot be recovered by gain selection. Choose gain on Cobra peak and
  Kulbit time, and treat B4 as owned by the Phase 4 path-grip port and TVC participation.

**FU-2 — One further undisclosed regression, low consequence**

- Severity: MINOR
- `legacy.recovery.backToNormal` moved from 0.608 s to 2.700 s (F-22) and 0.608 s to 2.708 s (Su-57),
  a 210% change, and is not in report §10's added table. It is report-only with no target, it is the
  legacy label's return to NORMAL rather than a physics quantity, and it is expected: the Cobra now peaks
  lower and unwinds with weaker authority. Report §10 item 4 discusses the related C5-release recovery
  times, so the topic is not hidden, but this row is not listed.
- Required fix: none. Mentioning it so the record is complete now that the generated table covers all
  scenarios and will surface it anyway.

## Re-verified Architecture Claims

The fixes touched the controller's request path, profile validation, the overlay and tests. I re-checked
that none of them altered authority ownership:

- The single rate-integration line at [stepFlight.ts:62-65](../src/game/flight/stepFlight.ts#L62-L65) is
  unchanged, and the reconstruction invariant at `phase3.test.ts:36` still passes across every scenario,
  every aircraft and fuzz.
- `computeBudget` is untouched and still command-free; `phase3Boundaries.test.ts:35-47` adds a second,
  stronger demonstration that limiter permission cannot move it.
- Benchmark identity across the fix confirms behavioural neutrality: pull rotation, pedal yaw, no-TVC
  rotation, capacities, yaw ratio 0.2520 and brake/burner speed loss all reproduce the pre-fix values
  exactly. The `minRateTarget` extraction was a refactor with the same numbers, which is what it claimed
  to be.
- `f22-notvc` remains the controlled experiment: `phase3Boundaries.test.ts:79-90` now also asserts
  `profile.aero` is `toEqual` but `not.toBe` the F-22's, pinning the independent-clone property by
  identity rather than by reading the profile file.

## Remaining Work (unchanged from the original review)

Nothing blocks Phase 4. Carried forward:

- **L1 is still the hard ordering constraint**: port `activeGrip` / `recoveryGrip` /
  `recoveryAcceleration` / `gravityBlend` off `maneuver.phase` before enabling automatic breakout. The
  report now states this at the start of the Phase 4 plan, which is the right place for it.
- **F5's remainder**: runtime limiter smoothing plus its profile-derived per-step continuity bound, added
  together in Phase 4.
- **FU-1** feeds the participation decision; **FU-T1** removes gain from the B4 toolbox.
- Unverified by any automated check, as the report states: browser layout and human handling playtest,
  B9 band selection, B10 flip time.
