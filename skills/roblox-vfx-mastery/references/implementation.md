# Detailed implementation reference

The current SKILL.md controls routing and scope. Paths in code examples are relative to the skill folder. Historical measurements and tool lists require verification on the current installation.

# Roblox VFX Mastery

Create effects with a clear gesture, decisive timing, coherent motion, and reliable runtime behaviour. Make power come from contrast and execution. Every layer must earn its place.

## Execute this workflow

1. **Inspect:** identify existing presets, animation markers, combat events, camera control, asset permissions, and available Studio tools. Preserve working systems.
2. **Define:** write one sentence: “Notice ___ first; understand ___; feel ___.” Specify camera distance, scale, audience, duration, and intended peak concurrency. Infer sensible defaults unless a missing answer changes the result.
3. **Block:** build the primary shape and motion with simple geometry/textures. Review at normal speed without bloom, sound, or shake. Solve the gesture and rhythm before detail.
4. **Compose:** add only layers that explain force, material, scale, identity, or gameplay. Tune their hierarchy and transitions.
5. **Integrate:** connect to the actual action; implement ownership, cancellation, quality selection, and teardown.
6. **Verify:** test in the map, under overlap, and through interruption. Fix the weakest observed result before adding complexity.

For an existing effect, diagnose and change the smallest relevant system. If Studio is unavailable, supply exact Explorer placement and runnable implementation; label runtime and appearance unverified.

## Make it look deliberate

- **Silhouette:** choose a strong gesture—cut, thrust, radial burst, gathering spiral, flowing ribbon. Preserve negative space. Vary thickness and grouped scale; avoid evenly distributed detail unless the design is deliberately mechanical.
- **Hierarchy:** make the gameplay-relevant component the focal point. Give supporting layers lower visual priority. Use a limited bright accent, a readable coloured body, and a subordinate tail when appropriate; avoid uniform white glow.
- **Colour:** establish a dominant palette and restrained accent. Let colour changes explain energy, material, or state. Differentiate friendly/hostile and status effects through shape or rhythm as well as colour.
- **Timing:** decide whether the effect is an instant impulse, a build/release, a sustained state, or a loop. Use anticipation only when the mechanic permits it. Synchronize contact-defining layers; stagger consequences rather than randomly delaying everything.
- **Motion:** make elements share a cause but respond differently. Let debris carry weight, sparks retain direction, and dust follow the force. Use bounded variation around a designed gesture. Keep constant-speed motion when physically or stylistically appropriate.
- **Ending:** inspect the final third. Thin, fragment, slow, or fade the tail intentionally. Use a hard stop when it clearly communicates a state change. Do not leave full-intensity smoke after the meaningful action ends.
- **Context:** inspect bright/dark scenery, actual gameplay distance, grayscale, and important viewing angles. Keep characters, UI, and danger boundaries readable. Match visual prominence to gameplay importance across the whole ability kit.

Choose a local style and apply it consistently. Crisp anime shapes, soft magic, realistic smoke, and calm ambience need different treatments. Do not impose one palette, brightness formula, windup, or easing curve on every effect.

## Choose and author the primitives

| Need | Use | Critical check |
| --- | --- | --- |
| Sparks, dust, smoke, bursts | ParticleEmitter | Texture, origin, motion, lifetime, screen coverage |
| Laser, tether, energy ribbon | Beam | Both attachments, tangent axes, curves, widths, texture tiling |
| Weapon sweep or moving wake | Trail | Attachment spacing, active motion window, lifetime, history reset |
| Spatial crescent, cone, ring | Authored mesh | Pivot, local axes, UVs, edge-on views, transparent overlap |
| Animated drawn burst | Particle flipbook | Layout, padding, duration, memory, static fallback |
| Reward/UI accent | GUI animation | Item/text priority, safe areas, viewport size, bounded count |

For particles, use NumberSequence for Size/Transparency, ColorSequence for Color, and NumberRange for Lifetime/Speed. Distinguish Rate from Speed. Use attachments for exact origins and volumes only intentionally. Choose LockedToPart and orientation deliberately.

For one-shot bursts: keep automatic emission disabled, position/configure before `Emit(count)`, and keep the parent alive through every delayed emission's tail. Disabling stops new emission; `Clear()` removes existing particles. Base cleanup on actual emission times, including scheduling delays and any time-scale changes.

For trails: disable and `Clear()` before teleport/reuse; enable only in the intended movement window. For beams: check attachment tangent orientation before increasing Segments. For OneShot particle flipbooks, Lifetime determines playback duration. Reuse atlases and keep an appropriate fallback.

Preload a small critical asset set before first use; do not preload the whole place or yield inside every hit callback. Never invent working asset IDs or renderer features. Use authored flipbooks or verified project techniques for dissolution; do not assume access to arbitrary custom shaders. Inspect imported Toolbox dependencies before execution and retain required credits.

## Engineer for gameplay

Prefer the existing project architecture. For a new system, put presets/definitions/modules in `ReplicatedStorage/VFX`, the client controller in `StarterPlayerScripts`, validated gameplay logic in `ServerScriptService`, and local visuals under a client-created `Workspace/ClientVFX` folder.

Expose `Play(effectId, context) -> handle`, `Stop(fade)`, and `Destroy()`. Make stopping/destruction idempotent. Keep palette, counts, timing, scale, and tier settings in definitions. Implement only the complexity required by the effect.

- **Authority:** server validates actions, hits, damage, cooldowns, and shared state. Render cosmetics on clients. Validate finite numbers, types, bounds, permissions, distance, character state, and request rate; allowlist effect IDs.
- **Dispatch:** send compact approved events to relevant recipients. Use reliable transitions; use unreliable updates only when loss/reordering is acceptable. Avoid per-frame remote traffic.
- **Prediction:** predict owner feedback when useful; reconcile confirmation by action ID. Bound/expire deduplication state. On rejection or cancellation, stop the correct action; stale events must not revive it. A seed controls scripted variation, not internal particle randomness.
- **Timing:** drive animation-linked phases from markers or a coherent animation timeline. Keep impact aligned when animation speed changes. Skip expired late transients; preserve reconstructible state for persistent effects.
- **Placement:** raycast ground contact; align to the normal with a stable tangent and fallback axis. Match the asset's local axes. Exclude cosmetics from gameplay queries. Handle missing/streamed-out targets and no-ground results without indefinite waits.
- **Ownership:** track every instance, connection, task, tween, sound, and camera contribution. Stop on death, unequip, interruption, target loss, and respawn as appropriate. Drain intentional tails; hard-clear when required. Give loops an explicit stop path and watchdog.
- **Animation:** use elapsed time instead of frame count. Tween supported properties; rebuild unsupported sequence values through a bounded updater when needed. Use one managed camera contribution system and remove only the stopped effect's contribution.
- **Pooling:** add only for a measured allocation bottleneck. Reset all state and guard delayed work with lease/generation IDs.

## Keep it performant and usable

Set global concurrency/resource budgets and preserve essential telegraphs at every tier. Reduce secondary layers, large transparent overlap, long lifetimes, lights, and unnecessary updates first. Low quality must retain meaning. Stabilize distance/quality selection to avoid flicker.

Estimate steady particle population as `Rate × average Lifetime`, adding overlapping bursts separately. This estimates population, not rendering cost. Profile representative combat on a real baseline device: CPU, render time, memory, network, and recovery after repeated casts. A desktop preview or device emulator does not establish mobile GPU performance.

Keep sound and camera response subordinate to clear visuals. Respect reduced motion/flashes, protect UI readability, and avoid unrelated global Lighting changes. Never claim universal particle limits, zero lag, or passing performance without measurements.

## WAGOLL: observable exemplars

Use **What A Good One Looks Like** as an acceptance specification. These are original design targets, not completed assets or universal recipes.

| Effect | A good result | Reject or refine |
| --- | --- | --- |
| Sword hit | Tapered swing arc; localized confirmed-contact star; sparse directional streaks; quick retreat | Full-screen blast for a light hit; identical hit/miss feedback; lingering blade trail |
| Ground slam | Truthful danger boundary; decisive contact; outward wave; grounded fragments; quieter following dust | Floating ring; smoke hiding the radius; uniformly spaced rocks |
| Projectile | Recognizable head; subordinate wake; coherent launch/flight/contact; wake stops on collision | Tail brighter than the meaningful region; unrelated impact style; recycled trail stretching across map |
| Healing field | Unambiguous active boundary; gentle secondary rhythm; readable character; clean state exit | Repeatedly disappearing state cue; threatening motion without reason; opaque mote cloud |
| Lightning | One dominant path; thinner forks; clear contact; controlled brief tail | Equal-brightness zigzag noise; decorative forks suggesting extra hit regions |
| Item reveal | Build resolves into one reveal; item/text take focus; quiet settling accents | Particles covering the reward; nonstop background peaks; unreadable mobile UI |

For an initial fast sword-hit study, try contact at 0 s, a retreating accent around 0.07 s, arc resolution around 0.20 s, and sparse streaks ending around 0.30 s. These are tuning proposals. Keep swing timing tied to the actual animation and test at normal speed.

## Diagnose before adding detail

| Symptom | First intervention |
| --- | --- |
| Muddy on the map | Isolate primary shape; reduce competing opacity/brightness; test background contrast |
| Weak despite many layers | Clarify one peak and the release's change in motion |
| Artificial or repetitive | Break uniform thickness, spacing, scrolling, and lifetimes within the intended gesture |
| Detached from the action | Repair contact frame, shared origin, force direction, and animation synchronization |
| Awkward ending | Inspect phase handoff and actual tail lifetime; preserve appropriate momentum |
| Nothing appears | Check client execution, Workspace ancestry, permissions, asset loading, and placement |
| First-use hitch or accumulating lag | Separate asset/allocation spikes from leaked resources and transparent overdraw |
| Wrong curves or teleport streaks | Repair attachment axes or clear trail history |

Use **observation → one main change → before/after comparison → decision**. Give specific critique: “Smoke steals focus after contact; lower its opacity and compare.” Separate observed defects from hypotheses when no footage or preset is available.

## Finish with evidence

Check meaning, silhouette, hierarchy, timing, material/force, colour, transitions, world contact, accessibility, and runtime. Mark each **pass, fail, or untested**. Fix functional failures before optional aesthetic improvements.

Verify normal-speed playback; real camera distances/angles; bright/dark backgrounds; hit versus miss; cancellation in each phase; death/respawn/teleport; two-client playback/prediction where relevant; missing assets; supported quality tiers; peak concurrency; and resource recovery after tails finish.

Deliver the implementation, exact placement/trigger, useful tuning knobs, and a short report of observed tests and remaining limits. Never substitute a written plan or a polished screenshot for a working tested effect.

## Selected foundations

Use [Roblox effects documentation](https://create.roblox.com/docs/effects) for engine behaviour; [Riot's clarity principles](https://www.leagueoflegends.com/en-us/news/dev/clarity-in-league/), [Keyser's block-in method](https://realtimevfx.com/t/block-ins-and-timing/29830), [Beardilocks' focal-point analysis](https://realtimevfx.com/t/anatomy-of-a-league-of-legends-missile-part-1-creating-areas-of-focus/11614), and [Hall's Sparkball breakdown](https://www.vfxapprentice.com/blog/creating-vfx-style-guides-for-games) for artistic reasoning. Apply their principles to the project's style; do not copy source-specific rules blindly.

For source audits only, read [research provenance](../references/research.md). Keep the 47-source history on demand; do not load it for routine effect work. The core skill is self-contained.

## Impact frames and animation

For impact accents, reusable combat presets, Eclipse marker timing and Blender handoff, read [impact-animation.md](../references/impact-animation.md).

A cancellable client accent module is provided in `scripts/impact_frame.luau`. Pass `reducedFlash=true` for a subtle version. Reuse one active handle per effect channel rather than stacking full-screen accents.
