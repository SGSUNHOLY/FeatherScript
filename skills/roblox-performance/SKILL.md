---
name: roblox-performance
description: Diagnose Roblox frame time, memory, replication and physics bottlenecks using measured evidence.
---

# roblox-performance

## Workflow

Reproduce the slowdown and record a baseline for the affected client or server. Use the profiler appropriate to the suspected cost; inspect memory growth across repeat actions. Change the largest measured contributor first. Avoid replacing readable code with speculative micro-optimizations or pooling everything. Repeat the same workload on the target device/quality setting and report the before/after result. Use Parallel Luau only where its constraints and workload justify it.

## Implementation

Read [the detailed workflow](references/implementation.md) for the specific command, spec format or authoring examples you need. Request supporting files individually with `feather_getskills` (`skill` and `file`); do not load the entire library. Existing scripts and references remain the implementation source of truth.
