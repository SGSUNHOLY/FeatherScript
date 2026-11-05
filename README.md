# FeatherScript 2.0.1 - Free AI Agent for Roblox Studio

> **This is a fork.** FeatherScript continues [ZeroScript Free by sebattfg](https://github.com/sebattfg/ZeroScript-Free) under the same GPL-3.0 license, with the original author's links and credits left in place. Everything below is upstream's description; what this fork changes is listed in [CHANGELOG.md](CHANGELOG.md).

![GitHub stars](https://img.shields.io/github/stars/sebattfg/ZeroScript-Free?style=social)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-lightgrey)
![License](https://img.shields.io/badge/license-GPL--3.0-blue)

**FeatherScript** is a free browser extension that turns ChatGPT, DeepSeek, Google AI Studio, Gemini, Kimi, GLM, Qwen, Arena, Meta AI, Vani, Notion AI, MiMo AI or Genspark into a Roblox Studio AI agent.
Control Roblox Studio with AI directly from your browser - read/edit scripts, run Luau, generate assets, all from a normal AI chat. No API key, no terminal, no coding needed.

> 🌐 **Website: [zerodev.tools/zeroscript](https://zerodev.tools/zeroscript)** the free Lemonade.gg / Luamotion alternative for building Roblox games with AI.

Thirteen AI providers are supported, including **Google AI Studio** (aistudio.google.com), **DeepSeek** (chat.deepseek.com, recommended), **ChatGPT** (chatgpt.com), **Google Gemini** (gemini.google.com), **Kimi** (kimi.ai, Moonshot AI), **GLM** (chat.z.ai, Z.ai), **Qwen** (chat.qwen.ai), **Arena** (arena.ai, a multi-model playground), **Meta AI** (meta.ai), **Vani** (c.vani.ai), **Notion AI** (notion.so/chat), **MiMo AI** (aistudio.xiaomimimo.com, Xiaomi MiMo Studio - works on both UltraSpeed and MiMo Chat and needs a Xiaomi account to send) and **Genspark** (www.genspark.ai/agents?type=ai_chat, the AI Chat agent - needs a Genspark account signed in before it will accept a message). On ChatGPT, screenshots and image input are turned off on purpose: the free tier limits files and images on a separate quota from messages, so vision would only work part of the day. Gemini and Kimi can be unstable: Gemini tends to stop using the Roblox tools in long sessions, and Kimi sometimes uses its own native tools instead of the Roblox commands. On Arena, use **Direct** mode (FeatherScript only supports Direct; it blocks Start in Battle / Side-by-Side / Agent modes). Vani runs on its free guest allowance; Notion AI needs you signed in and only works inside the Notion AI chat view, never on ordinary pages. Genspark puts a sign-in dialog over the composer for guests - FeatherScript stops and names that dialog instead of typing into it, so sign in at genspark.ai first. DeepSeek is the recommended provider.

> 💬 **Stuck? Join the [Discord community](https://discord.gg/9aNyZsMWcb)** get help, share feedback, and follow updates.

> *Also known as: FeatherScript Roblox, FeatherScript free download, Roblox ChatGPT agent, Roblox DeepSeek agent, Roblox Gemini agent, Roblox Kimi agent, Roblox GLM agent, Roblox Qwen agent, Roblox Arena agent, Roblox Meta AI agent, Roblox Studio AI automation, Luau AI, MCP Roblox, lemonade alternative free, lemonade.gg alternative, free Roblox AI agent, free lemonade roblox alternative*

## ⚠️ FeatherScript is Free Beware of Paid Copycats

FeatherScript is 100% free and open-source. It always has been, and it always will be. There is no official paid version, no subscription, and no sign-in required to use the extension.

If you come across a site or extension using the FeatherScript name that asks for payment or account creation, it is **not** this project. The only official links are the ones listed at the top of this README.

## Local integration update — 2026-11-03

**Test Blender** now checks both startup and a real CPU-rendered PNG in a
temporary scene. Blender 5.2.3 LTS was exercised locally through the bridge:
primitive creation, persistent scene inspection, PNG rendering, saving a new
`.blend` file, overwrite refusal and process cleanup. Startup failures and
broken pipes now retain their actual cause instead of reporting every closed
session as a timeout. Commands with an uncertain outcome are not replayed.

After updating, restart FeatherScript, reload its unpacked extension and refresh
chat tabs. In MCPs, keep automatic Blender detection or choose `blender.exe`,
press **Test Blender**, then enable Blender and save configuration. Safe mode
allows the procedural tools; arbitrary Blender Python remains disabled until
you deliberately turn safe mode off.

## Extension music and workspace controls

The controller now has one pair of RobloxScript / AgentScript buttons instead of
a dropdown. Changes apply to the next task and retain desktop permission checks.

Press **Play** in the extension popup or dashboard, or the **♫** button in a chat
controller, to hear the bundled ambient music. It continues when the popup closes.
Pause from any of those controls. Volume and sound-effect mute are shared across
extension surfaces. Music starts only after you request it. See
[extension audio notes](docs/EXTENSION_AUDIO.md).

Reload the unpacked extension and refresh existing chat tabs after updating.

## How it works

```
AI chat (ChatGPT / DeepSeek / Gemini / Kimi / GLM / Qwen / Arena / Meta AI / Vani / Notion AI / MiMo AI, in your browser) -> FeatherScript Extension -> Bridge (your PC) -> Roblox Studio
```

The extension runs inside the chat page (ChatGPT, DeepSeek, Gemini, Kimi, GLM, Qwen, Arena, Meta AI, Vani, Notion AI or MiMo AI). When you type a request, it sends commands to the Bridge running on your PC, which drives Roblox Studio through the built-in MCP server.

## Headless Blender

Open **MCPs**, enable **headless Blender**, then save configuration. Blender is
found on PATH or in standard Windows/macOS installation folders. For a portable
installation, enter the absolute executable path. Blender itself must be installed;
no Blender binary is added to the Lite download.

One background process starts on the first tool call and retains its scene until
the bridge stops. Available tools are `get_scene_info`, `generate_3d` (procedural
primitives), `look` (CPU PNG preview), `save_scene` (absolute new `.blend` path),
and `execute_blender_code`. Safe mode disables Python execution entirely; turning
it off gives tool code full local Python access. This is not an OS sandbox.
Save the scene before restarting the bridge or changing MCP configuration. Unsaved
scenes are temporary. Operations time out after 90 seconds and stop Blender.

## Default skill bundle

The Lite release includes the same five default skill families as 2.0.0:
Roblox characters/animations, NPC AI, performance, world building and Stud UI.
The optional development toolkits (desktop frame capture, process recovery,
asset-generation helpers and local development servers) remain in source and
are excluded from the default download. Use Skills → Import folder if you
choose to add an optional toolkit. Existing imported skills are not deleted.

## Setup

> 📺 **Lost? Watch the [setup tutorial on YouTube](https://youtu.be/kPKiZLZ9_Ps) it covers every step below.**

### 1. Download the zip and install the extension

Download the latest zip from the **Releases** page and extract it. The zip contains both the **Bridge** and the **extension folder**.

To load the extension:

- Go to `edge://extensions` (Edge) or `chrome://extensions` (Chrome)
- Enable **Developer mode** (top right toggle)
- Click **Load unpacked**
- Select the `featherscript-extension` folder from the extracted zip

### 2. Start Roblox Studio and enable MCP

Open Studio and load a Place, then enable MCP (first time only):

- Click **Assistant AI** in the top bar
- Click **...** (top right of the Assistant panel)
- Click **Manage MCP Servers**
- Click **Enable Studio as MCP Server**

> Not sure where to find these options? The [video tutorial](https://youtu.be/kPKiZLZ9_Ps) shows exactly where to click.

### 3. Open FeatherScript

The **Lite ZIP** includes the app, extension, bridge and bundled skills. It leaves
out the Electron runtime, installed dependencies, logs and caches. On Windows,
install Node.js (including npm), extract the entire ZIP and run `app.bat`.
The first launch uses the lockfile with dependency lifecycle scripts disabled, then explicitly installs the pinned Electron runtime with its embedded release checksums. It needs internet access; later launches reuse
that installation. Python 3.9+ is also required for the bridge. The Lite ZIP is
not an offline installer, and does not reduce Electron's installed size.

To build a clean Lite release from source, run `python scripts/package-release.py`
from the project folder. The ZIP and SHA-256 checksum are written to `releases/`.
Packaging uses default settings instead of copying your local MCP or vault configuration.

- **Windows:** double-click `app.bat` inside the extracted folder. The FeatherScript window opens and starts the Bridge with it - no separate console to keep open.
- **macOS:** double-click `MacOS_Start.command` inside the extracted folder. The first time, macOS will show a security warning ("could not verify... free of malware") - this is normal for any script downloaded outside the App Store, click **Done**, then go to **System Settings > Privacy & Security**, scroll to the bottom, and click **Open Anyway**. You only need to do this once.

On Windows the app window opens and the Bridge starts inside it. On macOS a small window opens; that means the Bridge is running.

### 4. Start a session

Go to https://chat.deepseek.com (recommended), https://chatgpt.com, https://gemini.google.com, https://www.kimi.ai, https://chat.z.ai, https://chat.qwen.ai, https://arena.ai, https://www.meta.ai, https://c.vani.ai/chat, https://www.notion.so/chat, https://aistudio.xiaomimimo.com/#/ultra or https://www.genspark.ai/agents?type=ai_chat and open a new chat. The FeatherScript bar appears above the input box. Click **Start session**. Type what you want to build.

> Only works on chat.deepseek.com, chatgpt.com, gemini.google.com, kimi.ai, chat.z.ai, chat.qwen.ai, arena.ai, meta.ai, c.vani.ai, notion.so/chat, aistudio.xiaomimimo.com (#/ultra for UltraSpeed, #/c for MiMo Chat) and www.genspark.ai (`/agents?type=ai_chat`) - it will not work on any other site.
> On Genspark, use the **AI Chat** agent (`https://www.genspark.ai/agents?type=ai_chat`) and be signed in - guests get a sign-in dialog in place of a reply.
> On Notion, use the **Notion AI chat** view (notion.so/chat); normal pages stay untouched.
> On MiMo, sign in with a Xiaomi account first, then use **UltraSpeed** (`#/ultra`) or **MiMo Chat** (`#/c`). **MiMo Claw** (`#/claw`) is not supported.
> On Arena, keep the mode dropdown on **Direct** - FeatherScript blocks Start in Battle / Side-by-Side / Agent modes (it only drives a single Direct reply).
> Gemini and Kimi can be unstable (model behavior, not the extension): Gemini may stop using the Roblox tools after a while, and Kimi may use its own native tools instead. If the AI starts answering in plain text instead of acting, remind it to use the commands or start a new session.
### 5. Watch the setup tutorial

[Watch the setup tutorial on YouTube](https://youtu.be/kPKiZLZ9_Ps)

## What the AI can do

- Read and edit scripts
- Run Luau code directly in Studio
- Inspect the game tree and instances
- Generate meshes, materials, and models
- Browse and insert from the Creator Store
- Control play-testing
- **38 focused editor commands** so the AI does not have to hand-write Luau for routine work:
  - Inspect: `get_properties`, `get_attributes`, `get_tags`, `describe_instance`, `get_bounds`, `get_selection`, `list_children`, `find_instances`, `find_tagged`, `count_instances`, `find_in_scripts`, `get_place_info`, `get_players`
  - Edit: `set_properties`, `set_attributes`, `remove_attributes`, `add_tag`, `remove_tag`, `rename_instance`, `clone_instance`, `delete_instance`, `reparent_instance`, `create_part`, `create_folder`, `group_instances`, `move_instance`, `resize_instance`, `rotate_instance`, `snap_to_grid`, `align_instances`, `duplicate_grid`, `set_anchored`, `weld_to`, `select_instances`
  - Play/test: `start_stop_play` (Studio's own Play/Stop), `run_server_luau`, `run_client_luau`
  - Capture: `feather_capture` (viewport screenshot) and `feather_capturevideo` (short frame recording, played back in the preview popup)
- **Remember your project across sessions** persistent project memory saved inside your place

## New in 2.0.0

- **Three more AI chats: Vani Chat, Notion AI and MiMo AI.** Alongside DeepSeek, ChatGPT, Gemini, Kimi, GLM, Qwen, Arena and Meta AI, FeatherScript now runs on `c.vani.ai`, the Notion AI chat (`notion.so/chat`, never on normal Notion pages) and Xiaomi's MiMo Studio (`aistudio.xiaomimimo.com`, UltraSpeed or MiMo Chat).
- **The bar shows whether the agent is actually working.** A small circular badge sits next to the status text: green with a slow sweeping arc while the loop is live, red when it is idle. It follows the loop's own state, so a fast tool round-trip does not make it flicker.
- **Tool and command chips match the bar.** Every chip is now parchment-and-ink with a gold rail, an ink icon tile and a running shimmer, with green "done" and red "error" states and a light variant for light pages.
- **Bridge offline on a fresh PC is fixed.** The app now installs the Python `websockets` library itself (it used to give up silently when it was missing), requires Python 3.9 or newer, finds `python3` and Homebrew Pythons on macOS, and keeps running when the install folder is read-only. The offline messages also name the launchers that actually ship - `app.bat` on Windows, `MacOS_Start.command` on macOS - instead of the old `start.bat`.
- **The app window installs on a fresh PC again.** Electron 45 stopped downloading itself during `npm install`, which left new installs at "the Electron runtime could not be downloaded". FeatherScript now fetches the runtime itself on first launch (and repairs an install that already got stuck), with the real cause and retry command if the download is blocked.
- **Your whole skill library loads.** `feather_getskills` used to stop at one large reply and drop the rest, so with a big library the model never saw the later skills. It now answers in numbered parts ("PART 1 of N") and ends each part with the exact call that fetches the next one, with every file delivered in full.
- **More stable agent turns.** MiMo's built-in web search can no longer switch itself on and answer from the web instead of running skills, tool results are actually sent on Vani, MiMo and Notion, a new chat no longer inherits an old "Agent active" bar, and an Arena reply that only says "Generating…" no longer stalls the run.

## New in 1.5.5

- **38 new built-in editor commands.** The AI can now read properties, search by name/tag, create and arrange parts, rename/clone/move objects, run code in a playtest, and screenshot or record the viewport - each as one narrow command with its own schema, instead of guessing Luau. They are listed by `list_commands` like every Studio command, and the system prompt explains when to use which.
- **Short viewport videos.** `feather_capturevideo` records a few seconds of Studio frames and plays them as a flipbook in the preview popup; the first and last frame are attached so the AI can see the change.
- **DeepSeek: the agent starts again on the new unified model.** DeepSeek merged Instant, Expert and Vision into one model and removed the model picker, which left "Start Roblox agent" stuck on "DeepSeek mode not ready". FeatherScript now recognises the new chat box, switches Search off and starts, with DeepThink left on.
- **DeepSeek: screenshots work on every chat.** Images no longer need the Vision tab (it is gone) - the unified model sees your Studio captures, one at a time or several in a row.

## New in 1.5.4

- **ChatGPT: the FeatherScript bar is back above the composer.** ChatGPT redesigned its input box and renamed the layout slot the bar sits in. FeatherScript kept asking for the old name, so the browser dropped the bar into a stray strip at the bottom right of the composer and squeezed the text field to nothing. The bar now takes the right row again, and it reads the layout live instead of trusting a fixed name, so the next redesign should not knock it out.
- **ChatGPT: long commands read cleanly on the new interface.** The same redesign replaced the code-block editor that used to hide line breaks and cut long lines off - the cause of the truncated commands fixed in 1.5.1. A 400-line block now reads back whole. If you are still on the old interface, the previous workaround is untouched.

## New in 1.5.3

- **Kimi moved to kimi.ai.** The old address, kimi.com, now asks for a Chinese phone number to sign in, which locked most people out. Open https://www.kimi.ai instead - the page is unchanged, the bar appears above the input box exactly as before. Reopen any Kimi tab you had on the old address.
- **DeepSeek: the Instant model can now run the agent.** Picking Instant used to leave "Start Roblox agent" spinning forever with no explanation, because only Expert and Vision were accepted. Choose Instant before starting and the session runs on it - much faster than Expert, without the reasoning pass. Images stay off on Instant just like on Expert; the Vision tab remains the only one that can see screenshots.
- **DeepSeek: a reply written in DeepSeek's own tool-call format no longer kills the turn.** DeepSeek occasionally answers with its internal markup instead of a FeatherScript command. Nothing recognised it, so the tool never ran, the raw tags stayed on screen and the agent stopped dead with you waiting. It is now caught, hidden behind a tool chip like any other command, and DeepSeek is told to rewrite the call properly.
- **ChatGPT: the bar no longer clips into the composer's rounded corners.**

See [CHANGELOG.md](CHANGELOG.md) for older releases.

## Panel status

| Dot | Meaning |
|-----|---------|
| Green | Bridge + Studio ready (a place is open) |
| Yellow | Bridge OK, but Studio isn't usable yet - open Roblox Studio, load a place, or enable its MCP server (hover the dot for the exact reason) |
| Grey | Bridge offline - open the app again with `app.bat` (Windows) or MacOS_Start.command (macOS) |

## Requirements

- Windows or macOS
- Roblox Studio (MCP support built-in)
- Microsoft Edge or Chrome
- Python 3.9+ - the app uses the Python already on your PC (it checks `py`, `python` and `python3`); if none is installed, get it from [python.org/downloads](https://www.python.org/downloads/). The app installs the one Python library it needs (`websockets`) itself on first launch.

## Support

FeatherScript is free. If it saves you time: [Ko-fi](https://ko-fi.com/sebattfg) - Robux tip passes available in the extension panel

---

Credit: the idea for connecting other MCP servers (Blender, Sketchfab, etc.) alongside Roblox Studio came from [javnpa](https://github.com/javnpa).

Credit: macOS/Linux support contributed by [archivealf](https://github.com/archivealf).


## 2.0.1 test release

This build includes local profiles, the 41-palette appearance catalogue (`core/theme-presets.json` is the source of truth), the supported-AI launchpad, Google AI Studio support, an Obsidian vault connection, optional Blender MCP configuration, Freebuff website shortcuts, and MiMo UltraSpeed transport fixes. The embedded native Blender editor is removed. Freebuff is an external website shortcut, not an extension injector.

Run `npm test` inside `featherscript-app` for the release consistency, JavaScript and Python regression checks. Python with the bridge's existing dependencies is required; `FS_TEST_PYTHON` can select a specific interpreter. Every `test-*.js` file at the app and extension roots runs automatically. Maintainer-only Chromium fixtures (`verify-extension.cjs`, `verify-app-profiles.cjs`, `verify-upgrade.cjs`) live in a private `_tools` directory that is not part of a release; those paths are referenced by the historical reports in `docs/`.

Before distributing beyond testing, verify authenticated chat sending, tool execution and image attachments on the providers you use. Automated fixtures do not certify live provider DOM changes, service quotas or account state. No new live-provider verification was performed for this test release.


## Project folders

- `app.bat` / `MacOS_Start.command`: launch FeatherScript.
- `featherscript-app/`: desktop app.
- `featherscript-extension/`: unpacked browser extension.
- `skills/`: shipped skill library.
- `docs/`: setup, feature and release notes ([index](docs/README.md)).
- `tests/`: Python regression tests.
- `scripts/`: build and maintenance tools.
- `releases/`: generated release ZIP.

Python runtime modules and `config.json` remain at the root because the desktop bridge and launchers use them. Run the full local checks with `node featherscript-app/scripts/test.js`, or Python tests with `python -m unittest discover -s tests`.
