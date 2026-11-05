---
name: roblox-tooling
description: "Use when setting up or changing the Luau toolchain: Rojo sync, Wally packages, Rokit tool versions, Selene lint, StyLua format, luau-lsp, or Lune in CI."
---

The toolchain turns Luau files into a checked, formatted, reproducible project. Pin versions so every machine and CI run uses the same tools.

## What each tool does (from the Roblox toolchain guide)
- Rojo (rojo-rbx/rojo, 7.4.4 in the guide): syncs Luau files from disk into the Studio object tree. It is the source of truth; edit files, not Studio scripts.
- Wally (UpliftGames/wally, 0.3.2 in the guide): package manager for Luau libraries, with a manifest and lockfile. Use it for mid to large projects.
- Rokit (manages tool versions through a `rokit.toml`): the guide recommends it for new projects. Aftman is archived but still reads `aftman.toml`.
- Selene (Kampfkarren/selene, 0.27.1 in the guide): static linter with built-in Roblox API support. Run it in check mode.
- StyLua (JohnnyMorganz/StyLua, 0.20.0 in the guide): formatter. Run it in check mode in CI so nothing is rewritten silently.
- luau-lsp: language server for autocomplete, types, go-to-definition and hover. The guide gives no version.
- Lune: standalone Luau runtime, for scripts that run outside Studio (CI, build steps). The guide gives no version.
- TestEZ is archived per the guide. Keep it where it already is; do not start new tests with it.

Versions above come from one guide page. Check the current release of each tool before pinning; do not treat them as the latest.

## Rules
1. Pin every tool in `rokit.toml` (see `configs/rokit.toml`). A team member runs one install, not a list of setup steps.
2. Keep `selene.toml` with `std = "roblox"` (see `configs/selene.toml`), so Roblox globals are known.
3. Keep `stylua.toml` (see `configs/stylua.toml`). Format with the tool; do not hand-format.
4. CI runs Selene and StyLua in check mode. A failing check fails the build.
5. Rojo is the sync path. After a sync, run the sync check (`ul-game-pipeline` verify_sync) before you trust what Studio shows.
6. Wally packages go in the manifest; never copy a library's source into the project by hand.

## Checks before calling a tooling change done
- Run each tool once from the pinned install and paste the version line it prints.
- Run Selene and StyLua check mode over the changed files. Report each as PASS, FAIL or NOT RUN.
- If a config key is rejected by the installed version, the key is wrong for that version: fix it, do not delete the check.

## Not checked by this skill
- Exact config keys for the pinned versions. Verify each key by running the tool (a rejected key is an error message, not silence).
- Whether luau-lsp and Lune work in the user's editor and CI. The user must run them.
