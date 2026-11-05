---
name: ul-sfx-finder
description: Find and audition Roblox sound assets, then emit a compact sound bank for the requested game events.
---

# ul-sfx-finder

## Workflow

Inspect existing sound usage and the requested timing, range and concurrency. Use the example spec and supplied find/pick/probe tools. Search a bounded candidate set and confirm actual playback and target experience permission; metadata alone does not prove an asset is usable. Emit only chosen entries. Verify contact timing, attenuation, overlap and cleanup in Studio. Treat old search benchmarks as examples rather than current service guarantees.

## Implementation

Read [the detailed workflow](references/implementation.md) for the specific command, spec format or authoring examples you need. Request supporting files individually with `feather_getskills` (`skill` and `file`); do not load the entire library. Existing scripts and references remain the implementation source of truth.

For scripts that require machine paths, read existing `LOCAL.md` locally or adapt `LOCAL.template.md` from verified paths. FeatherScript native tools do not require completing unrelated setup.
