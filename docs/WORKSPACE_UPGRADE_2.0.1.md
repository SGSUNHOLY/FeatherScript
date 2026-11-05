# FeatherScript 2.0.1 workspace upgrade

The existing sidebar and notebook design remains **Default**. Settings → Your layout offers **Studio** (top tabs) and **Canvas** (floating dock). Layout choices are saved per local profile and do not change its palette, photo or gradient.

## Interface

- Appearance now includes 39 palettes and a compact searchable picker. The 18 new palettes validate text, muted text and accent contrast against both surfaces at 4.5:1 or higher.
- Custom colors, gradients and local photos remain available in the appearance drawer.
- UI labels no longer become selected during clicks and drags. Editors, text fields, code and note content retain normal selection.
- Cancelled click animations clean up their ripple elements. Motion Off also removes existing ripples immediately.
- Feel preview buttons explain muted sound and disabled motion. Keyboard-triggered sound previews unlock audio explicitly.
- Settings → Local profiles → **Remove this profile** requires confirmation naming the profile. Removing the active profile switches to another. The last profile cannot be removed. Shared skills, vault files and connections are retained.

## Optional computer tools

Computer access is **disabled by default**, is managed by the running desktop app, and is shared across local profiles on this device. Enable it in Settings → Computer access, select a mode, and save. Refresh connections before starting a new agent session so its tool catalogue includes the new tools.

| Mode | Behavior after extension pairing |
| --- | --- |
| Always ask | A native desktop dialog for every operation. |
| Ask when unusual | System information and file reads/edits inside explicitly trusted folders can proceed automatically. Programs, opening files, moves, trash operations and paths outside trusted folders ask. |
| Full access | Paired extensions can use all computer tools without further action prompts. Requires explicit confirmation when saving. |

A new browser extension always needs native approval, including in Full access. **Allow once** grants only that operation. **Allow and pair** records the extension origin for later operations under the selected mode. Ignoring the dialog expires the request after 60 seconds; Deny is the default.

Available tools: `pc_system_info`, `pc_list_directory`, `pc_read_file`, `pc_write_file`, `pc_create_directory`, `pc_move_path`, `pc_trash_path`, `pc_open_path`, `pc_run_program`.

**Disable now** revokes active access and cancels pending requests and running programs owned by this controller. Individual extension grants can also be revoked. Recent activity records the current app session's last 100 operations; refresh the activity list to view the latest entries. File contents and program output are not stored in that log.

The tools use the permissions of your current OS user. They do not grant administrator rights or provide an OS sandbox. Programs can access the entire account, so Ask when unusual always asks before starting one. Trusted-folder checks resolve filesystem links and check paths again after approval; they are not isolation against an adversarial local process changing files concurrently.

Text reads are bounded to 1 MB, writes to 2 MB, directory results to 500 entries, program output to 256 KB and program execution to 60 seconds. File trash uses the OS trash/recycle bin and has no permanent-delete fallback. A move refuses a destination that exists when checked.

The bridge forwards computer requests over an authenticated loopback connection to the desktop app. The per-run token is passed only to the bridge process, not stored in project files or exposed to the renderer. The bridge supplies the connection's browser-extension origin; ordinary web page origins are rejected. Closing the desktop app makes computer tools unavailable.

## Validation and packaging

Regression tests cover all provider contracts, send-loop timing and concurrency, parser behavior, local profiles, bridge lifecycle, Obsidian and headless Blender. Permission tests cover pairing, all three modes, rejected origins, failed grant persistence, trusted-folder junction escapes, request cancellation, bounded processes and authenticated HTTP transport. Native Electron checks cover renderer authorization and profile removal confirmation/cancellation.

Chromium checks cover all layouts, palette/photo persistence, profile isolation, compact theme filtering, preview states, ripple cleanup, responsive rendering and reduced motion. Authenticated live chats with each external provider still need manual testing; local simulations cannot guarantee every current website variant.

The Lite ZIP excludes installed Electron dependencies, caches and logs, includes a SHA-256 file manifest, and downloads the pinned runtime during first-run setup. Its small archive size does not represent installed runtime size. Functional checks do not establish an antivirus verdict or guarantee the absence of false positives.

## Main file changes

- `featherscript-app/appearance.js`, `renderer/modules/appearance-controller.js`: validated, profile-local layout preference independent of custom colors.
- `renderer/index.html`, `renderer/app.js`, `renderer/styles/layouts.css`, `renderer/styles/refinements.css`: layout chooser, compact theme search, PC controls and selection boundaries.
- `renderer/modules/juice.js`: animation lifecycle cleanup and preview audio activation.
- `profile-store.js`, `main.js`, `preload.js`, `renderer/modules/profiles.js`, `renderer/modules/preview-api.js`: confirmed profile removal and last-profile protection.
- `featherscript-app/computer-access.js`, `renderer/modules/computer-controller.js`, `computer_tools.py`, `bridge.py`: native permission broker, controller UI and tool transport.
- `featherscript-extension/core/theme-presets.json`, generated JS and desktop/extension CSS: shared 39-palette catalogue. Rebuild with `node scripts/build-themes.cjs` from the project root.
- `featherscript-app/test-computer-access.js`, `test_computer_tools.py`, `featherscript-app/scripts/test.js`: repeatable permission and profile regressions.

## Studio, guides and headless Blender follow-up

All layouts and app pages now share a static blurred scene, with readable glass panels and optional blurred local photos. Studio uses a balanced header with top tabs, a compact overview and responsive navigation. Canvas keeps its dock fixed to the viewport. Layout switching uses cancellable View Transitions when available and falls back immediately for Motion Off, reduced motion or hidden windows.

The new **Guides** tab contains nine searchable offline walkthroughs: first session, browser extension setup, Roblox, Blender, Obsidian, local profiles, appearance, computer permissions and troubleshooting. Each guide links to the corresponding app page.

In **MCPs**, use **Browse** if automatic Blender detection cannot find your installation, then press **Test Blender**. This launches and closes its own temporary background scene. A successful result reports the actual Blender version and executable. Enable headless Blender and save configuration to expose it to the agent. The diagnostic does not enable Blender or replace an unsaved live scene.

The worker now acknowledges successful startup before a tool request is sent. The bridge releases MCP processes and pipes during shutdown instead of relying on garbage collection. Renderer status rows stay mounted across heartbeats, reducing repeated DOM creation. The previous inline Blender UI code and superseded Studio-specific style rules were removed.

Verification includes the Test Blender UI button through native Electron IPC, a persistent scene/create/preview/save lifecycle, and calls through the bridge's actual STDIO MCP client. The locally installed Blender 5.2.3 LTS passed those checks. New tests also cover snapshot cancellation and motion fallbacks. No automatic termination of other applications was added; port 17613 remains unchanged.

## Scroll and native backdrop correction

Restored the app shell to fixed viewport positioning so long pages scroll inside the workspace. Actual wheel input and bottom reachability were verified in all layouts on Settings, expanded Guides and MCPs. Supported Windows 11 systems now use DWM acrylic, with transparent root surfaces so windows behind FeatherScript can contribute to the native blur. Other systems retain an opaque fallback. Restart the desktop app to recreate its native window with the new material.

The default layout keeps its sidebar while using softer cards, clearer labels, a calmer overview and a direct Guides shortcut. Native tests verified the renderer remains translucent rather than hiding the requested acrylic behind an opaque page. The effect is supplied by Windows; a full desktop-app restart is required after this update.
