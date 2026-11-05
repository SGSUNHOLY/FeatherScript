# UI roadmap: what was fixed, what was added, and where it came from

Status key: **Built** = in the files and checked as far as the tools allow.
**Planned** = an idea with a source, not built. **UNVERIFIED** = needs a person to play it.

## Fixed

| # | Problem | Fix | File | Source |
|---|---|---|---|---|
| F1 | Pages were never scaled to the screen. The skill said the controller did this; it did not. | Controller fits each page's `Scale` to `AbsoluteSize` and refits on change. | `ul-ui-builder/references/UIController.client.lua` | `ScreenGui.AbsoluteSize` is the full screen area; `Camera.ViewportSize` is the safe area: https://create.roblox.com/docs/reference/engine/classes/Camera |
| F2 | Close then reopen inside the fade-out hid the page that had just opened. | Every tween is stored, cancelled before a new one starts, and its finish step runs only if it is still current. | same | Tween handling is the controller's own; no API claim |
| F3 | Clicking the open button during its fade-out restarted the close. | Toggle reads the logical state (`openPage`), not the visual one (`Enabled`). | same | same |
| F4 | Hover and press could disagree, and a drag off a button left it pressed. | One `rest()` decides the target; leaving the button releases it. | same, and `check-ui-repo/src/CheckUIController.luau` | same |
| F5 | Check-UI: `bindButtonAnimations` was never defined in `CheckUIComponents`, so `AutoBindHover` silently did nothing. | Components now require the controller and call it. | `check-ui-repo/src/CheckUIComponents.luau` | Check the nil-check: `if ... and CheckUIComponents.bindButtonAnimations` |
| F6 | Check-UI: the controller was not required by anything, so windows never fitted to the device. | `createWindow` calls `bindResponsiveUIScale`. | same | same |
| F7 | Check-UI: no refit on rotation or window resize. | Refit on `Camera:GetPropertyChangedSignal("ViewportSize")` and on a new `CurrentCamera`. | `check-ui-repo/src/CheckUIController.luau` | Camera.ViewportSize is updated each PreRender for the current camera: https://create.roblox.com/docs/reference/engine/classes/Camera |
| F8 | Check-UI: sunburst spin connected to `RenderStepped` and never disconnected; sunbursts added later did not spin. | Disconnect on `Destroying`; track `DescendantAdded` and `DescendantRemoving`. | `check-ui-repo/src/CheckUIController.luau` | `Instance.Destroying`: https://create.roblox.com/docs/reference/engine/classes/Instance |
| F9 | Hardening, not a reproduced bug: a button parented before its attributes are set might miss its wiring. | Wiring is deferred one step and guarded against double-wiring. | `UIController.client.lua` | — |

## Added

| # | Idea | What was built | Status | Source |
|---|---|---|---|---|
| A1 | Gamepad and keyboard focus that stays on the open page | Pages set `SelectionGroup`; open calls `GuiService:Select`; ButtonB and Escape close. | Built. Gamepad UNVERIFIED in play. | GuiBase2d.SelectionGroup and SelectionBehavior*: https://create.roblox.com/docs/reference/engine/classes/GuiBase2d ; GuiService.Select and SelectedObject: https://create.roblox.com/docs/reference/engine/classes/GuiService ; GuiObject.SelectionOrder: https://create.roblox.com/docs/reference/engine/classes/GuiObject ; background: https://devforum.roblox.com/t/new-gamepad-ui-selection-apis/1791278 |
| A2 | Compact numbers and timers | `UIFormat.luau` (`compact`, `clock`). Tested in Studio: 1234→1.2K, 3.4e6→3.4M, 999999→1.0M (after the carry fix), 3725→1:02:05. | Built | Roblox HUD convention; no API |
| A3 | Data-bound labels with the `<unbound>` gate | `UIBind.luau` binds a label to an attribute. | Built. Not yet run against a live server attribute. | `Instance:GetAttributeChangedSignal` is standard Instance API; the sentinel rule is in SKILL.md |
| A4 | Toasts (messages in a queue) | `UIToast.luau` | Built. UNVERIFIED in Studio: needs a playtest to see the slide. | TweenService and Back easing as in the controller |
| A5 | Colour contrast gate | `scripts/check_contrast.py` | Built. See the finding below. | WCAG 1.4.3, 4.5:1 for normal text: https://w3.org/WAI/WCAG20/Understanding/contrast-minimum |
| A6 | Responsive fit that does not fight hover | Separate `WindowScale`, `ButtonScale`, `MotionScale`; modal pops mark the scale busy during the tween. | Built (Check-UI and ul-ui-builder) | Scale ownership is this design; the device-scale background is https://devforum.roblox.com/t/how-do-i-make-my-ui-scale-correctly/3971659 and https://devforum.roblox.com/t/scaling-guis-for-smaller-screens/60146 |

## Finding from the contrast gate (not changed)

Run on `references/theme.json`: 8 of 15 pairs are below 4.5:1.

- `onDark` (white) text on `green` is 2.13:1, on `gold` 1.72:1, on `grey` 1.93:1, on `blue` 2.65:1,
  on `red` 3.42:1 and on `purple` 3.93:1. Button labels rely on the dark text stroke, which this
  gate does not count, so the real in-game contrast may be better. Measure it in Studio before deciding.
- `inkSoft` on `panelAlt` is 4.18:1 and on `slot` is 3.70:1.

These are colour decisions, so I left the theme as it is. Options: darker button label colour,
a dark text stroke measured as the background, or a larger minimum text size on those buttons.

## Planned (not built)

| # | Idea | Why | Source |
|---|---|---|---|
| P1 | Localization: string keys, a translation table, and a per-language text-fit run (German runs longer than English) | Text that fits in English overflows in other languages; the text-fit check already exists, so run it per language | LocalizationTable: https://create.roblox.com/docs/en-us/reference/engine/classes/LocalizationTable.md ; Translator: https://create.roblox.com/docs/en-us/reference/engine/classes/Translator.md ; LocalizationService: https://create.roblox.com/docs/en-us/reference/engine/classes/LocalizationService.md |
| P2 | Count-up numbers and floating "+10" pops | Feedback on change; use `UIFormat.compact` for the text | Built from `UIBind` + TweenService; not built as a module yet |
| P3 | Reduced motion and text-scale settings | Players who get motion sickness, or who need bigger text | WCAG 2.3.3 (animation from interactions) is the reference; not fetched |
| P4 | Visual regression against Studio captures | Catch layout change without a person looking | Playtest skill already has the baseline procedure: `anthropic-skills:roblox-studio-playtest-qa` |
| P5 | Scrolling lists with an automatic canvas size | Inventories and leaderboards overflow without it | UIListLayout and AutomaticCanvasSize: not fetched |
| P6 | Single-source design system: one of Check-UI or ul-ui-builder | The two use different baselines (1050x620 with 0.52–1.18; 1280x720 with no floor) | Decision for the user |
| P7 | API-Dump.json shipped with `check_gui_syntax.py`, or fetched from its GitHub source | The syntax checker cannot run without it | https://github.com/MaximumADHD/Roblox-Client-Tracker (named in the script) |

## Obby-specific additions (for the Roblox obby game)

These use the modules above. None is built yet.

- Stage counter and a checkpoint toast when a checkpoint is reached (`UIToast`, `UIBind`).
- Run timer and best time, shown with `UIFormat.clock`.
- Death counter.
- Speedrun splits, one per checkpoint.
- Skip-stage and shop buttons. Purchases stay on the server (Check-Code rule 1).
- Leaderboard. Written from the server only.
- Keep the thumbstick and jump zones clear, which `verify_ui` already checks.

## Other errors found in this pass

| # | Where | What | Severity | Status |
|---|---|---|---|---|
| E1 | `scripts/kaggle_icon_ab.py:54` | `subprocess.call(cmd, shell=True)` with a string built from paths. Inputs are internal, but a path with a space or a quote breaks it. | Low | Not changed. Use an argument list. |
| E2 | `scripts/kaggle_icon_ab.py` | `import os` is unused. | Trivial | Fixed. |
| E3 | `references/check-ui-repo/SKILL.md` (around line 590) | Showed an old `bindButtonAnimations` snippet that did not match the fixed controller. | Low, a doc mismatch | Fixed: the sample now calls the controller. |
| E4 | Check-UI release notes and SKILL | Say GothamBlack; the bundled ul-ui-builder uses Fredoka. | Design decision | Open (see P6). |
| E5 | Whole pack | No deprecated Luau calls (`wait`, `spawn`, `delay`, `tick`) in any code file. Matches are only in documentation. | None | Checked. |
| E6 | All Python scripts | Compile cleanly. No bare `except:` in the UI scripts. | None | Checked. |

Pyflakes was not run (not installed). The unused-import scan used the standard library.

## Tools and repos for Roblox Studio and AI (checked on GitHub, Oct 2026)

Check the licence and the archive status before you use any of these. Several are archived.

| Repo | What it does | Licence | Status | Write access? | Source |
|---|---|---|---|---|---|
| Roblox/studio-rust-mcp-server | Official proof-of-concept MCP server. Runs Luau in Studio, inserts Creator Store models, reads output, starts and stops play. | MIT | **Archived 3 Apr 2026, read-only** (per the Roblox DevForum post and the repo page) | Yes: can modify the open place | https://github.com/Roblox/studio-rust-mcp-server ; https://devforum.roblox.com/t/introducing-the-open-source-studio-mcp-server/3649365 |
| boshyxd/robloxstudio-mcp | MCP server for Claude, Gemini, Cursor and others. Explore, read/edit scripts, bulk changes. Has a read-only "inspector" edition with 31 tools. | MIT | **Archived 6 Jun 2026**; the owner points to the fork Chrrxs/robloxstudio-mcp | Full edition: yes. Inspector: no | https://github.com/boshyxd/robloxstudio-mcp |
| madebyshaurya/stud | Desktop AI agent for Studio (GPT-4, Claude, ChatGPT). Creates and edits instances and scripts, with an undo point per AI change. | **Conflicting: badge says AGPL-3.0, text says MIT.** Check the LICENSE file. | Not marked beta on its page, but it describes itself as early | Yes | https://github.com/madebyshaurya/stud |
| Meganugger/roblox-studio-mcp | Another community MCP server | Not checked | Not checked | Not checked | https://glama.ai/mcp/servers/Meganugger/roblox-studio-mcp |
| Chrrxs/robloxstudio-mcp | The fork the boshyxd owner recommends | Not checked | Not checked | Not checked | Named on the boshyxd page; not fetched |

What this means for UltraLab:

- The Studio tools in this session come from the Roblox Studio MCP server. None of the GitHub projects above is the one in use here.
- Every project that can modify a place is a risk for a live game. Use a copy of the place, and keep the rule that a live place is never written to without approval.
- Read-only inspection (boshyxd's inspector edition) is the safe starting point for checking a project.
- Do not vendor any of these into the pack until you have read the code and confirmed the licence.

## Not checked

- No Studio run of the controllers. The Studio tools are connected to one place (`Place1`), but I did
  not write these files into it, because it is not confirmed to be a test place. Steps for you are in the
  report.
- No gamepad run. No device run at a phone size or with a notch.
- `check_gui_syntax.py` was not run (it needs the API dump).
- The GitHub repos above were read from their pages, not cloned or run. Their code was not checked.

## Main prompt and vault (ultralab.py)

| # | Where | Problem | Fix |
|---|---|---|---|
| P-1 | `PROMPT_DEEPSEEK` | The CHECK SUITE GATE block appeared twice. | Removed the second copy. |
| P-2 | `PROMPT_FULL` | Said every skill's full text is in its folder under `skills/`. Only the ul-* skills have folders; 29 core skills are inline only. | The sentence now says which is which. |
| P-3 | `index_block` | Same false claim in the index heading. | Heading corrected. |
| P-4 | Step 5 | Makes `gui-syntax` mandatory, but it needs the Roblox API dump, which the pack does not ship. | Says to mark GUI syntax UNVERIFIED if the dump is missing. |
| P-5 | Toolbox line | Refers to a "toolbox skill" that is not in the pack. | Points to the Studio search_asset and insert_asset tools, and to ul-3d-model and ul-texture-gen. |
| P-6 | Step names | Many step references (check-cycle, luau-lint-review, api-watchlist, reference-library, studio-verify and others) are index entries, not folders. Their text is inline. | Not renamed; now described correctly (P-2). |
| P-7 | Whole prompt | The prompt cannot enforce the gate. Its own text says so. | Unchanged. The table and scanner output are the check. |

Vault: `vault/` holds 16 notes (lessons, verified API facts, patterns, decisions, one session). The assistant reads and writes
it with its own file tools (step 9 in the full prompt, rule 11 in the DeepSeek prompt). No command is run by hand. The prompt
builder embeds a snapshot of the vault, so chats without file access still get it.

Limit: the vault is memory in files. It does not change the model. The notes help only when the assistant reads them.
