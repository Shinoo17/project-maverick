# MR1 — Mouse input

Parent commit: MR0. Physics version: `p8-pedal-turn-1` (unchanged). Command schema: `2` (unchanged).

Plan: [psm-maneuver-control-plan.md §4 and §5 MR1](psm-maneuver-control-plan.md#mr1--input-และ-mouse-input-only-ไม่-bump-physics). Owner decisions D5 (relative spring default) and D6 (no right-click hold).

## Summary

MR1 changes only how the mouse becomes a `PilotCommand`. It addresses RC5.

1. **Relative spring stick, the new default (D5).** Mouse motion pushes the stick as before, but the stick springs back to the middle with τ = 0.2 s. Moving the mouse turns the aircraft, and stopping it stops the turn.
2. **Body control frame, the new default.** Mouse up is nose up at every bank and every incidence. The pre-MR1 polar mapping, which reads the stick in the frame the camera holds, stays available as "Horizon-relative".
3. **Positional stick reshaped.**
   - Curve 2 → 1.5.
   - Dead zone 0.08 → 0.04.
   - Full deflection moves to 0.7 of the gate radius, which is 35% of the shorter side of the window.
   - Half of the reach now reads 33% instead of about 21%.
4. **Settings.** Mouse mode, control frame, sensitivity (×0.5–2), invert pitch, and mouse X as roll or yaw. They are stored locally in the existing `maverick.settings` blob.
5. **HUD.** A dashed circle marks full deflection, and the stick marker brightens when it reaches that circle.
6. **Help text** (th/en). It adds a relative-mode hint and the recommended use from plan §4.3, without right-click.

No right-click stick hold (D6). Right mouse stays reserved for missiles, so a held pull goes on ↑.

## Mechanism

### Relative stick ([mouseStick.ts](../src/game/input/mouseStick.ts), [FlightInput.ts](../src/game/input/FlightInput.ts))

| Constant | Value | Meaning |
|---|---|---|
| `MOUSE_RELATIVE.returnSeconds` | 0.2 | Spring time constant. The plan's playtest range is 0.12–0.35 s. |
| `MOUSE_RELATIVE.reach` | 0.5 | Full deflection as a fraction of the gate radius. A steady 1350 px/s sweep holds full stick on a 1080p window. |
| `MOUSE_RELATIVE.deadZone` / `curve` | 0.02 / 1.25 | Shaping. It is lighter than the positional stick's, because the spring already softens the middle. |

**Determinism (I2).** The spring runs once per command tick, following the Q/E pedal precedent. It never runs per rendered frame.
- A second read of the same tick changes nothing.
- Ticks that nobody read still spring.
- Motion that arrived since the last tick is not sprung, so the hand's latest motion is read in full.
- A resting hand reaches exact zero below half a pixel, which hands the axis back to the controller's neutral branch.

**Clamp.** The stick is clamped to the full-deflection circle for each motion event, like the positional stick's gate. A hard sweep therefore cannot wind up past full stick, and a reversal answers at once. The circle carries one tick of spring as headroom, so a sweep held at full speed still reads 1.0.

### Body frame

`FlightInput.command` passes `LEVEL_FRAME` and zero incidence blend to `readStickAxes` when `mouse.frame === 'body'`. `FlightScene` still refreshes `input.screen` every tick, but the body frame ignores it.

The maneuvers report's RC5 probe holds the pointer at top-right and sweeps the bank:

| Bank | Horizon frame (pre-MR1) | Body frame (MR1 default) |
|---:|---|---|
| 0° | pitch 0.71, roll 0.71 | 0.71, 0.71 |
| 90° | −0.71, 0.91 | 0.71, 0.71 |
| 135° | −1.00, 0.71 | 0.71, 0.71 |
| 180° | −0.71, −0.91 | 0.71, 0.71 |

## Tests

New file: `tests/mouseModes.test.ts`, 11 tests.
- The defaults follow D5.
- The spring advances once per tick, and a tick can be read many times without changing it.
- Skipped ticks still spring, and a resting stick reaches an exact neutral command.
- Commands depend only on the motion within each tick, not on how the motion was chunked.
- **I2:** the relative stick replays identically at 30/60/144 FPS for both aircraft, including through the public replay.
- The clamp saturates and a reversal answers at once.
- The body frame gives the same command at every bank and incidence, while the horizon frame keeps its mapping.
- Keyboard priority, invert pitch, mouse X as yaw, and sensitivity.
- Positional shaping reads about a third of full deflection at half the reach.
- Settings parse field by field with fallbacks.

**Amended tests.** Every pre-MR1 mouse test was written for the positional stick read in the camera's frame. They now construct `new FlightInput(positionalHorizon)` explicitly (`tests/invariants/helpers.ts`), so they keep testing the same behavior now that it is no longer the default.
- `flight.test.ts` "soft middle and squared curve" becomes "soft middle and shaped curve". The same assertions now read the shaping constants.
- `flight.test.ts` "settles on the bank the pointer angle asks for": the shallow case now places the pointer where it commands the same deflection the old test flew. With the new shaping, the old pointer position commands about 0.79 instead of 0.32, and in the **horizon** frame that harder pull keeps rolling past the 30° bank. This is RC5 itself, and it is why the body frame is the default now.
- `foundation.test.ts` and `profiles.test.ts`: the expected settings now include `controls`. No test was removed or loosened.

`npm test`: 43 files and 589 tests pass (was 42 / 578). `tsc -b` reports only the pre-existing `noseFlick.report.ts` error.

**Neutrality.** The maneuvers report sections from `roll` to `kulbit` are byte-identical to `mr-baseline/maneuvers-baseline.md`. Only the mouse probe changed, and it gained the body rows.

## Files

`mouseStick.ts`, `FlightInput.ts`, `FlightPage.tsx`, `FlightScene.tsx`, `flight.css`, `platform/storage.ts`, `app/sessionStore.ts`, `locales/th.ts`, `locales/en.ts`, `docs/game-design/02-controls.md`, `benchmarks/flight/maneuvers.report.ts` (mouse probe), tests.

`session.ts` did not need a change: the settings live on `FlightInput.mouse`.

## Owner decisions requested

1. **Playtest the relative stick.** τ 0.2 s and reach 0.5 are starting values. The plan's range for τ is 0.12–0.35 s. Should τ and reach become settings?
2. **Positional stick reach.** Full deflection is now at 35% of the shorter side. Is that right for players who keep the positional stick?
