---
name: ul-ui-builder
description: Generate Roblox UI from structured specs with the bundled UI kit, binding helpers and layout validators.
---

# ul-ui-builder

## Workflow

Inspect the existing ScreenGui, data bindings and intended interaction. Start from examples/coin_hud.json or the matching recipe and use scripts/ui_build.py with its actual CLI. Reuse existing controllers; keep visual names and binding contracts consistent. Validate name contracts, labels, contrast and icon wiring with the relevant bundled checker. Preview on phone and desktop sizes, then test live data, rapid clicks, close/reopen and respawn. Never mark a placeholder as wired production data.

## Implementation

Read [the detailed workflow](references/implementation.md) for the specific command, spec format or authoring examples you need. Request supporting files individually with `feather_getskills` (`skill` and `file`); do not load the entire library. Existing scripts and references remain the implementation source of truth.

For scripts that require machine paths, read existing `LOCAL.md` locally or adapt `LOCAL.template.md` from verified paths. FeatherScript native tools do not require completing unrelated setup.

## Generated UI quality

Review the generated screen with the visual-polish reference from `roblox-ui` before expanding it. Keep reusable tokens and binding names consistent. Generated handlers should use clear names, explicit teardown and comments only for intent or non-obvious behavior.
