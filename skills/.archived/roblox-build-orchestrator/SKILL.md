---
name: roblox-build-orchestrator
description: Plan and deliver a scoped Roblox Studio change that crosses gameplay, world, UI, animation, effects, audio, or assets. Use when several skills must contribute to one coherent place edit.
---

# Coordinate a Roblox Studio build

## One place, one write sequence

Treat the open Studio place as shared mutable state. Plan work by dependency and use one ordered write sequence. If the current AI product offers parallel contributors, they may inspect or draft separate work, but never edit the same DataModel concurrently. Merge changes through one writer and inspect the result in Studio.

## Workflow

1. Read `roblox-studio-setup` and establish the correct place, tools, and test target.
2. Translate the request into outcomes, constraints, current paths, and observable acceptance checks.
3. Inspect the existing place and list affected instances and scripts. Resolve duplicates and dependencies before creating anything.
4. Pick only the skills that match the task. Keep changes sequenced: foundation and server rules, world and interaction, interface, animation/effects/audio, then cleanup and test.
5. Before each stage, state the instances or scripts that stage may change. Preserve unrelated behavior.
6. Apply one stage, inspect its result in Explorer/Properties/viewport, and correct it before the next stage.
7. Run the smallest Studio test that covers each acceptance check. Use multiple clients for replicated gameplay and Device Simulator for device-sensitive UI/input.
8. Review Output, remove temporary test objects, and summarize the changed paths and evidence.

## Change boundaries

- Never clear a place or replace a whole service to make a build easier.
- Do not publish or upload as an implicit final step.
- Keep temporary content in clearly named folders and remove it after testing.
- If the place becomes inconsistent, stop adding features. Restore the last valid state or narrow the task to recovery, then resume.
- If a required Studio capability is missing, pause that operation and give a precise manual step while continuing independent planning or code review.

For sequencing and review details, read [stage briefs](references/stage-briefs.md) and [write boundaries](references/write-boundary.md). Read only the specialized skills needed for this task.
