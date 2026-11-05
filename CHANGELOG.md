# Changelog

All notable changes to ZeroScript Free are documented here.

## Honest status, real handoff files and the stall breaker — 2026-11-05

- Every MCP surface now says the same thing, because they all read the same verdict. `core/server-status.js` is one shared UMD module used by the model-facing `list_mcp_servers` text, the chat bar chip, the dashboard, the popup and the desktop app; before this, five places re-worded the bridge's answer independently. A server is only `working` when it can actually run commands — `alive` was never proof, since StudioMCP advertises its full catalogue with no Studio attached and the headless Blender worker does the same with no Blender installed. States are `working | waiting | starting | failed | offline`, each with the one fix sentence that applies. New regression `test-server-status.js` fails if any surface invents its own wording again, and `tests/test_server_health.py` pins the bridge side.
- Fixed the specific lie that Blender was `working` on a machine without Blender. `blender_headless.py` now caches a `preflight()` lookup (20s, no subprocess launch), and `bridge.py` downgrades a nominally healthy Blender server to `waiting` with the install/`BLENDER_EXECUTABLE` reason. The advice was wrong too: a dead built-in Blender used to be reported as an addon problem, telling the user to "open Blender with its MCP addon" — it is a headless worker, and the fix is to restart the bridge.
- The chip no longer says "Starting Up" over an agent that already replied "I am ready", and it no longer hides a dead server behind a tool count. `Bridge online · 84 tools · 2 not working` names the servers that are down while keeping the dot honest; a bootstrap that finished announces `Agent ready`, and a handoff that arrived says `Handoff sent · <project>` instead of a generic greeting, so "did continue work?" is answerable from the screen.
- The repeat breaker is now result-aware. "The agent got stuck on one command — Notion AI issued the same command with identical arguments 3 times in a row" fired even when the repeated command was *succeeding and returning new output*, because the counter keyed on the call alone. A call whose result changed is progress and is allowed; only an identical call returning an identical result is blocked, and the recovery message says which command and what came back, then waits for Start.
- Fire handoff and Save continuation file now yield the same JSON the extension injects, as a file. `continuationFile()` in `core/projects.js` owns the document, the serialisation and the file name, so the desktop writer (`projects:export`), the browser download and the prompt cannot produce three different documents; a title like `../../evil:Village ✓` becomes one flat `FeatherScript-continuation-evilVillage.json`. The browser button no longer fails silently either: it used to `await` storage and then click a hidden download link, which loses the click's user activation, so Chrome dropped the file without a word — that path now reveals the link for the user to click. An unfired project reports "no saved checkpoints yet" instead of writing an empty handoff. Covered by `test-projects.js`.
- `memoryNudge()` is now catalogue-gated: a bridge that does not advertise `feather_memory` is told to update memory with `execute_luau` comments, and is never told to route memory through `multi_edit`, which requires a character-exact `old_string`.
- Suites: 48/48 JavaScript regressions and 82 Python tests pass (`py -3 -m unittest discover -s tests -t .`, 5 skipped for optional tooling).

## Reply continuity and project memory — 2026-11-04

- Fixed the agent stopping in the middle of a long answer (reported as "ai stops randomly", with a Gemini reply cut off inside a Luau listing). The tail-latency fix below went too far: to stop a one-sentence "I'm ready" answer from sitting on a lingering stop control, it applied the provider's 1.5s idle window to **every** command-free reply — but Gemini keeps its stop control up for the whole generation and streams code in bursts, so a normal 1.6s token gap in a 4,000-character answer was read as "finished". The fast window now applies only to replies under 700 characters; anything longer waits out the full stability window, exactly as before. Short answers still finalise in ~2.2s, so the delay fix survives.
- A cut-off reply is now resumed on every provider, not just the five that show a native Continue button. `kind:"truncated"` could only ever be produced when `findContinueBtn()` found an element, and Gemini, Qwen, Kimi, Genspark, Arena, Meta, GLM and AI Studio all hardcode it to nothing — so a half-written answer was finalised as if it were complete and the run ended silently. `ZSParse.looksCutOff()` now reads the shape of the text instead of the page (an unclosed code fence, or a trailing comma, opener or operator) and triggers the existing "Reply was cut off, resuming…" nudge. Complete answers are never resumed: a sentence, a closed fence, a markdown table row and a `**bold**` ending are all asserted as not-cut-off in `test-parser.js`.
- Project memory is now a real command instead of a prompt-writing exercise. `feather_memory` reads, appends and rewrites `ServerStorage.FeatherScript.Memory` directly: it creates the `FeatherScript` folder and the script on first write, stores everything as Luau comments so a memory update can never break a script, and **needs no exact-match edit**. The old path asked the model to `multi_edit` the memory blob, which requires an `old_string` matching the existing source character for character — the live place showed exactly what that produces: a 3,441-character memory whose only updates were three hand-pended `-- UPDATE:` notes, and none of the section edits the prompt asks for. Verified against the connected Studio: the append program creates the script, comments every line, and the result compiles.
- Corrected the memory instructions that were wrong about their own tools. The prompt told the model to create the memory as a `ModuleScript` with `multi_edit` "which auto-creates the FeatherScript folder", and to read it with `script_read game.ServerStorage.FeatherScript.Memory` — `script_read` takes `target_file`, not a bare path, and the memory in the user's place is a plain `Script`. Both the PROJECT MEMORY section and the periodic reminder now name `feather_memory` and its parameters.
- Restored the two brand PNGs (`featherscript-extension/assets/feather-mark.png`, `featherscript-app/assets/icon.png`) that were re-encoded to 27.5KB during the size pass. They are byte-identical to the originals again (md5 `09a9ea96…`, 265,289 bytes, 1280×1280). The size pass was not worth altering shipped artwork, and the extension's own brand tile is CSS-only, so nothing visual depended on them.
- Tool inventory: 46 Roblox/skill entry points (67 advertised in total). `docs/TOOL_REFERENCE_2.0.1.md` lists `feather_memory`; regressions cover its argument validation, its Lua-literal escaping (a payload containing `");workspace:ClearAllChildren();--` stays data) and the new cut-off behaviour in both the parser and the response watcher.

## Repository cleanup — 2026-11-04

- The diagnostic breadcrumb log no longer costs real work on every event. Each of the ~170 `diag()` call sites used to run two provider DOM scans for a turn snapshot and re-serialise a 300-entry ring buffer into a hidden DOM node — and nothing in the product ever read it. A breadcrumb is now one console line; the old snapshot comes back by setting `window.__zsDiag.detail = true` before a debugging session.
- Removed the permanent main-thread stall detector. It was a 250ms interval running in every provider tab, forever, whose only output went into that unread buffer.
- A send timeout now names the thing it waited for. A 10-second wait for AI Studio's or Genspark's send button used to be reported as "Timed out waiting for the chat composer", which sent the user hunting the wrong element while the composer was fine.
- The regression runner discovers every `test-*.js` at the app and extension roots instead of two hand-maintained lists. This found a real gap: `featherscript-app/test-theme-motion.js` had been passing on disk without `npm test` ever running it.
- Dropped 65KB of duplicate, unreferenced artwork from the extension folder (`icon.png`, `assets/feather-glyph.png`). The floating feathers in the overlay mask an inline data URL, and the byte-identical glyph still ships in the desktop app.
- Deleted the dead popup toast (function, CSS and markup) and Qwen's per-node trace counter, which ran on every DOM text read. Corrected comments that pointed at things that no longer exist: `content.js`, `code.snapAll`, and `_tools/build-themes.cjs` (the generator is `scripts/build-themes.cjs`).
- New regression: the 16 base `pc_*` tool names are asserted identical between `computer_tools.py` and the desktop permission broker in `featherscript-app/computer-access.js`. Both hand-list them, so a rename on one side used to silently change which tools the broker will accept.
- Documentation drift fixed: `docs/README.md` now indexes the audio, tool-reference and local-update reports; the stale "all 270 tools" and "21 themes" claims were replaced with the verified inventory (45 Roblox/skill tools + 21 PC tools, 130 workflows, 41 palettes). Cleared generated `__pycache__` and scratch harnesses out of the tree.

## Extension polish — 2026-11-03

- Replaced the script-profile dropdown with one themed two-button RobloxScript/AgentScript selector. Removed stale duplicate controls and guarded repeated mounting; selection remains persisted and applies to the next task.
- Added original bundled ambient music with a single offscreen player, Play/Pause and volume controls in the popup and dashboard, plus a music shortcut in the chat controller. Playback continues after closing the popup; sound-effect mute is synchronized across extension surfaces.
- Fixed mixed Notion transcript discovery so an anchored user turn no longer hides a block-root assistant acknowledgement during startup.
- Separated bridge/tool availability from agent readiness and rejected incomplete or unexpected startup handshakes. Added targeted regressions and native Chromium layout/media checks.
- Removed the RS|AS pill from the chat bar. It reported the same two things as the status line and the RobloxScript/AgentScript buttons beside it, so the connectivity chip now describes the bridge/Studio side only and the buttons are the single way to pick a target.
- The bar's music button now shows a slashed note while paused; playing keeps the plain note in the accent colour. Unicode has no slashed-note glyph, so the strike is drawn in the button's own colour and follows every theme.
- Added Genspark AI Chat (`www.genspark.ai/agents?type=ai_chat`) as a supported provider: role-tagged turn reading, caret-based streaming detection, conversation identity taken from the `bot_id` in the URL, and a hard stop when Genspark's sign-in dialog covers the composer - the bar now says "sign-in dialog, so nothing was sent" instead of typing into a wall and failing unexplained. Genspark's turn and streaming class names were read out of the site's own compiled CSS because a signed-out visitor renders no transcript at all, so they still need one live pass with a signed-in account.
- Fixed Start announcing the agent as ready before Roblox Studio was actually attached. StudioMCP advertises its whole tool catalogue with no Studio connected, so Start's only readiness check ("did the bridge give us tools?") passed instantly and the model dutifully replied "ready" - then the first command waited out the real attach (live log 23:11:35 "34 Roblox tools loaded, but NO Roblox Studio is connected yet" → 23:11:56 "Roblox Studio connected"). Start now waits for the attach where the user can see it, inside "Starting Up", with a countdown in the bar, and stops with the Studio step that actually fixes it if it never lands. An already-attached Studio adds no round trip at all, so Start stays instant, and AgentScript sessions and the deliberate "Start agent · Roblox offline" choice are never blocked by it.
- Cut the ~10s tail between the model's last token and the bar leaving "Starting…". The reply watcher's 9s "generating flag stuck" window exists to keep a half-written command from being parsed mid-write, but it was applied to every reply - so a complete sentence like "I'm ready to help with your Roblox Studio project." sat finalising while the site's stop control lingered (measured in the fixture: 9.72s). A reply that carries no command at all now finalises on the provider's own idle window, floored at 1.5s (2.2s end to end), while anything with a command block - open or signed - keeps the full window so big `execute_luau` writes are still never truncated. A prose answer that keeps growing is still read to the end. *(Bound on 2026-11-04: applied to every command-free reply, it cut long streamed answers off mid-write - the fast window now covers short replies only.)*

## Local updates — 2026-11-03

- Test Blender verifies a real CPU-rendered PNG, version and scene response in a disposable scene.
- Blender startup failures, broken pipes, malformed replies and worker crashes now retain clear errors and clean up without replaying uncertain commands.
- Added Windows cancellation fallback, strict diagnostic validation and regressions for worker failure paths.
- Release packaging excludes temporary test directories. The regression runner includes prompt, context preparation, provider recovery and tool-group checks.

## [2.0.1] - 2026-11-01

### Test release
- Added DEFAULT / FLASH / ULTRA effort policies, relevant skill loading, immutable task snapshots, native capability reporting and local measurements.
- Added the persistent Cowork prompt queue with per-task overrides, cross-tab dispatch locking, Stop/Pause and paused reload recovery.
- Added command IDs, receipt acknowledgements, bounded duplicate journals, status recovery and safe same-process reconnect behavior.
- Removed blind replay of written-but-unanswered MCP operations; late cancellation results remain separate from cancelled state.
- Hardened false context-limit detection, stuck generation waits, bootstrap failure reporting, end markers and tool timer cleanup.
- Fixed "Internal loop error" when a tool result was injected while the site was still streaming: the loop now waits out the provider's Stop control before typing, reports a send that never reached the site as such, and Arena names verification/rate-limit/dialog blockers and recognizes role="button" send controls.
- Fixed "Internal loop error — Cannot set properties of null (setting 'title')" on DeepSeek: the workflow panel re-creates its script-profile control when a host re-render strips it, panel/status/position updates tolerate missing nodes, and errors of this kind are reported as "The page changed mid-task" with a retry hint.
- DeepSeek send/Stop is now scoped to the composer instead of the first `.ds-button--primary` on the page, so a sidebar or modal button (its square "New chat" icon included) can no longer fake "still generating", absorb the Stop click, or be clicked instead of Send.
- DeepSeek rate-limit, verification and context-limit notices are detected even when the site shows them in a `position: fixed` toast, the composer is preferred over an inline "edit message" box, and a failing image-paste fallback no longer aborts the attachment.
- Fixed DeepSeek's "Messages too frequent. Try again later." limit note, which the site renders as an assistant turn, being read as a broken command: it used to consume the whole retry budget and stop with "The reply kept failing to parse", blaming the model for a limit the site imposed. The loop now recognises a short site notice as rate-limiting, says so in the banner and stops on the first one instead of re-sending; the notice is matched in English, French, German and Chinese, and the model's own prose that merely mentions trying again is still an ordinary reply.
- Fixed Studio-side failures being handed to the model as if its command were wrong. When Roblox Studio's Assistant plugin is mid-reload (normal around a Play/Stop transition) its MCP dispatcher answers with a raw module path - `sabuiltin_Assistant.rbxm.Assistant.Packages._Index.AssistantUI.AssistantUI.Tools` - and the model retried call after call into it (three red chips seen live 2026-11-03). The bridge now detects that signature, retries once after a short wait because the tool never started, and otherwise reports it as "Studio's Assistant tool module was not loaded" with what clears it. The same treatment covers "Edit datamodel is not available in Play mode", which used to be reshaped into "fix the call and retry": both are now labelled as Studio's own state, the model is told not to retry, and a throttled banner says what to do in Studio.
- Restored viewport-bound scrolling in all layouts and verified real wheel input on long pages.
- Added native Windows acrylic with transparent renderer surfaces and an opaque fallback on unsupported systems.
- Refined the default sidebar and overview with softer cards, readable labels and a Guides shortcut.
- Refined Studio navigation and spacing; added a shared blurred backdrop across all layouts and pages.
- Added cancellable layout transitions, reduced-motion fallbacks and accessible compact navigation labels.
- Added nine searchable offline setup guides with direct navigation to the relevant app pages.
- Added Blender executable browsing and a real background startup diagnostic from MCPs.
- Added an explicit Blender worker startup handshake and version reporting; corrected MCP process/pipe cleanup on shutdown.
- Moved Blender UI into its own controller and removed superseded Studio style rules.
- Added optional Default / Studio / Canvas layouts, saved per profile independently of palette and backgrounds.
- Added compact theme search, click-animation cleanup and clearer sound/motion previews.
- Added confirmed local profile removal with last-profile protection.
- Added nine optional computer tools with desktop-owned pairing, trusted folders and three permission modes; disabled by default.
- Added Google AI Studio injection and resilient composer handling.
- Added local profiles with migration of existing memory, notes and appearance.
- Added 39 themes, themed extension settings and a supported-AI launchpad.
- Added Obsidian vault read/search tools and optional note editing.
- Added optional community Blender MCP configuration; removed the experimental embedded editor.
- Added Freebuff website shortcuts, MiMo Chat/UltraSpeed launch modes and connection refresh.
- Fixed MiMo repeated stream chunks, split CRLF/UTF-8 parsing, duplicate Request retries, abort handling and premature completion during pauses.
- Split renderer features into modules, removed obsolete UI styles and deferred hidden command-list rendering.
- Added release metadata/manifest/provider checks and a repeatable regression runner.

## [2.0.0] - 2026-11-01

### Added
- **The bar now shows whether the agent is actually working.** A small
  circular brain badge sits between the status dot and the status text: green
  with a slow sweeping arc while the agent loop is live (starting, sending,
  running a tool, stopping), red when it is idle. It is driven by the loop's
  own state rather than by a timer, with a 1.5s hold so a fast tool round-trip
  does not flicker, and it shrinks with the bar's minimized pill. Verified by
  driving the real extension in headless Chrome against a fake Arena chat
  (idle → green on the Start click → red after the loop ends, with the
  accessible label following). Live signed-in sites were not exercised.

- **Tool and command chips now follow FeatherScript's look.** Chips on every
  provider moved from the generic dark card to the same parchment/ink identity
  as the bar: a 20px ink icon tile, a gold rail along the top, a warm running
  shimmer, green "done" and red "error" treatments, and a light-mode variant
  that matches a light host page. Verified on dark and light fake pages with
  every chip state visible at once; live providers were not re-checked
  visually.

- **Vani Chat and Notion AI are new providers.** FeatherScript now works on
  `c.vani.ai/chat` (next to DeepSeek, ChatGPT, Gemini, Kimi, GLM, Qwen, Arena
  and Meta AI) and on the Notion AI chat at `notion.so/chat`. Vani gets a
  network tap that also restates the command protocol on the outgoing message;
  Notion's adapter only ever runs inside the AI chat view, never on normal
  pages, and keeps its chips outside Notion's locked reply editor. Both are new
  and have not yet been exercised against the live sites end-to-end.

- **MiMo AI (Xiaomi MiMo Studio) is a new provider.** FeatherScript now works on
  `aistudio.xiaomimimo.com` in both **UltraSpeed** (`#/ultra`) and **MiMo Chat**
  (`#/c`), next to the other providers. A main-world tap pins the command
  protocol to every outgoing query and folds the SSE reply (including `<think>`
  and `reasoningContent`) so a re-rendered code block cannot corrupt a command.
  MiMo needs a Xiaomi account: signed-out chats and **MiMo Claw** (`#/claw`) are
  detected and Start is blocked with an explanation. The DOM and request
  contract were validated live and in the site's bundles, but authenticated
  send/stream was not exercised end-to-end in this build (sending while signed
  out redirects to account.xiaomi.com).

### Fixed
- **A fresh install gets its app window again.** Electron 45 removed its own
  `postinstall` script, so the first-run `npm install` only unpacked the JS
  wrapper and never downloaded the runtime; the app's fallback,
  `npm rebuild electron`, is a no-op for the same reason - so `app.bat` ended at
  "the Electron runtime could not be downloaded" and the app could not start.
  The app now has its own postinstall (`scripts/install-electron.js`) that runs
  Electron's installer, and `app.bat` runs it directly when the runtime is still
  missing, then falls back to `npm rebuild`. A failed download now names the
  real causes (connection, `HTTPS_PROXY`, antivirus) and the exact command to
  retry instead of a dead end. Verified on Windows: a fresh `npm install` in a
  clean folder downloads the runtime and `electron.exe --version` answers
  v45.2.1; the same script repairs an install that already had `node_modules`
  but no `dist`; an installer that exits non-zero and a missing electron package
  both produce the new error messages. macOS's launcher starts only the bridge,
  so it is unaffected.

- **The whole skills library now loads.** `feather_getskills` used to stop at a
  200,000-character reply budget and quietly drop everything after it (a large
  library ended with "193 file(s) were omitted because this reply reached its
  size budget"), so skills further down the alphabet were invisible to the
  model. It now returns the library in numbered parts - "PART 1 of N", with the
  exact call that fetches the next part at the end of each one - and every
  readable file is delivered in full (individual files used to be cut at 20,000
  characters too). The system prompt's skill index now also says how many
  installed skills it does not list (it shows 40) and points the model at the
  full library, and the tool description and site rules tell the model to read
  every part before deciding that no skill applies. Verified against the
  69-skill / 2.5M-character local library through the real bridge over
  WebSocket: 14 parts, every file present exactly once and complete, parts
  deterministic across calls, single-skill paging, out-of-range clamping and
  unknown-folder errors all pass. A live model turn paging through every part
  was not exercised.

- **Bridge offline on a fresh PC: the app now actually installs the Python
  library.** First launch needs `websockets`. The app only auto-installed it
  when it saw Python's `No module named 'websockets'` text, but `bridge.py`
  catches that error and prints its own `[bridge] Missing dependency` line - so
  the install step never ran, the bridge exited immediately, and the window
  showed "bridge offline" forever. The app now recognises its own message,
  tries `pip --user`, a plain `pip`, and (on macOS/Linux) the PEP 668 override,
  verifies the import before relaunching, and if it still fails shows the exact
  command to run instead of a dead end. It also now requires Python 3.9+ (a
  `python` that answered `--version` but was 2.7 or 3.7 used to be accepted and
  crash the bridge), and finds `python3`/Homebrew Pythons on macOS.

- **A read-only install folder no longer kills the bridge at startup.** The
  `logs` folder was created unguarded, so a copy in Program Files or a locked
  sync folder died with a traceback before it could print anything. It now
  falls back to a temp logs folder so the bridge still runs.

- **Offline messages point at the launcher that actually exists.** The panel,
  dashboard and setup card still said "run start.bat", which stopped shipping
  when the desktop app replaced it - users followed the instruction and found
  no such file. They now say "start the FeatherScript app" and name `app.bat`
  (Windows) / `MacOS_Start.command` (macOS).

- **MiMo AI: its built-in web search can no longer switch itself back on.**
  The tap only forced off `webSearchMode`/`webSearchStatus`, but MiMo renames
  and relocates that toggle between generations, so a renamed key left search
  enabled and the model answered from the web instead of running FeatherScript
  skills. Every search and deep-research toggle in the outgoing request is now
  turned off wherever it sits (numbers to 0, booleans to false; strings and the
  rest of the body are never rewritten), and the site rules now say skills are
  read with `feather_getskills`, never found by searching. Checked against the
  request shapes the live bundle builds for `bot/chat` and `react/chat` plus
  synthetic v2/v2.6 payloads: 19/19 checks pass. An authenticated MiMo v2.6 Pro
  turn was not exercised end-to-end in this build.

- **Arena: a reply that only says "Generating…" no longer stalls the agent.**
  Arena mounts the reply card empty and shows its own faint "Generating…"
  status above it; that status was not counted as activity, so a slow start
  looked like a dead turn and the loop could sit there until the response
  timeout. The status now counts as work (the turn stays open while it is
  shown), and a request that shows it with no text for 60s is treated as
  wedged: the adapter clicks Stop, the core ends that turn instead of waiting
  out the full warm-up, and the loop nudges once - no manual refresh. Verified
  against a fake Arena page (generation label recognised, near-miss and
  user-turn labels ignored, stall watchdog fires and stops the request, warm-up
  short-circuits): 11/11 checks pass, and the pre-fix build reproduces the
  stall. Live signed-in Arena was not exercised end-to-end.

- **Vani Chat and MiMo AI: tool results are actually sent.** The run locks the
  composer by flipping `contenteditable="false"`, and a locked editor swallows
  the injected text and the send click, so the loop sat on the previous reply
  until the response timeout. Both adapters now unlock for the injection and
  restore the lock afterwards, like the ChatGPT/Gemini/Kimi/Notion adapters.
  The live sites use a plain `<textarea>`, where `readonly` does not block the
  native value setter, so this branch is a code-level fix rather than a
  live-validated one.

- **A new chat no longer inherits an old "Agent active" bar (Vani, MiMo,
  Notion).** These three returned their *fresh-chat* URL (`/chat`, `#/ultra`,
  `/ai`) as the conversation key, so it was persisted as a started session and
  a brand-new empty chat showed "Agent active" with no Start button. The key is
  now the conversation id only - empty until the site assigns one.

- **Notion AI: the composer's placeholder returns after a run.** The textarea
  branch of the input lock replaced the hint with "Agent working…" and never
  restored it. The site's own placeholder is now saved and put back on unlock,
  as Arena/GLM/DeepSeek/Qwen/Vani/MiMo already did.

- **Vani Chat and MiMo AI now show the FeatherScript bar.** Both providers write
  a diagnostic line while initialising, and that line ran before the script's
  agent state existed; the resulting startup error aborted the whole content
  script on those two sites, so no bar ever appeared. Initialisation now runs
  after the state it reports on (validated live on both sites with the built
  extension).

- **Notion AI: tool results are actually sent.** The agent locks the composer
  for the whole run, but Notion's block editor ignores text inserted into a
  non-editable root - the injected result was never typed, the send control
  stayed disabled and the run sat on the old reply until the response timeout.
  The adapter now makes the composer editable for the injection and restores
  the lock afterwards, like the ChatGPT/Gemini/Kimi adapters. This path was not
  exercised against a live signed-in Notion chat (the AI composer requires an
  account); it is a code-level fix.

- **MiMo AI: commands stop turning into web searches.** MiMo runs web search as
  a server-side tool configured on each turn's request, and several models kept
  firing search calls - burning turns, and the skill lookup - even with the
  protocol note pinned to the query. While the agent is linked the tap now
  forces that turn's search off (`modelConfig.webSearchStatus` or
  `webSearchMode` = 0, whichever the request carries), so the model writes the
  command block instead. Verified live that the outgoing request is rewritten
  (search 0, protocol pinned) and that a non-agent chat is untouched; the
  signed-in model behaviour itself needs a signed-in check.

- **Vani Chat: Start works on the empty guest chat.** On the blank chat at
  `c.vani.ai/c`, the guest allowance strip above the box ("100% of your free
  allowance left … Create a free account") was mistaken for transcript turns,
  so the bar reported "No agent here" and Start was refused with "Open a new,
  empty conversation". The strip is no longer counted as a turn: the bar now
  shows Standby with a working Start Agent button (validated live on the empty
  chat).

- **MiMo AI: tool results are no longer "not accepted after 4 attempts".**
  MiMo's send control is one shared button that turns into Stop while a run is
  live, and its `submit()` silently refuses the injected message (a toast and
  the draft stays) while it still holds the previous run. The adapter treated
  the live Stop control as proof of a successful send, so all four attempts
  bounced and the run dead-ended with "MiMo did not accept the injected
  message". It now waits for MiMo's own *Send* control before clicking, lets a
  slow reply finish, unwedges a Stop control that outlives a settled reply
  (without the core reading that click as your Stop), recognises the
  "sending a message now" refusal and retries once after it clears, waits for
  pending screenshot uploads, and no longer re-presses Enter while MiMo is
  still clearing the composer. MiMo's informational "content automatically
  truncated" toast is also no longer mistaken for a context limit. Verified
  against a simulated composer that follows MiMo's bundle contract; the
  authenticated live send path is still not exercised in this build.

- **A brand-new chat no longer says "Agent active" (Notion AI, and any site
  that reuses the last thread's id).** Notion's New chat can open a blank chat
  under the *same* thread URL, so the conversation key was already remembered
  as started and the bar stayed on "Agent active · N tools" with no Start
  button. An empty chat is now never treated as a session: the adapter ignores
  transcript turns left mounted-but-hidden from the chat the user just left,
  and once a chat is confirmed empty the core drops the remembered key for it
  (so the first message in the new chat doesn't re-activate the bar either).
  Verified by driving the real extension in headless Chrome against a
  Notion-shaped /chat page: the previous build reproduces "Agent active · 73
  tools" on the blank chat, this build shows Standby. The live signed-in Notion
  UI was not exercised end-to-end.

- **Notion AI: raw command blocks stay hidden.** Notion runs one block per line,
  so a `###LUA### … ###END_LUA###` command could span several blocks; only the
  block holding the opening marker was masked, leaving the script (and the
  bordered code card) on screen. Masking now covers the whole fence run and the
  card that wrapped it, and reply prose above and below is left alone. Notion
  also re-creates blocks (stripping the hide class) on scroll and re-render, and
  the core's "raw command visible again" check only watched `p`/`pre`/`code`
  nodes - so once stripped, the command stayed visible for the rest of the turn.
  That check now covers `[data-block-id]`, which makes the sweep re-apply the
  mask. Verified in headless Chrome against Notion-shaped pages (per-line fence,
  single-block fence, prose kept, mask restored after a re-render): the previous
  build leaves the code body on screen, this build hides it. The live signed-in
  Notion UI was not exercised end-to-end.

## [1.5.5] - 2026-09-10

### Fixed
- **Qwen: a failed chat request no longer logs an unhandled rejection.** The
  network tap consumed every `/chat/completions` response without a rejection
  handler; a locked or missing body now resolves quietly, and the DOM signals
  still drive the turn.

- **DeepSeek: the agent starts again on DeepSeek's new unified model.**
  DeepSeek merged Instant, Expert and Vision into a single model and removed
  the model picker from the chat box. ZeroScript waited for one of those tabs
  to be selected before starting, so "Start Roblox agent" stopped with
  "DeepSeek mode not ready". A chat box with no model picker is now recognised
  as the unified model: ZeroScript switches Search off as before, leaves
  DeepThink on, and starts.

- **DeepSeek: screenshots work on every chat.** Images used to need the Vision
  tab, which no longer exists, so `screen_capture` was refused. The unified
  model reads images, and ZeroScript now sends them - one capture or several
  in a row. Older conversations still marked Instant or Expert stay text-only.

- **A dropped reply no longer ends the run.** DeepSeek occasionally renders a
  turn with no text at all; the run stopped there with "returned an empty
  reply" and nothing ran. ZeroScript now asks it to continue (the site's own
  Continue button when it is there, otherwise a short "continue the task"
  message) and picks the run back up. A stop you pressed yourself still ends it.

- **Skills are checked on every request.** The startup instructions now name
  every installed skill and tell the assistant to read and follow each skill
  that fits the request - not just when you mention skills by name - and the
  reminders repeat it through a session.

## [1.5.4] - 2026-09-06

### Fixed
- **ChatGPT: the ZeroScript bar is back where it belongs, above the composer.**
  ChatGPT redesigned its input box and renamed the layout slots it is built
  from: the full-width row across the top used to be called `header` and is now
  called `eyebrow`. ZeroScript still asked for `header`, a name that no longer
  exists, so the browser invented a place for the bar instead - it landed in a
  stray strip at the bottom right of the composer, and the text field itself was
  squeezed to zero width in the process. The bar now claims the correct row, and
  it also reads the layout live rather than trusting a fixed name, so the next
  time ChatGPT renames its slots the bar will follow instead of breaking.

### Changed
- **ChatGPT: replies are read straight from the page again.** The same redesign
  replaced the code-block editor that used to render each line separately and
  cut long lines off around 2000 characters - the cause of the truncated
  commands fixed in 1.5.1. Code blocks are now plain text with real line breaks,
  and a 400-line block reads back whole. The workaround stays in place for
  anyone still on the old interface.

## [1.5.3] - 2026-08-22

### Changed
- **Kimi moved to kimi.ai.** Kimi's old address, `kimi.com`, now asks for a
  Chinese phone number to sign in, which locked most people out. Kimi runs on
  `kimi.ai` from now on - the extension only activates there. The page itself is
  unchanged, so nothing about using Kimi with ZeroScript is different: open
  https://www.kimi.ai, the bar appears above the input box as before. If you had
  Kimi tabs open on the old address, reopen them on the new one.
- **DeepSeek: the Instant model is now allowed to run the agent.** Starting a
  session forced the Expert tab and, worse, the readiness gate only ever accepted
  Expert or Vision - so picking Instant left "Start Roblox agent" spinning
  forever with no explanation. Instant is now respected like Vision: pick it
  before starting and the session runs on it. It is much faster than Expert, at
  the cost of the reasoning pass. Images stay disabled on Instant exactly as they
  are on Expert - the Vision tab is still the only one that can see screenshots,
  so `screen_capture` is not offered to the model on the other two.

### Fixed
- **DeepSeek: a reply written in DeepSeek's own tool-call markup no longer kills
  the turn.** DeepSeek sometimes answers with its internal DSML invoke tags
  instead of a ZeroScript command. That format carries none of the markers
  ZeroScript looks for, so nothing recognised it as a command attempt: the tool
  never ran, the raw tags were left on screen, and the agent silently stopped
  with the user waiting on a dead turn. It is now detected, the markup is hidden
  behind a tool chip like any other command, and DeepSeek is told the format is
  unreadable so it rewrites the call properly. The chip shows the usual spinner
  while the model is still writing, then settles red as "wrong format".
- **ChatGPT: the ZeroScript bar no longer collides with the composer's rounded
  corners.** The composer card is rounded by 28px and the bar sits flush against
  its top edge, so the Discord button's corner fell outside the rounded shape and
  was sliced off by the card. Both ends of the bar are inset to clear the curve.

## [1.5.2] - 2026-08-14

### Added
- **ChatGPT: the operating instructions are now re-stated periodically.** ChatGPT
  summarises its own context mid-session, and the part it drops first is the
  *mechanism* - that an extension reads its replies and really runs them. It
  would then answer "I can't invoke those commands in this session" while the
  extension sat there, ready. The full instructions are now re-sent
  automatically, riding along on a tool result so they cost no extra message and
  stay hidden from you (they appear as a "Reminder" chip). A tool result is
  never shortened to make room: if the pair would not fit, the reminder simply
  waits for the next one. ChatGPT only - no other provider needs it.
- **ChatGPT: an image you send is now treated as reference material.** Unless you
  explicitly ask for a picture, ChatGPT used to answer a screenshot or a mockup
  by *generating a new image* instead of doing the work it was meant to
  illustrate - and its image tool cannot reach your place anyway.

### Fixed
- **ChatGPT: you can chat normally again without starting an agent.** On a blank
  ChatGPT tab the extension refused to let a message send until you clicked
  "Start Roblox agent". Every other provider only suggests it; ChatGPT was the
  odd one out.
- **A finished command is no longer stranded as "not run".** After a long reply
  (seen on Qwen writing for 400s and more) the loop could give up while the model
  was still going; eight seconds later the completed command was written off for
  good. That window is now three minutes, so the command actually runs.
- **A clear message when ZeroScript is updated while a tab is open.** Chrome
  updates extensions underneath open tabs, which leaves the page running a
  version that no longer exists. ZeroScript reported this as "the bridge stopped
  on your PC - run start.bat", sending you to fix something that was never
  broken. It now says plainly that the page needs reloading, and offers a Reload
  button - your bridge and Studio are untouched.
- **The AI no longer claims your bridge is offline without checking.** After one
  momentary outage it would keep repeating "Roblox is offline" from memory, even
  once everything was back. It must now actually run a command before saying so.

## [1.5.1] - 2026-08-13

### Added
- **ChatGPT support (chatgpt.com).** ZeroScript now runs on ChatGPT as an
  eighth provider. Image input is deliberately disabled there: ChatGPT's free
  tier caps files/images on a separate quota from messages, so vision would
  work only part of the day. Reasoning mode ("Analyser") and the model picker
  are left entirely to you.

### Fixed
- **Meta AI: fixed large commands failing with "bad JSON".** Meta renders a
  ```json block as an interactive viewer whose default *Tree* view does not
  merely decorate the JSON - it **abridges** it: a large array or object is
  replaced by a summary placeholder. A 19103-character `multi_edit` was present
  in the page as 223 characters ending in `"edits":[1 item]`, so ZeroScript sent
  the parser a truncated object and the command came back as a parse error every
  time. This is also why the tool chip's token counter climbed while the reply
  streamed and then **collapsed to about 44 tokens** the moment the block
  finished rendering - the counter was faithfully reporting what could be read.
  Command blocks are now switched to the viewer's *Raw* tab, which holds the
  verbatim source; the 19103-character payload is read whole.
- **Clearer diagnosis when Roblox refuses to parse Luau.** "Failed to parse
  command code" is Studio's generic parse rejection, but ZeroScript always
  answered it with "your code block was empty or the marker was wrong". When a
  full code string *had* been sent, that advice pointed the model at a problem
  that did not exist, so it re-sent the same payload and failed again. The hint
  now only mentions the `###LUA###` markers when the code really was empty, and
  otherwise reports how many characters were sent and names the real causes -
  invalid syntax, or code too large/complex for the parser. (Measured live: a
  `return 1+1+1+…` chain ran at 1006 characters and was rejected at 2006.)
- **ChatGPT: fixed most tool calls failing outright.** ChatGPT renders code
  blocks with CodeMirror, which puts one element per line and **no newline
  characters at all** in the page. Reading a reply the usual way therefore
  returned the whole script glued onto a single line, so a perfectly valid
  command came back as "Failed to parse command code / your code block was
  empty", and the calls that did run reported every Luau error on line 1.
  Replies are now read with the line structure preserved.
- **ChatGPT: fixed long commands being executed truncated.** Beyond roughly
  2000-4000 characters, CodeMirror only renders *part* of a long line and the
  rendered text then stays frozen while the model keeps writing - the tool
  chip's token counter would climb, drop back to about 500 tokens, freeze
  there, and the command would run cut off. Measured live: a 21273-character
  command of which the page exposed 4049. ZeroScript now reads the editor's
  real document instead of the rendered page, through a new MAIN-world tap
  (`providers/chatgpt-cm.js`), the same approach already used for Qwen's
  Monaco editor. A 5.3k-token `multi_edit` now applies whole.
- **ChatGPT: fixed the raw command staying visible.** When the model writes a
  command without wrapping it in a code fence, ChatGPT splits it into dozens of
  sibling paragraphs (68 of them for a 208-line script) and only the first one
  carried the marker, so the rest of the script stayed on screen. The whole
  marker-to-marker range is now hidden, including while it streams.
- **Fixed the agent dying silently when the model called a tool the
  function-calling way.** A reply like
  `{"toolName": "get_studio_state", "studio_id": "…"}` names a real tool but
  uses the wrong key, so nothing recognised it as a command: the turn was
  finalised as a plain-text answer and the loop simply ended, leaving the agent
  looking frozen (seen on ChatGPT in a long session). ZeroScript now spots a
  known tool named under `toolName` / `tool` / `name` / `function` / `action`
  and asks the model to rewrite it with the proper envelope, exactly as it
  already did for a missing `###LUA###` opener or bare parameters. Prose that
  merely mentions a tool name is not affected - the check requires a tool that
  is really in the catalogue.
- **Fixed the "Agent is working…" cover hanging past the composer on the first
  send.** Injecting the system prompt grows the composer, the page gains a
  scrollbar and the content column narrows, so the composer slides sideways -
  and a site that animates that move updates its layout after the cover has
  already been placed, leaving it a frame behind (28px past the card's right
  edge on ChatGPT). The cover is now clamped to the composer card, so a stale
  measurement can never be seen. Only the first send was affected, because the
  composer stops moving once it is docked at the bottom.

## [1.5.0] - 2026-07-30

### Fixed
- **Backgrounding the AI tab no longer strands a pending command as a grey
  "not run".** `waitForResponse` now parks entirely while the tab is hidden and
  shifts every internal deadline (inactivity timeout, warm-up, text-stability,
  etc.) forward by the parked duration, instead of letting them keep ticking
  off-screen. `waitVisible` switched from polling to listening for
  `visibilitychange` - Chrome clamps chained background timers to one tick per
  minute after 5 minutes hidden, which used to delay the resume by up to a
  minute. The bar now shows a **Paused** state while parked, and a genuinely
  empty reply from the site now shows a banner instead of ending the loop
  silently.
- **Gemini: fixed the page freezing (nothing clickable) on a large tool
  result.** Gemini's composer inserts text line by line, synchronously, on the
  main thread - a 2599-line `http_get` result froze the page for about a
  minute. Outgoing text is now capped (120k chars / 1200 lines, head and tail
  kept) and the insert yields to the browser every 120 lines.
- **Gemini: fixed the system prompt occasionally never leaving the composer on
  Start.** The wedged-stop-button detector latches for 2 seconds from the
  first time it sees a stop button, so the single recovery attempt at boot -
  the very first sighting - was refused by its own guard. It now retries
  across that window and retypes as a last resort.
- **Kimi: fixed the model picker opening and closing in a loop.** Kimi's K3
  update removed the model (K2.6) the default-model routine used to select,
  so it kept hunting for a row that no longer exists. It now only acts when
  the current model is **K3 Swarm** (matched by name, any UI language) and
  gives up after a few tries instead of looping. The native-agent warning
  guard was equally broken by the same update and now reads the model label
  at its new location.
- **Degraded mode (Roblox Studio closed, running on an addon server only)
  starts much faster.** The tool catalogue request blocks until timeout when
  Roblox is down, and the boot sequence called it three times in a row. Added
  a 30s cache on the catalogue and cut the request timeout from 25s to 10s.

## [1.4.9] - 2026-07-24

### Added
- **Popup: new Settings button.** Opens the same Switch AI / support panel
  as the in-page bar, without needing an already-started conversation. The
  footer text no longer singles out chat.deepseek.com - it now points to
  "a supported AI" since seven providers are supported.
- **Bridge: auto-recovers its own port on relaunch.** Relaunching `start.bat`
  while a previous Bridge was still holding port 17613 (window closed with
  the X, a crash, a double launch) used to crash with a cryptic, sometimes
  localized `OSError [WinError 10048]`. The Bridge now detects and kills a
  leftover Bridge process it can positively identify (by command line, never
  by process name alone) before binding, and falls through to a clear,
  actionable message - with the exact `netstat`/`taskkill` commands and the
  `ZS_BRIDGE_PORT` override - if the port is held by something else.

### Fixed
- **The agent could parse/execute commands while its AI tab was backgrounded
  or the window minimized.** Background tabs throttle rendering and timers,
  which made DOM reads unreliable and could send duplicate feedback or run a
  tool blind (observed live: GLM kept running `execute_luau` while minimized).
  The agent loop, the tool-dispatch step, and the auto-resume watchdog now
  all gate on `document.visibilityState` and park - with no time limit -
  until the AI tab is the foreground tab again, then resume exactly where
  they left off. Working with Roblox Studio focused while the AI tab stays
  the active tab in its own window is unaffected; this only pauses execution
  while that tab is truly backgrounded or its window minimized.

## [1.4.8] - 2026-07-22

### Added
- **macOS and Linux support for the Bridge.** A new self-contained
  `MacOS_Start.command` launcher (double-click in Finder - no Terminal
  knowledge needed) finds Python 3.9+, installs `websockets` if missing,
  frees a previous Bridge still holding the port, and runs `bridge.py`,
  mirroring what `start.bat` already does on Windows. `launch_studio_mcp.py`
  now also locates Roblox Studio's MCP binary inside the macOS app bundle
  (`RobloxStudio.app/Contents/MacOS/StudioMCP`), with a `ZS_STUDIO_MCP_PATH`
  override for non-standard installs.
- **DeepSeek: outgoing messages are now truncated to fit its input limit.**
  DeepSeek's composer silently refuses to send past 163840 characters
  (validated live), which could wedge the agent in the input box after a
  large tool result (a big `http_get` / `get_page_text` / Luau dump). Long
  results are now truncated to a safe margin below that limit, keeping both
  the start and the end of the content, the same approach already used for
  Qwen and Arena.

## [1.4.7] - 2026-07-21

### Fixed
- **Qwen: a tool could show a green "done" check while it never ran and returned
  no result** (seen rarely with repeated `multi_edit` / `execute_luau` calls, with
  no Stop or regenerate involved). Qwen virtualizes its message list, so the
  off-DOM "already executed" record was keyed on the positional turn index, and
  two turns that shared the same 60-character command prefix could collide on the
  same index. That false positive made the auto-resume watchdog skip the fresh
  command (so it never ran, no result was injected) while the chip was still
  painted a green check. The dedupe now keys on Qwen's stable per-turn id
  (`chat-response-message-<uuid>`, exposed as `itemKey`) instead of the index, so
  the collision cannot happen.
- **Qwen: the ZeroScript bar covered the "Expand more models" submenu.** That
  fly-out is a separate body-portalled `.ant-dropdown` at a low z-index, not the
  main model dropdown, so the bar drew on top of it. Raised just that dropdown
  above the bar (scoped so other Ant menus and tooltips are untouched).

### Added
- **Per-model image support on Qwen.** Qwen offers both multimodal and text-only
  models, switchable mid-conversation, and image input only works on the
  multimodal ones. `screen_capture` and image input are now enabled only on a
  vision-capable model (Qwen3.7-Plus, Qwen3.6-Plus, Qwen3.6-27B, Qwen3.8-Max-Preview)
  and correctly withheld on a text-only one (Qwen3.7-Max, Qwen3.6-Max-Preview),
  read from the selected model and updated when you switch models.
- **Image support on DeepSeek's Vision model.** DeepSeek forces its Expert model
  for the agent, but if you choose the Vision tab that choice is now respected and
  `screen_capture` plus image input are enabled for it. Selecting Vision is
  detected reliably, including after switching conversations. Image attachment was
  also fixed: it used to stage the same image multiple times and never send,
  because the upload went through a paste that only made a local preview and never
  uploaded the file. It now uses DeepSeek's real file upload and sends once the
  upload completes.

## [1.4.6] - 2026-07-19

### Fixed
- **Kimi's login and "priority queue" popups were covered by the ZeroScript
  bar**: both render as full-screen fixed masks (`.login-modal-mask` and
  `.modal-mask`) rather than a standard `[role="dialog"]`, so the generic
  overlay probe used by other providers never caught them. The anchored bar
  (a full-width fixed element hugging the composer) and the "unstable"
  warning pill sat on top of the mask and could intercept clicks meant for
  its buttons (e.g. "Continue with Google"). Added a Kimi-specific
  `overlayBlocking()` that detects both mask classes by real visibility; the
  core already hides the whole bar while it reports true, and restores it the
  instant the mask clears.

### Added
- **Kimi now defaults fresh chats to K2.6**: Kimi lands new chats on K3,
  which is flagged unstable here and easy to miss switching away from. A
  brand new or emptied chat now picks K2.6 automatically, once; a deliberate
  manual switch to K3 on that same chat is left alone.

## [1.4.5] - 2026-07-18

### Fixed
- **DeepSeek re-executed old tool commands when scrolling up in a long
  conversation**: DeepSeek virtualizes its message list, so scrolling up makes
  an OLD command turn the last *rendered* assistant turn - its injected result
  sits below the fold (unrendered), the in-memory "already executed" record is
  empty after a page reload, and the node change makes generation detection
  flicker true, refreshing the auto-resume watchdog's freshness clock. The
  watchdog then re-fired the historical tool. Three-layer fix (validated live):
  - The off-DOM executed/halted dedupe maps now key on a virtualization-stable
    per-turn id (`itemKey`, DeepSeek's `data-virtual-list-item-key`) instead of
    the positional assistant index, which collides across scroll windows.
  - The watchdog skips any command turn whose stable id is below the session's
    high-water mark (`A.maxTurnId`) - a scrolled-back old turn can never resume,
    even right after a reload (`resume.skipOld` in the diag ring).
  - The watchdog also skips a command turn whose injected result is rendered
    right below it (settled history), a provider-generic guard.
- **Gemini stranded a tool result in the composer ("Message could not be
  sent")**: after a generation ends, Gemini's action button can stay WEDGED on
  the stop icon instead of reverting to the send arrow. The loop's generation
  *detection* already tolerates this (WEDGE_MS), so the tool ran, but the *send*
  waited for an `arrow_upward` button that never appeared - four retries failed
  and the injected result sat unsent in the composer. `typeAndSend` now resets a
  frozen stop button (clicking it, guarded by the same not-actually-generating
  check) so the send button reappears, then sends (validated live). The native
  stop-click hook now ignores non-trusted (programmatic) clicks, so this
  un-wedge click is never mistaken for the user halting the agent - otherwise
  the next legitimate command was wrongly marked "stopped".

## [1.4.4] - 2026-07-16

### Fixed
- **Qwen fired tool commands mid-stream ("Bad JSON" while Qwen was still
  writing)**: Qwen's frontend update (fe 0.2.73) now emits `status:"finished"`
  in its SSE stream ~12s before the stream actually closes. The network tap
  treated that as the turn's end, so a still-incomplete command (e.g. an
  unclosed `###LUA###` block) was extracted and sent, and the loop's premature
  "unclosed" feedback was injected while the model kept writing. Fixed by no
  longer treating `status:"finished"` as done, and by having generation
  detection check the DOM stop button first (validated live: it now tracks the
  real stream end closely, unlike its old ~6s lag).

### Changed
- **Removed the "⚠ unstable" badge on Qwen's Auto/Think modes**: those modes
  used to make Qwen claim a tool "does not exist" without even trying it. The
  extension never force-switches Qwen's mode, so Auto (Qwen's own default) is
  left untouched.

## [1.4.3] - 2026-07-15

Adds a seventh AI provider (Meta AI) and fixes a Qwen tool-turn regression, plus
further Studio-port recovery hardening and a friendlier system prompt.

### Added
- **Meta AI (www.meta.ai) as a provider**: full ZeroScript support on Meta AI -
  new `providers/meta.js`, manifest content script + host permissions, and the
  provider switcher entry. Handles Meta's React DOM: reasoning ("Réflexion")
  chain-of-thought is excluded from the read text, the interactive JSON viewer
  and collapsible code blocks are masked so a streamed command never flashes, and
  the composer card is fully covered while typing. Meta AI accepts very large
  prompts, so no Qwen-style send cap is needed.

### Fixed
- **Qwen tool result took ~30s to inject on every tool turn**: Qwen dropped the
  assistant turn's own `id`, so `lastAssistantId()` returned null and the core
  fell back to the virtualized flat count, waiting the full ~30s NO_TURN_GRACE
  each turn. It now reads the stable `chat-response-message-<uuid>` descendant
  (with the old id kept as a fallback).
- **Qwen refused oversized messages**: a large tool result past Qwen's 131072
  character composer cap silently wedged the loop in the input box. Outgoing text
  is now truncated to a safe margin, keeping the head and tail and marking the gap
  so the model does not re-run the command.

### Changed
- **Friendlier, less restrictive system prompt**: the "do not use native tools"
  wording is reframed as a technical note (the site's own sandbox cannot reach the
  user's Studio) rather than a hard prohibition, with an explicit "you can act
  directly in the user's project" section. Reduces provider refusals.
- **Studio-port recovery hardening**: PID-based reclaim of leftover `StudioMCP`
  zombies and clearer, de-duplicated action banners on top of the 1.4.2 port
  hijack recovery.

## [1.4.2] - 2026-07-13

Follow-up robustness fixes for the Studio-connection failures the 1.4.1 work
did not cover: a rare "0 tools that survives every restart" deadlock, and a
third-party app silently hijacking Studio's MCP port.

### Fixed
- **A third-party app (e.g. ropilot) hijacking Studio's MCP port**: whichever
  program binds Studio's MCP port (13469) FIRST wins it, and if that is not
  Studio, `StudioMCP.exe` connects to the wrong host - the handshake succeeds
  but no tools ever appear. A PC reboot never helps because the offending app
  restarts with Windows and can grab the port before Studio again. The existing
  one-shot port check at boot could miss it. The bridge now detects the hijack
  from an unmistakable, timing-independent signal - `StudioMCP.exe` reporting it
  cannot parse the host's messages on that port - then kills the offending
  process (by port owner, with a fallback that kills the known squatter by
  name), restarts the proxy, and tells the user which app to uninstall or remove
  from Windows startup so it stops coming back. It never stays silent: if it
  cannot identify or kill the squatter it prints how to find it by hand.
- **`_port_owner` was IPv4-only**: the internal port-owner probe ran
  `netstat -p TCP`, so a squatter listening on IPv6 loopback was invisible to
  it; it now scans TCP and TCPv6.
- **A missing custom-MCP command (e.g. `uvx` not installed) looked like an
  endless silent restart loop**: when a configured server's command could not
  be found on PATH, the process never started, so there was no exit code and no
  stderr, and the crash-loop banner printed "the server printed no error output
  before dying". The bridge now catches the launch failure and names the real
  cause ("command not found: 'uvx' ...") both on the first attempt and in the
  crash-loop banner, while auto-restart keeps retrying in case the dependency
  is installed later.

### Changed
- After killing a port squatter, the "toggle Studio's MCP server OFF/ON"
  instruction now prints IMMEDIATELY (right after the kill) instead of only
  after the ~48s server-launch grace loop - so the user acts within seconds
  instead of staring at a seemingly-idle terminal for a minute. Toggling early
  also lets the grace loop pick up the tools and go green right away.
- **0 tools that no restart could fix**: if a `StudioMCP.exe` from a crashed
  session kept listening on Studio's MCP port (13469), reopening Studio made
  its MCP plugin do its one-shot registration against that *zombie* process.
  Because a Studio window was now running, both existing cleanups skipped it
  (the orphan-killer only acts when no Studio runs; the port check treats any
  Roblox-path owner as legitimate), so our fresh proxy could never own the
  port - 0 tools forever, unfixable by restarting Studio or the bridge in any
  order. The bridge now identifies the port owner by process ID: a
  `StudioMCP.exe` holding the port that this bridge did not launch (outside our
  own process tree) is a leftover by definition, so it is killed and the proxy
  restarted - at boot and again in the live watcher if the catalogue stays
  empty with Studio open. It then tells the user the one action that finishes
  recovery: open Assistant Settings > MCP Servers so Studio re-registers. If
  the process tree can't be read, nothing is killed (a healthy connection is
  never put at risk).
- The extension now tells non-technical users to "Run start.bat" instead of
  "Run python bridge.py" / "Run the ZeroScript bridge" in the offline panel,
  popup, and startup banner, matching the one-click launcher the README ships.

## [1.4.1] - 2026-07-11

Robustness release focused on the Roblox Studio connection lifecycle. Every
fix below was reproduced and validated live against a real Studio + Blender
setup, including the Roblox-side bugs reported on the devforum (StudioMCP
stale-pipe disconnects, MCP toggle turning off after a Studio update).

### Fixed
- **Phantom "Studio connected" state**: leftover `StudioMCP.exe` processes
  from a previous session or a Studio crash kept answering the bridge as if a
  Studio were attached, so the terminal and the extension showed green with
  Studio fully closed. The bridge now kills orphaned `StudioMCP.exe` at boot
  (only when no real Studio window exists, so a live connection can never be
  hit), and the boot banner re-confirms a positive probe before announcing a
  connection.
- **Status dot stuck green with Studio closed**: when StudioMCP advertised an
  empty tool catalogue (Studio closed at launch), the connectivity probe
  returned "unknown" instead of "disconnected", and the extension's
  don't-degrade-on-unknown rule kept the dot green forever. An alive Roblox
  proxy with an empty catalogue is now an authoritative "not connected".
- **Studio opened after the bridge was never detected** (yellow until a full
  bridge restart): two combined causes. (1) Nothing ever re-asked for the
  tool catalogue once the launch-time retry window expired - the watcher now
  re-polls `tools/list` while the catalogue is empty, so a late-attaching
  Studio is picked up within seconds. (2) Studio's MCP plugin registers with
  the MCP channel exactly ONCE (late in Studio's boot, or when the Assistant
  Settings > MCP Servers panel is opened/toggled) and never retries; the
  bridge's own recovery restarts could kill the MCP listener at that exact
  moment, permanently orphaning the plugin. The bridge no longer restarts the
  Roblox proxy while a Studio window is running, and both the terminal and
  the extension now say the one thing that actually fixes an orphaned
  plugin: open Assistant Settings > MCP Servers in Studio (validated three
  times live; a proxy-side restart provably cannot repair it).
- **Watcher crash silently disabling all Studio monitoring**: an unbound
  variable in the place-churn detector could kill the background watcher
  right after a reconnect, silently stopping every status update until the
  next bridge restart. Fixed, and both watchers are now supervised: a crash
  is logged in red and the watcher restarts itself in 5 seconds.
- Boot/connection messages no longer blame the merged multi-server tool count
  on Roblox ("49 tools loaded but NO Roblox Studio connected" when 22 of
  those were Blender's): every Roblox-specific message now uses the
  Roblox-only count.

### Added
- **Fast startup with addon servers**: MCP servers now launch in parallel and
  the extension-facing socket opens immediately, so a slow or absent Roblox
  Studio no longer delays Blender (or any addon) by up to a minute. The
  Roblox diagnostic continues in the background and the bridge pushes status
  updates to already-connected extensions as servers come up - previously an
  extension that connected early could keep a stale "addon offline" snapshot
  forever (greyed Start button instead of the orange degraded start).
- **Self-healing for Roblox's own disconnect bugs**: sustained loss of the
  Studio connection (stale named-pipe state, periodic silent disconnects)
  now auto-restarts the Roblox proxy - but only when no Studio window is
  running, where it is safe and effective.
- **Studio-update detection**: when a disconnect coincides with a new Studio
  version folder appearing, the terminal says Studio likely turned its MCP
  toggle off after updating (a known Roblox bug) and points at the exact
  setting, instead of retrying a recovery that cannot work.
- Extension messages distinguish "Roblox Studio is not running" from "Studio
  is running but not connected" (new `studio_proc` status field), each with
  its own corrective step.
- Terminal spinner during slow startup phases (server launch, Studio
  attach), so the console never looks frozen; only one spinner animates at a
  time.
- start.bat hardening: refuses to run from an unextracted ZIP, handles
  missing winget, rescans install folders after a winget install (PATH not
  refreshed), prints the Python version and the bridge's exit code on
  screen, and logs the Windows build - so a single screenshot of the
  terminal carries enough context for support.

## [1.4.0] - 2026-07-08

### Added
- Multi-MCP addon servers (experimental): a new "MCP servers" section in the
  panel menu lets you add or remove additional MCP servers (Blender,
  Sketchfab, or any local MCP command) alongside the always-primary Roblox
  Studio connection. The bridge rewrites `config.json` and restarts itself to
  load a change; Roblox stays protected from edits/removal and its status dot
  is scoped to Roblox alone so an addon going down never misrepresents the
  primary connection. New `list_mcp_servers` command and a `server` param on
  `list_commands` let the model discover and use addon tool sets on demand.
  When Roblox is down but an addon server is alive, the panel now offers a
  degraded start instead of refusing to start at all.
- Vision support (screen_capture / other tool-returned images) enabled for
  Arena, Gemini, GLM, Kimi and Qwen, each with a real "upload finished" signal
  before sending instead of trusting the first local preview, fixing several
  silent-attachment-drop and duplicate-attachment-on-retry bugs. A tool from
  any connected server that returns an image now gets the camera chip and is
  remembered for future calls, even for a custom MCP server whose name gives
  no hint it returns images.
- Parser: a JSON command cut off by the model's own output limit, missing
  only its trailing closing brackets, is now auto-completed and executed
  instead of failing with a parse error and forcing a full retry turn.
  Strictly refuses to salvage anything where real content (not just closers)
  was cut off.
- Per-reason parse-error feedback (cut off, bad JSON, missing ###LUA###
  opener, wrong envelope) instead of one generic "bad JSON" message, so the
  model fixes the actual problem instead of guessing.

### Fixed
- DeepSeek: a command's chip could show green "done" while DeepSeek was still
  streaming the reply, on back-to-back calls to the same tool. Caused by
  DeepSeek's list virtualization defeating the turn-count identity guard;
  fixed with a stable per-turn id.
- GLM: new "scroll to bottom" buttons were mistaken for the Stop button and
  permanently latched generation state to "busy." Raw command JSON could leak
  into the visible reply when nested inside a paragraph. An image filename
  could corrupt result-chip detection.
- Kimi: added detection of Kimi's own native "Agent" mode, which conflicts
  with ZeroScript's command protocol; Start is disabled with a warning until
  it's turned off. Fixed the hidden file-upload input not existing until the
  "+" menu is opened, raw command text leaking when nested/oversized, and
  normal model prose containing "try again" being misread as a site error.
- Qwen: same "try again" false-busy fix as Kimi. A/B "carousel" comparison
  turns (where the composer disappears mid-carousel) now auto-resolve to
  Response 1 once both candidates finish, instead of stalling or misreading a
  candidate as a truncated command.
- Arena: send is now confirmed until the composer actually clears instead of
  trusting a single click, preventing stranded messages/attachments; the chip
  now anchors below the reply text instead of floating above it.
- A command turn abandoned mid-stream (reload, or superseded by a
  regenerate) no longer shows a false green checkmark; it now shows a
  neutral "not run" state instead.
- A tool's own in-body error (e.g. "Output of '...': Error executing code...")
  now settles the chip red instead of green, even when the tool didn't use
  ZeroScript's own ERROR wrapper.
- Regenerating a stopped command no longer briefly re-shows the old call's
  chip before the new one streams in.

### Changed
- The version number next to the ZeroScript name in the panel is now small,
  plain text instead of a bordered green badge.
- System prompt updated to cover multiple MCP servers: the model must call
  `list_mcp_servers` before assuming something outside Roblox is unsupported,
  and the tool list is no longer inlined in the prompt (fetched on demand via
  `list_commands`).

## [1.3.9] - 2026-07-04

### Fixed
- Bridge: kill the full process tree on restart instead of just the wrapper
  process, which used to leave orphaned StudioMCP.exe instances behind that
  fought the next launch and caused seemingly random "Studio looks connected
  but nothing responds" failures.
- Bridge: a dead MCP server is now auto-restarted by a background watchdog
  instead of waiting for the next tool call to notice.
- Bridge: a tool call that hits one of Studio's own brief connection blips now
  retries once instead of surfacing a spurious "Studio not connected" error.
- Extension: the status bar no longer shows a falsely healthy "N tools" label
  when the agent is active but Studio, the place, or the bridge itself isn't
  actually usable, it now names the real blocker (open a place / enable the
  MCP server / bridge offline).
- Cross-provider: DeepSeek, Gemini, Kimi, GLM and Qwen composer menus, model
  pickers and tooltips (including GLM's search hover card and Kimi's model
  popover) no longer render clipped or hidden behind ZeroScript's own
  bar/pill/cover.
- Cross-provider: a thinking model quoting command JSON in its own reasoning
  area no longer makes the tool chip flap between done/run/done (Gemini, Kimi,
  GLM and Qwen).
- The "Agent is working" composer cover now blocks clicks into the composer
  underneath it instead of letting them through, and can no longer balloon
  past the composer's visible band or drag itself off position when a site
  recreates its editor node mid-session (seen on Kimi).
- A command chip could briefly flash or restart its spinner when revisiting a
  past turn; it now settles to done correctly instead.
- DeepSeek: the raw system-prompt turn no longer flashes for a frame before
  being hidden.
- Gemini: "New chat" no longer gets stuck on "Agent active" from a reused
  previous conversation URL.
- Kimi: reasoning is read separately from the actual reply, so a command
  drafted while the model is still "thinking" is no longer detected or
  executed; input can no longer be typed mid-run after the editor node is
  recreated.
- Arena: unsupported-mode gate now also covers Web Search and Generate Image,
  and chip alignment is fixed when a command turn renders as an A/B
  model-comparison carousel.
- Bridge: a long-running tool call no longer starves the connection's ping
  handling and trips the half-open-socket watchdog.

### Changed
- Bridge and installer logs moved to `logs/bridge_debug.log` and
  `logs/start.log`; the console now only shows what a user actually needs to
  read, full detail still lands in the log files.
- `start.bat` now detects and explains a double launch instead of silently
  replacing the previous instance, and warns clearly if port 17613 stays held
  after trying to free it.
- Removed remaining em dashes from user-visible strings.

## [1.3.3] - 2026-06-24

### Fixed
- Bridge no longer depends on Roblox's `mcp.bat`, which hard-coded a single
  Studio version path and broke (0 tools / "Bridge or Studio offline") once
  Studio auto-updated and that version folder was removed. A new
  `launch_studio_mcp.py` finds the newest installed `StudioMCP.exe` and launches
  it directly.
- `bridge.py` now runs a `.py` MCP command with the same Python interpreter as
  the bridge, so it works on installs where only the `py` launcher exists.

## [1.0.0] - 2026-06-09

### Added
- Initial public release of ZeroScript Free
- Browser extension for Chrome and Edge (DeepSeek chat integration)
- Local Python bridge (`bridge.py` + `start.bat`) for Roblox Studio communication
- Built-in MCP server support (no plugin required - activate directly in Roblox Studio)
- Read and edit Luau scripts directly from DeepSeek chat
- Run Luau code in real time inside Roblox Studio
- Inspect game tree and instances
- Generate meshes, materials, and models
- Browse and insert assets from the Creator Store
- Control play-testing from chat
- Panel status indicator (green / yellow / grey)
- Auto kill port 17613 on start to avoid conflicts
- Ko-fi support link with Robux tip passes in the extension panel
- Setup tutorial video on YouTube
