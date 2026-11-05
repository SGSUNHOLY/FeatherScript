---
name: roblox-camera
description: "Use when changing the camera: the camera type, field of view, zoom limits, mouse lock, screen raycasts, or a cutscene."
---

The camera is client-only. It is cosmetic, so it must never decide gameplay. Server code never moves a player's camera.

## Verified API (Roblox docs, checked for this skill)
- `Workspace.CurrentCamera` (type Camera). Camera properties: `CameraType` (type Enum.CameraType; the enum's values are on its own docs page), `FieldOfView` (number).
- StarterPlayer camera settings: `CameraMode`, `CameraMaxZoomDistance`, `CameraMinZoomDistance`, `EnableMouseLockOption`, `DevCameraOcclusionMode`, `DevComputerCameraMovementMode`, `DevTouchCameraMovementMode`.

## Rules
1. Set a player's camera from a LocalScript. The server may tell the client which view to use with a remote, but it does not set the camera.
2. Keep camera changes reversible. Save the previous `CameraType` and `FieldOfView` and restore them when the view ends, including when the player dies or leaves.
3. Use `StarterPlayer` settings for zoom limits and mouse lock; do not fight them every frame.
4. For a screen raycast from the cursor or screen centre, do it on the client and send only the chosen target to the server, which checks range and line of sight itself. (The raycast call and its parameters are UNVERIFIED in this skill: read the docs page before writing one.)
5. Give a cutscene a clean exit: restore the camera, re-enable controls, and handle the case where the player leaves mid-cutscene.
6. Any camera shake or tween is cosmetic. Make it cancellable and cap its strength.

## Checks
- Test first-person and third-person on a real run, and confirm the camera returns after each change.
- Test a death and a respawn during a custom view.

## Not checked by this skill
- The exact enum values of CameraType (read the enum's docs page).
- Behaviour on touch and gamepad. The user must test on those devices.
