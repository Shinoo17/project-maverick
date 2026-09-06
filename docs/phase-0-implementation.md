# P0 foundation + early studio slice

Implementation checked 6 September 2026. This records the requested React foundation and early F-22 / Su-57 home viewer. It does not mark P1 flight or all of P3 hangar complete.

## Delivered

- Root Vite/React app with strict TypeScript; reference `example/F22` preserved.
- Content registry and field-path validation, stable entity IDs, serializable world state, command/event contracts.
- Headless 60 Hz accumulator: bounded catchup, dropped-time metric, start/pause/resume/reset/dispose. No renderer, DOM, RAF or timers in the runtime. `FLIGHT_STEP` reserves two 120 Hz substeps for P1; flight integration is not yet implemented.
- Reactive selection/settings store, versioned guarded local storage and Thai/English adapter.
- Foundation studio at `#/`: both actual GLBs, orbit/zoom/presets/reset, grid, shadows, local room environment, independent animation toggles, pause/resume/reset/speed, loading/error/retry and no-clips states.
- Local Meshopt decoder and Basis transcoder matching Three.js. Cached shared geometry/materials with separate skeleton/animation instances.

## Validation

- `npm test`: 8 tests passed. Covers serialization/independent IDs, equal ticks at 30/60/144 render FPS, 20 runtime lifecycle cycles, catchup/invalid delta, bad content/settings, full simultaneous clip travel, pause/reverse/restart/reset.
- `npm run build`: passed. The Three.js vendor chunk exceeds Vite's 500 kB warning threshold; it remains a real engine cost, not a failed build.
- Studio desktop browser: both aircraft rendered, F-22 canopy toggle, grid/reset, Su-57 no-clips UI, model switching and English/Thai selection checked.
- Mobile at 390×844: Su-57 frame, aircraft selection and flowing control panel checked; document width equals viewport width (390), no horizontal overflow. Temporary viewport override reset afterward.
- Mechanical UI detector: no findings. Independent finish review found and prompted a fix for WebGL-unavailable loading behavior.
- Browser log inspection showed extension-origin warnings only, no application renderer errors during the final Su-57 check.

These are runtime lifecycle tests, not a measured 20-cycle browser GPU-memory benchmark. Failed-network retry and unsupported-GPU paths were code-reviewed; failure injection across multiple real browsers remains additional release QA.

## Reference baseline (FND-01)

The original example lockfile was retained. React 19.1.1, Three.js 0.180.0, R3F 9.3.0, Drei 10.7.6 and Vite 7.1.7 are pinned from that reference's declared baseline.

Commands run against `example/F22` after `npm ci --prefix example/F22` restored its locked dependencies. Source and lockfile were not changed:

| Check | Result |
| --- | --- |
| `flight-physics-check` | PASS: banked lift, independent flight path, pull/G/energy trade |
| `camera-check` | PASS |
| `high-g-check` | PASS: turn/radius/energy cost, PSM separation and release/handoff scenarios |
| `build` | PASS with its original lockfile; Vite 7.3.6, JS output 1,462.27 kB / 429.62 kB gzip |

The first reference build attempt lacked its own dependencies. Installing from the existing lockfile resolved that environment issue; build and all three checks above were then rerun successfully.

## Asset inspection findings

| Source | Size (approx.) | Clips | Required decoding |
| --- | --- | --- | --- |
| F22_compact.glb | 3.9 MB | 10 | Meshopt + KTX2/Basis |
| SU57_compact.glb | 1.6 MB | 0 | Meshopt + WebP |

F-22 exported static tracks would dilute independent animation travel; apply the closed pose once and strip only static tracks. Su-57's `Nozzles_ORIG_backup` is approximately 140 source units wide, compared with the body's 48-unit length, and is detached. Exclude it before computing bounds. Alternate gear/probe geometry and prototype antenna are excluded from the stowed presentation through registry data, without rewriting the source file.

## Next planned phase

P1 adds a flat practice map, physical scale/axes validation, input-to-command adapters, W/S target speed, pitch/yaw/roll flight integration, aircraft view driven by simulation snapshots and chase-camera modes. Full P3 later adds curated facts/gameplay tabs, loadouts and session launch. Neither flight nor combat is exposed as a working control in this studio slice.

Implementation references: [R3F demand rendering](https://r3f.docs.pmnd.rs/advanced/scaling-performance), [Three.js AnimationAction](https://threejs.org/docs/pages/AnimationAction.html).
