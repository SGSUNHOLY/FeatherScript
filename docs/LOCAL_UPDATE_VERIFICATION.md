# Local verification — 2026-11-03

This update retains the original twelve chat providers and improves headless
Blender diagnostics, error handling and cleanup.

The full local regression suite passed: 67 Python tests ran, 66 passed and one
optional Luau compiler check was skipped because FS_TEST_LUAU was not configured.
JavaScript syntax, provider contracts, transport, queue, permissions, profiles and
layout checks passed.

Real Blender 5.2.3 LTS checks covered startup, primitive creation, persistent scene
inspection, CPU PNG rendering, saving, overwrite refusal, MCP stdio transport and
cleanup after an externally killed worker. Fault regressions cover broken pipes,
malformed replies, EOF, failed startup, diagnostic validation and cancellation.

Authenticated provider sessions and edits in a real Roblox Studio project were
not exercised. Passing local tests does not establish that the app is bug-free.

Restart FeatherScript and reload the unpacked browser extension after updating.
Test Blender from MCPs to verify startup and rendering on this computer. Existing
configuration, profiles, vault data and safe-mode settings are preserved.

## Extension controls and startup update

New local regressions cover the single profile selector, duplicate cleanup,
profile persistence, shared audio controls and mute, volume persistence when
closing the popup, one offscreen player, service-worker recovery and playback
failure reporting. A mixed Notion transcript fixture reproduces the missed
startup acknowledgement and verifies its discovery after the fix. Startup badges
no longer equate an available tool catalogue with a completed agent handshake.

Native Chromium checks decode and play the 33.6-second bundled PCM track with
test audio muted. Local DOM checks verify one profile group, exactly two buttons,
no dropdown, AgentScript selection, popup control visibility and narrow layout.
These checks do not replace an authenticated Notion session or a listening test
through the user's speakers.
