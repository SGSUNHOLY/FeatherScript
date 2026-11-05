---
name: ul-texture-gen
description: Generate and apply reusable textures or mesh-conforming materials using available Studio or external texture tools.
---

# ul-texture-gen

## Workflow

Inspect the target mesh, UVs, existing textures and desired material. Prefer an exposed Studio texture tool for a single mesh-conforming request; use scripts/generate_texture.py for the supplied reusable-image workflow when its dependencies are configured. Do not promise an external endpoint is free or available without checking it. Save a new output, validate seams, tiling and PBR channel interpretation, then confirm asset permissions and inspect the applied result in Studio.

## Implementation

Read [the detailed workflow](references/implementation.md) for the specific command, spec format or authoring examples you need. Request supporting files individually with `feather_getskills` (`skill` and `file`); do not load the entire library. Existing scripts and references remain the implementation source of truth.

For scripts that require machine paths, read existing `LOCAL.md` locally or adapt `LOCAL.template.md` from verified paths. FeatherScript native tools do not require completing unrelated setup.
