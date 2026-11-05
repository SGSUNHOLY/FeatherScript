--!strict
-- UIBind.luau - keeps a label in step with a value, by attribute.
--
-- Why this exists: a label that no code writes shows its placeholder forever, and the
-- layout checks cannot see it. The placeholder is "<unbound>" (never a value the live code
-- can produce), and verify_labels.py fails the build if no controller names the label.
-- This module is the runtime half of that rule: bind a label once, and it updates when
-- the attribute changes, with no name-matching table to go stale.
--
--   local UIBind = require(path.UIBind)
--   UIBind.attribute(coinsLabel, player, "Coins", UIFormat.compact)
--
-- The owner is any Instance that carries the attribute (the Player, a leaderstat folder,
-- a ScreenGui). Attributes are set by the server and replicate to the client; the client
-- only reads them here. Rule 16 of Check-Code: the client never writes server state.

local UIBind = {}

UIBind.UNBOUND = "<unbound>"

local function render(label: TextLabel | TextButton, value: any, fmt: ((any) -> string)?): ()
	if value == nil then
		label.Text = UIBind.UNBOUND
		return
	end
	if fmt then
		local ok, text = pcall(fmt, value)
		if ok then
			label.Text = text :: string
		else
			-- A failing formatter must not blank the HUD; show the raw value and say why.
			warn(("[UIBind] formatter failed for %s: %s"):format(label:GetFullName(), tostring(text)))
			label.Text = tostring(value)
		end
	else
		label.Text = tostring(value)
	end
end

-- Returns a disconnect function. Call it when the label is destroyed, or when it
-- should stop following the value.
function UIBind.attribute(
	label: TextLabel | TextButton,
	owner: Instance,
	attributeName: string,
	fmt: ((any) -> string)?
): () -> ()
	render(label, owner:GetAttribute(attributeName), fmt)
	local conn = owner:GetAttributeChangedSignal(attributeName):Connect(function()
		render(label, owner:GetAttribute(attributeName), fmt)
	end)
	return function()
		conn:Disconnect()
	end
end

return UIBind
