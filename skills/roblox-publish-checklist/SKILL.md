---
name: roblox-publish-checklist
description: "Use before publishing or updating a Roblox experience: a release gate for the parts that changed, with evidence for each item."
---

A release is a set of claims. Each claim needs evidence from a run, a capture or a file, not a memory of having checked it.

## Gate (run only the items that the change touches)
1. **Test place, not live.** Confirm the place you tested is the one you will publish, and that no purchase or DataStore write was made during tests.
2. **Clean state.** Remove test instances, test scripts, print statements left for debugging, and `Place1` placeholders.
3. **Remotes.** Every remote validates its arguments on the server and is rate limited. Use `remote-events` and `review-for-exploits`.
4. **Players join and leave.** Run a join, a leave and a rejoin. Check the character spawns (note the `CharacterAutoLoads` and `RespawnTime` settings that were used, from the Players docs).
5. **Data.** Save and load a player's data across a leave and rejoin. Use `datastore-safety`.
6. **Screens.** Every changed screen passes the Check-UI table, with a capture at phone and PC size.
7. **Code.** Every changed file passes Check-Code and the compile gate (`luau-compile-gate`).
8. **Services.** Check that `HttpEnabled` is set only where the project needs it. HTTP calls go through `HttpService:RequestAsync`.
9. **Replication.** Anything secret lives in `ServerStorage`, which does not replicate to clients. `ReplicatedStorage` replicates to every client, so put nothing secret there.
10. **Monetization.** Each product and pass ID is in the Config module and checked against the store. Use `roblox-monetization`.
11. **Analytics.** Each new event is in the event list. Use `roblox-analytics`.
12. **Report.** Write the release note with what changed and what was not tested.

## Output
A table with each item: PASS (with evidence), FAIL, NOT APPLICABLE, or UNVERIFIED (what the user must check). A release with any FAIL is not released.

## Not checked by this skill
- Platform policy and age ratings. Read the current platform rules.
- Live performance at real player counts. Monitor after publishing.
