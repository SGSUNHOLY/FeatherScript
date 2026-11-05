--!strict
-- UIToast.luau - short messages that slide in, hold, and leave, one after another.
--
--   local UIToast = require(path.UIToast)
--   UIToast.show("Checkpoint 3 reached")
--   UIToast.show("Shop restocked", 3)          -- hold for 3 seconds
--
-- One worker plays the queue in order, so two toasts never stack on top of each other.
-- The queue is only touched between yields, so the "is it running" flag needs no lock.
-- Layout: top centre, below the Roblox top bar (the bar is 36px at the reference size,
-- see ul-ui-builder's safe-area notes). Motion uses TweenService, the same easing family
-- as the UI controller.

local Players = game:GetService("Players")
local TweenService = game:GetService("TweenService")

local UIToast = {}

local ENTER = TweenInfo.new(0.22, Enum.EasingStyle.Back, Enum.EasingDirection.Out)
local LEAVE = TweenInfo.new(0.18, Enum.EasingStyle.Quad, Enum.EasingDirection.In)
local DEFAULT_HOLD = 2.0
local TOP_OFFSET = 48 -- pixels, clears the Roblox top bar at the common reference size

type Item = { text: string, hold: number }

local queue: { Item } = {}
local running = false
local screen: ScreenGui? = nil

local function getScreen(): ScreenGui?
	if screen and screen.Parent then
		return screen
	end
	local player = Players.LocalPlayer
	local gui = player and player:WaitForChild("PlayerGui", 10)
	if not gui then
		warn("[UIToast] PlayerGui not found; toast skipped")
		return nil
	end
	local s = Instance.new("ScreenGui")
	s.Name = "Toasts"
	s.ResetOnSpawn = false
	s.DisplayOrder = 100
	s.Parent = gui
	screen = s
	return s
end

local function build(parent: ScreenGui, text: string): TextLabel
	local label = Instance.new("TextLabel")
	label.Name = "Toast"
	label.AnchorPoint = Vector2.new(0.5, 0)
	label.Position = UDim2.new(0.5, 0, 0, TOP_OFFSET - 12) -- starts 12px higher, eases down
	label.Size = UDim2.new(0, 360, 0, 44)
	label.BackgroundColor3 = Color3.fromRGB(255, 241, 214)
	label.BackgroundTransparency = 0
	label.TextColor3 = Color3.fromRGB(74, 58, 34)
	label.Font = Enum.Font.FredokaOne
	label.TextScaled = true
	label.Text = text
	label.TextTransparency = 1
	label.BackgroundTransparency = 1
	label.Parent = parent

	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0.3, 0)
	corner.Parent = label

	local limit = Instance.new("UITextSizeConstraint")
	limit.MaxTextSize = 26
	limit.MinTextSize = 11
	limit.Parent = label
	return label
end

local function play(item: Item)
	local parent = getScreen()
	if not parent then
		return
	end
	local label = build(parent, item.text)
	local goal = { Position = UDim2.new(0.5, 0, 0, TOP_OFFSET), TextTransparency = 0, BackgroundTransparency = 0 }
	TweenService:Create(label, ENTER, goal):Play()
	task.wait(ENTER.Time + item.hold)
	local out = TweenService:Create(label, LEAVE, { TextTransparency = 1, BackgroundTransparency = 1 })
	out:Play()
	out.Completed:Wait()
	label:Destroy()
end

local function worker()
	running = true
	while #queue > 0 do
		local item = table.remove(queue, 1) :: Item
		play(item)
	end
	running = false
end

function UIToast.show(text: string, hold: number?)
	table.insert(queue, { text = text, hold = hold or DEFAULT_HOLD })
	if not running then
		task.spawn(worker)
	end
end

return UIToast
