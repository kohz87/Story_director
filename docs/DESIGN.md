# Story Director: design

Status: **accepted** · 0.1.0 (tracker), 0.3.0 (world packs and travel), 0.4.0 (arc planning) and 0.5.0 (capture, World State Alpha import) released (see section 13 for the review decisions)

Story Director is a SillyTavern extension that keeps a story's world moving consistently. It
**tracks** off-screen agendas, world events, hooks, clocks and travel; it **checks** dates
and distances in code; it **injects** a short note before every reply; and once per story arc
it **plans** the next arc with a model you choose, the way Megumin Suite's Story Director
does, but with the plan turned into dated, tracked beats instead of a block of prose.

It works with **Story Block** (which keeps and draws the scene block) and supersedes **World
State Alpha** and the list sections of the World_State block (Off-Screen, World, Hooks,
Clocks). Nothing in it is tied to one setting: calendars, list names, caps and maps are
reader-configured data.

---

## 1. Principles

1. **Code owns lookups, arithmetic and memory; the model owns judgment and prose.** Every
   recurring failure of the old World_State lists was arithmetic (travel time), a lookup
   (which road), a comparison (did a line disappear?) or memory (a dormant line fading).
2. **The model never rewrites the whole tracker.** Each reply writes only *changes*. A line
   the model leaves out is unchanged, never dropped.
3. **Track and inject every reply; plan once per arc.** Tracking is code (free, instant).
   Planning is one model call when an arc starts or ends, not every turn.
4. **The chat is the source of truth.** Every change is written in the reply that made it, so
   swipes, edits, deletes and branches are always right; any cached state can be rebuilt by
   replaying the chat.
5. **Inject facts, not rules.** The note says what is true and due; the rules that used to
   live in the preset are now code, which keeps the preset short.

## 2. What goes where

| Extension | Owns | Written by |
|---|---|---|
| **Story Block** | The scene block, as a camera: Time, Location, Weather, the player character, NPCs present. Also Inventory, Choices, Dice. | Main model, every reply |
| **Story Director** | The tracker (agendas, events, hooks, clocks, beats, secrets), the calendar, travel, the arc plan, the injected note | Code every reply, from the model's change lines; the arc plan from one planning call per arc |
| **NPC State Delta** | NPC dossiers | Its own extension. With the Story Suite (see 11) it keeps who each NPC is, and reads Director's calendar |

The World_State block keeps its first half (time, place, people) and loses its list
sections. Its prompt gets shorter, not longer.

## 3. The tracker

### 3.1 Records

```js
{
  key: 'Senior Listener Geva',       // stable identity; never renamed or reused
  kind: 'agenda' | 'event' | 'hook' | 'clock' | 'beat' | 'secret',
  status: 'active' | 'dormant' | 'resolved' | 'superseded',
  now: 'District Bailiff Court',     // current state (agenda: where/what now; event: what is happening)
  then: 'argues with magistrates over the stable warrants',   // what happens next
  on: 'Haywane 12, 05:45 pm',        // when `then` happens          (agenda, event, hook, beat)
  due: 'Goldwane 28',                // when a clock fires           (clock)
  shown: 'none' | 'sign' | 'warning',// how visible a clock is       (clock)
  leg: 'Shorn → Varnhold Watch 35 B, courier 70/day → 0.5',   // travel, one hop
  arrive: 'Haywane 13, morning',
  place: 'Auvoth',                   // where it lives (for relevance); from now/leg when unset
  people: ['Geva'],                  // who it involves (for relevance)
  arc: 'arc-2',                      // set when the arc plan created it
  history: [{ message: 812, change: '~ then: argues…' }],      // every change, with its reply
}
```

The kinds map the old lists and Megumin's blueprint onto one shape:

| Kind | From | Meaning |
|---|---|---|
| `agenda` | Off-Screen; blueprint NPC agendas | A person with a stake, doing something off-screen |
| `event` | World | Something happening in the world (fire, curfew, war) |
| `hook` | Hooks; blueprint pending threads | An open tension and what would settle it |
| `clock` | Clocks | A consequence that fires at `due:` unless something stops it |
| `beat` | Blueprint main event and sub-events | A planned story moment with an `on:` date |
| `secret` | Blueprint off-limits | Something not to reveal yet; injected only as "do not reveal" |

### 3.2 Change lines (what the main model writes)

Each reply ends with one short block, carried in Story Block's hidden envelope:

```
<Director>
+ agenda Courier — now: rides south from Shorn | then: delivers the writ | leg: Shorn → Varnhold Watch 35 B, courier 70/day → 0.5 | arrive: Haywane 13, morning
~ Senior Listener Geva — then: files the warrant with the Bailiff Court | on: Haywane 13, 09:00 am
- Thys — left the city
! Canal Street Granary Fires — curfew declared
</Director>
```

| Op | Meaning |
|---|---|
| `+ kind Key — part \| part …` | New record |
| `~ Key — part \| part …` | Change only the parts written; the rest stay |
| `- Key — reason` | Resolved (or superseded, when the reason says so) |
| `! Key — what happened` | A due item fired: its `then` happened and becomes `now`; the model gives the next `then`/`on`, or code marks it resolved |

Rules for the parser (all lenient): bold and bullets ignored; ` — `, ` – ` or `:` after the
key; parts split on ` | `; unknown keys on `~`/`!` are reported, not invented; `-` of an
unknown key is ignored with a warning.

The instruction the model gets for this is about 120 tokens and replaces the old list rules,
writer_state and the Story_Tracker.

### 3.3 Storage and swipes

- The change lines live **in the reply** (inside Story Block's envelope), so the tracker for
  any point in the chat is "the starting tracker + every change up to that reply".
- A computed snapshot is cached in the reply's `extra` (`extra.storyDirector`). SillyTavern
  keeps `extra` per swipe and restores it on swipe back, so swiping is instant. A missing or
  stale cache (edited message, imported chat) is rebuilt by replaying the chat.
- Deleting or editing a reply changes the replay, so the tracker follows automatically.
  There is no rollback journal and no server file.
- The arc plan is stored the same way, on the reply it was planned after (see 5.4).

### 3.4 Dormant shelf

A record goes **dormant** when it has not been seen (mentioned or changed) for N replies
(default 15) **or** for M story days (default 30), and nothing about it is due within D days
(default 3). All three are adjustable. Dormant records are not injected and
cost nothing. One comes back automatically when:

- its key, place or people appear in the scene or the player's message;
- its `on:`/`due:`/`arrive:` comes within D days;
- the reader pins it.

This replaces the prompt-side Dormant system, which failed because a model has to remember
a line to wake it up.

## 4. Every reply (no model calls)

### 4.1 Before the reply (generate interceptor)

1. **Tracker for this point.** Replay to the reply the model is about to continue (for a
   swipe or regenerate, the reply before the one being replaced).
2. **Now.** Read Time and Location from the scene block (via Story Block's plugin API).
3. **Due and arriving.** Every `on:`/`due:`/`arrive:` at or before now (day-level when no
   time is written).
4. **Relevant records** (4.2), within the injection budget.
5. **The note** (4.3), injected as a system message at depth 1, so prompt caching of the
   history is not broken. Cleared when there is nothing to say.

### 4.2 Relevance

A record is relevant when, in order of priority:

1. it is due, arriving, or a clock showing a sign/warning;
2. it belongs to the current arc's next beats;
3. its place is the current location (or one hop away, with a world pack);
4. its key or people appear in the scene block or the last two messages;
5. it changed in the last few replies.

Highest first until the budget is spent (default 1000 tokens, adjustable). Secrets are
never listed as facts; their keys only appear under "Do not reveal".

### 4.3 The note

```
[Story Director · CY 611, Goldwane 16, 09:00 am · Auvoth]
Due now: Saartje's sale (Goldwane 16) · Courier arrives Varnhold Watch (Goldwane 16, morning)
Beats — The Weir Bullion: Council vote (Goldwane 18) · Thys watches the gate (ongoing)
Off-screen: Geva — Bailiff Court → files the warrant (Goldwane 17) · Brant — on the frontier road with a dray → arrives Auvoth (Goldwane 19)
World: Canal Street fires — curfew in force
Hooks: River stranger — who pulled Ren from the sump
Clocks: Hollin's Reach graves — the dead rise (Goldwane 28) · shown: sign
Do not reveal: who sold the weir route; Chiyo's debt to the guild
Corrections: Courier — leg is Shorn → Varnhold Watch 35 km B, courier 70/day → arrive Goldwane 16, morning
Write changes in <Director> (+ new, ~ change, - resolve, ! fired).
```

### 4.4 After the reply

1. Story Block hides the `<Director>` block with the rest of the envelope.
2. Director parses the change lines, applies them, and checks (4.5).
3. The snapshot is cached; the sidebar tab refreshes; problems show once as a toast.

### 4.5 Checks (code)

| Check | Result |
|---|---|
| A due item passed and the reply did not `!` it | Reminded again next reply ("Due now"); after 1 day, flagged as missed |
| `~`/`!` on an unknown key | Warning; nothing is invented |
| Two records with one key, or one party split in two (same leg and arrival) | Warning |
| A leg that is not one hop, uses a road that does not exist, has the wrong km, or an arrival that does not match the pace | Correction in the next note (with a world pack) |
| A date written inside `now`/`then` instead of `on`/`due`/`arrive` | Info |
| A part over 12 words | Info (long parts get summarised away by models) |
| Too many active records of a kind | No error: the dormant shelf and the budget handle it; caps only limit injection |

## 5. Once per arc: the planning call

### 5.1 When

- **Arc start:** the reader presses *Plan arc*, or the chat has no active arc.
- **Arc end:** every beat of the arc is resolved, or the reader presses *End arc*.
- **Stalled:** no beat is due within the next N story days (default 7) and the reader
  allows automatic replanning.
- **Never** on an ordinary reply. Ordinary replies only track.

The reader picks the trigger: **manual** (Plan arc / End arc buttons only) or **automatic**
(at arc end and when stalled, as above, plus the buttons).

### 5.2 Model

A SillyTavern **connection profile** (its own API and model), or the chat's own connection.
If a chosen profile is missing, the call fails with a clear message and never falls back to
another model silently.

### 5.3 Input and output

Input: the last N messages (default 60), the tracker (active and dormant summaries), the
current time and place, nearby places and routes (with a world pack), the reader's
**Director's note** (a goal, a pace, a beat they want) and **genre/tone**.

Output, in a fixed format the code parses:

```
ARC: The Weir Bullion — who sold the weir route, and the Council vote it decides
BEAT: Council session opens | on: Goldwane 18, 09:00 am | place: Grand Hall
BEAT: Kade presents the corrupted core | on: Goldwane 18 | after: Council session opens
AGENDA: Geva — now: Bailiff Court | then: reissues the stable warrants | on: Goldwane 17
HOOK: River stranger — who pulled Ren from the sump; finding him settles the debt
CLOCK: Hollin's Reach graves — the first of the dead rise | due: Goldwane 28 | shown: none
SECRET: Kade sold the weir route to the Highmark legation
```

Relative dates ("in 2 days", "the next morning") are converted by code from the current time.

### 5.4 After planning

- Code validates the plan: dates in the future, places that exist (with a world pack),
  travel that is possible in the time given (a beat in Auvoth on Goldwane 18 for a character
  in Shorn on Goldwane 17 is flagged, with the earliest possible arrival), no actions for the
  player character.
- The plan becomes records (`beat`, `agenda`, `hook`, `clock`, `secret`) tagged with the arc,
  stored on the latest reply (so deleting that reply undoes the plan).
- The reader sees it in the tab and can edit, drop or re-run it before it takes effect.

## 6. Calendar and travel

- **Calendar:** Gregorian, or custom (era, month names, days per month); parts of day
  (dawn 06:00, morning 09:00, noon, afternoon 15:00, dusk/evening 19:00, night 22:00). A
  date without a year takes the year nearest to now.
- **World pack** (optional JSON, the format of `Ersveil_Routes.json`): places with
  coordinates, routes with km and road code, paces per code and mode, courier multiplier,
  travel rules. Without one, travel checks are off and everything else works.
- **Travel maths:**
  - shortest route by km, respecting the mode: no wagons on trail, mountain, tunnel or hidden
    roads; boats only on water unless a levee road is named;
  - **round-up rule:** each road segment rounds up to the next half day;
  - one rest day after every 6 travel days on land (not for couriers or crewed boats).
- **`/route FROM TO [mode] [rate=N]`** prints the hops, km, pace, days and arrival.

## 7. What the preset can drop

- The World_State list sections (Off-Screen, World, Hooks, Clocks) and their seven rules.
- writer_state, and Megumin's Story_Tracker.
- Pace tables, rounding rules and worked travel examples (they stay in lore for flavour only).
- Keep in the preset: the scene block, prose style, and how characters behave.

## 8. Interface

**Sidebar tab "Director"** (in Story Block's sidebar):

- **Now:** time, place.
- **Due and arriving.**
- **Arc:** the beats in order with progress, and the Director's note.
- **Tracker:** records by kind, with search; the dormant shelf folded; resolved records in a
  timeline.
- **Do not reveal:** secrets, hidden behind a tap.
- **Route tool** (with a world pack).
- **Problems** from the last reply.

**Settings:**

- Tracking on/off, which scene block to read, injection depth and budget, dormant
  thresholds.
- Calendar.
- World pack (import, summary, clear).
- Arc planning: model (profile or chat), messages to read, genre/tone, automatic triggers,
  the planning prompt (editable, with reset).

## 9. Starting from an existing chat

- **Seed from the latest World_State block:** its Off-Screen, World, Hooks and Clocks lines
  become agendas, events, hooks and clocks, with their dates and legs. A one-click action,
  previewed before it applies.
- **Optional import from World State Alpha's export:** active developments become events,
  facts become events marked as settled.

## 10. Module layout

```
index.js            SillyTavern glue: interceptor, events, injection, /route, tab, settings
src/calendar.js     calendars, date parsing and maths (pure)
src/changes.js      parsing change lines (pure)
src/tracker.js      records, applying changes, replay, dormant shelf (pure)
src/relevance.js    picking what to inject (pure)
src/note.js         the injected note (pure)
src/routes.js       world packs, shortest paths, legs, travel maths (pure)
src/checks.js       the checks in 4.5 (pure)
src/planner.js      the arc planning prompt, output parser, plan validation (pure)
src/seed.js         seeding from a World_State block or a World State Alpha export (pure)
src/ui/tab.js       the sidebar tab
src/ui/settings.js  the settings panel
```

Everything under `src/` except `ui/` is pure and tested without SillyTavern.

Story Block needs a small plugin API (0.6): read a block's current and previous copy, the copy
a generation will see, a notice after each reply, and tab keys and badges. NPC State Delta
needs nothing from Director to work; with the Story Suite it reads Director's calendar.

## 11. Compatibility

- **Off-Screen mirror:** Director can mirror its active agendas as an `Off-Screen` section in
  the stored World_State block, for readers who keep that section (a toggle, on by default).
  NPC State Delta does not read it.
- **Story Suite** (v0.8, [STORY_SUITE.md](STORY_SUITE.md)): Story Block, Director, NPC State
  Delta and RPG Battle announce what they own on a shared registry. Director offers the
  calendar, the timeline and NPCs; while NPC State Delta keeps who each NPC is, Director's
  agenda lines give only plans and timing. NPC State Delta takes Director's calendar
  (`StoryDirector.calendar()`).
- **World State Alpha:** turn it off when Director is on; the two would inject overlapping
  notes.
- **Megumin Suite's Story Director:** turn it off; Director replaces it.

## 12. Releases

| Version | Contents |
|---|---|
| 0.1 | Tracker, change lines, replay and cache, calendar, Due now, the note, the tab, seeding from World_State |
| 0.2 | Relevance and budget, dormant shelf, checks, problems in the tab |
| 0.3 | World packs, legs and corrections, `/route` |
| 0.4 | Arc planning: model choice, Director's note, genre, triggers, plan review |
| 0.5 | Optional: a capture call on a chosen model for writers too weak to emit change lines; World State Alpha import |

## 13. Review decisions

1. Change-line block: `<Director>`.
2. Injection budget: 1000 tokens to start, adjustable.
3. Dormant: unseen for 15 replies or 1 story month (30 days), nothing due within 3 days; all
   adjustable.
4. Arc planning trigger: both, the reader chooses manual or automatic.
5. Off-Screen mirror into the World_State block: on by default, with a toggle.
