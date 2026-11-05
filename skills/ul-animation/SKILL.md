---
name: ul-animation
description: Author Roblox rig animations headlessly in Blender from pose specifications; diagnose rig pose, FK and export problems.
---

# ul-animation

## Workflow

Inspect the actual rig and its rest Action before editing. Use scripts/fk_probe.py and scripts/calibrate_rig.py where the rig needs calibration; their command-line interfaces are the source of truth. Author a small JSON pose spec, render with scripts/anim_render.py, then inspect contact poses and transitions. Export with scripts/to_roblox.py only after the rig mapping is verified. Never clear an existing Action or force FK on an unfamiliar rig without inspecting how its controls work. Preserve the original file; validate the exported clip on the matching Studio rig.

## Implementation

Read [the detailed workflow](references/implementation.md) for the specific command, spec format or authoring examples you need. Request supporting files individually with `feather_getskills` (`skill` and `file`); do not load the entire library. Existing scripts and references remain the implementation source of truth.

For scripts that require machine paths, read existing `LOCAL.md` locally or adapt `LOCAL.template.md` from verified paths. FeatherScript native tools do not require completing unrelated setup.
