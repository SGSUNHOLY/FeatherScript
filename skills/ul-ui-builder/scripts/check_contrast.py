#!/usr/bin/env python3
"""check_contrast.py - WCAG 2.x contrast gate for a UI theme.

Usage:
  python check_contrast.py theme.json [--min 4.5] [--large-min 3.0]

Checks the text colours a theme declares against the surfaces they sit on:
  - ink, inkSoft text on the light panels (panel, panelAlt, slot, cream)
  - onDark text on the saturated buttons (green, red, blue, purple, grey, gold, dark)
Exit code 1 if any intended pair is below the minimum.

Why: WCAG success criterion 1.4.3 (Contrast Minimum) asks for 4.5:1 for normal
text and 3:1 for large text (24px, or 18.66px bold). This gate uses 4.5:1 for every
pair, because Roblox UI text is often smaller on a phone than in the reference size.
The gate measures FLAT fills. A gradient, a dark UIStroke (textStroke) or a pattern
layer is not counted, so a pair that fails here may still pass in the game; a pair
that passes here is only a floor.

Source: https://w3.org/WAI/WCAG20/Understanding/contrast-minimum (WCAG 2.0 wording of 1.4.3;
        the 4.5:1 and 3:1 thresholds are the same in WCAG 2.2)
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

TEXT_ON_LIGHT = ["ink", "inkSoft"]
LIGHT_SURFACES = ["panel", "panelAlt", "slot", "cream"]
TEXT_ON_BUTTON = ["onDark"]
BUTTON_SURFACES = ["green", "red", "blue", "purple", "grey", "gold", "dark"]


def hex_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    if len(h) != 6:
        raise ValueError(f"expected #RRGGBB, got {h!r}")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def luminance(rgb: tuple[int, int, int]) -> float:
    def lin(c: int) -> float:
        c = c / 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (lin(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def ratio(a: str, b: str) -> float:
    la, lb = sorted((luminance(hex_rgb(a)), luminance(hex_rgb(b))), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("theme")
    ap.add_argument("--min", type=float, default=4.5)
    args = ap.parse_args()

    palette = json.loads(Path(args.theme).read_text())["palette"]
    pairs = [(t, s) for t in TEXT_ON_LIGHT for s in LIGHT_SURFACES] + \
            [(t, s) for t in TEXT_ON_BUTTON for s in BUTTON_SURFACES]

    failed = 0
    for text, surface in pairs:
        if text not in palette or surface not in palette:
            print(f"SKIP {text} on {surface}: not in palette")
            continue
        r = ratio(palette[text], palette[surface])
        ok = r >= args.min
        failed += 0 if ok else 1
        print(f"{'PASS' if ok else 'FAIL'} {text:8} on {surface:9} {r:5.2f}:1  (min {args.min})")
    print(f"{len(pairs)} pairs, {failed} below {args.min}:1")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
