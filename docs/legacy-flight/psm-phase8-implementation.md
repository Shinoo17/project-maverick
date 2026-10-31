# Phase 8 — Aircraft validation: pedal turn

Parent commit: `2872cee` (Phase 7 camera and HUD). Physics version: `p8-pedal-turn-1` (was `p6-legacy-gates-1`). Command schema: `2` (unchanged).

Input: [pedal energy findings](psm-phase8-pedal-energy-findings.md) and the owner's `benchmarks/flight/pedalEnergy.report.ts`. Both are unchanged by this phase.

## Summary

The pedal turn could not complete for either aircraft. The findings put this down to low yaw authority at low q. A per-axis breakdown found a different binding limit:

- The rate servo splits its first-order response into a **drive**, which needs authority, and a **dissipation** term, `−rate · response`, which is free.
- When the drive is budget-limited, the free dissipation still brakes the whole rate. The steady rate is therefore `authority / rateResponse`, not the target.
- For the F-22 at 150 km/h near vertical, that is 0.28 / 5 ≈ 0.056 rad/s, or about 3°/s. This matched the measured 13° in 5 s. Raising authority alone would have needed 5–10× more.

Phase 8 makes three changes, all approved by the owner:

1. **Yaw commanded-rate hold.** In the pedal speed band, the servo no longer brakes the yaw rate the pilot is commanding.
2. **A speed band on the hold.** The hold fades out between 200 and 300 km/h, so yaw entries at 350+ km/h keep the Phase 3 servo.
3. **Per-axis control power (findings option B).** A yaw-only input asks for 60% of the control power a pull asks for.

Result: the Su-57 turns 360° in 5.6 s from level 150 km/h with Space and full yaw, within ±17 km/h. The F-22 reaches 36% of the Su-57's travel. Pitch and roll are unchanged, and so are Cobra and Kulbit.

The real non-TVC airframe (F/A-18 or F-16) is **blocked**. There is no model or rig for it, see [Not done](#not-done).

## Owner decisions (26 September 2026)

Answers to the findings' §6, plus one correction round.

| # | Question | Decision |
|---|---|---|
| 1 | Mechanism | Yaw servo hold (profile field per axis: yaw 1, pitch/roll 0), instead of raising low-q yaw authority. |
| 2 | Maneuver shape | B11 counts **body-axis yaw travel**. A cartwheel through nose-down counts; a flat turn about world vertical is not required. |
| 3 | F-22 target | Su-57 completes 360°. The F-22, which has no commanded yaw TVC, stays at or below ~60% of it. |
| 4 | Energy | Option B now. Recovery acceleration (findings §3.4) is deferred. The ±30 km/h tolerance was proposed and accepted on the **vertical** flow; see [B11](#b11-pedal-turn) for why this report checks the level flow instead (pending owner item 3). |
| 5 | Hold scope (correction) | Limit the hold with a speed band. See below. |
| 6 | Option B scope | Keep B at every speed. |

**Correction.** The first question said high-q flight was unchanged. That was wrong.

- Every hold value gives the same `request + servoDamping`. Where allocation grants the whole hold-0 drive, the rate change is therefore identical.
- But high incidence is budget-limited at any speed, because control effectiveness falls to 0.15 at 90°.
- With no speed band, Space + full yaw at 350–700 km/h went broadside, to 88–136° incidence. It also lost up to 340 km/h in 3 s.
- The F-22 took a yaw entry about as fast as a pitch entry. This eroded the lateral-drift personality gap that [jet-drift review R12](jet-drift-architecture-review.md) protects.

The owner was shown these numbers and chose the speed band.

## Changes

### Commanded-rate hold ([controller.ts](../src/game/flight/controller.ts))

For a held stick axis, the part of the rate that lies between zero and the target no longer counts as dissipation:

```
held    = band(speed) · commandedRateHold[axis] · clamp(rate, min(0, target), max(0, target))
damping = −(rate − held) · blend / dt
request =  (target − held) · blend / dt
```

- `request + damping` equals the hold-0 servo exactly. The hold only moves drive out of free dissipation, so it can never add authority.
- A rate above the target is still damped for free, and so is a counter-steered rate.
- The neutral-stick and recovery paths are untouched.
- `band` is `1 − smoothstep(arcade km/h, full, zero)`.

| Field | Default | Meaning |
|---|---|---|
| `flight.commandedRateHold` | pitch 0, yaw 1, roll 0 | 0..1 per axis. 0 is the Phase 3 servo. |
| `flight.commandedRateHoldSpeedKph` | full 200, zero 300 | Full hold at or below `full`, none at or above `zero` (arcade km/h). |

**Contract amendment.** [Phase 3](psm-phase3-implementation.md) states that the split "prevents a held stick from sustaining inherited high rates after aero and TVC capability disappear". This still holds for pitch and roll at every speed, and for yaw above 300 km/h.

Below 200 km/h, a held pedal now keeps the yaw rate it has built, up to the target. Only natural aero damping slows it. At q ≈ 0 that rate can persist at up to about 1.3–1.4 rad/s while the pedal is held. Releasing the pedal returns yaw to the neutral servo and to recovery.

### Per-axis control power ([speed.ts](../src/game/flight/speed.ts), [intent.ts](../src/game/flight/intent.ts))

- `PilotIntent.axisShare` records each stick axis's share of squared deflection. It is input only; I16 still holds, because `readIntent` reads no profile.
- On a neutral stick, it holds the last split. Releasing the pedal therefore never re-weights the continuation tail.
- `stepSpeed` scales `controlPower` by `Σ share · controlPowerAxisWeight`. Before any stick input the weight is 1.
- The request is still driven only by explicit pilot intent. It reads no drag or speed error, so [jet-drift amendment §5](jet-drift-implementation-plan.md) and I17 hold.
- The existing I17 test passes unchanged.

| Field | Default | Meaning |
|---|---|---|
| `flight.controlPowerAxisWeight` | pitch 1, yaw 0.6, roll 1 | 0..1 per axis. |

A yaw weight of 0.6 is the value that keeps the Su-57's level pedal within ±30 km/h. The sweep is in the [evidence](#b11-pedal-turn).

Every new field is validated: 0..1 per axis, and `0 ≤ full < zero` for the band. The f22 and su57 profiles copy each field from `flightDefaults`, so the two aircraft share no nested object.

### Versioning and benchmarks

- `flightProfileVersion` is `p8-pedal-turn-1`, and I4 is retired for it in `goldenPolicy.ts`. Goldens were not regenerated.
- New `benchmarks/flight/phase8.report.ts` reports B11 (pedal turn), B22 (personality ordering) and a yaw-weight sweep to `out/phase8.{json,md}`.
- `targets.ts` gains `phase8Targets`, which are report only.
- The Phase 3 report's B11 line now names the owner's ≤ 0.6 target instead of ≤ 0.5.

### Tests

New file: `tests/invariants/phase8.test.ts`.

- **Hold neutrality.** For all three profiles, across low-q pedal states and a 450 km/h mixed-axis track: `request + servoDamping` is identical for hold 0 and hold 1. Damping stays dissipative. The drive keeps its sign and never exceeds the hold-0 drive.
- **Shipping profiles.** They hold yaw only. Pitch and roll keep the Phase 3 no-sustain damping.
- **Speed band.** Full hold at 200 km/h, partial in the middle, and none at 300 and 700 km/h.
- **Excess and counter-steer.** A yaw rate above the target, and a counter-steered yaw rate, are still damped.
- **Validation.** Field and band validation.
- **Control power.** `axisShare` sums to 1 and holds through neutral. Control power is weighted by the stick split, and the weight holds after release. No input history leaves it unweighted.

`npm test`: 42 files and 578 tests pass (baseline 41 / 568).

`tsc -b` reports one error, in the owner's untracked `noseFlick.report.ts`, which still uses the removed `highG` field. That error predates this phase.

## Evidence

### B11 pedal turn

From `out/phase8.md`: Space + full yaw for 8 s, speeds in arcade km/h. The speed band covers the pedal start until 360° (or the whole window).

| Aircraft | Flow | Travel 6 s | Time to 360° | Speed at 360° | Speed band | Peak control power |
|---|---|---:|---:|---:|---|---:|
| F-22 | level 150 | 140° | — | — | −17 / +63 | 42% |
| F-22 | vertical | 84° | — | — | −77 / +13 | 42% |
| Su-57 | level 150 | 392° | **5.62 s** | 161 | **−17 / +12** | 42% |
| Su-57 | vertical | 385° | 5.70 s | 17 | −134 / 0 | 42% |

For comparison, at HEAD the findings measured 13° (F-22) and 64° (Su-57) of travel in 5 s near vertical.

**Checks:**

| Check | Target | Value | Status |
|---|---|---|---|
| Su-57 time to 360° | ≤ 8 s | 5.62 s | ok |
| F-22 / Su-57 travel at 6 s | ≤ 0.6 | 0.357 | ok |
| Su-57 level speed band | ±30 km/h (level flow; provisional, see below) | 17 | ok |

**The vertical flow cannot meet ±30 km/h for the Su-57 at any yaw weight** (sweep 0.4–1.0: −134 to −150 km/h).

- Once the nose leaves vertical, thrust no longer holds against gravity, and the aircraft is still climbing at about 40 m/s.
- This is the physics of a hammerhead at the top of a climb, not a tuning miss.
- The owner accepted ±30 km/h measured on the vertical flow. Because no yaw weight can meet it there, the Checks table applies it to the level flow instead. **This substitution is provisional until the owner confirms it** (owner item 3).

Yaw control-power weight sweep:

| Yaw weight | Su-57 level 360° | Su-57 speed at 360° | F-22 level end speed (8 s) |
|---:|---:|---:|---:|
| 1.0 | 5.32 s | 212 | 444 |
| 0.8 | 5.42 s | 187 | 311 |
| **0.6** | **5.62 s** | **161** | **213** |
| 0.4 | 6.03 s | 132 | 192 |

In the owner's `pedal-energy` report (5 s vertical window, 6 s level matrix):

- Vertical: F-22 65° and Su-57 302° of yaw travel. Previously 13° and 64°.
- Level with Space + yaw: Su-57 392° ending at 160 km/h. Previously 109° at 398 km/h.
- Level yaw **without** Space dives past the band, and the hold fades as speed rises. The Su-57 reaches 99° at 466 km/h. Use Space for the pedal turn.
- W + Shift recovery to 351 km/h now takes 1.28 s (F-22) and 2.16 s (Su-57), up from 0.84 s. The pedal ends slower, and the recovery acceleration itself is unchanged (deferred by decision 4).

### Yaw entries at 350–700 km/h

From the jet-drift report: Space + full yaw for 3 s. Each cell is peak incidence / time to 30° / final km/h, HEAD → Phase 8.

| Entry | F-22 | Su-57 |
|---|---|---|
| 350 | 19° / — / 379 → 36° / 2.62 / 211 | 37° / 1.94 / 363 → 54° / 1.83 / 215 |
| 500 | 31° / 2.83 / 489 → 30° / — / 325 | 44° / 1.38 / 447 → 45° / 1.53 / 318 |
| 700 | 42° / 1.27 / 558 → 42° / 1.29 / 443 | 55° / 0.97 / 502 → 55° / 1.01 / 407 |

- **Incidence and timing** stay near HEAD at 450 km/h and above. At 350 km/h the entry decelerates into the band, so it gains some hold late in the 3 s.
- **Final speed** is 85–170 km/h lower, because a yaw-only input now asks for 60% of the control power (option B, decision 6).
- **Pitch entries** are unchanged: all `entry-pitch-*` metrics match HEAD.
- **Handoff tracks** changed: peak incidence +2 to +7°, final speed −51 to +18 km/h. The largest speed change is `f22-notvc` handoff-1, at 327 → 276 km/h.
- **Summary:** 32 of 132 jet-drift tracks moved by more than 1%. All of them contain yaw input. The 0.2 s `cross-*` probes moved by only 0.1° of nose travel.

### B22 personality ordering

Against the [G2 personality table](psm-architecture-review.md#g2-personality-ทิศทางเชิงเปรียบเทียบ-ยังไม่ใช่ตัวเลข):

| Trait | F-22 | Su-57 | Expected | Status |
|---|---:|---:|---|---|
| Pedal travel at 6 s (yaw post-stall) | 140° | 392° | Su-57 > F-22 | ok |
| Kulbit 360° (pitch post-stall) | 3.95 s | 4.17 s | F-22 ≤ Su-57 | ok |
| release45 time to alphaNormal (recovery) | 0.81 s | 0.84 s | F-22 ≤ Su-57 | ok, small gap |
| release45 incidence at 1.5 s (pitch stability) | 8.9° | 9.4° | F-22 ≤ Su-57 | ok, small gap |
| Cobra time to 90° / speed loss | 1.33 s / 42 | 1.42 s / 52 | report | — |

- **Ordering:** every trait is in the expected order.
- **Recovery and stability gaps are small.** G2 suggests about 0.6 s vs 1.0 s for recovery. Widening the gaps is personality tuning left for playtest.
- **B7 is replaced here.** The release45 seed sits below the separation speed band, so B7 (label NORMAL) never arrives without throttle. B22 therefore uses time to alphaNormal.

### Other reports (HEAD → Phase 8)

- **Standard pitch/roll metrics are unchanged:** B1–B5, B10, B12–B16 and B20 in `report.md`, and the pitch/roll rows of `phase4.md`, match HEAD. `baseline.pedal.yawRate` differs by less than 0.05°/s; that 450 km/h scenario sits above the band.
- **Phase 3 B11 peak-yaw ratio:** 0.340 → 0.167.
  - The seed is low speed with the afterburner lit. The Su-57 peak rises from 39.8 to 78.7°/s, while the F-22 stays near 13°/s.
  - With the band disabled this ratio was 0.608, above the ≤ ~0.6 target. With the band it is well inside.
- **B25 yaw rate fraction (crossflow):**
  - At 100 m/s (540 km/h, above the band) it falls by up to 0.07.
  - At 45 m/s (243 km/h, inside the band) the F-22 falls by up to 0.10. The Su-57 moves from −0.11 to +0.40; at β 90 it goes from 1.23 to 1.63.
  - The no-band prototype pushed several cells above 2.
- **B21 camera** (`CAMERA_REPORT_LABEL=camera-phase8`), compared with `camera-after`:
  - Pitch and roll tracks are unchanged. The pedal and entry-yaw tracks change by a few °/s.
  - F-22 handoff: FPM on screen at 70–110° incidence falls from 91% to 63%; view rate p95/max rises from 188/209 to 241/247°/s.
  - Su-57 handoff: extent falls from 1.22 to 1.12.
  - Horizon worst-case minimum FPM at 40–70° falls from 55% to 48% (F-22 handoff).
  - The camera constants were not retuned.

## Retirement and migration

| Item | Change | Reason |
|---|---|---|
| I4 golden equivalence | Retired for `p8-pedal-turn-1` (`goldenPolicy.ts`) | The yaw hold and per-axis control power intentionally change yaw physics. Phase 0 archives stay as safety tracks. |
| Phase 3 "no inherited rate" contract | Amended for yaw below 300 km/h | Owner decision 1 + 5. It still holds for pitch and roll at every speed. |
| B11 target | "F-22 ≤ 50% of Su-57 peak rate" → body yaw travel, Su-57 360°, F-22 ≤ ~60% | Owner decisions 2 and 3. |
| Tests | None removed or loosened | All 568 existing tests pass unchanged. |

## Not done

- **Real non-TVC airframe (F/A-18 or F-16): blocked.** `presentationIds` has only `f22`/`su57` ([schemas.ts:4](../src/content/schemas.ts#L4)), and there is no model or rig. `f22-notvc` remains the validation variant. It shares the F-22's pedal numbers, because the F-22 has no commanded yaw TVC anyway.
- **Recovery acceleration** (findings §3.4) is deferred by decision 4.
- **Personality tuning beyond ordering.** The recovery and stability gaps are small, and they need playtest before any retune.
- **Other Phase 8 work deferred to this phase and not started.** All of it is provisional until playtest:
  - Per-axis and per-aircraft `aero.controlEffectiveness` curves (`defaults.ts` comment).
  - Per-aircraft `breakout` personality tuning; both aircraft still share `breakoutDefaults`.
  - B23 crossflow authority targets (plan §5.2, "ตั้ง target ใน Phase 8").
  - Envelope/path feel calibration and the remaining aero/TVC tuning decisions ([Phase 4 report](psm-phase4-implementation.md), "Phase 8" item).

Phase 8 is therefore **partial**: the pedal turn is delivered, and aircraft personality validation is not.

## Owner decisions requested

1. **Playtest the pedal turn.**
   - Su-57: level about 150 km/h, Space + full yaw.
   - Check whether the persistent yaw rate at very low q feels right after the pedal is held, and whether release hands back cleanly.
2. **Band edges.** 200/300 km/h was chosen from the entry sweep. A 250/350 band restores more hold for entries that decelerate through 350 km/h (F-22 entry-yaw-350 would peak at 66° instead of 36°).
3. **Tolerance flow.** The ±30 km/h tolerance was accepted on the vertical flow, where no yaw weight can meet it: a hammerhead-style pedal from a vertical climb loses speed, and the Su-57 reaches 17 km/h at 360°. This report checks the level flow instead. Confirm the level flow, or name a different flow.
4. **F-22 handoff camera.** FPM visibility at 70–110° fell from 91% to 63%. Retune the Phase 7 camera now, or after the playtest.
5. **Recovery and stability gaps** (0.81 s vs 0.84 s; G2 suggests about 0.6 s vs 1.0 s). Widen them in a later tuning pass?
6. **Remaining Phase 8 scope.** Schedule the deferred personality, effectiveness, breakout and B23 work listed under [Not done](#not-done), after the pedal-turn playtest.

## Reproduce

```sh
npm test
npx vitest run --config vitest.bench.config.ts benchmarks/flight/phase8.report.ts
npx vitest run --config vitest.bench.config.ts benchmarks/flight/pedalEnergy.report.ts
npx vitest run --config vitest.bench.config.ts benchmarks/flight/jetDrift.report.ts
CAMERA_REPORT_LABEL=camera-phase8 npx vitest run --config vitest.bench.config.ts benchmarks/flight/camera.report.ts
```
