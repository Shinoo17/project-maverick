# Phase 8 input — pedal turn energy

Measured at `0544e52` (Phase 6). Physics version: `p6-legacy-gates-1`. No physics change is proposed in this note. It records findings for Phase 8 (aircraft validation) and the decisions the owner needs to make there.

Reproduce with `npx vitest run --config vitest.bench.config.ts benchmarks/flight/pedalEnergy.report.ts`. The report is informational only. It writes `benchmarks/flight/out/pedal-energy.{json,md}`. All speeds below are arcade km/h (HUD).

## 1. Intended maneuver

```
~550 km/h → pitch to 90° → bleed energy → ~140–150 km/h → high AoA
→ pedal (yaw) 360° at roughly constant speed → throttle up to recover
```

In play, speed climbs back toward ~351 km/h during the pedal phase, and the nose does not complete the turn. The first question was whether a 3% minimum thrust causes this, and whether lowering it to 1% would help.

## 2. There is no minimum thrust

[`stepSpeed`](../src/game/flight/speed.ts) requests `trim = drag · v²` plus the W drive, control power and burner. Trim holds the current speed. It has no floor and falls to 0% as speed falls to zero.

| Speed | Trim engine output (both aircraft) |
|---:|---:|
| 150 | 0.54% |
| 250 | 1.5% |
| 351 | 2.96% |
| 450 | 4.86% |
| 550 | 7.26% |

The "3%" on the HUD engine readout is trim at about 351 km/h. It coincides with `minPoweredMps: 65` (351 km/h), but that value is only the floor for **S deceleration** ([speed.ts:33](../src/game/flight/speed.ts#L33)). It does not limit thrust, and Airbrake takes speed below it. Changing a minimum thrust to 1% is therefore not possible and would not change the result.

## 3. Findings

### 3.1 Control power adds ~70% dry thrust as soon as the pilot yaws

`flightDefaults.controlPower = 0.7` ([defaults.ts:32](../src/content/flight-profiles/defaults.ts#L32)). Any maneuver intent (`max(envelope.intent, envelope.continuation)`) requests up to 70% of dry thrust on top of trim ([speed.ts:43-44](../src/game/flight/speed.ts#L43-L44)).

Vertical pedal flow: climb with the nose held at 88° until 150 km/h, then Space + full yaw for 5 s.

| Aircraft | Pedal start | Pedal end | Peak engine | Control power | Yaw travel | Nose pitch start → end |
|---|---:|---:|---:|---:|---:|---:|
| F-22 | 150 | 178 | 70.8% | 70% | 13° | 88° → 77° |
| Su-57 | 150 | 179 | 70.8% | 70% | 64° | 88° → 39° |

Engine output jumps from ~0.6% to ~70% within the first second of yaw input. With F-22 `maxThrust: 50` that is ~35 m/s², or about 3.5 g along the nose. Near vertical, Airbrake (`airbrakeDeceleration: 30`) and gravity (9.81 m/s²) cancel most of it. The remainder still raises speed by ~30 km/h in 5 s.

### 3.2 At low speed gravity takes the aircraft back to ~350 km/h

Level flight at 150 km/h, 6 s:

| Aircraft | Case | End speed | Peak engine | Nose rotation | Nose pitch at end | Altitude loss |
|---|---|---:|---:|---:|---:|---:|
| F-22 | neutral | 281 | 1.8% | 25° | −25° | 121 m |
| F-22 | yaw | 352 | 21.8% | 36° | −3° | 77 m |
| F-22 | Space + yaw | 381 | 73.3% | 40° | −6° | 100 m |
| F-22 | Space + full pull | 136 | 71.4% | 243° | −63° | −51 m |
| Su-57 | neutral | 280 | 1.8% | 25° | −25° | 121 m |
| Su-57 | yaw | 381 | 33.0% | 60° | −11° | 79 m |
| Su-57 | Space + yaw | 398 | 73.6% | 109° | −66° | 131 m |
| Su-57 | Space + full pull | 120 | 71.3% | 223° | −43° | −51 m |

With neutral input and 1.8% engine the aircraft still gains 130 km/h. Lift cannot hold 1 G at 150 km/h, the nose drops and the aircraft dives. This is correct physics and not a thrust problem. Yaw input adds control power on top of the dive, so the "yaw" cases pass 351 km/h within 6 s.

Space + full pull is the only case that keeps speed near constant. The nose rotates through high incidence, so Airbrake, gravity and high-alpha drag absorb the same ~70% thrust. The pedal turn needs a similar balance between thrust and loss while the nose stays high.

### 3.3 Yaw authority at low speed is too small for 360°

Across all runs, the best yaw result is Su-57 with Space at 109° in 6 s. F-22 gets 13° in 5 s near vertical and 40° in 6 s level. A 360° pedal turn does not happen with either aircraft, even if speed were held constant.

This matches the Phase 3 resolution: F-22 commanded yaw TVC = 0, so its yaw comes only from aero and the arcade floor, and both fall with `q`. Su-57 yaw TVC scales with thrust, which is why it keeps some rotation near vertical.

### 3.4 Recovery is near-instant

With W + Shift after the pedal phase, both aircraft reach 351 km/h in ~0.84 s. After 6 s they are at ~1400 km/h, which is the afterburner top speed. `afterburnerAcceleration: 38` plus `acceleration: 24` is ~62 m/s² at low speed. This is outside the pedal-turn question, but it removes most of the cost of bleeding energy and belongs to the same Phase 8 energy review.

## 4. Constraints from existing contracts

[jet-drift-implementation-plan.md §5](jet-drift-implementation-plan.md) already constrains how control power may change:

- Control power is driven by explicit pilot maneuver intent. It is **not** a target-speed governor and **not** a requested-TVC-authority feedback loop.
- "Do not gate real thrust to hold drift, guarantee speed recovery at every attitude, or create thrust that only the nozzle budget sees."
- Changing drag at the same state and input must not increase the requested control power. Changing explicit input may.

Any fix below must respect these rules or explicitly amend them.

## 5. Options for Phase 8

| # | Change | Effect on pedal flow | Cost / conflict |
|---|---|---|---|
| A | Lower `controlPower` per aircraft (for example 0.35–0.5) | Less forward acceleration during yaw | Su-57 yaw and pitch TVC authority fall with thrust. Kulbit/Cobra benchmarks (B1–B5) and B14 need a re-check. |
| B | Scale control power by input axis, for example less for yaw-only intent than for pitch intent | Pedal phase stays slow while Cobra/Kulbit keep full power | Still intent-driven, so allowed by §4. Adds one tuning value per aircraft. |
| C | Raise low-`q` yaw authority (aero yaw floor for F-22, yaw TVC gain for Su-57) | 360° completes before speed builds | F-22 must keep commanded yaw TVC = 0. Needs a B11 target (currently only "F-22 ≤ 50% of Su-57"). |
| D | Speed hold during post-stall (thrust tracks a target speed) | Constant speed as intended | Conflicts with §4 (target-speed governor, gating real thrust). Not recommended. |
| E | Reduce W + Shift acceleration at low speed | Recovery has a real energy cost | Changes normal-flight feel. Separate from the pedal fix. |

Recommendation: **C first, then B.** C is the reason the maneuver cannot happen at all. B then controls speed during the pedal phase without weakening Cobra/Kulbit. Treat A only as a fallback and D not at all.

## 6. Owner decisions requested

1. Is the target a full 360° pedal turn for both aircraft, or 360° for Su-57 and a smaller angle for F-22 (no yaw TVC)? Give a time target for B11.
2. What speed change is acceptable during the pedal phase (for example ±30 km/h over 360°)?
3. Accept option B (per-axis control power) as an amendment within §4, or keep a single `controlPower` value?
4. Should recovery acceleration (§3.4) be reviewed in Phase 8 or left for later?
