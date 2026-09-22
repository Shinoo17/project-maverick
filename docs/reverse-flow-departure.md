# Reverse-flow departure — tail slide nose drop

Implemented against Phase 4.5 source at `4688eed`. Physics version: **`p4.6-reverse-departure-1`**.

This is a natural-aerodynamics increment, not a PSM phase. It adds one force channel, `departure`, and changes how `B10.tailSlide.flipTime` is measured. No controller, allocation, TVC, engine or envelope behavior is touched.

## 1. Problem

The restoring moment is `−stiffness(incidence) · q · sin(alpha)`. `sin(alpha)` is zero at 0° and again at the 180° antipode, so an aircraft hanging tail-down in fully reversed flow has no restoring moment at all. The plan (§ natural aero) assumed the 180° zero was an unstable equilibrium that would shed itself. Measured, it did not: the aircraft left the antipode only through accumulated numerical asymmetry.

Neutral-stick `tailSlide` scenario, before the change (entry: nose up 90°, 60 m/s climbing, 2500 m):

| Aircraft | Velocity reverses | Nose below horizon | After apex | Altitude at flip |
|---|---:|---:|---:|---:|
| f22 | 5.98 s | 22.13 s | 16.15 s | ~1920 m |
| su57 | 5.98 s | 25.31 s | 19.33 s | ~1790 m |

Holding full pitch through the slide reached 13.13 s for the f22, so pilot input did not cover for it either.

## 2. Model

```
departure.pitch = −stiffness · max(q, minPressure) · confidence · reverseFlow · (1 − |sin alpha|) · cos(beta)
departure.yaw = departure.roll = 0
```

- **Separate channel, never folded into restoring.** `restoring` keeps its authored semantics and its I6 invariant: it still vanishes at aligned and reversed flow, and it is still independent of separation. `departure` is what is not zero at the antipode.
- **Weight `1 − |sin alpha|` is the complement of the restoring plane.** Full strength only where the restoring moment has died: at 120° of incidence the weight times reverse flow is 0.067, at 180° it is 1. The weighting limits the *angle*, not the *magnitude*. Because `minPressure` holds the departure pressure up while restoring keeps falling with `q`, departure dominates at low speed even away from the antipode. F-22 at 120°:

  | Airspeed | Restoring | Departure |
  |---:|---:|---:|
  | 60 m/s | 0.224 | 0.089 (0.4×) |
  | 16 m/s | 0.016 | 0.060 (3.8×) |

  This low-speed dominance is what ends the su57 reversal early (§5).
- **`minPressure` is a floor on `q`, not on airspeed.** At the apex of a tail slide the airspeed approaches zero, so a purely `q`-scaled moment would also approach zero exactly where the nose is stuck. The floor gives the airframe the moment it still has from its mass being ahead of the aerodynamic centre.
- **`confidence` multiplies the floored pressure, so the gate stays inside the floor.** Below 2 m/s the flow angles carry no meaning and the channel is exactly zero. An aircraft at rest gains no authority; `neutralRelease` pins this at 0.5 and 1.999 m/s.
- **The sign is always nose-down.** In reverse flow there is no sign ambiguity to resolve from the flow itself, and a deterministic direction is what makes the maneuver repeatable. Canopy-up entries are a pilot-chosen variation for a later phase, not a physics coin flip.
- `cos(beta)` projects out of the pitch plane exactly as the restoring term does, so pure sideslip produces no departure moment.

Because the sign is fixed, restoring and departure oppose each other for alpha between −90° and −180°. They balance at one angle on that side, and the balance is unstable: past it toward −90° restoring wins and the aircraft recovers through −90°; past it toward −180° departure wins and the nose rotates over through the antipode. The balance angle moves with airspeed. It is not a hang, but it explains why two similar low-speed entries on that side can leave in opposite directions.

Continuity (I7) holds: `reverseFlow` reaches zero at 90° of incidence, where `1 − |sin alpha|` is also zero, so the channel fades in from a double zero rather than switching on.

## 3. Tuning

`aeroDefaults.departure = { stiffness: 3, minPressure: 0.3 }`, shared by both airframes, overridable per aircraft through the normal spread.

`minPressure: 0.3` is the `q` of about 49 m/s at the authored `referenceSpeedMps: 90`.

Sweep at `stiffness: 3`, measured on the shipped weighting:

| `minPressure` | B10 after apex (both) | B15 su57 heading |
|---:|---:|---:|
| 0.3 (shipped) | 3.00 s | 31° |
| 0.2 | 3.51 s | 66° |
| 0.15 | 3.95 s | 23° |
| 0.1 | never flips | 29° |

0.3 was chosen for margin against the 4 s target. B15 does not move monotonically with the tuning, which is itself evidence that the su57 reversal outcome is not a stable property of the model (§5).

The constants were swept on an earlier weighting (`reverseFlow² · cos alpha`) and carried over to the shipped `1 − |sin alpha|` weighting without a fresh sweep. The margin is 3.0 s against 4 s; a re-sweep belongs with the playtest, not before it.

`stiffness` and `minPressure` are validated as finite and nonnegative, like the drag coefficients.

## 4. Benchmark semantics

`B10.tailSlide.flipTime` now reports **seconds after apex**, where apex is the first sample with non-positive vertical speed. The scenario enters climbing at 60 m/s, so about 6 s of the old measurement was the entry climb, and the authored `≤ 4 s` target was unreachable by construction. The archived Phase 0 baseline for this id is `null`, so no historical comparison is invalidated.

`metrics.ts` and the Phase 2 tail-slide table use this same apex definition for `flipAfterApex` and its status. The Phase 2 table also keeps its separate `apexTime` / `minSpeed` columns, which describe the minimum-airspeed sample; that sample can differ from the vertical apex by one substep.

## 5. Measured consequences

Benchmarks, before → after:

| Metric | f22 | su57 |
|---|---|---|
| B10 `tailSlide.flipTime` | 16.15 → **3.00 s** after apex | 19.33 → **3.00 s** after apex |
| B5 `kulbit.time360` | 3.78 → 3.81 s | 3.90 → 3.92 s |
| B1/B2/B4 cobra | unchanged | unchanged |
| B15 `reversal.headingChange` | 23.1 → 35.8° | 155.4 → 31.2° |
| B15 `reversal.altitudeLoss` | 51.9 → 112.7 m | 0 → 0 m |

**The su57 `reversal180C` outcome changed materially.** That track pulls a half loop with C until the nose has rotated 180°, then releases. Before, the su57 reached 175° of heading change at 3 s, then sat at 177° of incidence at 35 m/s for roughly two seconds and rode that hang out to a 155° reversal at 88 m/s. That hang is the same antipode hang this channel exists to remove, so it is gone: the nose now drops from 4 s onward and the track ends at 31° of heading change and 51 m/s, a nose-down wingover rather than a reversal.

The f22 was not relying on the hang and improved slightly.

B15 is report-only and has no authored target. The owner accepted the change on 2026-09-23 and deferred the question to playtest. If a su57 reversal is wanted as a maneuver, the right answer is a pilot-commanded capability, not a free attitude hang produced by missing physics.

## 6. Other effects

- **Both airframes now flip at the same 3.00 s after apex.** They differed by 3.2 s before, tracking their different 180° restoring stiffness (0.45 vs 0.25). The shared departure channel dominates per-airframe restoring in reverse flow, so airframe differentiation in this one regime is currently absent. Moving `departure` into the per-aircraft profiles is the lever if playtest wants it back.
- **One invariant was relaxed.** The backwards 130 m/s fixture in `tests/invariants/neutralRelease.test.ts` asserted that speed never increases. The departure bias tips that fixture into a dive, so speed now rises while altitude pays for it. The test asserts monotonically decreasing altitude instead; the total-energy bound and its epsilon are unchanged.
- **The force ledger has a new term.** Rate reconstruction is now `aero + floor + actualTvc + stabilityDamping + naturalRestoring + naturalDeparture + naturalDamping`, pinned in `aerodynamics`, `flightInstrumentation` and Phase 3 invariant tests. The Flight Lab HUD shows `naturalDeparture` next to `naturalRestoring`.
- **Existing saved replays are rejected**, as the profile version changed. Goldens are not regenerated: `goldenPolicy.ts` retires I4 output equivalence for this version against the Phase 0 archive, as the preceding physics versions do.

## 7. Files changed

- [src/game/flight/aerodynamics.ts](../src/game/flight/aerodynamics.ts) — the channel
- [src/game/flight/stepFlight.ts](../src/game/flight/stepFlight.ts) — integration and ledger record
- [src/game/flight/flightForces.ts](../src/game/flight/flightForces.ts), [profileTypes.ts](../src/game/flight/profileTypes.ts), [validateProfile.ts](../src/game/flight/validateProfile.ts), [profile.ts](../src/game/flight/profile.ts)
- [src/content/flight-profiles/defaults.ts](../src/content/flight-profiles/defaults.ts) — shared tuning
- [src/features/flight/PlaygroundHud.tsx](../src/features/flight/PlaygroundHud.tsx), [src/locales/en.ts](../src/locales/en.ts), [src/locales/th.ts](../src/locales/th.ts)
- [benchmarks/flight/metrics.ts](../benchmarks/flight/metrics.ts), [phase2.report.ts](../benchmarks/flight/phase2.report.ts), [goldenPolicy.ts](../benchmarks/flight/goldenPolicy.ts)
- [tests/aerodynamics.test.ts](../tests/aerodynamics.test.ts), [tests/flightInstrumentation.test.ts](../tests/flightInstrumentation.test.ts), [tests/invariants/neutralRelease.test.ts](../tests/invariants/neutralRelease.test.ts), [tests/invariants/phase3.test.ts](../tests/invariants/phase3.test.ts)

## 8. Open for playtest

1. Does the 3 s nose drop read as a tail slide, or does it still hang too long at the top?
2. Should the f22 and su57 differ in how fast they fall out of a slide?
3. Is the su57 flat reversal wanted back as a commanded maneuver?
4. Half roll down during a slide is still slow: roll authority at full separation gives about 22.5° in 5 s. Out of scope here; it belongs to `controlEffectiveness` tuning.
