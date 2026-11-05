// SPDX-License-Identifier: GPL-3.0-or-later
// core/config.js - provider-agnostic constants: app identity, system prompt,
// feedback strings, tool categorisation. NOTHING in this file may reference a
// specific AI site (DOM, selectors, site names) - that lives in providers/*.
// eslint-disable-next-line no-unused-vars
const ZS = (() => {
  "use strict";

  // Keep response waits finite even when a provider omits or corrupts settings.
  function normalizeTimings(overrides) {
    const defaults = {
      GEN_IDLE_MS: 1500, REASON_IDLE_MS: 12000, WARMUP_MS: 45000,
      REASON_NOREPLY_MS: 90000, STABLE_MS: 9000, RESPONSE_TIMEOUT_MS: 300000,
    };
    return Object.freeze(Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => {
      const value = overrides?.[key];
      return [key, Number.isFinite(value) && value > 0 ? value : fallback];
    })));
  }

  // Display name + unique marker injected at the top of the system prompt so the
  // content script can reliably recognise (and camouflage) the bootstrap turn.
  const APP_NAME = "FeatherScript";
  const SYS_MARKER = "⟦ZS-SYS⟧";
  // A re-statement of the system prompt mid-session (see withSysResend in
  // core/main.js). It carries SYS_MARKER TOO - that is what drives camouflage
  // and session detection, and neither should change - plus this second marker,
  // purely so the chip can say "Reminder" instead of inheriting the bootstrap's
  // "Starting Up". Same content, different label: a re-injection is not a start.
  const RESEND_MARKER = "⟦ZS-RE⟧";

  // A command can arrive as "feather_memory", "roblox/feather_memory" or the old
  // dotted form, so "does the bridge actually have this one" has to strip both.
  const toolBare = (name) => String(name || "").split("/").pop().split(".").pop();
  const hasTool = (tools, name) => (tools || []).some((t) => toolBare(t && t.name) === name);

  // ── Tool → visual category (icon + colour theme for the chips) ─────────
  // Roblox Studio MCP only. Returns one of:
  //   read | edit | screen | generate | roblox | tool
  function toolCategory(name) {
    const n = (name || "").includes("/") ? name.split("/").pop() : (name || "");
    if (/^obsidian_(list_notes|read_note|search)$/.test(n)) return "read";
    if (n === "obsidian_write_note") return "edit";
    if (n === "list_commands" || n === "list_tools") return "read";
    if (/^(script_read|script_search|script_grep|search_game_tree|inspect_instance|get_studio_state|get_console_output|search_creator_store|list_roblox_studios)$/.test(n))
      return "read";
    if (/^(get_|find_|list_children$|count_instances$|describe_instance$)/.test(n))
      return "read";
    if (/^(multi_edit|insert_from_creator_store|store_image)$/.test(n) || n === "execute_luau")
      return "edit";
    if (/^(run_client_luau|run_server_luau)$/.test(n))
      return "edit";
    if (/^(set_|add_|remove_|rename_instance|clone_instance|delete_instance|reparent_instance|create_|group_instances|move_instance|resize_instance|rotate_instance|snap_to_grid|align_instances|duplicate_grid|weld_to|select_instances)/.test(n))
      return "edit";
    if (n === "screen_capture" || n === "feather_capture" || n === "feather_capturevideo") return "screen";
    if (/^generate_/.test(n)) return "generate";
    if (n.startsWith("roblox") || /studio|luau|instance|workspace/i.test(n)) return "roblox";
    return "tool";
  }

  // Feedback strings sent back to the model so it can self-correct.
  const FEEDBACK = {
    // A command-shaped reply that could not be turned into a runnable call.
    // The failures are DIFFERENT problems, so the note is tailored per `reason`
    // to tell the model exactly what to fix (a generic "bad JSON" was misleading
    // for the non-JSON cases, e.g. a missing ###LUA### opener). Falls back to the
    // generic "malformed" text for any unrecognised reason.
    parseError: (reason, toolName) => {
      // ###LUA### is execute_luau-ONLY (the parser always maps a bare ###LUA###
      // block to execute_luau). So only suggest it when the broken command IS
      // execute_luau, or when we could not tell which command it was. For a KNOWN
      // other command (e.g. execute_blender_code) the ###LUA### hint is wrong and
      // misleading - a model that followed it would ship its code to the wrong MCP
      // - so drop it and keep the JSON-only guidance.
      const otherCmd = toolName && toolName !== "command" && toolName !== "execute_luau";
      const luaMalformed = otherCmd ? "" : " (or use the ###LUA### / ###END_LUA### block for execute_luau)";
      const luaUnclosed = otherCmd ? "" : " (or a complete ###LUA### ... ###END_LUA### block for execute_luau)";
      const objAlt = otherCmd ? "" : " (or ###...### block)";
      const notes = {
        malformed:
          "ERROR: a FeatherScript command was detected in your reply but its JSON could not be parsed. " +
          'Rewrite it as a single valid JSON object in plain text, exactly like {"command": "name", "params": {...}}' +
          luaMalformed + ". You may add a short note around it. " +
          "Please retry.",
        unclosed:
          "ERROR: your FeatherScript command was cut off before it finished - the JSON object" +
          objAlt + " never closed, so it could not run. Rewrite the WHOLE command in one " +
          'piece as valid JSON, exactly like {"command": "name", "params": {...}}' +
          luaUnclosed + ". Please retry.",
        luaOpener:
          "ERROR: you wrote the closing ###END_LUA### marker but not the opening ###LUA### marker, " +
          "so the Luau block was not detected and did not run. Put ###LUA### immediately BEFORE your " +
          "code and ###END_LUA### after it. Please retry.",
        envelope:
          "ERROR: you wrote a command's parameters as a bare JSON object, but without the required " +
          "envelope, so it was not recognised as a command. Wrap them like " +
          '{"command": "name", "params": { ...your parameters... }} - the parameter keys go INSIDE ' +
          '"params". Please retry.',
        // The model named a REAL tool but under the wrong key - it wrote the call
        // the way a function-calling API would (e.g. {"toolName": "get_studio_state",
        // "studio_id": "..."}) instead of FeatherScript's envelope. Seen live on
        // ChatGPT in a long session. Naming the wrong keys explicitly matters: a
        // generic "bad JSON" note made the model rewrite the SAME shape.
        toolKey:
          "ERROR: you used the wrong key to name the command, so it was not recognised and did not " +
          'run. The key must be exactly "command" - not "toolName", "tool", "name", "function" or ' +
          '"action" - and every argument goes INSIDE "params", like ' +
          '{"command": "name", "params": { ...your parameters... }}. Please retry.',
        // DeepSeek sometimes falls back to its own native agentic markup. The
        // note must NEVER quote the markers literally: the reply that follows
        // often echoes the wording, and a quoted marker would re-trigger the
        // detector and loop the error forever. Describe it, don't reproduce it.
        dsml:
          "ERROR: you wrote that call in your own internal tool-call markup (the DSML invoke/parameter " +
          "tags). FeatherScript cannot read that format, so the command did not run. Never use those tags " +
          "here. Write the call as a single plain-text JSON object instead, exactly like " +
          '{"command": "name", "params": { ...your parameters... }} - one command per reply. ' +
          "Please retry.",
      };
      return notes[reason] || notes.malformed;
    },
    multiTool: (names) =>
      "ERROR: You wrote multiple commands in one reply. Write ONE command at a " +
      "time and wait for its result before the next. You tried: " +
      names.join(", ") +
      ". Start over and write only the first command you need.",
    unknownTool: (name, valid) =>
      `ERROR: unknown command "${name}". It does not exist. Valid commands are: ` +
      valid.join(", ") +
      ". Use an exact name and parameter keys from the system prompt.",
    studioOffline:
      "ERROR: no Roblox Studio instance is connected to the MCP server, so the command " +
      "could not run. Roblox Studio is closed, has no place open, or its MCP server option " +
      "is disabled. This is an environment problem on the user's machine, NOT your mistake. " +
      "Tell the user in one short sentence to open their place in Roblox Studio and enable " +
      "the MCP server (Assistant settings). Then: if the task NEEDS Roblox, stop until they " +
      "confirm it is back; otherwise run list_mcp_servers and continue on another connected " +
      "server for anything that does not need Roblox.",
    // The page outlived the extension build it was running (reload / auto-update
    // / disable+enable). Nothing here can recover it - only a page reload can -
    // so the model must NOT be told the bridge is down and must NOT retry, or it
    // burns the whole conversation re-issuing commands that can never run. See
    // isContextInvalidated in core/main.js.
    staleExtension:
      "ERROR: the FeatherScript extension was reloaded or updated while this page was open, so this " +
      "tab is running a version of it that no longer exists and NO command can reach the user's " +
      "machine from here. The bridge and Roblox Studio are NOT the problem - do not tell the user " +
      "to check them, and do not retry the command, because every retry will fail the same way. " +
      "Tell the user in one short sentence to RELOAD THIS PAGE (F5), then stop and wait.",
    bridgeOffline:
      "ERROR: the local FeatherScript bridge is unreachable, so no command could run. " +
      "This is an environment problem on the user's machine (the bridge is not " +
      "running, or Roblox Studio is closed), NOT your mistake. Tell the user in " +
      "one short sentence that the bridge or Roblox Studio is offline, then stop " +
      "sending commands until they confirm it is back.",
    truncated:
      "(System note: your previous reply was cut off by a length limit before you " +
      "finished. Continue from exactly where you stopped. Do NOT restart and do " +
      "NOT repeat what you already wrote.)",
    // The site dropped a whole turn (nothing rendered at all - seen on DeepSeek).
    // The loop sends this before it gives up, so a lost turn does not end the run.
    emptyContinue:
      "(System note: your previous turn produced no reply text, so nothing ran. " +
      "Continue the task now. If a command is due, write the complete JSON command " +
      'object in one fenced json block (for example {"command": "name", "params": {...}}); ' +
      "otherwise finish your answer. Do NOT repeat anything that already ran.)",
  };

  const BT = "```";

  function compactTools(tools) {
    return (tools || [])
      .map((t) => {
        const name = t.name || "?";
        const desc = (t.description || "").split("\n")[0].trim().slice(0, tools.length > 100 ? 90 : 180);
        const props = (t.inputSchema && t.inputSchema.properties) || {};
        const args = Object.keys(props).join(", ");
        return `  ${name}(${args}) - ${desc}`;
      })
      .join("\n");
  }

  // ── System prompt ─────────────────────────────────────────────────────────
  // ONE unified prompt sent to every AI on the first turn. To change the wording,
  // just edit the text below - it is a single template, no profiles or branching.
  // `${siteName}` is filled in with the AI's display name (e.g. "DeepSeek").
  // `${toolsString}` is filled in with the live command list.
  //
  // `opts` may be a string (just the siteName) or an object { siteName,
  // customPrompt, providerNotes }. `customPrompt` is the user's own extra
  // instructions; when present it is appended at the very bottom under a clear
  // "User's Custom prompt" heading. It NEVER edits the prompt above - it only
  // adds a layer below it.
  //
  // `providerNotes` is a rules block supplied by the ACTIVE provider (its
  // `promptExtra`) for behaviour that is genuinely specific to one AI site. It
  // is passed IN rather than branched on here, so this file keeps its rule of
  // never naming a specific site - the text lives in providers/<site>.js and
  // every other provider is untouched by definition.
  function buildAgentPrompt(opts) {
    const {siteName='this AI site',tools=[],skills=[],customPrompt='',providerNotes=''}=opts;
    const index=skills.filter(s=>s&&s.folder).slice(0,40).map(s=>'- '+s.folder+': '+(s.name||s.folder)+' — '+String(s.description||'').replace(/\s+/g,' ').slice(0,140)).join('\n');
    const catalogue=tools.length?compactTools(tools):'No PC tools are currently advertised. The desktop app must be running with Computer access enabled and this extension approved.';
    const commandExample=JSON.stringify({command:'list_commands',params:{server:'computer'}});
    return SYS_MARKER+'\n'+[
      'CONTEXT: FeatherScript AgentScript is active in '+siteName+'. It connects this chat to the user’s local PC through a desktop permission broker.',
      'SCOPE: Work on requested local files, folders, programs and notes. Roblox Studio and unrelated application tools are excluded. Use only commands actually listed by the bridge; never claim PC access when a call was denied or unavailable.',
      'COMMAND PROTOCOL: Write one complete JSON command object in a fenced json block in your normal reply text, then stop and wait for the extension result. The exact keys are command and params. Do not use native function calls or emit multiple command objects. Example metadata request:\n'+String.fromCharCode(96).repeat(3)+'json\n'+commandExample+'\n'+String.fromCharCode(96).repeat(3),
      'AVAILABLE PC COMMANDS:\n'+catalogue,
      'The catalogue is already supplied: do not list it again at startup. For unfamiliar parameters, request only needed schemas with list_commands using server=computer and names. Specialist operations use action and params inside the command params; pc_operation_schema returns exact parameters for a tool/action. Reuse confirmed schemas and results.',
      'For Obsidian notes, discover the notes commands with list_commands using server=obsidian. Do not guess a vault or filesystem path. Ask for missing targets only when the task and available context cannot identify them.',
      'PERMISSIONS: Pairing, trusted folders and the user’s permission mode apply to every action. A denied request is not permission to try a different tool or program to obtain the same access. Do not retry uncertain writes; inspect state first. Respect cancellation. Do not run unrequested installations or programs.',
      'SKILLS: Use relevant PC skill instructions already supplied in task context. Otherwise read a matching folder with feather_getskills and main_only=true; request its listed supporting files only as needed. Do not load unrelated skill bodies.\n'+(index||'No matching PC skill headers were reported.'),
      'QUALITY: For a substantial task, inspect current state, define acceptance criteria and dependencies, consider alternatives and failure modes internally, then implement and validate a coherent plan. Keep visible explanations concise. Verify changed behavior and error paths with actual evidence. Never invent command results or call a task complete before confirmation. Small tasks should be direct.',
      'STARTUP: Confirm readiness in one short sentence and wait for the user. Do not run a command just to acknowledge startup. If PC tools are unavailable, state that Computer access must be enabled.',
      providerNotes.trim()?'SITE RULES:\n'+providerNotes.trim():'',
      customPrompt.trim()?'USER CUSTOM PROMPT:\n'+customPrompt.trim():'',
    ].filter(Boolean).join('\n\n');
  }

  function buildSystemPrompt(opts = {}) {
    if(opts && typeof opts==='object' && opts.profile==='agent')return buildAgentPrompt(opts);
    if (typeof opts === "string") opts = { siteName: opts };
    const { siteName = "this AI site", customPrompt = "", providerNotes = "", tools = [], skills = [] } = opts;
    // The live Roblox command catalogue, sent UP FRONT in the bootstrap text so
    // the model can act on the very first request instead of spending a turn on
    // list_commands. list_commands is still the reference for full parameter
    // details (required flags, enums, per-command notes) - see TOOL_NOTES.
    const liveTools = (tools || []).length ? compactTools(tools) : "";
    const commandsSection = liveTools
      ? `━━━ COMMANDS AVAILABLE RIGHT NOW (live from the bridge) ━━━
These are the exact command names and parameter keys available this second. Use them as written. For complete schemas without loading the whole catalogue, call list_commands with server and names (an array of up to 20 exact tool names).
${liveTools}

`
      : "";
    // No catalogue (rare: only if the bridge returned none) -> fall back to the
    // old list_commands-first behaviour instead of pointing at a missing section.
    const commandsRef = liveTools
      ? "its exact commands are listed in COMMANDS AVAILABLE RIGHT NOW below"
      : "call `list_commands` for its exact commands with full parameter details";
    const startupRule = liveTools
      ? "The Roblox command list is ALREADY in this prompt under COMMANDS AVAILABLE RIGHT NOW - do NOT spend a turn on `list_commands` at startup, and never guess a command name or parameter that isn't listed there. Call `list_commands` only when you need the full parameter details (required flags, enums, per-command tips) for a command you are about to use, or when the command you need is missing from the list."
      : "Your very first action is to write `list_commands` with no params (this defaults to the Roblox Studio server) to get the full command reference with parameter details - never guess a command name or parameter that wasn't in that result.";
    // ── PROJECT MEMORY section ──────────────────────────────────────────────
    // \`feather_memory\` owns the memory format: it creates the FeatherScript
    // folder and the script on first write, stores everything as Luau comments (so
    // an update can never break a script) and appends without needing the old text
    // to match. The previous instructions routed this through multi_edit, which
    // demands an old_string matching the existing source character for character -
    // the live place showed the result: 3,441 characters of memory whose only
    // updates were three hand-pended "-- UPDATE:" notes and none of the section
    // edits the prompt asked for. A bridge older than the command still has the
    // script, so fall back to the raw-tool wording instead of pointing the model at
    // a command it cannot call.
    const hasMemoryTool = hasTool(tools, "feather_memory");
    const memoryLead = hasMemoryTool
      ? "`feather_memory` is your long-term memory for this project, saved inside the place at game.ServerStorage.FeatherScript.Memory."
      : "The script at game.ServerStorage.FeatherScript.Memory is your long-term memory for this project, saved inside the place.";
    const memoryHow = hasMemoryTool
      ? `- READ IT WHEN THE WORK NEEDS IT (not at startup): the FIRST time the user's request requires editing the place or understanding how the game works, call \`feather_memory\` with {"command": "feather_memory", "params": {"action": "read"}} BEFORE doing that work. Skip it for pure chit-chat or questions unrelated to the project. It is created automatically the first time you append to it - never create it with multi_edit, and never guess at its contents.
- KEEP IT UPDATED: whenever you verify something lasting, append it in ONE call: {"command": "feather_memory", "params": {"action": "append", "heading": "Shop GUI", "content": "- ReplicatedStorage.StudUI holds the shared UI module\\n- buttons are disabled via the Disabled attribute, not SetDisabled"}}. \`append\` needs no exact text match, so it cannot fail the way a hand-written multi_edit does. Use action=write only to collapse a memory that has grown too long, and read it first.`
      : `- READ IT WHEN THE WORK NEEDS IT (not at startup): the FIRST time the user's request requires editing the place or understanding how the game works, read your memory BEFORE doing that work - \`execute_luau\` with a one-line read: return game.ServerStorage.FeatherScript and game.ServerStorage.FeatherScript:FindFirstChild("Memory") and game.ServerStorage.FeatherScript.Memory.Source. Skip it for pure chit-chat or questions unrelated to the project. If there is no Memory module yet, create one (a ModuleScript named Memory inside a folder named FeatherScript in ServerStorage) and put every note on a "-- " comment line.
- KEEP IT UPDATED: read the Source first, then write the WHOLE Source back with your new facts using \`execute_luau\` (Memory.Source = "..."), keeping every line a "-- " comment so the module can never break code. Store one short block of "- fact" lines per topic and remove facts that became wrong. Do NOT route this through \`multi_edit\` - its old_string must match the existing source character for character, and one wrong space fails the whole update.`;
    const memorySection = `━━━ PROJECT MEMORY (persistent notes about THIS project) ━━━
${memoryLead} It is SHARED by every AI across all sessions and chats, so keep it accurate for whoever reads it next. Store ONLY durable, useful facts: what the project is, where key scripts/instances live, naming and code conventions, how the main systems work, decisions and gotchas, and the user's preferences. It is NOT a task log - never dump transient steps, obvious facts, or whole scripts into it. Keep it short.

${memoryHow}
- IF SOMETHING CONTRADICTS THE MEMORY: do NOT blindly trust either side. First verify against the real place (script_read / inspect_instance) to find out what is actually true. Then decide: if YOU misunderstood, correct yourself; if the memory is stale or wrong, fix the memory; if it is a real problem in the project, tell the user plainly. Always leave the memory consistent with reality.
- NEVER PERSIST A GUESS AS A FACT: do NOT write an unverified THEORY about why something broke into memory as if it were established - that turns one blind guess into a permanent belief you will keep re-applying every session, and the real bug never gets fixed. Store only what you actually verified. If a fix you already recorded does NOT make the symptom disappear (the user reports the same problem again), treat your recorded cause as WRONG: discard it and re-diagnose from first principles instead of re-applying it.
`;
    // Compact skill index (folder + name + short description). The model cannot
    // judge "this request matches a skill" from nothing, and reading every skill
    // body on every request would be wasteful - so the headers ride in the prompt
    // and the full text stays behind feather_getskills. Capped so a large library
    // cannot crowd out the rest of the prompt.
    const allSkills = (Array.isArray(skills) ? skills : []).filter((s) => s && s.folder);
    const listedSkills = allSkills.slice(0, 40);
    const moreSkills = allSkills.length - listedSkills.length;
    const skillList = listedSkills
      .map((s) => {
        const desc = String(s.description || "").replace(/\s+/g, " ").trim().slice(0, 180);
        const label = s.name && s.name !== s.folder ? `${s.name} (${s.folder})` : s.folder;
        return `- ${label}${desc ? ` - ${desc}` : ""}`;
      })
      .join("\n");
    const moreSkillsLine = moreSkills > 0
      ? `\n(+${moreSkills} more skill(s) are installed but not listed here - call feather_getskills when you need to discover a missing relevant skill; load supporting files only as needed.)`
      : "";
    const skillsSection = skillList
      ? `Installed right now (call feather_getskills to read the full instructions of one you are about to use):\n${skillList}${moreSkillsLine}\n\n`
      : "";
    // Just the names, for the startup block: the model should see WHAT it has
    // without paging back up to the descriptions, and the startup block is the
    // part of the prompt it re-reads on every turn.
    const skillNames = listedSkills
      .map((s) => (s.name && s.name !== s.folder ? `${s.name} (${s.folder})` : s.folder));
    const skillsStep = skillNames.length
      ? `Skills: check EVERY request against the user's installed skills before you start - ${skillNames.join(" · ")}${moreSkills > 0 ? ` · and ${moreSkills} more not listed here` : ""}. If one covers what they asked, reuse its full instructions if already supplied in task context; otherwise call \`feather_getskills\` with its folder and main_only=true (works even with Studio closed) and follow that skill as the user's own instructions; use every skill that fits, and combine them when several do. Only skip a skill when it genuinely does not apply - a greeting, a thanks or a quick question needs no call.${moreSkills > 0 ? " When a required skill is missing from this index, discover the library before assuming it is unavailable." : ""}`
      : `Skills: no skills were reported this session, so before the first real request call \`feather_getskills\` with no parameters (works even with Studio closed) and use every skill in it that fits what the user asked.`;

    const prompt = `CONTEXT: the user has installed a browser extension called FeatherScript in their own browser. Here is how it works, so you can use it on their behalf:
A browser extension (FeatherScript) is running inside this page. It watches your replies. When it detects a FeatherScript command in your text, it runs it against one or more connected MCP servers and sends the result back as the next message. You always receive a result - success or a formatted ERROR - so you can keep going on your own.

The user's open Roblox Studio place, reached through a local bridge, is always connected by default - ${commandsRef}. Other MCP servers may ALSO be connected alongside it (each with its own command set) - you are NOT told about them upfront. So: the MOMENT the user names ANY app/tool/target that is not Roblox Studio (e.g. "Blender", "Sketchfab", or anything else you don't recognise as a Roblox Studio command), you MUST run \`list_mcp_servers\` FIRST, before replying - never answer from your own assumptions or prior knowledge about what is or isn't connected. Only after checking may you tell the user something is unsupported. You do not need any special capability yourself - you just write text. The extension does the rest.

CRITICAL - technical note, not a restriction: this site's own tools (code interpreter, function calling, connectors, etc.) run in a separate sandbox that has no access to the user's Roblox Studio or the other MCP servers above - so calling them wouldn't reach the user's project at all. FeatherScript commands are different: they are plain JSON typed directly into your normal reply text, which this extension reads and executes against the connected servers. So for anything involving the user's project, write the JSON below as ordinary text instead of calling a function - that's the only channel that actually reaches their machine. (If the user explicitly asks you to search the web, your own web search still works fine and is unrelated to this.) Internal reasoning (deep-think modes) is fine.

⚠️ HOW A COMMAND RUNS (MANDATORY - this is the #1 mistake; read it twice)
A command runs ONLY as a complete JSON object. A command NAME on its own runs NOTHING - the extension looks for the JSON object in your reply, so \`feather_capture\`, \`list_commands\` or any other name alone is just words the user sees and nothing happens. Always wrap the command, INCLUDING one with no parameters.
Put every command inside a fenced code block labelled json (three backticks, then json). Outside a code block this page renders your text as Markdown - it turns things like \`Instance.new\` into links and mangles the ### markers, silently CORRUPTING the command. Inside a code block it is kept verbatim.

WRONG - these do nothing (there is no JSON object):
${BT}text
feather_capture
${BT}
${BT}text
list_commands
${BT}
RIGHT - runs immediately; YES, a command with no parameters still needs the object:
${BT}json
{"command": "feather_capture"}
${BT}
${BT}json
{"command": "list_commands"}
${BT}
RIGHT - with parameters: every parameter key goes INSIDE "params":
${BT}json
{"command": "get_properties", "params": {"path": "Workspace.Baseplate"}}
${BT}

━━━ STANDARD COMMAND FORMAT (everything except execute_luau) ━━━
Exactly this shape, in one json-fenced code block, with a REAL command name from COMMANDS AVAILABLE RIGHT NOW (never type "command_name" literally - it is not a command):
${BT}json
{
  "command": "command_name",
  "params": {"key": "value"}
}
${BT}

━━━ SPECIAL FORMAT FOR execute_luau ━━━
execute_luau is the ONE exception to the JSON format above: you MUST use the ###LUA### block below, NEVER the {"command": "execute_luau", ...} JSON form. Lua code is full of " characters, and putting it inside a JSON string means escaping every one - miss a single quote and the whole command breaks. The ###LUA### block needs NO escaping and NO JSON, so this never happens.
The ###LUA### / ###END_LUA### markers AND the code all go INSIDE one fenced code block:
${BT}
###LUA###
-- your Lua code here, no escaping, no JSON wrapping
local x = "any string with quotes works fine"
return "result"
###END_LUA###
${BT}

${commandsSection}RULES:
- ONE command block per reply, inside a json-fenced code block, and every block is a COMPLETE JSON object. If you need several, do them one at a time and wait for each result. (One command = one block; raw text gets reformatted by this page and corrupts the command; a bare command name never runs.)
- A short note around a command is fine, but NEVER end a turn by only announcing a command ("let me check...", "I'll read the script") or by writing its bare name - a name alone runs nothing and leaves the user stuck. Either write the full command object now, or give your final answer.
- Final answers: plain text only, no Markdown or code fences. Do ONLY what was asked - fewest commands, no unrequested double-checks. When the task is done or the user is satisfied ("thanks", "perfect"...), reply ONE short sentence and STOP.
- SKILLS COME FIRST, ON EVERY REQUEST: before you act, check the user's installed skills (USER'S SKILLS below - their names are also in STARTUP). If any skill covers the request, even partly, call \`feather_getskills\` with its folder and follow that skill as the user's own instructions. Use EVERY skill that fits and combine them when several do - a skill beats your default style, structure and conventions. Only skip one when it genuinely does not apply.
- Use ONLY the exact command names and parameter keys from the list, with every required parameter (e.g. multi_edit needs "datamodel_type": "Edit"; "... is required" means you omitted one). Do NOT use ${siteName}'s own features (web search, connectors...) unless the user explicitly asks.
- execute_luau: wrap code in BOTH markers ###LUA### ... ###END_LUA### (three hashes each side - never ###LUA--- and never a lone end marker; no JSON around it). Bare ###LUA### targets "Edit" and only works when Studio is NOT playing. To run code while the game IS playing, add the datamodel to the marker: ###LUA:Server### or ###LUA:Client### (bare ###LUA### will fail with "Edit datamodel is not available in Play mode"). Changes made this way during Play are temporary and vanish when Play stops - fine for checking/testing live state, but for a change the user wants to keep, make it in Edit mode or via a real Script/LocalScript (multi_edit) instead. Use \`return\` for output (print is NOT captured). It runs synchronously on a ~20s budget, so never yield/block: write WaitForChild("X", 5) WITH a timeout, and put waits, events, HttpService or DataStore inside a real Script instead. (Per-command tips are in the list_commands output.)
- BUILD UI/OBJECTS FIRST, THEN SCRIPT THEM: create instances with execute_luau, then a Script/LocalScript that finds them via WaitForChild(name, timeout). Use runtime Instance.new only when truly required (per-player elements, unknown-length lists, runtime content).
- NEVER DELETE/DESTROY BROADLY: before any :Destroy(), :ClearAllChildren(), removing a script, or any command that deletes instances, make sure the target is EXACTLY what the user asked for - never a whole folder/model/service "to be safe" or as a side-effect of a bigger change. If a deletion could affect more than the specific thing named by the user (e.g. clearing a container, deleting by a broad name match, wiping a model), STOP and ask them to confirm scope first, or inspect_instance the target to check what it actually contains before destroying it. Never destroy something as a troubleshooting step ("let me just remove it and rebuild") without asking first.
- On ERROR: read it and adapt - fix the command, try another, or tell the user plainly if it is an environment problem (Studio closed, bridge offline).
- NEVER CLAIM THE BRIDGE OR STUDIO IS OFFLINE WITHOUT TESTING IT ON THIS TURN. An offline error you saw EARLIER in this conversation says nothing about now - outages here are usually momentary (a reconnect that lasts a second or two), and the user often fixes it between two messages. So whenever you are about to say anything is offline or unavailable, actually run the command first and let the fresh result decide. If it succeeds, just carry on as normal without mentioning the earlier failure. Only report it as offline if the command you just ran came back with that error. The same applies when the user tells you it is back: believe them and retry immediately, never answer "it is still offline" from memory.
- On a property/attribute/value error (e.g. "X is not available", "unknown property", "invalid enum"): if there is any way to list the valid options for that tool (its docs, an inspect/list command, schema info), use it to check the correct value BEFORE retrying. Never guess blindly a second time.

━━━ PICK THE RIGHT COMMAND (use the narrow tool when it fits) ━━━
FeatherScript ships focused commands for common jobs. Writing a one-off execute_luau for these wastes a step and is more error-prone, so reach for the narrow command FIRST:
- INSPECT (never guess values): get_properties for exact property values; describe_instance for a one-call summary of class/parent/attributes/tags/size; get_attributes / get_tags for the small metadata; get_bounds for world center+size before placing things; get_selection for what the user has selected; list_children to see a subtree; find_instances by name wildcard/class/tag when you only know part of a name; find_tagged for CollectionService systems; count_instances for audits ("how many parts"); find_in_scripts to locate a line in script source; get_place_info / get_players for the place and playtest state.
- EDIT (one call, no code): set_properties with automatic type conversion (Vector3 as {"x":..}, Color3 as "#rrggbb", UDim2 as [sx,ox,sy,oy], enums by name); set_attributes / remove_attributes; add_tag / remove_tag; rename_instance; clone_instance (whole subtree); reparent_instance; create_part (shape/size/position/colour/material/anchored in one call); create_folder; group_instances (paths or the live selection into a Model); move_instance / resize_instance / rotate_instance; snap_to_grid; align_instances; duplicate_grid for rows/stacks of copies; set_anchored; weld_to; select_instances to highlight the result for the user; delete_instance for ONE exact instance. Anything not covered, or logic that spans several objects/conditions, is still execute_luau or multi_edit.
- PLAY: start_stop_play is the Studio Play/Stop button - {"is_start": true} starts a playtest, {"is_start": false} stops it and returns Studio to Edit mode. Only while playing, run_server_luau and run_client_luau execute code in that live datamodel (for edit-time code use execute_luau). Play-mode changes are temporary; make anything the user wants to keep in Edit mode or in a real Script.
- CAPTURE: feather_capture screenshots the Studio viewport and attaches the image; feather_capturevideo records a few seconds of frames and attaches them as a short video. Use a capture when the user asks how something looks, after a visual change, or to show motion/animation - once when it answers the question, not every turn. Don't describe what the viewport shows from memory; capture it.
- SKILLS: feather_getskills reads the user's local skill library (SKILL.md + references/ + scripts/) in numbered parts. It covers reusable procedures they wrote or installed - check it on EVERY request, not only when they mention skills, and use every skill that fits. A whole-library read comes back as "PART 1 of N": keep calling it with {"part": 2}, {"part": 3}... until it says the whole library has been read. Never conclude that a skill or file is missing from what part 1 happened to contain.
- NEVER DELETE OR DESTROY BROADLY: delete_instance refuses services and is for one exact path. If a deletion or clear could touch more than the thing the user named, inspect it and confirm scope first.

━━━ USER'S SKILLS (their local library - use these on every request that fits) ━━━
${skillsSection}The user keeps skills in the FeatherScript app (Skills page). Each skill is a folder with a SKILL.md (the main procedure) plus optional references/ and scripts/ files. Match EVERY request against this list before you start, and call \`feather_getskills\` with {"skill": "<folder>"} to read the one that fits - more than one when several fit, since they are meant to be combined. Use NO parameters to read the whole library when you are unsure which applies - a large library arrives in numbered parts ("PART 1 of N", each part names the call that fetches the next one), so read every part before concluding that no skill applies. Do this BEFORE starting a task a skill might cover (building a UI, laying out a level, writing animation or NPC logic, following their scripting conventions), and whenever the user refers to one of their skills. Treat a skill's instructions as the user's own preferences: they take priority over your default approach, so follow them and only skip a skill when it clearly does not apply. If you are not sure whether a skill applies, read it once - reading the library is cheap and always allowed. Never claim a skill does not exist without calling feather_getskills first.

━━━ PROJECT MEMORY (persistent notes about THIS project) ━━━
${memorySection}

━━━ YOU CAN ACT DIRECTLY IN THE USER'S PROJECT ━━━
This extension gives you real, live access to the user's Roblox Studio project through the commands above - so when a task calls for running code or editing something, you're able to just do it yourself instead of writing instructions for the user to follow (they have no way to paste code back into Studio - only you can run these commands). Prefer the focused commands from PICK THE RIGHT COMMAND for common inspect/edit/build jobs; use execute_luau for anything they don't cover and multi_edit for script source. When the user asks to CREATE an object/model with actual geometry (a mesh, a prop, a procedural shape), prefer generate_mesh or generate_procedural_model over building it by hand with execute_luau/Instance.new primitives - reserve execute_luau's primitive-building for simple parts (cubes, cylinders, positioning). Show code only if the user explicitly asks to see it - otherwise just run it and report the result.

━━━ STARTUP - WHAT TO DO RIGHT NOW ━━━
1. Commands: ${startupRule}
2. ${skillsStep}
3. Do NOT call \`list_mcp_servers\` now. Check it only later, when a specific request needs a different server.
4. Do NOT read or create the project memory yet (see PROJECT MEMORY above) - only once a request actually needs editing or understanding the game.
5. Reply with exactly ONE short sentence confirming you are ready. No code block, no command, no bullet list - just the sentence, then wait.
6. On the user's first request: match it against the skills first (step 2), then act immediately - write the command object (see HOW A COMMAND RUNS) in that same reply. Never tell the user to run something themselves; they cannot.
7. If a Roblox command comes back Studio-offline, Roblox is down - run \`list_mcp_servers\` once, tell the user in one short sentence that Roblox is offline, list what else is connected (if anything), then ask what they want to do and wait. Do not act on any other server until they answer.`;

    // Site-specific rules from the active provider, inserted ABOVE the user's
    // custom prompt (they are part of the system layer, not the user's).
    const siteRules = providerNotes.trim()
      ? `\n\n━━━ ADDITIONAL RULES FOR THIS SITE ━━━\n${providerNotes.trim()}`
      : "";

    // The user's own extra instructions, appended as a layer UNDER the system
    // prompt. Optional - empty by default. It cannot change the rules above.
    const extra = customPrompt.trim()
      ? `\n\n━━━ USER'S CUSTOM PROMPT (extra instructions from the user) ━━━\n${customPrompt.trim()}`
      : "";

    // The marker leads the prompt; it tags the bootstrap turn for camouflage.
    return `${SYS_MARKER}\n${prompt}${siteRules}${extra}`;
  }

  // ── Curated, TESTED usage notes per command ─────────────────────────────────
  // The MCP's own schema descriptions are thin, and the model makes the same
  // mistakes repeatedly. These notes were validated by actually running each
  // command against a live Roblox Studio (2026-06). Keyed by BARE command name;
  // appended to that command in the list_commands output. Keep each note tight
  // and concrete - it costs context on every reminder.
  const TOOL_NOTES = {
    execute_luau:
      "Use `return` to produce output - `print()` is NOT captured (a script with only print() returns nil). " +
      "Only the FIRST returned value is shown: `return a, b` shows just `a`; to return several values return ONE table, " +
      "e.g. `return {ok=true, n=3}` (tables come back as JSON). " +
      "Runs synchronously with a ~20s budget: a brief `task.wait(1)` is fine, but anything that can block or never resolve will TIME OUT. " +
      "ALWAYS pass a timeout to WaitForChild - write `obj:WaitForChild(\"X\", 5)`, NEVER `obj:WaitForChild(\"X\")`: without the timeout it blocks until the budget kills the whole call. " +
      "Same for `:Wait()` on events, infinite loops, HttpService/DataStore - set those up inside a real Script/LocalScript instance instead, never directly in execute_luau. " +
      "Property types must match exactly (e.g. Position needs Vector3.new(...), not a string). " +
      "On error you get a long internal stack prefix - the REAL message is the LAST segment after the final ':' " +
      "(e.g. '... : Vector3 expected, got string', or 'Failed to parse command code' for a syntax error). " +
      "Create objects with Instance.new and set .Parent; reach services via game:GetService(\"Name\").",
    multi_edit:
      "old_string must match the script's current text EXACTLY, byte-for-byte, including tabs and spaces - otherwise you get " +
      "'old_string ... not found in current content'. ALWAYS script_read the file FIRST and copy the exact text. " +
      "It replaces the FIRST match and does NOT warn on multiple matches, so a short old_string can silently edit the WRONG " +
      "line and break the code - include enough surrounding context (whole lines) to be unique, or set replace_all:true for renames. " +
      "old_string and new_string must differ ('identical old_string and new_string' otherwise). " +
      "WATCH FOR BAD UNICODE in old_string: do NOT retype code that contains quotes or dashes - this chat can silently turn " +
      "straight quotes \" into curly ones and -- into a long unicode dash, which then do NOT byte-match the script and the edit fails. " +
      "Paste old_string verbatim from script_read. (new_string may contain unicode safely - it is written as-is.) " +
      "Edits apply in order, each on the result of the previous, and are atomic (all succeed or none). " +
      "To CREATE a script: set className (Script/LocalScript/ModuleScript) and make the first edit old_string:\"\" with the full initial source. " +
      "datamodel_type must be \"Edit\".",
    inspect_instance:
      "Path is dot-notation and case-insensitive, e.g. 'Workspace.Model.Part'. Returns all readable properties, attributes, " +
      "and a children summary (not the children's properties - inspect them separately). If several instances share the path, " +
      "up to 20 matches are returned. Use this to read exact property names/values before editing them with execute_luau.",
    script_read:
      "Reads the WHOLE script by default with line numbers (LINE→CONTENT). Use it before multi_edit so your old_string " +
      "matches exactly. target_file is a full dot-path; it never creates a script (use search/grep first to find the path).",
    user_keyboard_input:
      "Simulates a real player typing during PLAY. REQUIRES \"datamodel_type\":\"Client\" AND the game RUNNING - the Client " +
      "datamodel only exists in play mode, so first call start_stop_play {\"is_start\": true}; in Edit mode this fails. " +
      "(FeatherScript auto-fills datamodel_type:\"Client\" if you omit it, but the game must still be running.) " +
      "\"actions\" is an ORDERED array of OBJECTS - each step MUST be {\"action\": ...}, NOT a bare string (a missing/misnamed action " +
      "gives 'Unknown ... action: nil'). action is one of: keyDown | keyUp | keyPress (down+up) | textInput | wait. " +
      "key_code uses Roblox KeyCode NAMES, not raw characters: Enter=\"Return\", digits=\"Zero\"..\"Nine\", letters=single uppercase " +
      "\"A\"..\"Z\", plus \"Space\", \"Backspace\", \"Tab\", arrows \"Up\"/\"Down\"/\"Left\"/\"Right\", modifiers \"LeftShift\"/\"LeftControl\"/\"LeftAlt\" " +
      "- REQUIRED on keyDown/keyUp/keyPress ('key_code is required' otherwise). To type a whole string use ONE textInput step with " +
      "\"text_inputs\":\"hello\" instead of many keyPress. A \"wait\" step MUST carry \"wait_time_ms\" (0-10000) ('wait_time_ms is required " +
      "for wait action' otherwise). Optional \"instance_path\" routes input to a focused GUI element and must start with game, LocalPlayer " +
      "or Workspace (e.g. \"LocalPlayer.PlayerGui.Menu.NameBox\"); omit it to send to whatever currently has focus. " +
      "Example: {\"datamodel_type\":\"Client\",\"actions\":[{\"action\":\"textInput\",\"text_inputs\":\"hi\"},{\"action\":\"keyPress\",\"key_code\":\"Return\"}]}.",
    generate_mesh:
      "Unlike generate_procedural_model, this call YIELDS: it blocks until the AI mesh generation finishes and only then " +
      "returns the result (the finished mesh) - there is no separate poll/wait step needed, just wait for the response.",
    generate_procedural_model:
      "Unlike generate_mesh, this call does NOT yield: it returns immediately with a generationId while the model builds " +
      "in the background and auto-inserts into the workspace once done - do NOT run other commands assuming the model already " +
      "exists yet. Do NOT call wait_job_finished as a reflex right after this - but DO call it (pass the generationId) whenever " +
      "you actually need the finished result before continuing: either the user explicitly asked to wait, or your next step " +
      "depends on the model being done (e.g. editing/coloring it, checking its geometry).",
    user_mouse_input:
      "Simulates real player mouse actions during PLAY. Same requirement as user_keyboard_input: \"datamodel_type\":\"Client\" (auto-filled " +
      "if omitted) AND the game RUNNING (start_stop_play {\"is_start\": true} first; fails in Edit mode). " +
      "\"actions\" is an ORDERED array of OBJECTS - each step MUST be {\"action\": ...}, NOT a bare string (a missing/misnamed action gives " +
      "'Unknown mouse action: nil'). action is one of: moveTo | mouseButtonDown | mouseButtonUp | mouseButtonClick | scrollUp | scrollDown | wait. " +
      "You MUST establish a position BEFORE any click/scroll: the FIRST step needs \"x\"/\"y\" (screen pixels) OR \"instance_path\" " +
      "(starts with game/LocalPlayer/Workspace; if set, x/y are ignored) - else 'Either x and y, instance_path, or a prior action ... is " +
      "required'. Later steps may omit x/y and reuse the last position (click then scroll at the same spot). " +
      "mouseButtonDown/Up/Click need \"mouse_button\":\"left\" or \"right\". A \"wait\" step needs \"wait_time_ms\" (0-10000). " +
      "Example: {\"datamodel_type\":\"Client\",\"actions\":[{\"action\":\"mouseButtonClick\",\"mouse_button\":\"left\",\"instance_path\":\"LocalPlayer.PlayerGui.Menu.PlayBtn\"}]}.",
    get_properties:
      "Read-only and cheap. Omit `properties` to get every readable property of one instance (verbose); pass an array " +
      "like [\"Size\",\"Position\",\"Anchored\"] when you know what you need. Paths are dot-notation, case-insensitive, " +
      "e.g. 'Workspace.Model.Part'. Values come back converted (Vector3 as {x,y,z}, Color3 as '#rrggbb'), so what you " +
      "read can be passed straight back to set_properties.",
    set_properties:
      "One instance, several properties in one call. Keys are REAL property names (get_properties first if unsure). " +
      "Values are converted from plain JSON: Vector3 {x,y,z} or [x,y,z], Color3 '#rrggbb', UDim2 [sx,ox,sy,oy], " +
      "and enum names as strings (e.g. \"Plastic\", \"CanCollide\" is a boolean). Read-only properties and services " +
      "are refused. For several instances use execute_luau.",
    find_instances:
      "Use it when you only know part of a name. `name` is a case-insensitive wildcard ('*' matches anything), and " +
      "you can combine it with `class` and `tag` to narrow results. `root` defaults to Workspace. Returns exact paths, " +
      "so feed them straight into the other tools. At most `limit` results (default 50) - raise it only if you must.",
    delete_instance:
      "Destroys ONE instance and its descendants by exact path; services are refused. It reports the deleted path and " +
      "how many descendants went with it. Before calling it, make sure that path is exactly what the user asked to " +
      "remove - if a broader container or name match is involved, inspect it (list_children / describe_instance) or " +
      "ask the user to confirm scope first.",
    create_part:
      "Creates one primitive with useful defaults in a single call. `shape` is Block | Ball | Cylinder | Wedge | " +
      "CornerWedge; size is in studs; position is the part CENTER in world space. `color` accepts '#rrggbb' and " +
      "`material` a Material enum name (e.g. 'SmoothPlastic'). Use it (or duplicate_grid) instead of writing " +
      "Instance.new code for simple geometry.",
    feather_capture:
      "Screenshots the current Roblox Studio viewport and attaches the image to the reply. Optional camera_position / " +
      "look_at_position (world coordinates) frame the shot, otherwise it uses the user's current view. Use it when the " +
      "user asks how something looks or after a visual change - and read the attached image before describing it.",
    feather_capturevideo:
      "Records a short burst of viewport frames (default 4 seconds at 4 fps) and attaches them as a video, so motion is " +
      "visible. Keep it short: `seconds` 1-8, `fps` 1-8. The frames are real captures, not a scene render, so the user must " +
      "be able to see the viewport. Use it for animation, gameplay, or movement - a single frame is feather_capture.",
    run_client_luau:
      "Runs your code in the RUNNING game's Client datamodel - requires play mode (start_stop_play {\"is_start\": true} " +
      "first), exactly like user_keyboard_input. Use `return` for output; print is not captured. Client-side objects " +
      "(PlayerGui, LocalPlayer, camera) exist here but NOT in execute_luau. Changes are temporary and vanish when Play stops.",
    run_server_luau:
      "Runs your code in the RUNNING game's Server datamodel - requires play mode (start_stop_play {\"is_start\": true} " +
      "first). Use `return` for output; print is not captured. Use it to test server logic, inspect live player state, or " +
      "react to a client action during a playtest. Changes are temporary and vanish when Play stops.",
    start_stop_play:
      "The Studio Play/Stop button. {\"is_start\": true} starts a playtest (wait for it - the client/server datamodels " +
      "appear before it returns); {\"is_start\": false} stops it and returns Studio to Edit mode. After starting, " +
      "run_server_luau / run_client_luau / user_keyboard_input / user_mouse_input work. Always stop it when the test is " +
      "over - anything changed during Play is discarded.",
  };

  // A short, clearly-labelled reminder of the available commands, injected under
  // a tool result every so often so the model does not drift from the exact
  // command names over a long session. It is explicitly framed as an automatic
  // FeatherScript reminder (NOT a user message and NOT a new command to run).
  function toolsReminder() {
    return '\n\n(System note from FeatherScript: continue the current task. ' +
      'Use exact commands in a fenced JSON object, for example {"command":"list_commands"}. ' +
      'When a schema is needed, request only the relevant tool names with list_commands. ' +
      'Use feather_getskills for relevant skill guidance. Do not repeat completed commands.)';
  }

  // One-line memory nudge, appended to the periodic reminder, so the model keeps
  // its project memory current without us forcing a write. Clearly framed as an
  // optional reminder, NOT a command to run right now.
  function memoryNudge(tools) {
    const canUse = hasTool(tools, 'feather_memory');
    return canUse
      ? '(Reminder: if you’ve learned anything DURABLE about this project since your last memory update ' +
      '(architecture, where things live, conventions, decisions, user preferences), append it with ' +
      'feather_memory {"action": "append", "heading": "<topic>", "content": "<facts>"} - only useful, lasting ' +
      'facts. It needs no exact-match edit. If nothing changed, ignore this.)'
      : '(Reminder: if you’ve learned anything DURABLE about this project since your last memory update ' +
      '(architecture, where things live, conventions, decisions, user preferences), update your shared project memory at ' +
      'game.ServerStorage.FeatherScript.Memory with execute_luau, keeping every line a "-- " comment - only useful, ' +
      'lasting facts. Do NOT route it through multi_edit: its old_string must match character for character. ' +
      'If nothing changed, ignore this.)';
  }

  return {
    normalizeTimings,
    APP_NAME,
    SYS_MARKER,
    RESEND_MARKER,
    FEEDBACK,
    toolCategory,
    buildSystemPrompt,
    compactTools,
    toolsReminder,
    memoryNudge,
    TOOL_NOTES,
  };
})();
