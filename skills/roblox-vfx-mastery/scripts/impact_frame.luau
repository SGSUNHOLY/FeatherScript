-- ModuleScript: require from a LocalScript. Call play(PlayerGui, options).
-- Returns cancellation; each invocation owns only its own GUI and tween.
local TweenService = game:GetService("TweenService")
return function(playerGui, options)
    options = options or {}
    local duration = math.clamp(tonumber(options.duration) or 0.09, 0.03, 0.25)
    local gui = Instance.new("ScreenGui")
    gui.Name = "ImpactAccent"
    gui.IgnoreGuiInset = true
    gui.ResetOnSpawn = true
    gui.DisplayOrder = 20
    local frame = Instance.new("Frame")
    frame.Size = UDim2.fromScale(1, 1)
    frame.BackgroundColor3 = options.color or Color3.fromRGB(255, 221, 167)
    frame.BackgroundTransparency = options.reducedFlash and 0.96 or 0.72
    frame.BorderSizePixel = 0
    frame.Parent = gui
    gui.Parent = playerGui
    local tween = TweenService:Create(frame, TweenInfo.new(duration), {BackgroundTransparency = 1})
    local connection
    local closed = false
    local function cancel()
        if closed then return end
        closed = true
        if connection then connection:Disconnect() end
        tween:Cancel()
        gui:Destroy()
    end
    connection = tween.Completed:Connect(cancel)
    tween:Play()
    task.delay(duration + 0.1, cancel)
    return cancel
end
