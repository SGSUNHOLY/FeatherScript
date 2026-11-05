# Absorbed from roblox-vfx

Merged into `roblox-vfx-mastery` during the skills dedupe. The original folder is at `skills/.archived/roblox-vfx/`.

# Roblox visual effects

## Tie each effect to gameplay feedback

For every effect, identify its trigger, attachment point, duration, audience, and whether it is cosmetic or communicates authoritative state. Keep effects consistent with the game's palette and avoid obscuring hazards, targets, or UI.

## Build with engine instances

Use Attachments as stable effect points. Use ParticleEmitter for bursts/trails, Beam for connected attachments, Trail for motion trails, Highlight for selective emphasis, and TweenService for predictable property transitions. Prefer small reusable templates stored in an existing shared or server-only location appropriate to their visibility.

Keep server gameplay logic independent of cosmetics. Spawn client-only effects for local-only feedback; replicate an event or compact state change when other players need to see it. Do not send large per-frame cosmetic payloads through remotes.

## Lifetime and performance

- Set explicit particle lifetime, rate, spread, size, transparency, and texture permissions.
- Emit bursts with `:Emit()` when continuous emission is unnecessary.
- Stop emitters and destroy or recycle temporary containers after their final particles expire.
- Limit lights, transparency layers, particle rates, and effects active at once.
- Avoid per-frame loops for one-shot effects. Use tweens, events, and Debris cleanup.
- Ensure cosmetics fail harmlessly if an asset is unavailable or an attachment is streamed out.
- Profile before reducing visual quality. A visually cheaper effect is not always faster if it adds excessive instances or update work.

## Validate

Trigger the effect in Play mode at normal and peak intensity. Check first-person/third-person views, camera visibility, repeated activation, respawn, and multiple clients if replicated. Confirm temporary instances do not accumulate and Output stays clean.

Use [particles](https://create.roblox.com/docs/effects/particles), [performance optimization](https://create.roblox.com/docs/performance-optimization), and the [MicroProfiler](https://create.roblox.com/docs/performance-optimization/microprofiler) when investigating cost.
