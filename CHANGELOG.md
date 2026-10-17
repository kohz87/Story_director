# Changelog

## 0.8.0

Encounters: planned fights as part of the arc.

- **An `encounter` field** for the foes of a planned fight, free text in RPG Battle's shape (`3 bandit, bandit captain (boss)`, `2 x dire wolf rank D`), stored as written: `+ beat Ambush at the weir — on: Haywane 14 | place: Weir road | encounter: 3 bandit, bandit captain (boss)`. Usually on a beat; a quest (a bounty's target) or a clock (one that fires as an attack) may carry one too. A `+` line with only foes and a date is a beat.
- **The note** ends a due or arriving fight's item with `(fight: …)`, shows planned ones compactly in the kind lines (`· fight: …`), and, only while a fight is due, adds one sentence to the Pacing line: the foes appear and the reply stops at the first blow, since the fight is resolved outside the story. The change instruction and the capture prompt name the field.
- **The arc planner** may plan one or two fights per arc, as `BEAT: … | encounter: …` (an `ENCOUNTER:` line becomes one too), only where the story would really come to blows. The default prompt stays under 600 words.
- **Director tab:** an `encounter` row and a `fight` tag on records that carry one.
- **API:** `globalThis.StoryDirector.encountersAt(index)` lists the fights due (or arriving) at a message, then those within the due-soon window, as `{ key, id, kind, encounter, place, on, status: 'due' | 'soon' }`. `apiVersion` stays 1. RPG Battle uses it to offer a **Fight?** notice with the foes filled in; the model closes the record with `!` or `-` when it narrates the outcome.

## 0.7.2

- **A read-only API for other extensions:** `globalThis.StoryDirector.timeAt(index)` (the story time known at a message, in minutes on your calendar) and `formatTime(abs)`. RPG Battle uses it for recovery as story time passes.

## 0.7.1

- **A Quests tab of its own** in Story Block's sidebar, next to Director, appearing with the first quest. Quests are grouped by type (Main, Side, Bounties, Contracts, Missions, Favours, then any other type), each with its goal, step, giver, reward, deadline and place; a deadline that is close or has passed is marked, and finished quests fold away with how they ended. The badge counts open quests. Always shown in full: quests are not spoilers. The Director tab no longer lists them.
- **Quest types.** A `type` field (`main`, `side`, `bounty`, `contract`…, or any word); writing the category as the kind (`+ bounty Wolf pelts — …`) sets it. The note shows it: `Wolf pelts (bounty) — …`.

## 0.7.0

Quests.

- **A `quest` kind** for long-running work your character took on: `+ quest Key — giver: … | goal: … | reward: … | step: … | due: …`. Aliases `bounty`, `contract`, `mission`; a line with a giver, goal, reward or step is a quest even without the word.
- **Never dormant**, woken by its giver's name; `due` is the deadline, and the note says "deadline … reached" when it passes. Quests get their own line in the note (`Quests: Bounty — goal · at: step · for giver · reward · by deadline`), and a deadline counts as a schedule for the Pacing line.
- **Director tab:** a Quests section with goal, step, giver, reward and deadline rows, also shown while the tab is hidden (quests are not spoilers).
- **Only on acceptance:** the change instruction and the capture prompt say a quest starts when {{user}} accepts it; an offer is a hook. The arc planner presses on quests but never completes them, and a planned `QUEST:` becomes an offered hook.
- **Seeding** reads `Quests`, `Bounties` or `Contracts` sections of the scene block.

## 0.6.0

Places, without writing a map.

- **Place book.** Every reply's World State location is read as the story goes: each place, the spots inside it, how many visits and when. The Director tab's new **Places** section lists them (shown even while the tab is hidden; you were there).
- **Map from coordinates.** When the location carries coordinates (`Auvoth | Terrace | [59.0, 110.0]`), the places go on a small map, north up, with the distance and direction from where the scene is ("136 km NW"). Places within about 100 km count as nearby for the note.
- **Map settings** (Settings → *Map & travel*, was *World pack & travel*): which way north and east run (a chart, or an image whose y grows downwards), km per coordinate unit, and a road factor. Importing a world pack with `scale_km_per_unit` sets the scale.
- **`/route` and the route tool without a world pack**: a trip estimated from the coordinates (straight line × road factor, half-day round-up, rest days, default paces). With a pack that knows both places, its roads are used as before.

## 0.5.4

- **You can see planning run.** Planning an arc (button or automatic) shows a notice that stays up until it finishes, naming the connection profile when one is used. A failed or unusable plan now says why in a red notice instead of only inside the Director tab. Pressing Plan again while it runs says it is already planning.
- **Beats do not force the scene.** When anything is scheduled, the note adds a short Pacing line: bring a due item in only where it fits (on-screen if {{user}} is there, otherwise later as news, signs or aftermath), never cut into or bend the current scene for a beat, never decide what {{user}} does; what cannot fit happens off-screen or slips. The planner prompt adds the same idea: beats are when the world acts, not appointments, and each must work without {{user}} present.

## 0.5.3

- **Settled records fold away.** In the Director tab, records marked `settled: yes` (World State Alpha's imported facts, or any the model marks) go into a closed **Settled · N** fold at the end of their section, so live events, hooks and agendas read first. The redundant "settled: yes" row is dropped.
- **Folds stay open.** Dormant, Resolved recently, Settled and the like no longer snap shut whenever the tab redraws (after every reply or pin). *Do not reveal* still closes again.

## 0.5.2

- **Behind the scenes, hidden by default.** The Director tab no longer shows agendas, planned beats, the arc, clocks, secrets or problem details until you press **Reveal** (like Story Block's secrets: hidden text is not in the page at all). Locked, it shows the time and place, counts (due, tracked, problems), the arc buttons (with **Accept without reading** for a waiting plan, or **Review** to look), Seed and the route tool. **Hide** locks it again; a reveal lasts for that chat until you hide it or reload. Problem pop-ups only give a count while hidden. Switch: **Hide behind the scenes** in the settings' quick bar (on by default).
## 0.5.1

- **Settings sorted like NPC State Delta's:** the version in the header; a quick bar with the on/off switch, **Plan arc** and **Seed from World State**; then folding groups with a one-line hint each: Tracking & note (with the dormant shelf), Calendar, World pack & travel, Arc planning, Capture, and Existing chat & compatibility. Only Tracking starts open, and the groups you keep open are remembered in this browser.
## 0.5.0

Capture, and coming from World State Alpha.

- **Capture:** a second call, on the chat's model or a connection profile, writes a reply's change lines. *When a reply has no `<Director>` block* fills in only when the model skipped it; *Always* stops asking the model for change lines and captures every reply. It reads only that exchange with the tracker for context, records only what the exchange established (no plans or guesses; claims in dialogue stay claims), drops changes to untracked keys and never starts an arc. The lines are written into the reply, so swipes and edits behave as with the model's own.
- **Import from World State Alpha** (Settings → Existing chat): an exported bundle's active facts and developments become World records, with their trend or "settled", keyed by their summary's first words, anchors as the names to watch for; previewed before it applies, written into the latest reply.
- The note carries no change-line instructions when capture writes them.
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
