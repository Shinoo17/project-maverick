# MR2 — Servo rework

Parent commit: MR1. Physics version: `mr2-servo-1` (was `p8-pedal-turn-1`). Command schema: `2` (unchanged).

Plan: [psm-maneuver-control-plan.md §5 MR2](psm-maneuver-control-plan.md#mr2--servo-rework-physics-bump-mr2-servo-1). It addresses root causes RC1 (free servo dissipation in pitch and roll) and RC4 (the stepped response switch).

## Summary

1. **Commanded-rate hold for pitch and roll.** Each axis now has its own gate on the hold:
   - **Yaw:** the Phase 8 speed band, unchanged.
   - **Pitch:** it follows `limiterOpen`, and it fades out between 45° and 90° incidence. This is owner decision D1(b) plus the amendment below.
   - **Roll:** it holds at every speed.
   - **`f22-notvc`:** no pitch hold, by owner decision.
2. **Continuous counter-steer response (RC4).**
   - The rate is split into a counter-steered part and a part along the target.
   - The counter part is damped at the counter response, and the along part at the rate response.
   - The drive response blends from the rate response to the counter response as the counter-steered rate grows to half the target.
   - The request no longer steps where the rate crosses zero.

The hold still only moves drive out of free dissipation. `request + servoDamping` is identical for every hold, the damping stays dissipative, and the drive never exceeds the hold-0 drive. The Phase 8 neutrality test, extended to every axis, checks all three.

## Owner decisions (26 September 2026)

D1(b) was approved on condition that it pass the MR2 evidence gates. As written, it failed them, so two correction rounds followed.

| Round | Finding (F-22 / Su-57 unless named) | Decision |
|---|---|---|
| 1 | Pitch hold × `limiterOpen` alone: B19 `f22-notvc` 3 s rotation went from 124° to **322°** (target < 180°). Space + pull at 450 km/h tumbled to 180° incidence instead of peaking at 97°. B5 Kulbit fell from 3.95 to 2.6 s (target 3–4.5). A neutral release at the end of a Cobra entry tumbled to 180°, which broke the Phase 5 recovery test. The cause: the rate reaches the 2.85 rad/s target, and nothing brakes it past 90°. | **Fade the pitch hold between 45° and 90° incidence.** Past the fade the servo brakes the rate as in Phase 3. The alternatives offered were a 60→100° fade (B19 186°, fails), the same fade restricted to TVC airframes, or roll hold only. |
| 2 | Round 1 reported B19 only. The jet-drift gate then showed that `f22-notvc` entered high AoA almost like a TVC aircraft. At 450 km/h peak incidence went from 51° to 82°, and time to 30° from 1.19 to 0.66 s (the F-22's is 0.57 s). Handoff peaks went from 40–48° to 119–166°. This is the gap jet-drift review R12 protects. | **No pitch hold on `f22-notvc`**, set in its profile. The servo reads no TVC state. |

## Changes

### Controller ([controller.ts](../src/game/flight/controller.ts))

```
scope   = { speedBand: 1 − smoothstep(km/h, 200, 300),
            limiter:   limiterOpen · (1 − smoothstep(incidence, 45, 90)),
            always:    1 }
held    = scope[holdScope[axis]] · commandedRateHold[axis] · clamp(rate, min(0, target), max(0, target))
counter = rate if rate · target < 0 else 0
share   = smoothstep(|counter| / |target|, 0, counterResponseBlend)
drive   = along + (counterBlend − along) · share
damping = −(counter · counterBlend + (rate − counter − held) · along) / dt
request = (target − held) · drive / dt
```

- `counterBlend` uses `counterResponse`, or `rollReversalResponse` for roll. `along` uses `rateResponse`.
- A counter-steered rate has no held part, so the hold only ever meets the along-target response. Neutrality therefore holds exactly.
- With `counterResponseBlend = 0` the code reproduces the Phase 3 switch exactly. The new test pins this.
- The neutral-stick and recovery branches are unchanged.

### Profile fields

| Field | Default | Meaning |
|---|---|---|
| `flight.commandedRateHold` | pitch 1, yaw 1, roll 1 (`f22-notvc` pitch 0) | Was pitch 0, yaw 1, roll 0. |
| `flight.commandedRateHoldScope` | pitch `limiter`, yaw `speedBand`, roll `always` | New. Selects the gate for each axis. |
| `flight.commandedRateHoldIncidenceDeg` | full 45, zero 90 | New. The fade for the `limiter` scope. |
| `flight.counterResponseBlend` | 0.5 | New. Counter-steer width as a fraction of the target. 0 is the Phase 3 step. |

All fields are validated. f22 and su57 copy the nested objects from `flightDefaults`.

**Contract amendment.** The [Phase 3](psm-phase3-implementation.md) contract, "a held stick cannot sustain inherited high rates after aero and TVC capability disappear", now holds in these cases:
- Pitch below 45° incidence with the limiter closed (attached flight).
- Pitch above 90° incidence.
- All pitch on `f22-notvc`.
- Yaw above 300 km/h.

Roll no longer carries it: a held roll keeps the rate it has built, up to the target, and only natural damping slows it.

## Evidence

Baseline: `benchmarks/flight/mr-baseline/` (MR0, `77333d9`). Results: `benchmarks/flight/mr-results/mr2/`. The RC4-only ablation (hold at the Phase 8 values) is `maneuvers-ablation-rc4-only.md`.

### Ablation: which change moves what

- **RC4 alone** changes no standard benchmark: B1–B20 and B19 match the baseline exactly. It changes only the reversal metrics:

  | Axis, 450 km/h (F-22) | Request step after reversal, rad/s² | Jerk peak, rad/s³ | 63% after reversal |
  |---|---|---|---|
  | Roll | 22.9 → 5.6 | 570 → 594 | 0.29 → 0.28 s |
  | Pitch | 5.9 → 1.1 | 136 → 141 | 0.44 → 0.33 s |
  | Roll, 700 km/h | 24.8 → 9.5 | 1560 → 1422 | 0.24 → 0.26 s |

- **Every other change comes from the hold.**

### Gates (F-22 / Su-57; `f22-notvc` where named)

| Gate | Baseline | MR2 | Status |
|---|---|---|---|
| **B19** `f22-notvc` pull rotation at 3 s | 124° | **124°** | ok (< 180°) |
| B19 F-22 / Su-57 (report only) | 268 / 257° | 288 / 277° | — |
| B12 fullStick500 peak incidence | 7.9 / 7.8° | 7.6 / 7.7° | ok |
| B13 hardTurn900 mean G, speed loss | 12.43 G, 140 km/h | unchanged | ok |
| B16 limiter chatter | 4 | 4 | ⚠ out, unchanged (pre-existing) |
| B14 psmIntent time to 70° | 1.05 / 1.12 s | 0.86 / 0.86 s | ok |
| psmIntent peak incidence | 116 / 110° | 108 / 102° | report |
| B5 Kulbit (450, Space + Shift + W) | 3.95 / 4.17 s | 3.73 / 3.87 s | ok |
| B11 pedal | Su-57 5.62 s, ratio 0.357 | unchanged | ok |
| B1 Cobra peak (legacy scenario) | 92.3 / 92.0° | 91.0 / 90.7° | ok (90–120, D8) |
| B2 Cobra 90° (legacy scenario, Space + Shift) | 1.33 / 1.42 s | 1.23 / 1.27 s | ⚠ out (0.7–1.2) |
| B3 Cobra speed loss | 42 / 52 km/h | 83 / 92 km/h | report |
| B10 tail slide | 2.87 s | unchanged | ok |
| Recovery tests (Phase 5) | pass | pass | ok |

### Maneuvers (`maneuvers.md`)

| Metric | Baseline | MR2 | Target |
|---|---|---|---|
| Cobra 90°, Space only, 450 | 2.08 / 2.23 s | **1.15 / 1.15 s** | ≤ 1.0 s |
| Cobra peak, Space + Shift, 450 | 116 / 110° | 108 / 102° | 90–120° |
| Peak pitch rate, Space only | 1.25 / 1.20 rad/s | 2.65 / 2.69 rad/s | ~2.85 |
| Cobra exit to entry attitude ±10° | 3.22 / 4.48 s | **1.68 / 1.82 s** | ≤ 1.2 s |
| Cobra exit path climb | 54 / 61° | 45 / 48° | ≤ 20° |
| Cobra exit altitude gain | 143 / 185 m | 60 / 66 m | ≤ 60 m |
| Roll 250 km/h peak | 35°/s | **63°/s** | D4 (MR3) |
| Roll 450 / 700 km/h peak | 104.5 / 116.4°/s | 109.9 / 116.4°/s | 220–240°/s (MR3) |
| Kulbit 350 | 4.30 / 4.56 s | 3.92 / 4.06 s | 3–4.5 s |
| Herbst max heading | 129 / 102° | 108 / 76° | ≥ 170° (MR5) |
| Bell recipe minimum speed | 102 / 81 km/h | 49 / 44 km/h | ≤ 30 (MR6) |

- **Roll:** at 250 km/h roll is still budget-limited; the hold only stopped the servo braking it. At 700 km/h the rate is target-limited, so it is unchanged. Raising the roll target is MR3.
- **Herbst:** heading change fell. The entry now reaches 70° sooner (0.87 s) and at a higher pitch rate, so body roll sweeps the nose more. MR5 (stability-axis roll) owns this maneuver.

### Jet-drift (132 tracks)

- **Tracks moved by more than 1%:** 32 of 44 for the F-22 and 32 of 44 for the Su-57. For `f22-notvc` only 1 moved (handoff-1, final speed 276 → 289 km/h); every other notvc track matches the baseline.
- **Entry, Space + full pull:** the target still passes. Time to 30° is 0.62–0.86 s → 0.57–0.63 s (target 0.4–0.8 at 450–600). Speed at 30° at 650–700 is 601–647 km/h (target ≥ 350).
- **Entry peak incidence** barely changes: 94–110° before, 97–110° after.
- **Entry final speed** falls by 45–120 km/h. The F-22 at 450 goes from 276 to 169 km/h, because the nose reaches the high-drag incidences sooner.
- **Handoff tracks:** peak incidence rises, from 111/128° to 167/173° (F-22) and from 163/147° to 171/161° (Su-57).
- **Release-reapply:** peak incidence goes from 60–63° to 95°.

### Crossflow (B25, report only)

At 45 m/s broadside, the full-stick rate fraction rises for pitch and roll. Pitch holds because the limiter is open there, and roll holds at every speed. Yaw fractions are unchanged.

| Airframe, β | Pitch | Roll |
|---|---|---|
| F-22, β 60 | 3.40 → 6.62 | 1.25 → 1.58 |
| Su-57, β 60 | 3.26 → 7.11 | 1.01 → 1.56 |
| Su-57, β 90 | 2.85 → 5.93 | 0.57 → 1.42 |

### Camera (B21, `camera.md`, not retuned)

- **Pitch entries:** the F-22 and Su-57 `entry-pitch-450` tracks now pass the nose over the vertical. The camera roll p95/max goes from 0 to 100/150°/s, and view rate max from 46 to 161°/s.
- **F-22 handoff:** FPM visible at 70–110° incidence goes from 63% to 82%; view rate max goes from 247 to 274°/s.
- **Su-57 handoff:** nose visible at 20–40° incidence falls from 100% to 44%.
- **Cobra:** the F-22 changes by a few °/s. The Su-57 now rolls the camera (0 → 22/32°/s), and its extent grows from 0.83 to 1.22.

## Tests

- `tests/invariants/phase8.test.ts`:
  - "Shipping profiles hold yaw only" becomes "yaw by speed, pitch by the open limiter below 90°, and roll always". It asserts that pitch is damped with the limiter closed, held with it open, and damped again at 100° incidence.
  - New RC4 tests: the request is continuous at zero rate for pitch and roll, and width 0 still steps; a hard counter-steer matches Phase 3.
  - Validation of the new fields.
- `tests/invariants/phase3.test.ts` **I13/I14, amended.** The pitch hold follows `limiterOpen`, and Shift opens the limiter faster (Phase 4 `powerBoost`). The Shift intent therefore now shapes the servo's free braking, even at zero q. Pre-MR2 the unpowered rig matched the powered one; now the pitch rate differed by 2e-7 rad/s.
  - The invariant, that thrust creates no rotation, is now tested against a rig that holds the same keys but has an empty burner reserve. This gives identical intent without burner thrust.
  - The test asserts that the powered rig has more thrust, and that the rates and floor allocation are identical.
  - The capability and floor-cap checks still run on all three rigs.
- `tests/aerodynamics.test.ts` I1/I2 vertical zero crossing: explicit 20 s timeout. It takes about 1.2 s alone, but under the full parallel suite it passed 5 s. It runs neutral input, which MR2 does not change. No assertion changed.
- No test was removed, and no numeric tolerance was widened.

`npm test`: 43 files and 594 tests pass. `tsc -b` reports only the pre-existing `noseFlick.report.ts` error.

## Retirement and migration

| Item | Change | Reason |
|---|---|---|
| I4 golden equivalence | Retired for `mr2-servo-1` (`goldenPolicy.ts`) | The hold and RC4 intentionally change pitch and roll physics. Goldens were not regenerated. |
| Phase 3 "no inherited rate" | Amended, see above | D1(b) and its amendment. |
| I13/I14 unpowered comparison | Now intent-matched (empty burner) | The Shift intent may shape permission; thrust still may not. |

## Not done / next

- **B2** (Space only, ≤ 1.0 s) is at 1.15 s. **B27** (exit ≤ 1.2 s, climb ≤ 20°) is at 1.7–1.8 s and 45–48°. Both belong to MR4: the actuator rate and D7.
- Roll rate D4 is MR3. Herbst is MR5. The power loop and Bell are MR6.
- The camera was not retuned.

## Owner decisions requested

1. **Playtest pitch and roll feel.** Cobra entry is now about twice as fast, with a 2.65 rad/s pitch rate. A held roll keeps its rate at low speed.
2. **Entry energy.** Space + pull entries at 350–700 km/h end 45–120 km/h slower, because the nose reaches the high-drag incidences sooner. Acceptable?
3. **Su-57 handoff camera.** Nose visibility at 20–40° fell from 100% to 44%. Retune the camera now, or after MR3, which raises roll rates further?
4. **Legacy B2 target (0.7–1.2 s).** The Space + Shift Cobra is at 1.23 / 1.27 s, now just outside. Keep the target, or align it with the maneuver B2 (≤ 1.0 s, Space only)?

## Reproduce

```sh
npm test
npx vitest run --config vitest.bench.config.ts benchmarks/flight/flightBenchmarks.report.ts benchmarks/flight/phase3.report.ts benchmarks/flight/phase4.report.ts benchmarks/flight/phase8.report.ts benchmarks/flight/crossflow.report.ts
MANEUVER_REPORT_LABEL=maneuvers-mr2 npx vitest run --config vitest.bench.config.ts benchmarks/flight/maneuvers.report.ts
DRIFT_STAGE=mr2 npx vitest run --config vitest.bench.config.ts benchmarks/flight/jetDrift.report.ts
CAMERA_REPORT_LABEL=camera-mr2 npx vitest run --config vitest.bench.config.ts benchmarks/flight/camera.report.ts
```
