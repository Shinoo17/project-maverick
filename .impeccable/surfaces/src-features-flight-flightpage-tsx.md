---
version: 1
slug: "src-features-flight-flightpage-tsx"
primary_target: "src/features/flight/FlightPage.tsx"
related_targets: ["src/features/flight/FlightInstruments.tsx","src/features/flight/flight.css"]
---

Mode: Operate, desktop flight training overlay; adapt to narrow browser windows.
Players need to read heading, attitude, altitude, speed and boost while keeping the aircraft/world visible.
User-approved direction: supplied transparent green fighter HUD screenshot (September 13, 2026). Heading above, world-referenced pitch ladder central, speed/boost left, altitude/VSI right, pitch/bank/G below. No opaque instrument panels in normal flight. The hangar is outside scope.
Superseded September 13, 2026: the user rejected the refined SVG layout and asked for the HUD to match example/F22 exactly. The glass is now a canvas port of example/F22's `hud.js` (hudPainter.ts) with Maverick data: ARCADE km/h speed with the PSM band bracket, metres AGL, GND/EDGE status, burner states as A/B·ON/CLD/INH/CHG. No bank scale. Smoothness requirement stands: redrawn per rendered frame from the interpolated pose, no React state in the frame loop. `/hud-preview.html` is the visual fixture.
Live simulation is authoritative. Keep ARCADE speed units explicit, flat-ground altitude, real boost reserve, existing arcade path G. Preserve PSM training, pause/reset and optional Flight Lab.
The memorable action is banking/climbing while the projected ladder stays tied to the world's horizon. Do not replace it with a camera-independent rotated graphic.
