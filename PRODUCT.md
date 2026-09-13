# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Product Purpose

Project Maverick is the desktop browser arcade dogfight project described in MASTER_PLAN.md. The implementation includes the React foundation, a hangar for F-22/Su-57 inspection and embedded animations, and a playable flight training range with a live HUD.

## Operating Context

React, strict TypeScript, Vite and React Three Fiber. Thai and English from the foundation. The existing example/F22 stays a reference implementation.

## Capabilities and Constraints

- Studio grid, orbit/zoom/reset, accessible camera controls, independent reversible animation stages.
- F22_compact.glb has ten embedded clips; SU57_compact.glb has none.
- Game runtime remains headless and separate from UI and presentation. Training flight, manual maneuvers, replay export and live flight instruments are implemented. Combat and multiplayer remain later work.
- Primary audience details beyond players of this planned desktop game remain unspecified.

## Brand Commitments

Cool, non-neon UI in the hangar and menus. The flight HUD follows the user-supplied transparent green fighter display reference. Aircraft are the focus. Inherit the example's compact instrument controls and condensed airframe lettering.

## Evidence on Hand

MASTER_PLAN.md, docs/game-design/, example/F22 and the user's model/ assets.
