# Phase 5 — Recovery assist

Parent commit: `8e8bcbb` (Phase 4.5D banked drift). Physics version: `p5-recovery-assist-1`.
Command schema is unchanged. The change adds no new simulation state, so nothing new needs to be serialized or replayed.

## Problem

After a neutral release from high incidence, only natural aerodynamics acted. Nozzle travel and inherited pitch rate carried the nose over. A 1.2 s Airbrake + pull entry at 500 km/h, released to neutral, peaked at 163° (F-22) and 180° (Su-57). Incidence then stayed above 30° for the rest of a 6 s window. The 4.5 report recorded this as the open Phase 5 item.

## Design

Recovery reuses signals that already exist. It adds one envelope weight and extends the controller's neutral-axis branch. It adds no new file, state field, timer or allocation path.

- **Release signal.** `intent.activity` and `intent.releaseSeconds` from 4.5B. Activity counts pitch, yaw and roll.
- **`envelope.recoveryAssist`** = `smoothstep(releaseSeconds, delay, delay + ramp)`. This is a pure function of the shared release timer. Any angular input resets `releaseSeconds` on the same step, so the assist is 0 on that step (I20). Airbrake, S, W and burner are not angular input, so they do not hold the assist off.
- **Where it acts.** On each neutral axis, the controller uses its existing neutral servo. Recovery weight = `recoveryAssist × highAoa`. The attached-flight neutral damping fades with `(1 − highAoa)`, and recovery takes over in the same band. When `highAoa = 0`, the output is bit-identical to before. When confidence is near zero, `highAoa` is 0, so recovery never acts on meaningless angles.
- **Target.** The target rate is `noseRate × recovery` along the direction of the actual natural moment, `restoring + departure` (pitch, yaw), from the same substep. Recovery therefore never pushes against natural recovery, including reverse flow on either side of alpha, where restoring and departure use different stiffness and pressure. At a natural saddle, where that moment is exactly zero, the target is 0 and recovery only damps. The roll target is zero, which gives anti-spin behavior.
- **Damping (unbudgeted, dissipative).** Only the part of the rate that exceeds the target, or opposes it, is damped. Rate that already turns toward the airflow is left to natural aero. Neutral damping and recovery damping share one exponential, so the blend never exceeds 1 and cannot flip the sign of a rate.
- **Drive (budgeted, no floor).** The remaining `(target − useful)` rate change goes into `allocation.request` and is recorded separately as `recoveryRequest`. It shares the `allocate()` call with pilot demand, so nothing is spent twice; the axes never overlap, because recovery only acts on neutral axes. On recovery axes the arcade floor is zeroed, so the correction uses real aero/TVC only. With no budget, no correction is applied: recovery stops the rotation but does not repoint the nose.
- **Afterburner.** While the burner is engaged (`maneuver.burnerActive`), the nose target is 0 and recovery only damps. This keeps the 4.5C slingshot exit: after the delay the nose holds its attitude, and thrust pulls the path toward it. The rule reads the engaged burner, not the key. A key held on an exhausted or locked reserve gives no thrust, so recovery behaves as if the key were not held; otherwise the nose would park at high incidence (measured: final 74° on F-22 and 98° on Su-57 when keyed on the key).

### Profile (`recovery`, shared provisional defaults)

| Field | Value | Meaning |
|---|---:|---|
| `delaySeconds` | 0.3 | Neutral time before assist starts. Validation requires at least `breakout.handoffSeconds`. This also covers the 0.30 s handoff sweep candidate. |
| `rampSeconds` | 0.3 | Time from start to full assist. B6 (assist ≥ 0.9) = 0.54 s. |
| `response` | 5 /s | Rate-servo response. |
| `noseRate` | 1.2 rad/s | Nose-to-airflow target at 90° incidence. |

Candidates tried: delay 0.25–0.35 s, ramp 0.3–0.6 s, response 2.5–6 /s, noseRate 0.8–1.2 rad/s. A delay of 0.25 s failed validation against the 0.30 s handoff sweep. Longer delays missed the window in which spool-down still leaves TVC authority.

## Measured results

Each track starts from a saved entry at 500 HUD km/h, 3000 m (Airbrake + full pull for 1.2 s or 2.0 s), then runs the listed input for 6 s. Each cell shows: peak incidence / time after which incidence stays below 30° / 3D velocity direction change / final HUD km/h. The *natural only* column uses the same code with an unreachable delay, which reproduces the previous physics exactly.

| Aircraft | Track | Natural only | Recovery assist |
|---|---|---|---|
| f22 | X+pull 1.2 s → neutral | 163° / — / 48° / 201 | 98° / 2.91 s / 26° / 238 |
| f22 | X+pull 2.0 s → neutral | 178° / — / 66° / 163 | 123° / 4.93 s / 65° / 184 |
| f22 | X+pull 1.2 s → W | 180° / 5.24 s / 146° / 380 | 92° / 1.63 s / 44° / 683 |
| f22 | X+pull 1.2 s → burner | 174° / 2.70 s / 141° / 843 | 92° / 2.85 s / 107° / 844 |
| f22 | X+pull 1.2 s → hold X | 180° / — / 90° / 60 | 100° / 4.50 s / 101° / 82 |
| su57 | X+pull 1.2 s → neutral | 180° / — / 54° / 184 | 100° / 3.67 s / 39° / 229 |
| su57 | X+pull 2.0 s → neutral | 180° / — / 71° / 149 | 125° / — / 69° / 167 |
| su57 | X+pull 1.2 s → W | 180° / 3.78 s / 109° / 508 | 94° / 1.74 s / 44° / 618 |
| su57 | X+pull 1.2 s → burner | 180° / 2.63 s / 124° / 912 | 94° / 2.92 s / 113° / 823 |
| su57 | X+pull 1.2 s → hold X | 180° / — / 70° / 96 | 103° / — / 91° / 110 |
| f22-notvc | X+pull 1.2 s → neutral | 46° / 2.36 s / 6° / 250 | 42° / 0.88 s / 14° / 259 |
| f22-notvc | X+pull 2.0 s → neutral | 51° / 2.47 s / 14° / 218 | 51° / 1.05 s / 3° / 207 |
| f22-notvc | X+pull 1.2 s → hold X | 78° / — / 96° / 151 | 47° / 1.17 s / 110° / 78 |

Benchmark changes from `p4.7-banked-drift-1`. All other rows in `report.md` are unchanged.

| Benchmark | F-22 before → after | Su-57 before → after |
|---|---|---|
| B10 tail-slide flip after apex | 3.00 → 2.87 s | 3.00 → 2.88 s |
| B15 reversal180 velocity heading change | 36° → 168° | 31° → 153° |
| B15 reversal180 altitude loss | 113 → 0 m | 0 → 318 m |
| B9 release45 incidence at 1.5 s | 16.0° → 11.0° | 21.8° → 11.8° |
| B6 assist full | — → 0.54 s (target 0.5–1.5) | same |
| B7 first NORMAL label (release45, 2 s) | — (report) | — (report) |

B8 is unchanged (7.6° / 7.5°). Its 0.2 s window lies inside the delay, and a test pins this. The cobra, kulbit, hardTurn900, fullStick500, entry-grid, hold and handoff-sweep metrics are unchanged. The jet-drift handoff tracks change only after their final release. The tests compare cruise, aim, roll and the 900 km/h pull with recovery disabled, and the results are bit-identical.

### Reverse flow (review fix)

Seed: falling straight down, nose pitched to the listed pitch-plane alpha, rates and engine power zero, assist already full. Grid: alpha ±120/140/150/170° × 20/60/100 m/s × F-22, Su-57, f22-notvc (72 runs, 6 s each).

- Review case, Su-57 at α −150°, 60 m/s: the first revision stayed at 143° after 6 s. Now incidence stays below 30° from 3.50 s (natural only: 3.73 s).
- In 64 runs recovery settles no later than natural only. In three runs natural only never settles and recovery does (Su-57 at −140°/100, −120°/20 and 120°/20 m/s).
- The exceptions are α −170° at 100 m/s: settling is 0.35–0.44 s later on every airframe (for example F-22 2.17 → 2.52 s). There natural rotation is faster than the 1.2 rad/s target, and recovery damps the excess. This is the overshoot guard working as designed; the tuning trade-off belongs to playtest.
- F-22 and f22-notvc at −120°/20 m/s settle in neither mode. F-22 ends at 102° natural only and 51° with recovery; f22-notvc ends at 102° and 99°.

## Behavior changes to review in playtest

- **The burner exit keeps most of its trajectory change.** 3D direction change is 107° (was 141°) on F-22 and 113° (was 124°) on Su-57, with peak incidence 92–94° (was 174–180°). With full nose recovery during the burner (tried, then rejected) the direction change fell to 61–64°, which broke the 4.5C slingshot. That is why the afterburner switches recovery to hold-only.
- **Neutral + Airbrake no longer holds a drift indefinitely.** Recovery starts after the delay. This follows the Rev. 4 rule that Airbrake alone never latches. To hold a slide, the pilot keeps a partial stick input.
- **Capability limits remain visible.** A neutral, no-throttle release is budget-limited after spool-down: at 1 s the unmet pitch demand is about 1.4 rad/s², and Su-57 from a 2.0 s entry still sits above 30° after 6 s. W or the burner gives recovery real TVC authority (below 30° in about 1.7–1.8 s with W). The floor was not raised, and recovery adds no control-power request.
- **Chaining.** Handoff gaps of 0.1–0.15 s never start recovery. A pilot input during active recovery removes it on the same step.

## Validation

- `tests/recovery.test.ts`:
  - I20 on handoff, release-reapply and re-pull tracks.
  - I15: recovery damping is dissipative (`damping·rate ≤ 0`, `|damping·dt| ≤ |rate|`); aero/TVC allocation stays within the signed budget; non-TVC allocation has zero TVC; with the afterburner engaged there is no recovery request, and a dead afterburner key still gets full recovery.
  - Floor: every step with a recovery request allocates zero floor on that axis. This includes f22-notvc at 10 m/s and α 90°, where the first revision took 0.241 rad/s² (96%) from the floor. Removing the mask makes this test fail with exactly that value.
  - Reverse flow at α ±120/140/150/170° and 20/60/100 m/s: the recovery request never opposes the natural restoring + departure moment on any step, and recovery settles below 30° whenever natural response does.
  - Attached-flight tracks are bit-identical with recovery disabled.
  - The delay window matches natural-only physics.
  - Overshoot is lower than natural-only.
  - Validation checks.
- Intentional assertion migrations:
  - `aerodynamics.test.ts` "neutral high-incidence controller yields to aero" now applies only while `recoveryAssist = 0`, that is, during the natural window.
  - `airflow.test.ts` expects `recoveryAssist: 0` instead of asserting that the field does not exist. That assertion was a Phase 4 guard against a field with no consumer.
- `npm run build` passed: 583 tests, `tsc -b` and the Vite build. `git diff --check` passed. `npm run flight:bench` passed all committed report files.
- The working tree also held an untracked `benchmarks/flight/noseFlick.report.ts` that predates this work. The bench runner picked it up in both the before and after runs. It is not part of this change.
- I4 retirement entry added for `p5-recovery-assist-1`. Phase 0 archives are untouched.
- Flight Lab shows `Recovery assist / release`, with English and Thai text.

## Review round 1 (Astra 6)

Two MAJOR findings, both fixed:

1. The recovery correction could take the arcade floor. The floor is now zeroed on recovery axes, and a floor assertion was added.
2. The geometric `noseToFlow` field could oppose the real natural moment in reverse flow with negative alpha. The target now follows the actual restoring + departure moment, and reverse-flow tests cover both alpha signs at several speeds.

The reviewer agreed with both owner decisions below as provisional playtest rules, and accepted having no separate `recovery.ts`.

## Owner decisions requested

These two choices go beyond the plan's recovery inputs (activity, delay, flow, capability):

1. **The engaged afterburner switches recovery to hold-only** (damping, no nose-to-airflow drive). Without this rule, the burner exit lost about half its trajectory change.
2. **Neutral stick with Airbrake held ends the slide after the delay.** This follows "Airbrake alone never latches". The alternative is to count a held Airbrake as activity.

## Deviations and deferrals

- The plan listed a new `recovery.ts`. The weight is one line in `interpretEnvelope`, and the correction is the existing neutral rate servo with a different target. A separate module would duplicate that servo, so recovery lives in `envelope.ts` and `controller.ts`.
- There is no translational recovery term. Path alignment already comes back through the arcade path assist when continuation releases (4.5A), bounded by lift and `pathAssistAcceleration`.
- There is no attitude leveling or horizon hold. Recovery aligns the nose with the airflow only.
- Deferred: warning suppression during active high-AoA input (4.5 open item). Suppression still keys on activity. Recovery does not change which advisory shows while the pilot holds input.
- The positional mouse has a 0.08 dead zone that gives exact 0. Just outside it, a narrow ring can produce |axis| < 0.05. Activity treats that as released, but that axis stays on the pilot servo instead of recovery. The other axes recover normally.
- Human playtest has not been done. All tuning values are provisional.
