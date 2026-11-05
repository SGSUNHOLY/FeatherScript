---
name: roblox-texture-gen
description: Apply and tune Roblox materials, MaterialVariants, SurfaceAppearance, and creator-provided texture maps in Studio. Use for surface style, PBR setup, and material consistency.
---

# Materials and textures in Studio

## Choose the available source

Use built-in Roblox materials for fast, readable surfaces. Use MaterialVariants when the place needs a consistent reusable terrain or part surface. Use SurfaceAppearance on MeshParts when the creator has suitable PBR image maps and the asset's scale and UV layout support them.

If the user asks for an image texture but no image-generation capability or source image is available, state that limit and continue with a Studio-native material treatment. Do not invent image IDs, map files, or asset permissions.

## Apply maps carefully

Inspect the MeshPart, UVs, dimensions, and existing appearance before changing maps. Apply only supported maps to the matching properties (color, metalness, normal, roughness). Verify image asset ownership and experience permissions. Avoid changing a shared asset's appearance when the requested treatment belongs only to one instance; use a suitable local variant or duplicate only when that is safe for the project.

## Tune and validate

Check the surface in neutral and intended lighting, at close and gameplay distance. Watch for stretched texels, seams, excessive gloss, incorrect color space, and texture repetition. Check terrain and Parts separately because their material systems differ. Compare memory and rendering cost for large or repeated assets.

Consult [Materials](https://create.roblox.com/docs/parts/materials), [SurfaceAppearance](https://create.roblox.com/docs/art/modeling/surface-appearance), [meshes](https://create.roblox.com/docs/parts/meshes), and [performance optimization](https://create.roblox.com/docs/performance-optimization).
