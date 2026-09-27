# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Product Purpose

Project Maverick is the desktop browser arcade dogfight project described in MASTER_PLAN.md. The implementation includes the React foundation, a hangar for F-22/Su-57 inspection and embedded animations, and a playable flight training range with a live HUD. The planned game shell (example/Design.html) adds a Home screen, mode selection, an overlay hangar with an armament page, a Campaign map of missions unlocked in order, and PVE team matches against bots in Team Deathmatch, Control Point, Capture the Flag, Priority Target (hold the crown) and Flyover (capture points by flying through them).

## Operating Context

React, strict TypeScript, Vite and React Three Fiber. Thai and English from the foundation. The existing example/F22 stays a reference implementation.

## Capabilities and Constraints

- One shared 3D menu scene with per-screen camera presets; orbit/zoom/reset, accessible camera controls, independent reversible animation stages.
- F22_compact.glb has ten embedded clips; SU57_compact.glb has none.
- Game runtime remains headless and separate from UI and presentation. Training flight, manual maneuvers, replay export and live flight instruments are implemented. Combat, bots, PVE modes, Campaign missions and multiplayer remain later work; menu options for them must state their real status.
- Primary audience details beyond players of this planned desktop game remain unspecified.

## Brand Commitments

Menus are cool, non-neon overlays with cyan selection and condensed Barlow lettering floating over a full-screen aircraft, with no panels. The flight HUD follows the user-supplied transparent green fighter display reference. Aircraft are the focus.

## Evidence on Hand

MASTER_PLAN.md, docs/game-design/, example/Design.html (menu screens), example/F22 and the user's model/ assets.
