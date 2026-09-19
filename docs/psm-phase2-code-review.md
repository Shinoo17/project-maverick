# Phase 2 — Natural aerodynamics: independent code review

Reviewed against `docs/psm-implementation-plan.md` (Final Baseline Rev. 3), which was treated as
the sole authority. `docs/psm-architecture-review.md` and older PSM discussion were not used.
Scope: the working-tree Phase 2 change set (26 modified files, 12 new files) plus
`docs/psm-phase2-review.md` as the implementer's own account.

Verification performed: read the full plan and every changed file; ran `npx tsc -b` (clean),
`npm test` (26 suites / 343 tests pass), `npm run flight:bench` (6 report suites / 15 pass);
inspected `out/report.md` and all four `out/legacy-*.json` files; and ran three throwaway
closed-loop probes under `benchmarks/tmp/` to characterise the departure behaviour.

**Disclosure:** to isolate the root cause of Finding 1 I temporarily edited
`src/game/flight/stepFlight.ts:36` (one expression), re-ran the probe and the full suite, then
restored the file from a backup and deleted the temporary probe files. `git status` matches the
pre-review state; no review change remains in the tree.

---

## Verdict

One blocking defect, one owner decision, three items to fix before merge, and ten items to accept
with disclosure. The core aerodynamics module is well built: the sign conventions are correct and
documented, the import-boundary test is a genuine architectural guard, profile validation is
thorough, determinism and replay behaviour are preserved, and the legacy feel fixtures were
migrated faithfully rather than deleted. The blocking defect is not in `aerodynamics.ts`; it is in
how `stepFlight.ts` fades the neutral controller.

---

## 1. BLOCKING — a released post-stall maneuver can leave the aircraft in a permanent tumble

### Reproduction

F-22 or Su-57, spawn at altitude, `velocity.x = 105`, hold `psmArm` + `pitch: 1` + `speedAdjust: 1`
for 5 s, then release to neutral stick with throttle still held. Sampled every 2 s for the next 40 s:

```
f22 after PSM: phase active rates {"pitch":2.599} speed 5.5
f22 t=2s  inc=0.1   v=2.2  pitchRate=2.903 sep=1.000 phase=recovery y=4049
f22 t=10s inc=86.7  v=0.1  pitchRate=2.896 sep=1.000 phase=recovery y=4038
f22 t=20s inc=37.5  v=5.9  pitchRate=2.885 sep=1.000 phase=recovery y=4024
f22 t=40s inc=50.0  v=4.7  pitchRate=2.857 sep=1.000 phase=recovery y=3996
```

The pitch rate decays from 2.903 to 2.857 rad/s in 38 seconds — roughly 166 °/s of continuous
rotation with no path to recovery. `maneuver.phase` never leaves `recovery`, so `maneuver.completed`
never increments. Su-57 behaves the same. Descent over those 38 s is about 1.4 m/s, so the aircraft
also effectively hovers (see Finding 1c).

### Root cause

Two changes in this diff combine to remove *every* source of body-rate damping at low airspeed.

1. `stepFlight.ts:36` — `const neutralWeight = (1 - envelope.highAoa) * (1 - envelope.separation)`.
   `envelope.separation` is `stall.severity`, whose target is
   `max(lowSpeed, incidence)` and whose `lowSpeed` term is
   `1 - smoothstep(arcadeSpeed, 300, 350)`. At airspeed near zero `lowSpeed` is exactly 1, so
   `separation → 1` and `neutralWeight → 0` regardless of incidence.
2. `stepFlight.ts:54` — the zero-target branch is now
   `1 - Math.exp(-p.neutralResponse * neutralWeight * dt)` with no floor. Previously the same branch
   floored at `rateResponse` (5/s) through
   `rateResponse + (normal - rateResponse) * grip`, and for the F-22 the
   `neutralDampingDuringPsm` path was unconditional at 9/s. That floor is gone on all three axes.

Natural damping cannot substitute, because `dampingCoefficient = q * (...)` and
`q = dynamicPressure * confidence` are both zero at airspeed ≈ 0. So at low speed the controller
damper is zero, aero damping is zero, restoring is zero, and nothing else touches `state.rates`.

The plan specifies exactly one fade factor — §3.2 *Neutral stick*: "ต้องจาง `neutralResponse` ด้วย
`(1 − highAoa)`". That single factor is safe precisely because `highAoa` is multiplied by
`airflow.confidence` in `envelope.ts:32`, so it collapses to 0 near rest and the damper returns to
full strength exactly where aerodynamic authority disappears. `separation` has no such gate; its
low-speed term rises to 1 where the damper is most needed. The `(1 - separation)` factor is an
unapproved addition and is the direct cause.

### Confirmation

Replacing line 36 with `const neutralWeight = (1 - envelope.highAoa)` and re-running the same probe:

```
f22 t=2s  inc=96.6 v=12.70 pitchRate=1.724 sep=1.000 phase=recovery y=4041
f22 t=4s  inc=8.9  v=41.0  pitchRate=0.004 sep=1.000 phase=recovery y=4041
f22 t=6s  inc=1.5  v=89.0  pitchRate=0.004 sep=0.366 phase=normal   y=4027
```

The rotation stops in about 4 s and the aircraft is back to `normal` at about 6 s. Su-57 recovers
the same way. `npm test` still reports 26 suites / 343 tests passing with that factor removed, and
`tsc -b` stays clean.

### Why the suite did not catch it

Two facts, both worth acting on:

- 343/343 tests pass both with and without the `(1 - separation)` factor, so no test in `tests/`
  constrains rate decay when no aerodynamic authority exists. There is no invariant of the form
  "with neutral stick and no authority, `|rates|` is non-increasing and tends to zero".
- The two fixtures that *do* fail on this behaviour were relocated to report-only files in this same
  change set. `out/legacy-poweredPsm.json` records `phase = 'recovery'` where `'normal'` was
  expected for both aircraft, and `out/legacy-maneuvers.json` records `completed = 0` where `1` was
  expected and `|rates.pitch| = 1.331` where `< 0.2` was expected. Those are not obsolete feel
  numbers; they are the signature of this defect, and the migration turned them into informational
  rows. Compare them with the benign relocated rows (`severity = 0.9933` vs `1`,
  `severity = 0.0025` vs `0`), which genuinely are the exponential-asymptote change the report
  describes.

### Scope of the trigger

The tumble needs a residual body rate of roughly 1 rad/s or more present when airspeed reaches
near zero. Today the only source of that is the powered PSM rate envelope behind `psmArm` (C):

- A no-C zoom departure (nose 80° up, 60 m/s, full aft stick for 4 s, then neutral) never exceeds
  0.30 rad/s and recovers normally — it accelerates away and reaches 200 m/s.
- A directly seeded 0.8 or 2.9 rad/s pitch rate at 0.5 m/s airspeed with no C also escapes,
  because the nose happens to start aligned with velocity and thrust accelerates the aircraft out
  before the rotation matters.

So C is currently the only practical entry, but C remains a shipped, usable control through Phase 5
(plan §4: Phase 2 "C: gameplay เดิม"; gates are removed only in Phase 6). A shipped key that can put
the aircraft in an unrecoverable state is a Phase 2 defect, not a Phase 6 cleanup.

### 1c. Secondary: the energy clamp destroys the fall while the nose rotates

In the failing probe the aircraft descends ~1.4 m/s over 38 s at 4000 m with throttle held —
nowhere near free fall. The mechanism is the pre-existing
`velocity.setLength(poweredSpeed)` guard at `stepFlight.ts:137`: with the nose sweeping through
360° every 2.2 s, `force.dot(path)` swings strongly negative for part of each cycle, `poweredSpeed`
clamps to 0, and the speed gravity added on previous substeps is discarded. Thrust also integrates
to approximately zero over a full nose rotation, so the aircraft cannot accelerate out.

The new gravity-overshoot correction itself is sound. I checked it algebraically — the overshoot is
non-zero only when the gravity-free speed also clamps to zero, and it equals `-g·path.y·dt`, so
drag alone can never reverse the path — and confirmed it empirically: with a steady 80° nose-up
attitude and zero velocity, the aircraft falls and accelerates correctly without throttle and
climbs correctly with throttle. The hover is specific to the rotating case and therefore resolves
with Finding 1. The underlying clamp behaviour belongs with the Phase 3 energy/path-rate work
(§6 D12, I19); it does not need a Phase 2 change, but it should not be described as fixed either.

### Suggested fix

Drop `(1 - envelope.separation)` from `neutralWeight`, matching the plan's single `(1 - highAoa)`
factor, and add a hard invariant: from any seeded body rate with neutral stick and no authority
(`airspeed → 0`), `|rates|` must be non-increasing and fall below a small epsilon within a bounded
time. If the separation factor is wanted for feel reasons, it needs a floor that survives
`airspeed → 0`, and the owner should approve the deviation explicitly.

---

## 2. OWNER DECISION — stall thresholds were silently redefined, making M4's independence vacuous

`separationTarget` now evaluates `smoothstep(flow.incidenceDeg, profile.stall.recoveryAoaDeg,
profile.stall.criticalAoaDeg)`. `flow.incidenceDeg` is unsigned nose/velocity incidence including
sideslip; the old code used `Math.abs(stall.aoaDeg)`, signed pitch-plane alpha. `profileTypes.ts`
was edited to match ("Full-separation unsigned incidence (degrees), including sideslip/reverse
flow"), so the change is deliberate, and the implementer discloses it in §8.3.

Two problems.

First, the Phase 2 section of the plan states the opposite: "stall retains its separate pitch-alpha
thresholds." This is a change to a decision the plan makes explicitly, so it needs owner sign-off,
not reviewer acceptance.

Second, and more important than the text mismatch: both bands now measure the same physical
quantity with identical numbers. `stall.recoveryAoaDeg / criticalAoaDeg = 20 / 30` and
`aero.alphaNormalDeg / alphaCriticalDeg = 20 / 30`, and after this change both are thresholds on
unsigned incidence. M4's requirement that the aero band be independent of the stall band and never
derived from it is satisfied only as a coincidence of equal literals. The consequence is visible in
`neutralWeight = (1 - highAoa) * (1 - separation)`: above 30° incidence both factors are driven to
zero by the same measurement of the same angle. That double-count is part of Finding 1.

Observable side effect: a pure 90° sideslip at 700 arcade km/h now drives separation toward 1 where
it previously stayed at 0 (`tests/stall.test.ts:50` and `tests/envelope.test.ts:21` were both
flipped from `'none'` to `'aoa'` to encode this). That is defensible arcade physics, but it is a
handling change, not a refactor.

Either authorise the redefinition and re-author one of the two bands so they are genuinely
different numbers with different roles, or keep separation on `|alphaDeg|` as the plan says.

---

## 3. Fix before merge

**3.1 `goldenTracks.test.ts:13` pins the current version string.**
`expect(flightProfileVersion).toBe('p3-natural-aero-2')` replaces the §0.5 guard whose whole purpose
was to fail with an actionable message — "deliberately regenerate goldens or retire I4 in the
physics-change PR; never silently skip" — on any version bump. As written, Phase 3's bump will fail
all 18 golden tests with no guidance, and there is no longer any guard at all: the assertion says
"the version is what it is today". Prefer keeping the retirement comment but asserting the relation,
e.g. `expect(flightProfileVersion).not.toBe(golden.recordedWithProfileVersion)`, and put the literal
archive version in one place rather than inside the per-scenario loop.

**3.2 Phase-2 benchmark targets from §5.2 are not wired.**
`benchmarks/flight/targets.ts` is unchanged this round, so:

- B10 `tailSlide.flipTime` has a target of ≤ 4 s starting Phase 2. The metric exists but has no
  target entry, so `out/report.md` prints `— report` instead of `⚠ out`. The out-of-target fact
  exists only in the implementer's prose (§8.6); §5.0 requires the report to show it.
- B20 `sideslip60.speedLoss1s` has a Phase-2 target ("> golden + 30%"). Measured 48.16 / 52.22
  against a Phase 1 baseline of 2.39, so it passes comfortably — but the target is not encoded, so
  a future regression will not show `⚠ out`.
- B8 `recovery.naturalDuringDelay` (Phase 2 start, target "> 0") has no metric. A literal delayed-
  assist measurement needs Phase 5, which the implementer states, but the "incidence changes during
  the delay window" part is measurable now from `release45`.
- Metric IDs `baseline.tailSlide.flipTime` and `baseline.sideslip60.speedLoss1s` do not carry their
  plan IDs (B10, B20), which makes the report harder to reconcile with §5.2.

**3.3 The Phase 2 playtest has not been run.**
The Phase 2 section requires tuning the provisional 20°/30° band per aircraft through Phase 2
playtest, and §5.2 says B9's target range is set from that playtest. Neither is done — the
implementer states no browser or manual handling playtest was performed, and `targets.ts` still
carries the comment "B9 has no feel baseline until the Phase 2 playtest". Phase 2 therefore cannot
be signed off as complete against §5.2 even once Finding 1 is fixed. This is a scheduling fact for
the owner, not a code defect.

---

## 4. Accept with disclosure

**4.1 B15 reversal collapse.** Velocity-heading change on `reversal180C` falls from 161.78° to 7.41°
(F-22) and 153.24° to 104.0° (Su-57); altitude loss falls from 115.9 m to 0.62 m and 200.7 m to 0 m.
Report-only per §5.2 and disclosed in §6 of the implementer's report, so it is not a policy
violation. But the meaning is worth stating plainly: a released post-stall reversal no longer
redirects the velocity vector, which is the payoff the whole PSM feature exists for. The cause is
that natural restoring now realigns the nose with velocity faster than the legacy recovery-grip path
alignment can pull velocity toward the nose — and porting that grip from `phase` to `separation` is
scheduled for Phase 4 (§6 D1). The owner should decide consciously whether to carry this gap for two
phases or soften the restoring curves now. Do not close it by increasing maneuver authority.

**4.2 Sustained rate ceiling is reduced at high q.** `hardTurn900` mean G drops 9.6% / 9.5%. The
mechanism is correct and is now encoded in `tests/flightInstrumentation.test.ts`: the fixed-flow
equilibrium is `ceiling · cs / (cs + ds)` with `cs = 1 - exp(-rateResponse·dt)` and
`ds = 1 - exp(-c·dt)`. Because `dynamicPressure` is unclamped, `c = q · attached` grows as speed²:
about 2% rate loss at 90 m/s but about 18% at 300 m/s. That is a real handling change at the top of
the envelope and needs human feel review; also note that the pitch mode at 300 m/s has damping ratio
around 0.15, so a lightly damped pitch bob is expected there.

**4.3 `flightForces` lives on `AircraftState`.** `WorldState.ts` is not in the plan's Phase 2 file
list, and putting a per-substep diagnostic ledger on simulation state means it enters every
snapshot, every replay comparison and every `assertAircraftValid` walk, and costs roughly ten extra
object allocations per substep per aircraft at 120 Hz (`ratesBefore`, `beforeTvc`, `controller`,
`legacyNeutralDamping`, `tvcContribution`, `damping`, plus `restoring`/`dampingCoefficient`/`damping`
inside `naturalAerodynamics` and the record itself). The content is genuinely useful and the
"diagnostics never feed physics" discipline holds. Consider returning it from `stepFlight` or gating
it behind a debug flag before Phase 3 adds `AllocationRecord` next to it.

**4.4 `reportExpect` downgrades hard assertions.** `legacyFeel.ts` wraps every assertion in the
migrated fixtures, including `expect(s.alive).toBe(true)` inside each `fly` loop and
`Number.isFinite(speedOf(s))`. Those are I1-class checks, not feel. Keep them as real tests in
`tests/` and report only the numeric feel expectations.

**4.5 A relocated fixture took an invariant with it.** The deleted
`flightHandling` backward-flight test asserted
`expect(speedOf(state)).toBeLessThanOrEqual(lastSpeed + 1e-8)` every substep — unpowered flight must
not gain energy. That is an I18-class invariant, and it left `tests/` along with the feel
assertions about nose position. Its new value is also informative: `velocity.x` is now +162 instead
of < −150, i.e. natural aero flips the aircraft out of the 180° reverse-flow equilibrium, which is
the intended AD7 behaviour. Keep the monotonicity assertion in `tests/`.

**4.6 `naturalRateStep` is called with the pre-controller rate.** `stepFlight.ts:89` passes
`ratesBefore`, but the result is applied to rates that the controller and TVC have already changed.
The doc comment on `naturalRateStep` claims the exact-exponential form "avoids an explicit-Euler
sign flip at large q"; that guarantee holds only for the rate it was given. Reaching an actual sign
flip needs `c·dt > ~2.6`, i.e. `q > 480` or roughly 2000 m/s, so this is unreachable with current
tuning — a comment-accuracy item, not a defect. Either state the guarantee against `ratesBefore`
explicitly or pass the current rate.

**4.7 `natural.damping` is computed and never used.** `naturalAerodynamics` fills a `damping` field
that `stepFlight` ignores (only `dampingCoefficient` is used, via `naturalRateStep`). Tests inspect
it, so it is not strictly dead, but it is per-substep work in the hot path for a diagnostic.

**4.8 `stall.cause` fires earlier than before.** `cause` is now `'speed'` whenever
`lowSpeed > 0`, i.e. below `recoverySpeedKph` (350 arcade km/h) rather than below `stallSpeedKph`
(300), and `'aoa'` above `recoveryAoaDeg` (20°) rather than `criticalAoaDeg` (30°). `telemetry.ts:14`
turns that into HUD text, so the stall caption appears earlier and the `hudStallRecovering` window
narrows. Presentation only, and `cause` correctly no longer selects physics — please confirm it is
intended.

**4.9 A fragile fixture in `tests/phase1Profile.test.ts`.** The test now restores `state.velocity`
after `stepFlight` so `flightInstrumentation` re-derives the pre-step ceiling. That only produces an
exact match because `ratesBefore.roll === 0` makes natural damping vanish on that axis; it also
reads post-step `stall.severity`. Prefer the approach taken in `flightInstrumentation.test.ts`:
capture the ceiling before the step and add the damping factor explicitly.

**4.10 `benchmarks/flight/README.md` is still titled "# Phase 0 flight instrumentation"** while its
body now documents Phase 2.

---

## 5. Verified correct

Recorded so these are not re-litigated:

- **Restoring signs and zeros.** `-k(incidence)·q·sin(α)·cos(β)` for pitch and `+k·q·sin(β)` for
  yaw are both correct for this observer's conventions (`alphaDeg = atan2(-body.y, body.x)`,
  `betaDeg = atan2(body.z, hypot(body.x, body.y))`), and the `cos(β)` projection correctly removes
  the undefined pitch plane at pure sideslip. Moment vanishes at 0° and 180°, with 180° an unstable
  equilibrium as AD7 requires. I6 satisfied.
- **No invented force at zero q.** `q = dynamicPressure · confidence` gates both restoring and
  damping, so nothing is generated near rest. (This is also why the damping cannot rescue
  Finding 1.)
- **I8 boundary.** `tests/aerodynamics.test.ts:139` asserts `aerodynamics.ts` imports exactly
  `./airflow` and `./profileTypes` and contains no `PilotCommand`, `AircraftState`, `maneuver.`,
  `Math.random` or `Date.`. That is a real architectural guard of the §0 rules, not a restatement.
- **Governor separation (D7 / I17).** `speed.ts` is untouched and `tests/aerodynamics.test.ts:125`
  confirms 10× alpha/beta drag plus full separation and airbrake does not change requested thrust.
- **`turnLoss × 0.55` and `psmDrag` removal.** Both gone, replaced by α/β drag applied in all
  regimes, with the profile field and its validation entry removed cleanly.
- **Determinism and replay.** 30/60/144 FPS exactness is retained on all 18 archived command tracks
  and compared against the current-physics replay; the public replay version rejection is unchanged
  and still tested; goldens were not regenerated and no tolerance was widened.
- **Profile validation.** Curve knot ordering, 0..180 span, non-negative stiffness, damping regimes,
  drag coefficients and `neutralRollResponse` are all validated with negative cases, and nested
  per-aircraft mutation isolation is tested.
- **`neutralRollResponse` migration.** 9/s for F-22 and 5/s for Su-57 reproduce each airframe's
  previous attached-flight roll release without a PSM flag.
- **The `speedLimits` fixture bug is real.** `Object.assign(state.orientation, quaternion)` copies
  Three's private `_x/_y/_z/_w` and left the dive test flying level; the explicit component copy is
  the right fix and the overspeed assertion still passes.
- **Legacy fixture migration is faithful.** The relocated fixtures are copied with their original
  expectation values intact, and the out-of-target rows are dominated by the expected
  `severity == 0/1` deadline changes. Findings 4.4 and 4.5 are about which assertions should have
  stayed hard, not about the fidelity of the migration.

---

## 6. Recommended order of work

1. Fix Finding 1 (drop `(1 - separation)`), add the missing rate-decay invariant, and restore the
   relocated `phase`/`completed`/`alive`/finiteness assertions as hard tests so the defect cannot
   return as an informational row.
2. Get the owner's answer on Finding 2 before any further tuning, since the fade band and the
   separation band currently share both semantics and numbers.
3. Fix 3.1 and 3.2 (version guard, missing targets/IDs) — small, mechanical.
4. Re-run `npm run flight:bench` and re-examine B15 and `hardTurn900` after Finding 1 is fixed;
   both are likely to move, and 4.1 should be decided on post-fix numbers.
5. Then run the Phase 2 playtest (3.3) and set B9's target from it.

---

# Round 2 — verification of the review response

Reviewed `docs/psm-phase2-review-fixes.md` against the working tree at physics version
`p3-natural-aero-2.1`. Everything below was re-derived from the code and from fresh runs, not read
off the response document.

Independent validation run: `npx tsc -b` clean; `npm test` 29 suites / 363 tests pass;
`npm run flight:bench` 6 suites / 15 pass; `git status benchmarks/flight/golden` empty, so no
archive was regenerated. I also re-ran the original defect reproduction and two longer probes in a
temporary `benchmarks/tmp/` directory, since deleted. No source file was modified in this round.

## Blocking and decision items — both resolved

**Finding 1 — fixed, verified with the original reproduction.** `stepFlight.ts:38` is now
`const neutralWeight = 1 - envelope.highAoa`, matching the plan's single factor. Re-running the exact
probe from round 1 (105 m/s at 4000 m, C + `pitch: 1` + W for 5 s, then neutral axes with W held):

```
f22 after C5: rates {"pitch":2.599} v 5.48
f22 t=4s  inc=8.9 v=41.01  rate=0.00383 sep=1.000 phase=recovery done=0
f22 t=8s  inc=0.1 v=136.45 rate=0.00055 sep=0.069 phase=normal   done=1
f22 t=40s inc=0.0 v=200.04 rate=0.00000 sep=0.000 phase=normal   done=1
```

The 2.9 rad/s sustained tumble and the 1.4 m/s hover are both gone; `maneuver.completed` reaches 1.
Su-57 behaves the same. The new `tests/invariants/neutralRelease.test.ts` is a correctly written
invariant: the settling bound is `Math.log(3 / epsilon) / min(response)` derived from the profile,
the per-step assertion is exact contraction by `exp(-response · dt)`, `peakAlpha > 70` is justified
as the pre-existing completion gate rather than a new target, and the 14 s / 40 s figures are trace
durations, not thresholds. The fixed-flow rig asserts `confidence === 0`, which is the worst case for
this defect (`neutralWeight` exactly 1), so the coverage is in the right place.

**Finding 2 — fixed as option 1, and the double count is gone.** `separationTarget` now uses
`Math.abs(flow.alphaDeg)` while `interpretEnvelope` keeps unsigned `incidenceDeg`, the
`profileTypes.ts` field documentation is back to pitch-plane wording, and the pure-sideslip
expectations in `tests/stall.test.ts` and `tests/envelope.test.ts` are back to `'none'` / severity 0.
Reverse flow still separates as intended: `alphaDeg = atan2(-body.y, body.x)` returns ±180 whenever
`body.x < 0` regardless of `body.z`, so tail slide and post-Kulbit reverse flow reach severity 1.
The β-independence test I asked for exists (`tests/envelope.test.ts`, "keeps pitch-alpha separation
unchanged when only sideslip changes"), and `tests/envelope.test.ts` also asserts that retuning the
stall band alone cannot move any envelope factor. Because `neutralWeight` is now a single
`1 - highAoa`, the pitch-plane double count I flagged as surviving option 1 does not arise at all.

## Fix-before-merge items

**3.1 — fixed.** `benchmarks/flight/goldenPolicy.ts` replaces the pinned literal with a
version-scoped policy: equal versions require output equivalence, a version listed in `retiredI4`
allows archived-input comparison, and anything else throws with the actionable "regenerate goldens
or retire I4 for this version in goldenPolicy.ts with a review reason" message. A future bump now
fails with instructions instead of an opaque string mismatch, and the deliberate action is a
one-line policy entry. One small cleanup: `retiredI4` still carries an entry for
`p3-natural-aero-2`, the defective draft that was never released. Keeping it means a rollback to that
version would pass the policy silently; consider dropping it.

**3.2 — fixed.** `B8.recovery.naturalDuringDelay` (`> 0`, with the 0.2 s observation window named as
a benchmark construct rather than a Phase 5 delay), `B10.tailSlide.flipTime` (`≤ 4 s`, and `null`
correctly yields `⚠ out`) and `B20.sideslip60.speedLoss1s` (per-aircraft archived baseline × 1.3
with a strict lower bound, resolved through `benchmarkTarget` rather than a copied constant) are all
wired, and `out/report.md` now shows `B10 … ⚠ out`. B9 renders as `pending playtest` and
`phase2Playtest.status` is exposed, which is a better outcome than the report-only treatment I asked
for. `tests/flightBenchmarks.test.ts` tests the wiring — including equality and null behaviour —
without putting feel thresholds in CI.

**3.3 — correctly left open.** No playtest was run, B9 ranges and the 20–30° fade band are
unmodified, and the response states plainly that Phase 2 must not be marked complete on the strength
of passing tests. The owner checklist at the end of the response is usable as written.

## Accepted-with-disclosure items

4.4, 4.5, 4.6, 4.9 and 4.10 are all genuinely fixed, and I verified each: `reportExpect` now takes a
`number`, throws on nonfinite input and rethrows anything that is not an `AssertionError`;
`stepLegacyFlight` validates state and `alive` after every integration; the relocated monotonic-speed
check is back in CI for its exact fixture alongside a kinetic-plus-potential energy bound; the
`naturalRateStep` comment no longer overclaims; the `phase1Profile` fixture now seeds a nonzero roll
rate, observes the prepared pre-step separation and adds the damping term explicitly instead of
mutating velocity after integration; the README title is current. The `out/legacy-*.json` rows
confirm the effect — the `phase = 'recovery'` row that was the defect's signature is gone, and what
remains is the expected `severity` asymptote family plus honest feel misses.

4.1, 4.2, 4.3, 4.7 and 4.8 are deferred or retained with reasons I accept as stated.

## New in round 2

**N1 — B10 misses by roughly 20×, and the mechanism is identifiable.** The response records B10 as
out of target and states that no tail-slide torque was added, which is the right discipline, but it
does not attribute the cause, and "does not drop below the horizon in the 30 s observation"
understates it. Extending the F-22 tail slide to 120 s:

```
t=20s  noseY=+0.324 vy=-0.06 v=28.46 inc=19.0 sep=1.000 y=2566
t=40s  noseY=+0.238 vy=-2.45 v=29.98 inc=18.5 sep=1.000 y=2534
t=80s  noseY=-0.006 vy=-9.57 v=51.38 inc=10.4 sep=1.000 y=2334
t=100s noseY=-0.090 vy=-6.13 v=67.98 inc= 0.0 sep=0.002 y=2162
```

The nose crosses the horizon at about 80 s and the flow reattaches at about 100 s, against a 4 s
target. Between 20 s and 60 s the aircraft holds a quasi-stable hanging descent: about 28 m/s,
roughly 19° alpha, about 1 m/s of sink. The cause is the legacy path-alignment lift, not the new
aero layer. `normalLateral` requests `speed · pathResponse · angle` ≈ 27 × 4 × 0.33 ≈ 38 m/s² and is
clamped to `normalLimit · surfaceControl` = 145 × 0.311 × 0.25 ≈ 11 m/s², about 1.15 g — enough to
cancel gravity at 28 m/s, because `authority` floors at 0.12 and `pathResponse` carries no q term.
Phase 2's restoring did not create that lift; it made the alpha steady, which turned a transient
into an equilibrium.

Two consequences worth recording. This is not a regression against Phase 1, whose tail slide also
never flipped inside its 10 s window; the draft's 16.1 s flip was produced by the tumble sweeping
the nose through the horizon, so it was never a better result. And B10 cannot be met before the
Phase 3 arcade-floor/allocation work and the Phase 4 grip port (§3.2, §6 D1, D6) without inventing
tuning, so leaving it out of target is correct. Please record that attribution in the response
document in place of "no fast-tail-slide torque was introduced", and add it to playtest item 4 so
the owner evaluates a known mechanism rather than an unexplained miss.

**N2 — the reversal now costs more and delivers less.** B15 improved from the draft but is still far
from Phase 1, and the energy side moved the other way: F-22 heading change 18.539° versus 161.784° at
Phase 1, with altitude loss 229.017 m versus 115.895 m. So the maneuver currently spends about twice
the altitude to redirect about a ninth of the heading. The response covers the heading half of this
in 4.1; the altitude half deserves the same visibility, because "costs more and achieves less" is a
sharper playtest question than either number alone.

**N3 — minor: a unit test writes into the benchmark output directory.**
`tests/legacyBenchmarkSafety.test.ts` calls `reportExpect('matcher-safety')`, whose `afterAll`
creates `benchmarks/flight/out/` and writes `legacy-matcher-safety.json` during `npm test`. Harmless
(the directory is ignored) but it couples the test suite to benchmark output. Injecting the row sink,
or exercising the matcher without the writer, would keep `npm test` free of file output.

## Round 2 verdict

The blocking defect is fixed and independently reproduced as fixed; the threshold contract now
matches Rev. 3 with a test that will catch future drift; the version policy and benchmark wiring are
better than what I asked for. Remaining work before Phase 2 can be signed off is the owner playtest
(3.3) plus the two attribution items above (N1, N2) — neither of which is a code change. N3 and the
stale `p3-natural-aero-2` policy entry are optional cleanups.
