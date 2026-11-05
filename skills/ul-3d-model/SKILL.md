---
name: ul-3d-model
description: Create Roblox-ready external mesh assets with the supplied concept, mesh, Blender cleanup, texture and export pipeline.
---

# ul-3d-model

## Workflow

Choose the route by shape: Studio-native parts for simple modular props; Blender procedural tools for hard surfaces; the existing image-to-mesh pipeline for organic forms when its dependencies are available. Inspect the manifest and license requirements before external generation. Run only needed stages; retain intermediate files. Check silhouette, scale, topology, UVs, texture alignment and collision. Export a new file and inspect it in Studio. Historical benchmark claims in the detailed guide describe prior runs, not this machine.

## Implementation

Read [the detailed workflow](references/implementation.md) for the specific command, spec format or authoring examples you need. Request supporting files individually with `feather_getskills` (`skill` and `file`); do not load the entire library. Existing scripts and references remain the implementation source of truth.

For scripts that require machine paths, read existing `LOCAL.md` locally or adapt `LOCAL.template.md` from verified paths. FeatherScript native tools do not require completing unrelated setup.
