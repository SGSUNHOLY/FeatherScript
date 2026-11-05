---
name: roblox-audio
description: "Use when adding or changing sound: playing a Sound, spatial falloff, looping music, SoundGroups for volume, or sound cleanup."
---

Sounds are instances. Give each one an owner, a volume and an end.

## Verified API (Roblox docs, checked for this skill)
- `Sound` properties: `Volume` (number), `SoundId` (ContentId), `RollOffMaxDistance` (number), `SoundGroup` (type SoundGroup). Methods: `Play()`, `Stop()`. Event: `Ended(soundId)`.
- `SoundGroup.Volume` (number).
- SoundService properties include `RespectFilteringEnabled` and `DistanceFactor`. The docs page gives no description for `RespectFilteringEnabled`; do not rely on it without reading its docs.

## Rules
1. Use a SoundGroup for each category (music, effects, voice). Players' volume settings then change a whole group, not each sound.
2. Set `RollOffMaxDistance` for 3D sound so distant sounds stop costing time.
3. Clean up: destroy one-shot sounds on `Ended`, not on a timer guess.
4. Loop music on one Sound, not by restarting it in a loop.
5. Sound IDs are project data. Read the licence before you use one from outside (see `ul-sfx-finder`).
6. Client sounds (UI clicks, footsteps) play on the client. Server sounds (a boss roar in the world) play from a Part so every client hears them.

## Checks
- Play each sound once in a run and confirm it plays and stops.
- Confirm one-shot sounds are destroyed after they end (count before and after).

## Not checked by this skill
- Audible mix on a real device. The user must listen.
- Sound licences. Check each asset's licence before shipping.
