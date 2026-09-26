# Phase 7 — Camera + HUD polish

Parent commit: `0544e52` (Phase 6 legacy gate removal). Physics version: `p6-legacy-gates-1` (unchanged). Command schema: `2` (unchanged).

**Ordering.** The Rev. 4 plan puts Phase 8 (aircraft validation) before final Phase 7 polish. Phase 8 is still open: the pedal-energy owner decisions have not been answered. Phase 7 ran first because the owner asked for it. Phase 7 changes presentation only, so Phase 8 tuning does not invalidate it. If Phase 8 changes how airframes move, rerun the B21 report and retune the camera constants below. The flight model itself needs no change.

## Summary

The goals were a camera that makes maneuvers look good, moves smoothly and is easy to fly with. Before any change, a new B21 benchmark measured the old camera on real flight traces. It found two defects:

1. **A tail-slide flip.** The view looked 88% of the way from the nose to the path by a plain lerp. At 180° incidence those two directions are opposite, so the blended look vector passed through zero. As the decouple weight ramped up, the view flipped half a turn in one frame. The spike was 864–1000°/s, and the airframe left the frame (projected extent 10.6, where 1.0 is the frame edge). This happened on both airframes, at every frame rate.
2. **Roll spikes through the vertical.** The horizon camera rolled at about 270°/s p95 every time the view crossed the vertical in a Kulbit, and at 278°/s in a looping hard turn. The roll back to level had no rate limit.

**Iteration.** The first Phase 7 camera weighted the view toward the nose (share 0.42→0.35) and made the horizon camera follow the airframe's roll at high AoA, to match the mouse's body-axis mapping there. The owner playtested it and found it much harder to control, so it was replaced. The final camera holds the horizon at every AoA and runs the view down the flight path. The first version's numbers are kept under [Iteration history](#iteration-history).

The HUD gains a regime tone, an AoA bracket and a quieter departure advisory. Flight state, commands, the mouse mapping and the flight profile are untouched.

## Changes

### Camera ([FlightCamera.ts](../src/render/FlightCamera.ts))

All tuning values are named constants at the top of the file.

| Constant | Value | Meaning |
|---|---|---|
| `DECOUPLE` | incidence 8→35°, attack 7/s, release 3/s | How far the view leaves the nose. It uses incidence only, gated by airflow confidence. It rises quickly and eases back slowly. The old values were 20→60° and 4/s both ways. |
| `LOOK.pathShare` | 0.8 | Once decoupled, the view runs down the flight path, turned back toward the nose by 20% of the incidence. |
| `LOOK.residualFadeDeg` | 90° | That turn-back fades from 90° to nothing at 180°. In reverse flow the view sits on the path whichever side of the tail the path passes, so no rotation axis is needed there. This removes the flip. |
| `LOOK.maxRate` | 240°/s | The look direction itself turns no faster than this, so any remaining swing (a tail-slide apex, for example) is a bounded pan and never a jump. |
| `FOV.decouple` | +10° | FOV widens with decouple. The base, speed and burner terms are unchanged. Reduced motion stays at 61°. |
| aim raise, back distance | `0.5 + decouple·4`, `+ decouple·9` | These keep the airframe framed during the wider swing. |
| `OFFSET` | 10/s attached → 5/s decoupled | The chase offset trails further in a drift, so the airframe visibly swings against the view. |
| `UP` | horizon 5/s (slowed by `1 + |ω|/3`), cap 180°/s; aircraft 14/s, cap 540°/s; vertical cone 0.1–0.35 | See below. |

**Up vector.**
- **Horizon mode** holds world up about the view at every AoA. Where the view itself runs near vertical (its horizontal share is below 0.35), the world's up vanishes. There the camera keeps its own up, carried along the view's turn, and eases back to level only as the view leaves the cone. The return is capped at 180°/s and slows while the airframe rotates fast.
- **Aircraft mode** follows the airframe's up tightly, as before.
- **Reduced motion** is unchanged: no decouple, a fixed 61° FOV and an instant up.

**Control note.** At high AoA the mouse still works in body axes (`readStickAxes` eases to body axes by `highAoa`, from Phase 4.5). With the horizon held and the airframe banked, "mouse up" pulls the nose toward the canopy, which can be sideways on screen. This is the pre-Phase 7 behavior, and the owner preferred it to a rolling horizon. The mapping is not changed here.

### Scene ([FlightScene.tsx](../src/render/FlightScene.tsx))

The camera pose now carries interpolated velocity, the same value the HUD already drew the FPM from. Before this change, the camera's path look stepped at 120 Hz while orientation was interpolated.

### HUD

- **Regime tone** ([hudPainter.ts](../src/features/flight/hudPainter.ts)): `GlassState.regime` carries the envelope label. The α/G row takes its brightness from the regime: NORMAL is dim, HIGH_AOA is bright, RECOVERING uses the caution green, and POST_STALL/DEPARTED use the alert green. All of these stay within the one phosphor family. The row's flag now names the regime (`HI AOA`, `POST STALL`, `RECOVER`, `DEPART`) instead of a generic `PSM`. The FPM is drawn thicker in the alert green while POST_STALL or DEPARTED. `psm` stays on `GlassState` for compatibility.
- **AoA bracket:** a screen-fixed scale in the gap between the speed tape and the ladder clip, so it never chases an off-screen FPM. Its geometry scales with that gap (`glassLayout().aoaScaleX` / `aoaUnit`). It is left out in the compact layout (width ≤ 760), where the tape sits on the ladder clip edge and there is no gap. The α row still shows incidence and the regime there.
  - The lower half runs from 0 to `alphaCriticalDeg`. The upper half runs on to `maxControllableAlphaDeg`, so the 20–30° band is not crushed under a 180° scale.
  - The bracket marks `alphaNormalDeg`→`alphaCriticalDeg`. A caution tick shows the limiter's current `alphaLimitDeg`, which visibly opens during entry. A caret in the regime tone shows incidence. A bar is drawn above the caret when incidence is past the scale.
  - It fades in from 60% of `alphaNormalDeg` and is absent in ordinary flight. `aoaBracket()` is a pure function.
- **Departure warning, less intrusive** ([telemetry.ts](../src/features/flight/telemetry.ts), [flight.css](../src/features/flight/flight.css)):
  - `warningSeverity()`: only `lowAltitude` and `boundaryWarning` blink. The stall, recovery and low-energy plates are steady and use a dimmer frame (`data-severity="advisory"`).
  - `holdWarning()` holds an advisory for 800 ms after its condition clears, so a label that crosses its threshold does not flicker at the 10 Hz telemetry rate. Hazards are never held, and a new condition replaces a held plate at once.

## B21 evidence

The new `benchmarks/flight/camera.report.ts` report was run against the HEAD camera (`out/camera-before.*`) and the final camera (`out/camera-after.*`), with the same file both times. It covers 11 live tracks per airframe, 30/60/144 fps, 9:16, 4:3, 16:9 and 21:9, and both roll modes. Visibility uses the HUD's own `projectVelocityMarker` rule (24 px inset).

Horizon mode, 16:9, 60 fps. Each cell shows before → after.
- **Nose/FPM columns:** the share of frames with the marker on screen in each incidence band, as nose/FPM.
- **Extent:** the maximum projected airframe box, where 1.0 is the frame edge. The box is deliberately generous at ±9.45 × ±3 × ±7.5 units.
- **Roll:** the camera's roll about its own view axis in °/s, as p95/max.

| Aircraft | Track | Nose/FPM 20–40° | Nose/FPM 40–70° | Nose/FPM 70–110° | Extent | Roll °/s | Max view °/s |
|---|---|---|---|---|---|---|---|
| F-22 | cobra | 67%/100% → 86%/100% | 25%/100% → 3%/100% | 0%/100% → 0%/100% | 0.89 → 0.82 | 0/0 → 0/0 | 84 → 57 |
| F-22 | kulbit | 100%/100% → 100%/100% | 45%/100% → 5%/100% | 0%/100% → 0%/100% | 1.10 → 1.07 | 268/296 → 170/182 | 318 → 218 |
| F-22 | psmIntent450 | 100%/100% → 100%/100% | 45%/100% → 5%/100% | 0%/100% → 0%/100% | 1.09 → 1.01 | 273/298 → 173/182 | 315 → 213 |
| F-22 | tailSlide | 63%/100% → 84%/100% | 0%/100% → 0%/100% | 0%/100% → 0%/100% | **10.58 → 1.21** | 0/0 → 0/0 | **1000 → 238** |
| F-22 | reversal180 | 85%/80% → 67%/56% | 45%/100% → 5%/100% | 0%/100% → 0%/100% | 2.06 → 1.14 | 120/205 → 140/162 | 882 → 285 |
| F-22 | hardTurn900 | — | — | — | 1.10 → 1.13 | 278/295 → 174/175 | 303 → 185 |
| F-22 | entry-pitch-450 | 100%/100% → 100%/100% | 36%/100% → 0%/100% | 0%/100% → 0%/100% | 0.97 → 0.85 | 0/0 → 0/0 | 61 → 46 |
| F-22 | handoff | 100%/79% → 100%/100% | 50%/83% → 27%/97% | 9%/93% → 4%/91% | 1.30 → 1.21 | 129/158 → 150/163 | 235 → 209 |
| F-22 | rollPull | 100%/100% → 100%/100% | 79%/100% → 58%/100% | 0%/100% → 0%/100% | 1.25 → 1.24 | 8/9 → 7/7 | 70 → 54 |
| Su-57 | cobra | 73%/100% → 86%/100% | 25%/100% → 3%/100% | 0%/100% → 0%/100% | 0.89 → 0.83 | 0/0 → 0/0 | 82 → 55 |
| Su-57 | kulbit | 100%/100% → 100%/100% | 38%/100% → 4%/100% | 0%/100% → 0%/100% | 1.06 → 1.06 | 273/298 → 172/182 | 316 → 213 |
| Su-57 | tailSlide | 58%/100% → 84%/100% | 0%/100% → 0%/100% | 0%/100% → 0%/100% | **10.55 → 1.21** | 0/0 → 0/0 | **1000 → 238** |
| Su-57 | reversal180 | 87%/100% → 87%/100% | 45%/100% → 5%/100% | 0%/100% → 0%/100% | 1.40 → 0.89 | 102/291 → 112/161 | 435 → 251 |
| Su-57 | handoff | 100%/100% → 100%/100% | 66%/100% → 41%/100% | 0%/100% → 0%/100% | 1.36 → 1.22 | 18/22 → 29/33 | 216 → 185 |
| Su-57 | rollPull | 100%/100% → 100%/100% | 37%/100% → 69%/100% | — | 1.24 → 1.24 | 9/9 → 4/4 | 73 → 57 |
| Su-57 | pedal | 100%/100% → 100%/100% | 100%/100% → 100%/100% | — | 1.05 → 0.85 | 24/31 → 6/12 | 63 → 36 |
| Su-57 | entry-yaw-450 | 100%/100% → 100%/100% | 100%/100% → 100%/100% | — | 1.14 → 0.86 | 2/2 → 2/2 | 30 → 26 |

Worst case over every track, aspect ratio and frame rate:

| Mode | Max extent (all / not 9:16) | Depth-invalid frames | Max roll °/s | Max view °/s |
|---|---|---|---|---|
| horizon | 96.94 → 1.72 / 1.24 | 32 → 0 | 414 → 182 | 1227 → 287 |
| aircraft | 3168.89 → 1.91 / 1.59 | 64 → 0 | 482 → 476 | 1264 → 503 |

- **Horizon roll never exceeds its 180°/s cap** (182 including the view's own turn). The remaining 170–175°/s in Kulbit, `psmIntent450` and `hardTurn900` is the unavoidable half-turn back to level after the flight path itself goes over the top. At 450 km/h the Kulbit is a tight loop: its path passes vertical.
- **Aircraft mode** rolls with the airframe by design. Its 476°/s is F-22 `handoff` rolling.
- The frame-rate spread (30 or 144 fps against 60 fps) is at most 0.013 in extent.
- The stick-frame mismatch column in the report is diagnostic only. The final camera does not target the stick's frame.

### Trade-offs to judge in playtest

- **The nose leaves the frame early.** With the view on the path, the nose pipper is on screen for only 0–5% of frames at 40–70° in pitch maneuvers (HEAD: 25–45%, because its decouple ramped in slowly). The edge chevron and the AoA bracket carry it there. `LOOK.pathShare` trades this against path framing; 0.7 would keep the nose up to about 45°.
- **The tail-slide apex pans at 240°/s.** At the apex the path turns over and the view pans with it. The pan is bounded by `LOOK.maxRate` and no longer flips.
- **Banked drift keeps a level horizon and a body-axis stick.** In a banked drift, "mouse up" can move the nose sideways on screen (see the control note above).

## Iteration history

The first Phase 7 camera, which the owner rejected in playtest, used a nose-weighted look (`PATH_SHARE` 0.42→0.35) and a horizon camera that followed the airframe's roll by `highAoa` (`UP.highAoaRoll = 1`). It scored well on the circular stick-frame metric and removed pitch-plane roll entirely: Kulbit roll 0/0 and Cobra nose 69–73% at 40–70°. But banked and yawed drift rolled with the airframe at 143–260°/s p95 (`rollPull`, `handoff`, Su-57 `pedal`). The owner found that much harder to control. An A/B with the roll follow off and the nose-weighted look kept brought back vertical-crossing spikes (Kulbit 271/350°/s, Cobra 187/384°/s), because a nose-weighted view crosses the vertical. The final design avoids both problems:
- the view follows the path, which crosses the vertical far less often than the nose does;
- the up is held (carried) inside the vertical cone instead of switching to the airframe's up;
- the return to level is capped.

## Tests

- `tests/airflowCamera.test.ts`:
  - **Migrated:** the 90° decoupling case (`z < −20`) keeps its bound, and now also asserts that the view sits nearer the path than the nose. A reduced-motion FOV = 61° check was added.
  - **New:** steady framing at 30/60/90/120/180° incidence (4:3 and 16:9). The airframe box stays in frame and in depth. The FPM is on screen at every incidence, and the nose at 30°. State is unchanged.
  - **New:** a no-flip guard on F-22/Su-57 `tailSlide` traces and on a path sweep across 180° (under 0.1 rad per 1/60 s). The HEAD camera fails it.
  - **New:** horizon mode holds world up about the view at 0/60/120° incidence and banks of 45–180°. Aircraft mode rides the airframe. Reduced motion holds level.
  - **New:** an attached loop over the top carries the up through the vertical and rolls back to level no faster than π rad/s. The HEAD camera fails it.
  - The framing and horizon-hold tests also pass on the HEAD camera, which was already path-weighted and level-holding. They guard the final behavior, not the defects.
- `tests/flight.test.ts`, "returns to upright horizon after crossing vertical": this case now flies attached flow (velocity along the nose) instead of turning the nose against a fixed velocity. It still passes, and it tests the vertical crossing it was named for.
- `tests/hud.test.ts`: regime and alpha marks on the glass, the one-family tone, bracket visibility, order and bounds, bracket placement inside the tape/ladder gap in every layout, a high-AoA paint smoke test, and warning severity and hold.

`npm test`: 41 files, 568 tests pass (560 at parent plus 8 new). `tsc -b`: the only error is in the untracked `benchmarks/flight/noseFlick.report.ts`, which still uses the removed `highG` field. It was already failing before this phase and is not part of this change.

## Neutrality

- No file under `src/game/**` changed. There is no `flightProfileVersion` bump, no `goldenPolicy` entry and no golden regeneration.
- Every camera test asserts `state` is unchanged after `update()`. The camera no longer reads `screenFrame` or the envelope; the mouse mapping is unchanged. The `tests/invariants/phase6.test.ts` grep (no phase reads in `FlightCamera`, flight or HUD) passes.
- `npm run flight:bench` was not rerun as a whole, because physics is unchanged and a full run would rewrite the owner's `pedal-energy` and `nose-flick` outputs. Only `camera.report.ts` was run.

## Retirement table

| Item | Status |
|---|---|
| 0.88 nose/path lerp | Retired. Replaced by path look with a residual that fades to 0 at 180° (`LOOK`). |
| Decouple band 20→60° at 4/s | Retired. Now 8→35°, with 7/s attack and 3/s release. |
| Unlimited roll back to level after the vertical | Retired. Capped at 180°/s, and held (carried) inside the vertical cone. |
| First-iteration roll follow at high AoA (`UP.highAoaRoll`) | Removed after owner playtest. |
| `PSM` HUD flag text | Replaced by regime names. The `GlassState.psm` field is kept. |
| Blinking stall/recovery/low-energy plates | Retired. Only hazards blink. |

## Owner decisions requested

1. **Path share** (`LOOK.pathShare` 0.8). Higher values frame the path and the airframe's swing. Lower values (0.6–0.7) keep the nose on screen longer.
2. **Look pan limit** (240°/s) and **horizon return cap** (180°/s). Lower values are calmer but lag more in a Kulbit.
3. **FOV widening with decouple** (+10°). This helps the markers fit, but makes the airframe smaller during PSM.
4. **AoA bracket design:**
   - Screen-fixed placement beside the speed tape (not attached to the FPM).
   - A two-segment scale with attached flow in the lower half.
   - A limiter tick.
   - It fades in from 60% of `alphaNormalDeg` and is hidden in compact layouts.

   Alternatives: an FPM-attached bracket, or a numeric-only α readout.
5. **Advisory hold** of 800 ms, and steady (non-blinking) stall plates.
6. **Body-axis mouse at high AoA with a level horizon.** This is outside Phase 7 scope. If banked drift still feels hard, the next step is the mouse mapping, not the camera.

Human playtest is still required. The automated checks cannot judge motion comfort, the look of the swing, or whether the bracket reads at a glance.
