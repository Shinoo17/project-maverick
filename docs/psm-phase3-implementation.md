# Phase 3 — Engine + Aero/TVC Authority Allocation

Status: **implementation, automated tests and benchmarks complete; stopped before Phase 4**.
Physics/replay version: `p3-engine-allocation-3`. No commit was made. The owner approved
directional TVC command capacities plus separate coupled physical moments and waived
an independent agent review. This report supplies review focus, not a claimed Claude review.

**Scope qualifications:** angular authority is fully allocated and phase-independent.
Legacy **translation/path-grip and gravity weights** still use maneuver phase/blend,
as Rev. 3 explicitly schedules their migration in Phase 4. Consequently the literal
“C never affects a physics mode” wording is not yet true for every translation branch.
The cap applies to transverse engine/lateral **rotation**; signed longitudinal speed
crossings through zero are identified separately. See §11 before treating those two
statements as stronger guarantees. No browser handling/visual sign-off is claimed.

## 1. Files changed

The pre-existing untracked `docs/psm-architecture-review.md` was not modified.
All 18 Phase 0 golden files remain unchanged. Added/modified files in this work:

| File | Responsibility |
|---|---|
| [package.json](../package.json) | Run the hard test suite before production build; a failing invariant blocks the build. |
| [README.md](../README.md) | Current Phase 3 runtime, controls, debug ownership and report entry point. |
| [benchmarks/flight/README.md](../benchmarks/flight/README.md) | Run instructions, ledger semantics, retained archives, baseline and migrated expectations. |
| [benchmarks/flight/goldenPolicy.ts](../benchmarks/flight/goldenPolicy.ts) | Explicit version-scoped I4 retirement for intentional Phase 3 physics changes. |
| [benchmarks/flight/harness.ts](../benchmarks/flight/harness.ts) | Shared hydration of archived initial states so new engine/intent fields survive replay. |
| [benchmarks/flight/legacyManeuvers.report.ts](../benchmarks/flight/legacyManeuvers.report.ts) | Preserve old yaw-completion target as feel; keep detector gate/lifecycle checks hard. |
| [benchmarks/flight/legacySpeed.report.ts](../benchmarks/flight/legacySpeed.report.ts) | Retain instant-thrust acceleration, settling and exact top-speed targets as measurements. |
| [benchmarks/flight/legacyStall.report.ts](../benchmarks/flight/legacyStall.report.ts) | Same detector-gate versus old generic yaw performance distinction. |
| [benchmarks/flight/phase2-metrics.json](../benchmarks/flight/phase2-metrics.json) | Clean pre-change HEAD benchmark values plus source commit/version. |
| [benchmarks/flight/phase2.report.ts](../benchmarks/flight/phase2.report.ts) | Update ledger description; retain existing archived-input and natural-aero reports. |
| [benchmarks/flight/phase3.report.ts](../benchmarks/flight/phase3.report.ts) | Capacities, pedal shares, no-TVC, brake/burner, governor, low-speed work/cap, handoff, gain sweep and regression tables. |
| [docs/psm-implementation-plan.md](../docs/psm-implementation-plan.md) | Record owner-approved E1/E3 resolution and explicit scope qualifications. |
| [docs/psm-phase3-implementation.md](../docs/psm-phase3-implementation.md) | All twelve requested deliverables and remaining review/playtest risks. |
| [docs/psm-phase3-progress.md](../docs/psm-phase3-progress.md) | Replace the interim blocked status with a link to this final report. |
| [src/content/aircraft/index.ts](../src/content/aircraft/index.ts) | Playground-only no-TVC registry entry with reused F-22 assets. |
| [src/content/flight-profiles/defaults.ts](../src/content/flight-profiles/defaults.ts) | Remove generic maneuver rate/fullControlThrust defaults. |
| [src/content/flight-profiles/f22.ts](../src/content/flight-profiles/f22.ts) | Spool, physical aero acceleration, floor, path denominator, incidence permission and scalar TVC gain. |
| [src/content/flight-profiles/index.ts](../src/content/flight-profiles/index.ts) | Independent deep-cloned raptor-notvc profile with null TVC. |
| [src/content/flight-profiles/su57.ts](../src/content/flight-profiles/su57.ts) | Equivalent independent Su-57 tuning; retain canted geometry. |
| [src/content/schemas.ts](../src/content/schemas.ts) | Explicit playgroundOnly validation-variant flag. |
| [src/content/validate.ts](../src/content/validate.ts) | Reject validation variants in offline sessions. |
| [src/features/flight/FlightPage.tsx](../src/features/flight/FlightPage.tsx) | Local Playground aircraft selector and reset/remount when changing validation airframes. |
| [src/features/flight/PlaygroundHud.tsx](../src/features/flight/PlaygroundHud.tsx) | Per-tick budgets, allocation/unmet, torque decomposition, power, nozzle targets and path cap. |
| [src/features/flight/hudPreview.tsx](../src/features/flight/hudPreview.tsx) | Remove obsolete generic maneuver authority fixture. |
| [src/features/hangar/FlightProfilePanel.tsx](../src/features/hangar/FlightProfilePanel.tsx) | Replace obsolete PSM yaw rate with physical yaw TVC at dry thrust limit. |
| [src/game/flight/allocation.ts](../src/game/flight/allocation.ts) | Signed, bounded aero-first allocation, optional strategy parameter, floor gap and rate headroom. |
| [src/game/flight/authority.ts](../src/game/flight/authority.ts) | Command-free physical budgets, signed command capacity, full-travel moment bounds and powered capability. |
| [src/game/flight/controller.ts](../src/game/flight/controller.ts) | Body-rate request/permission and explicitly dissipative servo term; no TVC or engine capability reads. |
| [src/game/flight/engine.ts](../src/game/flight/engine.ts) | Requested-to-actual exponential spool and engine-owned burner reserve lifecycle. |
| [src/game/flight/engineForces.ts](../src/game/flight/engineForces.ts) | Transverse path-rate protection, signed longitudinal zero crossing and work/potential-energy guard. |
| [src/game/flight/envelope.ts](../src/game/flight/envelope.ts) | Debug limiter permission/alpha limit independent of legacy path blend; no automatic breakout. |
| [src/game/flight/flightForces.ts](../src/game/flight/flightForces.ts) | Serializable allocation, actual/coupled/lag torque, damping and work/cap ledger. |
| [src/game/flight/instrumentation.ts](../src/game/flight/instrumentation.ts) | Expose actual engine thrust and the budget actually used in the last tick. |
| [src/game/flight/intent.ts](../src/game/flight/intent.ts) | Input-only intent plus explicit controller saturation feedback; no capability/profile imports. |
| [src/game/flight/maneuvers.ts](../src/game/flight/maneuvers.ts) | Remove angular authority outputs/state and burner mutation; retain legacy labels/path grip. |
| [src/game/flight/profile.ts](../src/game/flight/profile.ts) | Bump replay physics version to p3-engine-allocation-3. |
| [src/game/flight/profileTypes.ts](../src/game/flight/profileTypes.ts) | Engine, aero acceleration, floor, path denominator and gain contracts; remove generic PSM rate fields. |
| [src/game/flight/speed.ts](../src/game/flight/speed.ts) | Base-drag-only power requests feed the engine; braking remains separate. |
| [src/game/flight/stepFlight.ts](../src/game/flight/stepFlight.ts) | One allocation/actuator/actual-moment integration path, without requested-torque subtraction. |
| [src/game/flight/thrustVectoring.ts](../src/game/flight/thrustVectoring.ts) | Preserved raw geometry, signed gain-scaled capacity, analytic physical bounds and reachable two-nozzle solve. |
| [src/game/flight/validateProfile.ts](../src/game/flight/validateProfile.ts) | Validate required finite spool, aero/floor, incidence, geometry and gain fields. |
| [src/game/runtime/GameRuntime.ts](../src/game/runtime/GameRuntime.ts) | Initialize actual/desired engine state, input intent and debug limiter. |
| [src/game/state/WorldState.ts](../src/game/state/WorldState.ts) | Serializable engine, intent and limiter state; enginePower remains actual power. |
| [src/locales/en.ts](../src/locales/en.ts) | English ownership/capacity labels and Playground validation selector. |
| [src/locales/th.ts](../src/locales/th.ts) | Matching Thai labels and placeholders. |
| [src/render/HangarFlightView.tsx](../src/render/HangarFlightView.tsx) | Preview-only input mixer explicitly sends angle targets to the actuator. |
| [src/render/exhaust/preview.ts](../src/render/exhaust/preview.ts) | Same preview migration; flight allocation is not bypassed by render code. |
| [tests/aerodynamics.test.ts](../tests/aerodynamics.test.ts) | Retain natural-moment accounting and I7; use the authored exponential path-grip bound. |
| [tests/airflow.test.ts](../tests/airflow.test.ts) | Debug limiter observation no longer aliases legacy path blend. |
| [tests/allocation.test.ts](../tests/allocation.test.ts) | Signed conservation, per-source bounds, participation interface and floor gap/ceiling properties. |
| [tests/engine.test.ts](../tests/engine.test.ts) | Spool equations, shared actual output, governor exclusions, input power intent and burner reserve. |
| [tests/engineForces.test.ts](../tests/engineForces.test.ts) | Transverse cap, energy inequality, gravity/axial zero crossings and no drag reversal. |
| [tests/flight.test.ts](../tests/flight.test.ts) | Keep input/normal-flight safety; relocate obsolete instant-thrust feel fixture. |
| [tests/flightInstrumentation.test.ts](../tests/flightInstrumentation.test.ts) | Retain raw signed geometry references; replace obsolete legacy overlay expectations with applied-ledger checks. |
| [tests/flightProfileConfig.test.ts](../tests/flightProfileConfig.test.ts) | Legacy presentation gate configuration without generic powered rate outputs. |
| [tests/invariants/helpers.ts](../tests/invariants/helpers.ts) | Hydrate archived spawns identically for FPS and replay checks. |
| [tests/invariants/neutralRelease.test.ts](../tests/invariants/neutralRelease.test.ts) | Preserve no-q decay/recovery; permit terminal collisions only after powered recovery has completed. |
| [tests/invariants/phase3.test.ts](../tests/invariants/phase3.test.ts) | Per-step/fuzz I9–I19, actual-angle geometry bounds, no-TVC isolation, replay and no automatic breakout. |
| [tests/phase1Profile.test.ts](../tests/phase1Profile.test.ts) | Keep authored profile isolation and use q budgets/actual spool-aware engine requests. |
| [tests/phase3Boundaries.test.ts](../tests/phase3Boundaries.test.ts) | Intent import boundary and validation variant presentation/session isolation. |
| [tests/poweredPsm.test.ts](../tests/poweredPsm.test.ts) | Actual capability/work assertions replace generic controlAuthority and free-energy assumptions. |
| [tests/profiles.test.ts](../tests/profiles.test.ts) | Compare normal flight tuning rather than removed generic PSM rates. |
| [tests/speedLimits.test.ts](../tests/speedLimits.test.ts) | Retain overspeed/dive/session/replay safety; exact instant-thrust ceilings move to report. |
| [tests/stall.test.ts](../tests/stall.test.ts) | Zero actual-thrust seed and scalar-gain-aware actual actuator moment assertion. |
| [tests/su57Rig.test.ts](../tests/su57Rig.test.ts) | Actuator-angle API fixture; real rig/exhaust behavior remains checked. |
| [tests/thrustVectoring.test.ts](../tests/thrustVectoring.test.ts) | Phase-free actuator commands, gain-scaled actual torque, explicit zero-thrust seed and aero-first lifecycle. |
| [vitest.bench.config.ts](../vitest.bench.config.ts) | 30-second benchmark timeout for larger diagnostic traces; feel still does not fail CI. |

## 2. Engine architecture

`W/S + Shift + base-drag trim → requestedPower → exponential spool → enginePower → actualThrust`.
`enginePower` is the retained public **actualPower** field, normalized by the dry thrust
limit; afterburner can take it above 1. `engine.requestedPower` and
`engine.actualThrust` are explicit. Spool-up/down responses are 4/s and 6/s, using
`1 - exp(-response * dt)` at the existing fixed 120 Hz step. Rig/exhaust already read
actual `enginePower`; no renderer invents thrust. Burner fields remain in
`maneuver` for presentation compatibility, but `engine.stepBurner` exclusively updates
the resource, lock and recharge state.

The governor requests `flight.drag * speed²` plus player drive/burner demand within
powered limits. It never reads alpha/beta drag, separation drag, airbrake loss or
nozzle deflection. Brake/overspeed deceleration is a separate output. Requests are
not speed corrections applied directly to velocity. At identical 100 m/s seeds,
0° and 80° incidence both request **0.07 dry-power units** without W/Shift; actual
thrust is equal too (the inherited spawn spool is still decaying toward that request).

## 3. Authority architecture

`PilotCommand → permitted body-rate demand → drive request → computeBudget → allocate(participation=0) → nozzle solve → actuator → actual force/moment`.

- Physical aero is `q * airflow confidence * (1-separation) * authored surface acceleration`.
  It has no minimum floor and reads no player command.
- TVC command capacity has positive/negative bounds. The sign is selected after demand;
  the capability calculation itself receives only flow, separation, actual thrust and profile.
- Floor tuning is fixed per airframe, independent of engine, burner, intent and limiter.
  Available floor is `max(0, floor.acceleration - physicalAero - signedTvcCapacity)`.
  Floor headroom includes reserved real authority and cannot drive its rate above `maxRate`.
- Runtime passes zero participation. Aero is reserved first, TVC next, then the floor gap;
  unsatisfied drive remains `unmet`. There is no early-TVC blend or participation profile field.

The existing first-order rate servo is split into **drive** (`target * exponential/dt`)
and **dissipation** (`-rate * exponential/dt`). Only drive is allocated; damping cannot
increase rate magnitude. This preserves attached-flight response when authority is
sufficient and prevents a held stick from sustaining inherited high rates after aero
and TVC capability disappear. Neutral damping still fades with observed high incidence.
`AllocationRecord.request` is the signed **drive request**, not net angular acceleration.

Three independent TVC ceilings cannot be treated as three actuators: two nozzle angles
are solved with deterministic constrained least squares. Reservations are reconciled
against reachable target torque; unreachable shares are returned to `unmet`. Coupled
moments and actuator lag are separately reported rather than hidden as extra allocation.

Every axis satisfies `request = aero + tvc + floor + unmet`. Actual rate change is:

```
aero + floor + actualTvc + stabilityDamping + naturalRestoring + naturalDamping
actualTvc = allocatedTvc + coupledTarget + actuatorLag
```

The second equation is diagnostic decomposition. **Allocated TVC is never added again**
on top of actual torque. The overlay shows all of these sources, requested/actual
nozzles, actual/requested engine output, directional capacity, floor rate ceiling and
path-cap activity. Budget/readouts use the same integrated tick; airflow labels retain
clearly separate end-of-step observations.

## 4. TVC geometry results

Representative thrust is acceleration F/m in m/s². Capacity below is rad/s² and
includes the selected scalar **gain=2** on every angular axis. `+pitch` is nose-up;
`−pitch magnitude` makes the E1 asymmetry explicit. Yaw/roll share nozzle travel;
these maxima are not simultaneously attainable.

| Aircraft | Thrust | +Pitch | −Pitch magnitude | Commanded yaw | Roll |
|---|---:|---:|---:|---:|---:|
| f22 | 3.5 | 0.37106 | 0.39296 | 0.00000 | 0.13002 |
| f22 | 27.5 | 2.91548 | 3.08752 | 0.00000 | 1.02160 |
| f22 | 50 | 5.30088 | 5.61367 | 0.00000 | 1.85745 |
| f22 | 65 | 6.89115 | 7.29777 | 0.00000 | 2.41469 |
| su57 | 3.5 | 0.33147 | 0.34293 | 0.19468 | 0.18490 |
| su57 | 27.5 | 2.60438 | 2.69443 | 1.52963 | 1.45276 |
| su57 | 50 | 4.73523 | 4.89897 | 2.78115 | 2.64138 |
| su57 | 65 | 6.15580 | 6.36866 | 3.61550 | 3.43380 |

3.5 represents trim at 100 m/s; 27.5 is representative high dry request; 50 is the
configured dry limit; 65 is representative burner thrust. Actual per-aircraft spool
and W request differ slightly. F-22 commanded yaw stays **zero**. Asymmetric nozzle
angles can still cause coupled axial-thrust yaw: its full-travel bound at thrust 65,
gain 2 is **0.063866 rad/s²**, below 1% of nose-up pitch. This is measured/bounded
physics, never an invented yaw command capability. Su-57 has meaningful canted yaw/roll.

`geometryCapacity()` and `thrustForces()` retain gain=1 archive-reference semantics.
`tvcMomentCapacity()` uses full-travel geometry plus actual thrust/gain for command
capacity and analytic extrema for all intermediate actual-angle moment bounds.
The current actual angle never determines available capacity.

## 5. Generic powered PSM authority removed

Removed `maneuver.pitchRate`, `maneuver.yawRate`, `maneuver.rollRate`,
`maneuver.fullControlThrust`, `ManeuverState.controlAuthority`, poweredBlend rate
replacement, phase/speed/AoA `tvcAuthority`, authority-response tuning and the
“subtract requested TVC torque, add actual TVC torque” compensation pattern.
The raw input nozzle mixer is now preview-only; live nozzles originate solely from
allocated TVC drive. `stall.controlAuthority` remains a legacy **path-grip** setting,
not angular aero or powered control.

C sets debug `limiterOpen=1` on PSM-enabled profiles. It changes requested permission,
never a budget, actuator capacity or directly integrated rate. The current explicit
permission mapping uses the normal body-rate demand scaled by incidence headroom;
it is provisional control tuning, not powered capability. Larger permitted demand
can remain wholly unmet. A fixed zero-q/no-TVC rig proves C+burner cannot produce
more rotation than the same input without them. Full stick+brake+burner without C
never opens the limiter. `PilotIntent` is recorded for future use; the breakout
formula is not implemented.

## 6. Non-TVC validation

`f22-notvc` is an independent F-22 aero/profile clone with `thrustVectoring: null`.
It reuses F-22 model/rig, is absent from the production/hangar roster, is selectable
inside Playground lab settings, and is rejected for offline sessions. Its physical
aero/floor remain available; TVC budgets, allocation, actual moment and powered
capability stay zero under C, Shift and brake, including seeded fuzz.

Same 450 arcade-km/h seed, C+full pull+W+Shift+brake:

| Aircraft | Nose rotation at 3 s | At 8 s | First 180° | First 360° |
|---|---:|---:|---:|---:|
| f22 | 215.717° | 515.622° | 2.525 | 4.916666666666667 |
| su57 | 201.016° | 462.994° | 2.683333333333333 | 5.408333333333333 |
| f22-notvc | 66.249° | 131.516° | not reached | not reached |

B19's <180° at 3 seconds is met without turning it into a hard feel threshold.
The no-TVC aircraft also does not reach 180°/360° in the eight-second observation.

## 7. Low-speed path protection

Engine plus lateral control force is decomposed perpendicular to the current path.
Its angle increment is `atan(|transverse force| * dt / max(speed, 40 m/s))`, therefore
bounded by the authored denominator. It does not freeze path direction. Gravity is
integrated separately and can carry velocity through zero. The work ledger integrates
axial thrust and drag over the moving interval, including a signed engine-driven
longitudinal crossing; drag alone cannot reverse motion. The final speed guard solves
kinetic plus the actual semi-implicit altitude change against the available work.

At a 5 m/s, 90°-incidence, burner seed, the first controlled path rate is approximately
**1.644 rad/s**, versus **13.154 rad/s** without the floor; cap activity is true.
Gravity-inclusive total heading rate is reported separately (about 0.317 rad/s in
this seed). Work residuals stay non-positive within numerical tolerance. Specific
energy can increase when the engine does positive work; the invariant is not a
blanket prohibition on energy increases. Exact tail-slide seeds still develop
reverse flow and remain finite. Fast tail-slide flip time is still out of target.

## 8. Hard invariants

| Invariant | Result / scope |
|---|---|
| I1 numeric validity | PASS — finite state/rates/velocity and normalized quaternion in scenarios and low/reverse/high-incidence fuzz. |
| I2 determinism | PASS — exact 30/60/144 FPS comparisons, all 18 archived-input tracks and no-TVC replay. |
| I3 replay versions | PASS — current replay reproduces; mismatched physics/schema rejected. |
| I4 old-output equivalence | Intentionally retired for this version, with a recorded reason; no archive regeneration. |
| I5–I8 observation/natural aero | PASS — existing tests retained; I7 path blend uses its exponential bound. Debug C is an explicit step override, not automatic smoothing. |
| I9 geometry | PASS — F-22 commanded yaw zero, coupled yaw bounded; Su-57 yaw positive. Full actual-angle grid checked. |
| I10 thrust dependence | PASS — zero at zero thrust; directional capacities and moment bounds scale linearly. |
| I11 actuator limits | PASS — max travel and rate at every inspected step. |
| I12 allocation | PASS — signed conservation, no source over budget, unreachable nozzle demand returned to unmet. |
| I13 non-TVC | PASS — no powered capability/torque, including C/burner/brake fixed-flow and fuzz cases. |
| I14 floor | PASS — fixed independent tuning, deficit-only share, rate ceiling including reversals; C does not gate low-q roll floor. |
| I15 assists | PASS — servo/neutral term only dissipates existing rate; integrated contributions reconstruct once. |
| I16 boundaries | PASS — input-only intent import check and command-free capability inputs; no automatic breakout. |
| I17 governor | PASS — alpha/beta drag, separation, brake and nozzle changes do not increase same-speed power requests. |
| I18 work | PASS — per-step kinetic+potential change bounded by thrust work minus drag/braking, before external terrain collision. |
| I19 path rotation | PASS for engine/lateral transverse rotation; **signed zero-speed crossing qualification in §11**. Gravity is not capped. |

## 9. Benchmarks and calibration

Same 20 m/s, 75° pitch incidence, full separation, Q/E+W+Shift for two seconds:

| Aircraft | Peak yaw °/s | Integrated body-yaw rotation ° | Mean aero / TVC / floor / unmet yaw drive (rad/s²) |
|---|---:|---:|---|
| f22 | 6.283 | 4.382 | 0.1192 / 0.0000 / 0.1319 / 5.9195 |
| su57 | 24.938 | 30.348 | 0.1070 / 1.4895 / 0.0000 / 5.4556 |
| f22-notvc | 6.283 | 4.382 | 0.1192 / 0.0000 / 0.1319 / 5.9195 |

F-22/Su-57 peak-yaw ratio is **0.2520**, meeting B11's ≤0.5 target.

At 70 m/s, 80° incidence, pre-spooled burner plus brake, over 0.5 seconds:

| Aircraft | Actual thrust start → end | Initial pitch TVC capacity | Speed loss |
|---|---:|---:|---:|
| f22 | 64.937 → 63.536 m/s² | 6.885 rad/s² | 6.271 m/s |
| su57 | 64.879 → 62.349 m/s² | 6.144 rad/s² | 7.857 m/s |
| f22-notvc | 64.937 → 63.451 m/s² | 0.000 rad/s² | 9.051 m/s |

**Handoff:** both TVC aircraft report 0 rad/s pitch dip in this authored pull. The
metric is the pre-onset 0.2-second peak minus the minimum in the following 0.5 seconds,
clamped at zero. No-TVC reports null because no handoff occurs. This is not proof that
all handoffs are invisible; actuator slew is retained. Participation remains zero.

**Gain calibration:** gains 1, 1.5, 2, 2.5 and 3 were swept using the same closed-loop
Cobra and Kulbit pilots; archived Phase 0 samples give ~1.25 s to 90° and ~3 s to 360°
(at 0.25 s sampling). Gain 2 is retained as the conservative Phase 3 ownership baseline,
not a spectacle match. At gain 2, Cobra peaks are ~73.5°/72.5° and the dry-power pilot
never reaches 90°; burner Kulbit takes ~5.01/5.37 s. These misses remain visible.
Gain 2.5 gives ~85.0°/82.5° and 4.03/4.35 s; gain 3 reaches 90° at ~2.23/2.41 s and
360° at 3.44/3.73 s. The 0.2-second pitch response changes only modestly because aero,
spool and actuator onset dominate. No acceleration-ratio 4× shortcut was used, and
no per-axis geometry boost was introduced. Human playtest should choose between these
tradeoffs; no matching of old generic PSM output is claimed.

Reproduce with `npm run flight:bench`; detailed values and the complete sweep are in
`benchmarks/flight/out/phase3.json` and `.md`. Those generated reports are git-ignored.
The stable tables and interpretation above preserve this run's results in source control.

## 10. Regression results

- Clean Phase 2 HEAD: **29 suites / 363 tests passed**; benchmark **6 suites / 15 passed**.
  Baseline was regenerated in an isolated temporary checkout with the same installed
  dependencies/assets; the exact source commit is in `phase2-metrics.json`.
- Phase 3: **34 suites / 403 tests passed**; benchmark **8 suites / 20 passed**.
  Typecheck and production build passed. `npm run build` runs the hard test suite
  through `prebuild`, so invariant failures stop the build. Existing Vite chunk-size advisory remains.
- All original archives are unchanged. Their open-loop inputs replay at exact supported
  render rates; their old high-AoA outputs are comparison data, not current golden truth.
- Browser automation was unavailable (`CUA_REPL_ENABLED_SURFACES is required`). The
  debug overlay compiles, locale parity passes, and budgets/ledger data are tested;
  visual layout and human handling playtest remain unverified.

Selected Phase 2 → Phase 3 deltas:

| Metric | F-22 | Su-57 |
|---|---|---|
| hardTurn900 mean G | 10.6431 → 10.6845 | 10.6568 → 10.6916 |
| hardTurn900 peak incidence | 3.6559° → 3.5749° | 3.6482° → 3.5839° |
| fullStick500 peak incidence | 4.1073° → 3.9925° | 4.0784° → 3.9885° |
| release45 incidence at 0.5 s | 13.3858° → 13.3927° | 13.6387° → 13.6465° |
| sideslip60 speed loss | 32.5388 → 32.2795 arcade km/h | 34.9855 → 34.7115 arcade km/h |
| tailSlide flip within 10 s | unreached → unreached | unreached → unreached |

Obsolete assertions were identified and preserved deliberately:

1. One-second instant acceleration, two-second exact coast settling and exact no-overshoot
   powered speed limits now live in `legacySpeed.report.ts` with their original numeric
   targets. Spool changes these timings; numeric/nonfinite and lifecycle checks stay hard.
2. Legacy rate-overlay equality and generic `controlAuthority` assertions were replaced
   by actual allocation/moment/work checks. Raw signed geometry references remain intact.
3. Old F-22/Su-57 yaw-pedal completion=1 is a recorded feel target; actual legacy detector
   completion must still match its existing peak-incidence/lifecycle gate. Lack of F-22
   yaw TVC must not be hidden by synthetic torque to make the old pilot succeed.
4. Powered C5 release now reaches NORMAL at ~3.41 s / 4.41 s. An unattended recovered dive
   subsequently reaches terrain at ~25.07 s / 31.57 s. CI requires recovery **before** any
   terminal collision, finite state and bounded actuator motion throughout. It does not
   add a Phase 5 attitude-leveling autopilot to make a 40-second unattended dive immortal.

## 11. Baseline discrepancies and scope qualifications

- **E1/E3 resolved by owner:** signed nose-up/down capacities replace the ambiguous scalar
  maximum for allocation; actual coupled moments have separate bounds. F-22 yaw is zero
  as a command axis but not identically zero for asymmetric physical nozzle angles.
- **C / legacy translation conflict:** the new checklist says C is only a limiter, whereas
  the Final Baseline explicitly schedules `activeGrip/recoveryGrip/recoveryAcceleration`
  and `gravityBlend` phase removal in Phase 4. This implementation changes angular ownership
  completely but retains those translation branches. No claim of phase-free translation
  is made. Port them before enabling automatic breakout; otherwise the same incidence
  reached without C can receive different legacy path treatment.
- **I19 zero-speed wording:** bounding every velocity-heading change, including a signed
  longitudinal passage through zero, conflicts with legitimate force-driven zero crossings.
  The protected exploit is *transverse* engine/lateral rotation at tiny nonzero speed.
  Longitudinal crossings are explicitly logged as `longitudinalZeroCrossing`; they can
  reverse heading after passing zero and are not presented as capped angular rotation.
  This also fixes the discovered draft trap where opposing engine thrust erased each
  gravity step and held a powered release near 0.08175 m/s indefinitely. Drag alone may
  never reverse the path. A stronger “no engine reversal of any kind” reading of I19
  would need a separate design decision, not a silent invariant claim.
- The original I18 formula's thrust term has inconsistent units if read literally as
  `thrust · velocityUnit * dt`. The implemented ledger uses work per mass, force/m times
  integrated displacement, and compares it with `v²/2 + g*h`.
- Allocation request means drive after separating the dissipative first-order servo
  term. The full torque ledger, not the allocation row alone, reconstructs net rotation.
- Phase 2 B9 owner playtest and the provisional 20–30° band remain pending. B10 still misses
  its flip-time target. Gain, controller permission mapping and the 40 m/s denominator
  are authored arcade tuning, not measured aircraft specifications or playtest approval.

## 12. Review focus

No independent Claude review was run, as requested. If reviewed later, prioritize:

1. Two-actuator least-squares reachability, directional sign selection and the reconciliation
   of TVC reservations versus coupled target moments and actual actuator lag.
2. The first-order servo's drive/damping split: no positive authority outside allocation,
   no persistent unpowered rate under held input, and neutral release behavior.
3. Translation work integration, zero-crossing semantics and the scope of the transverse
   cap, especially the explicitly qualified literal reading of I19.
4. C's remaining legacy translation branches before Phase 4 automatic permission, and the
   inherited Phase 2 playtest/B9/B10 gaps. Do not infer a completed recovery-assist design.
5. Gain=2 versus the recorded 2.5/3 alternatives, post-stall yaw/roll coupling, and handoff
   in live play. No early participation tuning should be added solely to match old traces.
6. Flight Lab layout and scrollability on real viewport sizes; automated browser QA was unavailable.

No automatic breakout, Brake+Shift auto-entry, High-G merge/remap, Q/E ramp, input-frame
migration, full recovery assist, maneuver detector, or TVC participation blending was added.
