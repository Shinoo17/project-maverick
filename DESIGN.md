# Maverick design system

The aircraft studio extends the reference viewer's instrument-panel visual language. A player inspecting an airframe at a desktop gets a subdued graphite surround and soft studio illumination; the aircraft carries the highlights.

- Palette: canvas #252d33, page #171c20, panel #1c2227, raised control #293239, foreground #edf0ed, secondary #adb8be, line #3b474e. Muted sand #cfb88a identifies a selection. No neon, bloom or decorative glow.
- Condensed DIN Alternate / Arial Narrow for aircraft identity; system sans for controls and Thai copy. Controls at least 13px, secondary copy at least 12px. Use tabular numbers for durations.
- A full-height scene beside a 320px control rail, an aircraft identity plate within the scene, and a bottom aircraft selector. On narrow screens the scene precedes a naturally scrolling control panel.
- Flat surfaces, 1px separators, 3px control corners. Whitespace separates groups; avoid boxes within boxes.
- Controls use native buttons, selects and ranges. Sand selection with an explicit state label and aria-pressed; focus uses a visible 2px ring. Minimum 40px targets.
- Demand rendering when idle. Rotation begins only by user choice. Stage animation travels to an endpoint and holds; turning it off reverses from the current position. Reduced motion removes decorative transitions and camera damping.
- Loading, failed asset with retry, and no-clips states remain inside the viewer workflow. Selection and language stay available during loading/failure. No flight CTA until flight exists.
