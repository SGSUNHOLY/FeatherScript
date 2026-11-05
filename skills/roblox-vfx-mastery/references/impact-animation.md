# Impact frames and animation-driven effects

Use contact as time zero. Example starting point: 100 ms anticipation, 30 ms bright silhouette accent, 80 ms expanding ring, 180 ms directional sparks, 350 ms dust decay. Tune to the action; these are starting values, not a mandatory strobe.

Implement local screen accents with one owned ScreenGui and Frame, one short tween, and a cancellable lifetime. Clamp opacity and duration. Respect a reduced-flash preference; substitute a low-opacity edge vignette or omit the flash. Avoid repeated full-screen black/white inversion. Do not modify shared Lighting or overwrite the gameplay camera to create an impact frame.

Create reusable presets: directional melee spark, expanding shockwave, ground slam dust, projectile contact, charge/release aura. Each preset accepts origin CFrame, tint, scale, seed and quality. Own all emitters, attachments, tweens and event connections in a cleanup handle. Bound active effect count, use burst Emit rather than indefinite Enabled, disable shadows/collision/query/touch on purely visual geometry, and cancel on respawn or scene change.

Drive contact effects from named animation markers and confirmed game events. Keep visual playback on clients; validate hit and damage on the server. Deduplicate effect event IDs. Test two simultaneous hits, interrupted animation, low quality, bright and dark maps, and respawn.

For Blender meshes: inspect the actual tool list, build the silhouette first, apply consistent scale, save a new .blend, and export a new GLB. For animation use animate_object for bounded transform keys; rig baking needs a dedicated armature workflow. Check the exported animation in Studio: Blender playback alone does not establish Roblox compatibility.
