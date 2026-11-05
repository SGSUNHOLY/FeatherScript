# SPDX-License-Identifier: GPL-3.0-or-later
# feather_tools.py - bridge-native FeatherScript tools.
#
# These are tools the BRIDGE itself provides, on top of whatever the Roblox
# Studio MCP advertises. Each one is a thin, single-purpose wrapper that the
# extension lists exactly like a Studio tool, so the model sees them in
# list_commands and calls them with the normal JSON envelope. Most compile to
# one small, self-contained Luau snippet that runs through Studio's
# execute_luau; the capture tools wrap screen_capture.
#
# Why: the Studio MCP exposes ~34 broad tools, and models routinely fumble the
# common, narrow operations (read these properties, find these parts, align
# these objects) by hand-writing Luau. Narrow tools with tight schemas cost
# fewer tokens and fail less.
#
# Rules kept here:
#   - No third-party dependencies (stdlib only) so the bridge keeps working.
#   - Nothing runs unless Studio is attached: bridge.py only advertises these
#     while the primary Roblox server has its own tool catalogue.
#   - Every Luau wrapper runs its body inside pcall and returns
#     {ok = true, data = ...} / {ok = false, error = "..."}, so a Studio-side
#     failure comes back as a clean, one-line error instead of a stack trace.
from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any, Callable, Optional

# ── Luau helpers prepended to every generated snippet ──────────────────────
# Kept compact: it is resent with each call, and execute_luau rejects very
# large payloads outright.
LUA_PRELUDE = r'''
local function __svc(n) return game:GetService(n) end
local __http = __svc("HttpService")
local function __json(v)
	local ok, s = pcall(function() return __http:JSONEncode(v) end)
	if ok and type(s) == "string" then return s end
	return '"<unserialisable result>"'
end
local function __norm(s) return string.lower(tostring(s)) end
local function __child(n, name)
	local key = __norm(name)
	for _, c in ipairs(n:GetChildren()) do
		if __norm(c.Name) == key then return c end
	end
	return nil
end
local function __resolve(path)
	if type(path) ~= "string" or path == "" then return nil end
	local node = game
	for part in string.gmatch(path, "[^%.]+") do
		if __norm(part) ~= "game" then
			node = __child(node, part)
			if not node then return nil end
		end
	end
	return node
end
local function __path(inst)
	if not inst then return nil end
	local ok, full = pcall(function() return inst:GetFullName() end)
	if ok and full and full ~= "" then return full end
	return tostring(inst)
end
local function __val(v)
	local t = typeof(v)
	if t == "Instance" then return __path(v) end
	if t == "Vector3" then return {x = v.X, y = v.Y, z = v.Z} end
	if t == "Vector2" then return {x = v.X, y = v.Y} end
	if t == "Color3" then
		return string.format("#%02X%02X%02X",
			math.floor(v.R * 255 + 0.5), math.floor(v.G * 255 + 0.5), math.floor(v.B * 255 + 0.5))
	end
	if t == "BrickColor" then return v.Name end
	if t == "UDim2" or t == "UDim" or t == "CFrame" or t == "EnumItem" or t == "NumberRange"
		or t == "NumberSequence" or t == "ColorSequence" or t == "Rect" or t == "Font" then
		return tostring(v)
	end
	if type(v) == "table" then
		local o = {}
		for k, x in pairs(v) do o[tostring(k)] = __val(x) end
		return o
	end
	if type(v) == "number" or type(v) == "string" or type(v) == "boolean" then return v end
	local ok, s = pcall(tostring, v)
	if ok then return s end
	return "<" .. tostring(t) .. ">"
end
local function __coerce(cur, v)
	local t = typeof(cur)
	if t == "Vector3" then
		if type(v) == "table" then
			return Vector3.new(v[1] or v.x or 0, v[2] or v.y or 0, v[3] or v.z or 0)
		elseif type(v) == "number" then
			return Vector3.new(v, v, v)
		end
	elseif t == "Vector2" then
		if type(v) == "table" then return Vector2.new(v[1] or v.x or 0, v[2] or v.y or 0) end
	elseif t == "Color3" then
		if type(v) == "string" then return Color3.fromHex(v) end
		if type(v) == "table" then
			return Color3.fromRGB(v[1] or v.r or 0, v[2] or v.g or 0, v[3] or v.b or 0)
		end
	elseif t == "UDim2" then
		if type(v) == "table" and v[1] and v[2] and v[3] and v[4] then
			return UDim2.new(v[1], v[2], v[3], v[4])
		end
	elseif t == "EnumItem" then
		if type(v) == "string" then
			local e = cur.EnumType[v]
			if e then return e end
			error("invalid " .. cur.EnumType.Name .. " value: " .. v)
		end
	elseif t == "BrickColor" then
		if type(v) == "string" or type(v) == "number" then return BrickColor.new(v) end
	end
	return v
end
local function __find(path)
	local inst = __resolve(path)
	if not inst then error("no instance at path: " .. tostring(path)) end
	return inst
end
local function __pat(s)
	s = string.lower(s):gsub("%*", "\1")
	s = s:gsub("[%^%$%(%)%%%.%[%]%+%-%?%*]", "%%%0")
	s = s:gsub("\1", ".*")
	return "^" .. s .. "$"
end
local function __pivotpos(i)
	if i:IsA("BasePart") then return i.Position end
	local ok, cf = pcall(function() return i:GetPivot() end)
	if ok then return cf.Position end
	error("no position for " .. i.ClassName)
end
local function __movepivot(i, pos)
	if i:IsA("BasePart") then
		i.Position = pos
	else
		i:PivotTo(i:GetPivot() + (pos - i:GetPivot().Position))
	end
end
'''


def _program(body: str) -> str:
    """Wrap a Lua body so failures come back as {ok=false, error=...}.

    The result is JSON-ENCODED INSIDE Lua on purpose: Studio's executor turns
    any returned table into an OBJECT with stringified numeric keys in hash
    order (validated live: `return {10,20,30}` came back {"1":10,"3":30,"2":20}).
    JSONEncode keeps real arrays ordered, so lists of paths/instances survive as
    arrays instead of jumbled maps.
    """
    return (
        LUA_PRELUDE
        + "\nlocal __ok, __res = pcall(function()\n"
        + body
        + "\nend)\n"
        + 'if not __ok then return \'{"ok":false,"error":\' .. __json(tostring(__res)) .. "}" end\n'
        + 'return \'{"ok":true,"data":\' .. __json(__res) .. "}"\n'
    )


def _q(s: Any) -> str:
    """Lua string literal."""
    text = str(s)
    text = text.replace("\\", "\\\\").replace('"', '\\"')
    text = text.replace("\r", "\\r").replace("\n", "\\n").replace("\t", "\\t")
    return '"' + text + '"'


def _lua(value: Any) -> str:
    """JSON-ish Python value -> Lua literal."""
    if value is None:
        return "nil"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, (int, float)):
        return repr(value)
    if isinstance(value, str):
        return _q(value)
    if isinstance(value, (list, tuple)):
        return "{" + ", ".join(_lua(v) for v in value) + "}"
    if isinstance(value, dict):
        parts = []
        for k, v in value.items():
            parts.append("[" + _q(k) + "] = " + _lua(v))
        return "{" + ", ".join(parts) + "}"
    raise TypeError(f"cannot convert {type(value)} to Lua")


def _fill(template: str, **values: Any) -> str:
    """Replace {{arg}} placeholders with Lua literals; every declared optional
    argument must have a default, so a leftover token is a bug, not a nil."""
    for key, value in values.items():
        template = template.replace("{{" + key + "}}", _lua(value))
    leftover = __import__("re").search(r"\{\{[a-zA-Z_]+\}\}", template)
    if leftover:
        raise NativeError(f"internal: unresolved argument {leftover.group(0)}")
    return template


def _num(value: Any, default: float, low: float, high: float) -> float:
    try:
        n = float(value)
    except (TypeError, ValueError):
        return default
    return max(low, min(high, n))


# ── errors / result helpers ───────────────────────────────────────────────

class NativeError(RuntimeError):
    pass


_INTERNAL_FRAME = r"^(?:\S*(?:ExecuteLuauTool|CommandExecution):\d+:\s*)+"


def _clean_error(text: str) -> str:
    text = str(text or "").strip()
    text = text.split("\nstack traceback:")[0].strip()
    import re

    text = re.sub(_INTERNAL_FRAME, "", text)
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    return lines[0] if lines else text


def _looks_like_luau_failure(text: str) -> bool:
    import re

    return bool(re.search(r"(?:ExecuteLuauTool|CommandExecution):\d+:", text))


class Ctx:
    """What a native tool may use to reach the rest of the bridge."""

    def __init__(self, call_mcp: Callable[[str, dict, float], dict], timeout: float):
        self.call_mcp = call_mcp
        self.timeout = timeout

    def mcp(self, name: str, arguments: Optional[dict] = None, timeout: Optional[float] = None) -> dict:
        return self.call_mcp(name, dict(arguments or {}), timeout or self.timeout)

    def luau(self, code: str, datamodel: str = "Edit", timeout: Optional[float] = None) -> str:
        res = self.mcp(
            "execute_luau",
            {"code": code, "datamodel_type": datamodel},
            timeout or min(self.timeout, 25.0),
        )
        text = (res.get("text") or "").strip()
        if _looks_like_luau_failure(text):
            raise NativeError(_clean_error(text))
        return text


def _luau_run(ctx: Ctx, template: str, datamodel: str = "Edit", **values: Any) -> dict:
    code = _program(_fill(template, **values))
    text = ctx.luau(code, datamodel)
    payload = None
    try:
        payload = json.loads(text)
    except (ValueError, TypeError):
        payload = None
    if isinstance(payload, dict):
        if payload.get("ok") is False:
            raise NativeError(_clean_error(payload.get("error") or "the operation failed"))
        if payload.get("ok") is True:
            data = payload.get("data")
            if isinstance(data, str):
                return {"text": data}
            return {"text": json.dumps(data, ensure_ascii=False, indent=1)}
    return {"text": text or "(no output)"}


def _luau_passthrough(ctx: Ctx, code: str, datamodel: str) -> dict:
    """For run_client_luau / run_server_luau: the model's own code, untouched."""
    if not isinstance(code, str) or not code.strip():
        raise NativeError("code is required")
    text = ctx.luau(code, datamodel)
    return {"text": text or "(no output)"}


# ── registry ──────────────────────────────────────────────────────────────

_TOOLS: list[dict] = []
_BY_NAME: dict[str, dict] = {}


def _string(desc: str, **kw) -> dict:
    d = {"type": "string", "description": desc}
    d.update(kw)
    return d


def _bool(desc: str) -> dict:
    return {"type": "boolean", "description": desc}


def _int(desc: str, minimum: int, maximum: int, default: int) -> dict:
    return {"type": "integer", "description": desc, "minimum": minimum, "maximum": maximum, "default": default}


def _arr(desc: str, items: Optional[dict] = None) -> dict:
    d = {"type": "array", "description": desc}
    if items:
        d["items"] = items
    return d


def tool(name: str, description: str, properties: dict, required=(), run=None, body=None,
         datamodel="Edit", defaults=None):
    schema = {"type": "object", "properties": properties, "required": list(required)}
    entry = {
        "name": name,
        "description": description,
        "inputSchema": schema,
    }
    if run is not None:
        entry["run"] = run
    elif body is not None:
        base = dict(defaults or {})

        def _runner(ctx, args, _body=body, _dm=datamodel, _base=base):
            merged = dict(_base)
            merged.update(args or {})
            return _luau_run(ctx, _body, _dm, **merged)

        entry["run"] = _runner
    _TOOLS.append(entry)
    _BY_NAME[name] = entry


def tool_defs() -> list[dict]:
    """Tool catalogue in MCP shape (bridge adds server/prefixing)."""
    return [{"name": t["name"], "description": t["description"], "inputSchema": t["inputSchema"]} for t in _TOOLS if t["name"] not in _WORKFLOW_GROUPS.originals]


def is_native(name: str) -> bool:
    return name in _BY_NAME


# Native tools that do NOT need a live Studio connection. bridge.py keeps these
# advertised when the Studio MCP has no catalogue, so local file tools still
# work in degraded mode.
_ALWAYS_AVAILABLE = {"feather_getskills"}


def always_available(name: str) -> bool:
    return name in _ALWAYS_AVAILABLE


def call(name: str, arguments: dict, call_mcp: Callable[[str, dict, float], dict], timeout: float) -> dict:
    entry = _BY_NAME.get(name)
    if entry is None:
        raise NativeError(f"unknown FeatherScript tool '{name}'")
    ctx = Ctx(call_mcp, timeout)
    try:
        return entry["run"](ctx, dict(arguments or {}))
    except NativeError:
        raise
    except Exception as exc:  # noqa: BLE001 - surface every failure as a clean message
        raise NativeError(_clean_error(str(exc))) from exc


# ══════════════════════════════════════════════════════════════════════════
#  INSPECT
# ══════════════════════════════════════════════════════════════════════════

def _get_properties(ctx: Ctx, args: dict) -> dict:
    path = args.get("path")
    if not isinstance(path, str) or not path.strip():
        raise NativeError("path is required")
    wanted = args.get("properties") or []
    if not wanted:
        # There is no public Instance:GetProperties() (confirmed live: it is
        # "not a valid member" even in Studio), so the all-properties case is
        # served by the MCP's own inspect_instance, which reflects the real
        # readable set. Only its property map is returned - attributes and
        # children belong to other commands.
        res = ctx.mcp("inspect_instance", {"path": path}, timeout=min(ctx.timeout, 60.0))
        text = (res.get("text") or "").strip()
        if not text:
            raise NativeError("Studio returned no property data for that path")
        try:
            payload = json.loads(text)
        except (ValueError, TypeError):
            return {"text": text}
        props = payload.get("properties") if isinstance(payload, dict) else None
        if isinstance(props, dict):
            return {"text": json.dumps({
                "path": payload.get("path", path),
                "class": payload.get("className"),
                "properties": props,
            }, ensure_ascii=False, indent=1)}
        return {"text": text}
    return _luau_run(ctx, _GET_PROPERTIES_BODY, "Edit", path=path, properties=wanted)


_GET_PROPERTIES_BODY = """
local inst = __find({{path}})
local out = {}
for _, p in ipairs({{properties}}) do
	local okv, v = pcall(function() return inst[p] end)
	out[p] = okv and __val(v) or "<unreadable>"
end
return {path = __path(inst), class = inst.ClassName, properties = out}
"""


tool(
    "get_properties",
    "Read exact property values of one instance. Omit `properties` for every readable property "
    "(via Studio's inspection), or pass names to read only those. Use it before editing values, "
    "or whenever the user asks what something is set to.",
    {
        "path": _string("Dot-path to the instance, e.g. 'Workspace.Model.Part' (case-insensitive)."),
        "properties": _arr("Property names to read. Omit for every readable property.", _string("Property name")),
    },
    required=("path",),
    run=_get_properties,
)

tool(
    "set_properties",
    "Write property values on one instance with automatic type conversion (Vector3 {x,y,z}, Color3 '#rrggbb', "
    "UDim2 [sx,ox,sy,oy], Enum names). Use it for simple value changes instead of writing Luau.",
    {
        "path": _string("Dot-path to the instance to change."),
        "properties": {
            "type": "object",
            "description": "Property name -> new value. Numbers/booleans/strings are used as-is; tables are converted to the property's current type.",
            "additionalProperties": True,
        },
    },
    required=("path", "properties"),
    body="""
local inst = __find({{path}})
local changed, errors = {}, {}
for k, v in pairs({{properties}}) do
	local okc, cur = pcall(function() return inst[k] end)
	local ok2, err = pcall(function() inst[k] = __coerce(cur, v) end)
	if ok2 then
		changed[k] = __val(inst[k])
	else
		errors[k] = tostring(err)
	end
end
return {path = __path(inst), changed = changed, errors = errors}
""",
)

tool(
    "get_attributes",
    "Read every attribute on an instance (the key/value pairs scripts store with SetAttribute).",
    {
        "path": _string("Dot-path to the instance."),
    },
    required=("path",),
    body="""
local inst = __find({{path}})
return {path = __path(inst), attributes = __val(inst:GetAttributes())}
""",
)

tool(
    "set_attributes",
    "Create or overwrite attributes on one instance. Values must be strings, numbers or booleans.",
    {
        "path": _string("Dot-path to the instance."),
        "attributes": {
            "type": "object",
            "description": "Attribute name -> string/number/boolean value.",
            "additionalProperties": True,
        },
    },
    required=("path", "attributes"),
    body="""
local inst = __find({{path}})
local done, errors = {}, {}
for k, v in pairs({{attributes}}) do
	local ok2, err = pcall(function() inst:SetAttribute(k, v) end)
	if ok2 then done[k] = __val(inst:GetAttribute(k)) else errors[k] = tostring(err) end
end
return {path = __path(inst), set = done, errors = errors}
""",
)

tool(
    "remove_attributes",
    "Delete named attributes from an instance.",
    {
        "path": _string("Dot-path to the instance."),
        "names": _arr("Attribute names to remove.", _string("Attribute name")),
    },
    required=("path", "names"),
    body="""
local inst = __find({{path}})
local removed = {}
for _, k in ipairs({{names}}) do
	if inst:GetAttribute(k) ~= nil then
		pcall(function() inst:SetAttribute(k, nil) end)
		table.insert(removed, k)
	end
end
return {path = __path(inst), removed = removed}
""",
)

tool(
    "get_tags",
    "List the CollectionService tags on an instance.",
    {
        "path": _string("Dot-path to the instance."),
    },
    required=("path",),
    body="""
local inst = __find({{path}})
return {path = __path(inst), tags = __svc("CollectionService"):GetTags(inst)}
""",
)

tool(
    "add_tag",
    "Add one CollectionService tag to an instance.",
    {
        "path": _string("Dot-path to the instance."),
        "tag": _string("Tag name."),
    },
    required=("path", "tag"),
    body="""
local inst = __find({{path}})
__svc("CollectionService"):AddTag(inst, {{tag}})
return {path = __path(inst), tags = __svc("CollectionService"):GetTags(inst)}
""",
)

tool(
    "remove_tag",
    "Remove one CollectionService tag from an instance.",
    {
        "path": _string("Dot-path to the instance."),
        "tag": _string("Tag name."),
    },
    required=("path", "tag"),
    body="""
local inst = __find({{path}})
__svc("CollectionService"):RemoveTag(inst, {{tag}})
return {path = __path(inst), tags = __svc("CollectionService"):GetTags(inst)}
""",
)

tool(
    "find_tagged",
    "Find every instance carrying a CollectionService tag, optionally limited to one root.",
    {
        "tag": _string("Tag name."),
        "root": _string("Dot-path to search under. Defaults to Workspace."),
        "limit": _int("Maximum results.", 1, 200, 50),
    },
    required=("tag",),
    defaults={"root": "", "limit": 50},
    body="""
local root = ({{root}} ~= "" and __find({{root}})) or workspace
local out = {}
for _, inst in ipairs(__svc("CollectionService"):GetTagged({{tag}})) do
	if inst == root or inst:IsDescendantOf(root) then
		table.insert(out, {path = __path(inst), class = inst.ClassName})
	end
	if #out >= {{limit}} then break end
end
return {tag = {{tag}}, count = #out, instances = out}
""",
)

tool(
    "list_children",
    "List the direct children of an instance with name, class and child count; raise `depth` to walk deeper. "
    "Use it to explore a model/folder before naming paths in other commands.",
    {
        "path": _string("Dot-path to the parent."),
        "class": _string("Only return instances of this class (IsA), e.g. 'BasePart'."),
        "depth": _int("How many levels to walk (1 = direct children only).", 1, 4, 1),
        "limit": _int("Maximum results.", 1, 500, 200),
    },
    required=("path",),
    defaults={"class": "", "depth": 1, "limit": 200},
    body="""
local inst = __find({{path}})
local out = {}
local function walk(node, left)
	for _, c in ipairs(node:GetChildren()) do
		if #out >= {{limit}} then return end
		local okcls, keep = pcall(function() return {{class}} == "" or c:IsA({{class}}) end)
		if okcls and keep then
			table.insert(out, {name = c.Name, class = c.ClassName, children = #c:GetChildren(), path = __path(c)})
		end
		if left > 1 then walk(c, left - 1) end
	end
end
walk(inst, {{depth}})
return {path = __path(inst), count = #out, children = out}
""",
)

tool(
    "find_instances",
    "Find instances by name wildcard, class and/or tag under a root and return their exact paths. "
    "Use it when you know roughly what something is called but not its path - it beats guessing paths for execute_luau.",
    {
        "name": _string("Name to match, case-insensitive; '*' is a wildcard (e.g. 'Part*')."),
        "class": _string("Only instances of this class or a subclass, e.g. 'BasePart', 'Model', 'Script'."),
        "tag": _string("Only instances carrying this CollectionService tag."),
        "root": _string("Dot-path to search under. Defaults to Workspace."),
        "limit": _int("Maximum results.", 1, 200, 50),
    },
    defaults={"name": "", "class": "", "tag": "", "root": "", "limit": 50},
    body="""
local root = ({{root}} ~= "" and __find({{root}})) or workspace
local pattern = __pat({{name}} == "" and "*" or {{name}})
local cls, tag = {{class}}, {{tag}}
local out = {}
local scanned = 0
for _, inst in ipairs(root:GetDescendants()) do
	scanned += 1
	local okName, instName = pcall(function() return inst.Name end)
	local okCls, keepCls = pcall(function() return cls == "" or inst:IsA(cls) end)
	local keepTag = tag == "" or __svc("CollectionService"):HasTag(inst, tag)
	if okName and okCls and keepCls and keepTag and string.match(__norm(instName), pattern) then
		table.insert(out, {path = __path(inst), class = inst.ClassName})
		if #out >= {{limit}} then break end
	end
end
return {root = __path(root), scanned = scanned, count = #out, instances = out}
""",
)

tool(
    "count_instances",
    "Count instances under a root, optionally filtered by class, grouped by ClassName. "
    "Use it for audits (how many parts, scripts, lights...) instead of guessing.",
    {
        "root": _string("Dot-path to count under. Defaults to Workspace."),
        "class": _string("Only instances of this class or a subclass."),
    },
    defaults={"root": "", "class": ""},
    body="""
local root = ({{root}} ~= "" and __find({{root}})) or workspace
local cls = {{class}}
local counts, total = {}, 0
for _, inst in ipairs(root:GetDescendants()) do
	local ok, keep = pcall(function() return cls == "" or inst:IsA(cls) end)
	if ok and keep then
		counts[inst.ClassName] = (counts[inst.ClassName] or 0) + 1
		total += 1
	end
end
return {root = __path(root), total = total, byClass = counts}
""",
)

tool(
    "describe_instance",
    "One-call summary of an instance: class, parent, child count, attributes, tags, and size/position "
    "(or model bounds). Use it to orient yourself before editing.",
    {
        "path": _string("Dot-path to the instance."),
    },
    required=("path",),
    body="""
local inst = __find({{path}})
local info = {path = __path(inst), name = inst.Name, class = inst.ClassName,
	parent = __path(inst.Parent), children = #inst:GetChildren()}
local n = 0
for _ in pairs(inst:GetAttributes()) do n += 1 end
info.attributes = n
info.tags = __svc("CollectionService"):GetTags(inst)
if inst:IsA("BasePart") then
	info.position = __val(inst.Position)
	info.size = __val(inst.Size)
	info.anchored = inst.Anchored
	info.color = __val(inst.Color)
	info.material = tostring(inst.Material)
elseif inst:IsA("Model") then
	local ok, cf, size = pcall(function() return inst:GetBoundingBox() end)
	if ok then
		info.center = __val(cf.Position)
		info.size = __val(size)
	end
	info.primaryPart = __path(inst.PrimaryPart)
end
return info
""",
)

tool(
    "get_selection",
    "Read what is currently selected in Studio, with exact paths.",
    {},
    body="""
local out = {}
for _, inst in ipairs(__svc("Selection"):Get()) do
	table.insert(out, {path = __path(inst), class = inst.ClassName})
end
return {count = #out, instances = out}
""",
)

tool(
    "select_instances",
    "Select instances in Studio by path so the user sees them highlighted; optionally add to the current selection.",
    {
        "paths": _arr("Dot-paths to select.", _string("Instance path")),
        "add": _bool("Add to the current selection instead of replacing it."),
    },
    required=("paths",),
    defaults={"add": False},
    body="""
local sel = __svc("Selection")
local found, missing = {}, {}
for _, p in ipairs({{paths}}) do
	local inst = __resolve(p)
	if inst then table.insert(found, inst) else table.insert(missing, p) end
end
if #found == 0 then error("none of the given paths exist") end
if {{add}} then
	local cur = sel:Get()
	for _, inst in ipairs(found) do table.insert(cur, inst) end
	sel:Set(cur)
else
	sel:Set(found)
end
return {selected = #sel:Get(), missing = missing}
""",
)

tool(
    "get_bounds",
    "World-space center and size of a part or model - useful for placing things without guessing coordinates.",
    {
        "path": _string("Dot-path to a BasePart or Model."),
    },
    required=("path",),
    body="""
local inst = __find({{path}})
if inst:IsA("BasePart") then
	return {path = __path(inst), center = __val(inst.Position), size = __val(inst.Size)}
end
local ok, cf, size = pcall(function() return inst:GetBoundingBox() end)
if ok then
	return {path = __path(inst), center = __val(cf.Position), size = __val(size)}
end
error("no bounds for a " .. inst.ClassName .. " - name a BasePart or Model")
""",
)

tool(
    "get_place_info",
    "Basic place info: name, place/game id, creator, whether Studio is playing, and player count.",
    {},
    body="""
local rs = __svc("RunService")
return {
	name = game.Name,
	placeId = game.PlaceId,
	gameId = game.GameId,
	creatorId = game.CreatorId,
	creatorType = tostring(game.CreatorType),
	playing = rs:IsRunning(),
	players = #__svc("Players"):GetPlayers(),
	workspace = __path(workspace),
}
""",
)

tool(
    "get_players",
    "List the players currently in the running playtest (name, display name, UserId).",
    {},
    body="""
local out = {}
for _, p in ipairs(__svc("Players"):GetPlayers()) do
	table.insert(out, {name = p.Name, displayName = p.DisplayName, userId = p.UserId})
end
return {count = #out, players = out}
""",
)

tool(
    "find_in_scripts",
    "Search script source text for a plain string and return the script path, line number and the matching line. "
    "Use it to locate where a value/name is used before editing.",
    {
        "needle": _string("Plain text to find (not a Luau pattern)."),
        "root": _string("Dot-path to search under. Defaults to the whole game."),
        "case_sensitive": _bool("Match case exactly. Defaults to false."),
        "limit": _int("Maximum hits.", 1, 100, 20),
    },
    required=("needle",),
    defaults={"root": "", "case_sensitive": False, "limit": 20},
    body="""
local root = ({{root}} ~= "" and __find({{root}})) or game
local case = {{case_sensitive}}
local needle = case and {{needle}} or string.lower({{needle}})
local out = {}
local scanned = 0
for _, inst in ipairs(root:GetDescendants()) do
	if inst:IsA("LuaSourceContainer") then
		scanned += 1
		if scanned > 600 then break end
		local ok, src = pcall(function() return inst.Source end)
		if ok and type(src) == "string" then
			local hay = case and src or string.lower(src)
			local pos = 1
			while true do
				local i, j = string.find(hay, needle, pos, true)
				if not i then break end
				local line = 1
				for _ in string.gmatch(string.sub(src, 1, i), "\\n") do line += 1 end
				table.insert(out, {path = __path(inst), line = line,
					text = string.sub(src, i, math.min(#src, j + 80))})
				if #out >= {{limit}} then break end
				pos = j + 1
			end
		end
	end
	if #out >= {{limit}} then break end
end
return {needle = {{needle}}, scanned = scanned, count = #out, hits = out}
""",
)

# ══════════════════════════════════════════════════════════════════════════
#  EDIT
# ══════════════════════════════════════════════════════════════════════════

tool(
    "rename_instance",
    "Rename one instance. Use it instead of execute_luau for plain renames.",
    {
        "path": _string("Dot-path to the instance."),
        "name": _string("New name."),
    },
    required=("path", "name"),
    body="""
local inst = __find({{path}})
if {{name}} == "" then error("name cannot be empty") end
inst.Name = {{name}}
return {path = __path(inst), name = inst.Name}
""",
)

tool(
    "clone_instance",
    "Duplicate one instance (with all descendants) into a parent, optionally with a new name. "
    "For repeated copies spaced along an axis, use duplicate_grid instead.",
    {
        "path": _string("Dot-path to the instance to copy."),
        "parent": _string("Dot-path of the destination parent. Defaults to the original parent."),
        "name": _string("Name for the copy. Defaults to Roblox's usual copy name."),
    },
    required=("path",),
    defaults={"parent": "", "name": ""},
    body="""
local src = __find({{path}})
local parent = ({{parent}} ~= "" and __find({{parent}})) or src.Parent
if not parent then error("source has no parent") end
local copy = src:Clone()
if {{name}} ~= "" then copy.Name = {{name}} end
copy.Parent = parent
return {source = __path(src), copy = __path(copy), class = copy.ClassName}
""",
)

tool(
    "delete_instance",
    "Destroy exactly one instance by path, together with its descendants. Refuses services. "
    "Before calling it make sure the path is exactly what the user asked to remove - never a container 'to be safe'.",
    {
        "path": _string("Dot-path to the instance to destroy."),
    },
    required=("path",),
    body="""
local inst = __find({{path}})
if inst == game then
	error("refusing to delete the DataModel - name the instances inside a service instead")
end
if inst.Parent == game then
	error("refusing to delete the service " .. inst.ClassName .. " - name the instances inside it instead")
end
local target = __path(inst)
local descendants = #inst:GetDescendants()
inst:Destroy()
return {deleted = target, descendants = descendants}
""",
)

tool(
    "reparent_instance",
    "Move one instance to a different parent (keeping its name and contents).",
    {
        "path": _string("Dot-path to the instance."),
        "parent": _string("Dot-path of the new parent."),
    },
    required=("path", "parent"),
    body="""
local inst = __find({{path}})
if inst == game then error("refusing to move the DataModel") end
local parent = __find({{parent}})
if inst == parent or inst:IsAncestorOf(parent) then
	error("cannot move an instance into itself or one of its own descendants")
end
local from = __path(inst.Parent)
inst.Parent = parent
return {path = __path(inst), from = from, to = __path(parent)}
""",
)

tool(
    "create_part",
    "Create one primitive part with useful defaults in a single call (shape, size, position, colour, material, anchoring). "
    "Use it for simple props; use generate_mesh / generate_procedural_model for real geometry.",
    {
        "name": _string("Part name."),
        "shape": _string("block | ball | cylinder | wedge | corner.", enum=["block", "ball", "cylinder", "wedge", "corner"]),
        "size": {
            "type": "array",
            "items": {"type": "number"},
            "description": "Size in studs as [x, y, z].",
        },
        "position": {
            "type": "array",
            "items": {"type": "number"},
            "description": "World position as [x, y, z].",
        },
        "color": _string("Hex colour, e.g. '#4a90d9'."),
        "material": _string("Material name, e.g. 'Plastic', 'SmoothPlastic', 'Neon', 'Metal'."),
        "anchored": _bool("Anchor the part (default true)."),
        "transparency": {"type": "number", "description": "0 = solid, 1 = invisible.", "minimum": 0, "maximum": 1},
        "canCollide": _bool("Whether players collide with it (default true)."),
        "parent": _string("Dot-path of the parent. Defaults to Workspace."),
    },
    defaults={
        "name": "",
        "shape": "block",
        "size": [4, 1, 2],
        "position": [],
        "color": "",
        "material": "Plastic",
        "anchored": True,
        "transparency": 0,
        "canCollide": True,
        "parent": "",
    },
    body="""
local shapes = {block = Enum.PartType.Block, ball = Enum.PartType.Ball,
	cylinder = Enum.PartType.Cylinder, wedge = Enum.PartType.Wedge,
	corner = Enum.PartType.CornerWedge}
local part = Instance.new("Part")
part.Name = {{name}} ~= "" and {{name}} or "Part"
part.Anchored = {{anchored}}
part.CanCollide = {{canCollide}}
part.Transparency = {{transparency}}
part.Shape = shapes[{{shape}}] or Enum.PartType.Block
local okmat, mat = pcall(function() return Enum.Material[{{material}}] end)
part.Material = (okmat and mat) or Enum.Material.Plastic
local size = {{size}}
part.Size = Vector3.new(size[1] or 4, size[2] or 1, size[3] or 2)
if {{color}} ~= "" then
	local okcol, col = pcall(function() return Color3.fromHex({{color}}) end)
	if okcol then part.Color = col end
end
local pos = {{position}}
if #pos == 3 then part.Position = Vector3.new(pos[1], pos[2], pos[3]) end
part.Parent = ({{parent}} ~= "" and __find({{parent}})) or workspace
return {path = __path(part), class = part.ClassName, size = __val(part.Size), position = __val(part.Position)}
""",
)

tool(
    "create_folder",
    "Create a new Folder under a parent (defaults to Workspace).",
    {
        "name": _string("Folder name."),
        "parent": _string("Dot-path of the parent. Defaults to Workspace."),
    },
    required=("name",),
    defaults={"parent": ""},
    body="""
local folder = Instance.new("Folder")
folder.Name = {{name}}
folder.Parent = ({{parent}} ~= "" and __find({{parent}})) or workspace
return {path = __path(folder), class = "Folder"}
""",
)

tool(
    "group_instances",
    "Put existing instances (paths, or the current selection) inside a new Model under one parent.",
    {
        "name": _string("Model name."),
        "paths": _arr("Instances to group. Leave empty to group the current Studio selection.", _string("Instance path")),
        "parent": _string("Dot-path of the parent. Defaults to the first instance's parent."),
    },
    defaults={"name": "", "paths": [], "parent": ""},
    body="""
local list = {}
local paths = {{paths}}
if #paths == 0 then
	list = __svc("Selection"):Get()
else
	for _, p in ipairs(paths) do
		local inst = __resolve(p)
		if inst then table.insert(list, inst) end
	end
end
if #list == 0 then error("nothing to group: pass paths or select instances in Studio first") end
local parent = ({{parent}} ~= "" and __find({{parent}})) or list[1].Parent
if not parent then error("the first instance has no parent") end
local model = Instance.new("Model")
model.Name = {{name}} ~= "" and {{name}} or "Model"
model.Parent = parent
for _, inst in ipairs(list) do inst.Parent = model end
return {model = __path(model), grouped = #list}
""",
)

tool(
    "move_instance",
    "Move a part or model to a world position, keeping its rotation.",
    {
        "path": _string("Dot-path to a BasePart or Model."),
        "position": {"type": "array", "items": {"type": "number"}, "description": "Target [x, y, z]."},
    },
    required=("path", "position"),
    body="""
local inst = __find({{path}})
local p = {{position}}
if #p ~= 3 then error("position needs three numbers: [x, y, z]") end
__movepivot(inst, Vector3.new(p[1], p[2], p[3]))
return {path = __path(inst), position = __val(__pivotpos(inst))}
""",
)

tool(
    "resize_instance",
    "Set the size of a BasePart (in studs).",
    {
        "path": _string("Dot-path to a BasePart."),
        "size": {"type": "array", "items": {"type": "number"}, "description": "Target [x, y, z]."},
    },
    required=("path", "size"),
    body="""
local inst = __find({{path}})
if not inst:IsA("BasePart") then error("resize_instance needs a BasePart, got " .. inst.ClassName) end
local s = {{size}}
if #s ~= 3 then error("size needs three numbers: [x, y, z]") end
inst.Size = Vector3.new(s[1], s[2], s[3])
return {path = __path(inst), size = __val(inst.Size)}
""",
)

tool(
    "rotate_instance",
    "Set the orientation of a part, or rotate a model, in degrees.",
    {
        "path": _string("Dot-path to a BasePart or Model."),
        "degrees": {"type": "array", "items": {"type": "number"}, "description": "Rotation [x, y, z] in degrees."},
    },
    required=("path", "degrees"),
    body="""
local inst = __find({{path}})
local d = {{degrees}}
if #d ~= 3 then error("degrees needs three numbers: [x, y, z]") end
local out
if inst:IsA("BasePart") then
	inst.Orientation = Vector3.new(d[1], d[2], d[3])
	out = __val(inst.Orientation)
elseif inst:IsA("PVInstance") then
	inst:PivotTo(inst:GetPivot() * CFrame.Angles(math.rad(d[1]), math.rad(d[2]), math.rad(d[3])))
	local rx, ry, rz = inst:GetPivot():ToOrientation()
	out = {x = math.deg(rx), y = math.deg(ry), z = math.deg(rz)}
else
	error("cannot rotate a " .. inst.ClassName)
end
return {path = __path(inst), orientation = out}
""",
)

tool(
    "snap_to_grid",
    "Snap the position of a part or every part under a model to a stud grid. Useful after procedural or generated placement.",
    {
        "path": _string("Dot-path to a BasePart or Model/Folder."),
        "stud": {"type": "number", "description": "Grid size in studs (default 1)."},
        "recursive": _bool("Walk every descendant (default true for models/folders)."),
    },
    required=("path",),
    defaults={"stud": 1, "recursive": True},
    body="""
local inst = __find({{path}})
local grid = {{stud}}
if grid <= 0 then error("stud must be greater than 0") end
local snapped = 0
local function snap(i)
	if i:IsA("BasePart") then
		local p = i.Position
		local np = Vector3.new(math.round(p.X / grid) * grid, math.round(p.Y / grid) * grid, math.round(p.Z / grid) * grid)
		if (np - p).Magnitude > 0.0001 then
			i.Position = np
			snapped += 1
		end
	end
end
snap(inst)
if {{recursive}} then
	for _, d in ipairs(inst:GetDescendants()) do snap(d) end
end
return {path = __path(inst), grid = grid, snapped = snapped}
""",
)

tool(
    "align_instances",
    "Align two or more parts/models along one world axis, taking the first path as the reference. "
    "Use it to line up rows, shelves, walls or UI props instead of hand-editing positions.",
    {
        "paths": _arr("Paths to align; the FIRST is the reference.", _string("Instance path")),
        "axis": _string("Which axis to match: X, Y or Z.", enum=["X", "Y", "Z"]),
    },
    required=("paths", "axis"),
    body="""
local axis = {{axis}}
local list = {}
for _, p in ipairs({{paths}}) do
	local inst = __resolve(p)
	if inst then table.insert(list, inst) end
end
if #list < 2 then error("need at least two existing paths to align") end
local ref = __pivotpos(list[1])
local target
if axis == "X" then
	target = ref.X
elseif axis == "Y" then
	target = ref.Y
else
	target = ref.Z
end
for i = 2, #list do
	local inst = list[i]
	local p = __pivotpos(inst)
	local np = Vector3.new(p.X, p.Y, p.Z)
	if axis == "X" then
		np = Vector3.new(target, p.Y, p.Z)
	elseif axis == "Y" then
		np = Vector3.new(p.X, target, p.Z)
	else
		np = Vector3.new(p.X, p.Y, target)
	end
	__movepivot(inst, np)
end
return {axis = axis, aligned = #list, reference = __path(list[1])}
""",
)

tool(
    "duplicate_grid",
    "Clone one instance into a row/column/stack of evenly spaced copies along an axis (fences, pillars, tiles, grids).",
    {
        "path": _string("Dot-path to the instance to copy."),
        "count": _int("Total number of copies including the original.", 2, 200, 5),
        "axis": _string("Axis to repeat along: X, Y or Z.", enum=["X", "Y", "Z"]),
        "spacing": {"type": "number", "description": "Distance between copies in studs."},
        "name": _string("Base name for copies (number suffix appended)."),
        "parent": _string("Dot-path of the parent. Defaults to the original parent."),
    },
    required=("path", "count"),
    defaults={"axis": "X", "spacing": 4, "name": "", "parent": ""},
    body="""
local src = __find({{path}})
local parent = ({{parent}} ~= "" and __find({{parent}})) or src.Parent
if not parent then error("source has no parent") end
local axis, spacing = {{axis}}, {{spacing}}
local made = {}
for n = 1, {{count}} - 1 do
	local copy = src:Clone()
	copy.Parent = parent
	local off = Vector3.new(0, 0, 0)
	if axis == "X" then
		off = Vector3.new(spacing * n, 0, 0)
	elseif axis == "Y" then
		off = Vector3.new(0, spacing * n, 0)
	else
		off = Vector3.new(0, 0, spacing * n)
	end
	__movepivot(copy, __pivotpos(copy) + off)
	if {{name}} ~= "" then copy.Name = {{name}} .. "_" .. tostring(n + 1) end
	table.insert(made, __path(copy))
end
return {source = __path(src), created = made, total = #made + 1}
""",
)

tool(
    "set_anchored",
    "Anchor or unanchor a part, or every part under a model/folder. Use before moving built structures so physics doesn't scatter them.",
    {
        "path": _string("Dot-path to a BasePart or a container."),
        "anchored": _bool("true to anchor, false to unanchor."),
        "recursive": _bool("Include every descendant (default true)."),
    },
    required=("path", "anchored"),
    defaults={"recursive": True},
    body="""
local inst = __find({{path}})
local target = {{anchored}}
local changed = 0
local function apply(i)
	if i:IsA("BasePart") and i.Anchored ~= target then
		i.Anchored = target
		changed += 1
	end
end
apply(inst)
if {{recursive}} then
	for _, d in ipairs(inst:GetDescendants()) do apply(d) end
end
return {path = __path(inst), anchored = target, changed = changed}
""",
)

tool(
    "weld_to",
    "Weld one BasePart to another with a WeldConstraint (keeps their current relative offset).",
    {
        "base": _string("Dot-path of the part that stays put."),
        "part": _string("Dot-path of the part to weld to it."),
    },
    required=("base", "part"),
    body="""
local base = __find({{base}})
local part = __find({{part}})
if not base:IsA("BasePart") or not part:IsA("BasePart") then
	error("weld_to needs two BaseParts (Part/MeshPart)")
end
local weld = Instance.new("WeldConstraint")
weld.Name = "FeatherWeld"
weld.Part0 = base
weld.Part1 = part
weld.Parent = base
return {base = __path(base), part = __path(part), weld = __path(weld)}
""",
)

# ══════════════════════════════════════════════════════════════════════════
#  PLAY / RUN
# ══════════════════════════════════════════════════════════════════════════

# Play control is Studio's own start_stop_play, used directly - it already
# exists in the Studio MCP, so a bridge-side start_play/stop_play pair would
# only duplicate it (two names for one action is exactly what makes a model
# pick the wrong one).

tool(
    "run_client_luau",
    "Run Luau in the running game's CLIENT datamodel (play mode only). Use `return` for output; "
    "for edit-time code use execute_luau instead.",
    {
        "code": _string("Luau code to run on the client."),
    },
    required=("code",),
    run=lambda ctx, args: _luau_passthrough(ctx, args.get("code"), "Client"),
)

tool(
    "run_server_luau",
    "Run Luau in the running game's SERVER datamodel (play mode only). Use `return` for output; "
    "for edit-time code use execute_luau instead.",
    {
        "code": _string("Luau code to run on the server."),
    },
    required=("code",),
    run=lambda ctx, args: _luau_passthrough(ctx, args.get("code"), "Server"),
)

# ══════════════════════════════════════════════════════════════════════════
#  CAPTURE
# ══════════════════════════════════════════════════════════════════════════

def _capture(ctx: Ctx, args: dict, tag: str) -> dict:
    mcp_args = {"capture_id": f"FeatherCapture_{tag}_{int(time.time() * 1000)}"}
    for key in ("camera_position", "look_at_position"):
        vec = args.get(key)
        if isinstance(vec, (list, tuple)) and len(vec) >= 3:
            mcp_args[key] = [vec[0], vec[1], vec[2]]
    res = ctx.mcp("screen_capture", mcp_args, timeout=min(ctx.timeout, 60.0))
    images = res.get("images") or []
    text = (res.get("text") or "").strip()
    if not images:
        raise NativeError(_clean_error(text) or "Studio returned no image for the capture")
    return {"text": text or "Studio viewport captured.", "images": images}


def _feather_capture(ctx: Ctx, args: dict) -> dict:
    return _capture(ctx, args, "shot")


tool(
    "feather_capture",
    "Screenshot the Roblox Studio viewport and attach the image to the reply. Use it whenever the user asks how "
    "something looks, after building/changing UI or visuals, or to check a build from a specific camera angle.",
    {
        "label": _string("Short label for your own reference (not shown in the image)."),
        "camera_position": {
            "type": "array",
            "items": {"type": "number"},
            "description": "Optional capture camera [x, y, z]; Studio restores its camera afterwards.",
        },
        "look_at_position": {
            "type": "array",
            "items": {"type": "number"},
            "description": "Optional look-at point [x, y, z] used with camera_position.",
        },
    },
    run=_feather_capture,
)


def _feather_capturevideo(ctx: Ctx, args: dict) -> dict:
    seconds = _num(args.get("seconds"), 4.0, 1.0, 8.0)
    fps = _num(args.get("fps"), 4.0, 1.0, 8.0)
    wanted = max(2, min(16, int(round(seconds * fps))))
    camera = args.get("camera_position")
    look = args.get("look_at_position")
    frames: list[dict] = []
    used = 0
    # The websocket accepts 16MB per message; keep a margin so the clip plus
    # JSON overhead can never push a connection reset onto the user.
    budget = 8 * 1024 * 1024
    started = time.monotonic()
    for i in range(wanted):
        remaining = seconds - (time.monotonic() - started)
        if i > 0 and remaining <= 0.05:
            break
        mcp_args = {"capture_id": f"FeatherVideo_{int(time.time() * 1000)}_{i}"}
        if isinstance(camera, (list, tuple)) and len(camera) >= 3:
            mcp_args["camera_position"] = [camera[0], camera[1], camera[2]]
        if isinstance(look, (list, tuple)) and len(look) >= 3:
            mcp_args["look_at_position"] = [look[0], look[1], look[2]]
        try:
            res = ctx.mcp("screen_capture", mcp_args, timeout=min(ctx.timeout, 60.0))
        except Exception:
            # A dropped frame must not kill the whole clip.
            res = {}
        hit_budget = False
        for img in (res.get("images") or [])[:1]:
            size = len(img.get("data") or "")
            if frames and used + size > budget:
                hit_budget = True
                break
            frames.append(img)
            used += size
        if hit_budget:
            break
        # Pace to the requested fps, but never wait so long that a slow capture
        # pushes the clip far past its length.
        target = (i + 1) / fps
        delay = target - (time.monotonic() - started)
        if delay > 0:
            time.sleep(min(delay, 1.0))
    if not frames:
        raise NativeError("could not capture any frames - is Studio showing a 3D view?")
    elapsed = max(0.1, time.monotonic() - started)
    duration = round(min(float(seconds), elapsed), 2)
    play_fps = max(1.0, min(8.0, round(len(frames) / duration, 1)))
    return {
        "text": f"{duration}s capture - {len(frames)} frames at about {play_fps} fps.",
        "images": frames,
        "meta": {"kind": "video", "fps": play_fps, "duration": duration, "frames": len(frames)},
    }


tool(
    "feather_capturevideo",
    "Record about 4 seconds of Roblox Studio frames and attach them as a short video in the reply. Use it to show "
    "motion - animations, gameplay behaviour, tweens, moving parts - or to check what actually happens during play "
    '(start_stop_play {"is_start": true} first).',
    {
        "seconds": {"type": "number", "description": "Clip length in seconds (1-8, default 4).", "minimum": 1, "maximum": 8},
        "fps": {"type": "number", "description": "Frames per second to capture (1-8, default 4).", "minimum": 1, "maximum": 8},
        "camera_position": {"type": "array", "items": {"type": "number"}, "description": "Optional camera [x, y, z]."},
        "look_at_position": {"type": "array", "items": {"type": "number"}, "description": "Optional look-at point [x, y, z]."},
    },
    run=_feather_capturevideo,
)

# ══════════════════════════════════════════════════════════════════════════
#  SKILLS
# ══════════════════════════════════════════════════════════════════════════
# The user's procedure library lives ON DISK, one folder per skill - the
# desktop app writes it, this tool reads it:
#
#   skills/<folder>/SKILL.md        main instructions (+ name/description front matter)
#   skills/<folder>/references/*    notes, docs, examples - any number
#   skills/<folder>/scripts/*       code snippets the skill refers to - any number
#
# No Studio connection is involved, so this tool stays available in degraded
# mode (see _ALWAYS_AVAILABLE above).

SKILL_FILE = "SKILL.md"
SKILL_PART_LIMIT = 200000     # chars of skill text returned by ONE part
SKILL_SEGMENT_LIMIT = 150000  # a file longer than this is split so it fits a part
SKILL_MAX_BYTES = 2 * 1024 * 1024


def _skills_root() -> Path:
    env = os.environ.get("FEATHER_SKILLS_DIR")
    return Path(env).expanduser() if env else Path(__file__).resolve().parent / "skills"


def _skill_text(path: Path) -> Optional[str]:
    try:
        if path.stat().st_size > SKILL_MAX_BYTES:
            return None
        raw = path.read_bytes()
    except OSError:
        return None
    if b"\x00" in raw[:8192]:
        return None  # binary: image, archive, executable...
    return raw.decode("utf-8", "replace")


def _skill_meta(folder: str, text: str) -> tuple[str, str]:
    name, desc = folder, ""
    head = ""
    if text.startswith("---"):
        end = text.find("\n---", 3)
        head = text[3:end] if end != -1 else ""
    for line in head.splitlines():
        if ":" not in line:
            continue
        key, val = line.split(":", 1)
        key, val = key.strip().lower(), val.strip().strip("\"'")
        if key == "name" and val:
            name = val
        elif key in ("description", "summary") and val:
            desc = val
    if not desc:
        body = text
        if head and text.startswith("---"):
            end = text.find("\n---", 3)
            body = text[end + 4:] if end != -1 else text
        for line in body.splitlines():
            line = line.strip()
            if line and not line.startswith("#"):
                desc = line
                break
    return name, desc


_SKILL_META_CACHE: dict[str, tuple[tuple[int, int], tuple[str, str, str]]] = {}


def _cached_skill_meta(main: Path, folder: str) -> tuple[str, str, str]:
    try:
        stat = main.stat()
        key = str(main.resolve())
        stamp = (stat.st_mtime_ns, stat.st_size)
        cached = _SKILL_META_CACHE.get(key)
        if cached and cached[0] == stamp:
            return cached[1]
        text = _skill_text(main) or ''
        name, description = _skill_meta(folder, text)
        scope = ''
        if text.startswith('---'):
            head = text.split('---', 2)[1]
            for line in head.splitlines():
                field, separator, value = line.partition(':')
                candidate = value.strip().strip('\"\'').lower()
                if separator and field.strip().lower() == 'scope' and candidate in ('pc', 'roblox'):
                    scope = candidate
        meta = (name, description, scope)
        if len(_SKILL_META_CACHE) >= 256:
            _SKILL_META_CACHE.pop(next(iter(_SKILL_META_CACHE)))
        _SKILL_META_CACHE[key] = (stamp, meta)
        return meta
    except OSError:
        return folder, '', ''


def skills_catalog() -> list[dict]:
    """Compact {folder, name, description} list for the system prompt.

    The model decides whether a skill applies BEFORE calling feather_getskills,
    and it cannot guess that from nothing. Shipping just the headers (not the
    bodies) costs a few hundred characters and makes the automatic match work.
    """
    root = _skills_root()
    if not root.is_dir():
        return []
    try:
        folders = sorted((p for p in root.iterdir() if p.is_dir() and not p.name.startswith(".")),
                         key=lambda p: p.name.lower())
    except OSError:
        return []
    out: list[dict] = []
    for folder in folders:
        main = folder / SKILL_FILE
        if not main.is_file():
            continue
        name, desc, scope = _cached_skill_meta(main, folder.name)
        entry = {"folder": folder.name, "name": name, "description": desc}
        if scope:
            entry['scope'] = scope
        out.append(entry)
    return out


def _skill_files(base: Path) -> list[Path]:
    files: list[Path] = []
    main = base / SKILL_FILE
    if main.is_file():
        files.append(main)
    # Skills also use root helpers, templates, agents, examples and map profiles.
    # Exclude private machine settings, caches and generated outputs from context.
    text_types = {".md", ".py", ".lua", ".luau", ".json", ".yaml", ".yml", ".toml", ".txt", ".csv"}
    excluded = {"__pycache__", "node_modules", "logs", "outputs", "releases", "venv", "dist"}
    for path in sorted(base.rglob("*"), key=lambda p: p.as_posix().lower()):
        try:
            rel = path.relative_to(base)
            if (path != main and path.is_file() and path.suffix.lower() in text_types
                    and path.name != "LOCAL.md"
                    and not any(part.startswith(".") or part in excluded for part in rel.parts)
                    and path.resolve().is_relative_to(base.resolve())):
                files.append(path)
        except OSError:
            continue
    return files


def _skill_segments(folder: Path, index: int, total: int, main_only: bool = False, selected_file: str = "") -> list[tuple[str, str, str]]:
    """(kind, folder, text) blocks for one skill, in reading order.

    A whole library can be many times larger than one reply may be, so the
    tool pages through these blocks instead of dropping whatever came after
    the first 200k characters.
    """
    files = _skill_files(folder)
    main = folder / SKILL_FILE
    main_text = _skill_text(main) if main.is_file() else ""
    name, desc = _skill_meta(folder.name, main_text or "")
    listed = ", ".join(p.relative_to(folder).as_posix() for p in files) or f"{SKILL_FILE} (missing)"
    head = [f"════════ SKILL {index}/{total}: {name} ════════", f"folder: {folder.name}"]
    if desc:
        head.append(f"description: {desc}")
    head.append(f"files: {listed}")
    if not main.is_file():
        head.append(f"WARNING: this skill has no {SKILL_FILE}.")
    segs: list[tuple[str, str, str]] = [("skill", folder.name, "\n".join(head))]
    selected = files
    if selected_file:
        if selected_file.startswith(('/', '\\')) or '\\' in selected_file or ':' in selected_file or '..' in Path(selected_file).parts:
            raise NativeError('Use a listed relative skill file path.')
        selected = [path for path in files if path.relative_to(folder).as_posix() == selected_file]
        if not selected or not selected[0].resolve().is_relative_to(folder.resolve()):
            raise NativeError('Skill file not found or outside its folder.')
    elif main_only:
        selected = [path for path in files if path == main]
        segs.append(('skill', folder.name, '\nOnly main instructions loaded. Listed references/scripts remain available via feather_getskills with skill and file parameters.\n'))
    for path in selected:
        rel = path.relative_to(folder).as_posix()
        text = _skill_text(path)
        if text is None:
            segs.append(("file", folder.name,
                         f"\n──── {rel} ────\n[skipped: binary or larger than {SKILL_MAX_BYTES // (1024 * 1024)} MB]"))
            continue
        chunks = _skill_chunks(text, SKILL_SEGMENT_LIMIT)
        for part, chunk in enumerate(chunks, 1):
            label = rel if len(chunks) == 1 else f"{rel} ({part}/{len(chunks)})"
            segs.append(("file", folder.name, f"\n──── {label} ────\n{chunk}"))
    return segs


def _skill_chunks(text: str, limit: int) -> list[str]:
    """Split text into <= limit pieces, preferring line breaks."""
    if len(text) <= limit:
        return [text]
    chunks: list[str] = []
    rest = text
    while len(rest) > limit:
        cut = rest.rfind("\n", 0, limit)
        if cut < limit // 2:
            cut = limit
        chunks.append(rest[:cut])
        rest = rest[cut:].lstrip("\n")
    if rest:
        chunks.append(rest)
    return chunks


def _skill_alias(root: Path, requested: str, known: set[str]) -> tuple[str, dict]:
    if requested in known:
        return requested, {}
    try:
        source = root / '.aliases.json'
        if source.stat().st_size > 32768:
            return requested, {}
        aliases = json.loads(source.read_text('utf-8-sig'))
        value = aliases.get(requested) if isinstance(aliases, dict) else None
        canonical = value.get('folder') if isinstance(value, dict) else value
        files = value.get('files', {}) if isinstance(value, dict) else {}
        if canonical in known and isinstance(canonical, str):
            return canonical, files if isinstance(files, dict) else {}
    except (OSError, ValueError, TypeError):
        pass
    return requested, {}


def _feather_getskills(_ctx: Ctx, args: dict) -> dict:
    root = _skills_root()
    if not root.is_dir():
        return {"text": f"No skills folder exists at {root}. The user can create one from the FeatherScript app > Skills."}
    try:
        folders = [p for p in sorted(root.iterdir(), key=lambda p: p.name.lower())
                   if p.is_dir() and not p.name.startswith(".")]
    except OSError as exc:
        raise NativeError(f"could not read the skills folder: {exc}") from exc

    wanted = str(args.get("skill") or "").strip().lower()
    requested = wanted
    wanted, file_aliases = _skill_alias(root, wanted, {p.name.lower() for p in folders}) if wanted else ('', {})
    if wanted:
        folders = [p for p in folders if p.name.lower() == wanted]
        if not folders:
            names = ", ".join(p.name for p in sorted(root.iterdir(), key=lambda p: p.name.lower()) if p.is_dir())
            raise NativeError(f"no skill folder named '{wanted}'. Installed: {names or '(none)'}")
    if not folders:
        return {"text": f"The skills library at {root} is empty. The user can add skills in the FeatherScript app > Skills."}

    main_only = args.get('main_only', False)
    selected_file = args.get('file', '')
    if isinstance(selected_file, str):
        selected_file = file_aliases.get(selected_file, selected_file)
    if not isinstance(main_only, bool) or not isinstance(selected_file, str):
        raise NativeError('main_only must be a boolean and file must be a relative path string.')
    if selected_file and (not wanted or main_only):
        raise NativeError('Reading one file requires skill and cannot combine with main_only.')
    segments: list[tuple[str, str, str]] = []
    total_chars = 0
    for index, folder in enumerate(folders, 1):
        for seg in _skill_segments(folder, index, len(folders), main_only, selected_file):
            segments.append(seg)
            total_chars += len(seg[2])

    # Deterministic packing (a block never spans two parts), so an unchanged
    # library always answers with the same parts.
    buckets: list[list[tuple[str, str, str]]] = [[]]
    used = 0
    for seg in segments:
        size = len(seg[2]) + 2
        if buckets[-1] and used + size > SKILL_PART_LIMIT:
            buckets.append([])
            used = 0
        buckets[-1].append(seg)
        used += size

    try:
        asked = int(args.get("part") or 1)
    except (TypeError, ValueError):
        asked = 1
    part_count = len(buckets)
    part_no = min(max(1, asked), part_count)
    current = buckets[part_no - 1]

    covered: list[str] = []
    for _, folder_name, _ in current:
        if folder_name not in covered:
            covered.append(folder_name)
    what = f"skill '{folders[0].name}'" if wanted else "skills library"
    lines = [f"FeatherScript {what} - {len(folders)} skill(s), {total_chars:,} characters",
             f"PART {part_no} of {part_count}"]
    if requested and requested != wanted:
        lines.append(f'Legacy skill {requested} was merged into {wanted}; canonical content follows.')
    if asked != part_no:
        lines.append(f"(there is no part {asked}; the library has {part_count} part(s), so this is the last one)")
    lines.append("In this part: " + ", ".join(covered))
    if part_count > 1:
        lines.append("The library is split into numbered parts; read every part before deciding a skill does not apply.")
    next_args = {'part': part_no + 1}
    if wanted:
        next_args['skill'] = folders[0].name
    if main_only:
        next_args['main_only'] = True
    if selected_file:
        next_args['file'] = selected_file
    if part_no < part_count:
        lines.append(f'Next: call feather_getskills with {json.dumps(next_args)} to read the rest.')
    if part_no > 1 and current and current[0][0] == "file":
        lines.append(f"(continued from part {part_no - 1})")

    body = "\n".join(lines) + "\n" + "".join(seg[2] for seg in current)
    if part_no < part_count:
        body += (f"\n\n──── END OF PART {part_no} of {part_count} ────\n"
                 f"{part_count - part_no} part(s) remain - call feather_getskills with "
                 f'{json.dumps(next_args)} for the next one.')
    else:
        body += (f"\n\n──── END OF PART {part_no} of {part_count} - "
                 f"{'the selected file' if selected_file else 'the main instructions (references remain on demand)' if main_only else 'the whole skill' if wanted else 'the whole library'} has been read ────")
    return {"text": body}


tool(
    "feather_getskills",
    "Read the user's local FeatherScript skills - every folder in their skills library, with SKILL.md plus its "
    "references/ and scripts/ files. A skill is a reusable procedure the user wrote or installed (build a shop GUI, "
    "level layout rules, scripting conventions...). Call this BEFORE a task that might match one, and whenever the "
    "user mentions their skills. With no parameters it returns the library in numbered parts (PART 1 of N); each "
    "part ends by naming the call that fetches the next one, so call every part when you need the whole library. "
    'Pass "part" to fetch a specific part, or "skill" (a folder name) to read just one skill. '
    "Use main_only=true for compact main instructions with a resource index, or skill + file for one listed reference/script. Works even while Roblox Studio is closed.",
    {
        "skill": _string('Optional skill folder name (from an earlier feather_getskills result) to read only that one. Omit to read the whole library.'),
        "main_only": _bool('Load main instructions only; list supporting files for on-demand reading.'),
        "file": _string('Read one listed relative file, e.g. references/research.md. Requires skill; cannot combine with main_only.'),
        "part": _int('Which numbered part to return (see "PART x of N" in an earlier result). Defaults to 1.', 1, 999, 1),
    },
    run=_feather_getskills,
)

# ── feather_memory: the project's long-term notes ─────────────────────────
# The memory lives in the place as a script under ServerStorage.FeatherScript,
# because that is the only thing that survives across chats, providers and
# reloads. It used to be maintained with multi_edit, which demands an
# old_string that matches the existing source EXACTLY - one stray space in a
# 3k-character blob and every update errored, so the memory silently stopped
# growing (confirmed live: the place's Memory script held three hand-pended
# "-- UPDATE:" notes and none of the section edits the prompt asks for). This
# tool owns the format instead: everything is stored as Luau comments, so a
# write can never break compilation, and append needs no matching.
_MEMORY_MAX_CHARS = 24000
_MEMORY_UPDATE_MAX_CHARS = 6000

_MEMORY_READ_BODY = """
local folder = __child(game:GetService("ServerStorage"), "FeatherScript")
local mem = folder and __child(folder, "Memory")
if not mem then return {exists = false} end
return {exists = true, class = mem.ClassName, characters = #mem.Source, memory = tostring(mem.Source)}
"""

_MEMORY_UPDATE_BODY = """
local storage = game:GetService("ServerStorage")
local folder = __child(storage, "FeatherScript")
if not folder then
	folder = Instance.new("Folder")
	folder.Name = "FeatherScript"
	folder.Parent = storage
end
local mem = __child(folder, "Memory")
if not mem then
	mem = Instance.new("ModuleScript")
	mem.Name = "Memory"
	mem.Parent = folder
end
local function commented(text)
	local parts = {}
	for line in (tostring(text) .. "\\n"):gmatch("([^\\n]*)\\n") do
		if line:match("^%s*$") then parts[#parts + 1] = "--"
		else parts[#parts + 1] = "-- " .. line end
	end
	return table.concat(parts, "\\n")
end
local heading = {{heading}}
local body = {{content}}
if heading ~= "" then body = "# " .. heading .. "\\n" .. body end
local addition = commented(body) .. "\\n"
local current = tostring(mem.Source)
local source
if {{action}} == "write" then source = addition
elseif current == "" then source = addition
else source = current .. "\\n" .. addition end
if #source > {{limit}} then
	error("project memory would pass " .. {{limit}} .. " characters - read it, then rewrite it with only the durable facts")
end
mem.Source = source
return {path = __path(mem), class = mem.ClassName, characters = #source, added = #addition}
"""


def _memory_text(payload: dict) -> str:
    if not payload.get("exists"):
        return ("(no project memory for this place yet - the first feather_memory append creates "
                "ServerStorage.FeatherScript.Memory)")
    chars = payload.get("characters") or 0
    used = f"[project memory - ServerStorage.FeatherScript.Memory ({chars:,} characters)]\n"
    return used + str(payload.get("memory") or "").strip()


def _feather_memory(ctx: Ctx, args: dict) -> dict:
    action = str(args.get("action") or "read").strip().lower()
    if action not in ("read", "append", "write"):
        raise NativeError('action must be "read", "append" or "write"')
    if action == "read":
        text = ctx.luau(_program(_MEMORY_READ_BODY), "Edit")
        try:
            payload = json.loads(text)
        except (ValueError, TypeError):
            return {"text": text or "(no memory data)"}
        if isinstance(payload, dict) and payload.get("ok"):
            return {"text": _memory_text(payload.get("data") or {})}
        raise NativeError(_clean_error((payload or {}).get("error") if isinstance(payload, dict) else text))
    content = args.get("content")
    if not isinstance(content, str) or not content.strip():
        raise NativeError("content is required for append and write")
    if len(content) > _MEMORY_UPDATE_MAX_CHARS:
        raise NativeError(f"content is too long ({len(content):,} characters) - keep only the durable facts "
                          f"and stay under {_MEMORY_UPDATE_MAX_CHARS:,}")
    heading = args.get("heading")
    heading = "" if heading is None else str(heading).strip()
    if len(heading) > 120:
        raise NativeError("heading must stay under 120 characters")
    result = _luau_run(ctx, _MEMORY_UPDATE_BODY, "Edit",
                       action=action, content=content, heading=heading, limit=_MEMORY_MAX_CHARS)
    return {"text": (result.get("text") or "") + (
        "\n(action=write replaced the whole memory - read it back with feather_memory to confirm.)"
        if action == "write" else "")}


tool(
    "feather_memory",
    "This place's long-term project memory - a shared note every AI and every later session reads before working. "
    "Call it with action=read BEFORE the first request that edits the place or needs to know how the game works "
    "(skip it for chit-chat), and with action=append whenever you learn something DURABLE and VERIFIED: where the "
    "key scripts and instances live, naming and code conventions, how the main systems work, decisions and gotchas, "
    "the user's preferences. Give the new facts in content (plain text, one fact per line) and name the topic with "
    "heading. append never needs the old text to match, and the script (and the FeatherScript folder) is created on "
    "the first write. action=write replaces the entire memory - use it only to collapse a bloated one, and read it "
    "first. Keep it short: not a task log, no whole scripts, no guesses - a wrong fact recorded as fact is re-applied "
    "every later session.",
    {
        "action": {"type": "string", "description": "read (default), append (add one labelled section), or write (replace everything).",
                   "enum": ["read", "append", "write"], "default": "read"},
        "content": _string("The facts to store (append / write). Plain text, one fact per line. Max 6,000 characters."),
        "heading": _string("Short section title for this update, e.g. \"Shop GUI\" or \"Conventions\". Optional."),
    },
    required=("action",),
    run=_feather_memory,
)

# Modular bounded workflows share the existing Luau transport and error envelope.
from roblox_workflows import register as _register_workflows
_register_workflows(tool, _luau_run, NativeError)



# Keep common tools direct; specialist workflows share a compact operation surface.
from tool_groups import GroupedCatalogue as _GroupedCatalogue
from roblox_workflows import DEFINITIONS as _WORKFLOW_DEFINITIONS
_WORKFLOW_NAMES = {item['name'] for item in _WORKFLOW_DEFINITIONS}

def _workflow_group(name):
    for prefix, group in (('rbx_get_', 'rbx_get_inventory'), ('rbx_audit_', 'rbx_audit_scene'),
                          ('rbx_batch_', 'rbx_edit_batch'), ('rbx_create_', 'rbx_create_object'),
                          ('rbx_set_', 'rbx_configure_scene')):
        if name.startswith(prefix):
            return group, name[len(prefix):]
    raise ValueError('Unclassified workflow: ' + name)

_WORKFLOW_GROUPS = _GroupedCatalogue(
    [item for item in _TOOLS if item['name'] in _WORKFLOW_NAMES], _workflow_group, {
        'rbx_get_inventory': 'Read bounded, class-specific Roblox inventories and scene settings.',
        'rbx_audit_scene': 'Read-only bounded scene audits. Findings are review candidates, not proof of bugs.',
        'rbx_edit_batch': 'Edit explicit Roblox instance paths in bounded batches with original validation.',
        'rbx_create_object': 'Create configured Roblox instances, UI, constraints and effects with rollback on failure.',
        'rbx_configure_scene': 'Apply a lighting preset or camera view in Roblox Studio.',
    }, 'rbx_workflow_schema')

def _grouped_workflow(ctx, args, name):
    try:
        if name == _WORKFLOW_GROUPS.help_name:
            return {'text': json.dumps(_WORKFLOW_GROUPS.describe(args)), 'images': []}
        actual, params = _WORKFLOW_GROUPS.resolve(name, args)
    except ValueError as exc:
        raise NativeError(str(exc)) from None
    return _BY_NAME[actual]['run'](ctx, params)

for _definition in _WORKFLOW_GROUPS.definitions:
    def _runner(ctx, args, name=_definition['name']):
        return _grouped_workflow(ctx, args, name)
    tool(_definition['name'], _definition['description'],
         _definition['inputSchema']['properties'], _definition['inputSchema']['required'], run=_runner)
