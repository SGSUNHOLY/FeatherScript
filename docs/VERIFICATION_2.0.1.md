# Verification and skill cleanup — 2.0.1

The requested fixes are applied to the working FeatherScript folder.

## Removed

- The Effort selector, DEFAULT/FLASH/ULTRA configurations, mode-specific context/recovery branches and automatic native-thinking adapter.
- Mode comparison UI and per-job mode settings. Old queued prompts are preserved; obsolete mode fields are discarded when queues restore.
- The obsolete engine module, engine-only test file and public engine guide. Command correlation, real-result confirmation, Cowork, profiles, PC permissions and Auto Playtest remain.

There is one task pipeline. The provider model and its native thinking setting are left alone. The toolbar shows the skill library instead of an effort selector.

## Skills

- **54 active skills**, with no identical normalized main documents and no empty starter templates in the active catalogue.
- VFX Mastery is installed, with the original research and agent metadata retained. Older overlapping VFX guidance is preserved in its merged instructions/resources; asset-library tooling remains separate.
- **16 legacy skill names** resolve to canonical skills without duplicate catalogue entries. Relevant old resource names also resolve after merges.
- Missing build-stage/write-boundary references and the reference index are restored. Archived-only UI instructions are now available as ordinary supporting files. The local Markdown-link audit passes.
- Main instructions load compactly; references/scripts remain discoverable and readable on demand. At most two relevant main documents are prefetched within an 18,000-character budget. The entire catalogue remains accessible.
- Metadata caching avoids re-reading unchanged main documents and invalidates on edits. A cache-key issue found by the regression tests was corrected.
- AgentScript skips Roblox-only automatic skill context. PC skills can declare `scope: pc` in front matter or use a `pc-` folder prefix. Studio capture tools are rejected in AgentScript.

The Lite bundle retains the existing baseline skill families and the explicitly requested VFX Mastery pack. Optional UL development toolkits remain in the working source folder rather than being silently added to the small release. Release aliases are filtered to skills actually shipped.

## UI and packaging

Theme shapes and typography now survive the editorial controller stylesheet. Local art, previews and scene details remain available across 41 themes; dark tool-chip text contrast is corrected. The utility menu and compact controls remain usable. The stale ZIP is replaced with a build containing the current controller, task/skill code, theme assets and VFX pack.

## Verification

- Full local release suite passed, including **45 Python tests**, all 12 provider contracts, command transport, parser/send-loop, desktop permissions, profiles, appearance, VFX scheduling and real headless Blender.
- Chromium exercised three queued task sizes, profile changes during a task, PC context filtering, saved queue migration, utility-menu keyboard handling, theme shapes and compact controls. No native thinking-control calls occurred.
- Desktop Chromium decoded all 41 theme images, checked live theme changes, verified visible surfaces and scrolling, and produced screenshots that were inspected.
- Runtime source has no Effort selectors, hooks or adapter. Retired files are absent. Existing queued text survives migration.
- Release construction checks passive SVG assets and required runtime files. Final archive CRC, content hashes and retired-file exclusion are verified separately.

Authenticated live provider sessions, real Roblox gameplay coverage and hardware-specific latency still need testing on the intended setup. These checks do not claim universal zero bugs, zero lag or antivirus guarantees.

Restart the desktop app, reload the unpacked extension from this same folder and refresh existing chat tabs to activate both backend and frontend changes.

## Compact controller and app background

The controller now uses a compact two-row dock with rounded controls, a profile pill and a small skill count. PC permissions remains available in More. The former editorial overlay stylesheet was replaced rather than layered on top. Effort remains absent.

The app layout is unchanged. All 41 theme scenes now gently pan and zoom with a separate drifting light layer. Custom photos stay steady. The animation pauses while unfocused and respects Motion Off, Reduced and the operating-system reduced-motion preference. No additional JavaScript animation loop was added to the app.

Chromium repeated the task, profile, migration, utility-menu and compact-layout checks after this update. A hidden offscreen render test explicitly advanced its paint clock and confirmed background movement, pausing and reduced-motion behavior. Renderer asset, profile, queue/skill, layout-transition and VFX-budget checks also passed.

All 41 visible scene layers were individually checked in offscreen Chromium for actual changing transforms. Inactivity pauses the scene; Motion Off, Reduced and OS reduced motion disable both layers. Renderer assets, layout transitions and VFX scheduling checks passed.

## Background visibility and feather motion

Theme scenes have a wider, slow pan with overscan to avoid exposed edges. Large app panels use a consistent translucent fill across Default, Studio and Canvas; content stays still. Extension feathers retain their 6–22 particle budget and now have individual wind drift and independent rolling/fluttering silhouettes. Hidden tabs pause all three feather animation layers; reduced-motion hides the field and can be changed without reloading. No per-frame JavaScript or additional particles were added.

Chromium checked all 41 theme scene transforms, translucent panels in all three layouts, motion preferences, feather variation and flutter, pause styles, controller tasks/profiles/queue migration/menu and compact geometry. Renderer assets, layout transitions, VFX budgets, script profiles and queue/skill tests passed.


## Outside blur removed; audio fixes retained

The outside desktop blur has been removed at the user's request. Its capture code, overlay window, renderer asset, test and release requirements are removed. The app no longer creates surrounding overlay windows or captures the desktop for this effect. Theme animations and the existing app design remain.

Sound cues and music still obey focus state, and Electron mutes the app when unfocused, hidden or minimized. Audio and renderer/release checks were rerun after removal.

## Backend expansion and UI refinement

The build retains 270 unique built-in tools: 169 Roblox/skills tools and 101 permission-controlled PC tools. The 30 newer Roblox workflows and 40 newer PC tools were preserved. Fixed generated Luau with duplicate separators and invalid table-literal indexing, and corrected the invisible-button audit to read only properties supported by each button class. All 130 generated Roblox workflows compile with the official Luau compiler; this verifies syntax, not every workflow in a live Studio place.

Startup keeps catalogue hydration/prewarming and single-flight refresh, prepares the composer concurrently, and includes a compact AgentScript tool index rather than requiring a separate discovery turn. Response tests cover blank reads during remounts, distinct logical turns sharing a node, transient failures, early site errors and duplicate Start clicks. Provider generation time remains outside the extension's control.

The overview now has a single practical introduction, short setup steps, a plain connection summary and directly named memory/skills/tool links. Sidebar structure, all layouts and theme identities remain. App and extension controls use restrained borders and consistent spacing. Theme artwork remains animated at lower contrast; outside desktop blur remains removed.

Validation: full release suite passed with 51 Python tests, all 12 provider contracts, PC permission regressions, all 85 added PC handlers, real Git and headless Blender. The response runtime regression was reconciled with the newer cache helpers and added to the suite. Chromium checked extension tasks/queue/profiles/menu/narrow layouts, 41 theme assets and desktop scrolling. Authenticated live provider chats and all mutating workflows in a real Studio project still need release testing.


## Latest presentation changes reverted

Restored the app layout, extension skin, motion stylesheet and sound behavior from the verified backups taken before the animated workbench pass. Backend improvements and the 270-tool catalogue remain.

## Earlier UI cleanup reverted

Restored index.html, workspace-finish.css, ambient-motion.css and controller-skin.css from the verified backups preceding the human-ui cleanup. Both rejected presentation passes are now reverted. Backend improvements, the verified tool inventory (45 Roblox and skill tools plus 21 PC tools, with 130 workflows — see [TOOL_REFERENCE_2.0.1](TOOL_REFERENCE_2.0.1.md)) and the background-audio fixes remain. The removed outside desktop blur remains absent.

## VFX and SFX refresh (effects only)
- Smaller quill sparks, split arc rings, subtle glints and throttled pointer trails. One click handler owns bursts; light themes use ink-tinted particles.
- Revised procedural navigation, theme, layout, paper, toggle, click and confirmation cues. Whole cues must fit the voice budget. Background windows cannot unlock or play sound. Music source and settings are unchanged.
- Existing Feel preview cycles through five cues. Burst preview is silent. Layout files, renderer HTML, extension controller skin and music module were SHA-256 checked unchanged.
- Passed renderer feel, VFX budget, native window presence, renderer assets, layout transitions and appearance checks. Simulated 144 Hz: idle 30 draws/s, interactions no more than 64 draws/s, canvas no more than 3 megapixels. Zero intensity, missing canvas, first pointer sampling and single click ownership covered.
- Real Electron rendered nine cues through OfflineAudioContext with nonzero output and peaks below 0.20. Verified DOM cue routing, dark/light particle rendering and Motion Off. Extension Chromium checks passed: feather wind/flutter, particle cap, inactive pause, controller controls and compact layout.

## Living theme scenes
- Added shared core/theme-motion.js and theme-motion.css for the desktop renderer and all twelve provider controller entries. Theme changes replace a bounded passive scene; unchanged themes reuse the existing nodes. No per-frame JavaScript, external media or network requests are introduced.
- All 41 themes have deterministic choreography. Space variants have actual orbiting planets (with counterrotation to keep them round), ringed planets or satellite radar. Other families include clouds, waves, petals, leaves, woodland fireflies, steam, auroras, mechanical dials, circuits, snow and moonlit bats. Related themes vary shape, timing and motion. Existing layouts, music and interaction sounds remain intact.
- Ambient canvas particles now use stars, snowflakes, petals or dust appropriate to the selected scene; existing frame, pixel and particle budgets are retained.
- Passed test-theme-motion.js (all theme coverage, scene bounds, idempotent mount, teardown and fallback), renderer feel, VFX budget, renderer assets, appearance and layout transitions. All twelve provider contract checks passed. Manifest dependencies and order validated.
- Real Chromium QA confirmed 41 distinct scene signatures, maximum 19 span elements per full scene, planet movement over 90 pixels when advancing its orbit, focus pause, Off/Reduced and OS reduced motion, and custom-photo preservation. Reviewed Midnight, Purple, Forest and Christmas captures.
- Extension Chromium QA passed live scene/theme switching, click-through, host-style isolation, bounded compact scenes, visibility pause, controller operations and narrow controls. Music and SFX sources were SHA-256 verified unchanged.

## Lean command catalogue and frost fronts
- Reduced advertised built-in entry points from 270 to 66 (45 Roblox/skills and 21 PC). Consolidated 130 specialist Roblox wrappers into five operation tools plus schema lookup, and 85 specialist PC wrappers into four operation tools plus schema lookup. Common commands stay direct. Specialist implementations remain in active use behind the groups and remain routable for existing integrations.
- Built-in schema data decreased from 122,682 to 32,546 bytes (73.5%, compact UTF-8 JSON). This measures catalogue/prompt overhead, not end-to-end model latency. The extension cache key was revised so oversized old catalogues are not hydrated. Existing prewarm, single-flight and stale-cache behavior are preserved.
- PC grouped calls resolve to the original tool name before the authenticated desktop broker checks pairing, paths, approval mode and access class. Roblox groups use the original parameter validator and Luau runner. Group/schema requests reject invalid outer keys, unknown operations and malformed params before dispatch.
- Full Python discovery: 57 tests completed successfully, with two skipped environment-dependent checks. All 130 legacy/grouped Roblox operations produced identical transport payloads. New group lookup, denial, routing, bounds and packaging tests passed; the release fixture now requires tool_groups.py. Updated command reference documents the 66-entry surface and on-demand schemas.
- Passed all twelve provider contract checks, extension startup-cache and loop-guard tests, profile scope tests, renderer feel/assets, VFX bounds and scene lifecycle tests. All 85 specialist PC tools passed their existing real permission-broker/Git/edit-boundary suite.
- Frost now has wind-driven flakes, gliding gust ribbons, ice shards and breathing edge frost. Glacier adds spindrift and moving cold mist; Nord has a separate snow drift. Existing motion-off/reduced/focus rules cover the new layers, including the compact extension controller. Real Chromium checked all 41 scenes, bounded node counts, live switching, frost wind displacement, OS reduced motion and controller layout/click-through.
- Music source was SHA-256 verified unchanged. Existing layout and SFX are retained.

## Interface refinement
- Refined the existing sidebar/overview instead of introducing another layout: compact single-line navigation, restrained headings, consistent control radii and focus rings, readable field labels and status text. Overview actions and shortcut labels now describe actual destinations. Removed decorative provider numbering, duplicated typography conventions and numbered panel headings.
- Standardized provider cards, theme selectors, form controls and button hierarchy. The extension keeps its two-row compact controller with quieter borders, fewer pill shapes and consistent action buttons. No provider behavior, permissions, backend routing, music or background animation implementation changed.
- Fixed long permission help text widening Settings: help/status text wraps at narrow widths. Chromium verified Settings vertical scrolling with no horizontal overflow at 980x700. All three layouts passed content-width checks. Reviewed dark/light overview, Providers, Settings, Memory and MCP views plus the extension dock.
- Passed renderer assets, appearance/contrast, layout-transition and feel/audio tests. Chromium verified all 41 theme scene signatures, motion preferences, scene budgets and live switching. Extension fixtures passed controls, queues, profile scopes, live themes, click-through, animation pause and narrow layout checks. These are local fixtures; no live provider session was run.
- Music source hash remains unchanged. Existing frost fronts, orbiting planets and other living scenes are retained. Updated existing stylesheets only; no UI dependencies or new media assets were added.

## Settings redesign reverted
Restored the previous renderer HTML from its verified backup and removed settings-workspace.js and preferences.css. Earlier UI refinements, the lean command catalogue, theme animation improvements and music remain unchanged.

## Faster preparation and stronger task planning
- Relevant skill reads run concurrently (maximum two selected) instead of two sequential waits of up to 35 seconds each. A 1,500 ms prefetch budget bounds optional context waiting; slower or oversized skill instructions are explicitly deferred for on-demand reading. Read requests remain bounded by transport timeouts. Cache entries are size/count limited; pending reads are single-flight and capped.
- Reentrant task preparation joins the same task. Cancellation immediately releases the preparation wait, and late reads cannot append context to a cancelled task. Shared local skill content can be reused across chats for the existing short TTL, while confirmed context delivery is tracked separately by conversation/profile/content and refreshed after two minutes or more than eight assistant replies. An unconfirmed send never marks context delivered.
- AgentScript now receives a compact PC-specific bootstrap with only its own command and skill catalogue, instead of the Roblox-oriented system prompt. Original command envelope, metadata lookup, denied-access handling, provider rules and user custom prompt remain. In the regression fixture the PC prompt is 2,644 characters versus 18,592 for the Roblox template; this is prompt size, not an end-to-end latency benchmark.
- Substantial tasks receive guidance to establish acceptance criteria, inspect state, map dependencies, compare alternatives internally, consider failure modes and verify integration/error paths. Small tasks stay direct. Native provider reasoning controls and the removed Effort modes are unchanged. Private deliberation is not requested in the output.
- Fixed legacy PC text-edit operations being classified as read-only context tools. Command correlation, uncertain-write protection, single-command execution, stream completion and empty-reply/loop guards remain intact.
- Passed every extension Node test, including new preparation/prompt tests, all twelve provider contracts, response runtime, startup cache, queue/profile scope, parser and command-transport checks. Chromium controller fixtures passed task sizes, queue behavior, immutable profiles, PC skill scope and compact controls. The 40 ms stalled-read test fixture completed around 42–54 ms; the production prefetch budget is 1,500 ms. No live provider performance benchmark was run.
- No app UI, music, permission settings or background animation changes in this pass.

## Provider walls and Studio state recovery
- Added a shared provider-status adapter to all twelve provider entries, loaded after the command classifier. It scans bounded visible alert/composer surfaces for quota resets, exhausted credits, sign-in and verification walls. Transcripts, editable drafts, hidden nodes and FeatherScript feedback are excluded. Automatic model-fallback advisories are distinguished from blocked requests.
- Provider walls stop response waiting, refuse sends and prevent new bridge commands. The controller visibly reports Paused, Cowork pauses, and automatic loop reentry is blocked until a deliberate user action. Queued submissions also set the paused controller state when sending fails before the agent loop begins. Resolving a native banner alone does not replay the pending edit. No provider quota or verification is bypassed.
- Added explicit handling for plain Edit datamodel unavailable/not accessible rejections, including MCP failures returned as successful text. These are state problems rather than bad parameters. Recovery feedback calls for get_studio_state, a single appropriate Stop when persistent editing requires it, then confirmed Edit availability. Successful Stop feedback notes the datamodel can reattach later. No automatic play-state mutation or uncertain edit replay was added.
- All 21 extension Node test files passed, including twelve provider contracts, send/response recovery, pre-tool quota guards, blocked-loop reentry, state-error feedback, command transport, parser, profile scopes and fast context preparation.
- Real Chromium fixtures passed native/plain composer quota notices, auth/verification notices, draft/transcript/hidden/extension isolation and nonblocking advisories. The live controller fixture confirmed visible pause during a queued task, zero pending-edit execution, queue pause and no automatic replay after removing the notice. Existing controller, skills, profile, theme and compact-layout fixtures passed.
- Faster preparation and stronger task-planning changes remain included. No live provider account or Studio session was used to claim end-to-end success; actual provider limits still apply.
