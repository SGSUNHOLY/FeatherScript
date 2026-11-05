---
name: gui-verify
description: "any screen before it is called done."
---

Verify by numbers first. In play, the verifier in references/gui-verify/ checks that elements
are on screen, siblings keep 8 px gaps and do not overlap, text fits its box, and elements marked
Centred sit in the middle of their parent. Place gui_rules.lua as a ModuleScript and
verify_gui.client.lua as a LocalScript beside it. Run it in Play with a character alive. Mark
deliberate overlaps Overhang = true.
When it cannot run, check the same things in the code's numbers and say so in the report.
Check every button path, every state (default, hovered, pressed, disabled, empty), the phone and PC
sizes, and that closed screens leave no connections behind.
Say what was checked by numbers, what by reading, and what needs a person in play.

## Rule tests

`references/gui-verify/test_gui_rules.lua` runs `gui_rules.lua` against known cases. Run it with `lua test_gui_rules.lua` from its folder. It prints a `FAIL:` line for each failed case and a pass count.
