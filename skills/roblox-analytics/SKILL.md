---
name: roblox-analytics
description: "Use when tracking player behaviour, progression or economy events with AnalyticsService: naming events, sending values, and staying within limits."
---

Analytics answers a question you wrote down first. Log only events that answer one.

## Verified API (Roblox docs, checked for this skill)
- `AnalyticsService:LogCustomEvent(player, eventName, value, customFields)`.
- Other methods on the page: `LogEconomyEvent`, `LogFunnelStepEvent`, `LogJourneyEvent`, `LogProgressionEvent`, `LogProgressionStartEvent`, `LogProgressionCompleteEvent`, `LogProgressionFailEvent`, `LogOnboardingFunnelStepEvent`, `FireCustomEvent`, `FireEvent`, `GetPlayerSegmentsAsync`. Use the specific one whose docs fit; read each docs page for its signature.

## Rules
1. Write an event list first: name, the question it answers, and the fields it sends. Keep it in the project docs.
2. Event names are fixed strings from the list. Never build an event name from player data.
3. Send only the fields the question needs. Do not send personal data.
4. Send from the server when the event is about a decision (purchase, level complete). Client-only events are easy to fake, so do not use them for rewards.
5. Keep sends out of per-frame code. Log on an event, not every tick.
6. Check the platform's rate limits on the analytics docs page before you add a high-frequency event.

## Checks
- Trigger each event once in a run and confirm the send happens (print the event name and fields).
- Confirm no event fires every frame.

## Not checked by this skill
- The dashboards where the data lands. The user must check them.
- Limits for the project's traffic. Read the live limits page.
