--!strict
-- Opens and closes every page, scales them to the screen, drives hover and press
-- feedback, and keeps gamepad focus inside the open page. It knows the name of none
-- of the pages.
--
-- The UI declares its own behaviour through ATTRIBUTES and PROPERTIES that ui_build.py emits:
--
--   ScreenGui  UIKind      = "hud" | "page"     "page" starts hidden
--   CanvasFrame SelectionGroup = true           (pages) gamepad focus stays in the page
--   CanvasFrame RefWidth, RefHeight             the reference resolution it was authored at
--   Button     OpensPage   = "<ScreenGui name>" toggles that page
--   Button     ClosesPage  = true               closes the page it lives in
--   Button     HoverScale, HoverRotate, HoverTime, HoverStyle   hover feedback
--   Button     PressScale, PressTime                            click pop
--   ScreenGui  OpenStyle ("pop" | "instant"), OpenFrom, OpenTime
--
-- MOTION IS DATA. The numbers come from the theme's "motion" block.
--
-- RESPONSIVE. Each page's CanvasFrame has a UIScale (named "Scale") that maps the
-- reference resolution onto the screen. It is recomputed when the page's
-- AbsoluteSize changes (rotation, window resize). ScreenGui.AbsoluteSize is the
-- full screen area; Camera.ViewportSize is the safe area and is NOT used here.
-- If a spec sets scaleOn = "screen", the UIScale sits on the ScreenGui itself and
-- this file uses that one instead of adding a second.
--
-- ONE PAGE AT A TIME. Opening a page closes whatever else is open.
--
-- TWO RACES THIS FILE GUARDS AGAINST (the first version had both):
--   * A page closed and reopened inside its fade-out. The old fade's Completed
--     handler then hid the page that had just opened. Every tween is now stored
--     and cancelled before a new one starts, and Completed only acts if its tween
--     is still the current one.
--   * A click on the open button during the fade-out. Toggle reads openPage (the
--     logical state), not Enabled (the visual state), so it reopens cleanly.

local Players = game:GetService("Players")
local GuiService = game:GetService("GuiService")
local TweenService = game:GetService("TweenService")
local UserInputService = game:GetService("UserInputService")

local player = Players.LocalPlayer
local gui = player:WaitForChild("PlayerGui", 10)
assert(gui, "[UI] PlayerGui did not appear")
local playerGui: PlayerGui = gui :: PlayerGui

local OPEN_TIME = 0.16
local CLOSE_TIME = 0.12
local OPEN_FROM = 0.85
local FALLBACK_REF_W = 1280
local FALLBACK_REF_H = 720

local openPage: ScreenGui? = nil
local tweens: { [Instance]: Tween } = {}

-- Stop whatever tween owns this page (or its window), and forget it first so that
-- a Completed handler from the cancelled tween sees it is no longer current.
local function stopTween(owner: Instance)
	local t = tweens[owner]
	if t then
		tweens[owner] = nil
		t:Cancel()
	end
end

local function playTween(owner: Instance, info: TweenInfo, goal: { [string]: any }, onDone: (() -> ())?): Tween
	stopTween(owner)
	local tween = TweenService:Create(owner, info, goal)
	tweens[owner] = tween
	tween.Completed:Connect(function()
		-- A cancelled or superseded tween must not run its finish step.
		if tweens[owner] ~= tween then
			return
		end
		tweens[owner] = nil
		if onDone then
			onDone()
		end
	end)
	tween:Play()
	return tween
end

local function pages(): { ScreenGui }
	local out = {}
	for _, child in ipairs(playerGui:GetChildren()) do
		if child:IsA("ScreenGui") and child:GetAttribute("UIKind") == "page" then
			table.insert(out, child)
		end
	end
	return out
end

-- The canvas is the page's one full-size child (named CanvasFrame by ui_build.py).
local function canvasOf(page: ScreenGui): Frame?
	local canvas = page:FindFirstChild("CanvasFrame")
	if canvas and canvas:IsA("Frame") then
		return canvas
	end
	return nil
end

-- The window inside a page: the thing that pops, not the ScreenGui (which has no size of its own).
local function windowOf(page: ScreenGui): GuiObject?
	local canvas = canvasOf(page)
	if not canvas then
		return nil
	end
	for _, child in ipairs(canvas:GetChildren()) do
		if child:IsA("GuiObject") then
			return child
		end
	end
	return nil
end

-- Returns the UIScale that maps the reference resolution to the screen, creating it on
-- the canvas only if no scale already exists for this page (two would multiply).
local function responsiveScaleOf(page: ScreenGui): UIScale?
	local direct = page:FindFirstChildOfClass("UIScale")
	if direct then
		return direct
	end
	local canvas = canvasOf(page)
	if not canvas then
		return nil
	end
	local existing = canvas:FindFirstChild("Scale")
	if existing and existing:IsA("UIScale") then
		return existing
	end
	local s = Instance.new("UIScale")
	s.Name = "Scale"
	s.Parent = canvas
	return s
end

local function fitToScreen(page: ScreenGui)
	local scale = responsiveScaleOf(page)
	if not scale then
		return
	end
	local canvas = canvasOf(page)
	local refW = (canvas and canvas:GetAttribute("RefWidth")) or FALLBACK_REF_W
	local refH = (canvas and canvas:GetAttribute("RefHeight")) or FALLBACK_REF_H
	if typeof(refW) ~= "number" then
		refW = FALLBACK_REF_W
	end
	if typeof(refH) ~= "number" then
		refH = FALLBACK_REF_H
	end
	local size = page.AbsoluteSize
	if size.X <= 0 or size.Y <= 0 then
		return -- not laid out yet; the next AbsoluteSize change or open fixes it
	end
	scale.Scale = math.min(size.X / (refW :: number), size.Y / (refH :: number))
end

local function setPopScale(window: GuiObject?, value: number)
	if not window then
		return
	end
	local scale = window:FindFirstChild("PageScale")
	if not scale then
		scale = Instance.new("UIScale")
		scale.Name = "PageScale"
		scale.Parent = window
	end
	(scale :: UIScale).Scale = value
end

-- Gamepad: put focus on the first selectable control of the page. GuiService:Select
-- picks the smallest SelectionOrder among the page's selectable, visible descendants.
local function focusPage(page: ScreenGui)
	if not UserInputService.GamepadEnabled then
		return
	end
	local canvas = canvasOf(page)
	if canvas then
		GuiService:Select(canvas)
	end
end

local function close(page: ScreenGui?)
	if not page or not page.Enabled then
		return
	end
	if openPage == page then
		openPage = nil
	end
	local window = windowOf(page)
	local scale = window and window:FindFirstChild("PageScale") :: UIScale?
	if scale and page:GetAttribute("OpenStyle") ~= "instant" then
		playTween(
			scale,
			TweenInfo.new(CLOSE_TIME, Enum.EasingStyle.Quad, Enum.EasingDirection.In),
			{ Scale = 0.85 },
			function()
				page.Enabled = false
			end
		)
	else
		stopTween(page)
		page.Enabled = false
	end
end

local function open(page: ScreenGui)
	if openPage and openPage ~= page then
		close(openPage)
	end
	openPage = page
	-- Cancel a fade-out that may still be running on this page's window.
	local window = windowOf(page)
	if window then
		local old = window:FindFirstChild("PageScale")
		if old then
			stopTween(old)
		end
	end
	fitToScreen(page)
	page.Enabled = true

	if page:GetAttribute("OpenStyle") == "instant" then
		setPopScale(window, 1)
	else
		local from = page:GetAttribute("OpenFrom")
		local time = page:GetAttribute("OpenTime")
		setPopScale(window, if typeof(from) == "number" then from else OPEN_FROM)
		local scale = window and window:FindFirstChild("PageScale") :: UIScale?
		if scale then
			-- Back easing is the standard Roblox pop: a small overshoot, not a bounce.
			playTween(
				scale,
				TweenInfo.new(
					if typeof(time) == "number" then time else OPEN_TIME,
					Enum.EasingStyle.Back,
					Enum.EasingDirection.Out
				),
				{ Scale = 1 }
			)
		end
	end
	focusPage(page)
end

local function toggle(name: string)
	local page = playerGui:FindFirstChild(name)
	if not page or not page:IsA("ScreenGui") then
		-- Loud on purpose: a renamed page must fail visibly, not silently.
		warn(("[UI] no ScreenGui named %q to open"):format(name))
		return
	end
	-- Read the logical state (openPage), not the visual one (Enabled): during a fade-out
	-- Enabled is still true, and a click must reopen the page, not restart the close.
	if openPage == page then
		close(page)
	else
		open(page)
	end
end

local function pageOf(instance: Instance): ScreenGui?
	local node: Instance? = instance
	while node do
		if node:IsA("ScreenGui") then
			return node
		end
		node = node.Parent
	end
	return nil
end

local function easing(name: any): Enum.EasingStyle
	local ok, style = pcall(function()
		return (Enum.EasingStyle :: any)[name]
	end)
	if ok and style then
		return style
	end
	return Enum.EasingStyle.Quad
end

-- Hover and press feedback. Scale lives on a UIScale named MotionScale so it never
-- fights the page's pop (PageScale) or the responsive scale. Rotation is the
-- button's own Rotation, always measured from where it started.
local function wireMotion(button: GuiButton)
	local hoverScale = button:GetAttribute("HoverScale")
	local pressScale = button:GetAttribute("PressScale")
	if typeof(hoverScale) ~= "number" and typeof(pressScale) ~= "number" then
		return
	end

	local scale = button:FindFirstChild("MotionScale") :: UIScale?
	if not scale then
		local s = Instance.new("UIScale")
		s.Name = "MotionScale"
		s.Parent = button
		scale = s
	end
	local ms = scale :: UIScale

	local baseRotation = button.Rotation
	local hoverRotate = button:GetAttribute("HoverRotate")
	local hoverTime = button:GetAttribute("HoverTime")
	local pressTime = button:GetAttribute("PressTime")
	local hoverInfo = TweenInfo.new(
		if typeof(hoverTime) == "number" then hoverTime else 0.1,
		easing(button:GetAttribute("HoverStyle")),
		Enum.EasingDirection.Out
	)
	local pressInfo = TweenInfo.new(
		if typeof(pressTime) == "number" then pressTime else 0.07,
		Enum.EasingStyle.Quad,
		Enum.EasingDirection.Out
	)

	local hovered = false
	local pressed = false

	-- One place decides the target state, so hover, press and release cannot disagree.
	local function rest()
		local target = 1
		local info = hoverInfo
		if pressed and typeof(pressScale) == "number" then
			target = pressScale
			info = pressInfo
		elseif hovered and typeof(hoverScale) == "number" then
			target = hoverScale
		end
		local rot = baseRotation
		if hovered and not pressed and typeof(hoverRotate) == "number" then
			rot = baseRotation + hoverRotate
		end
		playTween(ms, info, { Scale = target })
		playTween(button, info, { Rotation = rot })
	end

	button.MouseEnter:Connect(function()
		hovered = true
		rest()
	end)
	button.MouseLeave:Connect(function()
		hovered = false
		pressed = false -- a drag off the button releases it visually
		rest()
	end)
	button.MouseButton1Down:Connect(function()
		pressed = true
		rest()
	end)
	button.MouseButton1Up:Connect(function()
		pressed = false
		rest()
	end)
end

local wired: { [GuiButton]: boolean } = {}

local function wire(button: GuiButton)
	if wired[button] then
		return
	end
	wired[button] = true
	wireMotion(button)

	local opens = button:GetAttribute("OpensPage")
	if typeof(opens) == "string" then
		button.Activated:Connect(function()
			toggle(opens)
		end)
	end
	if button:GetAttribute("ClosesPage") == true then
		button.Activated:Connect(function()
			close(pageOf(button))
		end)
	end
end

local function bind(root: Instance)
	for _, descendant in ipairs(root:GetDescendants()) do
		if descendant:IsA("GuiButton") then
			wire(descendant)
		end
	end
	root.DescendantAdded:Connect(function(descendant)
		if descendant:IsA("GuiButton") then
			-- Defer one step: a button may be parented before its attributes are set in the same frame.
			task.defer(function()
				if descendant:IsDescendantOf(root) then
					wire(descendant)
				end
			end)
		end
	end)
end

for _, page in ipairs(pages()) do
	page.Enabled = false
	fitToScreen(page)
	page:GetPropertyChangedSignal("AbsoluteSize"):Connect(function()
		fitToScreen(page)
	end)
end
bind(playerGui)

-- Escape and the gamepad B button close the top page.
UserInputService.InputBegan:Connect(function(input, processed)
	if processed then
		return
	end
	if (input.KeyCode == Enum.KeyCode.Escape or input.KeyCode == Enum.KeyCode.ButtonB) and openPage then
		close(openPage)
	end
end)

