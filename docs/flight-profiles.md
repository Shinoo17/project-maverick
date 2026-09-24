# Aircraft flight profiles

Tune each aircraft in `src/content/flight-profiles/f22.ts` or `su57.ts`.
These are arcade game settings, not real aircraft specifications.

- `flight`: normal-flight speed, energy and handling.
- `stall`: low-speed/high-incidence envelope and gradual loss/recovery of control.
- `maneuver`: legacy path-grip terms, the automatic hard-turn rate/drag multipliers and afterburner budget.
- `breakout`, `bankedDrift`, `recovery`: automatic high-AoA permission, knife-edge drift cap and neutral-stick recovery assist.
- `aero`, `arcadeControlFloor`: natural aerodynamics, control effectiveness and the near-rest gap-fill floor.
- `thrustVectoring`: twin-engine TVC geometry/actuators (vertical or canted planes), or `null`.

`src/game/flight/profileTypes.ts` documents the fields and units. Top speeds use
displayed ARCADE km/h. The minimum powered speed still uses simulation m/s; angular rates use rad/s, and durations use seconds.

## Set top speeds

Edit these fields in the aircraft's `flight` block:

```ts
topSpeedKph: 1080,
afterburnerTopSpeedKph: 1400,
```

Enter the number you want to see on the HUD. The runtime divides it by `3.6 * 1.5`
once when spawning the aircraft; the HUD uses the inverse conversion. Thus 1400
means about 259.26 simulation m/s, not a real-world speed of 1400 km/h. Both current
aircraft retain the old normal limit of 200 m/s (1080 on the HUD), with an explicit
afterburner limit of 1400 on the HUD.

- W accelerates toward `topSpeedKph`; releasing W retains the short coast and
  then holds the reached speed in level flight.
- Afterburner accelerates toward `afterburnerTopSpeedKph`, with or without W.
- Releasing or exhausting afterburner sheds excess speed gradually toward the
  normal limit. Velocity is never snapped down to a cap.
- Climbing, turning and PSM still consume energy. A dive can exceed a powered limit.
- Space (Airbrake) adds braking without cutting engine thrust. W + Space and Shift + Space
  work together, including at high AoA. More thrust can outweigh the brake; Space does not
  promise deceleration. Before Phase 6 the Airbrake was on X; X is now unbound.
- S still decelerates toward `minPoweredMps`; airbrake and flight energy losses
  can take the aircraft below that value.

Top speed must exceed the displayed equivalent of `minPoweredMps`, and afterburner
top speed must be at least normal top speed. Acceleration and afterburner duration
still determine how long it takes to reach a limit, and whether the burner lasts
long enough. Higher configured limits automatically receive enough thrust budget
to overcome base drag, so changing top speed does not require retuning `maxThrust`.
The old fixed overspeed drag threshold at 260 m/s has been replaced by gradual
deceleration above the active configured limit.

## Override speeds for a session or future mission

Pass optional `flightOverrides` into the session config:

```ts
const runtime = new GameRuntime({
  mode: 'playground',
  aircraftIds: ['f22'],
  flightOverrides: {
    f22: {
      topSpeedKph: 1400,
      afterburnerTopSpeedKph: 2400,
    },
  },
})
```

Overrides use the same ARCADE km/h units: 2400 becomes about 444.44 simulation m/s.
This does not switch the simulation or HUD to real-world km/h. Only the two top
speed fields can be overridden; omitted fields inherit the aircraft profile.
Override IDs must belong to the session. An override applies to every instance
of that aircraft type within that session.

The runtime copies overrides, validates the combined limits, and resolves a
separate `speedLimits` object for each aircraft. Shared profiles and other sessions
are unaffected. Reset preserves the session's overrides, and replay exports include
them so playback uses the same limits. The replay profile version was updated for
the new speed rules; replays from the previous model are rejected.

The override mechanism works with the current session modes; it does not add
campaign mode or a mission editor.

## Defaults and aircraft independence

`defaults.ts` contains shared control responses, stall transitions and maneuver defaults. Each aircraft
spreads these into its own objects and explicitly defines its flight performance.
No aircraft inherits from another aircraft. Editing F-22 tuning does not change Su-57.
Editing a shared default affects every aircraft that does not override that field.

There is no PSM switch. High-AoA flight is available to every aircraft through the
continuous envelope; what it can do there comes from its `aero`, engine and
`thrustVectoring` capability. An aircraft with `thrustVectoring: null` has no powered
rotation (see `f22-notvc`).

## Tune stall

Each aircraft explicitly defines its envelope. Both current aircraft start with
the same forgiving arcade baseline; these are not measured aircraft specifications:

```ts
stall: {
  ...stallDefaults,
  stallSpeedKph: 300,
  separationAttachedSpeedKph: 350,
  criticalAoaDeg: 30,
  separationAttachedAoaDeg: 20,
},
```

| Field | Meaning |
| --- | --- |
| `stallSpeedKph` | Fully separated edge of the low-speed band, in displayed ARCADE speed. |
| `separationAttachedSpeedKph` | Attached edge of that band; must exceed stall speed and be <= normal top speed. |
| `criticalAoaDeg` | Fully separated edge of the pitch-alpha band (absolute degrees). |
| `separationAttachedAoaDeg` | Attached edge of that band; below the critical angle. |
| `controlAuthority` | Remaining legacy path grip at full separation, 0–1; default 0.25. Angular authority is budgeted separately. |
| `dragMultiplier` | Base drag multiplier at full separation, >= 1; default 1.8. |
| `separationEntrySeconds` | Exponential time constant toward more separation; default 0.4 s. |
| `separationRecoverySeconds` | Exponential time constant toward reattached flow; default 1.2 s. |

These are the edges of two continuous bands and the memory constants between
them, not switches: nothing in the simulation asks whether the aircraft "is
stalled". Separation scales drag, damping and legacy path grip. It does not
scale angular control authority, which comes from `aero.controlEffectiveness`
versus measured incidence, nor the natural restoring moment, which comes from
`aero.restoring`.

`aero.departure` is the nose-down bias that acts only in reversed flow, where the
restoring moment is zero and a tail slide would otherwise hang nose-up. Raise
`stiffness` (rad/s² at q = 1) for a faster nose drop; raise `minPressure` (a
dimensionless q floor, 0.3 is about 49 m/s) to keep that drop strong at the
near-motionless apex of a slide. It is shared by both stock airframes and can be
overridden per aircraft. `docs/reverse-flow-departure.md` records the model,
the sweep behind the stock values and the maneuvers it changes.

`bankedDrift` turns a knife-edge pull into a horizontal drift instead of a cobra.
Above about 55° bank it lowers the incidence limit toward `maxAlphaDeg` and keeps
`pathGrip` of the path assist, so the velocity follows the nose around the corner.
Its effect is full at `bankFullDeg` and at or above `speedFullKph`; it is zero
wings-level and inverted. Raise `pathGrip` for a tighter carve with less slip; lower
it for a looser slide. Raise `maxAlphaDeg` to allow more slip before the cap. Keep
`speedFullKph` below the S floor (351 on the HUD) or a held S drift releases the cap
as speed settles. The cap only ever lowers permission; it adds no authority.

Speed uses the same conversion as `topSpeedKph`: 300 on the HUD is about 55.56
simulation m/s. `minPoweredMps: 65` still limits S to 351 on the HUD, so holding S
alone does not stall these aircraft. Airbrake, climbing or maneuver losses can.
Session overrides still only change top speeds, which must leave enough normal
speed for stall recovery. They do not scale stall or breakout thresholds automatically.

Either low speed or high absolute AoA starts stall. Once severity is nonzero,
**both recovery thresholds** must be satisfied for it to fade. Those thresholds
remain in effect until severity reaches zero, preventing rapid on/off switching.
AoA is signed incidence in the aircraft's forward/up plane; sideways flow alone
does not count as pitch AoA, while backward flow is near ±180°. This arcade model
does not simulate wing loading, density, Mach effects or a physical lift curve.

Stall progressively reduces normal control/path grip, increases base drag and
removes arcade gravity support. It never locks the controls, forces a nose-down
rotation or triggers a scripted spin. The default retains enough control to
align the nose with the flight path and regain speed with W. At zero speed,
gravity still makes the aircraft fall; the normal energy correction cannot freeze it.

High-AoA capability is independent of stall. Angular authority comes from
airflow-derived aero effectiveness plus TVC torque from actual engine thrust, allocated
per axis. No thrust means no TVC; remaining surface control and damping still work.
Recovery assist starts only after the pilot centres the stick (`recovery.delaySeconds`)
and uses real aero/TVC authority only. Stall still costs energy and height at high AoA.
No aircraft-name branches or automatic maneuver selection are involved.

### Debug and tune

- Pause > Flight Lab > Show detailed telemetry displays severity, signed stall AoA
  and the current cause. `state.stall` is also part of every runtime snapshot.
- `cause: 'none'` with nonzero severity means recovery is fading out; `speed`,
  `aoa` and `speed+aoa` identify unmet thresholds. AoA is sampled at the start of
  each fixed flight step, not from the interpolated rendering pose.
- The existing `maneuver.alpha` / nose-path reading includes yaw and remains the
  high-AoA metric. Use the separate **Stall AoA** reading when tuning stall.
- Player advisories follow the continuous envelope label (NORMAL / HIGH_AOA /
  POST_STALL / RECOVERING / DEPARTED). Low-altitude and boundary warnings always win.
- Start with the four envelope values. For gentler onset, increase `separationEntrySeconds`;
  for easier handling in stall, increase `controlAuthority`; for less energy loss,
  lower `dragMultiplier` toward 1. Tune breakout and TVC separately.
- The existing recovery practice spawn plus Space enters low-speed stall; release Space
  and hold W to recover. Use the Cobra spawn with Space + pull (W or Shift for thrust)
  to test high-AoA entry; centre the stick to recover.
- Flight Lab also shows **Powered control available** (normalized TVC capacity from
  actual thrust), the aero/TVC/floor allocation, the limiter and actual left/right
  nozzle angles. Authority is available power, not a timer or remaining charge.
- Pause/single-step freezes/advances stall with the simulation. Reset clears it;
  exported replays reproduce it. The physics version is `flightProfileVersion` in
  `src/game/flight/profile.ts` and the command schema is `commandSchemaVersion` in
  `src/game/runtime/commands.ts`; replays with either one different are rejected.
- `hud-preview.html?t=4&lab&stall&lang=th` shows the warning and debug layout without
  WebGL; replace `stall` with `recovering` to inspect recovery text. These are
  explicit visual fixtures, not simulation tests.

## High-AoA entry and recovery (automatic)

There is no PSM mode, arm key or phase. The limiter that gates incidence opens and
closes continuously on every step:

- **Entry.** At low dynamic pressure (`breakout.qLow`–`qHigh`, about 350–700 on the
  HUD), pitch or yaw demand opens the limiter. Space (Airbrake), S and Shift/W raise
  the opening weight and rate (`brakeWeight`, `decelerationWeight`, `powerWeight`,
  `comboWeight`, `brakeBoost`, `powerBoost`). No key is required, and none opens it by itself.
- **High speed.** Full demand with a saturated turn becomes a harder G turn
  (`breakout.hardTurnG`, with `maneuver.highGRate` / `highGDrag` as the rate and drag
  multipliers). Before Phase 6 Space requested this manually; that command is gone.
- **Continuation.** Partial stick, roll and short axis handoffs (`breakout.handoffSeconds`)
  keep the limiter open.
- **Recovery.** With a centred stick, natural aerodynamics act at once; recovery assist
  ramps in after `recovery.delaySeconds` and stops on the same step as any stick input.
- **Limits.** Authority is always the aircraft's real aero + TVC budget. Permission
  never adds authority, and `arcadeControlFloor` only fills gaps near rest.

To limit an aircraft, lower its capability (`aero.controlAcceleration`, `thrustVectoring`
gain or travel, engine thrust), not a per-aircraft entry gate.

## Twin-engine thrust vectoring

The same solver handles both profiles, summing nozzle thrust vectors and `r × F`
moments at the engine mounts. TVC acts continuously at every incidence, including at full
stall; it needs engine thrust and does not replace lift or guarantee altitude hold.
At zero speed, W/Shift can provide thrust and rotate the aircraft while it falls.
The remaining surface controls and rate damping keep recovery approachable.

| Field | Meaning |
| --- | --- |
| `maxAngle` | Maximum signed nozzle deflection in degrees. |
| `rollGain`, `yawGain` | Differential left/right nozzle demand at full stick, degrees. |
| `cantDeg` | Mirrored outward tilt of each deflection plane; 0 = vertical. |
| `actuatorRate` | Maximum actual nozzle travel per second, degrees/s. |
| `actuatorResponse`, `authorityResponse` | Response rates (1/s). |
| `pivotX`, `height`, `spacing` | Engine mount relative to aircraft center in metres; spacing is half separation. |
| `inertia` | Mass-normalized arcade inertia for pitch/yaw/roll, m². |

F-22 uses vertical deflection planes (`cantDeg: 0`, `yawGain: 0`), with the existing
arcade differential roll allocation. Su-57 uses mirrored 30° planes, 18° maximum
travel and a yaw allocation. Pitch moves both nozzles together; yaw and roll share
differential travel and create coupled moments. Simultaneous axis requests cannot
exceed either nozzle's travel. These are **game tuning approximations**, not measured
real aircraft performance or exact flight-control laws.

Actual actuator angles drive both forces and nozzle rendering. Su-57 rendering no
longer invents nozzle angles from body rates or applies a second actuator delay.
The arcade rate controller allocates the requested TVC contribution once, then
integrates actual actuator torque, including lag and release. A future single-engine
or independently gimballed nozzle layout would require extending this geometry.

## Add a flight profile

1. Create an aircraft file, import the defaults and annotate the exported object
   with `AircraftFlightProfile`. Define its normal-flight performance explicitly.
2. Register it in `src/content/flight-profiles/index.ts` with a unique profile ID.
3. Set the aircraft's `flightProfileId` in `src/content/aircraft/index.ts`.
4. Run `npm test` and `npm run build`.

Runtime callers continue to use `getFlightProfile(aircraftId)` from
`src/game/flight/profile.ts`. The registry infers `FlightProfileId`, so unknown IDs
are TypeScript errors. Content validation also checks references and tuning ranges.
Adding a new model still requires its presentation, rig, effects and weapon setup.

The legacy `flightProfile`, `maneuverProfile` and `f22TvcProfile` exports refer to
F-22 for compatibility; do not use them as defaults for new aircraft.

Keep `flightProfileVersion` unchanged for a behavior-preserving file reorganization.
Update it when changing simulation tuning or behavior so old replays are not
silently played with different physics.
