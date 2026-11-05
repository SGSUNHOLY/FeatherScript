---
name: roblox-characters-animations
description: Integrate character lifecycle, Humanoid behavior, Animator playback, tools and animation markers in Roblox.
---

# roblox-characters-animations

## Workflow

Inspect character ownership, rig type and existing controllers. Keep damage and authoritative state server validated; keep local presentation responsive. Load tracks through the correct Animator and clean up connections/tracks on death, respawn or replacement. Check priorities, marker timing and replication on the target rig. Use roblox-animation for editor authoring, eclipse-animator for Eclipse sequences or ul-animation for Blender rig authoring; load one authoring route.

## Implementation

Read [the detailed workflow](references/implementation.md) for the specific command, spec format or authoring examples you need. Request supporting files individually with `feather_getskills` (`skill` and `file`); do not load the entire library. Existing scripts and references remain the implementation source of truth.
