# Story Director v0.1.0

A SillyTavern extension that keeps a story's world moving consistently. It **tracks**
off-screen agendas, world events, hooks and clocks, works out in code what is **due**, and
injects a short **note** before every reply with what is due, arriving and relevant to the
scene. The model writes only what changed; nothing it forgets to copy is ever lost.

Works on top of [Story Block](https://github.com/kohz87/Story_block) (0.6 or newer). Arc
planning with a model of your choice, travel routes and world packs follow in later versions
(see [Roadmap](#roadmap)).

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
<how to write changes>
```

It is injected as a system message at a shallow depth (1 by default), so the cached history in
front of it is untouched.

## Settings

| Setting | Default | |
|---|---|---|
| Tracking | on | Off: no note, no checks |
| Scene block | `World_State` | Where the time and place are read |
| Depth | 1 | Chat depth of the note |
| Budget | 1000 tokens | Most the note may use; lowest-priority records drop first |
| Dormant after | 15 replies or 30 story days unseen | Left out of the note until mentioned again |
| Due soon | 3 days | Anything due this soon is never dormant |
| Calendar | Gregorian | Or your own months and era |
| Mirror Off-Screen | on | Writes active agendas into the scene block's Off-Screen section, for NPC State Delta |

## The Director tab

What is due and arriving, every active record by kind (pin one to keep it in the note), the
dormant shelf, secrets (hidden until you open them), what was resolved recently, and any
problems with the last reply's changes.

## Roadmap

| Version | Adds |
|---|---|
| 0.1 | Tracker, change lines, calendar, Due now, relevance and budget, dormant shelf, checks, the tab, seeding, Off-Screen mirror |
| 0.3 | World packs (places, routes, paces), travel legs checked and corrected, `/route` |
| 0.4 | Arc planning on a model you choose (a connection profile or the chat's model): manual or automatic at arc end; Director's note and genre |
| 0.5 | Optional capture call for models too weak to write change lines; World State Alpha import |

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
