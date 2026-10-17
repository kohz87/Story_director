# Story Director v0.6.0

A SillyTavern extension that keeps a story's world moving consistently. It **tracks**
off-screen agendas, world events, hooks and clocks, works out in code what is **due**, and
injects a short **note** before every reply with what is due, arriving and relevant to the
scene. The model writes only what changed; nothing it forgets to copy is ever lost.

Works on top of [Story Block](https://github.com/kohz87/Story_block) (0.6 or newer). It keeps
a **place book** of everywhere the story goes, on a map when the scene's location carries
coordinates, with distances, directions and trip estimates. With a
**world pack** (your map as JSON, optional) it also checks travel: every leg against the real roads,
distances and paces, with corrections in the next note and a `/route` planner. And once per
story arc it **plans** the next arc with a model you choose, the way Megumin Suite's Story
Director does, but the plan becomes dated, tracked beats instead of a block of prose.

## Why

Models are good at judgment and prose, and bad at arithmetic, lookups, comparing two lists and
remembering things that were last mentioned forty replies ago. A World State block that the
model rewrites in full every reply drops lines, duplicates them, renames them, misses due dates
and lets quiet threads fade. Story Director keeps that memory in code instead:

- **The model writes changes, not lists.** Each reply ends with a short hidden `<Director>`
  block: `+` new, `~` changed, `-` resolved, `!` a due item fired. Anything it leaves out
  stays as it was.
- **Code decides what the model sees.** Before every reply, only what is due, arriving or
  relevant to the scene goes into the note, within a token budget.
- **Quiet threads go on a shelf, not away.** Records unseen for a while are left out of the
  note and come back on their own when their name, place or date comes up.
- **Swipes, edits and branches just work.** The tracker for any point in the chat is replayed
  from the `<Director>` blocks up to that reply.

## Install

1. Install and enable **Story Block** 0.6 or newer.
2. **Extensions → Install extension**, paste `https://github.com/kohz87/Story_director`.
3. Reload. Settings are under **Extensions → Story Director**; the tracker is the
   **Director** tab in Story Block's sidebar.

## Quick start

1. Open a chat with a World State block (Story Block's `World_State` template, or your own;
   pick it under **Scene block**).
2. Set your **calendar**: Gregorian, or your world's months (one per line, `Name` or
   `Name | days`) and era.
3. Already tracking Off-Screen, World, Hooks or Clocks lines in your World State? Press
   **Seed from World State** once: they become tracked records.
4. Play. The note goes in before each reply; the model answers with its `<Director>` changes,
   which Story Block hides.
5. Trim your preset: the World State list sections and their rules, writer_state and
   Megumin's Story Tracker are no longer needed. Keep the scene part (time, place, people).

## The change lines

```
<Director>
+ agenda Courier — now: rides south from Shorn | then: delivers the writ | on: Haywane 13
~ Senior Listener Geva — then: files the warrant | on: Haywane 13, 09:00 am
- Thys — left the city
! Canal Street Granary Fires — curfew declared
</Director>
```

| Op | Meaning |
|---|---|
| `+ kind Key — part \| label: value` | New record. Kinds: `agenda` (someone off-screen), `event`, `hook`, `clock`, `beat`, `secret` |
| `~ Key — label: value` | Change only these parts |
| `- Key — reason` | Resolved (superseded when the reason says so) |
| `! Key — what happened` | A due item happened; its `then` becomes `now` |

Fields: `now`, `then`, `on` (when `then` happens), `due` (when a clock fires), `shown`
(`none`/`sign`/`warning`), `leg` and `arrive` (travel), `place`, `people`. Dates go only in
`on`, `due` and `arrive`. The note tells the model all of this in about 120 tokens.

## The note

```
[Story Director · CY 611, Goldwane 16, 09:00 am · Auvoth]
Due now: Saartje's sale (Goldwane 16)
Off-screen: Geva — Bailiff Court → files the warrant (Goldwane 17)
World: Canal Street fires — curfew in force
Hooks: River stranger — who pulled Ren from the sump
Clocks: Hollin's Reach graves — the dead rise (Goldwane 28) · shown: sign
Do not reveal: who sold the weir route
Pacing: the world keeps its schedule and the scene keeps its flow. …
<how to write changes>
```

Whenever something is scheduled, a short **Pacing** line says how a schedule meets a scene:
bring a due item in only where it fits (on-screen if your character is there, otherwise later
as news, signs or aftermath), never cut into or bend the current scene for a beat, never decide
what your character does, and let what cannot fit happen off-screen or slip to a later date.

It is injected as a system message at a shallow depth (1 by default), so the cached history in
front of it is untouched.

## Places and the map

Every reply's World State says where the scene is. Story Director reads it as the story goes
and keeps a **place book**: each place (the first part of the location, "Auvoth"), the spots
inside it ("Seventh Seal Terrace"), how often and when the story was there. It is the
**Places** section of the Director tab, and it is shown even while the tab is hidden: you
were there.

When the location carries **map coordinates**, like
`**🌤 Loc:** Auvoth | Seventh Seal Terrace | [59.0, 110.0]` (many presets ask for them),
the places go on a small map, north up, with the distance and direction of each from where
the scene is now ("136 km NW"). Places within about 100 km count as "here" when the note
picks what is relevant. Nobody has to write a map file for any of this.

**Settings → Map & travel** says how to read the coordinates:

| Setting | Default | |
|---|---|---|
| North is | Up | *Up*: y grows to the north (a chart). *Down*: y grows to the south (an image, where 0,0 is the top left) |
| East is | Right | Which way x grows |
| km per unit | 1 | How far one coordinate unit is (a world pack's `scale_km_per_unit` sets it) |
| Road factor | 1.25 | Roads wind: straight-line km × this for trips over land |

**`/route` without a world pack** estimates from the coordinates:

```
/route Shorn to Auvoth
Shorn → Auvoth ≈ 219 km SE (≈ 175 km straight × 1.25) · foot 20/day · 12 days (1 rest) · arrive …
```

The days follow the same rules as roads: rounded up to the half day, a rest day after every six
days on land, none for couriers; boats and flight go straight. Paces without a pack: foot 20,
ride 35, wagon 18, boat 35, courier 70 km a day (or `rate=`).

## World packs and travel

A world pack is optional: it adds real roads. It is your map as JSON: places, roads (with km
and a road code), paces per road and mode, and travel rules. Import it under **Settings → Map &
travel → World pack** (file or paste); a pack's place coordinates also fill in the place book. If it brings
a calendar, you are asked whether to use it.

```jsonc
{
  "calendar": { "era": "CY", "days_per_month": 30, "months": ["Dawnwane", "…"] },
  "pace_km_per_day": { "B": { "foot": 20, "ride": 35, "wagon": 18 }, "F": { "foot": 16, "ride": 28, "wagon": 14 },
                       "W": { "boat": [30, 45] }, "T": { "foot": [14, 22], "ride": "foot", "wagon": null } },
  "courier_multiplier": 2,
  "travel_rules": { "round_edge_up_to_days": 0.5, "rest_day_every_active_days": 6,
                    "crewed_water_rest_days": false, "levee_roads": ["Grand Vein River"], "no_levee": ["Bluewatch Branch"] },
  "places": { "Shorn": { "x": 50, "y": 95, "region": "Shornmarch" }, "…": {} },
  "edges": [ { "a": "Shorn", "b": "Varnhold Watch", "km": 35, "code": "B", "corridor": "Shorn–Auvoth Bastion Road" } ]
}
```

**How travel is worked out:**

- The shortest road by km that the mode may use: wagons stay off trails, mountains, tunnels and
  hidden paths (`null`); riders go at foot pace where a code says `"ride": "foot"`; water is by
  boat only unless the corridor is a levee road.
- **Each road rounds up to the next half day** (`round_edge_up_to_days`), and the days add up.
- One rest day after every 6 travel days on land; none for couriers (relays) or crewed boats.
- Couriers ride at the ride pace × `courier_multiplier`. A range `[low, high]` uses its middle
  unless a rate is given; a leg's stated rate inside the range is accepted.

**What is checked** for every leg a reply writes or changes (`leg: FROM → TO KM CODE, MODE
RATE/day → DAYS`, `arrive:` its arrival):

| Problem | Example |
|---|---|
| Not one road | `Shorn → Auvoth 130 B` is three roads; the first is `Shorn → Varnhold Watch 35 B` |
| A road that does not exist | `Bluewatch Village → Siltbarrow`; the real exits are listed |
| Wrong start | A new leg must start where the last one ended |
| Wrong km | More than 5 % off the road's length |
| A mode the road does not allow | A wagon on a mountain road |
| Wrong arrival | More than half a day off what the pace gives, counted from when the leg was set |

Each problem comes with the corrected leg, which goes into the next note under
`Corrections:`. With a map, places one road away from the scene also count as "here" when
the note picks what is relevant.

**`/route FROM to TO [mode] [rate=N]`** (also `from=` / `to=` / `mode=`) prints the roads,
km, pace, days and the arrival from the scene's current time, for example:

```
/route Shorn to Auvoth courier
Shorn → Varnhold Watch 35 B → Wolfmere Outpost 55 B → Auvoth 130 B = 220 km · courier 70/day · 3.5 days · arrive …
```

The Director tab has the same tool under **Route**.

## Arc planning

Tracking and the note happen every reply, in code. **Planning is one model call per arc.**

- **When:** *Manual* (the **Plan arc** / **End arc** buttons in the Director tab), or
  *Automatic*: when there is no arc yet, when every beat of the arc has played out, or when no
  beat is due within the stall window (7 story days by default). The buttons work in both.
- **Model:** *Same as chat*, or any SillyTavern **connection profile** (its own API and model; a
  cheaper or faster one is fine). A missing profile fails with a message; it never falls back
  to another model.
- **What the planner reads:** the last messages (60 by default), the tracker, the current time
  and place, nearby places (with a world pack), your **genre and tone**, your **Director's
  note** (a goal, a pace, a beat you want) and the previous arc.
- **What it writes:** an arc, 3–6 dated beats, an agenda for each NPC the arc moves, hooks,
  clocks, and a secret for every secret it creates. Relative dates ("in 2 days", "tomorrow at
  dusk") become dates in your calendar. Plans that act for your character are flagged.
- **While it runs** a notice stays up ("Planning the next arc… on *profile*") until the plan is
  ready; a failure (the API refused, the answer was unusable) says why in a red notice.
- **Beats leave room:** the planner is told that a beat's date is when the world acts, not an
  appointment for your character. Every beat must work whether or not you are there, and may
  slip; the note's Pacing line tells the storyteller the same every reply.
- **Review:** the plan waits in the Director tab as editable change lines; **Accept** writes them
  into the latest reply (deleting that reply undoes the plan), **Discard** drops it, **Plan
  again** asks for another. Turn on *Use plans without review* to skip this.

From then on the note opens with `Arc: …`, lists the arc's next beats first, and keeps its
secrets under "Do not reveal". The planning prompt is editable (with reset); its macros are
`{{recent}}`, `{{tracker}}`, `{{now}}`, `{{place}}`, `{{nearby}}`, `{{note}}`, `{{genre}}`,
`{{previous_arc}}`, `{{user}}` and `{{char}}`.

## Capture (for models that skip the change lines)

Some models forget the `<Director>` block, or garble it. **Capture** hands that job to a second
call on a model of your choice (a small, fast one is enough):

- **When a reply has no `<Director>` block:** the model still writes its own changes; capture
  fills in only when it did not.
- **Always:** the note no longer asks the model for change lines at all; capture writes them
  for every reply.

The capture call reads only that exchange (your message and the reply) with the tracker for
context, and follows World State Alpha's capture rules: only what the exchange established,
never plans or guesses; a claim in dialogue stays a claim, a rumour a rumour. Changes to keys
that are not tracked are dropped, and capture never starts an arc. Its lines are written into
the reply like the model's own, so swipes and edits behave the same.

## Coming from World State Alpha

**Settings → Existing chat → Import from World State Alpha** takes an exported World State
Alpha bundle. Its active facts and developments become **World** records (developments keep
their trend; facts are marked settled and fold away in the tab), keyed by the first words of their summary, with their
anchors as the names to watch for. Resolved and superseded records stay behind. Turn World
State Alpha off afterwards; the two would inject overlapping notes.

## Settings

The panel (Extensions → Story Director) has a quick bar (the on/off switch, **Plan arc**, **Seed
from World State**) and folding groups: Tracking & note, Calendar, Map & travel, Arc
planning, Capture, and Existing chat & compatibility.

| Setting | Default | |
|---|---|---|
| Tracking | on | Off: no note, no checks |
| Scene block | `World_State` | Where the time and place are read |
| Depth | 1 | Chat depth of the note |
| Budget | 1000 tokens | Most the note may use; lowest-priority records drop first |
| Dormant after | 15 replies or 30 story days unseen | Left out of the note until mentioned again |
| Due soon | 3 days | Anything due this soon is never dormant |
| Calendar | Gregorian | Or your own months and era |
| Mirror Off-Screen | on | Writes active agendas into the scene block's Off-Screen section, for NPC State Delta (once tracking has started) |
| Map | north up, east right, 1 km per unit, roads × 1.25 | How the scene's coordinates read (see Places and the map) |
| World pack | none | Optional roads: places, edges, paces and travel rules, as JSON |
| Arc planning | manual, same as chat | When to plan, which model, how much chat it reads, answer length, stall window, review, genre and tone, Director's note, prompt |
| Capture | off | Off, when a reply has no `<Director>` block, or always; its model and answer length |

## The Director tab

What is due and arriving, every active record by kind (pin one to keep it in the note), the
arc and its beats, the dormant shelf, secrets, what was resolved recently, problems with the
last reply's changes, the places the story has been (with a map when there are coordinates),
and the route tool.

**Settled** records (World State Alpha's facts, or any record with `settled: yes`) are true
and going nowhere, so each section folds them into a closed **Settled** fold after its live
records. Folds you open stay open while you play; only *Do not reveal* closes again.

**It starts hidden.** The tracker is the story behind the scenes, so by default the tab shows
only the time and place, counts and what you can do (plan or end an arc, accept a waiting plan
without reading it, seed, route). **Reveal** opens it for that chat until you **Hide** it again
or reload; hidden text is not put on the page at all. Turn this off with **Hide behind the
scenes** in the settings' quick bar.

## Roadmap

| Version | Adds |
|---|---|
| 0.1 | Tracker, change lines, calendar, Due now, relevance and budget, dormant shelf, checks, the tab, seeding, Off-Screen mirror |
| 0.3 | World packs (places, routes, paces), travel legs checked and corrected, `/route` and the route tool |
| 0.4 | Arc planning on a model you choose (a connection profile or the chat's model): manual or automatic; Director's note, genre, review |
| 0.5 | Capture call on a model you choose (fallback or always); World State Alpha import |
| 0.6 | Place book from the scene's location, map settings (axes, km per unit, road factor), the Places map, `/route` estimates without a world pack |

The full design is in [docs/DESIGN.md](docs/DESIGN.md), the module contract in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Development

Plain ES modules, no dependencies, Node.js 24:

```sh
npm run check   # syntax check of index.js and src/
npm test        # node:test suites
```

## License

GPL-3.0.
