# Aircraft exhaust

The flight compositor renders two bounded emissive gas volumes attached to the displayed aircraft matrix. It reconstructs a camera ray and the nearest opaque surface from scene depth, clips each ray to its nozzle/plume bounds, then integrates 48 samples with afterburner, or 16 for the short dry exhaust. The GLB walls occlude the recessed gas; no effect is drawn on top of opaque aircraft geometry.

## Placement and layers

The 18.9 m normalized flight frame has +X forward. Anchors are measured after excluded nodes are removed, animation tracks are placed at frame zero, aircraft orientation is applied, and the model is centered. This order matters: F-22's prepared pose moves the vertical center about 0.583 m from the raw export pose. Tests load the actual GLBs and compare both anchors with the prepared nozzle bounds.

| Aircraft | Nozzle lip X | Nozzle center Y | Lateral centers | Source depth | Cross-section |
| --- | --- | --- | --- | --- | --- |
| F-22 | -7.3654 m | -1.0373 m | -0.65835 / +0.64505 m | 0.82 m | 0.89 × 0.41 m superellipse |
| Su-57 | -8.22 m | -0.6691 m | ±1.3903 m | 0.92 m | 1.0 m diameter |

F-22 reads its two actuator angles from the fixed-step thrust-vectoring simulation. Each lip moves independently around its hinge 0.983 m upstream, and the shader uses the corresponding pitch-only axis. Its cross-section broadens vertically inside the nozzle. Su-57 reads a separate origin, axis, up vector and radius from each animated gimbal. Its iris lip is measured from the shipped compact mesh at rest and at both morph extremes, then interpolated using the current morph weights. This includes the slight axial movement of the petal tips. The static Su-57 row above remains the fallback for fixtures without a rig.

F-22 has a soft elliptical hot bed (nominally 0.80 × 0.512 m), recessed at 90% of the inset depth, about 0.74 m behind the lip. A bright yellow-orange center grades through rich orange to deep orange-red at the feathered edge. Its ray/plane intersection is evaluated separately from the gas samples so the interior stays full at dry power. Warm volumetric gas tapers from the bed toward the flat exit, with a darker perimeter that preserves the cavity depth. Scene depth clips both layers against the nozzle walls and moving flaps. Low-amplitude seeded noise and roughly 2% flicker animate the bed and cavity even at dry power; pause and reduced motion freeze this animation. Su-57 retains its blue annular throat and tapered amber sleeve.

External flame emission is zero when the burner is off. During F-22 afterburner, orange/gold remains dominant with a subtle pink-violet veil along the outer gas and between the warm compression cells, inspired by the user's third reference photo. The violet mix is capped at 22%, begins outside the lip, and fades with the burner; the recessed bed retains its warm gradient. Afterburner ignition ramps up inside the duct and reaches full strength 0.06 m before the exit, overlapping the cavity gas for a continuous connection to the outer flame. Su-57 retains its existing palette. Compression cones and axial knots form warm diamonds. Seeded 3D noise advects downstream independently in each engine, disturbing the outer flow more than the protected young core. Low-amplitude flicker modulates the gas without moving the attachment point. Length, radius and emission depend on engine power; the accepted simulation `burnerActive` flag enables afterburner. Ignition and extinction use exponential smoothing (0.12 / 0.18 seconds).

Heat haze is restricted to a thin outer annulus, excluding the core. Its displacement is capped at 0.4 physical pixels and blended at at most 16%; a depth discontinuity guard prevents dragging foreground silhouettes. It samples scene color before adding flame emission, so it cannot smear the hot core or diamonds. There is no bloom or blur pass.

## Runtime and validation

Exhaust reuses condensation's scene/depth target and seeded 3D noise texture, with no added full scene render or particle buffers. Ray-box rejection avoids integration outside the plumes; inactive cloud/trail fields return immediately. All GPU resources retain the existing compositor lifecycle. The shared simulation presentation clock handles pause, slow motion, single-step and reset; reduced motion freezes flow/flicker while retaining throttle response.

- `npm test`: simulation coupling, frame-rate-independent ignition/extinction, pause/reduced motion/reset, real-GLB nozzle anchors, plus the existing flight/vapor suite.
- `npm run build`: TypeScript and production entry points, including both effect previews.
- Browser fixture: both aircraft, rear/side/quarter views, burner on/off, F-22 ±20° pitch and differential roll vectoring, contrasting backgrounds and simultaneous wing condensation. Shader errors are surfaced in the fixture.

This is a procedural visual approximation, not combustion CFD. It emits light into the view without physically lighting nearby surfaces. Full-screen scene/depth bandwidth and close-up ray integration still depend on GPU and resolution; the local desktop browser preview is not a cross-device benchmark.

## Su-57 moving parts and TVC

`src/render/aircraft/su57Rig.ts` supplies the flight presentation rig. It adds reusable hinge groups to both ailerons, flaps, all-moving elevators and canted rudders, preserving their rest transforms. Wing hinges follow measured leading edges; elevator pivots use the source spindle; rudder root pivots approximate the canted span. Canopy, gear, probe and weapon-bay states stay stowed in flight. LEVCON is part of Body and cannot be animated independently with this asset.

TVC allocation is driven by the simulation's body rates, airspeed, AoA and maneuver phase:

- Cruise uses small corrections; symmetric pitch deflection reverses for nose-down.
- Roll mixes opposite pitch deflections. Yaw combines lateral deflection with a left/right differential contribution.
- Lower airspeed increases TVC allocation. High AoA and active post-stall flight reach the largest allocation.
- Recovery retains high allocation and uses signed airflow error for low-rate visual corrections, fading to normal allocation as flight recovers.
- Both commands are scaled together into an 18-degree cone. Actuators smooth toward the target with a 36-degree/second speed limit.

The exported compact asset's gimbal exhaust axis is **local +Y**, unlike the guide helper's +Z assumption. Airframe-space rotations are conjugated into each mount's existing basis. `NozzleMount_L/R` retain their baked outboard/upward cant. The compositor uses those exact smoothed transforms, including the independent differential motion.

The guide's throttle lever and the simulation's `enginePower` have different meanings: enginePower is thrust divided by maximum dry thrust. Idle maps to signed iris area +0.6; maximum dry power maps to -1; the accepted `burnerActive` state opens it to +1. Iris transitions smooth over 0.2 seconds and activate only one morph at a time. Exhaust radius follows the actual current morph, including during transition.

This is presentation animation within the existing arcade flight controller, not a new force/torque flight model. It does not write back to simulation state or change replay behavior. Pause, single-step, slow motion and reset use the same presentation clock as exhaust.

Visual fixture examples: `/exhaust-preview.html?aircraft=su57&scenario=cobra`, with `scenario` also accepting `pitch-up`, `pitch-down`, `roll`, `yaw`, `slow` and `recovery`. Omit it for cruise. `power=0..1` and `burner=off` let the idle/dry/AB iris states be compared. These scenarios directly exercise presentation states; gameplay still gates afterburner during post-stall maneuvers.

`tests/su57Rig.test.ts` checks allocation/signs, the cone limit, V-shaped iris response, recovery, non-mutation, repeat initialization, actual GLB hinge preservation, nozzle-mount preservation, morphed lip attachment/radius, actuator speed, pause and reset.

## F-22 simulation-owned 2D thrust vectoring

`src/game/flight/thrustVectoring.ts` owns F-22 nozzle angles in `AircraftState.thrustVectoring`. The flight simulation advances authority and actuators at 120 Hz. Rendering applies each stored angle directly to the upper/lower flap bones; their existing symmetric exit-area motion is added separately. Exhaust reads the same independent left/right angles. There is no render-side TVC damping or reconstruction from angular rates.

The schedule is continuous: normal-flight authority is 0.08 at 200 m/s and above, grows through medium speed, and reaches 1 at 55 m/s and below. AoA smoothly increases allocation between 8° and 65°. Active post-stall permits full allocation and recovery retains additional allocation. Authority itself damps at 5/s, so maneuver transitions do not jump the nozzle target. These are game tuning values, not a measured F-22 FCS schedule.

Positive stored angle means exhaust up, tail force down and nose-up torque. Pitch demand is input × 20° × authority. Differential roll demand is input × 6° × authority: positive right roll lowers the port exhaust and raises the starboard exhaust. With this sign convention, left = pitch − roll and right = pitch + roll. Each result is clamped independently to ±20°. Yaw input is absent from this mixer. Actuators use exponential damping at 7/s with a 45°/s travel limit, also on release and reversal. Reset initializes both at zero; pause and single-step follow simulation time.

Each engine contributes `F/m = thrust/2 × (cos(angle), −sin(angle), 0)` in the +X-forward body frame. The simulation sums forces and incremental `r × F` moments about its center, converts moments through explicit mass-normalized inertia tuning, and integrates them into velocity and angular rates. Straight-thrust mounting moments remain canceled by the existing arcade trim. Yaw has no direct lateral nozzle deflection; a small axial-thrust moment may arise when mixed pitch/roll produces unequal cosines. Zero engine thrust produces zero TVC force and torque.

The existing flight controller allocates the requested pitch/roll moment between aerodynamic controls and TVC: the target TVC contribution reduces surface demand, while only the actual lagged actuator angles generate engine torque. This avoids counting the requested turn twice. Neutral rate damping stays active during post-stall recovery while the nozzles return. This extends the existing arcade force/rate model; it is not a full aerodynamic or combustion simulation.

The physics profile version is now `p2-tvc-4`; older recorded profiles are rejected rather than silently replayed with changed dynamics. Tests cover continuous authority, signs, mixed-command saturation, release/reversal speed, zero thrust, actual torque integration, independent exhaust angles, the shipped GLB's pitch-only bone transforms, pause/reset/single-step, and deterministic replay at 30/60/144 FPS.

F-22 fixture examples:

- `/exhaust-preview.html?aircraft=f22&pitch=20&speed=240`: high-speed pitch demand, about 1.6° deflection.
- `/exhaust-preview.html?aircraft=f22&pitch=20&speed=130`: medium-speed allocation.
- `/exhaust-preview.html?aircraft=f22&scenario=cobra`: full post-stall pitch authority, approaching 20°.
- `/exhaust-preview.html?aircraft=f22&scenario=roll&speed=45`: opposite ±6° deflections.
- `/exhaust-preview.html?aircraft=f22&pitch=20&roll=1&speed=45`: mixed command, 14° port / 20° starboard.

The fixture holds its selected speed/AoA and advances the shared actuator simulation. Its status displays the actual left/right angles; moving the pitch slider back to zero demonstrates return damping. Gameplay additionally uses those same angles for forces and torque.
