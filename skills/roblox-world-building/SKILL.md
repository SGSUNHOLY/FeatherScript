---
name: roblox-world-building
description: Build Roblox environments, lighting and procedural world geometry while preserving placement and runtime budgets.
---

# roblox-world-building

## Workflow

Inspect the current map, player movement scale and lighting. Block navigation and landmarks before surface detail. Reuse grouped generators, deterministic seeds and useful pivots; choose Terrain, Parts or imported meshes for their actual role. Keep expensive runtime geometry changes bounded and validate available APIs before using specialist features. Review player-scale camera views, traversal, collision, lighting and streaming behavior. Use roblox-vfx-mastery for a dedicated effect rather than loading every world-building topic.

## Implementation

Read [the detailed workflow](references/implementation.md) for the specific command, spec format or authoring examples you need. Request supporting files individually with `feather_getskills` (`skill` and `file`); do not load the entire library. Existing scripts and references remain the implementation source of truth.

## Graphics passes

For scene-wide visual polish, use `roblox-graphics` to establish lighting, material and composition goals before changing world geometry. Keep routes readable and review at player scale rather than decorating every surface.
