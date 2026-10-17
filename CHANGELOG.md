# Changelog

## 0.3.0

Travel, with your map.

- **World packs:** import your map as JSON (places, roads with km and road codes, paces per road and mode, courier multiplier, travel rules, and optionally a calendar, which you are offered). Settings → World pack; the summary shows what is loaded. Edge endpoints missing from the places list are reported as notes, not errors.
- **Travel maths in code:** shortest road by km for the mode (wagons off trails, mountains, tunnels and hidden paths; riders at foot pace where the pack says so; water by boat unless a levee road), **each road rounded up to the next half day**, a rest day after every 6 days on land (none for couriers or crewed boats), courier pace = ride × multiplier.
- **Legs checked** whenever a reply writes or changes one: one road at a time, from where the party really is (the end of its last leg), the road's km, a mode the road allows, and an arrival that matches the pace from when the leg was set. Each problem carries the corrected leg, which goes into the next note under Corrections, and shows in the Director tab.
- **`/route FROM to TO [mode] [rate=N]`** and a **Route** tool in the Director tab: roads, km, pace, days and the arrival from the scene's current time.
- **Relevance:** with a map, places one road away from the scene count as nearby.
## 0.1.0

First release: the tracker.

- **Tracker** of agendas, events, hooks, clocks, beats and secrets, written by the model as short `<Director>` change lines (`+` new, `~` changed, `-` resolved, `!` fired) that Story Block carries hidden in each reply. Anything the model leaves out stays unchanged.
- **Replay:** the tracker for any point in the chat is rebuilt from the change lines up to that reply, so swipes, edits, deletes and branches are always right. Cached per message.
- **Calendar:** Gregorian, or your own months, days and era; dates without a year take the nearest year.
- **The note,** before every reply: what is due and arriving, then the most relevant records (due, the scene's place, names in the scene, recent changes) within a token budget (1000 by default), secrets only as "do not reveal", and the change-line instructions.
- **Dormant shelf:** records unseen for 15 replies or 30 story days (both adjustable) leave the note until their name, place or date comes up again. Pinned records never go dormant.
- **Checks** on every reply: unknown keys, duplicates, due items left unfired or missed, dates written outside on/due/arrive, overlong parts, a missing `<Director>` block while something was due.
- **Director tab** in Story Block's sidebar, **settings**, **Seed from World State** (turns an existing World State's Off-Screen, World, Hooks and Clocks lines into records), and an **Off-Screen mirror** for NPC State Delta (on by default).
