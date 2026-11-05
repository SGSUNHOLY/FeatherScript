---
name: ul-build-orchestrator
description: Coordinate a multi-asset Roblox build with a shared brief, scoped outputs and assembly checks.
---

# ul-build-orchestrator

## Workflow

Inspect the project and establish the requested deliverables and write boundaries. Use the existing run ledger and stage brief format. Work serially by default; delegate only when explicitly requested or authorized by applicable instructions. Keep one owner for assembly and shared files. Validate each asset against the brief, then integrate and verify in the target place. Use the ledger to resume real work; never substitute status bookkeeping for a deliverable.

## Implementation

Read [the detailed workflow](references/implementation.md) for the specific command, spec format or authoring examples you need. Request supporting files individually with `feather_getskills` (`skill` and `file`); do not load the entire library. Existing scripts and references remain the implementation source of truth.

For scripts that require machine paths, read existing `LOCAL.md` locally or adapt `LOCAL.template.md` from verified paths. FeatherScript native tools do not require completing unrelated setup.
