# Aircraft flight profiles

Tune each aircraft in `src/content/flight-profiles/f22.ts` or `su57.ts`.
These are arcade game settings, not real aircraft specifications.

- `flight`: normal-flight speed, energy and handling.
- `maneuver`: PSM capability, entry conditions, maneuver limits, high-G and afterburner.
- `thrustVectoring`: physical twin-engine pitch-vectoring settings, or `null`.

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

`defaults.ts` contains shared control responses and maneuver defaults. Each aircraft
spreads these into its own objects and explicitly defines its flight performance.
No aircraft inherits from another aircraft. Editing F-22 tuning does not change Su-57.
Editing a shared default affects every aircraft that does not override that field.

Defaults disable PSM. A new aircraft must explicitly set `psmEnabled: true` to
enable it. Leave the flag false for aircraft that cannot perform PSM; high-G and
afterburner still work. There is no need to zero the unused PSM fields.

## Aircraft with limited PSM

Use the existing fields to define the limitation rather than adding an aircraft-name
check or a separate difficulty system. For example, this maneuver block gives an
aircraft a narrow entry window, reduced rotation rates and a short active period:

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
  maxRotation: Math.PI,  // radians; accumulated pitch/yaw rotation budget
  activeSeconds: 1.0,
  cooldown: 8,           // seconds after recovery
},
```

These numbers are an example, not a balanced preset. Tune and flight-test each
aircraft. Entry speed limits apply when arming/entering PSM; they are not exit
thresholds once the maneuver is active. `activeGrip`, `recoveryGrip` and
`recoveryAcceleration` control airflow alignment during PSM and recovery.

PSM and physical thrust vectoring are independent: `thrustVectoring: null` does
not disable PSM. The current TVC solver models two pitch-vectoring engines; a
single-engine or multi-axis solver needs a separate implementation.

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
