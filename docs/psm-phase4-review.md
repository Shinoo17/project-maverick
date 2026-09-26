> **Superseded:** This is the historical version-1 review. P4-1 and P4-2 are closed; see [implementation report §14](psm-phase4-implementation.md#14-review-resolution--version-2) and [§15](psm-phase4-implementation.md#15-second-review-follow-up) for resolutions and current validation. The counts and findings below describe the earlier snapshot.

# Phase 4 Review

CRITICAL: 0
MAJOR: 2
MINOR: 11

Reviewed against [psm-implementation-plan.md](psm-implementation-plan.md) (Rev. 3) and [psm-phase4-implementation.md](psm-phase4-implementation.md), with the working tree at `feat/psm-phase-0-instrumentation` treated as the source of truth. Physics version `p4-automatic-envelope-1`.

Verification performed during this review, not taken from the implementation report:

- `npx tsc -b` — passed.
- `npm test` — 36 files, 494 tests passed.
- `npm run flight:bench` — 10 files, 22 tests passed; `benchmarks/flight/out/phase4.md` regenerated and matches every number quoted in the implementation report.
- Four throwaway probe fixtures (since deleted) were used to measure runtime behaviour directly rather than infer it from structure. Their results are quoted in the findings below.

---

## Findings

### P4-1 / MAJOR / The saturation gate `S` is saturated at 1 across the entire flight envelope

**Files**

- [controller.ts:20-23](../src/game/flight/controller.ts#L20-L23) — `fullRatePermission`, `requestedTurn`, `saturationRatio`
- [controller.ts:16](../src/game/flight/controller.ts#L16) — `closedTurnBudget` now includes `surfaceControl`
- [intent.ts:19](../src/game/flight/intent.ts#L19) — `smooth(requestedToLimitedRate, 1, 1.6)`
- [envelope.ts:30, 37, 38](../src/game/flight/envelope.ts#L30) — `D * S` as `demandGate`, and `D * S * (1 - E)` as the automatic G term

**Observed behaviour**

`measureControlDemand` builds the saturation numerator as the raw stick request multiplied by a constant profile factor:

```ts
const fullRatePermission = Math.sqrt(profile.aero.maxControllableAlphaDeg / Math.max(profile.aero.alphaNormalDeg, 1))
const requestedTurn = Math.hypot(command.pitch * p.pitchRate, command.yaw * p.yawRate) * fullRatePermission
```

For both shipped aircraft `maxControllableAlphaDeg = 180` and `alphaNormalDeg = 20`, so `fullRatePermission` is exactly 3.0. The denominator simultaneously gained a `surfaceControl` factor (≤ 1), which shrinks it further at every `q < 1`. The smoothstep band that converts the ratio into `S` is hardcoded at `(1, 1.6)` in `intent.ts`, not per profile.

Measured `saturationRatio` for the F-22 at zero separation, straight-and-level, across the whole speed range:

| airspeed (m/s) | 20 | 40 | 60 | 83.3 | 100 | 140 | 166.7 | 200 | 259 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| ratio, full stick | 39.80 | 9.95 | 4.42 | 2.29 | 2.18 | 3.06 | 3.79 | 5.46 | 9.16 |
| `S`, full stick | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 |
| `S`, 0.7 stick | 1.000 | 1.000 | 1.000 | 1.000 | 0.961 | 1.000 | 1.000 | 1.000 | 1.000 |

The global minimum anywhere in the envelope is 0.961, at 100 m/s with 0.7 stick. Increasing separation only raises the ratio further (ratio 3.79 → 15.17 as separation goes 0 → 1 at 166.7 m/s), so `S` cannot fall in a departure either.

**Why this violates the contract**

Plan §2.2 defines `S` as "requested rate / rate achievable within the *current* limit", and AD6 states the breakout is a multi-factor intent rather than a stick threshold. As shipped, `S ≡ 1` whenever `D > 0`, so:

- `demandGate = D · S` collapses to `D`. The second gate in the approved §2.3 formula is structurally present but inoperative.
- `T`, the sustained integrator, integrates `D · S` and therefore just re-measures sustained `D`.
- `gAllowance = lerp(1, hardTurnG, D · (1 − E))` becomes pure stick magnitude against energy, which is why full-stick at 900 arcade km/h now reaches the full 1.6× hard-turn allowance with no pilot G input. B13 mean G moved 10.685 → 16.326 and speed loss 126.5 → 220.8 arcade km/h as a direct consequence.

The implementation report (§4) discloses the numerator change and its motivation — the Phase 3 numerator never saturated during the 450 km/h X+Shift entry, leaving permission at zero — but it does not record that the replacement saturates everywhere. The fix overshot: it turned a term that was always 0 into a term that is always 1.

This is not an authority leak. Nothing here creates force. It is a correctness defect in the permission model: one of the four inputs the owner approved has no effect on the output.

**Concrete runtime scenario**

A pilot at 1400 arcade km/h (259 m/s), well above the authored High-G speed window, pulls full stick with no modifier keys. `D = 1`, `S = 1`, `E = 0`, so `gAllowance` jumps to the full 1.6 and `control.highG` reaches 1.0, which also applies `highGRate` (1.4× rate target) and `highGDrag` (2× turn drag). The pilot never asked for a hard-G turn and has no way to ask for an ordinary one.

**Why the obvious fix does not work — this needs an owner decision, not a code change**

The tempting repair is to drop the constant and scale the numerator by the *current* `ratePermission` instead, which is what plan §2.2 literally specifies. Measured, that repair makes the feature disappear. With the limiter closed, `ratePermission = speedAuthority`, and a faithful `S` behaves like this on the F-22 at full stick and zero separation:

| airspeed (m/s) | 60 | 83.3 | 100 | 120 | 137 | 150 | 166.7 | 200 | 259 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| faithful `S` | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.063 | 0.290 | 0.855 | 1.000 |
| `E` | 1.000 | 0.815 | 0.403 | 0.001 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 |

`S` first becomes non-zero at roughly 145 m/s, because that is where `pitchRate` finally outruns `turnAcceleration · surfaceControl · turnRateReserve / speed`. But `E` reaches zero at 120.7 m/s, where `q = qHigh = 1.8`. **The two gates have disjoint support.** Their product is identically zero at every speed, so `intent = D · S · permission ≡ 0` and the limiter could only ever be opened by the `H · D` latch — which requires incidence already above 20°, unreachable from normal flight.

Removing the factor entirely rather than replacing it is no better: unscaled, `S` is 0.886 at 60 m/s, **0.000 across the whole 83–150 m/s band**, and rises again above 160 m/s. The 450 arcade km/h (83.3 m/s) entry sits in the dead band either way, which is precisely the failure the implementation report §4 set out to fix.

So the constant 3 is not sloppiness. It is the implementer papering over a gap in the approved formula: under the plan's own definition of `S`, the `demandGate = D · S` term and the `E` term are anti-correlated, and §2.3 cannot open the limiter at low energy with a faithful `S`.

**Recommended resolution**

This is an owner decision on the formula. Three coherent options, in my order of preference:

1. **Split the roles of `S`.** Let `S` gate only the `gAllowance` term, where it has natural support (high energy, genuinely rate-limited), and gate low-energy breakout on `D`, `E` and brake/power alone. This matches the physical reading of saturation and needs no schema change.
2. **Move the `(1, 1.6)` band into `BreakoutProfile`** and author it per aircraft so `S` has support in the 60–120 m/s region — a band of roughly `(0.6, 1.0)` puts the 450 km/h entry mid-range. Smallest conceptual change, but it is a schema change.
3. **Keep the current numerator** and record it as a deliberate deviation from plan §2.2, accepting that `S` is inert and that `demandGate ≡ D`. Honest, but it leaves the approved four-factor gate as a three-factor one and leaves P4-3 and the B13 mean-G change unexplained.

Do **not** route `allocation.unmet` into `PilotIntent` as a source of true saturation — that would read `AuthorityBudget` from the intent layer and violate §0 and AD13.

**Consequence for the benchmark table, whichever option is chosen.** A faithful `S` makes B12 pass *vacuously* (the limiter goes to 0.000, not 0.197, so "beginner full-stick does not break out" stops meaning anything), makes B14 fail worse rather than better, and leaves B17 at zero. The B12 row in the interpretation table below is currently read as "the target working"; it is only meaningful while `S` behaves as shipped.

**Ownership:** **Phase 4 required** — an owner decision plus whichever change it selects. Per-profile re-banding, if chosen, carries into **Phase 8 tuning**.

---

### P4-2 / MAJOR / The alpha-limit gate steps to zero on a signed-zero crossing of the other axis

**Files**

- [controller.ts:50-53](../src/game/flight/controller.ts#L50-L53)

**Observed behaviour**

```ts
const incidence = axis === 'pitch' ? flow.alphaDeg : -flow.betaDeg
if (input * incidence > 0) target[axis] *= clamp((envelope.alphaLimitDeg - flow.incidenceDeg) / 5, 0, 1)
```

The gate *condition* uses the signed per-axis angle, but the gate *magnitude* now uses `flow.incidenceDeg`, the combined unsigned incidence. Phase 3 used `Math.abs(incidence)` — the same axis in both places. The mismatch produces a full-authority step whenever the signed angle crosses zero while the combined incidence is above `alphaLimitDeg`.

Measured on the F-22 at 100 m/s with the limiter closed (`alphaLimitDeg = 20`), full pull:

| condition | pitch request (rad/s²) |
|---|---:|
| `alphaDeg = −1e-6`, `betaDeg = 60`, incidence 60° | 4.652402 |
| `alphaDeg = +1e-6`, `betaDeg = 60`, incidence 60° | 0.000000 |

and symmetrically for yaw:

| condition | yaw request (rad/s²) |
|---|---:|
| `betaDeg = −1e-6`, `alphaDeg = 60`, incidence 60° | −2.056851 |
| `betaDeg = +1e-6`, `alphaDeg = 60`, incidence 60° | 0.000000 |

Two separate problems are visible here. First, the discontinuity: one microdegree of the *other* axis flips the request between full and zero. Second, cross-axis coupling: 60° of pure sideslip now zeroes the pitch request, and 60° of pure alpha now zeroes the yaw request, once the sign condition is met.

**Why this violates the contract**

I7 requires continuity of every smoothed quantity per substep, and the review brief asks specifically whether crossing the alpha limit causes a discontinuity and whether yaw accidentally uses pitch alpha. Both are true here. The gate only bites while `alphaLimitDeg < flow.incidenceDeg`, that is when the limiter is partly closed and incidence is already high — exactly the breakout-entry and recovery regime Phase 4 introduces.

Note that `limiterOpen` itself is continuous; the discontinuity is downstream of it, in the controller request. It does not break I7 as currently asserted, because `assertLimiterStep` audits only `state.limiterOpen`. That is why the test suite passes.

**Concrete runtime scenario**

A pilot in a 60° sideslip recovery at moderate q, limiter partly closed, holds a pull. As beta noise carries alpha through zero, the pitch request chatters between roughly 4.65 rad/s² and 0 at substep rate. The allocator smooths some of this, but the elevator command is genuinely binary across the crossing, and it drops out precisely when the pilot is trying to arrest the departure.

**Recommended fix**

Use one angle consistently. Either keep the Phase 3 per-axis form, `clamp((alphaLimitDeg − Math.abs(incidence)) / 5, 0, 1)`, or — if the intent really is to restrict on combined incidence, as the implementation report states — replace the binary sign condition with a continuous outward-demand weight, for example scaling the restriction by `clamp(input * incidence / (|input| * max(|incidence|, ε)), 0, 1)` so the gate fades in with the sign rather than switching on it. Add a test that sweeps the signed angle through zero at high combined incidence and asserts the request is continuous.

**Ownership:** **Phase 4 required.**

---

### P4-3 / MINOR / The automatic G path ignores the authored High-G speed window that still gates Space

**Files**

- [envelope.ts:38](../src/game/flight/envelope.ts#L38) — `Math.max(D * S * (1 - E), state.maneuver.highG)`
- [maneuvers.ts:62-64](../src/game/flight/maneuvers.ts#L62-L64) — `highGMinSpeedMps` / `highGMaxSpeedMps` / `highGSpeedFadeMps` fade

The manual Space path is faded in and out by an authored speed window (75–190 m/s with a 15 m/s fade). The automatic term `D · S · (1 − E)` has no such gate; it depends only on stick and energy. Because the two are combined with `max`, above 190 m/s Space contributes zero while automatic demand still contributes the full 1.6.

This is an eligibility asymmetry rather than a second physics path — the allowance still flows through a single `gAllowance`, is still bounded by `hardTurnG`, and still drives `normalLimit`, `highGRate` and `highGDrag` through one derivation in [controller.ts:35](../src/game/flight/controller.ts#L35). It is listed separately from P4-1 because it survives whatever happens to `S`.

**Recommended fix:** decide whether the speed window is part of the High-G model or an artefact of the key binding, and apply the answer to both terms. **Ownership: Phase 6**, where `highG` leaves `PilotCommand` and the question has to be settled anyway.

---

### P4-4 / MINOR / B17 is a degenerate fixture and cannot register a C-versus-automatic difference

**Files**

- [phase4.report.ts:70](../benchmarks/flight/phase4.report.ts#L70)
- [harness.ts:76](../benchmarks/flight/harness.ts#L76)

B17 reports 0.000° for all three profiles, and the implementation report (§10) says "the equality is measured, not forced". Measured, yes — but the fixture cannot produce any other answer.

Instrumenting the two traces directly shows the pitch demand is unmet at every single substep from step 1 (minimum |unmet| 0.029 rad/s² for the F-22, 0.571 for `f22-notvc`), so the allocator is capability-bound throughout and the limiter never changes the applied moment:

| substep | `limiterOpen` auto / C | request auto / C | allocated aero auto / C | allocated TVC auto / C | resulting pitch rate auto / C |
|---|---|---|---|---|---|
| 1 | 0.02123 / 1.00000 | 4.643 / 14.991 | 4.07236 / 4.07236 | 0.38976 / 0.38976 | 0.03400028 / 0.03400028 |
| 20 | 0.66785 / 1.00000 | 9.841 / 14.871 | 3.95910 / 3.95910 | 2.21625 / 2.21625 | 0.50724757 / 0.50724757 |
| 100 | 0.99915 / 1.00000 | 14.516 / 14.530 | 3.60129 / 3.60129 | 4.12071 / 4.12071 | 1.43532742 / 1.43532742 |

The automatic and C traces are bit-identical in rates, velocity and orientation for the full eight seconds. The delta is structurally zero.

This is excellent evidence for §3 — it is the cleanest demonstration in the codebase that permission does not manufacture authority — and it should be cited as such. But as a *C-versus-automatic* benchmark it is vacuous, and B14 inherits the same property: its 6.117 s time-to-70° is set by TVC capacity and actuator slew, not by permission.

**Recommended fix:** keep the fixture but retitle the metric to what it proves (allocation saturation makes the entry ramp invisible), and add a second B17 variant whose demand is *not* capability-bound — for example a partial-stick entry, or a higher-q start — so the comparison can actually discriminate. **Ownership: Phase 4 required** for the reframing, since the current row reads as a passing equivalence test that isn't one.

---

### P4-5 / MINOR / The B16 chatter sweep cannot produce chatter, and subtracts the intended reversal unconditionally

**Files**

- [phase4.report.ts:19-37](../benchmarks/flight/phase4.report.ts#L19-L37)
- [metrics.ts:73-81](../benchmarks/flight/metrics.ts#L73-L81)

The sweep perturbs `q` with a 0.015-amplitude 4 Hz ripple across a permission band 1.3 wide, and feeds it into an exponential whose rates are 2–6 s⁻¹. A first-order filter at those rates attenuates 4 Hz to roughly 8–24 % of an input that is already about 1 % of the band; the limiter physically cannot reverse. The measured `directionChanges` is exactly 1 for every profile and both boost settings, so the reported chatter count of 0 is produced by construction.

Separately, `chatterCount = Math.max(0, directionChanges - 1)` subtracts the intended reversal whether or not it occurred. A run that produced zero reversals would also report 0.

**Recommended fix:** raise the ripple amplitude until it is within an order of magnitude of what the filter can pass (or lower the frequency toward the filter corner), and assert the intended reversal is present before subtracting it. **Ownership: Phase 4 required** — B16 is one of the four named Phase 4 emphases, and right now it measures nothing.

---

### P4-6 / MINOR / `stabilityAssist` and `recoveryAssist` are dead fields; `envelope.intent` and `energyPermission` have no consumer

**Files**

- [envelope.ts:11, 16-17, 41, 45-46](../src/game/flight/envelope.ts#L11)

A scoped grep over `src` finds no reader for `EnvelopeFactors.stabilityAssist`, `EnvelopeFactors.recoveryAssist`, `EnvelopeFactors.intent` or `EnvelopeFactors.energyPermission` outside `envelope.ts` itself, the diagnostics record and the tests. `stabilityAssist` was changed from `1 - maneuver.blend` to `1 - H * confidence` — a change to a value nothing reads. `recoveryAssist` is correctly pinned to 0 for Phase 5.

This is the correct direction (no leakage), but the interface now advertises permissions that do not exist. Keeping `recoveryAssist` as an explicit zero is justified as a Phase 5 seam; `stabilityAssist` and `intent` are not.

**Recommended fix:** delete `stabilityAssist` and `EnvelopeFactors.intent`, or add a comment marking them as reserved seams with the phase that will consume them. **Ownership: Phase 5+.**

---

### P4-7 / MINOR / `stepManeuvers` still returns `assisted`, which no caller uses

**Files**

- [maneuvers.ts:61, 68](../src/game/flight/maneuvers.ts#L61); [stepFlight.ts:30-31](../src/game/flight/stepFlight.ts#L30-L31)

`stepFlight` calls `stepManeuvers` for its side effects and discards the return value. `assisted` is computed from `m.phase` and is now unreferenced. Harmless, but it is exactly the kind of leftover that makes a later reader believe the phase machine still feeds physics.

**Ownership: Phase 6**, with the rest of the phase-machine removal.

---

### P4-8 / MINOR / Stall advisories are suppressed for any held stick above 20° incidence

**Files**

- [telemetry.ts:14-21](../src/features/flight/telemetry.ts#L14-L21)
- [envelope.ts:64-73](../src/game/flight/envelope.ts#L64-L73)

`flightWarning` returns `null` for `HIGH_AOA` and `POST_STALL`. `envelopeLabel` assigns `HIGH_AOA` whenever `highAoa > 0` — that is, incidence above `alphaNormalDeg` (20°) with any airspeed confidence — provided `demand ≥ 0.1`. `POST_STALL` covers `highAoa > 0.5 && separation > 0.5`, also with no warning.

Phase 3 suppressed the advisory only while `maneuver.phase === 'active'`, i.e. while C was held. The new rule is much broader: a pilot who is genuinely departed but still holding the stick gets no advisory at all, because the `DEPARTED` branch at [envelope.ts:72](../src/game/flight/envelope.ts#L72) is only reachable when `highAoa` is exactly 0.

The intent — "high incidence is deliberate, don't nag" — is right and matches the plan. The reachability of `DEPARTED` under held demand is the part that looks unintended.

**Recommended fix:** allow a departed advisory under demand when `separation` is high and rates are diverging, or gate suppression on `limiterOpen` (the pilot asked for this) rather than on incidence alone. **Ownership: Phase 7** (HUD/departure-warning polish), unless the owner considers a missing departure warning a Phase 4 acceptance item.

---

### P4-9 / MINOR / The High-G practice lesson now completes without pressing Space

**Files**

- [practice.ts:16](../src/game/playground/practice.ts#L16)
- [en.ts:158](../src/locales/en.ts#L158) (`psmControlsDetail`), [th.ts](../src/locales/th.ts)

`if ((s.flightForces?.envelope.gAllowance ?? 1) > 1.3)` replaces `if (s.maneuver.highG > 0.5)`. Since automatic full-stick demand at high q now drives `gAllowance` to 1.6 on its own (see P4-1), the lesson's 90° of High-G turning can be accumulated with no modifier key. The help text still teaches Space as the High-G control.

Arguably the correct end state once High-G is fully automatic, but it silently changes what the lesson teaches. **Ownership: Phase 6**, alongside the Space remap.

---

### P4-10 / MINOR / Test assertions weakened without a replacement contract

Five separate loosenings, listed together because they share a shape: a Phase 3 assertion that no longer holds was relaxed rather than replaced with the new expected behaviour.

- [phase3Boundaries.test.ts:59](../tests/phase3Boundaries.test.ts#L59) — `expect(state.limiterOpen).toBeGreaterThanOrEqual(0)` replaces `toBe(0)`. This is vacuous; `limiterOpen` is always ≥ 0 by construction. The C-release case should assert the exponential closing law, which `assertLimiterStep` already knows how to express.
- [airflow.test.ts:124](../tests/airflow.test.ts#L124) — `toEqual` → `toMatchObject`. The new `energyPermission` and `limiterTarget` fields are now unpinned, and any future field will be too.
- [flight.test.ts:331, 341](../tests/flight.test.ts#L331) — `up.y > 0.6` → `up.y > 0`, and `up.y < −0.6` → `< 0`. The original bound asserted "roughly upright / roughly inverted"; the new one permits an 89° bank. A tighter bound consistent with the new behaviour would keep the coverage.
- [neutralRelease.test.ts:62, 71](../tests/invariants/neutralRelease.test.ts#L62) — the `peakAlpha > 70` assertion was deleted and the completion check made conditional on the very quantity that no longer reaches 70. The test now passes by skipping. Pin the new value explicitly (`peakAlpha < 70` with a comment) so a regression back to phase-forced grip loss is visible.
- [flightHandling.test.ts:39-40](../tests/flightHandling.test.ts#L39-L40) — the manual/normal/fast High-G ratio test was deleted outright, leaving no CI guard on relative turn performance. The report-only replacement in `phase4.report.ts` is not a regression guard.

[aerodynamics.test.ts](../tests/aerodynamics.test.ts) was also restructured (aggregate → `it.each`) to avoid a timeout; the assertions and tolerances are unchanged, which is the right way to do that.

**Ownership: Phase 4 required** for the `phase3Boundaries` and `neutralRelease` cases, which are now non-assertions. The rest are **Phase 5+**.

---

### P4-11 / MINOR / `FlightCamera` still keys off `maneuver.phase`

**Files**

- [FlightCamera.ts:18](../src/render/FlightCamera.ts#L18)

`const maneuvering = state.maneuver.phase === 'active' || state.maneuver.phase === 'recovery'` — with automatic breakout enabled and `psmArm` unused in normal flight, the camera's maneuvering behaviour is now unreachable except while C is held. The implementation report explicitly defers camera work to Phase 7, so this is disclosed rather than missed, but it means shipped camera behaviour no longer tracks the aircraft's actual state.

**Ownership: Phase 7.**

---

### P4-12 / MINOR / Reverse-path length rescale divides by an unguarded length

**Files**

- [stepFlight.ts:99-105](../src/game/flight/stepFlight.ts#L99-L105)

```ts
const length = lateral.length()
lateral.multiplyScalar(1 + (1 / length - 1) * reverseAlignment)
```

The Phase 3 code used `lateral.normalize()`, which three.js implements as `divideScalar(length || 1)` and is therefore zero-safe. The replacement is not. The preceding fallback makes the case geometrically unreachable — `forward` is perpendicular to body-up, so when `forward · path = −1` the projected body-up cannot be zero — but the guard is now implicit rather than explicit, and I1 fuzz would only catch it if it happened to hit the exact antipode.

**Recommended fix:** `const length = Math.max(lateral.length(), 1e-9)`. One line, no behaviour change. **Ownership: Phase 4 required** — it is free and the alternative is an NaN that propagates into the quaternion.

---

### P4-13 / MINOR / Breakout weights validate individually but not as a sum

**Files**

- [validateProfile.ts:26-39](../src/game/flight/validateProfile.ts#L26-L39)
- [defaults.ts:78-84](../src/content/flight-profiles/defaults.ts#L78-L84)

Each of `baseWeight`, `brakeWeight`, `powerWeight`, `comboWeight`, `sustainWeight` is checked to lie in 0–1, but their maximum combined contribution is `0.15 + 0.35 + 0.25 + 0.8 + 0.05 = 1.6`. At `E = 1`, `B = Pi = 1` the un-clamped `permission` reaches 1.55 before `clamp(…, 0, 1)` in [envelope.ts:36](../src/game/flight/envelope.ts#L36).

Nothing breaks — the clamp is correct and there is no NaN or negative-gain path — but it means the top of the tuning range is flat: changes to `comboWeight` above roughly 0.45 have no effect at full brake plus power. A tuner reading the table would not expect that.

**Recommended fix:** either validate `baseWeight + brakeWeight + powerWeight + comboWeight + sustainWeight ≤ 1`, or document that the sum is intentionally over-unity so the combo case saturates early. **Ownership: Phase 8 tuning.**

---

### P4-14 / NOTE / Four of the six missed feel targets share one root cause

B1 (Cobra peak AoA), B2 (time to 90°), B4 (Cobra path heading change) and B14 (time to 70°) are reported as four separate misses. They are one mechanism.

The only thing that decouples the flight path from the nose is `grip = 1 − separation` at `stepFlight.ts:81, 114`, and `separation` is driven by [stall.ts:26](../src/game/flight/stall.ts#L26) from signed pitch alpha against `separationAttachedAoaDeg` (20°) and by low arcade speed. But pitch alpha can only exceed 20° if the path already lags the nose. At 450 arcade km/h the path-rate ceiling is `turnAcceleration · speedAuthority · surfaceControl / speed · turnRateReserve ≈ 1.38 rad/s`, and the measured peak body pitch rate in the same fixture is about 1.44 rad/s. The two are within 5 % of each other, so incidence accumulates at roughly the difference, which is why B14 takes 6.1 s instead of 1.2 s and why the C Cobra now peaks at 8.24° instead of 90°.

Pinning the limiter closed confirms the limiter is not the bottleneck — it is doing a great deal of work, just not enough to win the race:

| fixture | `limiterOpen` free | `limiterOpen` pinned to 0 |
|---|---:|---:|
| `psmIntent450` peak incidence | 97.38° | 17.09° |
| `psmIntent450` time to 70° | 6.117 s | never |
| `cobra` peak incidence | 75.27° | 4.78° |
| `kulbit` peak incidence | 149.30° | 4.94° |

So automatic breakout works; the entry is just slow because `pitchRate · ratePermission` and the path-rate ceiling are nearly balanced. Closing the gap is a `turnAcceleration` / `pitchRate` / `turnRateReserve` decision, or an owner decision about whether high demand should reduce path grip directly rather than only through `separation`.

**Do not** chase B14 by retuning the floor, TVC gain, surface acceleration or engine — the implementation correctly avoided that, and the report says so. **Ownership: Phase 8 tuning**, or a deliberate Phase 5 model decision if the owner wants a faster entry than the current lift model allows.

---

## Architecture verification

The Phase 3 pipeline is intact and the Phase 4 additions sit in the right places.

```
PilotCommand
  → measureControlDemand()     controller.ts   closed-envelope rate observation, no capability read
  → readIntent()               intent.ts       player input + scalar feedback only
  → stepEnvelope()             envelope.ts     permission: limiterOpen, alphaLimitDeg, gAllowance
  → requestControl()           controller.ts   body-axis rate request
  → computeBudget()            authority.ts    capability, from airflow + effectiveness + actual thrust
  → allocate()                 allocation.ts   aero → TVC → floor
  → rates
```

`authority.ts`, `allocation.ts`, `aerodynamics.ts`, `thrustVectoring.ts`, `engine.ts`, `engineForces.ts` and `speed.ts` are byte-identical to Phase 3 (`git diff` is empty for all seven). `intent.ts` imports only `PilotCommand`; `authority.ts` imports only `./airflow`, `./profileTypes`, `./thrustVectoring`, and [phase4.test.ts:118-123](../tests/invariants/phase4.test.ts#L118-L123) pins that statically.

`stepEnvelope` is the one new mutator. It reads `state.intent`, `state.stall`, `state.maneuver.highG`, `state.limiterOpen` and `AirflowState`, and writes only `state.limiterOpen`. `interpretEnvelope` is pure and is safely reused by four presentation call sites.

---

## Automatic breakout verification

Checked against the approved §2.3 structure term by term.

| Check | Result |
|---|---|
| `demandGate = D · S` | Present ([envelope.ts:36](../src/game/flight/envelope.ts#L36)), but `S ≡ 1` — see **P4-1** |
| `permission = E·(w_base + w_brake·B + w_power·Pi + w_combo·B·Pi) + w_sustain·T·E` | Exact match, [envelope.ts:34-35](../src/game/flight/envelope.ts#L34-L35) |
| `powerIntent` double-counting | None. `Pi = max(afterburner, max(0, speedAdjust)·0.4)` ([intent.ts:24](../src/game/flight/intent.ts#L24)); the combination appears only as the separate `comboWeight · B · Pi` term, as AD13 requires |
| `B · Pi` is a real combination term | Yes — not folded into `Pi` |
| `T` low-weight | Yes, `sustainWeight = 0.05`; but it integrates `D · S ≡ D`, so it is sustained demand, not sustained saturation |
| `H` uses unsigned incidence | Yes — `smoothstep(flow.incidenceDeg, alphaNormalDeg, alphaCriticalDeg)`, matching the M4 owner decision. `confidence` is applied only to `highAoa`, never to the `H` latch, exactly as the report claims |
| `D` alone cannot latch the limiter | Correct. `target = max(intent, H·D)`; with `H = 0`, `D` acts only through `intent`, which is gated by `E` and the weights |
| Releasing demand closes the limiter | Verified. `D = 0` zeroes both terms even at 90° incidence ([phase4.test.ts:88-103](../tests/invariants/phase4.test.ts#L88-L103)) and the limiter decreases monotonically for 240 substeps |
| Energy direction | Correct. `E = 1 − smoothstep(q, qLow, qHigh)`, so permission falls as energy rises |
| Range safety | `intent` clamped to 0–1; `H·D` in 0–1; `previous` in 0–1; the exponential update is a convex combination, so `limiterOpen` cannot leave 0–1. `hardTurnG ≥ 1` and the `hardTurnG > 1` guard in [controller.ts:35](../src/game/flight/controller.ts#L35) prevent division by zero |
| Algebraically-different implementations | One found, and it matters: the saturation numerator (**P4-1**). Everything else matches the approved algebra |

---

## Permission vs capability audit

This is the strongest part of the implementation, and it holds up under direct measurement rather than structural inspection.

Every permission field was traced to its consumers with a scoped grep over `src`:

| field | consumers | verdict |
|---|---|---|
| `limiterOpen` | `controller.ts:37, 40, 43` (rate *targets*), [envelope.ts:43](../src/game/flight/envelope.ts#L43) (`alphaLimitDeg`), HUD readout | request only |
| `alphaLimitDeg` | `controller.ts:36, 52` (rate target and gate) | request only |
| `gAllowance` | [controller.ts:33-35](../src/game/flight/controller.ts#L33-L35) → `normalLimit` (path lateral cap), `highGRate`, `turnDrag`; HUD flag; practice counter | path-force budget — see below |
| `highAoa` | [controller.ts:57](../src/game/flight/controller.ts#L57) (neutral-stick *dissipative* damping), mouse-frame blend, diagnostics | request/input only |
| `intent`, `energyPermission` | none | dead |
| `stabilityAssist`, `recoveryAssist` | none | dead — **P4-6** |

`AuthorityBudget` is unreachable from all of them. `computeBudget(airflowStart, effectiveness, thrust, profile)` takes no command, no envelope, no stall and no intent, and `aeroFlowEffectiveness` reads `AirflowState` and `AeroProfile` only.

The decisive evidence is empirical. At substep 1 of `psmIntent450`, the automatic run requests 4.643 rad/s² and the C run requests 14.991 rad/s² — a 3.2× difference in request — and the allocation is identical to the last bit (aero 4.07236, TVC 0.38976), because both exceed capability. Permission genuinely cannot manufacture authority here.

`gAllowance` is the one boundary case worth naming. It scales `normalLimit`, which caps the lateral path acceleration applied to the velocity vector — a real force budget, not a rate request. But that is the Phase 3 High-G architecture unchanged (`normalLimit = turnAcceleration · speedAuthority · (1 + highG · 0.6)` became `· gAllowance`), and it is bounded by `hardTurnG`. What Phase 4 changed is who triggers it, not what it does. That is by design per plan §2.3; the consequences are P4-1 and P4-3.

The floor is untouched: `arcadeControlFloor` is `{ acceleration: {0.25, 0.18, 0.3}, maxRate: {0.2, 0.15, 0.3} }` on both aircraft, identical to Phase 3, and nothing multiplies it by `limiterOpen`, `highAoa` or any label.

---

## AD16 regression check

No regression.

[authority.ts:21](../src/game/flight/authority.ts#L21) is unchanged:

```ts
physicalAero[axis] = flow.dynamicPressure * flow.confidence * Math.max(0, effectiveness[axis]) * profile.aero.controlAcceleration[axis]
```

There is no `(1 - separation)` factor and no equivalent. `aeroFlowEffectiveness` still derives from `AirflowState` alone. `AuthorityBudget` does not consume `highAoa`. The B23/B24 crossflow tables in the regenerated `out/crossflow.md` are identical before and after for every axis, angle, speed and profile, which independently confirms the fixed-flow authority and damping model did not move. B25 does change, correctly — it includes the new permission, controller and path behaviour.

Separation is still consumed by natural damping ([aerodynamics.ts:77](../src/game/flight/aerodynamics.ts#L77)), by `surfaceControl` in the path model, and by `grip`. None of those is angular authority.

## Restoring regression

No regression. `aerodynamics.ts` is unchanged, including the AD7 comment block that pins the semantic. Restoring remains `stiffness(incidence) · q · sin(alpha or beta)` with no separation factor, and `restoringSeparationIndependence` in [aerodynamics.test.ts](../tests/aerodynamics.test.ts) still guards it. Natural restoring and damping run from the first substep after release; [phase4.test.ts:216-228](../tests/invariants/phase4.test.ts#L216-L228) confirms it from a seeded 100°/20 m/s rotating release on both aircraft.

---

## Path/gravity migration audit

The port was done, and it was done before automatic opening was enabled — the phase-independence test at [phase4.test.ts:19-35](../tests/invariants/phase4.test.ts#L19-L35) asserts that setting `maneuver.phase` to `armed`/`active`/`recovery` and `blend` to 1 changes nothing in velocity, orientation or the whole force ledger, across four speeds and four incidences.

**Category 1 — intentionally retained:**

- [stepFlight.ts:86](../src/game/flight/stepFlight.ts#L86) — `if (m.phase === 'active') m.rotation += …`. A debug counter. Reads phase, writes only to the observer field.
- [envelope.ts:38](../src/game/flight/envelope.ts#L38) — `state.maneuver.highG`. This is the one *physics* read of legacy maneuver state that survives, and it is deliberate: the plan keeps `highG` in `PilotCommand` until Phase 6, and routing it through `gAllowance` is exactly what Phase 4 was asked to do. Worth naming explicitly so Phase 6 does not lose it.
- [stepFlight.ts:34](../src/game/flight/stepFlight.ts#L34) — `command.psmArm && maneuverProfile.psmEnabled` as the debug limiter override.
- `maneuvers.ts` phase machine, `m.blend`, `m.completed` — observers only.
- [FlightCamera.ts:18](../src/render/FlightCamera.ts#L18) — presentation, Phase 7 (**P4-11**).

**Category 2 — physics dependencies that should have been removed:** none found.

**Replacement signal quality.** The continuous substitutes are physically sensible and smooth:

- `attachment = 1 − separation` — `separation` is a time-smoothed first-order state with bounded per-substep change, already audited by I7.
- `lift = min(1, q) · confidence` — continuous in airspeed; `confidence` is a smoothstep from 2 to 10 m/s.
- `reattachment = 1 − smoothstep(incidence, alphaNormalDeg, alphaCriticalDeg)` — continuous with zero derivative at both ends.
- `pathGrip = lerp(activeGrip, recoveryGrip, reattachment)` — in normal flight `reattachment = 1` gives `recoveryGrip = 2.5`, matching the Phase 3 non-active branch exactly.
- `gravityBlend = 1 − min(1, turnAcceleration · lift / gravity) · (1 − separation)`. With `turnAcceleration / gravity ≈ 14.8`, the `min` saturates for any `lift > 0.068`, i.e. above about 23 m/s, so this reduces to `separation` — the Phase 3 non-PSM value — everywhere in normal flight, and only opens up gravity near rest. Good, minimal change.
- Reverse-path alignment: the old binary `dot < −0.8` became `smoothstep(−alignment, 0.8, 1)`, and the normalisation became a length lerp rather than a hard `normalize()`. Continuity is pinned at [phase4.test.ts:246-254](../tests/invariants/phase4.test.ts#L246-L254). The unguarded reciprocal is **P4-12**.

**Double application:** checked and not present. `surfaceControl` multiplies `normalLateral` once; `lift` multiplies the separated `lateral` and its limit once each; `grip` performs the single lerp between them. The one accidental drop is that the separated `lateralLimit` lost its old `(1 + m.highG · 0.6)` scaling — immaterial, since that branch only has weight when separation is high.

One disclosed but under-emphasised change: `surfaceControl` gained the `lift` factor, so attached path authority is now reduced by up to 14 % at 450 arcade km/h where Phase 3 applied none. This is part of why B15 altitude loss moved from 0 to 179 m.

---

## Controller/allocation audit

`controller.ts` is a controller. It imports `PilotCommand`, `AeroAxes`, `AircraftFlightProfile`, `AirflowState`, `EnvelopeFactors` and `clamp` — no nozzle geometry, no `maxAngle`, no thrust-vectoring module, no allocation module. It produces a `request` and a `servoDamping` and mutates nothing. [stepFlight.ts:43-44](../src/game/flight/stepFlight.ts#L43-L44) routes the request through `signedBudget` and `allocate`; there is no path from the controller to `state.rates` that bypasses allocation.

`highG` is derived from `gAllowance` rather than read from `maneuver` ([controller.ts:35](../src/game/flight/controller.ts#L35)), which is the right direction: one allowance, one derivation.

The dissipative/powered split holds. `servoDamping` is `−rates · blend / dt` and is applied outside the budget, which is correct — it can only remove rate. `request` is `target · blend / dt` and is the only positively-driven term.

**Units.** Checked end to end:

- `p.pitchRate`, `p.yawRate`, `p.rollRate`, `target[axis]` — rad/s.
- `blend = 1 − exp(−response · dt)` — dimensionless; `request = target · blend / dt` — rad/s². Correct: the `/dt` converts a per-step rate delta into an acceleration, and [stepFlight.ts:66](../src/game/flight/stepFlight.ts#L66) multiplies by `dt` once. No double application, no omission.
- `closedTurnBudget = turnAcceleration · speedAuthority · surfaceControl / max(airspeed, 1) · turnRateReserve` — (m/s²)/(m/s) = rad/s, dimensionally consistent with `requestedTurn`.
- `normalLimit` stays in m/s² and caps `normalLateral`, also m/s². Correct.
- `openRate` / `closeRate` in s⁻¹ against `dt` in s. Correct.

The one units-adjacent problem is that `saturationRatio` carries a dimensionless constant of 3 that makes it not a ratio of comparable things any more (**P4-1**).

---

## Non-TVC audit

Clean. Tested aggressively with `f22-notvc` under `X + Shift + full pull` from 450 arcade km/h for eight seconds, with the limiter reaching 1.0:

- `budget.tvc` — zero on every axis at every substep.
- `allocation.tvc` — zero on every axis at every substep.
- `budget.poweredControlAvailable` — 0 at every substep.
- Actual applied TVC (`flightForces.tvc`) — zero.
- Peak incidence — **13.80°**, against 97.38° for the F-22 on the identical command track.

Asserted per-substep at [phase4.test.ts:134-138](../tests/invariants/phase4.test.ts#L134-L138) across all four non-C automatic scenarios, and the full Phase 3 I10–I19 allocation/moment/work/path ledger now also runs on the automatic scenarios for `f22-notvc` ([phase3.test.ts:51](../tests/invariants/phase3.test.ts#L51)).

The floor does not become a fallback. `allocate` computes `available = max(0, floor.acceleration − physicalAero − tvc)`, so a no-TVC aircraft does get a marginally larger floor share — but the floor is capped at 0.25 rad/s² acceleration and 0.2 rad/s rate on pitch, and 13.8° of peak incidence over eight seconds of maximum demand is the proof that it is not standing in for TVC.

On B19: the `f22-notvc` automatic X+Shift fixture measures 118.42° at 3 s, inside the <180° target. The legacy C+W+X+Shift fixture measures 192.79°, outside it. Both have zero powered authority. Accumulated nose rotation counts ordinary aerodynamic turning, so the legacy miss is a feel-metric artefact, not a powered-authority finding — the implementation report is right to separate them, and the report table keeps the two fixtures under distinct IDs.

A non-TVC aircraft being *permitted* high AoA is fine and is what happens: `peakLimiter` reaches 1.0 for `f22-notvc` too. It simply cannot use the permission.

---

## Determinism/replay audit

- `npx tsc -b` passed; `npm test` 494/494 passed.
- All new smoothing uses `1 − exp(−k · dt)`: `limiterOpen` ([envelope.ts:56](../src/game/flight/envelope.ts#L56)), `sustained` ([intent.ts:22](../src/game/flight/intent.ts#L22)), `brakeIntent` ([intent.ts:23](../src/game/flight/intent.ts#L23)), `m.highG` and `m.airbrake` (`maneuvers.ts:64, 66`). No frame-dependent `lerp` anywhere in the new code. The mouse-frame blend is stateless.
- No render `dt` reaches physics. [FlightScene.tsx:73](../src/render/FlightScene.tsx#L73) refreshes `session.input.highAoa` inside the per-simulation-tick command callback, not per rendered frame, and [automaticMouse.test.ts](../tests/automaticMouse.test.ts) exercises exactly that loop through the real `GameRuntime` at 30/60/144 FPS with `toEqual` on the full snapshot and replay, plus an explicit `peakBlend > 0` guard so the blend is proven to be engaged. That is the right shape for this test and it closes the "test never enters the branch" hole.
- [phase4.test.ts:140-148](../tests/invariants/phase4.test.ts#L140-L148) replays automatic X+Shift+pull at 30/60/144 for all three profiles and confirms `runFlightReplay` rejects `p3-flow-effectiveness-4`.
- Fixed-step counts are identical across FPS by design (`FixedClock` drains to `WORLD_STEP`), which is the property being tested; a render-dt leak would still show as a mismatch because nothing downstream sees the frame delta.
- One caveat on [phase4.test.ts:105-116](../tests/invariants/phase4.test.ts#L105-L116) ("the exponential is subdivision independent"): integrating a *constant* target with a *constant* rate is subdivision-independent as a mathematical identity, so this test cannot fail for any implementation of the form `x += (t − x)(1 − e^{−k·dt})`. It documents the law rather than testing the pipeline. The real determinism coverage is the `runAtFps` and `automaticMouse` tests, and those are sound.
- Version handling is correct. `flightProfileVersion` bumped to `p4-automatic-envelope-1`; `goldenPolicy.ts` adds an explicit `retiredI4` entry with a stated reason rather than silently skipping; `goldenComparisonPolicy` still throws for any unlisted version. `git status` shows no golden file modified. The `phase3-metrics.json` baseline records `p3-flow-effectiveness-4` and source commit `527a25a`, and is clearly a new snapshot rather than a replacement for the Phase 0/1/2 archives.

---

## Test-quality audit

**What is genuinely good:**

- `assertLimiterStep` ([helpers.ts:68-84](../tests/invariants/helpers.ts#L68-L84)) checks the *exact* transition law, not just a bound, reconstructs the rate from the profile and current intent rather than trusting the recorded diagnostic, and allows only `16 · Number.EPSILON`. It is wired into the Phase 0, Phase 3 and Phase 4 traces, and [phase4.test.ts:151-158](../tests/invariants/phase4.test.ts#L151-L158) proves the audit actually rejects a corrupted jump. This is the right way to pin a continuity contract.
- The I7 bound is derived from the authored rate, exactly as the brief asks — no arbitrary epsilon.
- [flightBenchmarks.test.ts:38-41](../tests/flightBenchmarks.test.ts#L38-L41) asserts the automatic scenarios really do hold `psmArm: false, airbrake: true, afterburner: true`, which directly addresses "intended input not actually engaged" and "auto-PSM scenario accidentally still holding C". [phase4.test.ts:132](../tests/invariants/phase4.test.ts#L132) re-checks it on every trace.
- [phase4.test.ts:160-178](../tests/invariants/phase4.test.ts#L160-L178) proves labels and telemetry observation change nothing in the trace, including a run with `phase: 'active'` and `blend: 1` pre-set.
- [phase4.test.ts:230-244](../tests/invariants/phase4.test.ts#L230-L244) proves automatic entry ignores the legacy capability/altitude/speed gates.
- The non-TVC checks look at `budget`, `allocation` *and* the applied `flightForces.tvc`, not just the allocation record.

**Where confidence is false:**

- P4-4 and P4-5: B17 and B16 cannot fail.
- P4-10: five weakened assertions, two of which are now non-assertions.
- [airflow.test.ts:124](../tests/airflow.test.ts#L124) no longer pins the envelope shape exhaustively.

**Missing tests — recommended additions:**

1. **Permission changes outcome.** Nothing currently proves the limiter is wired to anything. Run `psmIntent450` with `limiterOpen` free and with it pinned to 0 and assert the peak incidence differs by a large margin. Measured today: 97.38° versus 17.09° for `psmIntent450`, 75.27° versus 4.78° for `cobra`, 149.30° versus 4.94° for `kulbit`. This is a contract test ("permission must matter"), not an implementation test, and it would catch a limiter accidentally disconnected from the controller — which the current suite would not.
2. **Alpha-gate continuity.** Sweep `alphaDeg` through zero at 60° combined incidence with the limiter closed and assert the pitch request is continuous; same for `betaDeg` and yaw. This would have caught P4-2.
3. **Saturation discrimination.** Assert `S < 1` somewhere in the envelope at partial stick — for example that `S` at 0.5 stick is meaningfully below `S` at full stick at the same q. This would have caught P4-1.
4. **`gAllowance` speed-window parity.** Assert the automatic and manual paths agree on eligibility at a speed outside the High-G window, or explicitly pin that they differ. This would have caught P4-3.
5. **Departure advisory under held demand.** Assert some warning is produced for high separation with the stick held (P4-8).

---

## Benchmark interpretation

Classifying every notable row, since target misses are not automatically bugs.

| Row | Before → After | Classification |
|---|---|---|
| B1 Cobra C peak AoA | 90.3° → 8.24° | **Expected Phase 4 behaviour change** plus tuning. C no longer forces grip loss; see P4-14 |
| B1 Cobra automatic peak AoA | — → 75.27° (F-22) / 22.97° (Su-57) | **Tuning miss**, same root cause. The Su-57 track reverses on the unchanged 2.5 s stage deadline before reaching post-stall |
| B2 time to 90° | 2.508 s → never | **Tuning miss**, same root cause |
| B3 Cobra speed loss | 142.6 → 0.0 (C) / 65.5 (auto) | Consequence of B1 |
| B4 Cobra heading change | 56.2° → 178.9° (C) / 146.6° (auto) | **Expected behaviour change.** The path now follows the nose because attached flow is never broken. Target ≤20° presumes a decoupled nose slide |
| B5 Kulbit 360° | 4.767 → 3.917 s (C) / 4.033 s (auto) | In range. No concern |
| B10 tail-slide flip | never → never | Unchanged. No anti-spin controller added, correctly |
| B11 seeded post-stall yaw ratio | 0.480 → 0.446 | In range (≤0.5). Uses the seeded 75°/20 m/s fixture, not the pedal track — correct fixture choice |
| B12 full-stick 500 | 9.13° peak, 0.197 limiter | **Passes**, but conditionally. Beginner full-stick does not break out — however a faithful `S` would drive the limiter to 0.000 and make this row pass vacuously. Only meaningful while `S` behaves as shipped (P4-1) |
| B13 900 km/h limiter | 0.000 | **Passes the design intent.** At `E ≈ 0` the limiter stays shut |
| B13 900 km/h mean G | 10.685 → 16.326 | **Physics/tuning consequence of P4-1.** Full-stick now takes the whole hard-turn allowance with no pilot G input |
| B14 time to 70° | — → 6.117 s vs ≤1.2 s | **Tuning miss** (P4-14). Also **not a permission test** — the fixture is capability-bound (P4-4) |
| B15 reversal heading / altitude | 8.9° → 166.0°, 0 m → 179 m | **Expected behaviour change.** Attached path following plus the new `lift` factor in `surfaceControl` and `gravityBlend` |
| B16 chatter | 0 unintended reversals | **Benchmark instrumentation defect** (P4-5). Cannot produce a non-zero result |
| B17 C vs auto | 0.000° | **Benchmark instrumentation defect** (P4-4). Structurally zero |
| B18 handoff dip | 0.696 → 0.000 rad/s | Improvement. No concern |
| B19 no-TVC rotation | 108.1° → 192.8° (legacy C+W) / 118.4° (auto) | **Test/metric artefact**, not a defect. The metric counts ordinary aerodynamic turning; powered authority is separately proven zero |
| B20 sideslip speed loss | 32.299 → 32.299 | Bit-identical. Confirms the sideslip drag path is untouched |
| B23/B24 crossflow | identical for every axis, angle, speed, profile | Confirms the fixed-flow authority and damping model did not move |
| B25 rate ratios | changed | **Expected** — it includes the new permission, controller and path behaviour |

No tuning changes are recommended to turn rows green. The single structural recommendation is P4-1, and it will move B13 mean G on its own.

---

## Scope audit

Phase 4 stayed in scope. Checked each later phase explicitly:

- **Phase 5 (recovery assist):** not implemented, and correctly so. `recoveryAssist` is a literal 0 with a comment naming Phase 5. There is no `recovery.ts`, no delay scheduling, no activity tracker, no anti-spin controller, no nose-precision scheduler, no artificial return-to-normal drive, no snap recovery, and no extra recovery damping beyond `naturalAerodynamics`. The continuous path/gravity port is minimal and was explicitly required by the Phase 4 plan bullet.
- **Phase 6 (input removal):** `psmArm` and `highG` both remain in `PilotCommand`; the replay schema is unchanged at 1; the legacy phase machine, speed band and lesson counters survive as observers. Correct. The three items that will need Phase 6 attention are P4-3, P4-7 and P4-9.
- **Phase 7 (camera):** untouched, including the remaining `maneuver.phase` read (P4-11).
- **Phase 8 (personality tuning):** no aircraft differentiation introduced. Both profiles share `breakoutDefaults` verbatim, which is the right provisional choice.
- **Phase 9 (detectors/FX/audio):** nothing added. The automatic scenario names describe input experiments, not detected maneuvers, and the report says so.

The one genuine scope question is `stabilityAssist` (P4-6), which was modified rather than left alone — but since nothing reads it, behaviour is unchanged.

---

## Phase 4 acceptance blockers

Two, both MAJOR, both Phase 4 required.

**P4-1 — the saturation gate `S` is inoperative.** `S` measures 1.000 at every speed from 20 to 259 m/s, at full and partial stick, at every separation level. The approved §2.3 `demandGate = D · S` therefore reduces to `D`, `T` re-measures `D`, and `gAllowance` is driven by stick magnitude alone against energy. This is a blocker because it needs an owner decision, not a patch: measurement shows that a *faithful* `S` (plan §2.2) has support only above ~145 m/s while `E` has support only below ~121 m/s, so the two gates never overlap and the approved formula cannot open the limiter at low energy at all. Pick one of the three resolutions in the finding, then add a test that pins `S` below 1 somewhere in the envelope.

**P4-2 — the alpha-limit gate is discontinuous.** A one-microdegree sign change in the *other* incidence axis steps the controller request between 4.65 rad/s² and 0 (measured), in the exact regime Phase 4 introduces: limiter partly closed, combined incidence above `alphaLimitDeg`. The existing I7 audit does not catch it because it audits `limiterOpen` rather than the controller output. Make the gate's condition and magnitude use the same angle, and add a continuity test across the signed-zero crossing.

Everything else is non-blocking. P4-4, P4-5, P4-10 and P4-12 are Phase 4 hygiene worth folding into the same change — two of them are one-line fixes, and the two benchmark defects mean two of the four named Phase 4 emphases currently measure nothing — but none of them invalidates the architecture.

The architecture itself is sound. Permission and capability are genuinely separated, and that was verified by measurement rather than by reading names: a 3.2× difference in controller request produced a bit-identical allocation and a bit-identical eight-second trajectory. AD16 and the restoring-independence semantic are intact. The non-TVC aircraft receives no powered post-stall authority. The path/gravity port removed every physics dependency on the legacy phase machine before automatic opening was enabled, exactly as the hard ordering constraint required. Phase 5 was not started.
