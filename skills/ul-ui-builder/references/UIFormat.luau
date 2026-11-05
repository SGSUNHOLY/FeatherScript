--!strict
-- UIFormat.luau - pure number and time formatting for HUD text.
-- No Roblox calls, so it can be tested anywhere (the functions take plain numbers).
--
-- compact(1234)      -> "1.2K"      (1 decimal under 100 of a unit, whole numbers above)
-- compact(3.4e6)     -> "3.4M"
-- compact(999)       -> "999"
-- clock(75.42)       -> "1:15.42"   (m:ss.cc, the speedrun/timer style)
-- clock(3725)        -> "1:02:05"   (h:mm:ss once an hour is passed)
--
-- Sources for the formats: Roblox's own number abbreviations in the Creator Store
-- and common HUD practice; the rule set itself is this file's, not an API.

local UIFormat = {}

local SUFFIXES = { "", "K", "M", "B", "T" }

function UIFormat.compact(n: number): string
	local sign = if n < 0 then "-" else ""
	local a = math.abs(n)
	local i = 1
	while a >= 1000 and i < #SUFFIXES do
		a /= 1000
		i += 1
	end
	if i == 1 then
		return sign .. tostring(math.floor(a + 0.5))
	end
	-- 999,999 rounds to "1000K" otherwise: carry into the next unit instead.
	if math.floor(a + 0.5) >= 1000 and i < #SUFFIXES then
		a /= 1000
		i += 1
	end
	-- One decimal while the number is small, whole above that.
	if a < 10 then
		return sign .. string.format("%.1f", a) .. SUFFIXES[i]
	end
	return sign .. tostring(math.floor(a + 0.5)) .. SUFFIXES[i]
end

function UIFormat.clock(seconds: number): string
	local s = math.max(0, seconds)
	if s >= 3600 then
		local h = math.floor(s / 3600)
		local m = math.floor((s - h * 3600) / 60)
		local sec = math.floor(s % 60)
		return string.format("%d:%02d:%02d", h, m, sec)
	end
	local m = math.floor(s / 60)
	local sec = s - m * 60
	return string.format("%d:%05.2f", m, sec)
end

return UIFormat
