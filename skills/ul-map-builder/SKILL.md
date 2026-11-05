---
name: ul-map-builder
description: Generate and verify Roblox maps from JSON specs, movement profiles and reusable terrain/placement scripts.
---

# ul-map-builder

## Workflow

Inspect the map spec, movement profile and destination place. Reuse an existing spec or the minimal example before inventing a schema. Start with a navigable blockout; check reachability and scale before dressing. Use the supplied plan/build/verify tools and relevant terrain checks. Choose Terrain or Parts to fit the map and existing project rather than mandating terrain for every floor. Inspect spawn, routes, camera clearance and representative player-scale views. Keep generated instances grouped so revisions do not remove unrelated content.

## Implementation

Read [the detailed workflow](references/implementation.md) for the specific command, spec format or authoring examples you need. Request supporting files individually with `feather_getskills` (`skill` and `file`); do not load the entire library. Existing scripts and references remain the implementation source of truth.

For scripts that require machine paths, read existing `LOCAL.md` locally or adapt `LOCAL.template.md` from verified paths. FeatherScript native tools do not require completing unrelated setup.
