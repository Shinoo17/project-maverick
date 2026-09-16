# Aircraft flight profiles

Tune each aircraft in `src/content/flight-profiles/f22.ts` or `su57.ts`.
These are arcade game settings, not real aircraft specifications.

- `flight`: normal-flight speed, energy and handling.
- `stall`: low-speed/high-incidence envelope and gradual loss/recovery of control.
- `maneuver`: PSM capability, entry/exit conditions, powered control rates, high-G and afterburner.
- `thrustVectoring`: twin-engine TVC geometry/actuators (vertical or canted planes), or `null`.

`src/game/flight/profileTypes.ts` documents the fields and units. Top speeds use
displayed ARCADE km/h. The minimum powered speed and PSM entry speeds still use
simulation m/s; angular rates use rad/s, and durations use seconds.

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
- X adds braking without cutting engine thrust. W + X and Shift + X work together,
  including during PSM. More thrust can outweigh the brake; X does not promise deceleration.
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

Defaults disable PSM. A new aircraft must explicitly set `psmEnabled: true` to
enable it. Leave the flag false for aircraft that cannot perform PSM; high-G and
afterburner still work. There is no need to zero the unused PSM fields.

## Tune stall

Each aircraft explicitly defines its envelope. Both current aircraft start with
the same forgiving arcade baseline; these are not measured aircraft specifications:

```ts
stall: {
  ...stallDefaults,
  stallSpeedKph: 300,
  recoverySpeedKph: 350,
  criticalAoaDeg: 30,
  recoveryAoaDeg: 20,
},
```

| Field | Meaning |
| --- | --- |
| `stallSpeedKph` | Below this displayed ARCADE speed, stall starts. |
| `recoverySpeedKph` | Speed needed for recovery; must exceed stall speed and be <= normal top speed. |
| `criticalAoaDeg` | Stall starts above this absolute body-plane incidence (degrees). |
| `recoveryAoaDeg` | Incidence must fall to this or below for recovery; lower than the critical angle. |
| `controlAuthority` | Remaining normal surface/path control at full stall, 0–1; default 0.25. |
| `dragMultiplier` | Base drag multiplier at full stall, >= 1; default 1.8. |
| `entrySeconds` | Severity ramps from 0 to 1 in this time; default 0.4 s. |
| `recoverySeconds` | Severity ramps from 1 to 0 in this time; default 1.2 s. |

Speed uses the same conversion as `topSpeedKph`: 300 on the HUD is about 55.56
simulation m/s. `minPoweredMps: 65` still limits S to 351 on the HUD, so holding S
alone does not stall these aircraft. Airbrake, climbing or maneuver losses can.
Session overrides still only change top speeds, which must leave enough normal
speed for stall recovery. They do not scale stall or PSM thresholds automatically.

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

PSM capability is independent of stall. Active PSM blends toward its authored pitch,
yaw and roll rates in proportion to actual engine thrust, allowing Cobra, pedal
turns and mixed-axis maneuvers. No thrust means no powered rate assistance;
remaining surface control and damping still work.
Recovery assist follows the pilot's chosen nose and blends back into normal
control, including roll. Stall still costs energy and height during PSM. Physical
TVC continues to apply actual actuator torque and still needs engine thrust.
No aircraft-name branches or automatic maneuver selection are involved.

### Debug and tune

- Pause > Flight Lab > Show detailed telemetry displays severity, signed stall AoA
  and the current cause. `state.stall` is also part of every runtime snapshot.
- `cause: 'none'` with nonzero severity means recovery is fading out; `speed`,
  `aoa` and `speed+aoa` identify unmet thresholds. AoA is sampled at the start of
  each fixed flight step, not from the interpolated rendering pose.
- The existing `maneuver.alpha` / nose-path reading includes yaw and remains the
  PSM metric. Use the separate **Stall AoA** reading when tuning stall.
- Player advisories explain recovery after leaving active PSM. Active PSM hides
  stall/low-energy advice, but never hides low-altitude or boundary warnings.
- Start with the four envelope values. For gentler onset, increase `entrySeconds`;
  for easier handling in stall, increase `controlAuthority`; for less energy loss,
  lower `dragMultiplier` toward 1. Tune PSM rates/grip separately.
- The existing recovery practice spawn plus X enters low-speed stall; release X
  and hold W to recover. Use the Cobra spawn with C + W and pitch/yaw/roll to test PSM.
- Flight Lab also shows **PSM thrust authority** (`maneuver.controlAuthority`,
  actual thrust / `fullControlThrust`, capped at 100%) and actual left/right nozzle
  angles. Authority is available power, not a timer or remaining charge.
  `maneuver.blend` is the continuous entry/release blend in snapshots.
- Pause/single-step freezes/advances stall with the simulation. Reset clears it;
  exported replays reproduce it. The physics version is `p3-powered-psm-1`;
  replays from previous physics versions are rejected.
- `hud-preview.html?t=4&lab&stall&lang=th` shows the warning and debug layout without
  WebGL; replace `stall` with `recovering` to inspect recovery text. These are
  explicit visual fixtures, not simulation tests.

## Aircraft with limited PSM

Use the existing fields to define the limitation rather than adding an aircraft-name
check or a separate difficulty system. For example, this maneuver block gives an
aircraft a narrow entry window and reduced powered rotation rates:

```ts
maneuver: {
  ...maneuverDefaults,
  psmEnabled: true,
  entryMin: 95,          // m/s; minimum entry speed, inclusive
  entryMax: 105,         // m/s; maximum entry speed, inclusive
  minAltitude: 400,      // metres
  pitchRate: 1.0,        // rad/s
  yawRate: 0.8,          // rad/s
  rollRate: 1.2,         // rad/s
  exitSpeed: 120,        // m/s; must exceed entryMax (hysteresis)
  blendSeconds: 0.6,     // seconds to enter/release, not an active duration
  fullControlThrust: 30, // m/s² of actual thrust for full rate assistance
},
```

These numbers are an example, not a balanced preset. Tune and flight-test each
aircraft. Entry speed limits apply when arming/entering PSM; they are not exit
thresholds once the maneuver is active. `activeGrip`, `recoveryGrip` and
`recoveryAcceleration` control airflow alignment during PSM and recovery.

PSM and physical thrust vectoring are independent: `thrustVectoring: null` does
not disable the explicitly enabled arcade PSM assist. Conversely, `psmEnabled: false`
does not disable TVC or stall handling.

## Hold C, manage thrust, release to recover

- `normal → armed`: hold C inside the per-aircraft entry speed/altitude envelope.
- `armed → active`: steer any axis (pitch/yaw/roll magnitude > 0.35).
  C alone never supplies thrust, applies brakes or chooses a maneuver.
- Hold C to continue. There is no active time limit, rotation cap or cooldown.
  Low speed/altitude do not cut active control off; energy loss and terrain still apply.
- Release C, or exceed `exitSpeed`, to enter recovery. `blendSeconds` smoothly
  returns control/path grip to normal. The aircraft does not snap its nose back.
- Press C again during recovery inside the entry envelope to continue the same
  maneuver. Blend and peak/rotation history are preserved; speed, thrust and stall
  are never reset. Overspeed cannot chatter between states because `exitSpeed`
  exceeds `entryMax`.
- Recovery finishes when nose/path separation is < 0.3 radians and speed > 60 m/s
  for 0.3 seconds, with the control blend returned to zero. Only a recovered maneuver
  that reached 70° nose/path separation increments the completion count.
- Use W for powered control; Shift adds thrust while its existing resource lasts.
  X adds drag independently. These are arcade speed controls, not a persistent
  throttle lever: releasing W returns to speed-hold thrust, which is weak at low speed.
- PSM authority uses **this step's thrust**, not yesterday's engine readout or a
  minimum magical control floor. Normal surface authority remains speed/stall-dependent.
  Direction-changing forces cannot add speed for free when switching modes.

## Twin-engine thrust vectoring

The same solver handles both profiles, summing nozzle thrust vectors and `r × F`
moments at the engine mounts. TVC acts continuously outside PSM, including at full
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
