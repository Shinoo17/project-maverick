# Phase 6 — Remove legacy gates

Parent commit: `7f494e6` (Phase 5 recovery assist). Physics version: `p6-legacy-gates-1`. Command schema: `2` (was `1`).

## Summary

Phase 6 removes the last manual gates from the flight model. There is now no PSM phase machine, no C debug limiter and no Space High-G request. High AoA comes only from the continuous envelope that Phases 4–5 built.

| Input | Before | After |
|---|---|---|
| Space | High-G (manual hard-turn request) | Airbrake |
| X | Airbrake | Unbound |
| C | Hold to force the limiter open (debug) and drive the PSM phase machine | Unbound |
| Shift | Afterburner; `powerIntent` = 1 | Unchanged. No code change was needed: `readIntent` already reads the key, and the governor already uses it. |
| Q / E | Digital ±1 | Linear ramp to full deflection in 0.2 s, stepped once per command tick |

For any track that never held C or Space, the physics output is identical, byte for byte. The benchmark evidence is below.

## Changes

### Command contract and replay

- `PilotCommand` no longer has `psmArm` or `highG` ([commands.ts](../src/game/runtime/commands.ts)).
- `commandSchemaVersion = 2` is one shared constant. `GameRuntime.exportReplay` writes it, and `runFlightReplay` rejects any other schema. Schema 1 replays carried the removed fields, and Space meant something different then.
- `flightProfileVersion` = `p6-legacy-gates-1`.
- An I4 retirement entry was added in [goldenPolicy.ts](../benchmarks/flight/goldenPolicy.ts). Phase 0 archives are untouched.

### Input ([FlightInput.ts](../src/game/input/FlightInput.ts))

- Space sets `airbrake`. X and C set nothing. `FlightPage` no longer captures X or C.
- **Q/E ramp.** `pedal` moves toward the key target by `WORLD_STEP / PEDAL_RAMP_SECONDS` for each command tick (0.2 s to full).
  - The ramp is linear, so a released pedal reaches exact 0. The controller's neutral branch (`command[axis] === 0`), neutral damping and recovery assist all engage at that point.
  - The ramp advances on the tick argument, never on rendered frames. A repeated tick is idempotent. A tick that goes backwards (a `GameRuntime.reset`) or `clear()` restarts the ramp from centre.
  - The recorded command carries the ramped value, so replays reproduce it exactly.
  - While Q or E is held, the pedal owns the axis, as the old digital keys did. Q + E together gives exactly 0, whatever the roll input.
  - After release, yaw = `pedal + (1 − |pedal|) · roll · 0.12`, which hands back to keyboard roll coordination continuously. With no pedal travel, this is exactly `roll · 0.12`, as before.

### Flight

- [maneuvers.ts](../src/game/flight/maneuvers.ts) no longer has a phase machine. `ManeuverState` keeps airbrake/burner actuation and the end-of-step observations `alpha`, `g`, `pathRate` and `drag`. These fields were removed: `phase`, `timer`, `rotation`, `stable`, `blend`, `blocked`, `entrySpeed`, `exitSpeed`, `peakAlpha`, `completed` and `highG`. `stepManeuvers` only smooths the airbrake. The burner stays in `engine.ts`.
- [envelope.ts](../src/game/flight/envelope.ts): `hardTurn = D · S · (1 − E)` (automatic only). `stepEnvelope` lost its `debugOpen` parameter, and `LimiterStep` lost `automatic`. Every step follows the authored exponential, so the I7 audit now checks every step.
- [controller.ts](../src/game/flight/controller.ts): the returned `highG` is renamed `hardTurn`. It always was the envelope's hard-turn blend.
- These `ManeuverProfile` fields were removed, together with their validation: `psmEnabled`, `entryMin`, `entryMax`, `minAltitude`, `exitSpeed`, `blendSeconds`, `recoveryIncidenceRad`, `recoverySpeedMps`, `highGMinSpeedMps`, `highGMaxSpeedMps` and `highGSpeedFadeMps`. `highGRate` and `highGDrag` stay, because they are the automatic hard turn's rate and drag multipliers.

### Presentation

- [FlightCamera.ts](../src/render/FlightCamera.ts): the cinematic blend reads airflow decoupling only. The plan listed the camera part of I21 under Phase 7, but the phase field no longer exists, so the fallback went here.
- HUD: the PSM speed-band bracket on the speed tape is gone, and `createGlassPainter` takes no options. The Playground debug-C band and the "last Cobra" lab row are gone. The PSM / HI-G / BRAKE flags already read labels and `gAllowance`.
- The hangar profile panel shows "High-AoA entry: Automatic · Space + pull" instead of "Hold C".
- **Practice lesson 6** used the phase machine's completion counter. It now counts a lesson-only observer in `PracticeState`: one count when incidence passes 70° and later returns below 20° above 60 m/s. The observer does not feed flight.
- Locales (en/th): help, hints, lessons and spawn names were updated. Keys for the removed phase and C text were deleted.
- `hudPreview` and the exhaust preview no longer write a phase.

### Benchmarks

- [harness.ts](../benchmarks/flight/harness.ts) has two name lists:
  - `archivedScenarioNames` are the 9 Phase 0 golden names, including `*C`. They are replayed only. `replayGolden` drops the archived `psmArm`/`highG` fields, so a removed field never reaches `stepFlight`.
  - `scenarioNames` are the live tracks. `liveScenario()` maps each `*C` name to its automatic twin, with the same stick script and held C mapped to Airbrake + Afterburner (the Phase 4 convention).
  - The automatic `cobra`, `kulbit`, `reversal180` and `pedal` controllers were rewritten without the C detour. Their traces are bit-identical to HEAD.
- `metrics.ts` finds the release step by neutral stick for every scenario. For the archived `*C` tracks, C was always released together with the stick, so the release step is unchanged.
- The phase2, phase3 and phase4 reports run the automatic twins. `releaseSafety.ts` holds Airbrake instead of C.

## Neutrality evidence

`npm run flight:bench` was run at HEAD and after the change. The two `out/` trees were compared with the version string normalized and `.gz` files decompressed.

- **460 files are byte-identical.** These include all of `jet-drift-final`, `-phase45a`, `-phase45b` and `-phase45c`, crossflow, legacy speed and flight-handling, and the `fullStick500`, `hardTurn900`, `release45`, `sideslip60` and `tailSlide` traces.
- **All 133 `jet-drift-current` trace files differ only by removed fields.** A structural diff finds no changed number. The only differences are the retired `maneuver.*` fields, `limiterStep.automatic`, `command.psmArm`/`highG`, and the removed profile fields in `metrics.json`.
- `nose-flick.json`: only the 12 `highG` variant rows changed. They now equal `plain`, because Space no longer sends `highG`. The other 24 rows are identical.
- `report.md`: only rows from C scenarios moved (next section). `psmIntent450` rows were added, because it is now a live scenario.

## Report changes (C tracks now run as automatic twins)

`report.md` rows. "Before" is the C track (`cobraC` and so on). "After" is the automatic twin.

| Metric | F-22 before → after | Su-57 before → after |
|---|---|---|
| B1 cobra peak AoA | 67.5° → 92.3° | 47.4° → 92.0° |
| B2 cobra time to 90° | — → 1.33 s | — → 1.42 s |
| B3 cobra speed loss | 0 → 42.1 km/h | 0 → 51.8 km/h |
| B4 cobra heading change | 165.3° → 73.0° | 169.9° → 81.7° |
| B5 kulbit 360° | 3.81 → 3.95 s | 3.92 → 4.17 s |
| B15 reversal heading / altitude loss | 168.4° / 0 m → 119.2° / 454.8 m | 152.7° / 317.7 m → 125.7° / 392.2 m |
| baseline pedal yaw rate at 2 s | 44.1 → 39.5 °/s | 58.1 → 50.4 °/s |

The same automatic-twin tracks were already reported in `phase4.json` before this change. A structural diff shows that the new `cobra`, `kulbit`, `reversal180`, `pedal`, `psmIntent450`, `fullStick500` and `hardTurn900` results equal HEAD's `phase4.json` exactly for all three airframes. The `report.json` values for those scenarios also equal HEAD's `phase4.json` metrics. So these numbers are the automatic behavior the game has had since Phase 4, not a new physics result, and the harness refactor changed nothing.

In `phase3.md`, the probes that held C now hold Airbrake. The pedal-probe peak yaw is F-22 27.7 → 13.5 °/s and Su-57 51.6 → 39.8 °/s. B11's F-22/Su-57 ratio is 0.537 → 0.340 (target ≤ 0.5). This is a measurement change caused by a different entry input, not a physics change. Do not read it as B11 now passing on merit.

## Retired items (plan §5.0: nothing deleted silently)

Last values are from HEAD `7f494e6`.

| Item | Where | Why retired | Last value |
|---|---|---|---|
| `legacy.recovery.backToNormal` | report.md | Measured time to phase `normal` after C release. There is no phase or C. B7 (first NORMAL label) remains. | 2.700 s (F-22 and Su-57) |
| B17 `cVsAuto.peakDelta` | phase4 | C vs automatic at partial stick. C no longer exists. | F-22 0.072°, Su-57 0.185°, notvc 0.043° (target ≤ 15) |
| `allocationBound.cVsAuto.peakDelta` | phase4 | Same, at full stick. | F-22 0.152°, Su-57 0.125°, notvc 0.091° |
| Manual High-G fixture (`highGComparison`) | phase4.json | Space no longer requests G. The automatic hard turn is still covered by B13/hardTurn900. | manual/normal path ratio 1.394 (old min 1.2), extra speed loss 18.1 m/s (old min 10), fast ratio 0.969 (old max 0.75) |
| C variants `psmPartial450C` / `psmIntent450C` (inputs to B17 and `allocationBound.cVsAuto`) | phase4 | Only the automatic entry is measured now. B18/B19 were already measured on the automatic track and remain. | F-22 partial peak: C 115.27°, auto 115.35° |
| `maneuvers.test.ts`: held C never moves the aircraft; entry speed/altitude gates; armed release; Space extra G | tests | The behavior under test no longer exists. Pause/reset, burner, determinism and input tests stay, rewritten for Space. | passed at HEAD |
| `poweredPsm.test.ts`: chaining/overspeed exit; `blendSeconds`/`exitSpeed` validation | tests | Phase machine and fields removed. The powered-vs-idle, brake/burner, energy and Su-57 replay tests stay, with Space instead of C. | passed at HEAD |
| `flightProfileConfig`: PSM defaults off, narrower legacy gates, disabled-PSM budgets | tests | `psmEnabled` and the entry envelope were removed. | passed at HEAD |
| `phase1Profile`: High-G speed band, recovery thresholds; validation cases for the removed fields | tests | Fields removed. | passed at HEAD |
| `profiles` / `stall`: disabling PSM through capability data | tests | No PSM switch remains. | passed at HEAD |
| `phase3Boundaries`: "debug C may step open" | tests | No manual open remains. The new I7 test asserts that no command opens the limiter in one step. | passed at HEAD |
| `phase4`: flow vs legacy phase/blend | tests | Phase and blend no longer exist. I21 now covers this. | passed at HEAD |

Legacy feel reports (`legacyManeuvers`, `legacyPoweredPsm`, `legacyStall`) were **ported, not deleted**:
- The C hold became Airbrake (Space). The phase lifecycle and completion-counter assertions were removed. Rotation and peak-alpha feel values are now measured locally.
- They remain report-only. Feel misses: maneuvers 9 → 11 of 17–20 rows, poweredPsm 4 → 4, stall 13 → 21 of 40. The rise in misses is expected, because the old targets were tuned for the forced-open C limiter.

## Tests

- New: [tests/invariants/phase6.test.ts](../tests/invariants/phase6.test.ts).
  - I21: `@ts-expect-error` on `psmArm`/`highG`, and an exact `PilotCommand` key list.
  - A source scan of flight, input, runtime, playground, FlightCamera and flight UI code (comments excluded) for `psmArm`, `maneuver.phase`, `PsmPhase` and `command.highG`/`maneuver.highG`. `ManeuverState` must have none of the retired keys.
  - Schema 1 is rejected.
  - Q/E ramp: linear, exact full and zero, idempotent per tick, reverses through centre, restarts on reset or clear, and keeps roll coordination at the ends of travel.
  - Live keyboard input replays exactly at 30/60/144 FPS.
- The I13/I14 no-TVC rig now seeds `limiterOpen = 1` in state (no back door in `stepFlight`) and still finds zero TVC authority.
- The Phase 3 low/reverse-speed fuzz used C to force the limiter open. It now asserts that automatic permission still reaches > 0.9 in every seed.
- Neutral release (hard safety) holds Airbrake instead of C. It asserts the hold opens the limiter above 0.9, and that powered release reaches a NORMAL label before any terrain contact.
- `npm test`: **560 passed** (583 at HEAD). The difference is the retired tests above, the smaller parametrized field lists and the merged scenario lists, minus 7 new tests.
- `tsc -b`: one error, in the **untracked** `benchmarks/flight/noseFlick.report.ts`. That file is not part of this change. Its `highG` variant no longer type-checks, but it still runs under `flight:bench`, where that variant now equals `plain`. The one-line fix is to delete `highG: { highG: true }` from its `variants`, or to replace it with something like `space: { airbrake: true }`. Because of this error, `npm run build` stops at `tsc -b` until the file is fixed or removed. `vite build` alone succeeds.
- `npm run flight:bench`: 12 files, 24 tests passed. `git diff --check` is clean.

## Owner decisions requested

1. **X is unbound.** The plan says "X ว่าง". Confirm it stays free, or name a use for it.
2. **Lesson 4 ("Hard turn")** is now automatic: full stick at speed without the airbrake. It still counts 90° of path turn with `gAllowance > 1.3`. The preset ID `highG` was kept.
3. **Lesson 6 completion** uses the practice-only observer described above (70° peak, then < 20° above 60 m/s). The Phase 9 maneuver detector may replace it.
4. **Naming:** `maneuver.highGRate` / `highGDrag` and the HUD `HI-G` flag now describe only the automatic hard turn. They were left unrenamed to keep this change small.
5. **Pedal ramp time** of 0.2 s is a provisional input-shaping constant (`PEDAL_RAMP_SECONDS`), not aircraft capability. It needs a playtest.
6. **The Q/E ramp-down counts as stick input.**
   - After Q or E is released, yaw stays nonzero for up to 0.2 s.
   - During that time the controller's neutral branch does not engage on yaw, and `releaseSeconds` keeps resetting.
   - As a result, recovery assist starts up to 0.2 s later than after the old digital release.
   - The alternative is an instant release: ramp up only, and drop to 0 on release. No code change was made.

## Deviations

- The camera phase fallback was removed in Phase 6 instead of Phase 7, because the field it read is gone.
- `maneuvers.ts` was kept (airbrake smoothing) rather than merged into `engine.ts`. The plan allows either.
- `docs/flight-profiles.md` was out of date before this phase (it still described `fullControlThrust` and per-profile PSM rates). Only its PSM, C and X sections were rewritten here. The rest waits for Phase 8.
