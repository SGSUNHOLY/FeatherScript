---
name: create-roblox-game
description: Turn a Roblox game idea into a clear design brief, a playable first slice, and a staged Studio implementation. Use for a new experience or a major feature whose rules and scope are not yet defined.
---

# Create a Roblox game

## Start with the player's loop

Translate the idea into a loop the player can try in a few minutes:

1. **Promise:** What role or fantasy does the game offer?
2. **Action:** What does the player repeatedly do?
3. **Feedback:** How does the game show that action worked?
4. **Progress:** What changes over a session and between sessions?
5. **Social play:** What do other players add, if anything?

State assumptions when the brief is incomplete. Prefer a small testable slice over a large feature list.

## Design brief

Write a compact brief before building:

- one-sentence concept and target audience;
- core loop, win/lose or session endpoint, and first-session objective;
- player actions and authoritative game rules;
- essential world, interface, audio, and feedback;
- multiplayer behavior and client/server ownership;
- save data needed for the slice, if any;
- target devices and input methods;
- explicit exclusions and success checks.

Keep the brief in chat unless the user asks for a file. If a project context file exists, update only the relevant fields.

## Build a vertical slice in Studio

1. Inspect the place and preserve its existing structure.
2. Greybox one complete loop with a spawn, one objective, readable feedback, and a clear reset or completion.
3. Add the minimum server-owned game rules and client presentation needed for that loop.
4. Add UI and audiovisual feedback only after the loop works.
5. Playtest the happy path, one failure case, and any multiplayer boundary involved.
6. Improve art, content, and persistence in separate passes so a failure can be isolated.

Keep all new instances in meaningful folders. Use names that communicate their purpose. Add a short comment only where a non-obvious game rule needs explanation.

## Progression and retention

Use rewards to reinforce the loop, not to hide missing fun. State what the player earns, what it unlocks, and how the experience communicates cost and value. Avoid inventing monetization or paid items when they were not requested. Never fabricate retention claims or success metrics.

## Validation

Define observable checks such as: a new player can identify the objective; the main action produces immediate feedback; invalid client requests cannot award currency; a reset returns the place to a valid playable state; a second client sees the same authoritative outcome.

Use Studio's client/server and multi-client test modes when the feature depends on replication. Check Output and viewport. Report which checks passed and which were not run.

For detailed work, read `roblox-code`, `roblox-map`, `roblox-ui`, and the relevant presentation skills. Consult [Studio testing modes](https://create.roblox.com/docs/studio/testing-modes) and the [reference index](../roblox-studio-setup/references/roblox-reference-index.md).
