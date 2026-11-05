---
name: roblox-code
description: Write, place, review, and debug Luau scripts in Roblox Studio. Use for gameplay systems, UI behavior, remotes, persistence, character logic, and engine API questions.
---

# Roblox Luau in Studio

## Inspect before editing

Find the existing script and its callers before adding another one. Confirm the exact class and location: server `Script`, client `LocalScript`, or shared `ModuleScript`. Check `Enabled`, `RunContext` where relevant, required modules, object names, and whether a test is currently running. Preserve the place's existing style and avoid duplicate systems.

Use Luau and current Roblox APIs. Prefer explicit types at module and system boundaries when they make contracts clearer. Keep functions small enough to inspect and give state one clear owner.

## Choose the execution side

| Responsibility | Typical location |
| --- | --- |
| Damage, rewards, inventory, purchases, permissions, match state | ServerScriptService or server ModuleScripts |
| Input, camera, local UI, local-only effects | StarterPlayerScripts, StarterCharacterScripts, or UI LocalScripts |
| Shared remotes and modules safe for both sides | ReplicatedStorage |
| Server-only templates/secrets | ServerStorage or server scripts |

Confirm the correct container for the specific API. A `ModuleScript` runs in the context of its caller; its folder alone does not make code server-side or client-side.

## Server authority and remotes

Treat every client remote call as untrusted input. The server should derive important values from server state and validate type, size, range, ownership, character state, timing, and current game phase before acting. Add per-player rate limits for requests that can be spammed. Never accept a client-supplied price, reward amount, target player, or saved record as authoritative.

Use `RemoteEvent` for asynchronous one-way messages. Use `RemoteFunction` only when a reply is needed immediately and a yielding request cannot stall progress. Use `UnreliableRemoteEvent` only for frequent data where loss or reordering is acceptable. Keep client presentation responsive, but let the server confirm the outcome.

## Persistence

Keep `DataStoreService` calls on the server. Handle errors, retries, player departure, and shutdown deliberately. Avoid saving every frame or on every small property change. Studio API access can reach real experience data: verify the target is an isolated test experience before enabling it. Never test destructive writes against production data.

## Code shape

- Cache service references locally at the top of a script.
- Prefer events and state changes over unbounded polling loops.
- Use `task.wait`, `task.delay`, and `task.spawn` when scheduling is appropriate; avoid legacy `wait`, `spawn`, and `delay` in new work.
- Keep connections, temporary instances, and tweens under explicit ownership; disconnect or destroy them when their owner ends.
- Use `pcall` for expected external failure boundaries such as data-store calls, not to silence arbitrary programming errors.
- Avoid `WaitForChild` without a reasoned timeout on paths that might never appear.
- Avoid per-frame work unless the behavior requires it. When it does, use the relevant RunService phase and measure before optimizing.
- Keep remote names, instance paths, and UI names consistent with the existing place.

## Debug in Studio

1. Read the full Output error, including the script path and line.
2. Verify the instance path and script execution side in Explorer.
3. Add short, targeted diagnostics with `print` or `warn`, then remove noisy temporary logs.
4. Test in the relevant client/server mode. For replication bugs, inspect both sides and use at least two clients when possible.
5. Test one normal case and one invalid or edge case.

Never claim a script is running because it parses or appears in Explorer. Run the test and inspect its outcome.

Read [code patterns](references/patterns.md), [common failure modes](references/traps.md), and the [security guide](https://create.roblox.com/docs/scripting/security/client-server-boundary) when relevant.

## Readability and comments

Use clear domain names and explicit ownership. Add comments where they explain intent, constraints, units or surprising behavior; omit comments that repeat obvious code. Keep them accurate after edits. Read [readability.md](references/readability.md) for a cleanup or substantial implementation.
