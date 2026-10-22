# World, Journal and the people present

What the player character knows, shown on the World screen (Now | Journal). Detail: the header comments
of `src/v2/world/index.js` and `known.js` (the exact PC-known rules), Story Block MODULES.md §C and §F
(F100), Story Block GUIDE.md "The World screen and your journal"; the suite notes' V2_LOG.md entries
"World view = PC-known only" and "world-people".

## Rules

- **Nothing is stored.** Every answer is worked out on read from the state and other parts' and modules'
  queries, so a swipe, a middle delete or a reload shows what a rebuild shows. Keep it that way: no new
  domain fields for World.
- **PC-known only:** Here (the map place, else Story Block's `scene.place`, and the people the scene lists as
  present), known news and events (chronicle world events, the Director's `event` threads), factions, and
  Upcoming (accepted quests' `due:`, open events' and hooks' `on:` dates, pack holidays) within
  `world.upcomingDays` (default 30) story days.
- Never shown: agendas, beats, clocks, secrets (behind the scenes, Reveal), and anything the arc planner made
  or touched, unless revealed.
- Feature `story-director.world` (on by default): the screen, the people widget, the queries and the setting.
  Off, none of it is drawn or asked.
- Works with any set of modules: without NSD the people are plain names; without a pack no holidays; without
  the clock nothing has a date; without the day digest the Journal says it is off.
- NSD asks `director.world.here` to know who is present (its scan reads the present list); the people widget
  shows NSD's present-cast cards and latest chatter when NSD is there.
- Queries: `director.world` (Now), `director.world.here`, `director.journal` (each story day from the digest,
  and today so far). The Days screen is folded into the Journal (`story-director/days` kept as a dialog).

## Key files and functions

- `src/v2/world/index.js` (part, feature, queries), `known.js` (`worldView`, `hereView`, `tryQuery`,
  `DEFAULT_UPCOMING_DAYS`), `journal.js` (`journalView`), `people.js` (`peopleWidget`), `screen.js`
  (`worldScreen`, `daysScreen`, `WORLD_ID`, `DAYS_ID`).
- Inputs: `src/v2/chronicle/` (digest, days, world events), `src/v2/atlas/` (`atlas.here`), `src/v2/screens/reveal.js`.

## Tests that guard it

- `tests/v2/world/` (`world.test.js`, `journal-screen.test.js`), `tests/v2/chronicle/`, `tests/v2/arc/reveal.test.js`.
- Break findings: `tests/v2/break/final-surface-later-world-line`, `c2-digest-*`, `rx-timeline-digest-trimmed`.

## When you change it

- Show that a rebuild after swipe / middle delete draws the same World (derived views make this free; a
  stored field breaks it).
- Test with NSD, RPG Battle and packs absent.
