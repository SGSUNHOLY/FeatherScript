---
name: roblox-input
description: "Use when handling keyboard, mouse, gamepad or touch input, or binding one action to several inputs for cross-platform play."
---

Input is client-side. The client reads input and asks the server for an action; the server decides whether the action happens.

## Verified API (Roblox docs, checked for this skill)
- UserInputService properties: `GamepadEnabled`, `TouchEnabled`, `KeyboardEnabled`. Event: `InputBegan`.
- ContextActionService: `BindAction(actionName, functionToBind, createTouchButton, inputTypes)`, `UnbindAction(actionName)`, `BindActionAtPriority(actionName, functionToBind, createTouchButton, priorityLevel, inputTypes)`.
- The callback's arguments for BindAction are UNVERIFIED in this skill. Read them from the docs page before you write the callback.
- The `InputBegan` handler's parameters are UNVERIFIED here. Read the docs page before use.

## Rules
1. Bind an action, not a key. Use ContextActionService for anything a player can trigger from more than one device (jump, interact, attack). It gives touch buttons and gamepad support for free when `createTouchButton` is true.
2. Unbind on cleanup. An action bound and never unbound keeps firing after the screen closes.
3. Pick the device from the flags, not from guesses: check `GamepadEnabled` and `TouchEnabled` before you show device-specific hints.
4. Never let input decide gameplay. The client sends a request (for example "interact with this prompt"). The server checks range, cooldown and state, then acts.
5. Keep every menu reachable with a gamepad: focus order, a visible focus ring, and a Back action. The `ul-ui-builder` skill's "Gamepad and keyboard focus" section has the focus rules.
6. Bind priority only when two actions truly compete for one input. Use `BindActionAtPriority` for that case, and say which action wins and why.

## Checks
- Test each bound action on at least keyboard and gamepad (or say which one you could not test).
- Confirm no action is still bound after its screen is closed (print the bound set before and after).

## Not checked by this skill
- Touch layout on a real phone. The user must test it on a device.
- Cross-platform button names. Confirm each `Enum.KeyCode` name in the docs before use.
