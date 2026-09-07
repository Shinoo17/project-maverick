# Project Maverick

React + TypeScript aircraft studio and playable P2 Playground and manual maneuvers. See [MASTER_PLAN.md](MASTER_PLAN.md) for the full game roadmap and [P2 implementation notes](docs/phase-2-playground.md) for the scope and validation of this slice.

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

Phase 1 adds a 60 Hz world / 120 Hz flight runtime, direct W/S acceleration with a short coast on release, a positional mouse stick that reads as a joystick on the glass, with the pointer angle setting the bank and a swirl around the gate rolling the aircraft, pitch/yaw/roll, Mouse + Keyboard and Keyboard-only presets, two chase camera roll modes, telemetry, pause/reset and terrain/boundary stops. Thai/English uses react-i18next. Both airframes use the experimental F-22 baseline; aircraft-specific balancing, combat, bots and multiplayer follow in later phases. The hangar runs without starting a game session.

## P2 Playground

Choose a lesson in the flight briefing; it selects a suitable spawn. Hold **C + steer** inside the PSM speed band (65–115 m/s / 351–621 ARCADE km/h, ≥150 m altitude). C alone never pitches or brakes. Pull up then push down for Cobra, or pull farther for a 180° reversal; centre the stick, release C and use W to rebuild speed. Recovery preserves your chosen nose direction. Hold **Space + turn** for High-G, **X** to airbrake and **Shift** for afterburner. **R** resets; **P / Esc** pauses.

Flight Lab in Pause includes detailed telemetry, ×0.25/×0.5 time, single-step and replay JSON export (first 60 simulation seconds). `runFlightReplay` is the headless replay entry point. See [P2 scope, measured tuning and validation](docs/phase-2-playground.md).

## Asset presentation

Source GLBs are unchanged. The registry excludes F-22's two detached bay fittings and Su-57's oversized `Nozzles_ORIG_backup`. Su-57 displays the stowed gear/probe variant and omits the prototype antenna. Both models are oriented to +X forward and normalized to a studio display length; this display scale is not the physical flight scale.

The animation rest-pose/static-track preparation is adapted from `example/F22`, under its MIT license. See [third-party notice](THIRD_PARTY_NOTICES.md). Model provenance and distribution rights remain with the supplied assets; the code license is not a model license.
