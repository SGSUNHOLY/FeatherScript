---
name: roblox-animation
description: Create, refine, publish, and wire character animations using Roblox Studio's rig tools and Animation Editor. Use for R6, R15, and supported custom rigs.
---

# Animate in Roblox Studio

## Inspect the rig and intended use

Confirm the rig type, joints/bones, avatar scale, creator ownership, and where the animation will play. Find existing animation IDs and scripts before replacing anything. Determine whether this is an emote, locomotion, attack, tool action, or NPC animation; each needs a different priority and interruption policy.

## Author in Animation Editor

1. Select or insert the correct rig and open Animation Editor from Studio's Avatar tools.
2. Establish a readable neutral pose and test the rig's range of motion.
3. Add a small number of clear key poses, then use the timeline and easing to refine timing and arcs.
4. Preview at intended playback speed, inspect silhouette and foot/hand contact, and check loop seams.
5. Set loop and priority deliberately. Avoid posing the root or hip in a way that fights the game's movement controller.
6. Save the working sequence. If publishing is requested, select the correct creator or group and verify the resulting asset ID and permissions.

## Wire and test

Use the animation asset ID in the existing character or NPC animation system. Load and play it on the correct Animator. Handle character respawn, missing assets, and animation replacement cleanly. Respect action priority and stop tracks when their state ends.

Preview in Studio, then test in Play mode on the matching rig. Check transitions to idle/run/jump, tool equip, respawn, and multiplayer visibility as relevant. If the experience is group-owned, verify the animation was published under an owner the experience may use.

Do not report an animation as published until Studio confirms the upload. Do not change the live default character controller as a shortcut for testing.

See the [Animation Editor guide](https://create.roblox.com/docs/animation/editor) and [work with the Animation Editor tutorial](https://create.roblox.com/docs/tutorials/curriculums/animator/work-with-the-animation-editor).

## Choose an authoring route

Use this skill for Studio Animation Editor workflows. Use `eclipse-animator` for an editable Eclipse sequence or `ul-animation` for a Blender rig. Preserve the existing animation controller and synchronize contact effects through named markers.
