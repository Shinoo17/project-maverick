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
After velocity integration, the narrow `legacyTelemetryIncidenceDeg` helper reads
the integrated forward/velocity vectors to supply `maneuver.alpha` without constructing
a second complete airflow observation. That legacy field remains unsigned incidence, not signed alpha.

Instrumentation keeps every Phase 0 field and adds `airflow` and `envelope`.
Vapor reads the same observer; its public sideslip remains radians.
`angleOfAttack` remains available from `stall.ts` for existing callers, with its
formula owned by `airflow.ts`.

`interpretEnvelope` is pure and observe-only. No solver imports or consumes it.
Its transitional meanings are explicit:

| Field | Phase 1 meaning |
|---|---|
| `highAoa` | Smooth unsigned incidence transition from `aero.alphaNormalDeg` to `aero.alphaCriticalDeg`, weighted by flow confidence |
| `separation` | Existing time-smoothed `stall.severity`; no new separation physics |
| `intent` | Zero; breakout is not implemented |
| `limiterOpen` | Existing time-smoothed maneuver blend; not automatic permission |
| `alphaLimitDeg` | `aero.alphaNormalDeg`; observation only, not an enforced limiter or capability estimate |
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
and beta's airspeed cutoff (`airspeed < 0.001`). The alpha cutoff means a negligible
**pitch-plane component at any airspeed**, matching `angleOfAttack`'s existing
convention. It also applies to pure body-Z sideslip at 100 m/s; body-X/Y residues
can previously have produced arbitrary ±90°, ±180° or other angles. Pure body-Y
flow at ordinary speed does not enter this cutoff (its alpha remains ±90°). Speed uses world-space magnitude instead
of recomputing magnitude after rotation. Outside the pitch-plane cutoff, the largest alpha difference across the captured
traces is **2.842e-14°**. Maximum speed and sideslip differences are **1.421e-13 m/s**
and **2.220e-16 rad**, respectively, from floating-point arithmetic.

At the near-rest portion of both `tailSlide` tracks (from substep 717), the old
vapor formula reported approximately **90°** from residual velocity below
**9e-16 m/s**. The shared observer reports **0°**, matching stall's existing cutoff.
This captured example is not the full applicability of the cutoff. At high-speed
sideways flow the convention can change condensation/vortex shaping. At the
near-rest speed above, vapor activation is already zero. These readings do not feed physics.

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

## Review follow-up — 19 September 2026

Approved Phase 1 was committed separately as `c4a108c`. The follow-up retains
Phase 1 scope and the same flight profile version.

| Finding | Disposition |
|---|---|
| M1 | Corrected the disclosure to negligible pitch-plane flow **at any airspeed**. Added a 100 m/s sideslip test with tiny X/Y residues and a body-Y counterexample. Pure body-Y flow itself is not inside the cutoff. |
| M2 | Kept the Final Baseline field name; explicitly documented dimensionless normalized q in both its JSDoc and the plan contract. It is not Pa or `½ρv²`; future authority coefficients and energy thresholds must use this normalization. |
| M3 | Replaced the full end-of-step observation with `legacyTelemetryIncidenceDeg(forward, velocity)`. It reuses the integrator's vectors without allocation and preserves exact arithmetic. Start-of-step observation is unchanged. |
| M4 | Resolved by owner: independent, per-aircraft `aero.alphaNormalDeg` / `aero.alphaCriticalDeg` for unsigned incidence. No envelope physics consumer was added. |
| M5 | Added an explicit Phase 2 migration item for retiring compatibility fields and the 90°-at-rest quirk. Those differences belong to a versioned physics change, with explicit trace attribution. |
| M6 | Renamed the comparator to `compareRecordedLeaves`; recorded strings, booleans and null now require strict equality. Numbers retain the same tolerance. Tests catch changed/missing phase, cause, stopReason and flags. |
| M7 | Named the existing camera band `DECOUPLING_START_DEG` / `DECOUPLING_FULL_DEG`, with a presentation-only comment; no new aircraft tuning knobs. |
| M8 | `stepManeuvers` requires `airflowStart` and derives speed from it. Removed the redundant positional speed and implicit observation. Unit fixtures now set their actual velocity before observing. The caller still owns the start-of-step timing contract. |
| O1 | Deferred. Adding a redundant `betaRad` field solely for ~1e-16 rounding adds synchronization/API cost without useful precision benefit. |
| O2 | Deferred. Making profile optional would require an arbitrary reference speed for q. A separate profile-free geometry API can be considered when profiling justifies it; the full observation currently keeps its explicit normalization contract. |
| O3 | Cobra's controller and benchmark metrics now call the airflow observer directly, avoiding unused envelope and TVC instrumentation. The debug instrumentation API still returns its full documented observation. |

**M4 owner decision (19 September 2026):** retain unsigned incidence and author
independent `aero.alphaNormalDeg` / `aero.alphaCriticalDeg`. A 90° pure sideslip can
therefore have high envelope incidence while signed pitch alpha and stall severity
remain zero; this is the intended separation. Both aircraft start with an independent
20°/30° band to preserve the Phase 1 highAoa observation. These are **provisional
values, not playtest results**; aircraft-specific tuning belongs to subsequent playtests.

The validator requires finite `0 <= alphaNormalDeg < alphaCriticalDeg <= 180`.
No threshold derives from or falls back to a stall field. The existing `separation`
reading still reports legacy stall severity until Phase 2; M4 separates thresholds,
not that transitional observation.

`alphaLimitDeg` now reports `aero.alphaNormalDeg` (20° by default), replacing the old
30° stall-critical placeholder. This is the only changed default envelope reading;
`highAoa` remains the same. It is observe-only, with no limiter or physics effect.
Tests cover the band boundaries, confidence, 100 m/s sideslip versus stall, invalid
profiles, per-aircraft isolation and complete trace neutrality under changed tuning.

I4 remains a refactor gate, not an expectation that deliberate Phase 2 physics will
match Phase 0. Its version check still requires explicit retirement/replacement
when physics changes; the stricter categorical checks do not weaken that policy.

Follow-up validation:

- Full suite: **328 tests / 24 files passed**.
- Dedicated determinism/invariants/stall run: **96 tests passed**, including exact
  30/60/144 FPS replay checks. Typecheck and production build passed (same bundle-size warning).
- `flight:bench` passed; its report remains byte-identical to the pre-Phase-1
  capture, including all **38 metrics** and their statuses.
- All **18** pre-Phase-1 complete traces, including commands and **12,018** samples,
  still match exactly after JSON serialization; no golden files changed.
- Timing check: live level-flight Su-57 at 100 m/s, neutral command, 120 Hz;
  position X reset each step to prevent boundary shutdown; 20,000 warm-up steps,
  best of 7 runs of 300,000 live substeps. Before: **643.003 ms / 2.143 µs**;
  after: **543.113 ms / 1.810 µs**, about **15.5% lower**. This is an informational
  same-session measurement, not a CI threshold or a reproduction of the reviewer's
  different timing fixture. Remaining full start-observation cost is intentional.

M4 implementation validation: **339 tests / 25 files passed**, including all
18 golden tracks and exact 30/60/144 FPS determinism checks. Production build
(including typecheck) passed with the existing bundle-size warning. `flight:bench`
passed and the full report (all 38 metrics) remains byte-identical to Phase 0;
all 18 golden files are unchanged. No physics consumer was introduced and no
playtest-derived threshold values are claimed in this change.
