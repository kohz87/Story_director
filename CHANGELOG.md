# Changelog

## 0.4.0

Arc planning: one model call per arc, tracked every reply.

- **Plan arc** (Director tab) asks a planner for the next arc, on the chat's own model or any **connection profile** you pick in settings. It reads the recent chat (60 messages by default), the tracker, the time and place, nearby places, your genre and tone, your Director's note and the previous arc.
- **The plan becomes tracked records:** an arc, dated beats, NPC agendas, hooks, clocks and secrets, tagged with the arc. Relative dates ("in 2 days", "tomorrow at dusk", "next morning") are turned into dates in your calendar. Plans with no arc or no items are refused; past dates and actions for your character are flagged.
- **Review first:** the plan waits in the tab as editable change lines (Accept, Discard, Plan again); accepting writes it into the latest reply, so deleting that reply undoes it. *Use plans without review* skips this.
- **Triggers:** manual, or automatic when there is no arc, when every beat has played out, or when no beat is due within the stall window (7 story days by default). **End arc** closes the current arc.
- **Steering in the note:** an `Arc:` line under the header, the current arc's beats first, its secrets under "Do not reveal". One arc is active at a time; a new arc closes the old one.
- Settings: when to plan, model, messages to read, answer length, stall window, review, genre and tone, Director's note, and the planning prompt (editable, with reset).
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
