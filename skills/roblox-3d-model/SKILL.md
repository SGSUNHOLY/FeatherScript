---
name: roblox-3d-model
description: Build and arrange Roblox-ready geometry directly in Studio, or inspect and integrate mesh files the creator already provides. Use for props, modular structures, collision shapes, and asset placement.
---

# Geometry and mesh assets in Studio

## Choose a Studio-native route

For geometry authored during the task, use Parts, unions where appropriate, Terrain, and built-in shape/material properties. Establish scale, pivot, silhouette, collision, and interaction before adding detail. Group related pieces into a Model and set a useful pivot and PrimaryPart only when the system needs them.

For a mesh file the creator already has, use Studio's Importer. Preview the mesh, warnings, scale, pivot, texture maps, rig data, and creator before importing. Do not claim to create a source mesh if no mesh-authoring capability is available; offer a Studio-native blockout or ask the user to provide the file.

## Asset structure

- Use clear model and part names that communicate role.
- Anchor static geometry. Make collisions intentional and simple.
- Separate visual geometry from invisible collision geometry when that improves playability.
- Keep pivots at a useful point for placement or rotation.
- Avoid excessive tiny parts and unnecessary physical assemblies.
- Prefer existing place assets over duplicate imports; verify ownership and permissions.
- Inspect Toolbox models before use. Remove unrelated scripts or instances only after confirming what they do.

## Validate in Studio

Inspect from multiple angles, at player scale, and in Play mode. Check seams, pivots, collision, anchoring, and whether the asset blocks movement or camera. For imported MeshParts, choose collision and render fidelity based on the actual shape and measured need. Recheck asset permissions for the target experience.

Use the current [mesh guide](https://create.roblox.com/docs/parts/meshes), [Importer guide](https://create.roblox.com/docs/studio/importer), and [asset permissions](https://create.roblox.com/docs/projects/assets).

## External Blender route

When headless Blender tools are exposed, use `get_scene_info` to inspect the scene, `generate_3d` or `create_model` for a procedural blockout, `look` to review, and `save_scene`/`export_glb` for new output files. Use `ul-3d-model` for a more involved mesh pipeline. Studio import, collision and scale still need verification.

## Graphics quality

Review the silhouette before surface detail. Keep material response, texture scale and edge treatment consistent across a family of props. Check the asset at player scale in its final lighting; a Blender preview alone does not establish the in-game appearance.
