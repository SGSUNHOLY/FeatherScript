# Detailed implementation reference

The current SKILL.md controls routing and scope. Paths in code examples are relative to the skill folder. Historical measurements and tool lists require verification on the current installation.

# Check-Props

Production standard for AI-generated props in Roblox Studio. Props are built only from Studio Parts, Unions and Luau generators, with no external modeling software. Follows the same rule style as Check-Clean-UI. Each rule lives in one section. The Verification Checks point to those sections instead of repeating their numbers.

Rules marked (doc) come from the Roblox Creator Docs listed at the end. Rules marked (design) are starting choices that the Test Plan should confirm or replace.

## Glossary
Stud: Roblox's unit of length.
Part: A basic building block (Block, Ball, Cylinder, Wedge). Union results are also parts.
Model: A container that groups parts into one prop.
Pivot: The point a Model moves and rotates around. Move Models with PivotTo (doc).
WorldPivot: The pivot of a Model that has no PrimaryPart (doc).
Union: A solid part made by combining parts with GeometryService:UnionAsync (doc).
Seed: A number that makes random variation repeat exactly.
Spec sheet: The table filled in before building. The finished prop is checked against it.
Style family: Organic, Material, Scientific, Technological, or Supernatural. Each prop has exactly one.
Detail part: A part with any side under 1 stud (cables, trim, indicators).

## Where Code Runs
Run generators in Studio at edit time (Command Bar or a plugin), or in a server Script before players arrive.
Never build or union props in a LocalScript. Solid modeling on the client only works on parts the client created, and nothing replicates to the server (doc).
Store finished templates in ServerStorage and clone them on the server. Use ReplicatedStorage only for props the client must clone itself, because everything there is sent to every player (design).

## Spec Sheet (fill in before building)
```
Name:            Prop_<Category>_<Name>_<Variant>
Style family:    Organic | Material | Scientific | Technological | Supernatural
Size class:      Tiny | Small | Medium | Large
Footprint:       X by Z studs
Height:          studs
Bury depth:      0 (Organic rocks and roots only, up to 1 stud)
Palette:         palette table name
Part budget:     from Part Budget
Triangle budget: from Union and Triangle Rules
Seed:            number, or "from name"
Collision:       Solid | Walkable | Pass-through | Mixed (list parts)
Interaction:     None | ProximityPrompt | ClickDetector | Touch
Floating parts:  None | list each part and its height above the pivot
Streaming mode:  Default | Atomic
Interior:        Buildings only: Walkable | Sealed
Purpose:         one sentence
```

## Method
Build every prop as a Model named Prop_<Category>_<Name>_<Variant>, for example Prop_Crate_Wood_01.
Do not set a PrimaryPart on static props. Static models do not benefit from one (doc). Set Model.WorldPivot to the bottom-center of the bounding box instead. Set a PrimaryPart only on props that move with joints.
The pivot sits at the bottom-center, at ground level. The lowest point of the prop is at Y = 0 relative to the pivot, except for the declared bury depth of Organic props.
Place props with PivotTo. Never set world coordinates part by part (doc).
Grid: Sizes and positions of normal parts snap to 0.5 studs. Detail parts snap to 0.1 studs. Z-fighting offsets (0.01) are the only values off both grids.
Use one palette table per prop family (maximum 6 colors). Take Color and Material only from that table. Never leave every part on the default Plastic.
Anchor every static part (Anchored = true), and set it before parenting.
Collision properties per part:
- Solid or walkable parts: CanCollide = true, CanTouch = false unless touch events are needed.
- Pure decoration: CanCollide = false, CanTouch = false, CanQuery = false. Setting CanTouch to false on parts that need no touch events helps performance (doc).
- Any part with a ClickDetector, or one that raycasts must hit, keeps CanQuery = true. ClickDetectors stop working when CanQuery is off.
Give large static pieces CastShadow = true. Turn it off for small decorations.
Use Random.new(seed) for all variation. Derive a numeric seed from the prop name with a fixed hash (see Helper Code), and keep the order of random calls fixed. The same seed must always produce the same prop. Different variants use different seeds.
Build the whole model unparented, then parent it once at the end. Never parent parts one at a time inside a loop.
Merge static parts only under the Union and Triangle Rules.
Tag each clone as described in Tags.

## Tags
Prop: Added by the spawner to every prop clone. Used to find and clean up props.
Interactive: Added by the spawner to any prop with a Hitbox part.
Fallback: Added by Failure Handling to any substitute prop. Never added by hand.
Hitbox is a part name (Hitbox_<PropName>), not a tag.
Props carry only these three tags unless the spec sheet declares another.

## Union and Triangle Rules
Use GeometryService:UnionAsync(mainPart, otherParts, options). It returns an array of new parts with no parent, and the originals stay intact (doc). The older BasePart:UnionAsync still exists, but the GeometryService form is the one to generate.
Options to pass every time: CollisionFidelity, RenderFidelity, and SplitApart = false so you get one union back. SplitApart defaults to true, which returns a separate part for each disconnected body (doc).
Only primitive Parts and existing unions can be combined. MeshParts need a Studio beta feature, so do not use them here (doc).
Results sit in the main part's coordinate space, so set each result's CFrame to the main part's CFrame before parenting (doc).
Do not fire many UnionAsync calls in quick succession. In-game solid modeling is asynchronous and can affect performance (doc). Run unions at edit time or before players arrive, one group at a time, each inside pcall.
A failed call, an empty result, or an error counts as a failure (see Failure Handling).
Keep the original parts until the union passes review, then destroy them.
Collision fidelity: Default for most unions. Box for small decorations that still need collision. Hull for medium convex shapes. PreciseConvexDecomposition only where concave collision matters (archways, stair blocks), because it is the heaviest (design).
Render fidelity: Automatic. Precise only for hero props seen up close. Performance is not valid for unions (doc).
Smoothing: SmoothingAngle between 30 and 70 usually looks best. Avoid 90 to 180, which can cause shadowing on sharp edges. It can only be changed in Studio, not from a script (doc).
Color: A union keeps each face's original color. To recolor the whole union as one color, turn on UsePartColor in Studio (doc).
Triangle cap: Any single solid modeling result over 20,000 triangles is simplified to 20,000, and the call errors if it cannot be (doc). Keep each union well under that.
Triangle budget per prop (design): Tiny 500, Small 2,000, Medium 8,000, Large 30,000 across all its unions.
Scripts cannot read TriangleCount, because it is restricted (doc). Check triangle counts in Studio's performance stats, and record them in the Test Plan.
Do not cut doors or windows with SubtractAsync. Build wall segments around openings instead (design).

## Scale Rules
Reference: A default character is about 5 to 5.5 studs tall and about 2 studs wide. Avatar body scaling can make players taller. All props are sized against this, not real-world units.
Doorways: At least 4 studs wide and 7 studs tall. 3 by 6 is the absolute minimum, used only if the game locks avatar scaling (design).
Ceilings: 8 studs of clear height above walkable floors by default, never below 7 (design).
Gaps: At least 3 studs wide for a player to walk through. Narrower gaps are blocked or marked as decoration.
Steps: Each step is 1 stud tall or less and at least 2 studs deep (design).
Ramps: No steeper than 40 degrees. The default Humanoid.MaxSlopeAngle is 89 (doc), but steep ramps feel bad, and the game may lower that value (design).
Furniture: Seats about 1.5 to 2 studs tall. Tables and counters about 3 to 3.5 studs tall (design).
Scale check: Place the prop next to a default character in Studio. A prop that looks right alone but wrong beside a character fails.

## Size Classes
Tiny: Largest side up to 1 stud (coins, bottles, small items).
Small: Largest side over 1 and up to 3 studs (crates, lamps, chairs).
Medium: Largest side over 3 and up to 6 studs (tables, vehicles, doors, short walls).
Large: Largest side over 6 studs (buildings, trees, rock clusters).
Each prop declares its class in the spec sheet, and its real size must fall in that class.

## Part Budget (design)
Tiny: 8. Small: 20. Medium: 60. Large: 550.
Lights, particle emitters and hitbox parts count toward the budget.
Budgets apply per prop. The total on screen must also stay within a scene budget set for the target device.
The Test Plan replaces these values with measured ones.

## Collision Rules
Walkable surfaces: Flat tops, reachable by steps or ramps that follow the Scale Rules.
Solid obstacles: Walls, crates, vehicles and anything a player must not pass through.
Pass-through decoration: Grass, leaves, banners, wires, and other visuals a player can walk through.
Head clearance: Any overhang above a walkable surface is at least 7 studs up, or has a solid stop below it so players cannot walk under it.
Shape match: Collision matches the visible shape closely. A small prop must not carry a large invisible collision box.
Support: A part is supported if its bottom face is within 0.1 studs of the ground or of another part of the same model. Declared floating parts are exempt, because they are anchored.
No prop relies on another prop to stay in place.

## Hitbox and Interaction Rules
Prefer a ProximityPrompt for interaction. It works the same on touch, gamepad and keyboard (design).
If you use a ClickDetector or touch events, put them on a separate invisible Part named Hitbox_<PropName>, not on a visual part.
Hitboxes: Transparency = 1, CanCollide = false. CanQuery = true when a ClickDetector or raycast uses them. CanTouch = true only for touch events.
Hitboxes are about 0.5 studs larger than the visible part on each side.
Anchored parts never fire Touched against each other (doc). A touch hitbox only detects moving players and unanchored parts.

## Buildings
Structure: One parent Model named Prop_Building_<Name>_<Variant>, with child Models for Shell (walls, floors, roof), Openings (doors, windows), Interior (one child per floor) and Trim. Keep the nesting this shallow (doc).
Streaming: A building with a walkable interior uses ModelStreamingMode = Atomic, so it never loads half-built. A sealed building uses Default.
Interior: The spec sheet declares it Walkable or Sealed. Sealed buildings have walls and roof only.
Floors: Each floor slab is at least 1 stud thick. Clear height follows the Scale Rules.
Rooms and corridors: Rooms at least 8 by 8 studs. Corridors at least 4 studs wide.
Stairs: Follow the step rule. Total run = (rise / step height) x step depth. The opening above must give the clear height from the Scale Rules over every step.
Walls: Exterior at least 1 stud thick. Interior at least 0.5 studs. Build segments around openings.
Windows: Real openings with a frame and a Glass part, sill about 3 studs above the floor. Never decals. Glass keeps CanCollide = true if players must not pass through.
Doors: Open frames unless the spec sheet declares an interactive door, which follows the Hitbox and Interaction Rules.
Roof: Wedge parts or a union. Walkable roofs follow the ramp rule. No gaps over the footprint. Eaves overhang up to 2 studs and sit above 7 studs.
Large extents: Break very large buildings into separate modular models, each with its own level of detail (doc).

## Level of Detail
Engine LOD (preferred): With StreamingEnabled on, set Model.LevelOfDetail = SLIM on static models. SLIM renders lighter composite versions at distance (doc). It needs the place saved to Roblox (doc).
Distant composite and imposter meshes have no physics, collision or raycasting (doc). Never rely on them for gameplay.
Model.LevelOfDetail options: Automatic (currently the same as Disabled), StreamingMesh, Disabled, SLIM (doc).
Manual LOD (only without streaming): A client LOD script, kept outside the props, hides Mid-tier detail parts beyond 60 studs and swaps to a simplified model beyond 150 studs. Phones use half these distances (design).

## Streaming and Cleanup
StreamingEnabled is set on Workspace in Studio, not from a script (doc).
Recommended Workspace settings: ModelStreamingBehavior = Improved, StreamingIntegrityMode = PauseOutsideLoadedArea (doc).
Streaming only applies to Workspace descendants (doc).
ModelStreamingMode: Default for most props. Atomic for props that must appear whole. Persistent only if scripts need the prop at all times, because persistent models never stream out (doc).
Do not nest a Persistent model inside an Atomic one, because the atomic model then behaves as persistent (doc).
Parts added to an Atomic model after it replicates stream normally, not atomically (doc). Finish building before parenting.
Client code uses WaitForChild for anything that may not have streamed in. FindFirstChild returns nil for parts that have not arrived (doc).
A streamed-out instance is parented to nil, not destroyed (doc). Keep client state safe to reconnect.
When you destroy a prop on purpose, disconnect its connections first.

## Failure Handling
Failures: a missing palette entry, a failed or empty union, a missing seed, a part count over budget, a triangle count over budget, a light or emitter count over its family limit, or an audit problem from the Helper Code.
On failure, warn with the prop's name and the reason.
Place a fallback from the same style family and size class, with the closest part budget, and add the Fallback tag. If none exists, place the family's plain box at the declared size.
Never place a broken or partial model silently.

## Decal and Texture Rules
Maximum 2 decals and 1 Texture per prop.
Source images at 512 x 512 or smaller, or 1024 x 1024 for Large props (design).
Only surfaces that need detail get images. Everything else stays flat-colored from the palette.
Note that unions use box-mapped UVs, which can stretch textures (doc). Put textures on plain parts, not unions.

## Visual Review Loop
Take a screenshot from the fixed reference camera angle and compare it to the family's reference image.
Fix every difference the spec sheet calls out.
Keep one reference image per style family in a shared folder.
A human reviewer approves the screenshot. The AI cannot mark the Visual check as passed.
Finish with the playtest QA procedure.

## Style Families
Each prop declares exactly one family. No mixing.

Organic (trees, rocks, bushes, mushrooms, roots):
Shape: Irregular silhouettes from overlapping Balls, Cylinders, tilted Blocks and Wedges.
Variation: Rotation jitter up to 15 degrees. Size jitter in 0.5-stud steps, up to 1 stud per part, so sizes stay on the grid.
Materials: Grass, LeafyGrass, Wood, Slate, Rock or Sand as the primary material.
Trees: Trunk tapers toward the top. Canopy of 3 to 6 clustered balls, pass-through, lowest edge above 7 studs.
Rocks: 3 to 6 overlapping parts with random tilt, buried by the declared bury depth (up to 1 stud).

Material (crates, walls, barrels, pillars, signs):
Shape: Simple forms that read through their surface.
Materials: One primary (maximum 2) from Metal, WoodPlanks, Concrete, Brick, Granite, Marble, Cobblestone, DiamondPlate, Glass.
Edges: Bevel visible edges with Wedge or trim parts at least 0.5 studs wide. No decal edges.
Wear: Secondary color scuffs on at most 2 faces.

Scientific (labs, instruments, terminals, clean machinery):
Shape: Right angles, symmetry, aligned panels. Mirror across Z unless the spec sheet says otherwise.
Palette: White, light grey, blue-grey, and exactly one accent color.
Materials: SmoothPlastic, Metal, Glass (screens and lenses).
Detail: Tubes and cables at least 0.2 studs thick. Indicators sit flush, never floating.

Technological (sci-fi, consoles, vehicles, drones, high-tech structures):
Shape: Hard edges, layered panels, vents, cable runs. Wedges for angled armor.
Palette: Dark gunmetal plus exactly one neon accent.
Materials: Metal or DiamondPlate. Neon only for accent strips, under 10 percent of the visible surface.
Lights: At most 1 PointLight, inside the neon strip, with Shadows off unless it is a hero prop.
Cables: Pass-through decoration, 0.2 studs thick or less.

Supernatural (magic, ghosts, relics, portals, enchanted objects):
Shape: Asymmetry allowed. Floating parts allowed when declared in the spec sheet.
Palette: One base color plus one glow color (purple, teal or gold).
Materials: ForceField or Glass at Transparency 0.3 to 0.6 for ethereal parts. Neon for glow.
Solids: Any part that blocks players keeps Transparency at 0.5 or lower so it stays visible.
Glow: At most 1 ParticleEmitter and 1 PointLight.
Floating parts: Anchored, placed relative to the pivot, on the grid. The base still sits at Y = 0.

## Helper Code
Starter Luau for the Studio Command Bar, a plugin, or a server ModuleScript. It covers grid snapping, seeds, the pivot, unions and an audit. This code was hand-checked but has not been run through a Luau checker or in Studio yet, so test it once before relying on it.

```lua
local GeometryService = game:GetService("GeometryService")

local PropKit = {}

PropKit.GRID = 0.5
PropKit.DETAIL_GRID = 0.1

-- Round a number to the nearest grid step.
function PropKit.snap(value: number, step: number?): number
	local s = step or PropKit.GRID
	return math.round(value / s) * s
end

function PropKit.snapVector(v: Vector3, step: number?): Vector3
	return Vector3.new(PropKit.snap(v.X, step), PropKit.snap(v.Y, step), PropKit.snap(v.Z, step))
end

-- Turn a prop name into a fixed numeric seed (djb2-style hash).
function PropKit.seedFromName(name: string): number
	local hash = 5381
	for i = 1, #name do
		hash = (hash * 33 + string.byte(name, i)) % 2147483647
	end
	return hash
end

-- Make an anchored part. Set Shape before Size when you pass both.
function PropKit.newPart(className: string?, props: { [string]: any }?): BasePart
	local part = Instance.new(className or "Part") :: BasePart
	part.Anchored = true
	part.TopSurface = Enum.SurfaceType.Smooth
	part.BottomSurface = Enum.SurfaceType.Smooth
	if props then
		if props.Shape ~= nil then
			(part :: any).Shape = props.Shape
		end
		for key, value in props do
			if key == "Parent" then
				error("PropKit.newPart: parent the whole model once at the end, not each part")
			elseif key ~= "Shape" then
				(part :: any)[key] = value
			end
		end
	end
	return part
end

-- Put the model's pivot at the bottom-center of its bounding box.
-- Use on static models with no PrimaryPart, built with an unrotated pivot.
function PropKit.setBottomCenterPivot(model: Model, buryDepth: number?)
	local boxCFrame, boxSize = model:GetBoundingBox()
	local bottom = boxCFrame.Position - Vector3.new(0, boxSize.Y / 2, 0)
	model.WorldPivot = CFrame.new(bottom + Vector3.new(0, buryDepth or 0, 0))
end

-- Union one group of parts. Returns the union, or nil on failure.
-- The original parts are left in place for review.
function PropKit.unionGroup(mainPart: BasePart, others: { BasePart }, options: { [string]: any }?): BasePart?
	local opts = options
		or {
			CollisionFidelity = Enum.CollisionFidelity.Default,
			RenderFidelity = Enum.RenderFidelity.Automatic,
			SplitApart = false,
		}
	local ok, result = pcall(function()
		return GeometryService:UnionAsync(mainPart, others, opts)
	end)
	if not ok or result == nil or #result == 0 then
		warn(`[Check-Props] Union failed for {mainPart:GetFullName()}: {tostring(result)}`)
		return nil
	end
	local union = result[1] :: BasePart
	union.CFrame = mainPart.CFrame
	union.Anchored = true
	union.Parent = mainPart.Parent
	return union
end

-- Check a finished prop. Returns a list of problems (empty means it passed).
function PropKit.audit(model: Model, budget: number, buryDepth: number?): { string }
	local problems = {}
	local count = 0
	for _, d in model:GetDescendants() do
		if d:IsA("BasePart") then
			count += 1
			if not d.Anchored then
				table.insert(problems, `{d.Name}: not anchored`)
			end
			local size = d.Size
			local step = if math.min(size.X, size.Y, size.Z) < 1 then PropKit.DETAIL_GRID else PropKit.GRID
			if (PropKit.snapVector(size, step) - size).Magnitude > 0.001 then
				table.insert(problems, `{d.Name}: size {size} is off the {step}-stud grid`)
			end
		elseif d:IsA("Light") or d:IsA("ParticleEmitter") then
			count += 1
		elseif d:IsA("BaseScript") or d:IsA("ModuleScript") then
			table.insert(problems, `{d.Name}: script inside prop`)
		end
	end
	if count > budget then
		table.insert(problems, `part count {count} is over budget {budget}`)
	end
	local boxCFrame, boxSize = model:GetBoundingBox()
	local lowest = boxCFrame.Position.Y - boxSize.Y / 2
	local expected = model:GetPivot().Position.Y - (buryDepth or 0)
	if math.abs(lowest - expected) > 0.05 then
		table.insert(problems, `lowest point is {lowest - expected} studs off the pivot`)
	end
	return problems
end

return PropKit
```

To use it in the Command Bar, paste the code without the final `return PropKit` line, then call the functions after it.

## Pitfalls & Corrections
Pitfall: Props float above the ground or sink into it.
Correction: Run setBottomCenterPivot after building, then audit.

Pitfall: Decorative parts block the player or waste physics time.
Correction: Apply the Method's collision properties to every part.

Pitfall: Props fall apart when the game starts.
Correction: Anchor every static part before parenting.

Pitfall: Each run gives a different prop.
Correction: Derive the seed with seedFromName, keep random calls in a fixed order, and generate twice to compare.

Pitfall: Thousands of parts cause lag.
Correction: Enforce the Part Budget, union static pieces, and remove hidden or zero-size parts.

Pitfall: A union freezes Studio or hitches the game.
Correction: Union at edit time or before players arrive, one group at a time, inside pcall, at the lowest fidelity that looks and collides correctly.

Pitfall: A union comes back as several parts, or in the wrong place.
Correction: Pass SplitApart = false, and set the result's CFrame to the main part's CFrame.

Pitfall: A union came out looking simplified.
Correction: It probably hit the 20,000-triangle cap. Split it into smaller unions.

Pitfall: Unions or props made on the client are missing for other players.
Correction: Build on the server or at edit time. Client solid modeling does not replicate.

Pitfall: Faces flicker where parts overlap (z-fighting).
Correction: Offset by 0.01 studs, or move the inner part fully inside the outer one.

Pitfall: Toolbox models bring hidden scripts.
Correction: Delete every script before use, and run audit.

Pitfall: A ClickDetector does nothing.
Correction: Turn CanQuery back on for the part holding it.

Pitfall: Props look the right size alone but wrong beside a character.
Correction: Run the scale check against a default character, and allow for scaled avatars.

Pitfall: Players get stuck on edges or steps.
Correction: Walk every path with a character before marking the prop done.

Pitfall: A building loads half-built.
Correction: Use ModelStreamingMode = Atomic for buildings with walkable interiors.

Pitfall: Client code errors because a streamed part is missing.
Correction: Use WaitForChild instead of direct indexing.

Pitfall: Distant SLIM buildings let players see but not hit them.
Correction: That is expected, because distant composites have no collision. Never place gameplay that relies on far-away props being solid.

Pitfall: Textures look stretched on a union.
Correction: Unions box-map their UVs. Move the texture to a plain part.

## Verification Checks (each points to its section)
Spec Sheet (Spec Sheet): Filled in before building, and the prop matches it.
Style Family (Style Families): One family, its rules followed, nothing mixed in.
Code Location (Where Code Runs): Built on the server or at edit time. Templates in ServerStorage unless the client needs them.
Pivot (Method): No PrimaryPart on static props. WorldPivot at bottom-center. Audit reports no offset.
Grid (Method): Audit reports no off-grid sizes.
Anchoring (Method): Audit reports no unanchored parts.
Collision Properties (Method, Collision Rules): CanCollide, CanTouch and CanQuery set per part type.
Palette (Method): Every Color and Material comes from the family's table.
Part Count (Part Budget): Audit reports it within budget.
Unions (Union and Triangle Rules): GeometryService form, SplitApart = false, pcall, fidelity chosen by the rules.
Triangle Count (Union and Triangle Rules): Measured in Studio, within budget, and every union under 20,000.
Seed (Method): Two generations with the same seed match.
Scripts (Helper Code audit): No scripts inside the prop unless it is meant to run code.
Tags (Tags): Only the declared tags.
Size Class (Size Classes): Real size matches the declared class.
Scale (Scale Rules): Reads correctly next to a default character.
Doorways, Gaps, Steps and Ramps (Scale Rules): All meet the minimums.
Walkable Surfaces and Head Clearance (Collision Rules): Flat, reachable, with clearance.
Interaction (Hitbox and Interaction Rules): ProximityPrompt preferred. Hitboxes named, sized and set up correctly.
Buildings (Buildings): Structure, streaming mode, interior, floors, stairs, windows and roof follow the section.
Level of Detail (Level of Detail): SLIM set on static models when streaming is on, or manual LOD tested.
Streaming (Streaming and Cleanup): Mode chosen on purpose, WaitForChild used, nothing added to an Atomic model after it replicates.
Decals and Textures (Decal and Texture Rules): Within limits, and none on unions.
Failure Handling (Failure Handling): Errors warned, fallbacks tagged.
Visual (Visual Review Loop): A human approved the screenshot.
Playtest (Visual Review Loop): A character walks every intended path with no stuck points or stutter.

## Test Plan (replaces the design numbers with measured ones)
1. Build one prop per style family, plus one building, for six test props.
2. Run audit on each, and record part count, triangle count, and how long generation and each union take.
3. Place 1, 10 and 50 copies of each. Record the frame rate in Studio's device emulator with a phone profile, then on a real phone if you can.
4. Time UnionAsync on groups of 10, 50 and 100 parts to see where it becomes noticeable.
5. Repeat step 3 with StreamingEnabled on and LevelOfDetail = SLIM, in a place saved to Roblox.
6. Update the Part Budget, Triangle Budget, scene budget and LOD distances to match what you measured, and write the date next to them.
7. Re-run the plan after any change to budgets, distances or fidelity settings.

## Reference Docs
Solid modeling: https://create.roblox.com/docs/en-us/parts/solid-modeling
In-game GeometryService operations, the options table (CollisionFidelity, RenderFidelity, SplitApart), the coordinate-space note, the warning about quick successive calls, the 20,000-triangle cap, client limits, box-mapped union UVs, UsePartColor and SmoothingAngle guidance.

GeometryService: https://create.roblox.com/docs/reference/engine/classes/GeometryService
UnionAsync(part, parts, options) signature, return type, and the pcall code samples.

PartOperation: https://create.roblox.com/docs/en-us/reference/engine/classes/PartOperation
RenderFidelity (Performance not allowed), and TriangleCount restricted to Roblox security.

Model: https://create.roblox.com/docs/reference/engine/classes/Model
Static models do not benefit from a PrimaryPart. LevelOfDetail and ModelStreamingMode.

ModelLevelOfDetail: https://create.roblox.com/docs/en-us/reference/engine/enums/ModelLevelOfDetail
The four options, and that composite and imposter meshes have no physics, collision or raycasting.

Pivot Tools: https://create.roblox.com/docs/studio/pivot-tools
Pivot Editor release notes: https://devforum.roblox.com/t/pivot-editor-full-release/1403027
PivotTo, GetPivot and WorldPivot behavior.

BasePart: https://developer.roblox.com/api-reference/class/BasePart
Anchored, CanCollide, CanQuery, CanTouch, CastShadow, Transparency, and that two anchored parts never fire Touched on each other.

Collisions: https://create.roblox.com/docs/en-us/workspace/collisions
Setting CanTouch to false on parts that do not need collisions, for performance.

Instance streaming: https://create.roblox.com/docs/en-us/workspace/streaming
Streaming techniques: https://create.roblox.com/docs/en-us/workspace/streaming/techniques
SLIM: https://create.roblox.com/docs/workspace/streaming/slim
StreamingEnabled set in Studio, recommended Workspace streaming settings, persistent and atomic model behavior, nil-parenting on stream-out, WaitForChild, SLIM requirements.

Humanoid: https://create.roblox.com/docs/reference/engine/classes/Humanoid
MaxSlopeAngle (default 89).

From the Roblox DevForum, not official docs: ClickDetectors need CanQuery on, and the default character is about 5.5 studs tall.

Design choices, not from the docs: every number marked (design), including part and triangle budgets, doorway and ceiling sizes, step and ramp limits, the 60 and 150 stud manual LOD distances, the neon 10 percent limit, the jitter amounts, the per-prop-type fidelity choices, and the Buildings dimensions. Confirm them with the Test Plan.
