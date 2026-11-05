---
name: roblox-monetization
description: "Use when adding Game Passes, Developer Products, or purchase prompts, and handling purchase receipts on the server."
---

A purchase must be granted exactly once, on the server, even if the server restarts mid-purchase. Clients never grant items.

## Verified API (Roblox docs, checked for this skill)
- `MarketplaceService:PromptGamePassPurchase(player, gamePassId)`.
- `MarketplaceService:PromptProductPurchase(player, productId, equipIfPurchased, currencyType)`.
- `MarketplaceService.ProcessReceipt(receiptInfo)` returns `Enum.ProductPurchaseDecision`.
- The receipt's fields (for example a purchase ID) and the decision values (for example the "granted" value) are UNVERIFIED here: read the ProcessReceipt docs page before you write code that uses them.

## Rules
1. Only the server grants a purchase. The client prompt is a request; ProcessReceipt or the server's game-pass check is the decision.
2. ProcessReceipt must be idempotent: record each purchase ID in the player's data before you grant, so a repeated receipt grants nothing twice.
3. Grant, then save, then return the "granted" decision only after the save succeeds. If the save fails, do not return it.
4. Game Pass ownership is checked on the server when the player joins or buys, and cached per session; do not trust a client's claim of ownership.
5. Never press a purchase button in a live place during a test. Test in a test place only, with the user's approval (see the Studio safety rules).
6. Put every product and pass ID in a Config module; never invent an ID.

## Checks
- Test each product with a test purchase in a test place, and confirm the grant happens once.
- Replay a receipt and confirm nothing is granted twice.

## Not checked by this skill
- The exact receipt and decision names (read the docs page).
- Real-money purchases. Never test with a live place or real money without approval.
