# Common Roblox scripting failure modes

- **Wrong script class or location:** the code never runs on the side that owns the needed API. Confirm Script, LocalScript, or ModuleScript and inspect client/server state.
- **Client-owned outcome:** a local UI reports a purchase as successful before the server accepts it. Wait for server confirmation and update durable state only on the server.
- **Trusted remote arguments:** validate every client argument and derive sensitive values from server state.
- **Infinite or fast polling:** repeated waits and scans create load. Use a signal, bounded cadence, or cached state.
- **Missing instance under streaming:** a client may not have the target instance yet. Make the system streaming-aware and handle absence cleanly.
- **Stale event connections:** character-bound events survive respawn or are connected more than once. Track ownership and disconnect on teardown.
- **Studio data access pointed at production:** test persistence against an isolated experience.
- **Hidden errors:** broad `pcall` blocks turn bugs into silent failures. Catch expected errors and log useful context.
- **Partial test:** edit-mode inspection cannot establish replicated or runtime behavior. Use Studio's test controls and inspect Output.
