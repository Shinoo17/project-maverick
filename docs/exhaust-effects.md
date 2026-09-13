# Aircraft exhaust

The flight compositor renders two bounded emissive gas volumes attached to the displayed aircraft matrix. It reconstructs a camera ray and the nearest opaque surface from scene depth, clips each ray to its nozzle/plume bounds, then integrates 48 samples with afterburner, or 16 for the short dry exhaust. The GLB walls occlude the recessed gas; no effect is drawn on top of opaque aircraft geometry.

## Placement and layers

The 18.9 m normalized flight frame has +X forward. Anchors are measured after excluded nodes are removed, animation tracks are placed at frame zero, aircraft orientation is applied, and the model is centered. This order matters: F-22's prepared pose moves the vertical center about 0.583 m from the raw export pose. Tests load the actual GLBs and compare both anchors with the prepared nozzle bounds.

| Aircraft | Nozzle lip X | Nozzle center Y | Lateral centers | Source depth | Cross-section |
| --- | --- | --- | --- | --- | --- |
| F-22 | -7.3654 m | -1.0373 m | -0.65835 / +0.64505 m | 0.82 m | 0.89 × 0.41 m superellipse |
| Su-57 | -8.22 m | -0.6691 m | ±1.3903 m | 0.92 m | 1.0 m diameter |

F-22 shares its vector-angle calculation with the flap rig and moves its lip around the hinge 0.983 m upstream. The shader uses the same rotated axis. Its cross-section broadens vertically inside the nozzle. Su-57 retains the source model's fixed round nozzles.

F-22 has a soft elliptical hot bed (nominally 0.80 × 0.512 m), recessed at 90% of the inset depth, about 0.74 m behind the lip. A bright yellow-orange center grades through rich orange to deep orange-red at the feathered edge. Its ray/plane intersection is evaluated separately from the gas samples so the interior stays full at dry power. Warm volumetric gas tapers from the bed toward the flat exit, with a darker perimeter that preserves the cavity depth. Scene depth clips both layers against the nozzle walls and moving flaps. Low-amplitude seeded noise and roughly 2% flicker animate the bed and cavity even at dry power; pause and reduced motion freeze this animation. Su-57 retains its blue annular throat and tapered amber sleeve.

External flame emission is zero when the burner is off. During F-22 afterburner, orange/gold remains dominant with a subtle pink-violet veil along the outer gas and between the warm compression cells, inspired by the user's third reference photo. The violet mix is capped at 22%, begins outside the lip, and fades with the burner; the recessed bed retains its warm gradient. Afterburner ignition ramps up inside the duct and reaches full strength 0.06 m before the exit, overlapping the cavity gas for a continuous connection to the outer flame. Su-57 retains its existing palette. Compression cones and axial knots form warm diamonds. Seeded 3D noise advects downstream independently in each engine, disturbing the outer flow more than the protected young core. Low-amplitude flicker modulates the gas without moving the attachment point. Length, radius and emission depend on engine power; the accepted simulation `burnerActive` flag enables afterburner. Ignition and extinction use exponential smoothing (0.12 / 0.18 seconds).

Heat haze is restricted to a thin outer annulus, excluding the core. Its displacement is capped at 0.4 physical pixels and blended at at most 16%; a depth discontinuity guard prevents dragging foreground silhouettes. It samples scene color before adding flame emission, so it cannot smear the hot core or diamonds. There is no bloom or blur pass.

## Runtime and validation

Exhaust reuses condensation's scene/depth target and seeded 3D noise texture, with no added full scene render or particle buffers. Ray-box rejection avoids integration outside the plumes; inactive cloud/trail fields return immediately. All GPU resources retain the existing compositor lifecycle. The shared simulation presentation clock handles pause, slow motion, single-step and reset; reduced motion freezes flow/flicker while retaining throttle response.

- `npm test`: simulation coupling, frame-rate-independent ignition/extinction, pause/reduced motion/reset, real-GLB nozzle anchors, plus the existing flight/vapor suite.
- `npm run build`: TypeScript and production entry points, including both effect previews.
- Browser fixture: both aircraft, rear/side/quarter views, burner on/off, F-22 ±14° vectoring, contrasting backgrounds and simultaneous wing condensation. Shader errors are surfaced in the fixture.

This is a procedural visual approximation, not combustion CFD. It emits light into the view without physically lighting nearby surfaces. Full-screen scene/depth bandwidth and close-up ray integration still depend on GPU and resolution; the local desktop browser preview is not a cross-device benchmark.
