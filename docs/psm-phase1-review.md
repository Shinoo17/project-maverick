# Phase 1 — Airflow / Envelope observation review

Source of truth: [Final Baseline Rev. 3](psm-implementation-plan.md), Phase 1 only.
Baseline commit: `081790b` (Phase 0 review fixes), following `276508e` (Phase 0 instrumentation).
`flightProfileVersion` remains `p3-powered-psm-1`. No golden files or tolerances changed.
The pre-existing untracked `docs/psm-architecture-review.md` was left untouched.

## Implementation

`airflow.ts` owns flow geometry. `observeAirflow(state, profile)` returns a fresh,
read-only-by-convention observation; it never writes aircraft state or profile.
There is no stored airflow cache to become stale on spawn, reset, replay or render interpolation.

- `airspeed`, signed `alphaDeg`, signed `betaDeg`, unsigned `incidenceDeg`.
- `dynamicPressure = (airspeed / profile.aero.referenceSpeedMps)²`, unclamped.
- `forwardFlow`, `reverseFlow`, and `confidence = smoothstep(airspeed, 2, 10)`.
- `legacy.psmIncidenceRad` and `legacy.telemetryIncidenceDeg` retain the exact old
  arithmetic and degenerate-flow conventions. They are transitional compatibility
  readings, not additional control models. All incidence calculations now live in
  this module. New observation consumers use the canonical fields.

Physics reads `airflowStart` before integration. `stall.aoaDeg` is signed alpha
from that observation. PSM and its existing TVC/drag inputs consume the same
start observation, preserving their unsigned incidence convention.
After velocity integration, `airflowEnd` supplies the existing `maneuver.alpha`
telemetry. That legacy field remains unsigned incidence, not signed alpha.

Instrumentation keeps every Phase 0 field and adds `airflow` and `envelope`.
Vapor reads the same observer; its public sideslip remains radians.
`angleOfAttack` remains available from `stall.ts` for existing callers, with its
formula owned by `airflow.ts`.

`interpretEnvelope` is pure and observe-only. No solver imports or consumes it.
Its transitional meanings are explicit:

| Field | Phase 1 meaning |
|---|---|
| `highAoa` | Smooth incidence transition from stall recovery to critical angle, weighted by flow confidence |
| `separation` | Existing time-smoothed `stall.severity`; no new separation physics |
| `intent` | Zero; breakout is not implemented |
| `limiterOpen` | Existing time-smoothed maneuver blend; not automatic permission |
| `alphaLimitDeg` | Existing critical stall angle; not a new enforced AoA limiter or capability estimate |
| `gAllowance` | Existing `1 + highG * 0.6` turn-budget multiplier |
| `stabilityAssist` | Legacy normal-flight blend weight `1 - maneuver.blend` |
| `recoveryAssist` | That blend weight during legacy recovery, otherwise zero; not Phase 5 assistance |

The observer reuses existing memory. It adds no second smoothing clock, authority,
intent integrator, forces or rate updates.

## Profile constants

Both aircraft receive independent copies of the shared defaults. The validator
checks finite values, nonnegative coefficients, positive divisors and ordered bands.

| Profile field | Preserved value |
|---|---:|
| `aero.referenceSpeedMps` | 90 |
| `aero.highSpeedMps` | 160 |
| `maneuver.lateralAcceleration` | 55 m/s² |
| `maneuver.psmDrag` | 0.0025 |
| `flight.airbrakeDeceleration` | 30 m/s² |
| `flight.afterburnerAcceleration` | 38 m/s² |
| `maneuver.highGMinSpeedMps` / `highGMaxSpeedMps` | 75 / 190 |
| `maneuver.highGSpeedFadeMps` | 15 |
| `maneuver.recoveryIncidenceRad` | 0.3 rad = approximately 17.1887° |
| `maneuver.recoverySpeedMps` | 60 |

The plan's “17°” is a rounded description of the original `0.3 rad` threshold.
Keeping radians avoids silently changing its comparison boundary. The hangar
profile panel now shows the authored recovery angle/speed condition, in Thai and English.

## Presentation changes

Camera cinematic target is now
`max(smoothstep(incidenceDeg, 20, 60) * confidence, legacyPhaseWeight)`.
This exposes actual decoupling without C. The old active/recovery fallback,
response rates, velocity-look share and reduced-motion behavior remain in place.
No Phase 7 camera polish or input changes were added.

Vapor now shares alpha's pitch-plane cutoff (`hypot(body.x, body.y) < 0.001`)
and beta's airspeed cutoff (`airspeed < 0.001`), so otherwise ill-defined near-rest
angles follow the observation convention. Speed uses world-space magnitude instead
of recomputing magnitude after rotation. Outside the pitch-plane cutoff, the largest alpha difference across the captured
traces is **2.842e-14°**. Maximum speed and sideslip differences are **1.421e-13 m/s**
and **2.220e-16 rad**, respectively, from floating-point arithmetic.

At the near-rest portion of both `tailSlide` tracks (from substep 717), the old
vapor formula reported approximately **90°** from residual velocity below
**9e-16 m/s**. The shared observer reports **0°**, matching stall's existing cutoff.
This is an explicit change to a presentation reading, not a physics discrepancy;
vapor activation is already zero at that speed. These readings do not feed physics.

Camera coverage is automated: real decoupling without C, phase fallback, reduced
motion, low-speed confidence, finite vertical-flight motion and non-mutation.
An interactive visual playtest was not performed in this implementation pass.

## Regression evidence

Before editing: `npm test` passed **282 tests / 21 files**, including all 18 golden
tracks and 30/60/144 FPS checks. `npm run flight:bench` passed. The benchmark JSON
and complete closed-loop scenario traces were captured outside the repository
before code changes, without regenerating goldens.

After implementation:

| Check | Result |
|---|---|
| Full `npm test` | **320 tests / 24 files passed** |
| Dedicated determinism/invariants/stall run | **89 tests / 3 files passed**, including exact 30/60/144 FPS and replay checks |
| `npm run typecheck` | Passed |
| `npm run build` | Passed; Vite reports its >500 kB bundle warning |
| `npm run flight:bench` | Passed; **38 metric values and statuses unchanged** |
| Phase 0 golden comparison | **18 tracks, 418 recorded samples**, original tolerance unchanged |
| Additional pre-edit trace comparison | **12,018 samples** including entry and every substep; commands and sample counts identical |
| Combined exact numeric comparison | **559,620 numeric leaves**, zero differences; nonnumeric leaves also identical |
| Golden file integrity | All **18 files byte-identical to HEAD** |
| Benchmark JSON | Byte-identical to pre-edit capture |

The extra trace comparison included all original state fields and cumulative nose
rotation, not only final position/rates. There is **no observed physics discrepancy**
to explain and no change to the replay/profile version.

Benchmark report SHA-256 before and after:
`9ac98df6afd5b6a339e74f69e488178e8bd4187ffcd51de6108f29ef4946c0b7`.
This is supplemental evidence; the existing per-field tolerance checks remain the CI contract.

The six pre-existing out-of-target benchmark rows remain unchanged: Cobra peak
incidence and heading change, plus Kulbit time360, on each aircraft. These are
Phase 0 tuning observations, not Phase 1 regressions. Tail-slide flip time remains
unreached (`null`). No target was retuned.

New tests cover signed/sideways/reverse/zero flow, rotation invariance, pressure
reference, confidence, start/end timing, pure observation, profile validation and
actual solver use of the migrated constants. All original tests remain intact.

## Scope boundary

Phase 1 is ready for review. Phase 2 has not started. Natural restoring,
new separation physics, engine spool, Aero/TVC allocation, automatic breakout,
new recovery assistance and legacy-gate removal remain deferred. The Phase 3
capacity/geometry questions in the plan's errata remain unresolved by design.
