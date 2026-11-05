---
name: roblox-map
description: Design and build playable Roblox levels directly in Studio using parts, terrain, lighting, and user-owned assets. Use for maps, arenas, hubs, obstacle courses, interiors, and world layout reviews.
---

# Build a playable Roblox world

## Design the play space first

Clarify player movement, camera, expected player count, session length, route, objective, and boundary conditions. Use a compact blockout before detail. Identify:

- spawn points and safe starting space;
- primary route and optional route;
- landmarks visible from important decisions;
- combat or traversal sightlines, cover, and readable elevation;
- recovery paths, fall zones, and out-of-bounds behavior;
- safe spaces for UI, interaction, and multiplayer spawns.

Use a Studio walkthrough at player height. Check that intended jumps and climbs are achievable with the game's actual character movement settings. Do not invent reachability numbers without measuring in the place.

## Build in Studio

1. Inspect Workspace, Terrain, existing map folders, lighting, spawns, and movement scripts.
2. Block the main route with a small set of anchored Parts. Name route sections and gameplay volumes clearly.
3. Use Terrain Editor for organic landforms; use Parts for precise gameplay geometry. Keep collision surfaces simpler than the visible art where possible.
4. Test navigation from every spawn and direction. Walk, jump, collide, and reset through the route in Play mode.
5. Add large shapes and color/value grouping before props. Re-check contrast, silhouettes, cover, and sightlines after every major set dressing pass.
6. Keep static geometry anchored and non-interactive decorative geometry non-collidable/non-queryable where safe.
7. Inspect the map in play mode at more than one graphics quality when visual effects, lighting, or dense foliage matter.

## Terrain and set dressing

Use Terrain Editor's Generate, Sculpt, Smooth, Paint, and Flatten tools to shape and refine terrain. Re-open the [Terrain Editor guide](https://create.roblox.com/docs/studio/terrain-editor) before relying on a specific control. Avoid clearing all terrain in an existing place. Save or establish a rollback point first.

Use Creator Store assets only when they fit the experience and the permissions allow the intended use. Inspect inserted models for unexpected scripts, remotes, or oversized hierarchies before keeping them.

## Review

- Every spawn has a safe, understandable exit.
- The objective is visible or discoverable without guessing.
- Players cannot bypass, become trapped in, or escape the intended boundary accidentally.
- Traversal is tested with the actual avatar and movement system.
- Static parts are anchored; collisions are intentional; temporary parts are cleaned up.
- Multiplayer routes do not force players into spawn collisions or obstruct each other unintentionally.
- Terrain and distant content are checked with streaming settings in mind.

Read [terrain](https://create.roblox.com/docs/building-and-visuals/studio-modeling/terrain), [performance optimization](https://create.roblox.com/docs/performance-optimization), and [instance streaming](https://create.roblox.com/docs/workspace/streaming) when the place is large.

## Absorbed from map-placement

- Keep builds above y=0: the editor grid at y=0 paints a square pattern, and terrain snaps to 4 studs, so lift by a multiple of 4.
- Measure a Model's world bounding box from its part corners. The pivot is the bounding-box centre only until a `PrimaryPart` is set, so do not trust the pivot.
- Check the front of imported models: a Blender front on -Y can land on Roblox -Z. Clone at the origin and read where the door or front part faces.
- Use meshes for organic shapes such as trees, rocks, stalls, carts and fences; use parts only when you can state why.
- Close the map with one invisible barrier part per side, then verify y values and measured bounds after every build.

Full detail: references/absorbed-map-placement.md

