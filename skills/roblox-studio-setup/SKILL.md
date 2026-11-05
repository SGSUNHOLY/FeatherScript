---
name: roblox-studio-setup
description: Establish the current Roblox Studio place, available controls, project conventions, and safe test target before making changes. Use when beginning work in an unfamiliar place or when the assistant's Studio access is unclear.
---

# Set up a Roblox Studio task

## Goal

Understand the place that is actually open, determine what Studio operations are available, and choose a safe first step. This skill does not install software or alter a place by itself.

## Procedure

1. Ask for or read the requested player-facing outcome, relevant platform, and scope. Read `context/PROJECT_CONTEXT.template.md` if the user has filled it in.
2. Identify the open place and current edit/test state. If available, inspect Explorer, selected instances, Properties, open scripts, and Output. Do not assume the open place is the intended target when multiple places are visible.
3. Determine which operations the current environment can perform: inspect instances, edit properties, edit script source, invoke Studio UI, playtest, read logs, and capture the viewport. Treat each as a separate capability; do not assume full access because one operation works.
4. Note the place's naming, folder layout, script types, visual style, existing remotes, and relevant systems. Search for an existing implementation before adding a duplicate.
5. Confirm whether the current place is a throwaway test copy or a production place before actions that could overwrite persistent data, upload assets, change permissions, or publish.
6. Present a compact task brief internally: target, relevant paths, planned change, test mode, and limitations. Then hand off to the most relevant skill or make the smallest scoped change.

## If Studio is not connected

Still make progress from files or screenshots the user provided. Label observations as unconfirmed when the live DataModel is unavailable. Supply the exact Explorer location, instance type, property values, Luau source, and a manual Studio verification sequence. Do not claim that a draft is present in Studio.

## Safety and source of truth

- The current Studio DataModel is authoritative for the open place. Existing source files or notes may be stale; compare before editing.
- Avoid broad deletion, replacing whole services, or renaming established objects unless required by the request.
- Never run an opaque generated script. Explain what any Command Bar operation will change, scope it to a named target, and prefer ordinary instance edits for small changes.
- Keep API services disabled for production data testing. Use an isolated test experience when persistence behavior needs validation.
- Publishing, changing asset permissions, or affecting live player data requires explicit user intent.

## Completion note

Report the place inspected, relevant paths, edit status, test performed, and anything the user must still do. Distinguish inspected, drafted, applied, and tested work.

Read [the reference index](references/roblox-reference-index.md) when Studio controls or engine behavior need verification.
