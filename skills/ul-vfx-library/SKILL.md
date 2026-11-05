---
name: ul-vfx-library
description: Harvest, search and curate user-owned VFX packs into portable particle recipes and a reusable Luau runtime.
---

# ul-vfx-library

## Workflow

Use this route when the request involves an existing pack or recipe library. Inspect the library location and ownership; do not fetch an unrelated pack automatically. Harvest emitter properties faithfully, classify and audition a small candidate set, then curate only the selected effects. Use scripts/emit_luau.py and the existing runtime rather than creating a second library. Verify burst/loop behavior, attachment transforms, tint and scale in Studio. For a new authored effect or impact frame, use roblox-vfx-mastery rather than requiring a harvest first.

## Implementation

Read [the detailed workflow](references/implementation.md) for the specific command, spec format or authoring examples you need. Request supporting files individually with `feather_getskills` (`skill` and `file`); do not load the entire library. Existing scripts and references remain the implementation source of truth.

For scripts that require machine paths, read existing `LOCAL.md` locally or adapt `LOCAL.template.md` from verified paths. FeatherScript native tools do not require completing unrelated setup.
