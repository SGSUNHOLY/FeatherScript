---
name: roblox-npc-ai
description: Build and debug Roblox NPC state machines, perception, pathfinding and bounded multi-agent updates.
---

# roblox-npc-ai

## Workflow

Inspect the existing NPC controller, rig ownership and intended behaviors. Define explicit states and transitions with one movement owner. Throttle perception/path requests, react to blocked paths and invalidate stale async work when the target changes. Keep server-authoritative decisions bounded as NPC count grows. Test unreachable goals, target death, despawn, obstacles and crowded scenes. Verify behavior before introducing a more complex AI framework.

## Implementation

Read [the detailed workflow](references/implementation.md) for the specific command, spec format or authoring examples you need. Request supporting files individually with `feather_getskills` (`skill` and `file`); do not load the entire library. Existing scripts and references remain the implementation source of truth.
