# Phase 4 — Automatic breakout + minimal continuous recovery

Implemented against the current Phase 3 source at `527a25aee2251c8efb53e97c9b008185b24433eb`, including signed/coupled TVC capacity and AD16 airflow effectiveness. Current physics version: **`p4-automatic-envelope-2`** (review fixes).

**Review follow-up:** both MAJOR findings are fixed. The owner selected P4-1 option 1: saturation gates G only; low-energy breakout uses demand × permission. P4-2 controller continuity and the Phase 4 benchmark/test hygiene fixes are implemented. All tables below use version 2; §14 records the review resolution and remaining later-phase items.

## 1. Implementation summary

Automatic high-AoA permission uses demand, energy, brake/power intent, low-weight sustained demand and unsigned incidence. Current-rate saturation controls the automatic G allowance separately. Normal flight does not require C. C remains an explicit debug limiter override and enters the same controller/allocation path. X remains airbrake, Space remains High-G, and Shift supplies power intent/burner.

The required ordering was followed: path/gravity phase dependencies were removed first, and the phase-independence test plus all twelve neutral-release safety tests passed before automatic opening was enabled. The subsequent implementation adds continuous limiter integration and its I7 invariant together.

The controller existed in Phase 3. It was extended, not replaced. No physical aero, TVC, engine, allocation or floor tuning was changed. Phase 5 recovery scheduling was not implemented. The authority boundaries and invariants hold, and both review blockers have been resolved. Several feel targets also remain outside range, documented below.

## 2. Files changed

**Flight model and schema**

- [src/content/flight-profiles/defaults.ts](../src/content/flight-profiles/defaults.ts)
- [src/content/flight-profiles/f22.ts](../src/content/flight-profiles/f22.ts)
- [src/content/flight-profiles/su57.ts](../src/content/flight-profiles/su57.ts)
- [src/game/flight/controller.ts](../src/game/flight/controller.ts)
- [src/game/flight/envelope.ts](../src/game/flight/envelope.ts)
- [src/game/flight/flightForces.ts](../src/game/flight/flightForces.ts)
- [src/game/flight/instrumentation.ts](../src/game/flight/instrumentation.ts)
- [src/game/flight/intent.ts](../src/game/flight/intent.ts)
- [src/game/flight/maneuvers.ts](../src/game/flight/maneuvers.ts)
- [src/game/flight/profile.ts](../src/game/flight/profile.ts)
- [src/game/flight/profileTypes.ts](../src/game/flight/profileTypes.ts)
- [src/game/flight/stepFlight.ts](../src/game/flight/stepFlight.ts)
- [src/game/flight/validateProfile.ts](../src/game/flight/validateProfile.ts)
- [src/game/state/WorldState.ts](../src/game/state/WorldState.ts)

**Input, presentation and practice**

- [src/features/flight/FlightInstruments.tsx](../src/features/flight/FlightInstruments.tsx)
- [src/features/flight/PlaygroundHud.tsx](../src/features/flight/PlaygroundHud.tsx)
- [src/features/flight/flight.css](../src/features/flight/flight.css)
- [src/features/flight/telemetry.ts](../src/features/flight/telemetry.ts)
- [src/game/input/FlightInput.ts](../src/game/input/FlightInput.ts)
- [src/game/input/mouseStick.ts](../src/game/input/mouseStick.ts)
- [src/game/playground/practice.ts](../src/game/playground/practice.ts)
- [src/locales/en.ts](../src/locales/en.ts)
- [src/locales/th.ts](../src/locales/th.ts)
- [src/render/FlightScene.tsx](../src/render/FlightScene.tsx)

**Tests**

- [tests/aerodynamics.test.ts](../tests/aerodynamics.test.ts)
- [tests/airflow.test.ts](../tests/airflow.test.ts)
- [tests/automaticMouse.test.ts](../tests/automaticMouse.test.ts)
- [tests/flight.test.ts](../tests/flight.test.ts)
- [tests/flightBenchmarks.test.ts](../tests/flightBenchmarks.test.ts)
- [tests/flightHandling.test.ts](../tests/flightHandling.test.ts)
- [tests/hud.test.ts](../tests/hud.test.ts)
- [tests/invariants/flight.invariants.test.ts](../tests/invariants/flight.invariants.test.ts)
- [tests/invariants/helpers.ts](../tests/invariants/helpers.ts)
- [tests/invariants/neutralRelease.test.ts](../tests/invariants/neutralRelease.test.ts)
- [tests/invariants/phase3.test.ts](../tests/invariants/phase3.test.ts)
- [tests/invariants/phase4.test.ts](../tests/invariants/phase4.test.ts)
- [tests/maneuvers.test.ts](../tests/maneuvers.test.ts)
- [tests/phase3Boundaries.test.ts](../tests/phase3Boundaries.test.ts)
- [tests/phase4Review.test.ts](../tests/phase4Review.test.ts)

**Benchmarks and report**

- [benchmarks/flight/goldenPolicy.ts](../benchmarks/flight/goldenPolicy.ts)
- [benchmarks/flight/harness.ts](../benchmarks/flight/harness.ts)
- [benchmarks/flight/metrics.ts](../benchmarks/flight/metrics.ts)
- [benchmarks/flight/phase3-metrics.json](../benchmarks/flight/phase3-metrics.json)
- [benchmarks/flight/phase4.report.ts](../benchmarks/flight/phase4.report.ts)
- [benchmarks/flight/permissionProbes.ts](../benchmarks/flight/permissionProbes.ts)
- [benchmarks/flight/targets.ts](../benchmarks/flight/targets.ts)
- [docs/psm-implementation-plan.md](../docs/psm-implementation-plan.md)
- [docs/psm-phase4-implementation.md](../docs/psm-phase4-implementation.md)
- [docs/psm-phase4-review.md](../docs/psm-phase4-review.md)

## 3. Profile/schema changes

`AircraftFlightProfile.breakout` is a required, explicit group. Both aircraft use the same defaults; the existing no-TVC validation clone inherits them independently.

| Field | Default | Meaning |
|---|---:|---|
| `qLow` | 0.5 | Full low-energy permission below this normalized q |
| `qHigh` | 1.8 | No energy permission above this normalized q |
| `baseWeight` | 0.15 | Unassisted demand contribution |
| `brakeWeight` | 0.35 | Brake contribution |
| `powerWeight` | 0.25 | Power-input contribution |
| `comboWeight` | 0.8 | Additional brake × power contribution |
| `sustainWeight` | 0.05 | Small sustained-demand contribution |
| `openRate` | 3 | Base exponential opening rate, 1/s |
| `closeRate` | 2 | Exponential closing rate, 1/s |
| `brakeBoost` | 1 | Brake opening-rate multiplier contribution |
| `powerBoost` | 1 | Power opening-rate multiplier contribution |
| `hardTurnG` | 1.6 | Maximum multiplier of the normal turn budget, not an absolute G value |

Here `q = (airspeed / aero.referenceSpeedMps)²`, not pressure in Pa. Validation rejects missing/nonfinite/negative fields, inverted q bands, zero response rates, weights outside 0–1, G multipliers below one, and boosted-rate/turn-budget overflow. No aircraft personality differences were introduced.

With full demand and settled brake/power intent, the unsustained weights sum to **1.55**. Thus `clamp(1.55*E,0,1)` reaches full target at **E=0.645161**, **q=1.022561**, **91.010 m/s**, or **491.452 arcade km/h**. Once sustained demand settles, the extra 0.05 makes the sum **1.60**, moving this boundary to **E=0.625**, **q=1.040635**, **91.810 m/s**, or **495.776 arcade km/h**. These are target saturation boundaries; exponential integration approaches the target over time.

Below those speeds (lower q / higher E), the full combo target is saturated and cannot discriminate energy further. Above them, the energy gate continues reducing permission until qHigh (120.748 m/s / 652.037 arcade km/h). Thus the **low-q portion**, not the upper-q half, loses discrimination. No weights or q limits were retuned.

The new report-only `breakout.maxSpeedLimiter90` row holds attached flow at a fixed speed, starts with fresh intent/closed limiter, and applies X+Shift+full pull for eight seconds. It measures the highest speed reaching 0.9 to **0.001 m/s** resolution, so deceleration and the H latch cannot inflate the result. All three profiles reach it at **94.208317 m/s / 508.725 arcade km/h**; the upper bracket **94.209188 m/s** remains below 0.9. The steady target calculation gives E=0.5625 / q=1.095707, consistent with the measured boundary. This measures permission only, not aircraft entry capability.

`EnvelopeFactors` carries `energyPermission`, `limiterTarget` and `intent` as **diagnostics only outside envelope.ts**: instrumentation records them as part of the whole envelope object; there is no downstream physics consumer. `stepEnvelope` uses `limiterTarget` internally to integrate permission. `hardTurnBlend` is the shared rate/drag blend consumed by the controller; changing the G allowance mapping must not alter it. `stabilityAssist` and `recoveryAssist` were deleted because neither had a consumer. Wiring them now would introduce an unrequested damping change before Phase 5. Existing servo damping remains dissipative and tested, but its sign/bound checks are not evidence about an unimplemented recovery assist: Phase 5 must add real assist-specific I15 coverage when it reintroduces those fields. The last-substep force ledger records the integrated envelope and `{ previous, target, rate, automatic }` limiter transition. Labels are derived observations, not persistent physics state.

The normalized command format is unchanged, so replay schema remains 1. `flightProfileVersion` changes from `p3-flow-effectiveness-4` to `p4-automatic-envelope-1`, then `p4-automatic-envelope-2` for the controller continuity repair and the owner-approved separation of saturation from breakout; public replay rejects older physics. `goldenPolicy.ts` explicitly extends archived-input replay for this version. Every historical Phase 0 golden remains unchanged.

## 4. Exact breakout formula

Using `smoothstep(lo, hi, value)` notation:

```text
D  = smoothstep(0.6, 1, hypot(pitch, yaw))
S  = smoothstep(1, 1.6, requestedTurn / max(closedTurnBudget, 1e-9))
T += (D - T) * (1 - exp(-dt/0.4))
B += (airbrake - B) * (1 - exp(-12*dt))
Pi = max(afterburner ? 1 : 0, max(0, speedAdjust)*0.4)
E  = 1 - smoothstep(qLow, qHigh, q)
H  = smoothstep(aero.alphaNormalDeg, aero.alphaCriticalDeg, unsignedIncidenceDeg)

demandGate = D // owner-approved P4-1 resolution; S gates G only
permission = E*(baseWeight + brakeWeight*B + powerWeight*Pi + comboWeight*B*Pi)
           + sustainWeight*T*E
intent = clamp(demandGate*permission, 0, 1)
target = max(intent, H*D)
k = target > limiterOpen
    ? openRate*(1 + brakeBoost*B + powerBoost*Pi)
    : closeRate
limiterOpen += (target - limiterOpen)*(1 - exp(-k*dt))
alphaLimitDeg = lerp(aero.alphaNormalDeg, aero.maxControllableAlphaDeg, limiterOpen)

autoG = D*S*(1-E)
hardTurnBlend = max(autoG, smoothedManualHighG)
gAllowance = lerp(1, hardTurnG, hardTurnBlend)
```

C may explicitly set `limiterOpen=1` when the debug comparison is enabled. Releasing C immediately rejoins exponential integration; it does not jump closed. H is the requested unsigned-incidence factor. `highAoa=H*confidence` preserves the existing near-rest fade for neutral smoothing and mouse/presentation observations; the H latch itself uses the specified formula. Releasing pitch/yaw demand makes both target terms zero, including at high incidence.

### Controller saturation feedback

The feedback compares the rate permitted by the **previous substep’s limiter**, before turn-budget restriction, with normal path support. `stepFlight` measures saturation before `stepEnvelope` advances `limiterOpen`: the one-flight-substep lag (1/120 s) is deliberate, avoiding circular saturation/permission feedback. It is also evaluated before automatic/manual G allowance, avoiding a self-referential G denominator:

```text
speedResponse = min(speed/referenceSpeed, 1)*clamp(highSpeed/max(speed,1), 0.6, 1)
lift = min(1,q)*confidence
surfaceControl = lift*(1 - separation*(1-stall.controlAuthority))
normalLimit = flight.turnAcceleration*speedResponse
closedTurnBudget = normalLimit*surfaceControl/max(speed,1)*flight.turnRateReserve
previousAlphaLimit = lerp(alphaNormalDeg, maxControllableAlphaDeg, previousLimiterOpen)
previousRatePermission = lerp(speedResponse, sqrt(previousAlphaLimit/max(alphaNormalDeg,1)), previousLimiterOpen)
requestedTurn = hypot(pitch*flight.pitchRate, yaw*flight.yawRate)*previousRatePermission
```

The version-1 full-open multiplier made `S` effectively inert. It has been removed. At the 450 arcade km/h entry, faithful closed-limiter saturation is zero while energy permission is approximately 0.815. The owner therefore approved removing `S` from the breakout gate instead of changing rate/authority tuning. `T` now integrates demand alone at the same 0.4 s time constant and low weight, so saturation cannot influence breakout indirectly. `PilotIntent` receives only scalar controller feedback and pilot inputs, with no profile/aircraft/engine imports. The denominator retains the available path support used by the continuous path port. No schema fields or tuning values changed in the review fix.

## 5. Continuous path/gravity port

The old phase-driven weights now use these continuous physical signals:

```text
attachment = 1 - separation
lift = min(1,q)*confidence
reattachment = 1 - smoothstep(alphaNormalDeg, alphaCriticalDeg, incidenceDeg)
pathGrip = lerp(maneuver.activeGrip, maneuver.recoveryGrip, reattachment)
separatedLateralLimit = lerp(maneuver.lateralAcceleration,
                             maneuver.recoveryAcceleration, reattachment)*lift
```

Separated alignment uses the existing path response and speed response, multiplied by `pathGrip*lift` and capped by `separatedLateralLimit`. Attached alignment retains the existing nose anticipation and normal path response, capped by the common G allowance and multiplied by `surfaceControl`. The final lateral force interpolates separated → attached alignment by `attachment`.

```text
gravityBlend = 1 - min(1, flight.turnAcceleration*lift/flight.gravity)*(1-separation)
```

Attached flow supports the arcade horizon when available lift can supply one G. Separation or insufficient q returns cross-path gravity continuously. Along-path gravity and the existing translation work/path-rate guards remain intact.

Reverse-path alignment no longer checks phase. Its old normalization threshold now uses `smoothstep(0.8,1,-dot(nose,path))`; the deterministic body-up fallback remains at the antipode. This avoids introducing an incidence discontinuity while removing the legacy phase condition.

No path/gravity term reads `maneuver.phase`, C, or a binary limiter state. Legacy rotation counters and phase bookkeeping remain observers for debug comparison. Natural restoring and damping run from the first substep after release. There is no recovery delay, anti-spin controller, extra recovery angular drive, or nose precision scheduler.

## 6. Controller/allocation flow

```text
PilotCommand → closed-envelope rate feedback → existing PilotIntent
Airflow + separation + PilotIntent → EnvelopeFactors (permission)
EnvelopeFactors + body-axis input/rates → requestControl()
Airflow + AeroFlowEffectiveness + actual thrust → AuthorityBudget (capability)
Controller drive request + signed budget → allocate()
Allocated aero/floor + realized TVC + dissipative servo + natural aero → rates
```

The controller consumes `alphaLimitDeg`, `gAllowance` and `hardTurnBlend`, applies unsigned-incidence restriction to outward pitch/yaw requests, and produces body-axis drive and dissipative servo terms. It has no nozzle state or geometry. Space and automatic demand share `hardTurnBlend`. Path acceleration consumes `gAllowance`; rate shaping and turn drag consume the blend directly, without inverting the allowance curve.

The integrated angular update, signed capacity selection, coupled nozzle reconciliation, actuator lag accounting, aero-first allocation and floor gap-fill are unchanged. `limiterOpen` never supplies a force or torque.

## 7. Tests and presentation

New coverage includes:

- Exact exponential opening, closing, brake/power boosted opening, H latch, demand release, and fixed-observation subdivision independence.
- Hard per-substep I7 audit across automatic scenarios, original scenarios and fuzz, including a deliberately corrupted limiter jump that the audit rejects.
- High-speed G permission; manual Space through the same controller path; low-energy boosted vs beginner opening.
- All non-C scenario commands, all three existing profiles, no-TVC zero powered authority, and continued Phase 3 allocation/moment/work/path audits on automatic scenarios.
- Phase/blend/cause independence, label/telemetry observation neutrality, and automatic entry with legacy capability/altitude/speed gates ineligible.
- Immediate natural recovery from an explicitly seeded 100°/20 m/s rotating release, plus retained near-rest and C-release safety fixtures.
- Exact 30/60/144 FPS automatic replay and a positional mouse trace that actually enters the high-AoA frame blend.
- Mouse interpolation including inverted/antipodal cases, unchanged X/Space/Shift bindings, schema rejection and reverse-path continuity.

Old assertions that described retired behavior were updated explicitly: C no longer switches mouse frames, legacy phase no longer selects warnings, Space no longer stacks another boost on an already-maximal automatic G request, and the high-energy C+W fixture no longer guarantees a post-stall peak just by holding C. Its release safety still runs; review fixes explicitly assert its peak remains below 70° and completion does not increment, rather than conditionally skipping completion coverage. Separate seeded tests keep post-stall release coverage. Mouse tests retain upright/inverted and roll-direction checks independently of pitch depth. The old normal/manual/fast turn feel ratios are preserved as report-only measurements in `phase4.json`, not silently retuned.

Warnings, glass flags and the main maneuver status now consume envelope observations/labels. The second review restores severity-banded advisories for held demand: separation above 0.1 through 0.5 uses `hudStallRecovering`, and above 0.5 uses `hudStall` via DEPARTED. At incidence within the normal band and speed below 60 m/s, `hudLowEnergy` takes precedence over separation labels so the low-speed stall model cannot hide the actionable speed advisory. High-incidence recovery/departure still takes precedence over low energy; HIGH_AOA/POST_STALL suppression and terrain/boundary priorities remain unchanged. Tests pin 0.1/0.5 boundaries and use the unchanged profile's equilibrium separation at 62, 60 and 59 m/s to cover all three strings with held demand, plus neutral recovery and high-incidence priorities. The complete screen-frame correction, including antipodal roll handling, blends toward body axes using `highAoa`; pointer position/shaping is unchanged. English/Thai help describes automatic X+Shift+pull and marks C as debug. The legacy C speed band is retained in the lab, and existing lesson completion counters remain legacy observers.

## 8. Verification and invariants

| Command | Final result |
|---|---|
| `npm test` | 37 files, **517 tests passed** (including final advisory coverage) |
| `npx tsc -b` | Passed |
| `npm run flight:bench` | 10 files, **22 benchmark tests passed**; feel misses reported |
| `git diff --check` | Passed |
| Phase 0 goldens / Phase 3 authority implementation diff | No changes |

The pre-change run passed 426 tests and 21 benchmark tests. One combined, CPU-contended test/benchmark run hit the existing 5-second timeout in the test that aggregated every separation-continuity scenario. Its assertions were preserved and split into individual scenario tests; no timeout or tolerance was relaxed. The final full test run passes with that structure.

The I7 automatic bound is derived from the authored rate at each substep:

```text
blend = 1 - exp(-k*dt)
|delta| <= (target > previous ? 1-previous : previous)*blend
expectedDelta = (target-previous)*blend
```

Tests check both the bound and exact transition law, allowing only `16*Number.EPSILON` for floating-point subtraction. Opening/closing rates are reconstructed from the profile and current input intent, rather than trusting the recorded diagnostic rate. C debug steps alone are exempt; automatic closing after C release is audited.

I1 finite state/unit quaternion, I2/I3 determinism/replay, separation continuity, signed TVC travel/capacity, floor gap/rate ceiling, allocation reconciliation, dissipative servo, governor/intent separation, work/energy and transverse path-rate invariants remain passing. Automatic scenarios also run the complete existing Phase 3 I10–I19 ledger audit. I4 output equivalence remains explicitly retired for changed physics; archived commands and 30/60/144 FPS equivalence remain tested.

## 9. Benchmark before/after

Before values were captured before implementation using `p3-flow-effectiveness-4`; the checked-in [Phase 3 snapshot](../benchmarks/flight/phase3-metrics.json) records the source commit. After values below are regenerated using `p4-automatic-envelope-2`. Historical goldens remain untouched. Existing C tracks keep their commands; automatic counterparts replace C with X+Shift while demand is held. B16 and B17 are strengthened experiments following review, so their old zero results are not comparable successes.

### Original scenarios, unchanged commands

| Metric | F-22 before | F-22 after | Su-57 before | Su-57 after |
|---|---:|---:|---:|---:|
| B1 Cobra C peak incidence, ° | 90.300 | 8.243 | 89.578 | 7.484 |
| B2 Cobra C time to 90°, s | 2.508 | — | — | — |
| B3 Cobra C speed loss, arcade km/h | 142.572 | 0.000 | 161.097 | 0.000 |
| B4 Cobra C path heading change, ° | 56.218 | 178.890 | 57.924 | 169.276 |
| B5 Kulbit C accumulated nose rotation 360°, s | 4.767 | 3.917 | 5.058 | 3.858 |
| B10 tail-slide flip time, s | — | — | — | — |
| Legacy pedal C yaw rate at 2 s, °/s | 26.411 | 38.679 | 31.668 | 50.250 |
| Beginner full-stick 500 peak incidence, ° | 3.992 | 8.864 | 3.989 | 8.809 |
| B13 900 peak incidence, ° | 3.575 | 3.849 | 3.584 | 3.851 |
| B13 900 mean G | 10.685 | 12.433 | 10.692 | 12.424 |
| B13 900 speed loss, arcade km/h | 126.486 | 146.189 | 127.951 | 148.251 |
| B15 reversal C path heading change, ° | 8.855 | 166.010 | 3.866 | 166.415 |
| B15 reversal C altitude loss, m | 0.000 | 179.117 | 0.000 | 156.176 |
| B20 60° sideslip speed loss, arcade km/h | 32.299 | 32.299 | 34.721 | 34.721 |

### Retained Phase 3 authority/handoff fixtures

| Metric | F-22 before | F-22 after | Su-57 before | Su-57 after |
|---|---:|---:|---:|---:|
| B11 seeded post-stall peak yaw, °/s | 18.677 | 16.407 | 38.892 | 36.774 |
| B18 low-q handoff rate dip, rad/s | 0.000 | 0.000 | 0.000 | 0.000 |
| B18 moderate-q handoff rate dip, rad/s | 0.696 | 0.000 | 0.642 | 0.000 |

B11 F-22/Su-57 ratio: **0.480 → 0.446**, within the ≤0.5 target. This uses the existing 75°/20 m/s post-stall fixture, not the ordinary 450 km/h pedal track.

B19 legacy C+W+X+Shift no-TVC rotation at 3 s: **108.113° → 192.789°**, outside the <180° feel target. The new X+Shift automatic fixture (without W) measures **118.435°**, inside it. The commands differ, so these two B19 fixtures are identified separately. TVC capability, allocated TVC and actual TVC remain zero in both; accumulated nose rotation also counts ordinary aerodynamic turning and is not proof of powered post-stall authority.

### New automatic benchmarks

New B12/B14/B16/B17 reporting begins here; unavailable Phase 3 measurements are not represented as fabricated zeroes.

| Metric | F-22 | Su-57 | Initial target |
|---|---:|---:|---|
| B12 peak incidence, ° | 8.864 | 8.809 | ≤25° |
| B12 maximum limiter | 0.195 | 0.195 | ≤0.35 |
| B14 time to 70°, s | 6.117 | 6.450 | ≤1.2 s — missed |
| Intentional entry time to limiter 0.9, s | 0.308 | 0.308 | report |
| Intentional entry peak incidence in 8 s, ° | 97.399 | 88.680 | report |
| B13 high-speed maximum limiter | 0.000 | 0.000 | report |
| B13 maximum G allowance | 1.174 | 1.174 | report |
| B16 unintended limiter reversals | 4.000 | 4.000 | ≤2 |
| B17 partial-stick C/auto peak incidence difference, ° | 81.758 | 73.030 | ≤15° |
| B18 automatic handoff dip, rad/s | 0.000 | 0.000 | report |

B12 uses exactly 500 arcade km/h, pitch=1, no brake/burner, three seconds. B14 holds full pull with X+Shift at 450 arcade km/h for eight seconds. B17 uses the same speed/duration/modifiers with **0.7 stick**, and compares automatic against C. Time to limiter 0.9 remains approximately 0.308 s, while time to 70° is much longer: permission does not manufacture authority or force the path to separate.

B16 uses a prescribed q sweep from qHigh+0.1 to qLow−0.1 and back over eight seconds, with a **0.26-q, 0.5 Hz** ripple, both with and without brake/power. An independent no-ripple control must show exactly one reversal. The perturbed track must demonstrate opening followed by closing before one intended reversal is subtracted; otherwise its result is invalid (`null`). The unboosted/boosted cases measure **4/2** extra reversals respectively; the aggregate **4** misses the ≤2 target. No filter tuning was changed to pass the strengthened fixture.

### Automatic equivalents of the original C scenarios

| Metric | F-22 automatic | Su-57 automatic |
|---|---:|---:|
| B1 Cobra peak incidence, ° | 75.263 | 22.964 |
| B2 Cobra time to 90°, s | — | — |
| B3 Cobra speed loss, arcade km/h | 65.404 | 4.890 |
| B4 Cobra path heading change, ° | 146.552 | 136.877 |
| B5 accumulated nose rotation 360°, s | 4.033 | 3.550 |
| B15 path heading change, ° | 160.769 | 161.015 |
| B15 altitude loss, m | 18.162 | 334.308 |

The original Cobra stage deadlines (pull until 90° or 2.5 s; counter until 25° or 5 s) remain. In particular, the Su-57 automatic Cobra track reverses demand before reaching post-stall. The dedicated B14 track keeps pulling and does reach it; no deadline was extended to hide the Cobra miss.

### Crossflow B23–B25

B23 authority fractions and B24 damping fractions are **identical before/after for every recorded axis, angle, speed and profile**. Representative triples below are pitch/yaw/roll; fractions are relative to attached flow at the same q.

| Beta | B23 authority (all profiles) | B24 F-22 / no-TVC damping | B24 Su-57 damping |
|---|---|---|---|
| 30° | 0.928 / 0.927 / 0.927 | 1.399 / 1.260 / 1.245 | 1.254 / 1.169 / 1.199 |
| 60° | 0.500 / 0.500 / 0.500 | 3.750 / 2.792 / 2.688 | 2.750 / 2.167 / 2.375 |
| 90° | 0.150 / 0.150 / 0.150 | 5.675 / 4.046 / 3.869 | 3.975 / 2.983 / 3.337 |

B25 includes the new permission/controller/path behavior. Full before/after pitch/yaw/roll rate ratios:

| Aircraft | Speed m/s | Beta | Before | After |
|---|---:|---:|---|---|
| f22 | 100 | 30° | 1.001 / 0.980 / 1.001 | 1.027 / 1.009 / 1.001 |
| f22 | 100 | 60° | 1.011 / 0.912 / 1.002 | 1.493 / 1.236 / 1.002 |
| f22 | 100 | 90° | 1.060 / 0.693 / 1.003 | 1.616 / 0.960 / 1.003 |
| f22 | 45 | 30° | 0.993 / 0.953 / 0.987 | 1.438 / 0.842 / 0.956 |
| f22 | 45 | 60° | 0.957 / 0.739 / 0.912 | 1.422 / 0.377 / 0.666 |
| f22 | 45 | 90° | 0.861 / 0.156 / 0.708 | 1.191 / 0.086 / 0.372 |
| su57 | 100 | 30° | 1.001 / 0.982 / 1.001 | 1.028 / 1.013 / 1.001 |
| su57 | 100 | 60° | 1.011 / 0.916 / 1.002 | 1.496 / 1.399 / 1.002 |
| su57 | 100 | 90° | 1.067 / 0.698 / 0.984 | 1.511 / 1.216 / 0.984 |
| su57 | 45 | 30° | 0.992 / 0.960 / 0.988 | 1.340 / 1.024 / 0.956 |
| su57 | 45 | 60° | 0.953 / 0.693 / 0.909 | 1.282 / 0.740 / 0.580 |
| su57 | 45 | 90° | 0.871 / 0.080 / 0.627 | 1.041 / 0.540 / 0.298 |
| f22-notvc | 100 | 30° | 1.001 / 0.980 / 1.001 | 1.027 / 1.009 / 1.001 |
| f22-notvc | 100 | 60° | 1.003 / 0.912 / 1.000 | 1.244 / 1.236 / 1.000 |
| f22-notvc | 100 | 90° | 0.982 / 0.693 / 0.974 | 1.112 / 0.960 / 0.974 |
| f22-notvc | 45 | 30° | 0.985 / 0.953 / 0.984 | 0.949 / 0.842 / 0.947 |
| f22-notvc | 45 | 60° | 0.903 / 0.739 / 0.895 | 0.603 / 0.377 / 0.603 |
| f22-notvc | 45 | 90° | 0.661 / 0.156 / 0.654 | 0.254 / 0.086 / 0.251 |

All B23–B25 values remain report-only pending Phase 8 targets. The complete machine-readable tables are in `out/crossflow.json`; before values are checked in with the Phase 3 metric snapshot.
## 10. C versus automatic comparison

B17 now tests **0.7 stick**, 450 arcade km/h, X+Shift, eight seconds. CI requires actual unsaturated automatic pitch steps and different initial applied drive, making the comparison sensitive to permission. The ≤15° target is reported only.

| Aircraft | Auto peak | C peak | Absolute delta | Auto unsaturated pitch steps |
|---|---:|---:|---:|---:|
| f22 | 14.161° | 95.919° | 81.758° | 837 / 960 |
| su57 | 14.360° | 87.390° | 73.030° | 832 / 960 |
| f22-notvc | 13.190° | 13.134° | 0.056° | 819 / 960 |

The full-stick pair remains a saturation comparison control, not the B17 acceptance measurement. In version 1 every pitch substep was allocation-bound and the whole trajectory was identical. In version 2 saturation is measured at current permission, so early G allowance and some automatic requests can differ; the diagnostic now records rather than assumes saturation:

| Aircraft | Auto peak | C peak | Absolute delta | Auto / C unsaturated pitch steps |
|---|---:|---:|---:|---:|
| f22 | 97.399° | 97.384° | 0.015° | 7 / 0 |
| su57 | 88.680° | 88.662° | 0.018° | 6 / 0 |
| f22-notvc | 13.801° | 13.804° | 0.003° | 0 / 0 |

Initial applied pitch drive remains identical in this full-stick pair despite different controller requests. Both paths use the same allocator and capability budget. Phase 3 per-substep invariants, rather than peak equality, prove the authority boundary.

## 11. Targets still outside range

- **B14:** 6.117 s (F-22) / 6.450 s (Su-57), versus ≤1.2 s. The limiter itself reaches 0.9 in approximately 0.308 s. No TVC gain, surface acceleration, floor or engine tuning was changed to chase this target.
- **B16:** 4 extra reversals versus ≤2 in the strengthened near-corner energy sweep. The original tiny 4 Hz perturbation did not meaningfully challenge the filter.
- **B17:** 81.758° / 73.030° versus ≤15° with partial stick. Automatic demand grants much less permission than debug C at 0.7 stick; the new fixture exposes this instead of hiding it behind saturated allocation. No-TVC delta is 0.056°.
- **B1/B2/B4:** Cobra commands still miss incidence/timing/heading targets where reported. The unchanged Su-57 counter-input deadline arrives before post-stall entry. These and B14 share the attached-path/separation entry mechanism identified by review. They remain Phase 8 feel work, not reasons to retune authority or floor.
- **B10:** the tail-slide flip still is not reached in the existing window. No anti-spin or flip controller was added.
- **B19 legacy no-TVC:** accumulated nose rotation includes ordinary aerodynamic turning; the C+W miss remains separate from the passing no-powered-authority invariant and the automatic X+Shift measurement. Values are in §9.
- The old manual/normal/fast High-G ratios remain report-only under `highGComparison`; automatic G changes their interpretation.
- B9 owner playtest/targets remain pending from Phase 2. No interactive playtest acceptance is claimed.

B12, the seeded B11 ratio, automatic no-TVC B19 and B20 meet their ranges. B5 remains in range for C and automatic TVC tracks. B13 now peaks at approximately 1.174 G allowance rather than 1.6, keeps the limiter closed, and produces mean G above the Phase 3 baseline. B13 mean G moved from version 1's **16.326 / 16.280** to **12.433 / 12.424** (F-22 / Su-57), against Phase 3's **10.685 / 10.692**. `benchmarks/flight/targets.ts` has no B13 entry: it is an untargeted reported metric, so CI does not catch further mean-G drift. A target range belongs to the Phase 8 playtest; none is authored here. B15/B18/B23–B25 likewise remain measured without invented targets.

## 12. Deliberately deferred limitations

- **Phase 5:** recovery delay/activity scheduling, extra recovery damping, anti-spin, nose precision and full recovery-assist allocation. Unused `stabilityAssist` and `recoveryAssist` fields are removed until Phase 5 introduces actual consumers and assist-specific I15 coverage; natural aerodynamics and the minimal continuous path port act immediately.
- **Phase 6:** removal of `psmArm`/`highG`, final Space→airbrake remapping, removal of legacy maneuver bookkeeping/debug speed band and legacy lesson-completion counters. Public command schema stays unchanged for now.
- **Phase 7:** camera behavior/polish remains untouched. Input-frame blending uses physical incidence, independently of the legacy camera behavior.
- **Phase 8:** aircraft personality, envelope/path feel calibration and existing aero/TVC tuning decisions. Shared provisional breakout defaults are intentionally identical. The current `outward` weight saturates at 5° of axis angle: at alpha 10° / |beta| 60°, pitch contributes `sin(alpha)*cos(beta) ≈ 0.087` to incidence rate while yaw contributes `cos(alpha)*sin(|beta|) ≈ 0.853`, nearly ten times more, yet both receive full restriction. Weighting outward demand by its actual incidence-rate contribution is a deferred refinement; do not replace the combined-incidence limit or retune AD16 to compensate.
- No new maneuver detector, aircraft, FX/audio or TVC participation blend. Automatic scenario names describe input experiments, not detected maneuvers.
- The fixed-flow B16 sweep and headless deterministic mouse tests complement, but do not replace, interactive human playtesting. No interactive flight playtest was performed.

## 13. Phase 3 boundaries and performance

`authority.ts`, `allocation.ts`, `aerodynamics.ts`, `thrustVectoring.ts`, `engine.ts`, `engineForces.ts` and `speed.ts` are unchanged. The aircraft aero, signed TVC geometry/gain, engine and floor values are unchanged. B23/B24 before/after equality independently confirms the unchanged fixed-flow authority/damping model.

```text
physicalAero = q * confidence * aeroFlowEffectiveness * controlAcceleration
restoring   = stiffness(incidence) * q * sin(alpha/beta)
```

Separation is used by natural damping and path/lift handling, never restored as an angular physical-aero multiplier. `highAoa` does not alter physical aero capability. The floor remains a small gap-fill/rate-limited near-rest feature, with no enlarged speed window. All powered drive continues through signed allocation; natural/dissipative terms remain separately accounted.

Controller feedback is prepared once per substep and reused by the controller/path calculation. The same airflow effectiveness evaluation still feeds natural aero and the capability budget once per substep. Automatic permission adds scalar arithmetic and one exponential; it adds no geometry search, per-frame history, physics event detector, or unbounded runtime trace. Sweep samples and full traces are benchmark-only. This statement concerns the physics path, not allocation-free presentation. `flightWarning` still observes the supplied pose on each call: `observeAirflow` allocates two `Vector3` objects (one via clone), one `Quaternion`, and its result object; `interpretEnvelope` also allocates an object. The glass HUD observes its interpolated pose separately. This cost is explicitly retained for now; no stale start-of-substep ledger is substituted for current-pose telemetry, and no cross-frame cache is introduced. No CPU/frame-time improvement is claimed without a rendering performance measurement.

Generated reports:

- [Phase 4 entries/sweep/comparisons](../benchmarks/flight/out/phase4.md) and [full JSON](../benchmarks/flight/out/phase4.json).
- [Original scenario metrics](../benchmarks/flight/out/report.md).
- [Existing Phase 3 authority/handoff fixtures, run with current physics](../benchmarks/flight/out/phase3.md).
- [Crossflow B23–B25](../benchmarks/flight/out/crossflow.md).

`out/` remains generated/ignored; the implementation report and before-snapshot are checked-in source artifacts. Running `npm run flight:bench` regenerates the reports without writing historical goldens.


## 14. Review resolution — version 2

- **P4-1 fixed, owner option 1.** Saturation uses the rate permitted by the previous substep’s limiter against normal path support, and gates only automatic G. Breakout is `clamp(D*permission,0,1)`; sustained demand remains low-weight and independent of S. The owner decision is recorded in plan §2.3. Tests pin zero saturation at 100 m/s, intermediate saturation at 166.7 m/s, lower partial-stick saturation, and low-energy limiter permission with S=0. `saturationSweep` in the benchmark JSON reports both 0.7/full demand across nine speeds.
- **P4-2 fixed.** Combined unsigned incidence still sets the limit. The outward restriction fades over the existing five-degree band instead of switching on per-axis sign:

  ```text
  axisIncidence = pitch ? alphaDeg : -betaDeg
  outward = clamp(sign(input)*axisIncidence/5, 0, 1)
  allowed = clamp((alphaLimitDeg-unsignedIncidenceDeg)/5, 0, 1)
  targetAxis *= 1-outward*(1-allowed)
  ```

  Counter-input is unrestricted; zero cross-axis angle retains tangential input; full outward restriction applies from five degrees. Tests bound changes by the analytical slope `abs(unrestrictedDrive)/5` across signed zero and both band endpoints, for pitch/yaw, both input signs and closed/partly open limiters.
- **P4-4 fixed.** B17 has a discriminating partial-stick variant and unsaturated-step/applied-drive diagnostics. The old full-stick comparison remains a control with no feel target. See §10.
- **P4-5 fixed.** B16 uses a near-corner perturbation and validates the intended reversal before subtracting it. A stronger 60%-of-band perturbation is tested to register extra reversals. CI verifies rig sensitivity, not the ≤2 feel target.
- **P4-10 fixed for required cases.** C release invokes the exact exponential invariant and moves smoothly below 1. The old C+W release fixture explicitly stays below 70° and does not increment completion, rather than skipping the check conditionally. The envelope observation test restores exhaustive equality, including energy and limiter target.
- **P4-12 fixed.** Reverse-path rescaling guards the reciprocal with `max(length,1e-9)`.

An additional integration test pins the limiter closed from the first substep using a test-only property setter and compares the flown result with free automatic permission. Peak incidence differs by more than the normal-incidence range. This verifies permission reaches the controller without a production override or second physics path. Version-1 and Phase-3 public replays are explicitly rejected; replay schema remains 1.

### Measured saturation after the repair

At a closed limiter and zero separation, the shared provisional profiles produce:

| Speed m/s | S, 0.7 stick | S, full stick | E | Full-stick G allowance |
|---|---:|---:|---:|---:|
| 20.0 | 1.000 | 1.000 | 1.000 | 1.000 |
| 60.0 | 0.000 | 0.000 | 1.000 | 1.000 |
| 83.3 | 0.000 | 0.000 | 0.815 | 1.000 |
| 100.0 | 0.000 | 0.000 | 0.403 | 1.000 |
| 120.0 | 0.000 | 0.000 | 0.001 | 1.000 |
| 150.0 | 0.000 | 0.063 | 0.000 | 1.038 |
| 166.7 | 0.000 | 0.290 | 0.000 | 1.174 |
| 200.0 | 0.003 | 0.855 | 0.000 | 1.513 |
| 259.0 | 0.549 | 1.000 | 0.000 | 1.600 |

The support gap matters around normal maneuver entry, not at every possible speed: near rest the small available path budget can also produce saturation (20 m/s row). Breakout no longer depends on this overlap. B13 mean G changes from version 1's **16.326 / 16.280** to **12.433 / 12.424**; the Phase 3 baseline was **10.685 / 10.692**. This is the intended effect of restoring saturation discrimination, without tuning the authority layer.

First-review validation (before §15): **505 tests in 37 files**, **22 benchmark tests in 10 files**, **`tsc -b`** and **`git diff --check` pass**. Historical goldens and Phase 3 authority/allocation/aerodynamics/TVC/engine/floor implementation remain unchanged. All requested benchmark reports were regenerated under version 2.

P4-3/7/9 remain Phase 6 work; P4-8/11 remain presentation/camera work for Phase 7; P4-6 and remaining P4-10 feel assertions stay with their review-assigned later phases. P4-13's over-unity weight sum is intentionally clamped and remains a Phase 8 calibration concern. Phase 5 recovery and Phase 8 entry-speed tuning have not been started.


## 15. Second review follow-up

1. `hardTurnBlend` is exported by the envelope and read directly by the controller. A regression test supplies nonlinear and added-term G allowances with the same blend, checks pitch/yaw rate multipliers, and runs the real `stepFlight` turn-drag calculation under both mappings. Path allowance may differ; rate/drag multipliers must not.
2. Dead assist fields are deleted, with no damping or authority change. Phase 5 will own their reintroduction and meaningful I15 coverage (see §3).
3. Over-unity weight consequences and the fixed-speed limiter-0.9 benchmark are recorded in §3. Weights remain unchanged.
4. Mild-separation advisories are restored and tested; see §7.
5. The deliberate one-substep saturation lag is documented in §4 and at the code site.
6. **Owner decision: keep combined-incidence restriction (option 1).** `alphaLimitDeg` bounds the unsigned nose-to-velocity angle. Independent per-axis limits cannot enforce it, and limiter permission intentionally stacks with AD16 capability. The regression test seeds F-22 alpha=+10° / beta=−60° with a closed limiter at 60 and 120 m/s, checks zero outward pitch request on the first actual flight substep, and requires a positive request within 0.2 s. It covers pitch=0.5 and 1 with outward yaw=1 held, plus pitch=0.8 and 1 without yaw; C/brake/burner remain off. The assertions read the controller request in the allocation ledger, not achieved rate or torque. Production physics is unchanged.
7. Presentation observation allocations are explicitly recorded in §13. They are not covered by the physics-only no-history statement.

The earlier §9/§14 benchmark tables remain unchanged; §11 now explicitly records B13's untargeted mean-G drift. Existing generated Phase 4 metrics reproduce to displayed precision; removing the inverse G calculation changes a few results only at floating-point roundoff. No authority, floor, TVC or engine profile values were edited, and Phase 5 has not begun.

Final second-review validation including the advisory fix: **517 tests / 37 files**, **22 benchmark tests / 10 files**, **`tsc -b`** and **`git diff --check` pass**. Item 6 is resolved; no Phase 5 work is included.


Item 6 fixture observations: with yaw held, the first positive pitch request occurs at substep 11 (0.0917 s) at 60 m/s and substep 10 (0.0833 s) at 120 m/s, for both pitch=0.5 and pitch=1. Without yaw, pitch=0.8 clears at substeps 23/19 (0.1917/0.1583 s); full pitch clears at 11/10. CI pins the owner-requested **0.2 s** ceiling, not those incidental exact counts.

Scope of that timing contract is explicit. The owner's extended F-22 probe starts at alpha=+10° / beta=−60°, limiter closed, yaw=0:

| Speed | Pitch | First positive pitch request |
|---|---|---|
| 60 m/s | 0.3 / 0.5 / 0.6 | **2.667 s** |
| 60 m/s | 0.7 | **0.775 s** |
| 120 m/s | 0.3 / 0.5 / 0.6 | **0.250 s** |

All positive pitch inputs at or below 0.6 have `D=0` with yaw=0 and therefore cannot open the limiter through `H * D`; the measured samples above demonstrate the gap. Crossing the demand floor from 0.6 to 0.7 cuts dead-pitch time by approximately **1.892 s** at 60 m/s. This is a sharp response-time difference, not a discontinuous mathematical limiter update. The plan describes the latch as preventing closure mid-maneuver, whereas this fixture starts with a closed limiter that does not open under partial stick. `target = max(intent, H * D)` remains the approved contract: whether the latch should use `H` alone is an **owner question deferred past Phase 4**. No formula changes or universal 0.2 s claim are made. The Phase 8 contribution-weighting limitation above also remains deferred.

Final second-review cleanup restores reachable low-energy and severity-banded separation messages (§7), marks the version-1 review as superseded, and makes diagnostics-only fields explicit (§3). `requestControl` now requires precomputed demand instead of silently recomputing it from the post-step limiter; unit callers pass their observation explicitly. Both demand measurement and rate requests use the same scalar `turnRatePermission` helper. Production feedback ordering and physics arithmetic remain unchanged; no tuning values or historical goldens were changed.
