---
name: roblox-ui
description: Design, build, and wire responsive Roblox ScreenGui and in-world interfaces in Studio. Use for HUDs, menus, shops, inventories, prompts, settings, and device-specific controls.
---

# Build Roblox UI

## Define the interaction

Before styling, identify the player's current task, the information they need, the primary action, its disabled/loading/error/success states, and how they leave or cancel. Keep visual hierarchy and wording consistent with the game.

## Build the hierarchy

Use a small, named tree under the correct container (`StarterGui` for on-screen UI, or a suitable SurfaceGui/BillboardGui for world UI). Group related content into Frames. Prefer `UIListLayout`, `UIGridLayout`, padding, and explicit layout order for repeated content. Keep one client controller responsible for a screen's state rather than scattering duplicate click handlers through descendants.

## Responsive layout

- Use scale for relationships to the parent and offsets where a stable pixel size is intentional; do not convert every dimension to scale blindly.
- Use `UISizeConstraint`, `UITextSizeConstraint`, `UIScale`, and `UIAspectRatioConstraint` only for the behavior they actually provide. Test edge sizes; constraints can force layouts into surprising positions.
- Set `AnchorPoint` deliberately and reason about the parent coordinate system.
- Use a safe `ScreenInsets` mode for interactive controls. Keep full-screen decorative backgrounds separate from buttons and status text.
- Design touch targets and mobile thumb space. Don't cover Roblox controls, notches, or the virtual thumbstick.
- Support keyboard/controller navigation where the experience targets those devices. Give buttons meaningful activation and selection states.
- Avoid relying on `TextScaled` for all labels. Use readable text sizes, wrapping or truncation intentionally, and test long translations.

## Wire behavior safely

Connect one handler per actionable control and make disabled/loading states real. The UI may predict an immediate animation, but server confirmation owns purchases, inventory, rewards, and match state. Validate all such requests on the server.

## Preview and test

1. Use Studio's UI editor and viewport to inspect the hierarchy and visual states.
2. Open Device Simulator and check at least a narrow phone, a larger screen, and each target input class.
3. Test button activation, focus order, navigation, loading, empty, error, and success states in Play mode.
4. Check that the main gameplay view remains visible and important UI stays inside safe areas.
5. Read Output for missing assets, infinite waits, and script errors.

Use [UI and UX design](https://create.roblox.com/docs/production/game-design/ui-ux-design), [size modifiers](https://create.roblox.com/docs/ui/size-modifiers), [ScreenInsets](https://create.roblox.com/docs/reference/engine/enums/ScreenInsets), and [Device Simulator](https://create.roblox.com/docs/studio/device-simulator) as the current API reference. See the [forum discussion on scaling across devices](https://devforum.roblox.com/t/scaling-ui-for-all-devices/1557833) as community context only.

## Absorbed from expert-gui

- Separate architecture from styling: one screen-state object, one controller, and view elements that only render what the state says.
- Budget UI cost: no per-frame rebuilds, no tween chains per frame, pooled repeated rows, and `TextScaled` kept off the hot path.
- Layout: align to a spacing scale, keep one primary action per screen, and let size and contrast carry hierarchy instead of many borders.
- Support keyboard/controller focus order and gamepad selection on every interactive element the experience targets.

Full detail: references/absorbed-expert-ui.md

## Absorbed from client-ui-safety

- The client may show state but the server decides it: purchases, inventory, rewards and match results are confirmed by the server before the UI treats them as true.
- Never read gameplay values back out of labels or text; read the state, then render it.
- Set `ResetOnSpawn` deliberately for every ScreenGui and rebuild or reconnect handlers when the player respawns.

Full detail: references/absorbed-client-ui-safety.md


## Visual polish

For a UI quality pass, read [visual-polish.md](references/visual-polish.md). Improve hierarchy, spacing, typography, meaningful states and responsive behavior together. Preserve the existing style; add motion or decoration only when it improves the interaction.
