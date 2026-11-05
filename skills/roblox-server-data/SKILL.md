---
name: roblox-server-data
description: "Use for server-side data beyond player saves: ordered leaderboards with OrderedDataStore, cross-server messages with MessagingService, and short-lived shared state with MemoryStoreService."
---

Server data is shared across servers and can lag or fail. Design every read and write so it survives a failed call.

## Verified API (Roblox docs, checked for this skill)
- `DataStoreService:GetDataStore(name, scope, options)`, `GetOrderedDataStore(name, scope)`, `ListDataStoresAsync`, `SetRateLimitForRequestType`, `GetRequestBudgetForRequestType`.
- `OrderedDataStore:GetSortedAsync(ascending, pagesize, minValue, maxValue)` returns `DataStorePages`.
- `MessagingService:PublishAsync(topic, message)` and `MessagingService:SubscribeAsync(topic, callback)` (returns a connection). The docs page gives no message size or rate limit; check the DataStore and MessagingService limits pages before you design around one.
- `MemoryStoreService`: `GetHashMap`, `GetQueue`, `GetSortedMap`. Methods of `MemoryStoreSortedMap` are not on that page; UNVERIFIED here.

## Rules
1. Every DataStore or MessagingService call is wrapped in pcall, with retries that back off. A failed call is a normal event.
2. Ordered leaderboards: fetch one page at a time (`pagesize`), not the whole board. Cache the page for a few minutes.
3. Messages are hints. A subscriber must handle a missed or repeated message, so make every action idempotent (safe to repeat).
4. Never store player saves in a leaderboard store. Use `datastore-safety` for player data.
5. Store names, scopes and topics are project constants in a Config module. Never invent them in code.
6. Do not publish a message in a tight loop. Batch updates and send at a fixed interval.

## Checks
- Test the failure path: make a call fail on purpose (wrong key, offline) and check the code retries and then reports.
- Confirm a repeated message does not grant anything twice.

## Not checked by this skill
- The live rate limits of the project's experience. Read the limits page and the project's budget numbers.
- Behaviour across real servers. Test with two servers if the feature depends on it.
