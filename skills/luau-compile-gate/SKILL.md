---
name: luau-compile-gate
description: "Use after every Luau write or edit, to catch a syntax error at write time instead of in a playtest. Compiles the source without running it, inside Studio."
---

A typo in a script should fail at the write, not three calls later in a playtest. This gate compiles the source without running it.

## How it works
`loadstring` compiles a chunk and returns it without calling it, so nothing in the script runs. The compile error comes back with its line number. `scripts/compile_check.lua` wraps that in one function.

## Steps
1. After each write or edit, read the file back (script_read).
2. Run `scripts/compile_check.lua` through execute_luau in Edit mode, passing the source text.
3. If it returns a compile error, fix the line the error names and repeat step 1. Do not move on with a failing compile.
4. Record the result in the Check Suite table: PASS (compiled), FAIL (error with line), or UNVERIFIED (loadstring unavailable in this Studio).

## What a compile check does not prove
- It does not check types, unknown members, or runtime behaviour. Selene (roblox-tooling) and the Check-Code scanner cover lint; a playtest covers behaviour.
- A partial edit can leave a script mid-change on purpose. Judge the compile on the final state of the file, not each intermediate step.
- If `loadstring` is unavailable (the function reports "not available"), mark the compile UNVERIFIED. Never mark it PASS.

## Rules
- Never compile by requiring a ModuleScript. Requiring runs the code.
- Report the compile result with the file name, not just "syntax ok".
