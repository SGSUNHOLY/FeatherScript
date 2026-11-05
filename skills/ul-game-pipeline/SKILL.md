---
name: ul-game-pipeline
description: Build or resume a complete Roblox game across planning, code, assets, assembly and playtesting using a persistent project handoff.
---

# ul-game-pipeline

## Workflow

Locate the existing project and read its HANDOFF.md or FeatherScript continuation before creating anything. Use scripts/section.py to inspect/resume the current stage; check its CLI before running mutations. Build a playable vertical slice before expanding asset scope. Reuse the specialist skill for the current stage rather than loading the entire library. Preserve stage outputs and update the handoff with completed work, unresolved failures and the next task. Continue within the user’s authorized scope; do not require clearing the chat or impose a new approval at every section. Publishing remains a separate explicitly requested action.

## Implementation

Read [the detailed workflow](references/implementation.md) for the specific command, spec format or authoring examples you need. Request supporting files individually with `feather_getskills` (`skill` and `file`); do not load the entire library. Existing scripts and references remain the implementation source of truth.

For scripts that require machine paths, read existing `LOCAL.md` locally or adapt `LOCAL.template.md` from verified paths. FeatherScript native tools do not require completing unrelated setup.
