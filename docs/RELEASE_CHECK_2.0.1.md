# FeatherScript 2.0.1 — test-release check

Date: November 1, 2026 (Pacific/Honolulu).

Status: ready for a test release based on local automated checks. This is not a certification of live third-party provider behavior.

## Changes made during the final check

- Set the desktop package, lockfile, extension manifest, bridge version and startup version label to 2.0.1.
- Removed an unused Blender tool-name export and corrected stale package/provider documentation.
- Confirmed that the removed embedded editor has no runtime files, UI or IPC references.
- Added a repeatable local regression runner and checks for version agreement, manifest assets and all 12 launcher/injector pairings.

## Passed

- JavaScript syntax across application and extension source.
- Release metadata, renderer dependencies, stylesheet assets and provider registration.
- Local profile migration/data preservation, MCP configuration, socket lifecycle and vault operations.
- Command parsing and ChatGPT CodeMirror extraction regressions.
- MiMo repeated deltas, CRLF/UTF-8 fragmentation, Request abort/options, duplicate-send prevention, reasoning exclusion and paused/stale stream fixtures.
- Chromium app, extension and provider fixtures: all 21 themes, startup/retry, profile switching, saved edits, vault forms, AI/Freebuff launch links, connection refresh, deferred command rendering, AI Studio and Arena fixtures.

## Review notes

The renderer feature modules and scoped feature styles are intact. No obvious dead feature leftovers were found in the reviewed paths. The remaining shared renderer still includes the skills editor and app composition code; further extraction is maintenance work rather than a test-release blocker. Runtime CPU/memory profiling was not performed.

## Remaining manual checks

Before wider distribution, test authenticated sends and real tool execution on the providers being supported. Prioritize MiMo UltraSpeed and image attachment flows. DOM fixtures do not establish account state, quota availability, current live selectors or service stability. Also test the Obsidian connection against a real test vault and optional Blender MCP with a running addon if those integrations are enabled.

Run local regressions with `npm test` from `featherscript-app`. Set `FS_TEST_PYTHON` if a particular Python 3.9+ interpreter is needed. The workspace `_tools/verify-extension.cjs`, `_tools/verify-app-profiles.cjs` and `_tools/verify-upgrade.cjs` provide the separate hidden Chromium fixtures.

No release was published or uploaded by this check.

## Workspace upgrade validation

See [WORKSPACE_UPGRADE_2.0.1.md](WORKSPACE_UPGRADE_2.0.1.md) for the final layout, theme, profile-removal and computer-permission changes. Local provider regressions, Chromium rendering checks and isolated native Electron IPC checks passed. Live authenticated provider sessions and antivirus verdicts remain external validation steps.
