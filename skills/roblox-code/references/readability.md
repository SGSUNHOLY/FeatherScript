# Readable code and useful comments

Follow the existing project style. Improve the changed path without renaming unrelated systems, introducing a framework, or breaking public contracts.

## Shape the implementation

Use names that express the domain: selectedItemId, pendingPurchase and closeInventory are more useful than data2, flag and handleThing. Give shared mutable state one owner. Extract a helper when it expresses a real operation or removes meaningful duplication; avoid a wrapper for every property assignment.

Separate validation, state changes and presentation when those boundaries help testing or ownership. Keep an existing abstraction when it already serves the task. Make cancellation and cleanup explicit for async results, connections and tweens.

## Comment what the code cannot explain

Comment intent, constraints, units, unusual ordering and failure handling. A useful comment can explain why a server acknowledgement must precede a reward, why a response is ignored after navigation, or why a rig conversion preserves a rest transform. Keep the explanation next to the relevant code.

Do not narrate obvious assignments, add banners to every function, leave generated tutorial essays in production, or use comments to conceal confusing names. Document public contracts only when their callers need the information. Update or remove a comment when its assumption changes. Remove temporary debug logs and commented-out abandoned code.

For example, a short comment such as "Ignore the old selection's result after the player switches items" explains a request-version guard. "Increment version" merely repeats the statement.

## Verify the changed behavior

Use checks that protect actual contracts: invalid remote payload, repeated activation, cancellation, respawn, stale async response or cleanup after closing a screen. Pick the relevant cases rather than adding tests that mirror assignments. Compilation does not prove visual quality or multiplayer correctness; report the checks that actually ran.
