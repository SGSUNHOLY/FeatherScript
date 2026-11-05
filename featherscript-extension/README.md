# FeatherScript Free - AI Roblox Studio Agent (ChatGPT, DeepSeek, Gemini, Kimi, GLM, Qwen, Arena, Meta AI, Vani, Notion AI, MiMo AI)

Control Roblox Studio with AI, for free. FeatherScript turns a normal AI chat (ChatGPT, DeepSeek, Google Gemini, Kimi, GLM, Qwen, Arena, Meta AI, Vani, Notion AI, or MiMo AI) into an agent that builds and scripts your Roblox game for you: just describe what you want, and it reads/edits scripts, runs Luau, inspects the game tree, and generates assets directly in Roblox Studio. No API key, no terminal, no coding required.

It's a Chrome/Edge browser extension plus a small local bridge that connects the chat to Roblox Studio through the official MCP server. **DeepSeek is the recommended provider.** ChatGPT, Gemini, Kimi, GLM, Qwen, Arena, Meta AI, Vani, Notion AI and MiMo AI also work. On ChatGPT, screenshots and image input are disabled on purpose (its free tier caps files/images on a separate quota from messages, so vision would only work part of the day); ChatGPT also summarises its own context in long sessions, so FeatherScript re-states its operating instructions periodically (shown as a "Reminder" chip) to stop it forgetting it can run commands. Gemini and Kimi can be less stable: Gemini tends to stop using the Roblox tools in long sessions, and Kimi sometimes reaches for its own native tools instead of the Roblox commands. On Arena, keep the mode dropdown on **Direct** (FeatherScript only supports Direct mode). Vani runs on its free guest allowance, Notion AI needs you signed in, and MiMo AI works on both UltraSpeed and MiMo Chat but needs a Xiaomi account to send (MiMo Claw is not supported); on Notion, open the **Notion AI chat** view (`notion.so/chat`) - the adapter never types into normal Notion pages.

## Music and workspaces

Use the two workspace buttons in the chat controller to select RobloxScript or
AgentScript for the next task. There is one selector and no dropdown.
Play ambient music from the popup, dashboard, or the controller's ♫ shortcut.
The popup and dashboard share volume and sound-effect settings. Pause from any
music control; closing the popup keeps music playing. Browser audio support and
troubleshooting are described in [audio notes](../docs/EXTENSION_AUDIO.md).

## Setup

**Load the extension manually (Edge or Chrome):**
1. Go to `edge://extensions` (Edge) or `chrome://extensions` (Chrome)
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select the `featherscript-extension` folder
5. The extension is now active

**Then set up the Bridge:**
1. **Download the Bridge** from the [GitHub releases page](https://github.com/sebattfg/ZeroScript-Free)
2. **Open Roblox Studio** and load a Place
3. **Enable the MCP server in Roblox Studio** (first time only): click **Assistant AI** in the top bar, then **...** > **Manage MCP Servers** > **Enable Studio as MCP Server**
4. **Open FeatherScript** - double-click `app.bat` (Windows) or `MacOS_Start.command` (macOS). The app opens and the Bridge starts with it. On macOS, the first launch shows a Gatekeeper warning (normal for any downloaded script): click **Done**, then **System Settings > Privacy & Security**, scroll down, and click **Open Anyway**.
5. **Go to https://chat.deepseek.com** (recommended), https://chatgpt.com, https://gemini.google.com, https://www.kimi.com, https://chat.z.ai, https://chat.qwen.ai, https://arena.ai, https://www.meta.ai, https://c.vani.ai/chat, https://www.notion.so/chat, or https://aistudio.xiaomimimo.com/#/ultra, open a new chat (only works on these exact addresses; on Arena use Direct mode)
6. Click **Start session** in the FeatherScript panel
7. Type what you want to build

The **gear** on the FeatherScript bar opens the local **dashboard** tab: bridge/Studio status, the site switcher, the custom prompt, MCP addon servers, the live command list and settings.

The **–** button (beside the Discord icon) folds the bar into a one-line pill (logo, live status, Start/Stop), for sites whose chat layout leaves the full card over the transcript. The pill can be dragged anywhere on screen and the folded state and position are remembered across pages.

📺 [Watch the setup tutorial](https://youtu.be/kPKiZLZ9_Ps)

## Architecture (for contributors)

The extension is split between a provider-agnostic core and per-AI-site providers:

```
core/config.js        system prompt, feedback strings, tool categories (global ZS)
core/parser.js        FeatherScript command parsing - pure string logic   (global ZSParse)
core/main.js          agentic loop, UI, camouflage, session state      (uses ZSProvider)
providers/deepseek.js everything DeepSeek-specific: DOM selectors, generation
                      detection, send mechanics, composer modes…       (global ZSProvider)
providers/gemini.js   same interface for Google Gemini (Angular DOM, Quill
                      composer, code-block masking)                    (global ZSProvider)
providers/kimi.js     same interface for Kimi / Moonshot AI (Vue DOM, Lexical
                      composer, segment-code masking)                  (global ZSProvider)
providers/glm.js      same interface for GLM / Z.ai (Svelte DOM, code-block
                      wrapper masking)                                 (global ZSProvider)
providers/qwen.js     same interface for Qwen / chat.qwen.ai (Vue DOM, network-tap
                      SSE stream, Monaco disposal guard)               (global ZSProvider)
providers/qwen-net.js MAIN-world fetch tap for Qwen SSE stream        (injected by manifest)
providers/chatgpt.js  same interface for ChatGPT / chatgpt.com (React DOM,
                      ProseMirror composer, CodeMirror reply reading) (global ZSProvider)
providers/chatgpt-cm.js MAIN-world CodeMirror tap: republishes each code block's
                      TRUE document (the rendered DOM truncates long
                      lines)                                          (injected by manifest)
providers/arena.js    same interface for Arena / arena.ai (React DOM, multi-model
                      playground, A/B-comparison auto-commit, Direct-mode gate) (global ZSProvider)
providers/meta.js     same interface for Meta AI / meta.ai (React DOM, textarea
                      composer, JSON-viewer + code-collapse masking)   (global ZSProvider)
providers/vani.js     same interface for Vani Chat / c.vani.ai (Next.js DOM,
                      shape-discovered composer + rows, network-tap reply) (global ZSProvider)
providers/vani-net.js MAIN-world fetch tap: pins the command protocol on the
                      outgoing message, republishes the SSE reply  (injected by manifest)
providers/notion.js   same interface for Notion AI / notion.so/chat (hash-class
                      tolerant composer discovery, block-aware reply reading,
                      chips anchored outside the DOM-locked editor)   (global ZSProvider)
providers/mimo.js     same interface for MiMo AI / aistudio.xiaomimimo.com
                      (UltraSpeed #/ultra + MiMo Chat #/c, Xiaomi sign-in gate,
                      textarea composer, network-tap reply)            (global ZSProvider)
providers/mimo-net.js MAIN-world fetch tap: pins the command protocol on the
                      outgoing query, folds the SSE reply, splits reasoning
                      (<think> / reasoningContent) from the answer  (injected by manifest)
background.js         WebSocket to the local bridge (provider-agnostic)

dashboard.html/css/js local settings page (opened by the bar's gear or the
                      popup): bridge status, site switcher, custom prompt,
                      MCP servers, command list, settings, support
```

`core/main.js` never touches the host site's DOM directly - it only calls the
`ZSProvider` interface. To integrate another AI site: write a new
`providers/<site>.js` exporting the same interface, then add its URL pattern to
`manifest.json` (`content_scripts` + `host_permissions`) and to
`PROVIDER_URLS` in `background.js`. No core change required.

Smoke tests (plain Node, no dependencies - run them from this directory):

- `node test-parser.js` - the command parser (`core/parser.js`).
- `node test-chatgpt.js` - ChatGPT reply reading (`providers/chatgpt.js`),
  driven against a stub DOM: CodeMirror line joining, the `data-zs-cm`
  MAIN-world tap that long code blocks depend on, and subtree exclusion.

Both print `PASS`/`FAIL` per case and exit non-zero on failure.

## Support

☕ [Ko-fi](https://ko-fi.com/sebattfg) - Robux tip passes available in the extension panel
