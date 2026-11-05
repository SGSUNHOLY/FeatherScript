---
name: luau-accuracy
description: Check Roblox API signatures, Luau semantics and fallible calls while writing or reviewing code.
---

# Luau accuracy

- Inspect adjacent project code and verify unfamiliar, changing or uncertain APIs against official documentation. Record only the signatures that matter to the change; do not fetch a manual for every established call.
- Check method versus function calls, argument order, execution side, permissions and return types. `GetService` with an invalid service raises an error; `FindFirstChild` may return nil. A protected DataStore call can fail independently of its stored value.
- Luau supports compound assignment, optional type annotations and backtick string interpolation. Do not impose Lua 5.1 restrictions on Luau code.
- Check array versus dictionary operations, sparse tables, numeric bounds and nil before indexing. Prefer explicit ordering where output order matters.
- Lint changed code for unused/shadowed locals, accidental globals, format mismatches and missing returns. Use task scheduling deliberately and disconnect owned event connections.
- A type check or compile gate does not establish API availability or runtime behavior. Report unavailable verification clearly; do not invent a plausible replacement API.

Read `references/absorbed-lint-review.md` for a deeper lint review or `references/absorbed-api-hot-list.md` when investigating an uncertain API. Their lists are reference prompts, not a requirement to load every page.
