---
name: roblox-graphics
description: Improve Roblox scene graphics, lighting, materials, color palettes and composition while preserving gameplay readability and device performance. Use for visual polish, art direction or a cohesive environment style.
---

# Scene graphics and art direction

## Inspect the scene

Capture the current scene from a representative player camera. Identify the focal subject, gameplay silhouettes, material language, lighting and intended device tier. Preserve the project's visual identity; ask only when choosing a direction would materially change the request.

## Make one coherent pass

1. State the intended read: what the player notices first and what must remain readable during play.
2. Fix silhouette, scale, composition and value separation before adding effects. Arrange props to guide movement and support landmarks, not fill every gap.
3. Choose a restrained palette and differentiate materials through roughness, color, geometry and texture scale. Avoid giving every surface the same shine, noise or emission.
4. Adjust lighting to explain shape and the scene's mood. Preserve useful shadows and highlight detail. Bloom, fog and color effects should support the read rather than hide weak geometry.
5. Review at normal gameplay distance and motion, including bright/dark areas and lower graphics quality. Keep a consistent camera for useful before/after comparisons.

Change the current scene in small, reviewable groups; preserve original lighting values or a named revision. Check actual API/tool availability before applying settings. Do not claim a visual pass worked from numeric settings alone.

## Choose the right implementation

Use the existing world-building tools for placement and lighting, the modeling workflow for geometry, and roblox-vfx-mastery for an authored effect. Do not load all three unless the task needs each. UI polish belongs to roblox-ui rather than global scene post-processing.

Read [visual review](references/visual-review.md) when diagnosing an existing scene. Report what was observed, changed and checked; mark unavailable viewport or device checks unverified.
