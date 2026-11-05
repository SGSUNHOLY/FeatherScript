---
name: roblox-localization
description: "Use when adding multi-language support, translation tables, or per-player locale text to a Roblox game."
---

Every player-visible string goes through one translation path. Do not hard-code English in a screen.

## Verified API (Roblox docs, checked for this skill)
- `LocalizationService:GetTranslatorForPlayerAsync(player)` returns an Instance (the translator for that player's locale). `GetTranslatorForPlayer` is deprecated: do not use it.
- Other members (`GetTranslatorForLocaleAsync`, `GetCountryRegionForPlayerAsync`, `GetTableEntries`) are listed on the docs page; their signatures are UNVERIFIED here.
- `TextLabel.RichText`, `TextScaled`, `TextWrapped` (properties).

## Rules
1. Keep every string in a translation table keyed by a stable name (for example `SHOP_BUY`), never by the English text.
2. Look up the translator once per player on join, and use it for that player's UI.
3. Keep text in a box that can grow: plan for longer languages (German, Russian) by testing the widest string on each screen.
4. Use `TextScaled` with a size limit, and check `TextWrapped` on every label that can hold a long sentence.
5. Never concatenate translated fragments to build a sentence. Put the whole sentence in one entry with placeholders.
6. Check the Check-UI rules for text contrast and readable size after translation, since longer text changes layout.

## Checks
- Test the widest string on each screen in a run. Screenshot each screen with that string.
- Confirm no English string is left in a screen (search the UI code for literal text).

## Not checked by this skill
- Translation quality. Native speakers must review.
- Fonts with the right characters for each language. Check the font covers each script.
