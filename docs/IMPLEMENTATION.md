# Provider, Blender MCP and theme upgrade

Changes are implemented in the working tree. No additional npm dependency is required.

## 1. Register Google AI Studio

- `featherscript-extension/manifest.json`: adds `https://aistudio.google.com/*` host access, the existing MAIN-world keep-awake script, and an isolated-world provider entry. The wildcard covers new prompts, saved chats and project routes. All provider entries load `core/theme.js`; ChatGPT and AI Studio also load `core/dom-runtime.js`.
- `featherscript-extension/providers/aistudio.js`: implements the provider contract for composer lookup, native submission, user/model turn classification, response extraction, generation detection, conversation identity, input locking, tool chips and user-send hooks. Thinking content is excluded and code newlines survive extraction.
- `featherscript-extension/core/dom-runtime.js`: shares visible-node lookup, native textarea setters, editable insertion and bounded MutationObserver waits. Wait observers disconnect on success, failure or timeout. Native input/change events update the site's form state. This does not change React or Angular private state, intercept network requests, or replace framework-owned markup.
- AI Studio uses the existing core layout guard and a floating controller anchored to the composer. The extension owns the panel tree, avoiding insertion into a framework-managed subtree. Editors and buttons are resolved again for each operation; stale nodes cause a retryable failure before submission.
- `background.js`, `popup.js`, `dashboard.js` and `core/main.js`: add AI Studio to status broadcasts, supported-host recognition and provider menus.

## 2. Headless Blender MCP

`blender_headless.py` is a dependency-free, newline-delimited STDIO MCP server.
It starts installed Blender lazily with `--background --factory-startup --python
blender_worker.py`. The worker keeps all bpy operations on Blender's main thread
and preserves the scene across calls. Blender logs go to stderr; only JSON-RPC
responses reach the MCP stdout stream. No network listener or addon is required.

The five advertised tools inspect the scene, create primitives, render CPU previews,
save new .blend files without overwriting, and optionally execute Python. Safe mode
rejects Python before launching Blender. Each operation has a 90-second timeout;
timeouts terminate the session, and EOF or bridge shutdown closes the child process.

The MCP panel accepts enabled state, optional absolute executable path, and safe mode.
Saving replaces the legacy addon entry with `blender_headless.py`, retaining Roblox
and other server entries. Disabled preferences persist. A legacy addon entry is
migrated when the user saves the headless form. The Lite packager excludes Blender
and all installed dependencies; it includes the two small Python runtime scripts.

Real Blender 5.2 integration tests cover scene persistence, primitives, PNG rendering,
saving without overwrite, Python execution and process/temp-file cleanup. Protocol
and safe-mode tests run even on machines without Blender.

## 3. Apply Midnight and live themes

- `featherscript-app/renderer/styles.css`: defines the complete Midnight palette with `#020617`, `#0f172a`, `#38bdf8`, readable slate text and visible keyboard focus. Adds the MCP form styles.
- `featherscript-app/renderer/index.html`, `renderer/app.js`, and `main.js`: add, apply and persist the Midnight theme card.
- `bridge.py`: persists theme changes and broadcasts them to connected clients only when the theme changes. Connection snapshots carry the saved theme for reconnects.
- `background.js`: mirrors changed bridge themes to extension storage.
- `featherscript-extension/core/theme.js`: listens for storage changes and updates the injected UI immediately. Supports `auto`, `default`, `dark` and `midnight`. Custom six-digit color overrides in `zsCustomTheme` are restricted to the `ink`, `ink-soft`, `dark`, `bar-1`, `bar-2` and `bar-3` tokens; removing a token restores its stylesheet value.
- `overlay.css`: scopes Midnight styling to the controller, menus, setup panels and conversation chips without recoloring provider content.
- `core/main.js`: replaces the existing two-second theme polling timer with attribute observation of host theme changes. Other existing agent timing loops remain intact.

After this extension update, reload the unpacked extension and existing provider tabs once to load the new code and permissions. Subsequent theme changes do not require refreshing tabs.

## 4. Harden provider and bridge behavior

- `providers/chatgpt.js`: adds semantic textarea/contenteditable selectors and scoped send/stop lookup, supports native textarea state, and stops chunked insertion if the editor detaches. It verifies editor identity before submitting. Existing CodeMirror full-document extraction remains in place.
- `providers/arena.js`: exposes `readPanes()` with separate left/right streams, routes tool extraction to a single deterministic pane and preserves paragraph/code line boundaries. Existing Direct-mode execution guard is retained: concurrent execution of two model outputs is not enabled.
- `core/main.js`: validates tool-chip insertion anchors against detached or reparented nodes.
- `bridge.py`: propagates MCP `isError` results as failures and exposes launch errors in server health. Tool catalogue assembly now uses a single reverse lookup map rather than repeatedly scanning the entire index for each tool.

## Verification

Passed:

- `node featherscript-extension/test-parser.js`
- `node featherscript-extension/test-chatgpt.js`
- `node featherscript-app/test-mcp-config.js`
- `python -m unittest tests.test_bridge_upgrade`: error propagation, collision-safe schema routing, theme persistence, changed-only broadcast and invalid theme rejection.
- JavaScript syntax checks and Python compilation.
- Chromium fixtures in `../_tools/verify-upgrade.cjs`: AI Studio native state and submission, turn roles, reasoning exclusion, code newlines, composer replacement, detached-editor rejection, ChatGPT detachment during chunked insertion, Arena pane isolation and desktop navigation. Screenshots: `../_tools/upgrade-midnight.png` and `../_tools/upgrade-mcps.png`.

Provider tests use controlled DOM fixtures. Authenticated AI Studio/ChatGPT/Arena sessions were not available for live end-to-end verification. Headless Blender is covered by a local integration test. AI Studio image uploads remain unadvertised (`supportsVision: false`); its text tool loop is implemented. Headless safe mode disables Python execution; it is not an operating-system sandbox.


## Expanded palette library

Appearance now offers 21 themes: Default, Dark, Midnight, Azure, Purple, Violet, Rose, Crimson, Sunset, Amber, Emerald, Forest, Teal, Ocean, Graphite, Nord, Mocha, Sakura, Pearl, Lavender and Mint.

`featherscript-extension/core/theme-presets.json` is the source for the shared palette catalogue. Run `node scripts/build-themes.cjs` from the project root to regenerate the browser registry, desktop stylesheet and injected-panel stylesheet. Generated assets are checked in, so normal startup needs no build. The generator validates every new palette's primary, muted and accent text against its background and surface at a minimum contrast of 4.5:1.

The desktop cards are created once from the registry. The main process, bridge and extension validate the same catalogue's IDs. Appearance uses a responsive grid, real color previews and accessible pressed states. Selection persists and pushes live to provider tabs. Every catalogue selection and extension storage events passed Chromium fixtures; the bridge tests also passed for Azure persistence and broadcast. Visual previews are in `../_tools/themes-purple.png` and `../_tools/themes-azure.png`.


## Extension dashboard, Obsidian vault and MiMo follow-up

The extension dashboard now has its own Appearance picker, using the shared 21-theme catalogue plus Follow page. Theme changes apply to the dashboard and injected panels through storage, persist through the bridge when online, and synchronize to an open desktop app. The toolbar's branding, badges, mode switch and state text now follow the palette. Default tokens live on `:root`, so controller-local defaults no longer shadow inherited theme/custom colors. Prompt and MCP inputs also follow the selected palette.

Connect an existing Obsidian vault in the extension dashboard's Obsidian vault panel by entering its full local folder path. The bridge persists the connection without restarting. Read-only is the default; the optional edits toggle exposes a note-writing tool. `obsidian_vault.py` provides `obsidian_list_notes`, `obsidian_read_note`, `obsidian_search`, and optionally `obsidian_write_note`. Notes remain in the selected folder; hidden metadata, parent traversal, absolute paths and alternate streams are rejected. Reads are limited to 1 MiB per note. Search stops at 10,000 notes or 16 MiB of text. Replacing a note requires an explicit overwrite argument. Disconnecting removes the tools from the catalogue. Vault tools work without Roblox Studio.

MiMo submissions now share one in-flight delivery for identical concurrent calls, reject competing submissions, use one submission mechanism, and return an explicit receipt to the core. The core honors that receipt even while the draft is still visible. An unconfirmed delivery surfaces an error instead of automatically clicking again. Active network streams are protected from the stale-stop recovery path, and late events from older requests cannot overwrite the latest stream.

Verification: parser and ChatGPT regressions, JavaScript syntax checks, Python vault tests, bridge regressions, and Chromium extension fixtures passed. The Chromium fixtures cover overlapping MiMo submissions, delayed receipts, out-of-order stream completion, extension theme selection, vault connect/disconnect controls and toolbar branding. Preview files are `../_tools/extension-appearance.png`, `../_tools/extension-vault.png`, and `../_tools/extension-controller.png`. MiMo was verified with controlled fixtures rather than an authenticated live account. No real vault was connected during testing.


## Desktop local profiles and Memory vault placement

The desktop app now opens directly into a local profile. Sign-in, sign-up, email, password and account controls have been removed from its HTML, renderer, preload and IPC handlers. `featherscript-app/profile-store.js` migrates the existing store to version 3, retaining legacy IDs, avatars and per-profile memory, notes, prompts and themes. Credential fields are omitted from the migrated store. A fresh installation starts with a Personal profile. Profile creation and selection live together in Settings, immediately below the profile details, and the sidebar profile button opens them. Pending memory/prompt edits are saved before switching; an unsuccessful save keeps the current profile active. Skills and local bridge connections remain shared on the computer.

The Memory page now includes the Obsidian vault panel directly below long-term context. Browse folders uses a narrow native directory-picker IPC, while connect/save/disconnect reuse the bridge's existing vault protocol. The app socket now correlates these requests, bounds their duration and resolves pending operations when disconnected. Appearance no longer contains Manage MCPs; MCP management remains in its navigation page.

Motion now uses short opacity/transform entrances, staggered panels and button feedback. Reduced-motion preferences disable these effects. The memory editor leaves room for the vault panel while retaining space to write.

Verification passed: `node featherscript-app/test-profiles.js` (migration, data preservation, credential removal and profile isolation), plus `../_tools/verify-app-profiles.cjs` in Chromium (credential-free startup, saving pending memory before switching, persistent profile restoration, folder-picker/vault controls and MCP placement). The broader provider/theme Chromium fixtures also passed. Desktop screenshots: `../_tools/app-memory-vault.png` and `../_tools/app-local-profiles.png`. UI tests use an isolated preview profile and mock bridge; they do not alter the user's real store or vault.


## Restored startup screen and distinctive navigation

The desktop loading screen is restored with the existing feather asset, an animated orbit, theme-aware surfaces and real profile/memory/workspace status stages. It remains visible briefly on fast starts, adds no extra hold to slow starts, and respects reduced motion. Failure keeps the loading screen visible with an actionable retry button; native window controls remain accessible. Local profiles are unchanged.

Navigation now uses notebook-style index tabs: individual icon tiles, short subtitles, serial numbers, a feather bookmark and a theme-accented selected background. MCPs has a dedicated connections icon. Selection uses `aria-current`, and the animated indicator measures actual tab positions and heights instead of assuming a fixed row size, including compact windows.

Updated Chromium checks pass for loader visibility, completion, hidden retry state, load failure/retry, tab indicator geometry, profile persistence and Memory vault controls. Previews: `../_tools/app-loading-screen.png` and `../_tools/app-memory-vault.png`.


## Overview launchpad

Overview now leads with a branded hero and a diagram of the AI-to-tools flow, followed by live connection stats and all 13 supported AI launch cards. `featherscript-app/renderer/providers.js` holds the launcher metadata. Cards use local monograms, avoiding remote asset requests. Each card opens its configured HTTPS chat URL through Electron, remembers the last provider opened, and shows the next step in the controller. External-opening failures now propagate back to the UI through the existing IPC.

Memory, Skills and MCPs have direct Overview shortcuts. The existing searchable command library is retained inside an initially collapsed drawer. Styling adapts to all existing theme tokens and narrower windows, with reduced-motion behavior and visible keyboard focus. The launcher renders its static cards once and adds no polling.

Validation passed for all 12 launch destinations, registration against the bundled extension injectors, last-opened state, quick navigation, command-library retention and the existing startup/profile/vault integration fixtures. No external browser tabs were opened by tests. Preview: `../_tools/app-overview.png`. Two local recording frames were reviewed to compare the previous layout.


## Renderer cleanup pass

The renderer now has explicit feature factories in `featherscript-app/renderer/modules/`: `preview-api.js`, `bridge-socket.js`, `profiles.js`, `vault.js`, `overview.js`, and `command-library.js`. Controllers receive their dependencies from `app.js` instead of relying on its private variables. `index.html` loads the modules before the application composition code. The main renderer went from roughly 58 KB to 42 KB; this is source organization, not a claim of a proportional runtime speedup.

The command library defers DOM work until its drawer is open on Overview. Identical catalogue updates retain existing nodes, and query changes still filter immediately. Rendering remains capped at 400 chips. Socket startup is idempotent, stale transport events are ignored, requests fail cleanly on disconnect, and shutdown releases timers and pending requests.

Obsolete account/intro/veil styles, unused animations and skeletons are removed. Active startup, navigation, profile/vault and Overview styles now live in `renderer/styles/`. Navigation declarations are consolidated and moved asset URLs resolve relative to their new stylesheets. No new runtime dependency was added, and the rendered UI is preserved.

Passed checks: renderer JavaScript syntax, `test-renderer-socket.js`, `test-renderer-assets.js`, `test-profiles.js`, `test-mcp-config.js`, and the Chromium app/provider/theme fixtures. New Chromium assertions verify that closed command drawers do not build chips, unchanged updates retain node identity, the visible list respects its cap and search still works. The Overview screenshot was visually inspected after the stylesheet split.



## Embedded-editor removal, quick launch and MiMo UltraSpeed fixes

The native Blender editor experiment is removed: its tab, IPC, window-host process, renderer module, styles and native test fixture are deleted. Installed Blender and the separate optional Blender MCP configuration are untouched. All 12 existing AI providers remain supported.

Overview and the extension dashboard now offer a Freebuff website shortcut and explicit MiMo Chat / UltraSpeed buttons. Freebuff is an external website link, not an advertised extension injector. Overview also has a connection-refresh action with a bounded request and visible error reporting. The Freebuff destination was checked against https://freebuff.com/ .

MiMo fixes: message deltas append without guessing they are snapshots, so repeated answer/reasoning tokens survive; CRLF normalization works when separators cross network chunk boundaries; Request-based fetch preserves caller overrides and abort signals, and a rejected network request is never submitted again. Open reasoning blocks stay excluded. An authoritative thinking-only stream no longer falls back to stale DOM text. UltraSpeed's generation state waits through short pauses instead of declaring the reply finished after eight seconds without a Stop button.

Passed: the MiMo transport unit fixtures (including one-byte CRLF/UTF-8 fragmentation), MiMo browser overlap/stale-stream/paused-stream fixtures, extension dashboard checks, all-provider launch checks, new website/mode/refresh controls, all themes, local profiles, vault tests, parser and ChatGPT regressions, socket tests, renderer asset paths and JavaScript syntax. Signed-in MiMo service behavior has not been live-verified in this environment.


## Consolidated Providers page (2.0.1)

All chat cards and the Freebuff website card now live in the dedicated Providers navigation page. Overview's launcher button opens that page. The separate MiMo mode and Freebuff panels are removed, along with their unused handlers and styles. MiMo opens `https://aistudio.xiaomimimo.com/` without a preselected route. The extension dashboard uses the same base destination and a single Providers grid, with Freebuff labeled as an external website. The launcher reports 13 supported chats plus one website, and release checks distinguish the website-only card from registered injectors.

App and extension browser fixtures passed for the new navigation, all 13 launch destinations, removed mode controls, the base MiMo URL, existing profile/theme/vault behavior and release asset checks.
