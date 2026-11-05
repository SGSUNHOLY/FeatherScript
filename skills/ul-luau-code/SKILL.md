---
name: ul-luau-code
description: Build and verify Roblox Luau projects on disk with the existing scaffold, pure core modules and optional Rojo toolchain.
---

# ul-luau-code

## Workflow

Inspect the existing project, execution boundaries and installed toolchain. Reuse its framework; do not introduce Knit or Rojo solely to satisfy this skill. Separate server authority, shared pure logic and client presentation. Use scripts/new_project.py only for a requested new project, and scripts/check.py for available checks. Run focused tests and compilation before Studio integration, then verify replication and lifecycle behavior in Studio. Missing tooling is a concrete limitation, not a reason to claim validation passed.

## Implementation

Read [the detailed workflow](references/implementation.md) for the specific command, spec format or authoring examples you need. Request supporting files individually with `feather_getskills` (`skill` and `file`); do not load the entire library. Existing scripts and references remain the implementation source of truth.

For scripts that require machine paths, read existing `LOCAL.md` locally or adapt `LOCAL.template.md` from verified paths. FeatherScript native tools do not require completing unrelated setup.

## Code clarity

Follow the readability reference from `roblox-code` for substantial implementation or cleanup. Explain non-obvious constraints in short comments, preserve public contracts and avoid new abstractions that have only one trivial use.
