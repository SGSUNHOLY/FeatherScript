# Luau patterns for Studio projects

## Typed module boundary

```lua
export type RoundState = {
	phase: string,
	endsAt: number,
}

local Round = {}

function Round.isActive(state: RoundState): boolean
	return state.phase == "Active"
end

return Round
```

Keep the type contract close to the module and let Studio's Script Analysis show type and syntax problems.

## Server-validated request

```lua
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local purchaseRequest = ReplicatedStorage.Remotes.PurchaseRequest

purchaseRequest.OnServerEvent:Connect(function(player, itemId)
	if typeof(itemId) ~= "string" or #itemId > 64 then
		return
	end

	local item = ServerItemCatalog[itemId]
	local profile = Profiles[player]
	if not item or not profile or profile.Coins < item.Price then
		return
	end

	-- Apply the transaction using server-owned catalog and profile values.
end)
```

This illustrates the trust boundary, not a drop-in economy. Add rate limits, atomic transaction rules, and the actual project's profile lifecycle as needed.

## Cleanup ownership

Keep the connection returned by `Connect()` and disconnect it when its owning object or state ends. For short-lived effects, use `Debris:AddItem(instance, lifetime)` or an equivalent explicit cleanup path. Avoid leaving connections attached to characters across respawns.
