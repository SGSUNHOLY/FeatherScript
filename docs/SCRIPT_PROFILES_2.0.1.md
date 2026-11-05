# Script profiles and seasonal UI

- The toolbar now selects RobloxScript or AgentScript. The previous RS/AS controls only switched status indicators; they are hidden.
- AgentScript receives a PC-specific startup prompt and command catalogue. Dispatch rejects Studio and other application tools in this profile.
- RobloxScript retains Studio tools, including connected Studio/plugin operations, plus shared PC, skills and notes tools. It excludes unrelated application MCP tools.
- Both profiles use the existing desktop PC broker: disabled access, pairing, trusted roots and Ask / Ask when unusual / Full access are preserved. The PC permissions shortcut opens the dashboard; it does not grant access.
- Profile selection is saved; each task snapshots its starting profile. A changed profile is sent with next-task policy context, preserving running work.
- Queue improvements: search, Copy prompt, clear completed jobs, Ctrl+Enter to enqueue, profile-specific starter prompts and clearer next-task profile tooltip. Failed, interrupted and uncertain jobs are kept for review.
- Halloween and Christmas are available in the shared app/extension theme catalogue (41 themes). Both add seasonal gradient surfaces, with no remote assets or extra animation loops. Text, muted labels and accents meet the theme builder's 4.5:1 contrast checks.

Use: restart the desktop app, reload the unpacked extension and refresh chat tabs. Choose a profile in the toolbar; choose seasonal themes in Appearance. PC permissions must be configured in the desktop app before PC tools can execute.

These profiles route extension commands; they are not OS security sandboxes. Approved programs run as the current OS user under the existing permission broker. Native AI-site tools are outside FeatherScript's command routing. Live provider/Studio plugin behavior still needs authenticated testing; no new plugin installation system or PC UI automation API is claimed.
