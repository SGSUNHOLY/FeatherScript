--!strict
-- Compile-only check for a Luau source string. Nothing in the source runs: loadstring
-- returns a compiled function and this never calls it.
-- Usage (execute_luau, Edit mode): paste this function, then call it with the file text.

local function compileCheck(source: string, chunkName: string?): (boolean, string?)
	local name = chunkName or "=source"
	local ok, fn, err = pcall(loadstring, source, name)
	if not ok then
		return false, "loadstring unavailable: " .. tostring(fn)
	end
	if fn == nil then
		return false, tostring(err)
	end
	return true, nil
end

return compileCheck
