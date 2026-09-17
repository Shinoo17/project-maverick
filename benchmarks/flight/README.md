# Phase 0 flight instrumentation

Implements only Phase 0 of [the final implementation plan](../../docs/psm-implementation-plan.md).
The runtime flight step, input, camera, profiles, replay schema and `flightProfileVersion`
remain unchanged (`p3-powered-psm-1`). No Phase 1–3 airflow, engine, allocation or physics is installed.

```sh
npm test                         # Hard invariants and the existing handling tests
npm run typecheck
npm run flight:bench             # Informational report; does not overwrite goldens
FLIGHT_GOLDEN=update npm run flight:bench  # Deliberate baseline capture/replacement
```

Reports are written to `out/report.json` and `out/report.md` (ignored by git).
Targets in `targets.ts` produce `ok`, `⚠ out` or `report`; feel never fails the build.
Unreached thresholds are JSON `null`, rendered as `—`, not zero or the track timeout.
Future-phase targets (including B9) remain report-only. Phase 0 reports legacy recovery,
not the continuous NORMAL label or recovery assist that do not exist yet.

## Observer and HUD

Enable **Pause → Flight lab → Show detailed telemetry** for the new readouts.
The nose is a cross; the winged circle marks velocity. A chevron at the inset edge
points toward an off-screen/behind-camera flight path; below 1 m/s the marker hides.
Directly aft flow has no unique edge direction and deterministically uses the bottom edge.
The marker reads the existing interpolated pose/velocity and scene camera.

`flightInstrumentation` samples the current (normally end-of-step) state. Its alpha
uses `angleOfAttack`; beta is `atan2(body.z, hypot(body.x, body.y))`, signed toward body
+Z. Incidence is the unsigned nose/velocity angle. Zero-speed angles report zero.
`stall.aoaDeg` remains the runtime's **start-of-step** reading, intentionally separate.
q is a dimensionless `(v / 90)²` proxy. Thrust is acceleration (F/m), in m/s², recovered
from the last engine output; it is not a new engine model.

Legacy aero/floor/PSM are full-stick **rate ceilings before turn budget and High-G**,
in rad/s internally and °/s in the HUD. They are not Phase 3 authority shares and must
not be compared across phases as though their semantics were unchanged. Capacity
uses full-travel geometry, not current nozzle travel or mixer gains. Differential yaw
and roll are coupled, so the displayed axis maxima are not simultaneously additive.

## Harness and goldens

Nine scenarios run on F-22 and Su-57. Fresh `GameRuntime` snapshots supply the complete
spawn state; each scenario sets its entry pose/speed, altitude and matching trim output.
Controllers read state at each 1/120 s flight substep. C, W, Shift, X and Space retain
their existing meanings; `hardTurn900` uses pitch alone as specified.

`runScenario` records every substep, actual commands and cumulative nose rotation.
Commands are run-length encoded with `startStep`, `steps` and a complete first command.
Harness `command.tick` means flight substep, not the public replay's 60 Hz world tick;
replay expands it for each substep. Each golden file contains:

- Complete `initialState` and informational `recordedWithProfileVersion`.
- `flightStep`, `totalSteps`, the actual open-loop commands, and samples every 0.25 s
  (also entry and the final/death sample).
- Complete aircraft state at each sample, plus time/step and cumulative nose rotation.

`replayGolden` merges recorded initial fields onto a fresh spawn so newly added fields
survive. Arrays are replaced. It ignores profile versions by design; it does not use
the public replay reader. The **CI test** requires the recorded/current versions to
match and fails explicitly after a version bump. A physics-changing PR must deliberately
regenerate or retire the baseline, never skip silently. The public replay version rejection
is unchanged and separately tested.

Numeric state leaves present in a golden are checked with
`1e-9 * max(1, abs(recorded))`; added fields are ignored. No global tolerance relaxation
is allowed for long rotation tracks. I2 also compares **every** substep state exactly at
30/60/144 rendered FPS, delivering the recorded commands through the fixed clock.
The actual `GameRuntime` snapshot/public replay path has its own exact FPS checks.

## Metric windows

- Angles/threshold times use every 120 Hz sample, not the decimated golden samples.
  Time-to-threshold is the first qualifying sample; resolution is 1/120 s.
- Cobra peak, time-to-90, maximum speed loss and 3D velocity heading change use entry
  through C release (including the last C-driven sample). Heading change is entry to
  release; speed loss is entry minus the minimum within that window. Pull times out at
  2.5 s; push times out at 5 s from entry; recovery continues through 10 s.
- Kulbit rotation is the sum of angles between successive forward vectors, not Euler
  wrapping or the legacy maneuver rotation counter. Time360 is the first 360° crossing.
- Hard turn mean G averages the post-step legacy path-G samples over 3 s. Speed loss
  is entry minus final speed. Peak incidence includes entry.
- Reversal heading change is entry to the final 10 s sample; altitude loss is entry
  minus the minimum altitude over the whole track. Heading uses a 3D velocity angle
  and is unavailable below 1 m/s.
- Legacy back-to-normal is measured after C release. Pedal yaw rate is sampled at 2 s.
  Release45 reports incidence at 0.2/0.5/1.5 s and maximum body-rate vector magnitude.
  Tail slide reports the first nose-below-horizon sample; sideslip reports 1 s speed loss.
- Tracks stop on `alive = false`; reports include actual duration/alive status.
  Speed loss uses the existing arcade km/h conversion (5.4 × simulation m/s).

## Spec discrepancies resolved against the unchanged runtime

1. §0.7 says legacy floor is positive at **45 m/s**, but §0.1 and `stepFlight` give
   `max(0, 0.12 - v/90)`. It is positive only below **10.8 m/s**, and zero at 45 and
   150 m/s. Tests cover 0, 5, 10.8, 45, 90, 150 and 300 m/s without changing physics.
2. The approximate §3 capacity table cannot meet a ±1% comparison with the required
   maximum over both signs of full travel. `thrustForces` includes the engine-height
   moment from reduced axial thrust, making positive/negative pitch asymmetric.
   At 65 m/s², F-22's true maximum is **3.64888** rad/s² (table 3.45), and Su-57's is
   **3.18433** (table 3.08). Tests validate both travel signs and an independent analytic
   r × F expression; the report prints all 3.5/27.5/65 thrust rows. No geometry or gains
   were changed to fit the approximate table. F-22 differential yaw remains exactly zero.

The original 189 tests passed before implementation. New tests cover pure observation,
marker bounds, I1/I2/I3/I9/I11, golden reproduction and instrumentation neutrality.
The seeded I1/I11 fuzz uses four seeds per aircraft, including zero, near-zero, reverse
and random entry speed, with new commands every 0.25 s for 6 s. Any future discovery of
an existing physics bug must be reported separately, not fixed under Phase 0.
