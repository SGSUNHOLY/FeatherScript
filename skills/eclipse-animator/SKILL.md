---
name: eclipse-animator
description: Author and refine editable Roblox KeyframeSequences for the Eclipse Animator plugin, with pose and marker verification.
---

# eclipse-animator

## Workflow

Inspect the rig, joint type and whether Eclipse is installed. Read references/craft.md and references/joints.md for the selected rig, then author with scripts/build_sequence.luau. Preserve the original sequence and plugin recovery folders. Inspect poses with scripts/inspect_pose.luau and a viewport capture. Open, scrub and save through Eclipse only when UI access is available; otherwise leave a named editable sequence and report that plugin preview/save remains pending. For contact effects read references/vfx-sync.md. Do not claim Eclipse has a scripting API.

## Implementation

Read [the detailed workflow](references/implementation.md) for the specific command, spec format or authoring examples you need. Request supporting files individually with `feather_getskills` (`skill` and `file`); do not load the entire library. Existing scripts and references remain the implementation source of truth.
