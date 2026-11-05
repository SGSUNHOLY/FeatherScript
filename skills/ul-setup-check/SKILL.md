---
name: ul-setup-check
description: Diagnose dependencies for the requested Roblox skill and record verified machine-specific paths without sharing secrets.
---

# ul-setup-check

## Workflow

Read the selected skill’s LOCAL.template.md and any existing LOCAL.md. Run scripts/check_setup.py and inspect only the dependencies for the requested workflow. Detect Blender and FeatherScript’s exposed tools before proposing another MCP installation. Record verified paths and environment variable names, never credential values. Preserve existing settings and working toolchains. Smoke-test the chosen route; missing optional GPU/upload services must not block local procedural modeling or Studio-native work.

## Implementation

Read [the detailed workflow](references/implementation.md) for the specific command, spec format or authoring examples you need. Request supporting files individually with `feather_getskills` (`skill` and `file`); do not load the entire library. Existing scripts and references remain the implementation source of truth.
