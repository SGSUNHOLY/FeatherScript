---
name: stud-ui-clean
description: Build or refine Roblox UI specifically in the supplied chunky stud simulator style using its existing component kit.
license: MIT
---

# stud-ui-clean

## Workflow

Inspect the existing UI and requested style. Reuse scripts/StudUI.luau, scripts/StudMotion.luau and scripts/CheckUIIcons.luau rather than cloning a competing kit. Read design tokens and the relevant component/layout reference. Keep recognizable bevels, outlined typography and stud surfaces; verify focus, small screens, input and teardown. Apply this style only when it fits the request or existing UI.

## Implementation

Read [the detailed workflow](references/implementation.md) for the specific command, spec format or authoring examples you need. Request supporting files individually with `feather_getskills` (`skill` and `file`); do not load the entire library. Existing scripts and references remain the implementation source of truth.

## Polish within this style

Retain the kit’s chunky shapes and outlined type, but keep the main action clearer than decorative layers. Use the UI visual-polish reference from `roblox-ui` for responsive states and interaction checks. Do not turn every small control into a competing focal point.
