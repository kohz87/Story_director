# AI-README: Story Director 2.9.3

For AI assistants that read this repository. Plain facts, no marketing. For people, read [README.md](README.md). For rules every
change must keep, read [CLAUDE.md](CLAUDE.md). Depth lives in `docs/`; this file points there instead of copying.

## Purpose

Story Director is a module of Story Suite v2 (module id `story-director`), a SillyTavern extension (JavaScript ES modules, no
dependencies, no build step). It keeps the story clock and calendar, threads (quests, hooks, agendas, events, clocks, beats,
secrets), the map and trips, the Chronicle of world events, the World screen, Key people, the pack's living cast, arc planning and
standalone checks. Code sets every number; the story only proposes them in change lines.

## Suite map

| Repo | Module id | Version | Owns |
|---|---|---|---|
| kohz87/Story_block | `story-block` | 2.16.6 | The host: store, replay, command bus, `<Changes>` capture, prompt assembly, module registry, settings window, Game view, packs and portraits, save points. Core domains `scene` and `inventory`. |
| kohz87/Story_director (this) | `story-director` | 2.9.3 | Clock and calendar, threads and quests, map and trips, Chronicle, World and Journal, Key people, the living cast, arc planning, checks. Needs Story Block >= 2.12.0. |
| kohz87/npc_state_delta | `npc-state-delta` | 1.7.1 | NPC dossiers, meters, stages, secrets, cast portraits. Needs Story Block; with Story Director it also follows the cast and Key people. |
| kohz87/Story_studio | (not an extension) | 0.6.0 | An offline single HTML page that writes and checks packs. No install. |

Data flows one way: Studio writes a pack file; Story Block validates and stores it; Story Director reads what Story Block holds
(`packs.content`, `packs.calendar`, `packs.weather`, `scene.*`, `mounts.pace`) and NPC State Delta reads both. Nothing flows
back to Studio. Story Director never calls another module by name: it asks a query with a fallback, so it runs without NPC State
Delta (`tests/v2/integration/alone.test.js` guards that). NPC State Delta reads Story Director through `director.keyPeople`,
`director.cast`, `director.world.here`, `director.time` and `director.threads`, and runs the reader command `keypeople.pin`.

## Install & requirements

- SillyTavern: Extensions → Install extension → `https://github.com/kohz87/Story_director`, after Story Block. Reload. Update Story
  Block before the modules.
- `manifest.json`: `loading_order` 30, `js: index.js`, `dependencies: ["third-party/Story_block"]`, no `requires`.
- `index.js` waits up to ten seconds for `globalThis.StoryBlock` (`apiVersion` 2, `ready`), then calls `sdk.registerModule`
  with `src/v2/module.js`. With no v2 host it shows one notice line in the extensions drawer and does nothing else.
- Module `requires.storyBlock` is `>=2.12.0` (`STORY_BLOCK_RANGE`). Used later: `scene.you` (rank, wearing, condition) 2.10.0;
  the header's Travel line 2.11.0; `after:` line order 2.11.1; a pack's cast (`packs.content({ kind: 'cast' })`) 2.15.0; the
  hero Edit's clock fields (`director.clock`) 2.16.0. An older host leaves that one thing out.
- Node 24 in CI, 22 or later works locally. `npm test`, `npm run check`, `git diff --check` (see "File map").
- A pack may ask for the capability `chronicle-lasting` (this module declares it) in its `requires.capabilities`.

## Concepts

- **Thread**: one record in `director.threads`, id `th_xxxxxxxx`, with a `kind` (`agenda`, `event`, `hook`, `quest`, `clock`,
  `beat`, `secret`), a key (its name), a summary, `fields`, a status (`active`, `resolved`) and `track` (when created, changed,
  seen). Written by change lines or reader commands; never by hand.
- **Quest / hook / offer**: a job only offered is a `hook`. `+ quest` is the acceptance. An older chat's offer or RPG quest data is
  read-only history.
- **Behind the scenes**: agendas, beats, clocks, secrets. The narrator is told them; the reader's screens hide them until
  **Reveal** (per chat, in the browser). Secrets are told by name only ("Do not reveal").
- **Clock**: `director.time.minutes`, story minutes from the calendar's epoch. Moves only by `~ time <date>`, `! time +2h`,
  `director.clock` (reader) or `director.advance` (another module's rule).
- **Calendar**: the reader's (`gregorian` or `custom`), else the enabled pack's (`packs.calendar`), else Gregorian. Setting
  `tracker.calendar.preset` is `pack` by default.
- **Note / tail**: the Director's text for one reply (`[Story Director · date · place]` and its lines). **Static**: the fixed
  text with the change-line grammar, byte-identical every reply for one module set and feature set.
- **Feature (F100)**: an optional mechanic with an id (`story-director.*`), a default and a switch. Off means fully off: no grammar
  line, prompt text, screen, command or query answer; stored state stays. A Lean preset turns some off.
- **Scene filter**: the note names only threads that fit the scene (place, region, people present, due within `dueSoonDays`); the
  rest become one `Elsewhere` line of at most `tracker.elsewhere` names.
- **Initiative**: before a reply, code picks at most one person present or nearby with an open thread to take the first step.
- **Atlas / place / route / landmark**: the map's data. Places and routes of enabled packs are read live and joined by name;
  a pack place the story has not reached is known but undiscovered.
- **Trip**: a planned journey along known routes: legs with dates, a position worked out from the clock (never stored).
- **World event / faction**: the Chronicle's entries (`state` looming, ongoing or resolved). **Lasting change**: a pack event's
  `chronicle.lasting` step.
- **Day digest / Journal**: what each story day held, written from receipts when a day ends.
- **Key person**: a person the reader pins (**+ Pin**); the story may send them **away** with a return date.
- **Cast**: the people a pack lists. **Met** or **unmet**. Unmet cast is never named to the reader or the narrator.
- **Arc**: a planned run of beats, agendas, hooks, clocks and secrets, made by a planner model and accepted by the reader.
- **Check**: a `? check` line; one d20 rolled by code, once.
- **Problem**: a refused or odd line with a plain sentence; listed on the Director screen and the reply's card.
- **Replay == live**: swipes, middle deletes, rewinds and reloads rebuild the same state; per-reply bookkeeping is keyed by the
  carrier's `sid` and add-only (see CLAUDE.md).

## Reader features

Where each lives in the UI. Screens are in Story Block's Game view (Alt+G, or the **Game view** button above the message box)
and the Story panel (**Story** button). Settings open from the **Suite** button; this module's under **Modules → Story Director**.

- **Quests** (`story-director/quests`, `screens/quests.js`): quests and goals with status; older quest history stays readable.
- **Director** (`story-director/director`, `screens/director.js`): arc panel, Quests, Hooks, World events, **Behind the scenes**
  (widget `story-director.behind`, Reveal), and Problems. Under **More** unless the reader puts it in the bar.
- **World** (`story-director/world`, `world/screen.js`; feature `story-director.world`): **Now** (People here, Around here, Key
  people, Upcoming, News and events, Factions) and **Journal** (each story day, searchable). Shows only what {{user}} knows.
  `story-director/days` is kept as a Journal-only dialog.
- **Map** (`story-director/map`, widget `story-director.map`): pan, zoom, **Find a place**, **Region** list, fit and locate, place
  details with the trip from here, the trip's road, a **You** marker, movers and the **On the road** panel.
- **Chronicle** (`story-director/chronicle`; feature `story-director.threads`): world events and factions, each with an Edit form,
  Resolved, Reopen and Remove.
- **Status card** (`story-director/status-card`, mount `card`, on by default): the Story Director part of Story Block's "This reply"
  card: notes (paths crossed, cast moved, pack updated, key person back or gone), then **Where things stand**: Time, Weather, Place,
  Coordinates, Travel, rank (the pack's word), Wearing, Condition, Goal. A row with no value is left out.
- **Clock edit**: Story Block's hero **Edit** sends `director.clock { year, month, day, minutes }`; refused with one sentence if the
  day is not on the calendar. Shows on the card as "Clock set to ...".
- **Key people** (widget `story-director.key-people`, World → Now): rows with Unpin, **+ Pin** chooser (who is here, who the threads name,
  the cast met, who NPC State Delta tracks), token note.
- **People here** (widget `story-director.people`): NPC State Delta's cards when present (`NPCStateDeltaCast.render`), else chips.
- **Arc panel** (widget `story-director.arc`, Director screen): **Plan arc** (**Plan next arc** while one runs), review text, Accept (or Accept without reading while behind the scenes is hidden), Discard, Plan again, End arc.
  Waiting plans are kept per chat in browser storage.
- **Plan by itself** (`arc.trigger: auto`): runs after a reply when there is no arc, one played out, it stalled, or threads run low.

## Settings

Module settings are namespaced `<part>.<key>` and read through `sdk.settings('story-director')`. Per SillyTavern user, not per chat.
Feature switches are Story Block's (**Features**). Presets: Lean turns off `initiative`, `threads`, `trip` and `arc`; all else stays.

| Name | Does | Default |
|---|---|---|
| `tracker.calendar.preset` | `pack`, `gregorian` or `custom` | `pack` |
| `tracker.calendar.era`, `.months`, `.leapYears`, `.week` | The custom calendar; used only when preset is `custom` | none |
| `tracker.dormantReplies` | Replies of silence before a thread is quiet (1 to 500) | 15 |
| `tracker.dormantDays` | Story days before it is quiet (1 to 3650) | 30 |
| `tracker.dueSoonDays` | What counts as due soon, in days (0 to 365) | 3 |
| `tracker.maxJump` | Most story days one reply may move the clock (1 to 3650) | 30 |
| `tracker.elsewhere` | Threads elsewhere named in the note (0 to 10) | 2 |
| `tracker.initiativeCooldown` | Replies before the same person takes initiative again (2 to 20); feature `initiative` | 2 |
| `time.recapHours` | Story hours of jump that bring a While away recap (1 to 720) | 6 |
| `time.lapses` | Deadlines slip or lapse as time passes | on |
| `atlas.map.north`, `.east` | `up`/`down`, `right`/`left` | `up`, `right` |
| `atlas.map.kmPerUnit`, `.roadFactor` | Km per map unit; how much roads wind | `1`, `1.25` |
| `atlas.map.era` | `pre-modern` or `modern` travel | `pre-modern` |
| `chronicle.digestDays`, `.digestKeep` | Whole days kept; days kept in all; feature `digest` | 14, 120 |
| `chronicle.digestTail` | Remind the story of the last day after a time skip | on |
| `world.upcomingDays` | World's Upcoming looks this far ahead (1 to 365) | 30 |
| `keypeople.cap` | How many key people (0 to 100) | 10 |
| `keypeople.tokens` | Narrator budget for key people, no upper limit | 300 |
| `cast.on` | The pack's cast lives off-screen | on |
| `cast.faces` | New faces at most: `day1`, `day2`, `week1` | `day1` |
| `cast.unmetDie` | Unmet cast can die off-screen | off |
| `cast.profile` | Connection that plans the cast's moves; empty is the chat's | empty |
| `arc.profile`, `arc.trigger` | Planner connection; `manual` or `auto` | empty, `manual` |
| `arc.autoAccept`, `arc.genre`, `arc.note`, `arc.keepNote` | Accept without review; genre; the director's note; keep it | off, empty, empty, off |
| `arc.recent`, `arc.maxTokens` | Messages the planner reads (4 to 200); longest plan (300 to 8000) | 40, 1500 |
| `arc.stallDays`, `arc.lowThreads` | Stalled after days without a beat; running low below N open threads (0 never) | 7, 3 |
| `checks.defaultDc` | Difficulty when none is written (1 to 40) | 15 |
| `checks.costMargin` | A miss by this much is a success at a cost (0 to 5) | 2 |
| `checks.social` | Add NPC State Delta's social modifier | on |
| `screens.hideBehind` | Hide agendas, beats, clocks and secrets until Reveal | on |

## Data the model sees

Story Director gives Story Block a **static** part and a **tail**. Story Block assembles and budgets them.

Static (identical each reply while the module and feature set stay the same):
- Director rules: `~` changes only what changed, `-` closes (`— reason`), `!` fires a due item; the field list; "write only changes";
  never write actions for {{user}}. The `encounter` field is named only when another module runs fights.
- One grammar line per kind, each under its feature: `agenda event hook quest clock beat secret time route landmark trip world
  faction check`, and `away`, `key` only while someone is pinned.
- Paragraphs under their feature: Pacing and the World lines (`threads`), Initiative (`initiative`), Key people (`key-people`),
  Checks (always).

Tail (rebuilt each reply, cut to budget; fixed budgets in tokens):

| Piece | When | Budget |
|---|---|---|
| `[Story Director · date · place]` note: While away, Due now, Arriving, Off-screen, World, Hooks, Quests, Clocks, Beats, Do not reveal (secret names only), Corrections, Quest check, Slipped, Lapsed, Distances | scene-filtered; at most 40 threads | 500 |
| `Initiative: X may approach {{user}} ...` and `Elsewhere, not in this scene: A · B` | feature `initiative`; names of PC-known threads only | in the note's |
| `[While away] ...` recap | after a jump of `time.recapHours` | 200 |
| Known routes from the scene's place with travel times | when the place has routes | 80 |
| `On the road: ...` and a reached-a-place cue | a trip is on (`trip`) | 90 |
| `[World] Under way off-screen:` up to three open events | feature `threads` | 120 |
| `[Key people] Away from the scene:` one line per away person | someone is away | `keypeople.tokens` |
| `[Cast] Name comes into the scene in this reply ...` | only the reply of a meeting | 220 |
| `Arc: Name — what it is about` | an arc runs | 60 |
| `[Last day] ...` | after a time skip, `chronicle.digestTail` | 60 |
| A check's outcome | the reply after a roll (through Story Block's `[Happened]`) | with receipts |

The module budget is the sum (1631 with the defaults). Story Block's overall tail budget (`tailBudget`, default 1500) and context
share cap everything. **What is shown in the Game view is worked out on read and not sent**: World, Journal, Status card, Map.

Never sent: unmet cast (not even a name); the reader's Reveal choice; anything a feature that is off owns. The note does tell the
narrator agendas, beats and clocks (Reveal hides them only from the reader's screens). The World screen and the Initiative and
Elsewhere lines use only what {{user}} knows. Two separate model calls carry more: the **cast planner**
(describes unmet people to move them; never output to the reader) and the **arc planner** (the last `arc.recent` messages,
up to 24000 characters, plus a thread summary). Both go through `sdk.callModel` on the chosen connection.

## Reply format the model writes

Inside Story Block's `<Changes>` block, one line each: `op kind Name — text | label: value`, `op` is `+` new, `~` change, `-` close
(`— reason`), `!` fires. Fields the model is told: `now then on due leg arrive shown encounter`; a quest adds
`type giver goal reward step due difficulty`; a beat adds `reach`. Dates go in `on`, `due`, `arrive`, with a clock time. Examples:

```
~ time June 3, 1200, 08:00 am
! time +3h
+ quest Granary Vermin — plague rats eat the convoy grain | goal: clear the river-gate storehouse | giver: the quartermaster | due: June 8, 1200, 06:00 pm
- hook Granary Rats — abandoned
~ trip Wolfmere Outpost | by: riding | via: Hollin's Reach
+ away Ren — scouting the north road | back: June 9, 1200
! away Ren — reached Wolfmere Outpost
- key Mara | died
+ world Red Plague — coughing in the docks | state: ongoing | place: Harbour | factions: Guild
? check Stealth — sneak past the guard | dc: hard
```

Rules: `dc` is `trivial easy normal hard very hard impossible` or 1 to 40; a model's own `result:` is never read. A trip is refused
when no known route joins the places; `~ trip stop` ends it; `~ trip delay: 1 day | because: lame horse` moves later arrivals.
`+ route A — B | hours: 2` and `+ landmark Name | region: where | kind: town` add map data. `~ weather` and `~ place` are Story
Block's, read here. A reply adds at most 16 threads. A line that cannot be used becomes a Problem, never an error to the reader.

## Pack format pointers

Read through Story Block queries; never copied into state (the cast entry is read live). Format: Story Block `docs/v2/PACKS.md`.

- `packs.calendar`: `era`, `months [{ name, days }]`, `start { year, month, day, hour, minute }` (seeds the clock once, if the story
  has none), `holidays [{ name, month, day }]` (World's Upcoming).
- `packs.weather`: `seasons` (months of each) and `tables` by season and region; else a built-in temperate table.
- `packs.content({ kind: 'places' })`: `name`, `id`, `region`, `kind`, `layer` or `plane`, `x`, `y`, `aliases`, `hidden`/`secret`.
  `kind: 'routes'`: `from`, `to`, `kind`, `km`, `hours`.
- `packs.content({ kind: 'cast' })`: `id`, `name`, `aliases`, `about`, `look`, `voice`, `personality`, `start { place, goal,
  routine }`, `drawnTo []`, `canDieUnmet`, and for others (secrets, meters, portrait) only passed on. A pack event's `then` step may
  call `chronicle.lasting`; `chronicle.passed` answers "N days after".
- Limits: a place or person name 80 characters; cast people kept 64; up to 6 aliases.

## Commands and queries

For module authors. Names are Story Block sdk names. Reader commands use cause `ui`; `system` is a step run by a hook.

Commands:

| Name | Does |
|---|---|
| `director.clock` | Reader sets the date and time (cause `ui`) |
| `director.seed`, `time.settle`, `director.initiative` | System steps: start the clock from a pack's start; close what time ran past; pick an initiative |
| `director.advance { minutes, cause?, reason? }` | Another module's rule moves the clock on 1 to 1440 minutes, once per cause per reply |
| `threads.offer`, `threads.accept`, `threads.intent` | Write a thread offer; accept it with the reader's proof; capture the reader's typed acceptance |
| `atlas.visit`, `atlas.edit`, `atlas.focus` | The story is at a place; reader's corrections; mark the picked place |
| `atlas.region`, `atlas.placeRegion`, `atlas.dangerSet`, `atlas.placeBind` | Region and danger policy, bind a place to a pack place (each takes `write` and `expectedHash`) |
| `chronicle.edit`, `chronicle.remove` | The reader edits or removes a world event or faction (cause `ui`) |
| `chronicle.surface`, `chronicle.note`, `chronicle.digest`, `chronicle.threadOutcome` | System steps: pick the open events for the next tail; keep the day's facts; write a finished day; record a thread's outcome |
| `chronicle.lasting` | A pack event writes a lasting world change (system, `event:<id>` caller only) |
| `keypeople.pin`, `keypeople.unpin`, `keypeople.sync`, `keypeople.tell` | Pin or unpin (reader); take people off when NPC State Delta archives them; tell the card |
| `cast.sync`, `cast.advance`, `cast.meet` | System steps: join the pack's people; move them on; the first meeting |
| `director.arc.accept`, `.update`, `.end` | The reader accepts, updates or ends an arc |
| `checks.actor`, `checks.roll` | Reader's check settings; one d20 roll from a `? check` line (not callable by buttons) |

Queries:

| Name | Answers |
|---|---|
| `director.time`, `director.calendar`, `time.now`, `time.overdue`, `time.recap` | Clock (`minutes`, `text`, `parts`), calendar, overdue and recap |
| `director.threads { kind?, status?, offer? }`, `director.thread { key \| id }`, `threads.hash { thread }` | Threads, one thread, its hash for writers |
| `director.goal`, `director.next`, `director.problems`, `director.status`, `quest.board`, `director.behind`, `director.threads.on` | View data the screens bind to |
| `atlas.places`, `atlas.routes`, `atlas.map`, `atlas.view`, `atlas.place`, `atlas.here`, `atlas.selected`, `atlas.travel` | Map data and travel times |
| `atlas.trip` | The trip and movers (`row`, `legs`, `you`, `arrive`); null while off |
| `atlas.canonical`, `atlas.candidates`, `atlas.policy`, `world.areaTier` | Stable place identity, region and danger policy |
| `chronicle.events`, `.event`, `.factions`, `.faction`, `.board`, `.passed { name, minutes }`, `.questLog` | World events, factions, "N days after" |
| `chronicle.days`, `.day`, `.dayBoard`, `.dayFacts`, `.noteFacts`, `journal.day` | The day digest and journal (digest feature) |
| `director.world`, `director.world.here`, `director.journal` | World screen data; who is here (NPC State Delta asks this) |
| `director.keyPeople` | `[{ name, aliases?, here, away, removed? }]`; null while off (read-only, others ask through a try) |
| `director.keyPeople.view`, `director.keyPeople.on` | The World section's own |
| `director.cast`, `director.cast.counts`, `director.cast.view` | Met people only; `{ met, total, unmet }`; the Around here view |
| `director.arc` | The current arc and beats played |
| `checks.policy`, `director.contract` | Check actors and hash; the capabilities offered (`api: 2`) |

## Storage

- State lives with the chat: Story Block keeps each reply's record in `message.extra.storySuite`; Story Director's domains are
  `director`, `atlas`, `chronicle`, `keypeople`, `cast`, `arc` and `checks`. Reader edits are `ui` commands stored on the latest
  reply, so a swipe or delete of it takes them back.
- `director`: `time`, `threads`, `keys`, `problems` (newest 100 kept, 50 shown), `turn`, `checked`, `recap`, `initiative`.
  `atlas`: `places`, `routes`, `regions`, `danger`, `trips` (per-reply records). `chronicle`: `events`, `factions`, `days`,
  `dayFacts`. `keypeople`: `pins`, `away`, `gone`, `notes`. `cast`: `people`, `notes`, `day`, `meeting`.
- Derived on read, never stored: World, Journal, Where things stand, a trip's position, dormant threads.
- Browser only (`localStorage`): `story-director.reveal` (per chat, what was revealed) and `story-director.arc` (a waiting plan).
- Settings: Story Block's `extension_settings.storySuite`, module `story-director`.
- A feature that is off keeps what it stored; turning it on shows it again.

## File map

| Path | Purpose |
|---|---|
| `index.js` | SillyTavern entry: waits for Story Block, registers the module, hands `turn` to the arc planner |
| `index.v1.js`, `src/*.js` | v1 glue (not loaded) and v1's pure rules that v2 reuses (`tracker.js`, `calendar.js`, `note.js`, `relevance.js`, ...) |
| `src/v2/module.js` | Merges the parts into one module definition; settings namespaced `<part>.<key>` |
| `src/v2/tracker/` | `director` domain, change-line kinds, the clock, calendar settings, the note, initiative, scene filter |
| `src/v2/time/` | Settle (lapses, overdue), advance, While away recap, weather by rule |
| `src/v2/atlas/` | Places, routes, map widget, travel, trips (`trip*.js`), policy |
| `src/v2/chronicle/` | World events, factions, day digest and Journal data, pack lasting changes |
| `src/v2/world/` | World screen (Now, Journal), PC-known views, people widget; nothing stored |
| `src/v2/keypeople/`, `src/v2/cast/` | Key people (domain, widget, NPC State Delta sync); the living cast (steps, planner, entries) |
| `src/v2/arc/` | Arc planning: planner call, review, Accept, Reveal |
| `src/v2/checks/` | Check line, `checks.roll`, actors, dice |
| `src/v2/screens/` | Director, Quests, Reveal, Behind, Status card, view queries |
| `src/v2/threads.js` | The `story-director.threads` feature's owned kinds |
| `src/suite.js`, `src/ui/` | v1 UI code, kept for its pure rules |
| `tests/` | `*.test.js` v1 rules; `tests/v2/<part>/`, `tests/v2/integration/`, `tests/v2/break/` (fuzz and one file per finding); `tests/vendor/story-block/` the vendored Story Block testkit |
| `docs/` | `ARCHITECTURE.md` (v1 pure-module contract, older), `DESIGN.md`, `dev/` area notes (`trips.md`, `key-people.md`, `cast.md`, `world.md`, `chronicle.md`, `tracker-and-time.md`, `checks-and-danger.md`), `images/` (the README's pictures) |
| `CHANGELOG.md`, `CLAUDE.md`, `NOTICE.md`, `LICENSE` | History; rules for coding agents; notices; MIT licence |

Commands: `npm test` (what CI runs), `npm run test:dot`, `npm run check` (syntax of `index.js` and `src/`), `git diff --check`. The suite
runs against the vendored testkit, not Story Block's head; never edit vendored files. Some tests also use Story Block and NPC State
Delta checked out beside this repo.

## Limits & known follow-ups

- A reply moves the clock at most `tracker.maxJump` days; a reply adds at most 16 threads; at most 300 open threads.
- Key people: `keypeople.cap` (default 10, max 100); the narrator budget is `keypeople.tokens`. A pinned person leaves the list when
  they die or NPC State Delta archives them.
- Cast: 64 people from packs in a chat; one meeting a reply; paced by `cast.faces`; never during a fight, never someone in the scene.
- Trips: 64 legs, 8 delays. Chronicle: 60 events (30 resolved kept), 40 factions. Arcs: the newest 20 kept.
- No screen edits check actors; actors saved by an older chat keep their bonuses. Without one a check rolls for the player at +0.
- RPG Battle is not supported: its packs are refused and its chats stay on older versions.
- Arc planning needs `sdk.callModel`; without it the panel says what is missing.
- Follow-ups: `docs/ARCHITECTURE.md` still describes the v1 pure modules and predates v2; `index.v1.js` and `src/suite.js`, `src/ui/`
  stay only for their pure rules.

## Version

Story Director 2.9.3 (`manifest.json`, `package.json`, `src/v2/module.js` `VERSION`). Built and tested with Story Block 2.16.1 and
NPC State Delta 1.7.1. History: [CHANGELOG.md](CHANGELOG.md).
