---
name: roblox-sfx
description: Select, place, mix, and trigger audio for Roblox experiences in Studio. Use for ambient sound, UI feedback, character actions, music, and spatialized effects.
---

# Roblox audio in Studio

## Plan the sound

Record the event, listener, spatial behavior, repetition/cooldown, volume priority, and fallback if the asset cannot load. Choose assets from the Creator Store or use files the creator has permission to upload. Do not assume an asset ID is usable by this experience: confirm ownership and permissions.

## Use Studio audio tools

Use Studio's Toolbox/Creator Store or Asset Manager to find and manage audio. Prefer the current audio object workflow for new systems where it fits; use `Sound` and `SoundGroup` where they are appropriate for a small feature or already established in the place. Inspect the current audio docs before choosing an object graph.

Place positional audio on an Attachment or 3D object. Place non-positional music in the appropriate global audio path. Use SoundGroups or supported audio groups to control categories together. Keep ambience, music, UI, and gameplay cues at intentional relative levels.

## Trigger and clean up

Use the existing audio controller if present. Avoid one Sound per frame or duplicated loops after respawn. Preload only assets required for the immediate experience; don't block the game waiting on a large catalog of optional audio. Clean up one-shots when complete and stop loops when their owning state ends.

For a positional cue, inspect distance and rolloff in a live playtest. For music, verify transitions and volume controls. For replicated events, replicate the semantic event and let each client play the sound locally where appropriate.

## Permission and test

Never upload or publish an audio asset without the creator's intent. Check Output for asset permission or load failures. Test at the source point, at the expected hearing distance, and on another client when the sound should be shared.

Read [audio objects](https://create.roblox.com/docs/audio/objects), [Sound](https://create.roblox.com/docs/sound), and [audio asset rules](https://create.roblox.com/docs/audio/assets).

## Absorbed from roblox-audio

- Use one `SoundGroup` per category (music, effects, voice) so player volume settings move a whole group.
- Set `RollOffMaxDistance` on 3D sound so distant emitters stop costing time.
- Destroy one-shot sounds on `Ended`, not on a guessed timer; loop music with one looping `Sound`, not by restarting it.
- Sound IDs are project data: read the licence before using any external asset.
- UI and footstep sounds play on the client; world sounds everyone must hear play from a Part on the server.

Full detail: references/absorbed-sound-rules.md

