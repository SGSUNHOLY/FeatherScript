---
name: roblox-vfx-mastery
description: Author and debug Roblox combat and environment VFX, impact frames and animation-synchronized effects with bounded runtime cost.
---

# roblox-vfx-mastery

## Workflow

Inspect existing effects and define the primary silhouette, contact time and intended scale. Block one readable gesture before layering particles, rings, trails or camera accents. Keep damage server validated and presentation client owned. Use named animation markers where appropriate. Read references/impact-animation.md for impact frames and cleanup; scripts/impact_frame.luau is an optional cancellable accent, not a mandatory screen flash. Offer reduced-flash playback. Verify normal speed, interruption, overlap, bright/dark backgrounds and lower quality. Add layers only when they improve the intended read.

## Implementation

Read [the detailed workflow](references/implementation.md) for the specific command, spec format or authoring examples you need. Request supporting files individually with `feather_getskills` (`skill` and `file`); do not load the entire library. Existing scripts and references remain the implementation source of truth.

## Visual hierarchy

Choose one dominant contact shape, let secondary particles support its direction, and make the final decay intentional. Judge the effect at gameplay distance, in motion and under overlap. Keep the code for timing and cleanup readable; comment non-obvious marker or coordinate-space assumptions.
