# UI visual polish

Start from the existing interface and the player's next action. Keep its style unless a redesign was requested. Inspect one important screen at its normal gameplay size before tuning details.

## Compose the screen

- Give the main action and primary value a clear hierarchy. Reduce competing bright borders, tiny labels and equal-weight buttons.
- Use a small spacing and typography scale. Align shared edges and baselines; avoid unrelated padding values on neighboring components.
- Distinguish surfaces through a restrained combination of fill, border and depth. Gradients and shadows should clarify grouping rather than decorate every child.
- Use icons with consistent visual weight and alignment. Pair unfamiliar icons with labels. Never display an unexplained decorative symbol as an actionable control.
- Keep dense information scannable. Add meaningful empty/loading/error states instead of presenting blank boxes or hardcoded success values.

## Make behavior match appearance

Use one state owner per screen. A disabled button must refuse activation, an opened panel must receive usable focus, and closing it must restore the previous interaction. Prevent duplicate submissions and stale responses from an earlier selection. Preserve entered text when a recoverable request fails.

Animate meaningful transitions with short, interruptible motion. Cancel or replace an existing tween instead of stacking animations on each click. Respect reduced motion, avoid per-frame reconstruction of unchanged UI, and keep visual feedback distinct from server-confirmed success.

## Review the actual result

Check a narrow phone and the normal desktop layout, long labels, empty and populated lists, the largest practical count, input focus, and one failed request. At each size inspect clipping, text readability, touch space and safe areas. Include controller selection if the game targets it.

Capture the before/after state from the same viewport. Verify the real handlers and data bindings; an attractive static screen with dead controls is incomplete. Keep feedback to a few observed issues and fixes rather than a generic design checklist.
