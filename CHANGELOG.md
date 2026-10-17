# Changelog

## 0.8.3

Changes to untracked keys are matched, added or corrected. A `~ Footing in Bluewatch — …` for a record tracked as *Footing at Bluewatch* (or never added with `+`) used to be dropped with an `unknown-key` warning the model never saw, so it kept writing it.

- **Near keys are matched:** a `~`, `!` or `-` on a key that is not tracked goes to the one active record it plainly means: the same words once case, punctuation, a leading *the/a/an* and small connective words (*in, at, of, on, to, for, from, the, and*) are set aside; or, failing that, one key's words inside the other's (the shorter of two words or more), or a word overlap of three quarters. The Director tab notes it (`"Footing in Bluewatch" read as "Footing at Bluewatch".`). Two such records are never guessed between; the warning names them.
- **A `~` that carries something is added:** with no near record, a `~` with at least one part becomes a new **hook** (a `type:` that names a kind, such as `type: clock`, sets that kind; `type: bounty` makes a bounty quest), noted as `"Key" was not tracked; added as a hook (write "+ kind Key" to set its kind).` A `!` stays strict, and a `-` of something never tracked still does nothing.
- **The model is told:** a `~` or `!` still ignored is corrected in the next note's `Corrections:` line, next to the travel corrections: `"Key" is not tracked: add it with "+ kind Key — …" before changing it.` (or, between two near records, `use its exact key ("A" or "B") or add it …`). Only from the latest reply, at most three, once per key; an older reply's lines are not repeated, and nothing is added when there is nothing to correct (or while capture writes every reply's changes).
- **Director tab:** lines read as a near key or added show under Notes; the `unknown-key` warning remains for lines that were ignored.
- **Capture** keeps a `~`, `-` or `!` whose key plainly means one tracked record instead of dropping it; it still never adds a record from a `~`.
- **API (pure, `src/tracker.js`):** `keyWords(key)`, `nearMatches(records, key)`, `untrackedCorrections(problems, { message, limit })`; `src/changes.js` exports `kindOf(word)`. `unknown-key` findings carry `op` (and `candidates` when ambiguous).

## 0.8.2

Quest difficulty, and the quests a reply finished.

- **A `difficulty` quest field:** `easy`, `normal`, `hard` or `nightmare`; missing or unreadable is `normal`. Obvious other words are read as one of the four (`trivial`/`simple` → easy, `medium`/`moderate` → normal, `difficult`/`tough` → hard, `deadly`/`impossible`/`extreme` → nightmare), and stored that way: `+ bounty Kettle Jack — reward: 40 crowns | difficulty: hard`. A line with only a difficulty is a quest, like the other quest fields.
- **The change instruction** names the field (one word; about 140 tokens now); **the capture prompt** names it with its four values. A planned offer of work (a HOOK) may carry one too and keeps it. **The note** shows a difficulty that is not normal next to the type: `Kettle Jack (bounty, hard) — …`.
- **Quests tab:** every quest shows its difficulty in its head (`normal` when none was written; hard and nightmare stand out). The Director tab shows a `difficulty` row on a record that has one.
- **API:** `globalThis.StoryDirector.questsDoneAt(index)` lists the quests the assistant reply at `index` finished, a `-` line in that reply closing them (not as failed, abandoned, expired or superseded), as `[{ id, name, type, difficulty, reward, giver }]` plain copies; quests finished earlier are not listed, and it is `[]` when there are none. Also in the Story Suite's api. `apiVersion` stays 1. RPG Battle uses it to offer XP for a finished quest.
- **Token estimate for Story Suite:** `api.manage.tokens()` gives what Story Director adds to the next ordinary reply, `{ input, output, parts: [{ label, input, output }] }`, at about 4 characters a token and without a model call: `input` is the note as it would be injected now, per section (Header, Arc, Due now, Arriving, Off-screen, World, Hooks, Quests, Clocks, Beats, Do not reveal, Corrections, Pacing, Encounter cue, Change instruction, NPC plans only); `output` is a rough allowance of 60 tokens for the `<Director>` lines it asks for (0 when capture writes them on *always*). Planner and capture calls are quiet calls and not counted. All zeros while the note is not sent; it never throws. The note itself is unchanged.
- **One look for the four settings panels:** the settings panel uses the Story Suite's shared markup and `src/suite.css` (identical in Story Block, Story Director, NPC State Delta and RPG Battle; linked once per page as `#story-suite-css`), after NPC State Delta's panel: a quick bar with the switches as Enabled/Disabled pills and the main actions, folding sections (Tracking & note, Calendar, Map & travel, Arc planning, Capture, Existing chat & compatibility) with a one-line summary of what each is set to, all closed at first and remembered when opened; numbers show their units. Story Director's own copies of these styles are gone. Setting ids are unchanged. [docs/STORY_SUITE.md](docs/STORY_SUITE.md) is the suite's shared copy.

## 0.8.1

Story Suite overlay support ([docs/STORY_SUITE.md](docs/STORY_SUITE.md#one-place-to-manage-them-all)).

- **Managed from Story Suite:** Story Block's overlay can show Story Director's settings panel as a tab (the announcement names it: `settings: '#story_director_settings'`) and set its Source of truth choices and tracking switch from its Overview, through `api.manage` (`areas`, `sources()`, `setSource(area, choice)`, `enabled()`, `setEnabled(on)`). Each goes the same way as the panel's own control: saved, shown in the panel, announced again and refreshed.
- **Switched off, still listed:** turning tracking off now announces Story Director with `enabled: false` (offering nothing) instead of withdrawing it, so the overlay can switch it back on. Who owns an area is unchanged: a switched-off extension owns nothing. Without Story Block it is still withdrawn.
- **A *Manage all in Story Suite* line** on top of the settings while the overlay is available (two or more story extensions, and a Story Block that offers it); marked `data-story-suite-link` so the overlay can hide it while it holds the panel. Alone, nothing changes.
- `globalThis.StoryDirector` is unchanged; `manage` is only in what the Story Suite gets.

## 0.8.0

Encounters: planned fights as part of the arc, and the Story Suite handshake.

- **An `encounter` field** for the foes of a planned fight, free text in RPG Battle's shape (`3 bandit, bandit captain (boss)`, `2 x dire wolf rank D`), stored as written: `+ beat Ambush at the weir — on: Haywane 14 | place: Weir road | encounter: 3 bandit, bandit captain (boss)`. Usually on a beat; a quest (a bounty's target) or a clock (one that fires as an attack) may carry one too. A `+` line with only foes and a date is a beat.
- **The note** ends a due or arriving fight's item with `(fight: …)`, shows planned ones compactly in the kind lines (`· fight: …`), and, only while a fight is due, adds one sentence to the Pacing line: the foes appear and the reply stops at the first blow, since the fight is resolved outside the story. The change instruction and the capture prompt name the field.
- **The arc planner** may plan one or two fights per arc, as `BEAT: … | encounter: …` (an `ENCOUNTER:` line becomes one too), only where the story would really come to blows. The default prompt stays under 600 words.
- **Director tab:** an `encounter` row and a `fight` tag on records that carry one.
- **API:** `globalThis.StoryDirector.encountersAt(index)` lists the fights due (or arriving) at a message, then those within the due-soon window, as `{ key, id, kind, encounter, place, on, status: 'due' | 'soon' }`. `apiVersion` stays 1. RPG Battle uses it to offer a **Fight?** notice with the foes filled in; the model closes the record with `!` or `-` when it narrates the outcome.
- **Story Suite** ([docs/STORY_SUITE.md](docs/STORY_SUITE.md)): Story Block, Story Director, NPC State Delta and RPG Battle find each other through a small shared registry (`src/suite.js`, identical in all four) and agree who is the source of truth for each area. While it tracks the story, Story Director announces itself for the calendar, the timeline and NPCs, sharing `globalThis.StoryDirector`; turning tracking off withdraws it. Alone, nothing changes.
- **NPCs are NPC State Delta's** when it is installed: it keeps who each NPC is, so one short line in the note, the planner's request and the capture call asks for agenda lines that give only what an NPC plans and when.
- **Source of truth settings** (Existing chat & compatibility): Automatic, This extension or The other one for the calendar, the timeline and NPCs. *The other one* stops Story Director offering that area; for the timeline it also stops the Off-Screen mirror while another extension keeps it.
- **API:** `StoryDirector.calendar()` gives the reader's calendar as `{ era, months: [{ name, days }] }` (plain copies; Gregorian until one is set). NPC State Delta uses it instead of its own calendar. `apiVersion` stays 1.
- **Wording:** the Off-Screen mirror is described for what it is (it keeps a World State Off-Screen list in step, for readers who keep one), not as something NPC State Delta reads.

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
