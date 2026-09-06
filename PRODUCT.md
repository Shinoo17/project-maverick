# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Product Purpose

Project Maverick is the desktop browser arcade dogfight project described in MASTER_PLAN.md. This first implementation delivers the React foundation and an early hangar: select F-22 or Su-57, inspect the actual GLB, and toggle embedded animations.

## Operating Context

React, strict TypeScript, Vite and React Three Fiber. Thai and English from the foundation. The existing example/F22 stays a reference implementation.

## Capabilities and Constraints

- Studio grid, orbit/zoom/reset, accessible camera controls, independent reversible animation stages.
- F22_compact.glb has ten embedded clips; SU57_compact.glb has none.
- Game runtime remains headless and separate from UI and presentation. Flight, combat and multiplayer are later work, not active features of this slice.
- Primary audience details beyond players of this planned desktop game remain unspecified.

## Brand Commitments

Cool, non-neon UI. Aircraft are the focus. Inherit the example's compact instrument controls and condensed airframe lettering.

## Evidence on Hand

MASTER_PLAN.md, docs/game-design/, example/F22 and the user's model/ assets.
