# MR0 — Maneuver instrumentation

Parent commit: `77333d9` (Phase 8 pedal turn). Physics version: `p8-pedal-turn-1` (unchanged). Command schema: `2` (unchanged).

Plan: [psm-maneuver-control-plan.md §5 MR0](psm-maneuver-control-plan.md#mr0--maneuver-instrumentation-ไม่แตะ-physics).

## Summary

MR0 adds measurement only. Physics, input and the command contract are unchanged.

- `benchmarks/flight/maneuvers.ts` scripts the maneuver catalogue M1–M7 plus Kulbit as closed-loop recipes. The switch conditions read incidence, attitude, heading or speed, so each script is the recipe a player is taught.
- `benchmarks/flight/maneuvers.report.ts` runs every recipe for `f22`, `su57` and `f22-notvc`, adds per-axis smoothness metrics and the RC5 mouse probe, and checks the new `maneuverTargets`. `MANEUVER_REPORT_LABEL` names `out/<label>.{json,md}`, so before/after pairs sit side by side.
- `benchmarks/flight/mr-baseline/` is a tracked copy of every report the MR2 evidence gates compare against, taken at `77333d9`. `out/` is ignored, so the plan's `out/maneuvers-baseline.*` would not survive on its own.

## Owner decisions recorded (26 September 2026)

| # | Decision |
|---|---|
| D5 | Default mouse mode is **relative spring**, with the body control frame. The positional stick stays as an option. |
| D6 | **No** right-click stick hold. Right mouse stays reserved for missiles; hold maneuvers with keyboard ↑. |
| D8 | B1 `cobra.peakAoa` resets from 75–95° to **90–120°**. |
| D7 | Still open. It is asked after the MR4 numbers. |

## Reproduction of the plan §1 probes

Every §1 number reproduces except the three below.

| Probe | §1 | MR0 | Note |
|---|---|---|---|
| Roll 250/450/700/1000 (F-22) | 35/105/116/97°/s, 90° in 2.9/1.06/0.97/1.11 s | 34.9/104.5/116.4/97.2, 2.93/1.06/0.97/1.11 | Same. At 250 the aero budget is used in full (3.05 rad/s²) with 2.46 unmet and servo damping −2.98. At 700 only 10.3 of 21.8 is used. |
| Cobra entry 450, F-22 | 0.74/1.23/2.08 s, peak 97° | 0.742/1.225/2.083, 97.3° | Same, with a 2.5 s entry window (the legacy Cobra pull timeout). |
| Cobra exit, F-22 / Su-57 | 3.55 / 4.92 s, path 54/61°, +143/+185 m, 301/283 km/h | 3.55 / 4.92, 54.4/60.9, 143/185, 301/283 | Same. The §1 probe **released Space** at the push; the script now documents that. |
| Loop 700 / burner loop 350 | 6.97 s, 274 m / 8.7 s, −545 m, 1126 km/h | 6.97 s, 264 m / 8.72 s, −543 m, 1126 | Height is the peak gain before 360°. |
| Kulbit 350 | 4.30 / 4.56 s | 4.30 / 4.56 | Same. |
| Immelmann 800 | 3.73 + 1.65 s, 685 km/h | 3.83 + 1.71 s, 681 | The half loop ends when the path has turned 180°; roll-out ends at wings level within 10°. |
| Herbst 450 (max heading) | F-22 119–125°, Su-57 81–93° | F-22 129–130°, Su-57 102–106° | The recipe differs: the script keeps pulling until 170° (B28) and counts unwrapped velocity heading. Neither aircraft reaches 180°. |
| Bell probe 500, attitude 88° | apex 9.3 s, nose drop 3.1 s | apex 10.4 s, nose drop 2.9 s | The probe releases when the attitude reaches 87°. |
| Pedal B11 | Su-57 5.6 s | 5.62 s | Same. |
| Power loop, vertical 450 none | 5.9 s, 201 m, 10° | 5.93 s, 199 m, 9.6° | Same. |
| Power loop, vertical 400–450 **W / Shift** | 433–453 m / 756–805 m | 211–234 m / 395–431 m | **Differs by about 2×.** The D3 probe's width definition could not be recovered. MR0 measures the x extent up to 270° of path turn, which matches the `none` and `Shift + Space` rows. The ordering the owner relied on still holds: Shift widens the loop most. |
| Mouse, pointer at top-right, bank sweep | pitch +0.71 → −1.0, roll flips at 180° | same | `horizon` rotates the command with bank; `aircraft` stays 0.71 / 0.71. |

## Baseline results (`mr-baseline/maneuvers-baseline.md`)

Status against `maneuverTargets` (report only), F-22 / Su-57:

| Benchmark | Target | F-22 | Su-57 | Status |
|---|---|---:|---:|---|
| B26 roll peak 450 / 700 | 220–240°/s | 104.5 / 116.4 | 104.7 / 116.4 | ⚠ out |
| B26 roll time to 90° 450 / 700 | ≤ 0.6 s | 1.06 / 0.97 | 1.06 / 0.97 | ⚠ out |
| B2 Cobra 90°, no Shift | ≤ 1.0 s | 2.08 | 2.23 | ⚠ out |
| B1 Cobra peak (Space + Shift) | 90–120° (D8) | 116.2 | 110.1 | ok |
| B27 exit to entry attitude ±10° | ≤ 1.2 s | 3.22 | 4.48 | ⚠ out |
| B27 exit path climb | ≤ 20° | 54.4 | 60.9 | ⚠ out |
| B27 exit altitude gain | ≤ 60 m | 143 | 185 | ⚠ out |
| B28 Herbst heading 170° | ≤ 4 s | — | — | ⚠ out |
| B29 power loop width (best non-Space flow) | ≤ 160 m | 199 | 202 | ⚠ out |
| B29 power loop 270° | ≤ 5 s | 5.93 | 6.0 | ⚠ out |
| B30 Bell minimum speed (recipe) | ≤ 30 km/h | 102 | 81 | ⚠ out |
| B30 Bell nose drop after apex | ≤ 3 s | 2.99 | 4.58 | ok / ⚠ out |
| B31 Immelmann half loop | ≤ 4 s | 3.83 | 3.83 | ok |
| B31 Immelmann roll-out | ≤ 1.0 s | 1.71 | 1.71 | ⚠ out |
| B5 Kulbit 350 | 3–4.5 s | 4.30 | 4.56 | ok / ⚠ out |
| B11 pedal Su-57 360° | ≤ 8 s | — | 5.62 | ok |

Smoothness (RC4), roll at 450 km/h: the request jumps by **22.9 rad/s²** in the substep where the rate crosses zero after a full reversal. Pitch jumps by 5.9 and yaw by 2.8. The jump comes only from the switch between `counterResponse` and `rateResponse`: the target does not change.

## Files

| File | Change |
|---|---|
| `benchmarks/flight/maneuvers.ts` | New. Recipes M1–M7, Kulbit and smoothness metrics. |
| `benchmarks/flight/maneuvers.report.ts` | New. Writes `out/<label>.{json,md}`. |
| `benchmarks/flight/targets.ts` | New `maneuverTargets`. B1 reset to 90–120° (D8). |
| `benchmarks/flight/mr-baseline/` | New tracked archive of the `77333d9` reports: `report`, `phase3`, `phase4`, `phase8`, `crossflow`, `jet-drift-metrics`, `camera-mr0-before` and `maneuvers-baseline`. Large JSON files are gzipped. |
| `benchmarks/flight/README.md` | Maneuver report paragraph. |

`npm test`: 42 files and 578 tests pass, as before. `tsc -b` reports only the pre-existing error in the owner's `noseFlick.report.ts`.

## Reproduce

```sh
MANEUVER_REPORT_LABEL=maneuvers-baseline npx vitest run --config vitest.bench.config.ts benchmarks/flight/maneuvers.report.ts
DRIFT_STAGE=mr0-before npx vitest run --config vitest.bench.config.ts benchmarks/flight/jetDrift.report.ts
CAMERA_REPORT_LABEL=camera-mr0-before npx vitest run --config vitest.bench.config.ts benchmarks/flight/camera.report.ts
```
