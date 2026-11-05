---
name: roblox-physics
description: "Use when building vehicles, ragdolls, projectiles, constraints, elevators or other physics-driven gameplay, or setting up collision groups."
---

Physics runs on the server for anything that affects gameplay. The client may predict for smoothness; the server has the final say.

## Verified API (Roblox docs, checked for this skill)
- `BasePart` properties: `AssemblyLinearVelocity`, `Anchored`, `CanCollide`, `CollisionGroup`.
- PhysicsService collision-group methods (`RegisterCollisionGroup(name)`, `CollisionGroupSetCollidable(name1, name2, collidable)`, `SetPartCollisionGroup`, and others) are marked **Deprecated** on the docs page. Do not start new work on them. Use the `BasePart.CollisionGroup` property and check the docs for the current replacement before you write collision code.
- Constraint classes (examples on the docs page): `AlignPosition`, `AlignOrientation`, `AngularVelocity`, `BallSocketConstraint`, and others. Check each class's docs page for its properties.
- `Attachment.CFrame` and `Attachment.WorldCFrame` (property).

## Rules
1. Gameplay physics is owned by the server. Set velocities and forces on the server, or on a part the server has given to a client.
2. Use constraints (AlignPosition, AngularVelocity and similar) instead of setting `CFrame` every frame. Setting CFrame each frame fights the simulation.
3. Do not set `AssemblyLinearVelocity` on a part you have not checked is unanchored; check `Anchored` first.
4. Collision rules: use the current method from the docs, not a deprecated one. Write down which groups collide with which.
5. Projectiles: check hits on the server. Clean up each projectile with `Debris:AddItem(item, lifetime)` (Debris default lifetime is 10, per the docs) or an explicit destroy.
6. Keep physics-heavy loops out of per-frame code on the client when you can; prefer events.

## Checks
- Run the physics feature in a real playtest and check the result, not the code.
- Confirm cleanup: count the projectiles or parts before and after a run.

## Not checked by this skill
- Exact replacement for the deprecated collision-group methods. Read the current docs before use.
- Performance under load. The user must test with many parts.
