# Control port from example/flight-control (2026-11-14)

Owner request: replace this project's controls with those of `example/flight-control`. The owner will redo the physics separately.

## Owner decisions

- Scope: input and camera. The example's FCS (`Fcs.ts`) and physics (`FlightModel.ts`) are not ported.
- The old mouse modes are removed: cursor, relative, positional stick, push capture, the coordinated turn and the Q/E pedal ramp.
- The controls connect to the new flight core (`src/game/flightCore`) through an adapter.

## What was ported

| Example file | Here | Changes |
|---|---|---|
| `input/ControlAxes.ts` | `src/game/control/ControlAxes.ts` | imports only |
| `input/MouseAim.ts` | `src/game/control/MouseAim.ts` | imports only |
| `input/ControlMixer.ts` | `src/game/control/ControlMixer.ts` | Reads `ControlAircraft` instead of `FlightModel`. `PSM.recovery.handbackTime` is now a local constant. |
| `flight/AimController.ts` | `src/game/control/AimController.ts` | Reads `ControlAircraft`. `gLimited` uses `authorityRate()`. |
| `camera/ChaseCamera.ts` | `src/render/arcade/ArcadeChase.ts` | Class renamed. Adds `setLook` / `lookingAway` so FlightInput can drive free look. |
| `config.ts` INPUT, MOUSE, CAMERA | `src/game/control/config.ts` | Values unchanged. Adds `FcsMode` and `CRUISE_SPEED` (230). |

## New code

- `src/game/control/controlAircraft.ts`: the adapter between the two projects.
  - **Frames.** The example's body frame has +Z forward and +X left. This project's has +X forward and +Z right. `toExampleFrame` multiplies the orientation by a quarter turn about body Y. World vectors are the same in both projects.
  - **Rate limits.** `rateLimits()` calls `availableRates()`, which is now exported from `flightCore/rotation.ts`. The core uses the same function, so when the physics is retuned, the aim controller follows it. Pitch is capped by the G limit.
- `src/game/input/FlightInput.ts` is rewritten as a façade over `FlightControls` and `ControlMixer`.
  - The controls step once per command tick (dt = ticks × `WORLD_STEP`), so replays are deterministic.
  - The example's FCS mode is mapped as: PSM key held → `'PSM'` with weight 1, otherwise `'NORMAL'`. There is no RECOVERY.
  - `speedAdjust` takes the example's smoothed thrust value (−1..1).
- `src/render/ArcadeCamera.ts` implements `CameraRig` on top of `ArcadeChase`. It is the default camera for both cores (`session.cameraRig = 'arcade'`). The FR2 `ChaseCamera` and the legacy `FlightCamera` can still be selected in Flight Lab for comparison.
  - Settings FOV scales the example's FOV curve. At the settings default (56) the FOV is exactly the example's.
- `src/game/control/mouseSettings.ts` replaces the settings part of `mouseStick.ts`. Fields: sensitivity, invertPitch, aimLimit, aimAssist.
- `CameraSettings.mode` is one of `'aircraft' | 'horizon' | 'aim'`. V cycles through them. Settings › Camera shows this choice. `roll` / `horizonStyle` are kept in step with it for the old rigs.
- Bindings are now version 3:
  - ←/→ are the second roll keys again.
  - M toggles Mouse + Keyboard / Keyboard only.
  - G toggles aim limited / free.
  - A v1 or v2 save is migrated: the coordinated-turn keys become roll keys.

## Kept

- Weapon keys and mouse buttons.
- Free look (C) and look back (R). Look angles use the example's `freeLookDegPerPx`.
- Gun aim assist (`aimMagnet` on the aim direction).
- `mouseAim.ts`. It is still the combat bot's instructor (`botPilot.ts`), not the player's.

## Removed

- `src/game/input/mouseStick.ts` and `src/game/input/pushCapture.ts`.
- Tests that covered the removed modes:
  - `mouseAim.test.ts`
  - `mouseModes.test.ts`
  - `automaticMouse.test.ts`
  - `flightCoreInput.test.ts`
  - the stick and mouse-flight parts of `flight.test.ts`
  - the pedal tests in `phase6.test.ts`
- Benchmarks:
  - `aimFeel.report.ts`
  - `aimTrack.ts`
  - `aimTrack.report.ts`
  - `maneuvers.report.ts`
  - `camera.report.ts`

## Verification

- `tests/exampleControls.test.ts` (16 tests) covers:
  - the frame adapter and rate limits
  - progressive keys
  - replay at 30/60/144 FPS
  - aim convergence on the new core: 30° settles within about 1 s, and a 120° free aim settles within about 3.5 s, with no hunting
  - key hand-over
  - the PSM virtual stick
  - camera placement and roll per mode
  - settings migrations
- `tsc -b` is clean.
- `vitest run`: every project test passes. The 9 failures in `example/flight-control/tests/camera.test.ts` were already failing before this change.
- Browser check (Keyboard only): the flight page loads and flies, the arcade chase camera renders, and the console shows no errors. Mouse aim was not checked in the browser because pointer lock is unavailable under automation.

## Follow-up (2026-11-16)

The owner reported six problems after trying the port. Bugs 1 and 2 were physics, not input: the flight page flew the legacy core by default, and the new core has no PSM (`psmAuthority` is always 0).

Owner decisions:
- Port the example's physics as its own flight core, and make it the default.
- Keep the example's speeds: cruise 230 m/s, with the HUD showing km/h as m/s × 3.6.

### The 'arcade' flight core (`src/game/arcadeCore/`)

| Example file | Here | Changes |
|---|---|---|
| `flight/FlightModel.ts` | `FlightModel.ts` | Imports. Adds `place`, `save` and `load`. |
| `flight/Fcs.ts` | `Fcs.ts` | Imports. Adds `save` and `load`. |
| `flight/aero.ts` | `aero.ts` | Imports only. |
| `config.ts` SIM, SPEED_PRESETS.arcade, FLIGHT, PSM, PSM_PROFILES | `config.ts` | Values unchanged. Profiles are keyed by this project's aircraft ids; `f22-notvc` is the F-22 without nozzles. |

`step.ts` runs the core:
- Each command tick runs the example's fixed step (1/120 s): two sub-steps per `WORLD_STEP`, both with the same command. The FCS recovery timers count in 1/120 s.
- The command carries only switches for the afterburner and the airbrake, so the core smooths them at the example's rates.
- The model's and the FCS's memory is plain data on `AircraftState.arcadeFlight`. It is created on the first step. Snapshots clone it, and replays rebuild it.
- Ground and the training boundary end the flight, as in the other cores.

`readout.ts` fills FlightReadout:
- `hudSpeed` = m/s × 3.6.
- `psmAuthority` = the FCS's wHigh while ARMED or PSM.
- `regime` follows the example's regimes, with RECOVERING during the FCS's recovery.
- The burner has no reserve, so its clock reads ∞.

Other changes for this core:
- `flightCoreIds` is `['arcade', 'legacy', 'new']`. The flight page defaults to 'arcade'. The Flight Lab can still pick the other two.
- Practice spawns on the arcade core use the example's speeds (`arcadeSpawnSpeeds`):
  - free flight: 230 m/s
  - Cobra ready: 500 km/h, the top of the PSM curve
  - hard turn: 250 m/s
  - low energy: 55 m/s, under the 60 m/s stall

  The preset labels show these speeds. The combat bot's spawn scales by 230/130 (`arcadeSpawnSpeed`).
- `arcadeFlight` is created at spawn, so the controls and the camera read the real FCS from the first tick.
- The aim controller reads the arcade model's own `rateLimits`, `effectiveness` and `gLimitRate` (`controlAircraft.ts`, `arcadeControlLimits`).
- The mixer and the chase camera read the FCS's real mode, `wHigh` and recovery direction from `arcadeFlight`. On other cores the PSM key still stands in.
- The HUD, the screen-reader readout, the Mach number, vapor and engine sound take speed from the readout's `hudSpeed`. They no longer compute arcade km/h themselves.
- `EXAMPLE_BODY` and `toExampleFrame` moved to `arcadeCore/frame.ts` to avoid an import cycle. `controlAircraft.ts` re-exports them.

### Other fixes

- **HUD pitch ladder to ±90°.** Rungs follow a ground track built from the nose and the canopy (cos pitch · nose − sin pitch · up), so the ladder no longer vanishes with the nose vertical.
- **V/S** is now a sub-readout under the altitude box. The climb gauge is gone.
- **Gun zoom** eases in and out (`ArcadeCamera`, rate 8.5/s, about 0.35 s) instead of jumping with the trigger.
- **Mouse aim assist** (`aimMagnet`) now runs once per rendered frame on the interpolated poses (FlightScene), like mouse motion.
  - Before, it ran once per 60 Hz tick and moved the aim up to a degree per tick, while the HUD and camera glided between ticks.
  - Replays are unaffected, because they record commands, not the aim.

### Verification

- `tests/arcadeCore.test.ts` (7 tests) covers:
  - spawn at cruise and hands-off level flight
  - a Cobra from Space + ↑ at 500 km/h for both jets: σ > 70°, then RECOVERY back to NORMAL inside the α limit
  - the α limiter without Space
  - mouse aim converging on the arcade limits
  - deterministic replay with clone-safe state
  - the FCS mode reaching the camera
- `tsc -b` is clean, and `vitest run` (project tests) passes: 909 tests.
- Browser check (Keyboard only) on the arcade core:
  - spawns at 828 km/h
  - the ladder shows its 90 rung in a vertical climb
  - V/S shows under ALT
  - Space + ↑ goes to HIGH AOA, and a release recovers to NORMAL
  - the console shows no errors
- Not checked in the browser, because pointer lock does not work under automation: mouse aim and the assist smoothing.

## Open items

- The new core (`'new'`) still has no PSM. It is left for the owner's own physics work.
- The map is 8 km in radius. At the example's speeds (230 m/s cruise, 640 m/s on afterburner) the boundary comes up fast.
- Holding Space at cruise (828 km/h) barely opens the α limit, because the example's w curve is 0 above 780 km/h. For a Cobra, use Cobra ready or slow to 450–550 km/h, as in the example.
- Not checked: whether missiles, tuned against targets near 130 m/s, still connect against a bot that spawns at 265 m/s.
- If the aim assist still jumps when a target enters the cone while firing, ramp the draw rate in over about 0.2 s after capture. While firing, the draw goes from 0 to its 60°/s cap at once.

## Gun lock (2026-11-16)

Owner design. Under mouse aim it replaces the aim magnet (`aimMagnet`). It lives in `src/game/combat/gunLock.ts`.

- **Charge.** Hold the cursor within 4° of the selected target or its lead. A ring around the cursor fills over 1.5 s (Settings › Gun aim assist: Standard; 1.0 s on Strong; Off has no lock).
  - Charging only counts while the target is within gun reach (1,000 m) and ahead.
  - Off the target, the ring drains at one full ring a second instead of emptying at once.
- **Lock.** A full ring locks.
  - The cursor glides onto the lead (exponential at 14/s, at most 240°/s) and stays there. The lead is where the nose must point for the rounds to meet the target.
  - The aim controller flies the nose to the lead. A target turning harder than the jet can is still followed as closely as the physics allows.
  - The ring becomes a closed circle in the gun-lock colour: amber while assisting, red on the solution.
- **Break.**
  - Hand motion piles up with a 0.25 s decay. Past 7° the lock breaks: a flick, not a steady hand.
  - It also breaks when the target dies or changes, when the target goes past reach plus 100 m, or when the lead is more than 60° off the nose.
  - It breaks on free look and look back, and while Space holds the PSM virtual stick.
  - Re-locking takes the whole dwell again.
- It runs once per rendered frame on the interpolated poses (`FlightScene`). `FlightInput.takeHandMotion()` reports how far the hand turned the aim.
  - Rounds never steer and hitboxes never grow.
  - Replays record commands, so the lock does not affect them.
- Keyboard only keeps the stick assist.
- Tests: `tests/gunLock.test.ts` (6).
- Not checked in the browser: mouse mode needs pointer lock, which automation cannot get.
- Every number is in `gunLockTuning` for playtest.

### Magnet and level view (2026-11-16, owner follow-up)

Owner feedback:
- When the jet rolled, the whole view tilted, target included.
- The nose has to keep up with the lead, as if a magnet were pulling it the whole time.

What changed while the lock holds:
- **Magnet (arcade core).**
  - Each command carries `gunTrack`, the lead direction (`PilotCommand.gunTrack`, command schema 4).
  - Every sub-step, the arcade core turns the nose toward it: 8/s of the angle, at most 75°/s (`GUN_TRACK` in `arcadeCore/config.ts`).
  - The flight path turns with the nose (`pathShare` 1), so the jet goes where the nose is drawn without sliding sideways or stalling. The turn costs no energy (arcade).
  - The magnet is the minimal rotation toward the goal, so it does not roll the jet.
- **Stick.** The aim controller stays off the stick (`FlightInput.gunTracking`), so bank-to-turn does not roll the jet. Held keys still fly.
- **View (Aim lock).** The chase camera looks along the aim (the lead) with a level horizon: `ArcadeChase` `gunLock`, eased over about 0.3 s. The target holds still and upright on screen whatever the jet's roll.
- Other cores have no magnet. There the aim controller flies the nose as before.

Tests (`tests/gunLock.test.ts`, 9 in total):
- The magnet brings the nose onto a goal 27° off in 0.75 s, with bank under 5° and incidence under 5° at the end.
- The stick is held off while tracking.
- A jet banked 70° gives a camera roll under 1°, with the view within 3° of the lead.

Simulation probe (not kept as a test), with the aim put on the drone and the trigger held while locked:
- Racetrack drone: 150 hits in 40 s.
- Circling drone: 177 hits in 40 s.
