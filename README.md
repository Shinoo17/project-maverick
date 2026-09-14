# Project Maverick

React + TypeScript aircraft studio with P3 aircraft profiles and full armament and a playable P2 Playground. See [MASTER_PLAN.md](MASTER_PLAN.md) for the full game roadmap and [P2 implementation notes](docs/phase-2-playground.md) for the scope and validation of this slice.

## Run

Requires Node.js 22.12+.

```sh
npm install
npm run dev
```

Open http://127.0.0.1:5173/#/ for the hangar. Select Practice / Flat training range below the inspection panel and press Play, or open `#/flight` directly.

`npm install` copies the two source aircraft from `model/` into the generated public asset directory and installs the matching Three.js Basis texture decoders locally. After replacing a source GLB, run `npm run assets:prepare`. Generated copies and decoder binaries are ignored by Git; keep the source GLBs with the project.

```sh
npm test
npm run build
npm run preview
```

## Foundation studio

- Select F-22 or Su-57 and inspect the actual GLB with orbit, zoom, camera presets and reset.
- F-22 exposes ten independent animation stages. Toggle forward/reverse from the current pose; pause/resume, reset and adjust speed.
- Su-57 has no embedded clips and shows an explicit empty state.
- Studio lighting, shadows, grid and optional camera rotation. Rendering sleeps when idle.
- Thai/English and the selected aircraft persist in versioned settings; corrupt/unavailable storage falls back safely.
- Mouse, touch and labeled keyboard-accessible camera buttons. Focus the scene for arrows, +/− and R.
- Asset loading/retry and explicit WebGL2-unavailable states.

## Code boundaries

| Directory | Owns |
| --- | --- |
| `src/app` | App shell, routes and selection/settings store |
| `src/content` | Typed aircraft registry, schema and validation |
| `src/game` | Serializable state, command/event contracts and headless fixed clock/runtime |
| `src/render` | Asset loading, per-instance model poses, animation mixer and studio cameras |
| `src/features/hangar` | Studio interaction and UI state |
| `src/platform` | Settings storage and WebGL capability detection |
| `src/locales` | Thai/English copy |
| `tests` | Runtime/content/storage and animation behavior checks |

Phase 1 adds a 60 Hz world / 120 Hz flight runtime, direct W/S acceleration with a short coast on release, a positional mouse stick that reads as a joystick on the glass, with the pointer angle setting the bank and a swirl around the gate rolling the aircraft, pitch/yaw/roll, Mouse + Keyboard and Keyboard-only presets, two chase camera roll modes, telemetry, pause/reset and terrain/boundary stops. Thai/English uses react-i18next. F-22 and Su-57 now resolve separate experimental flight/maneuver profiles; combat, bots and multiplayer follow in later phases. The hangar runs without starting a game session.

## P3 profiles and aircraft weapons

The **Flight** tab controls the airframe and exhaust. **Weapons** inspects every supported weapon, including the gun: All shows every available model, and selecting a weapon isolates it or displays No model. Every aircraft automatically carries the full capacity of every weapon station; there is no loadout selector or saved preset. Runtime spawn, reset and replay use the same station definitions. F-22 carries 1 M61A2, 2 AIM-9 and 6 AIM-120; Su-57 carries 1 cannon, 2 IR training missiles and 4 radar training missiles. Firing remains a later phase; Su-57 missile identities are explicit game placeholders.

See [P3 implementation and remaining gates](docs/phase-3-aircraft-loadouts.md) for the branch audit, extension recipe, provenance and limitations. P3 is in progress: facts content, weapon geometry and asset LODs remain outstanding.

## P2 Playground

Choose a lesson in the flight briefing; it selects a suitable spawn. Hold **C + steer** inside the PSM speed band (65–115 m/s / 351–621 ARCADE km/h, ≥150 m altitude). C alone never pitches or brakes. Pull up then push down for Cobra, or pull farther for a 180° reversal; centre the stick, release C and use W to rebuild speed. Recovery preserves your chosen nose direction. Hold **Space + turn** for High-G, **X** to airbrake and **Shift** for afterburner. **R** resets; **P / Esc** pauses.

The flight HUD follows a transparent green fighter display: heading tape, scrolling speed/altitude tapes, world-projected pitch ladder, afterburner reserve (seconds and percent), vertical speed, engine/airbrake/High-G state, pitch, bank, path-load G and distance to the nearest training boundary. Speed retains the `ARCADE km/h` scale; altitude is metres AGL on the flat range, vertical speed is m/s. North is +X and east is +Z; positive pitch is nose-up and positive bank is right-wing-down. Heading/bank display `—` at the exact vertical singularity. The winged circle marks velocity direction and `+` marks the nose, independently of the pitch ladder. The glass is a canvas port of the reference implementation's HUD painter (`src/features/flight/hudPainter.ts`), redrawn from the interpolated pose every rendered frame with no React re-render; the speed tape brackets the PSM entry band and the status block carries ground clearance and boundary distance. Open `/hud-preview.html` to inspect the real instruments over a synthetic flight without WebGL or pointer lock (`?t=12` freezes time; also `?size=1280x672`, `?lang=en`, `?lesson=2`, `?lab`, `?warning`).

Flight Lab in Pause includes detailed telemetry, ×0.25/×0.5 time, single-step and replay JSON export (first 60 simulation seconds). `runFlightReplay` is the headless replay entry point. See [P2 scope, measured tuning and validation](docs/phase-2-playground.md).

## Wing condensation

Flight renders both the original broad condensation cloud above the wings / shoulders and two narrow, straight volumetric wingtip trails. The pressure cloud retains its swept-wing shape, skin-attached layer, billowing 3D noise, short inboard shear rolls and light attenuation. The straight trails attach to measured outboard trailing-edge vertices of the F-22 and Su-57 GLBs; their common direction follows downstream air-relative velocity, including signed AoA and sideslip. AoA, airspeed, measured G and humidity drive both effects; unloading or dry air fades both out. The fields are combined through optical depth in one composite pass, so they coexist without additive glow. Cloud billows do not displace the straight trail centerlines.

Signed AoA reversals crossfade cloud density between fixed upper/lower wing surfaces, with a smooth ±3° neutral band and a frame-rate-independent response (about 0.9 s to complete 95% of a reversal at the default Fade setting). The old cloud dissipates as the opposite side forms, instead of flipping at an angle threshold. This transition freezes on simulation pause, follows slow motion / single-step, and resets with the aircraft.

This is a local aerodynamic visual approximation, not CFD or a persistent world-space wake: the straight trails follow the displayed aircraft pose. The flight sandbox still uses an illustrative altitude-based humidity profile until a weather system exists; preview humidity is adjustable. Engine exhaust uses a separate density/emission field in the shared compositor (see below).

Open `/vapor-preview.html` on the dev or preview server to inspect the same renderer on either aircraft. It opens in a side reference view; the **Cloud + wingtip vortex** preset shows both effects in a three-quarter view at 21° AoA / 6.8 G. Cruise, High-G and High AoA presets, orbit views, pause, humidity, and density/noise/turbulence/fade/airflow sliders are also available. Preview speed is real km/h; the flight HUD keeps its existing arcade scale. Activation defaults live in `src/render/vapor/conditions.ts`; measured attachment points and length/width tuning live in `src/render/vapor/profile.ts`; the restored pressure cloud lives in `src/render/vapor/cloudShader.ts`.

The volume follows the interpolated aircraft pose, freezes with pause, follows slow motion and single-step, and clears on reset. Reduced motion freezes internal flow for both effects. The renderer uses 72 samples inside the wing-cloud bounds and 24 per intersected straight core, clips both fields against scene depth, filters subpixel trail widths, skips inactive condensation fields at cruise and the entire extra pass when exhaust is also off, and disposes its textures and render target on unmount.

## Engine exhaust

F-22 and Su-57 have depth-clipped procedural exhaust in flight. F-22 has a soft elliptical glow recessed about 0.74 m inside each nozzle, with a yellow-orange hot center, orange-red edges and subtle animated heat. Warm cavity gas connects continuously to predominantly orange/gold afterburner flames with subtle pink-violet accents and warm standing shock diamonds. Its external plume uses a wide, flat cross-section and follows the existing 2D nozzle rig. Su-57 retains a recessed blue annular throat, amber inner sleeve and round orange/gold jets with stronger downstream turbulence. Engine power scales emission, plume width and length. The accepted afterburner state controls smooth ignition/extinction; dry power leaves the chamber visible with no external flame.

Heat refraction only samples the opaque background in the outer exhaust shear layer, before flame emission is added: maximum displacement is 0.4 physical pixels with a 16% blend, with no blur filter. The flame and diamonds are never distorted. Exhaust shares the existing scene color, depth and noise textures with condensation; each intersected nozzle uses 48 integration steps with afterburner, or 16 for dry exhaust. Pause, slow motion, single-step, reset and reduced motion follow the flight presentation clock.

Open `/exhaust-preview.html` for both real models, throttle/afterburner, nozzle/side/front views, F-22 vectoring, flow pause, light/dark backgrounds and simultaneous condensation. Placement and response live in `src/render/exhaust/profile.ts`; layered GLSL lives in `src/render/exhaust/shaders.ts`. See [implementation and validation](docs/exhaust-effects.md).

## Asset presentation

Source GLBs are unchanged. The registry excludes F-22's two detached bay fittings and Su-57's oversized `Nozzles_ORIG_backup`. Su-57 displays the stowed gear/probe variant and omits the prototype antenna. Both models are oriented to +X forward and normalized to a studio display length; this display scale is not the physical flight scale.

The animation rest-pose/static-track preparation is adapted from `example/F22`, under its MIT license. See [third-party notice](THIRD_PARTY_NOTICES.md). Model provenance and distribution rights remain with the supplied assets; the code license is not a model license.
