# Story Director v2.0.0-alpha.1

> **v2 (alpha, `v2` branch).** Story Director 2 is a module of **Story Block v2** and needs it
> (`"dependencies": ["third-party/Story_block"]`); without it, it shows one line in the extensions drawer
> and does nothing else. Story Block keeps the state in the replies, reads each reply's `<Changes>` block
> and builds the prompt; Story Director adds the `director` domain (story time, threads, quests), its
> change-line kinds (`agenda`, `event`, `hook`, `quest`, `clock`, `beat`, `secret`, `time`, `route`,
> `landmark`, `world`, `faction`), the Director note, the commands `quest.take`, `quest.abandon`,
> `quest.finish`, deadlines that slip or lapse as story time passes with a *While away* recap after a
> jump, the atlas (places, routes, travel times), the chronicle (world events under way and the factions
> behind them, three of them recalled to the story each reply), a day digest written by code when a story
> day ends (feature `story-director.digest`, on by default) and its screens: Quests, Director, Map,
> Chronicle, Days, the time-and-place
> strip and a status card under every reply (on by default, collapsed; turn it off per screen). The story
> clock runs on the reader's calendar, or by default on the enabled pack's (Ersveil: CY, twelve months
> of 30 days; the Calendar settings then show the pack's calendar and say so, and Custom starts from it), and starts at the pack's start date when the story has not set it. Quest rewards are whole
> amounts of the chat's one currency, paid once by code; one fight pays one kill quest. Quests follow the
> story: when the story has your character accept a job it writes `+ quest`, and the quest is active at
> once (taken on from that reply; there is no Offered list and nothing to accept). A job the story only
> mentions stays in the story (a `+ hook` is an open thread, whatever it pays, and never a quest until
> the `+ quest`). You give a quest up in your own words, and when the story turns a quest in
> code checks the target (or, for a goal code cannot count, the story's `met: yes`) and the place, then
> pays, held inside the quest's rank range (F to S, or your own ladder from RPG Battle's settings → Terms →
> Rank ladder and Levels per rank, e.g. Soul Class I to IX or F to SSS, or the pack's; without RPG Battle a
> ladder has no levels to band, so quests keep Story Director's own ranks, the pack's else F to S, and
> Quests → **Quest ranks follow the rank ladder** off keeps them always; a rank the story
> writes is held to the party's own, and one reply pays at most that rank's top in money the story
> wrote, its own coin lines and quest rewards together, pack quests aside); a turn-in that fails a check stays open and the next reply is told why. The Quests screen has no buttons: each row says
> where the quest stands ("Ready to turn in — 3/3 wolves", "Not yet: 2/3 wolves") and opens its details
> (goal, progress note, terms, dates, history). An older chat's offers still load; they are shown nowhere
> (the Director tab tags them "offered") and become the quest when the story writes `+ quest` for one.
> **Arc planning** (feature `story-director.arc`, on; needs Story Block 2.0.0-beta.1 or newer for its model
> call, else the Director tab says so and shows no buttons): **Plan arc** asks a planner model, on its own
> connection profile, for the next arc; the plan waits for your review (**Accept**, **Discard**, **Plan
> again**) and, accepted, becomes the Director's own beats, agendas, hooks, clocks and secrets. See
> [Arc planning in v2](#arc-planning-in-v2). **Behind the scenes** (agendas, planned beats, clocks, secrets)
> is hidden on the Director tab until you press **Reveal** (per chat, remembered); the story is told all of it.
> The v1 text below on offers, Take on and Turn down describes v1 only. The contract is `docs/v2/SPEC.md` and `docs/v2/MODULES.md` on Story Block's `v2`
> branch. The v1 description below is kept for its rules, which v2 reuses; the v1 glue (`index.v1.js`)
> is not loaded. Progress for the whole suite:
> [Story Block docs/v2/STATUS.md](https://github.com/kohz87/Story_block/blob/v2/docs/v2/STATUS.md).

A SillyTavern extension that keeps a story's world moving consistently. It **tracks**
off-screen agendas, world events, hooks, quests and clocks, works out in code what is **due**, and
injects a short **note** before every reply with what is due, arriving and relevant to the
scene. The model writes only what changed; nothing it forgets to copy is ever lost.

Works on top of [Story Block](https://github.com/kohz87/Story_block) (0.6 or newer). It keeps
a **place book** of everywhere the story goes, on a map when the scene's location carries
coordinates, with distances, directions and trip estimates. With a
**world pack** (your map as JSON, optional) it also checks travel: every leg against the real roads,
distances and paces, with corrections in the next note and a `/route` planner. And once per
story arc it **plans** the next arc with a model you choose, the way Megumin Suite's Story
Director does, but the plan becomes dated, tracked beats instead of a block of prose.

## Screenshots

From a demo session with [Story Block](https://github.com/kohz87/Story_block), [NPC State Delta](https://github.com/kohz87/npc_state_delta) and [RPG Battle](https://github.com/kohz87/rpg_battle).

| Director tab, behind the scenes revealed | Quests tab |
| --- | --- |
| <img src="docs/images/director-tab.png" alt="The Director tab: the place, off-screen agendas for Captain Kael and Mira with now, then and on, and a hook for the wolves' den" width="300"> | <img src="docs/images/quests-tab.png" alt="The Quests tab: the main quest The bond, hard, and two sheepfold bounties, each with its goal, next step and a quiet line of giver, reward and deadline" width="300"> |

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
   `Name | days`) and era. If your world has its own week, list its day names under **Week**
   and pick **Today is** (since 0.9.21). Left empty, the note tells the story the world has no
   weekdays, so it gives dates ("Goldwane 14") instead of "Friday noon".
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
| `+ kind Key — summary \| label: value` | New record. Kinds: `agenda` (someone off-screen), `event`, `hook`, `quest`, `clock`, `beat`, `secret` |
| `~ Key — label: value` | Change only these parts |
| `- Key — reason` | Resolved (superseded when the reason says so) |
| `! Key — what happened` | A due item happened; its `then` becomes `now` |

A `~`, `!` or `-` on a key that is not tracked goes to the one active record it plainly means:
the same words once case, punctuation, a leading *the/a/an* and small words (*in, at, of, on,
to, for, from, and*) are set aside, or one key's words inside the other's (two words or more),
or three quarters of the words shared; `~ Footing in Bluewatch — …` changes *Footing at
Bluewatch*, and the Director tab notes it. Failing those (since 0.9.16), a looser reading:
plurals folded (*wolves* is *wolf*), job words set aside (*contract*, *bounty*, *quest*…) and a
word inside a longer one (*fold* in *sheepfold*), so `! Fold Wolf Contract — …` reaches
*Sheepfold Wolves*; then every word of the key found in one record's name, goal or description
(*Wolf Hunt — kill ridge wolves threatening the sheep fold*). Two such records are never guessed between.
A name read so is remembered on the record (since 0.9.19): later lines with it, a `+` among
them, are that record's as its own key would be, with no new note, and the Director tab lists
it under *also called* (the newest eight; a name two records could claim stays the first's). With
no record meant, a `~` that carries something becomes a new hook (a `type:` that names a kind, such as
`type: clock`, sets that kind instead), a `-` does nothing, and any other line is ignored: a
warning in the Director tab, and one line in the next note's `Corrections:` (`"Key" is not
tracked: add it with "+ kind Key — …" before changing it.`), only for the latest reply.
A key that only labels the line (*Encounter*, *Fight*, *Combat*, *Battle*, *Scene*, *Status*,
*Update*, or a kind word such as *Quest* or *Hook*) names no record unless one is really called
that: its line is skipped quietly (since 0.9.14), with no warning and nothing in `Corrections:`.

Fields: `now`, `then`, `on` (when `then` happens), `due` (when a clock fires), `shown`
(`none`/`sign`/`warning`), `leg` and `arrive` (travel), `place`, `people`, `encounter` (the
foes of a planned fight), `reach` (how a beat touches your character wherever they are, since
0.9.19; see [Arc planning](#arc-planning)); for a quest also `type`, `giver`, `goal`, `reward`, `step` and
`difficulty`. Dates go only in `on`, `due` and `arrive`, with a clock time. The note tells the
model all of this in about 165 tokens.

A quest's deadline is always shown, in the Quests tab and in the note, at a clock time the
calendar sets (since 0.9.12): a part of the day becomes its time (`Goldwane 12 sunset` →
*Goldwane 12, 07:00 pm*; dawn, sunrise and daybreak are 06:00 am, morning 09:00 am, noon,
afternoon 03:00 pm, dusk, evening, sunset and sundown 07:00 pm, night 10:00 pm) and a date
alone runs to the end of its day (*Goldwane 30, 11:59 pm*). The deadline marks count from that
time. A calendar with its own parts of day changes those times.

A kind written with a colon in front of the key (`~ Hook: Sheepfold Wolves — …`, `+ Quest: …`)
names the kind and is not part of the key (since 0.9.10).

Parts are separated by `|`. Fields a model runs together with commas or semicolons instead
(`type: contract, giver: Nelke, reward: 2 silver`) are split the same way (since 0.9.8), but
only before one of these field names, so a comma inside a value (`giver: Nelke, the clerk`)
stays.

### Quests

> **v2: quests go straight to active.** The story writes `+ quest` when your character accepts a job,
> and the quest is active and taken on from that reply, whatever your message said: there is no
> Offered list, no Take on or Turn down, and no offer cooldown. A job the story only mentions stays in
> the story: a `+ hook` is an open thread even with a `giver` and a `reward`, a `~` never turns it into
> a quest, and closing it never makes it a finished quest; `+ quest` (or a `-` saying it was taken on)
> does. Giving a quest up is still your choice, in your own words (`- quest Key — abandoned`), and the
> story turns quests in as below. An older chat's offers load as they were stored and are shown
> nowhere (the Director tab tags them "offered"); `+ quest` for one takes it on. Rank hold, the money
> budget and Story Director alone are unchanged. The offer rules below are v1's.

Long-running work your character has taken on: bounties, contracts, favours owed, a hunt.
Short errands that end within the scene do not need one.

```
+ quest Bounty on Kettle Jack — type: bounty | giver: Warden Hale | goal: bring him in alive | reward: 40 crowns | due: Haywane 30 | difficulty: hard
~ Bounty on Kettle Jack — step: cornered at the weir
- Bounty on Kettle Jack — turned in, paid
```

One kind covers them all; `type` is the category: `main`, `side`, `bounty`, `contract`,
`mission`, `favour`, or any word you like. Writing the category as the kind (`+ bounty Wolf
pelts — …`, `+ contract …`) sets the type by itself.

`difficulty` is one of `easy`, `normal`, `hard` or `nightmare`; a quest without one is
`normal`. The obvious other words are read as one of the four (`trivial`, `simple` → easy;
`medium`, `moderate` → normal; `difficult`, `tough` → hard; `deadly`, `impossible`, `extreme` →
nightmare), and anything else as normal. The note mentions it next to the type when it is not
normal (`Bounty on Kettle Jack (bounty, hard) — …`). Other extensions can scale by it: RPG
Battle offers quest XP by difficulty when a quest is finished.

- A new line with no kind is a quest only with a `giver`, a `reward` or a quest `type` (since
  0.9.3); a `goal`, `step` or `difficulty` alone makes it a hook.
- A quest starts only when your character **accepts** it, and only for a job that outlasts the
  scene, not an errand; an offer not yet taken is a hook. When you take on a hook that is
  already tracked (register for the bounty, agree to the job), `~ Sheep-killer — giver: Hobb |
  reward: 4 silver` makes it the quest (since 0.8.6), keeping its key, description and history.
  A hook or event becomes a quest when a `~` names it one (`type: quest`, or a category such as
  `type: bounty`), or when it is a **job** (it has, or the `~` gives it, a `giver`, a `reward` or
  a quest category) and the `~` moves it on (`giver`, `reward`, `goal`, `step` or `difficulty`).
  So `~ Wolf pelts — step: tracking the pack` on a bounty the arc planner offered with its reward
  makes it a quest, while a `step` on a plain thread does not (models write `step:` for any
  progress). Arc beats never become quests, and an untracked key written with a giver or reward
  is added as a quest. `+ quest Key` on a hook or event already tracked makes it the quest too
  (since 0.9.9), keeping its key and history. A `-` that says the job was taken on (`- Hook
  Sheepfold Wolves — accepted by Wessel`, *taken on*, *signed up*, *became a quest*) does not end
  it (since 0.9.13): it makes a hook or event the quest, and on a quest it changes nothing. One
  that also speaks of pay or an ending (*reward accepted*, *declined*) still closes it.
  The arc planner offers work as hooks and never completes a quest for you.
- **Your choices are yours** (since 0.9.15). Taking a job on, turning it down and giving it up
  come from **your own message**, the one the reply answers; finishing and failing are the
  story's. A `+ quest` counts only when your message accepts the job (*accept*, *take it*, *I'll
  do*, *we'll join*, *agree to*, *sign up*, *count us in*, *I'm up for it*, *deal*…) in a sentence
  naming it, its giver or a word of its name (*the wolf job* is Wolf Hunt), or with only one job
  in question, when a plain *yes*, *sure* or *aye* also counts (since 0.9.27); otherwise it is
  kept as an **offer**. Since 0.9.32 taking a notice down (*took down*, *took them*) counts too,
  and so does taking several at once: *all three contracts*, *both jobs*, *all of them* mean the
  offers shown most lately (that many of them, newest first), so *I took down all three
  contracts* takes on the three the board just showed, and *turned them all down* refuses them.
  Since 0.9.33 each offer in the Quests tab also has **Take on** and **Turn down**. The choice
  goes with your next reply, like Abandon: until then the offer reads *taken on with your next
  reply* with **Undo**. The reply is told behind the scenes (*Taken on: Ren takes on Lime Kiln
  Bats. Show it in this reply as part of the scene, in the story's own voice*), your choice is
  stamped on it, and the lines are written for the story if it left them out. So the offer
  becomes your quest (or closes as declined) whatever the story wrote, a swipe is told again,
  and deleting that reply takes the choice back. Since 0.9.37 each offer says **where it was
  offered**: the settlement of the scene's Loc at the reply that first showed it (*Bluewatch
  Village · here* while the story is anywhere in Bluewatch Village, *offered in Bluewatch
  Village* elsewhere). Its giver in the scene counts as here too (*Elke · here*), read from
  the scene block's *NPCs Present*, else NPC State Delta's present cast, else the latest reply.
  Elsewhere, **Take on** asks once, inline: *You're not in Bluewatch Village — take it
  anyway?* **Turn down** never asks. Settings → Tracking & note → *Ask before taking on a job
  away from where it was offered* turns the question off. A main quest (`type: main`) is the story's to give, and an offer the
  story moves on (`~ Wolf Hunt — step: tracking the pack`; a `step: 0/1` is not under way) is
  one your character is already doing: both start at once. A model line that gives a job up or
  turns it down (*abandoned*, *gave up*, *declined*, *refused*…) changes nothing unless your
  message said so. When your message takes an offer on or turns one down, the note asks the
  story to write it ("Ren may be taking on Wolf Hunt. If they do, write + quest Key with its
  parts; if not, leave it an offer."). Offers fold under **Offered** in the Quests tab, without
  buttons, until taken on, turned down or past their deadline. Messages in other languages, or
  a job taken on without saying so, leave it an offer until the story moves it on.
- **An offer done is a quest done** (since 0.9.27). Going and doing a job without the words to
  take it on is still doing it: when the story says an offer is finished (`! Barrow-Viper
  Clearing — 10 skins turned in to Verna`, `~ … — step: completed`, `- … — bounty paid`) and
  your messages have spoken of it (its name, a word of it or its giver), it closes as your quest,
  finished, with its quest XP. One you never spoke of closes too, as news (someone else did it),
  without XP; failed, given up or lapsed is never a quest done. A `~` that reads as over on a
  name nothing is tracked by (`~ North Levee Vipers — step: completed`) makes no new record.
- **An offer lapses at its deadline** (since 0.9.19). When a reply's story time passes an
  offer's `due` (a date alone runs to the end of its day, as for a quest's deadline), that reply
  closes it: `- Rat Culling — offer lapsed` is written into its Director block, so deleting or
  swiping the reply takes it back. The note right after it, and only that one, says so once:
  "Lapsed: Rat Culling (Danique's offer) went to someone else; Danique may mention it." It is
  nobody's choice and no quest's outcome: never blocked as a decision only you can make, never
  quest XP. Only offers lapse; a quest taken on keeps its deadline for the story to deal with.
  An offer your messages have spoken of (since 0.9.27) is often the job's own day (*the hunt
  rides out on Goldwane 15*), so it gets two more story days, as a late beat does, and stays
  under **Offered** meanwhile. The Quests tab shows once there is an offer, not only a quest.
- **Kept at the back of the chat** (since 0.9.30). The tracker is the newest checkpoint (one copy of
  it as it stood ten replies back, kept in the chat's metadata, never in a message or the prompt)
  plus the replies after it, so the messages before it can be hidden, summarised away or deleted.
  A checkpoint is taken every ten replies and the newest four are kept; a swipe, edit or delete in
  the last ten replies rolls back as always, and a bigger rollback falls back on an older one (past
  all of them, the tracker is rebuilt from the messages left). Editing a reply older than the
  newest checkpoint no longer changes the tracker. Changing the calendar or the scene tag starts
  the checkpoints over.
- **Hidden replies count** (since 0.9.29). A reply hidden from the model (SillyTavern's hide, or
  an extension such as Summarybook hiding old messages to save context) is still read for its
  Director and scene blocks, so hiding the reply that started a quest never loses the quest.
- **Pay waiting** (since 0.9.28). A quest whose step (or now) is only collecting the pay (*turn
  in voucher at the bailiff hatch on Friday noon*, *collect the bounty from Verna*, *return to
  Verna for payment*) has its work done: its `due` is when the pay can be had, not a deadline. The
  note tells it as *Lone Grey Wolf — pay waiting from Goldwane 14, 12:00 pm (…); the work is done,
  the hour fails nothing*, the Quests tab marks it **pay waiting**, and a `-` that fails it only
  for time (*deadline passed*, *expired*, *too late*) leaves it open. Any other ending still ends it.
- **Verified completion** (since 0.9.43, with RPG Battle 0.5.48 and Story Block 0.9.26).
  Give a quest one explicit target and coin reward, for example:
  `+ quest Wolf bounty — protect the road | giver: Fenna | target: defeat 3 wolves | reward: 1 silver per wolf`.
  Supported targets are `defeat N creature`, `possess N item` and `deliver N item`; use
  `reward: none` for no payment. **Pending** shows progress. **Complete** waits for enough
  unclaimed defeats after acceptance or currently held goods, and for the giver or issuing
  settlement. Eight eligible wolves at 1 silver each pays 8 silver. The click queues the
  turn-in; **Undo complete** is available before generation. The next normal story reply
  receives the exact payout, delivery and completion instruction, and code records omitted
  effects once. Possess keeps goods; deliver removes the required amount. Unsupported terms,
  unavailable proof or changed resources block settlement. Keep the acceptance and battle
  history: old prose is not backfilled, and these quests retain replay history instead of
  making new compacted checkpoints. See [the completion contract](docs/quest-completion/CONTRACTS.md).
- **Finishing a narrative quest:** `- Key — outcome` closes it, and the change instruction says so for
  quests ("done or failed: - it"). Models often write the end another way, so these close it too
  (since 0.9.1), with a note in the Director tab: a `~` whose `step:` or `now:` (a quest's) or
  `status:` / `outcome:` (any record) is just *done*, *completed*, *finished*, *failed*,
  *abandoned*… (alone or before punctuation: `step: completed — Garrow paid`; `step: complete
  the hunt` is still a step; since 0.9.42 also a step that opens with the ending and goes on to
  confirm it, `step: Completed and turned in to Fenna`, or comes with a reward already taken,
  `reward: Claimed 2 gold`, while `step: done tracking, now the den` stays a step), and a `!` on
  a quest that says it was completed, done, turned in, rewarded or failed. A failure closes the quest without counting as done (no quest XP).
- **The story closes narrative quests** (since 0.9.5). When an open quest's own `step` or
  `now` reads as over (*wolf slain, reward collected*, *delivered*, *failed*) but no line closed
  it, the note adds a **Quest check**: "the story may have finished Sheep-killer. If it has,
  close it with - Key — outcome; if not, leave it." Only while the model writes change lines.
- **A quest is finished once.** A later line closing it again (models repeat `- Quest — done`)
  changes nothing (since 0.9.7): it stays finished in the reply that first closed it, so RPG
  Battle's quest XP is never given twice. Reopen a narrative quest with `+ quest …` and it can
  be finished anew; reopening the same verified contract cannot pay it again.
- **Giving up** (since 0.9.6): a failure, never quest XP, however it is written: `failed`,
  `abandoned`, `gave up`, `forfeit`, `quit`, `walked away`, `backed out`, `called off`… When
  **your own message** (only yours since 0.9.15) gives up an open quest in so many words, in a
  sentence naming the quest or its giver ("I give up on the Sheep-killer bounty", "Tell Garrow I
  quit"), the Quest check asks the story to close it: "Ren may be giving up Sheep-killer. If
  they do, close it with - Key — abandoned; if not, leave it." A negation ("I won't give up")
  does not count, and nothing is closed by the message itself.
- **Abandon** (the flag at the end of each open quest's name in the Quests tab, asks twice)
  works behind the scenes, like RPG Battle's fight hand-off (since 0.9.15). The quest shows
  *giving up* and a **Keep** button until your next reply; that reply's note tells the story
  "Ren gives up Wolf Hunt. Show it in this reply, and close each with - Key — abandoned.", and
  the reply records it: the choice is stamped on the message, and `- Key — abandoned` is
  written into its Director block if the story left it out. A swipe of that reply is told again;
  deleting it takes the abandon back. It counts as a failure, so RPG Battle offers no quest XP.
- `due` is the **deadline**: when it is reached, the note says so ("deadline Haywane 30
  reached"), and the story decides what that costs.
- Quests **never go dormant**. A quest untouched for forty replies stays in the note, and its
  giver's name in the scene counts as a mention.
- They have their own **Quests** tab in Story Block's sidebar (it appears with the first
  quest), grouped by type: Main, Side, Bounties, Contracts, Missions, Favours, then your own
  types. Each shows its difficulty, goal, step, giver, reward, deadline and place, marked when the
  deadline is close or has passed; finished quests fold away with how they ended. The badge is
  the number of offers waiting for your answer (since 0.9.39; before, the open quests). Nothing in it is hidden: quests are promises you made, not
  spoilers.

### Encounters

A record with an `encounter` is a planned fight. Story Director stores and schedules it and
hands the foes over; it never resolves a fight. The RPG Battle companion extension does that
in code, with buttons.

```
+ beat Ambush at the weir — on: Haywane 14 | place: Weir road | encounter: 3 bandit, bandit captain (boss)
```

The value is free text in RPG Battle's shape: comma-separated groups of
`[N ×|N x|N ]name[ (boss)][ rank X][ role]`, such as `3 bandit, bandit captain (boss)` or
`2 x dire wolf rank D`. It is kept as written. It usually sits on a `beat`, but a quest (a
bounty's target) or a clock (one that fires as an attack) can carry one too.

- **When it is due** (or arriving), the note's Due line says who is coming: `Due now: Ambush at
  the weir (Haywane 14) (fight: 3 bandit, bandit captain (boss))`, and the Pacing line adds one
  sentence: the fight starts when the scene reaches it, the foes appear, and the reply stops at
  the first blow, because the fight is resolved outside the story. When the reply gets there and
  fires the record (`! Ambush at the weir — the bandits break cover`), RPG Battle offers a
  **Fight?** notice filled in with the foes (since 0.9.18; before, being due was enough). A due
  fight the scene never reaches (your character is elsewhere) is no fight: the story brings it in
  later as news or aftermath, as the Pacing line asks.
- **Before then**, the kind lines show it compactly (`Beats: Ambush at the weir (Haywane 14) ·
  fight: 3 bandit, bandit captain (boss)`), and the Director tab shows an `encounter` row and a
  `fight` tag.
- **Afterwards** the model closes the record the usual way, with `!` or `-` and what happened.
- The **arc planner** may plan one or two per arc, as a `BEAT: … | encounter: …` line (or an
  `ENCOUNTER:` line), only where the story would really come to blows: a quest's target, or an
  ambush an agenda sets up.

## The note

```
[Story Director · CY 611, Goldwane 16, 09:00 am · Auvoth]
Due now: Saartje's sale (Goldwane 16)
Off-screen: Geva — Bailiff Court → files the warrant (Goldwane 17)
World: Canal Street fires — curfew in force
Hooks: River stranger — who pulled Ren from the sump
Clocks: Hollin's Reach graves — the dead rise (Goldwane 28) · shown: sign
Beats — The Weir Debt (who sold the route, and what it costs Ren): Toll riders reach the ford (Goldwane 19)
Do not reveal: who sold the weir route
Pacing: the world keeps its schedule and the scene keeps its flow. …
<how to write changes>
```

**One home for each thing (0.9.3).** The current arc has no line of its own: its name and what it
is about head the **Beats** line, so the arc is carried by its beats, and a beat that comes due
moves to *Due now* like anything else. While Story Director keeps the timeline and writes the
agendas into your World State's **Off-Screen** section (*Mirror Off-Screen*, on by default), the
note leaves its *Off-screen* line out, since that section already shows every agenda; one that
is due or arriving is still on *Due now* or *Arriving*. With Story Block 0.9.5 or later, the
World State itself then leaves out Unresolved Threads, Planted Seeds, Consequence Timers and Arc
Phase: hooks, clocks and the arc are Story Director's, so the model gets them from one place.

**While away** (since 0.9.19). When the story skips ahead (a night's sleep, days on the road)
and the scene's time is 12 hours or more past the reply before it, what came due or arrived in
between is told once, on a line of its own before *Due now*, and not repeated there:

```
While away (Goldwane 12, 08:00 pm → Goldwane 15, 07:00 am): Stray Oar — sacked by the guild (Goldwane 13) · Bond collector reached Hollin's Reach (Goldwane 14) · Bounty on Kettle Jack — deadline Goldwane 14, 11:59 pm passed (bring him in alive). Show what came of them as news, signs or aftermath, not as scenes {{user}} lived through.
```

What was already due before the jump stays on *Due now*, and so does a quest whose deadline is
later the same day. A planned fight in the gap reads *fought off-screen* (RPG Battle offers no
**Fight?** for it, since no reply reached it). Secrets never appear here. While the model writes
the change lines, the line also asks it to record each (`! Key — what came of it`, an arrival
with `~ Key — now:`, a passed deadline with `- Key — failed` or a new `due:`); with capture
writing them, it only asks for the narration. The note's budget never cuts it.

Whenever something is scheduled, a short **Pacing** line says how a schedule meets a scene:
bring a due item in only where it fits (on-screen if your character is there, otherwise later
as news, signs or aftermath), never cut into or bend the current scene for a beat, never decide
what your character does, and let what cannot fit happen off-screen or slip to a later date.

**A beat that slips closes itself** (since 0.9.19). A beat whose date went by without the story
firing it (`!`) would otherwise sit on *Due now* for ever. Once a reply's story time is more
than **2 story days** past the beat's date (a date alone counts to the end of its day, so a
beat on Goldwane 13 slips on Goldwane 16), that reply closes it: `- Guards sack the Stray Oar —
slipped` is written into its Director block, so deleting or swiping the reply takes it back.
The note right after it, and only that one, adds: "Slipped: Guards sack the Stray Oar
(Goldwane 13) — it happened off-screen or not at all; mention it only where it fits." Only
beats slip; events, clocks, agendas and quests keep their dates. A beat fired with parts
(`! Key — … | now: …`) has played out and never slips; give it a new `on` and it can.

**Long parts are trimmed in the note only.** A part runs to at most 12 words for what a record
is doing and when (`now`, `then`, `on`, `due`, `arrive`) and 16 for what it is (`desc`, a
quest's `goal`, `step`, `giver` and `reward`, a fight's foes), then ends in "…" at a word
boundary (before an unclosed bracket, when it can). The tracker keeps every word: the Director
and Quests tabs, the API and the capture and planner calls see the full text, so a long part is
no longer reported as a problem.

Since 0.9.38 it is sent in two parts, so a provider's prompt cache keeps as much of the prompt
as it can (Story Suite's layout). The fixed part (the change instruction, the NPC plans line and
Pacing) goes early, right after the main prompt, and is the same text every reply. The part for
this reply (the header, what is due and arriving, the records, the checks and choices) goes at
the very end, as a system message at depth 0 by default, and is cleared once its reply is in. A
depth left at the old default (1) moves to 0 once; one you set yourself stays.

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
| Travel | Pre-modern | *Pre-modern*: on foot, horse, wagon, boat, in km a day. *Modern*: car, bus, train, ferry, plane, in km an hour (see [Modern travel](#modern-travel)). A world pack says its own era |
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

With **Travel** set to *Modern*, the same estimate counts hours:

```
/route Home to Coast car
Home → Coast ≈ 1250 km NE (≈ 1000 km straight × 1.25) · car 70 km/h · 1 day 8 h (1 night on the way) · arrive …
```

Modern paces without a pack, door to door: foot 5, bike 15, car and motorbike 70, bus 50,
train 90, metro 30, ferry 30, ship 35, plane 750 km an hour, plus boarding (train 15 min,
ferry 30 min, ship 1 h, plane 2 h).

## World packs and travel

A world pack is optional: it adds real roads. It is your map as JSON: places, roads (with km
and a road code), paces per road and mode, and travel rules. Import it under **Settings → Map &
travel → World pack** (file or paste). See [Making a world pack](#making-a-world-pack) for a prompt
that writes one from your lorebook or map. A pack's place coordinates also fill in the place book,
and they **win over the coordinates a reply writes**: the pack is your map, while the model's
numbers drift. When a reply's coordinates for a place differ from the pack's by more than one map
unit, the Places section says so ("the story wrote 70, 104"), and distances and directions use the
pack's. If it brings a calendar, you are asked whether to use it.

**Distances the story talks about** (since 0.9.22). Every note gives how far the places in play
are from where the scene is, by the pack's roads, from the quickest way to the slowest. Places in
play (since 0.9.23), up to six: those your message names (so the reply about to be written already
has them), those the latest reply names, those of open records (a quest's giver, an agenda's road;
never a secret's), then those named in the last ten messages: *Distances from Bluewatch Village: Ninebarge Crossing 22–40 days (boat to
foot) · Auvoth 2.5–5 days (riding to wagon).* When the reply itself said a time far off the map
("three days downstream"), the line adds *not three days* and asks the story to keep to the map
the next time the trip comes up. A time counts as off when it is under half the quickest trip or
over twice the slowest. Your own message is never corrected, and nothing is written into the reply,
so a swipe or delete leaves no trace.

**Checked the moment a reply arrives** (since 0.9.24). A reply that says a time far off the map
gets a warning straight away, before you write anything: *“three days” to Ledgerford: by the map
it is 18–33 days (ride to wagon) from Bluewatch Village; by boat, 21.* The same warning stays under
**Director tab → Problems → Warnings** for as long as the latest reply carries the figure, with
the same button, after a reload too (since 0.9.25), and no Reveal is needed. The **Fix** button puts the map's figure into the reply's text in place
of the story's (*twenty-one days downstream*), using the way the sentence names (downstream, on
foot, a day's ride) or else the quickest. Nothing in the reply changes unless you press it, and a
swipe or regenerate brings a fresh reply that is checked the same way.

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

### Modern travel

For a story set now (or in the last century or so), a pack with `"era": "modern"` (or paces
under `pace_km_per_hour`) travels by modern roads and transport. Everything above works the
same, with these differences:

- **Times are hours.** Each road rounds up to the quarter hour (`round_edge_up_to_hours`), and
  the result reads like a clock: `45 min`, `2 h 15 min`, `1 day 3 h`.
- **Nights on long drives:** whoever drives, rides or walks (car, motorbike, bike, foot) stops
  for the night after 10 hours on the road (`drive_hours_per_day`). Trains, buses, ferries,
  ships and planes go on.
- **Boarding:** a train waits 15 minutes, high-speed rail and ferries 30, ships an hour, a
  flight 2 hours (check-in and security). A pack sets its own with `"board_hours"` in a code's
  paces.
- **Getting to the station:** a trip by train, plane, ferry, bus or metro reaches its station
  by a short taxi ride or walk (roads up to 60 km), shown as `(car)` in the route. Driving
  trips drive the whole way.
- **Fastest, not shortest:** routes take the quickest way, so a motorway's detour or a flight
  beats a slower direct road.

| Code | Road | Modes (km an hour) |
|---|---|---|
| `MW` | motorway or highway | car 100, motorbike 100, bus 80 |
| `RD` | road | car 60, motorbike 60, bus 45, bike 18, foot 5 |
| `ST` | city streets | car 25, motorbike 25, bus 18, bike 15, foot 5 |
| `OR` | off-road or dirt track | car 30, motorbike 30, bike 10, foot 4 |
| `TR` | trail or footpath | bike 12, foot 4 |
| `RL` | railway | train 90 |
| `HS` | high-speed rail | train 250 |
| `MT` | metro, subway or tram | metro 30 |
| `FY` | ferry | ferry 30 (cars and people aboard) |
| `SL` | sea lane | ship 35 |
| `AR` | air route | plane 750 |

A mode a code does not list cannot use it: no bikes on the motorway, no cars on a footpath.
A pack's `pace_km_per_hour` changes any of these (`"MW": { "car": 120 }`), takes a mode off a
code (`"bus": null`), or adds codes of its own, one to three capital letters
(`"MAG": { "train": 400, "board_hours": 0.5 }`). The model can write the modes as it likes
(`drive`, `taxi`, `cycling`, `subway`, `fly`). Legs read and are corrected in hours:

```
leg: Home → Downtown 14 ST, car 30/h → 0.5 h
/route Downtown to North City plane
Downtown → Airport 25 MW (car) → North City 920 AR = 945 km · plane 750 km/h · 2 h boarding · 3 h 30 min · arrive …
```

Arrivals are checked to the quarter hour, or a tenth of the trip when that is more.

### Making a world pack

You do not need to write the JSON by hand. Give a model your world, and the prompt below has it
write the pack; then import it and read the notes the import gives back.

**What to give it:** whatever you have of your map, such as a lorebook's places and travel
times, a description of the regions, or the place names and coordinates your preset already
writes in the scene's location (`Auvoth | Terrace | [59.0, 110.0]`). For a map image, describe it
or let a model that reads images look at it. The more distances and directions you give it, the
less it has to invent.

**What it must get right** (the import checks the first four and lists what is wrong):

- **Every road's two places are in `places`**, spelled the same.
- **Roads join neighbours only:** one road per stretch between two places, never a long trip
  through other places as one road. Routes are found by chaining roads.
- **`km` is the road's length** and never shorter than the straight line between its places
  (coordinates × `scale_km_per_unit`); roads wind, so 1.1 to 1.4 × the straight line is normal.
- **`y` grows to the north** (a chart). If the coordinates come from an image, where y grows
  downwards, keep them and set **North is** to *Down* after importing; a pack whose `bearing`s
  fit that gets one note saying so.
- **Every road code it uses has a pace** in `pace_km_per_day` (at least `R`; codes without land
  paces go at the `R` pace). A modern pack needs none: the [built-in codes](#modern-travel)
  have theirs.

| Code | Road | Code | Road |
|---|---|---|---|
| `R` | maintained road | `W` | river or canal (boats; levee roads also on foot) |
| `B` | bastion road | `S` | sea (ships) |
| `F` | frontier road | `D` | deep sea (`vessel` pace) |
| `C` | caravan | `A` | aerial (`flight` pace) |
| `L` | local | `T` | trail |
| `G` | dungeon approach | `M` | mountain |
| `X` | seasonal or expedition | `U` | tunnel |
| | | `H` | hidden |

A pace is km a day: a number, a range `[low, high]`, `"foot"` (riders go at foot pace there) or
`null` (that mode cannot use the road; wagons stay off trails and mountains this way).

The codes below are the pre-modern ones; a modern pack uses [its own](#modern-travel).

**The prompt** (paste it into any capable model, followed by your material):

````text
You are converting a fictional world into a world pack: one JSON object, and nothing else
(no comments, no code fence, no explanation). Use only what the material below says or clearly
implies; where you must invent a distance or position, keep it consistent with the rest.

Shape:
{
  "source": "<world name>",
  "scale_km_per_unit": <km per coordinate unit, e.g. 10>,
  "pace_km_per_day": {
    "R": { "foot": 20, "ride": 35, "wagon": 18 },
    "F": { "foot": 16, "ride": 28, "wagon": 14 },
    "T": { "foot": [14, 22], "ride": "foot", "wagon": null },
    "M": { "foot": [10, 15], "ride": "foot", "wagon": null },
    "W": { "boat": [30, 45], "upstream": [20, 30], "downstream_favorable": [50, 60] },
    "S": { "ship": 110 }
  },
  "courier_multiplier": 2,
  "travel_rules": { "round_edge_up_to_days": 0.5, "rest_day_every_active_days": 6, "crewed_water_rest_days": false },
  "places": {
    "<Place name>": { "x": <number>, "y": <number>, "region": "<region>" }
  },
  "edges": [
    { "a": "<Place>", "b": "<Place>", "km": <number>, "code": "<road code>", "corridor": "<road or river name, or null>", "bearing": "<compass of b from a>/<compass of a from b>" }
  ]
}

Rules:
- Places: every town, village, fort, crossing, camp and landmark a traveller stops at. Names
  exactly as the material spells them. One coordinate system for all; y grows to the NORTH, x to
  the east. The coordinate distance between two places × scale_km_per_unit is the straight-line
  distance in km.
- Edges: only between neighbouring places, one edge per stretch of road, river or sea lane.
  A trip that passes through a place is two edges. Both ends must be in "places".
- km: the length of that stretch, 1.1 to 1.4 × the straight-line distance (never less).
- bearing: an 8-point compass pair, e.g. "SW/NE" when b lies south-west of a. It must match the
  coordinates.
- code: R maintained road, B bastion road, F frontier road, C caravan, L local, G dungeon
  approach, X seasonal or expedition, T trail, M mountain, U tunnel, H hidden, W river or canal,
  S sea, D deep sea, A aerial. Every code you use needs an entry in pace_km_per_day (W, S, D, A
  use boat/upstream/downstream_favorable, ship, vessel and flight).
- Paces are km per day: a number, [low, high], "foot" (that mode goes at foot pace) or null
  (that mode cannot use it). Adjust the example paces to the world.
- Optional: "calendar": { "era": "<era>", "days_per_month": 30, "months": ["<month>", ...] }
  when the material names its months; "levee_roads" / "no_levee" in travel_rules for rivers
  with or without a towpath road.

Before answering, check every edge: both places exist, km ≥ straight-line distance, and the
bearing agrees with the coordinates.

Material:
````

**For a modern world**, use this prompt instead:

````text
You are converting a modern-day setting (real or fictional) into a world pack: one JSON
object, and nothing else (no comments, no code fence, no explanation). Use only what the
material below says or clearly implies; where you must invent a distance or position, keep it
consistent with the rest. For real places, use their real distances.

Shape:
{
  "source": "<setting name>",
  "era": "modern",
  "scale_km_per_unit": <km per coordinate unit, e.g. 1>,
  "travel_rules": { "round_edge_up_to_hours": 0.25, "drive_hours_per_day": 10 },
  "places": {
    "<Place name>": { "x": <number>, "y": <number>, "region": "<city, district or region>" }
  },
  "edges": [
    { "a": "<Place>", "b": "<Place>", "km": <number>, "code": "<road code>", "corridor": "<road, line or route name, or null>", "bearing": "<compass of b from a>/<compass of a from b>" }
  ]
}

Rules:
- Places: homes, neighbourhoods, towns, stations, airports, ports, landmarks and anywhere a
  trip starts, ends or changes. Names exactly as the material spells them. One coordinate
  system for all; y grows to the NORTH, x to the east. The coordinate distance between two
  places × scale_km_per_unit is the straight-line distance in km.
- Edges: only between neighbouring places, one edge per stretch. Two places joined by a road
  and a railway get two edges. Airports join by air routes (AR), stations by rail (RL, HS),
  ports by ferry (FY) or sea lanes (SL); give each station, airport and port a short road
  (ST or RD) to the place it serves. Both ends must be in "places".
- km: the length of that stretch, 1.1 to 1.4 × the straight-line distance for roads and rail
  (never less); air and sea routes about the straight line.
- bearing: an 8-point compass pair, e.g. "SW/NE" when b lies south-west of a. It must match the
  coordinates.
- code: MW motorway or highway, RD road, ST city streets, OR off-road or dirt track, TR trail or
  footpath, RL railway, HS high-speed rail, MT metro, subway or tram, FY ferry, SL sea lane,
  AR air route.
- Only if the setting needs other speeds: "pace_km_per_hour": { "<code>": { "<mode>": <km an
  hour> } } with modes foot, bike, car, motorbike, bus, train, metro, ferry, ship, plane
  (null takes a mode off a code); "board_hours" in a code sets its boarding time.
- Optional: "calendar": { "preset": "gregorian" } for real dates.

Before answering, check every edge: both places exist, km ≥ straight-line distance for roads
and rail, and the bearing agrees with the coordinates.

Material:
````

**After importing**, the message lists notes such as `Bluewatch Village – Hollin's Reach is 40
km, but the places are 85 km apart in a straight line` or `… says Hollin's Reach lies E of
Bluewatch Village, but the coordinates put it SW`. Fix those in the JSON (or ask the model to)
and import again. Then try `/route` between two places you know, and look at the map in the
Places section: if it is upside down, change **North is**.

## Arc planning

Tracking and the note happen every reply, in code. **Planning is one model call per arc.**

- **When:** *Manual* (the **Plan arc** / **End arc** buttons in the Director tab), or
  *Automatic*: when there is no arc yet, when every beat of the arc has played out, when no
  beat is due within the stall window (7 story days by default), or when the story is
  **running low** (since 0.9.19): fewer than 3 threads open (*Running low at*; 0 turns it off),
  counting active hooks, clocks and the arc's beats still to play. Offers of work are not
  counted, since they wait for you to take them; nor are quests (yours), agendas, events or
  secrets. After a plan is asked for, running low waits 5 replies before asking again, so a
  plan you discarded is not asked for every reply. The buttons work in both.
- **Model:** *Same as chat*, or any SillyTavern **connection profile** (its own API and model; a
  cheaper or faster one is fine). A missing profile fails with a message; it never falls back
  to another model.
- **What the planner reads:** the last messages (60 by default), the tracker, the current time
  and place, nearby places (with a world pack), your **genre and tone**, your **Director's
  note** (a goal, a pace, a beat you want) and the previous arc.
- **What it writes:** an arc, 3–6 dated beats, an agenda for each NPC the arc moves, hooks,
  clocks, and a secret for every secret it creates. At most one or two beats are fights (with
  an `encounter`; see [Encounters](#encounters)). Relative dates ("in 2 days", "tomorrow at
  dusk") become dates in your calendar. Plans that act for your character are flagged.
- **While it runs** a notice stays up ("Planning the next arc… on *profile*") until the plan is
  ready; a failure (the API refused, the answer was unusable) says why in a red notice.
- **Beats leave room:** the planner is told that a beat's date is when the world acts, not an
  appointment for your character. Every beat must work whether or not you are there, and may
  slip; the note's Pacing line tells the storyteller the same every reply. One left unplayed
  more than two story days past its date is closed as slipped (since 0.9.19; see
  [The note](#the-note)).
- **Every beat reaches you** (since 0.9.19): each `BEAT` line carries a `reach:` part, how the
  beat touches your character if they are somewhere else: a price, a door shut or opened,
  someone's mood, a danger or an opening. It is the world's side only; what you do about it
  stays yours.

  ```
  BEAT: Guards sack the Stray Oar — drunken convoy guards wreck the taproom | on: Goldwane 13, 10:30 pm | place: Stray Oar, Bluewatch Village | reach: the inn shuts for repairs; Marrit is out of work and asks Wessel for a charter
  ```

  It becomes a `reach` field on the beat (the Director tab shows it as a row). When the beat is
  due, the note's Due line adds it, so a story that is elsewhere still has concrete aftermath to
  show: `Due now: Guards sack the Stray Oar (Goldwane 13, 10:30 pm) · reach: the inn shuts for
  repairs; …` (16 words at most in the note). A beat still ahead keeps its reach off the Beats
  line: the note stays short, and the story is not handed the aftermath before it happens. A
  model can write or change one like any field (`~ Key — reach: …`).
- **Review:** the plan waits in the Director tab as editable change lines; **Accept** writes them
  into the latest reply (deleting that reply undoes the plan), **Discard** drops it, **Plan
  again** asks for another. Turn on *Use plans without review* to skip this.
- **The Director's note is used once:** when the arc it shaped is accepted (by you or without
  review), the note is cleared, so a goal you forgot about cannot steer later arcs. Discarding
  the plan keeps it, and so does editing the note while the plan waits. Turn on *Keep the note
  for every plan* to keep it for good.

From then on the arc's name heads the note's Beats line with its next beats, and its secrets
are kept under "Do not reveal". The planning prompt is editable (with reset); its macros are
`{{recent}}`, `{{tracker}}`, `{{now}}`, `{{place}}`, `{{nearby}}`, `{{note}}`, `{{genre}}`,
`{{previous_arc}}`, `{{user}}` and `{{char}}`.

### Arc planning in v2

The v1 rules above hold, in v2's shape (Story Block v2, the Director tab):

- **Plan arc** and **End arc** are on the Director tab's Arc panel. They, and Accept, Discard and Plan
  again, are your controls for planning, not story actions. The planner is one call through Story
  Block's model call (`sdk.callModel`), on **Arc planning: Planner connection** (a Connection Manager
  profile, or Same as chat); it never posts to the chat. While it runs the panel says "Planning the next
  arc…" with **Cancel**.
- **Read strictly, numbers by code.** Only the plan's labelled lines are read (ARC, BEAT, AGENDA, HOOK,
  CLOCK, SECRET; ENCOUNTER is a beat with foes), each kind only with its own parts. A plan keeps at most 6
  beats, 6 agendas, 3 hooks, 2 clocks, 4 secrets and 16 items in all, and at most 2 fights; names and texts
  are cut and cleaned of markup. Relative dates ("in 2 days", "tomorrow at dusk") are written on your
  calendar by code; a date that is past or unreadable is left out. Rewards, XP, ranks and amounts are never
  part of a plan. Without a module that runs fights (Story Director alone: a dating sim, a mystery) the
  planner is asked for no fights and a planned fight stays a beat without foes. The review lists what code
  left out or changed.
- **Review.** The plan waits on the panel as text you may edit; Accept reads your text again the same
  strict way. With behind the scenes hidden it says only "A new arc plan is waiting" with **Accept without
  reading**, **Review** (reveals) and **Discard**. *Use a plan without review* skips this. The waiting plan
  is yours, kept per chat in this browser: a swipe does not throw it away.
- **Accepted** (commands `director.arc.accept`, then `director.arc.update` for each item naming a thread
  already tracked): an arc record and the plan's threads, each tagged with the arc, made by the tracker's
  own rules, on the latest reply like any action of yours. Swiping or deleting that reply takes the plan
  back; deleting a reply in the middle takes back only what it made (a change to a thread it made goes with
  it, the rest of the plan stays). The tail carries "Arc: Name — what it is about" while it runs; the fixed
  prompt is unchanged.
- **By itself** (*When to plan: By itself*): after a reply, when the story tracks something and has no arc,
  when every beat of the arc played out (the arc is ended first), when no beat is due within *Stalled after
  story days* (7), or when open threads run low (*Running low below*, 3; after 5 replies since the last ask).
  Never while a plan waits.
- **Settings** (Story Director → Arc planning): planner connection, when to plan, use without review, genre
  and tone, Director's note (used for one arc: once an arc planned with it is accepted it is left out until
  you change it, unless *Keep the note for every plan*), messages the planner reads (40), longest plan
  (tokens), stall days, running low. The planner prompt is under **More**, with **Reset**; its macros are
  `{{genre}}`, `{{now}}`, `{{place}}`, `{{note}}`, `{{previous_arc}}`, `{{tracker}}`, `{{recent}}`,
  `{{fights}}`, `{{user}}` and `{{char}}`.
- Turn the feature **Arc planning** off (Features) and nothing of it is drawn, asked or sent; arcs already
  accepted stay, and their threads stay the Director's.

### Behind the scenes in v2

The Director tab shows quests, hooks and world events openly. Agendas, planned beats, clocks and secrets
(and the problems about them) are behind a **Reveal** panel that shows only how many there are; nothing of
them is put on the page until you reveal it. The choice is per chat and remembered in this browser (a
swipe or a reload does not hide it again); **Hide** hides it again. The status card under each reply then
names no agenda, beat or clock as *Next*. The story's prompt gets all of it either way. Turn hiding off for
every chat with **Behind the scenes: Hide agendas, planned beats, clocks and secrets until you press
Reveal**.

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
that are not tracked are dropped (unless the key plainly means one tracked record, as above;
capture never adds a record from a `~`), and capture never starts an arc. Its lines are
written into the reply like the model's own, so swipes and edits behave the same.

## Coming from World State Alpha

**Settings → Existing chat → Import from World State Alpha** takes an exported World State
Alpha bundle. Its active facts and developments become **World** records (developments keep
their trend; facts are marked settled and fold away in the tab), keyed by the first words of their summary, with their
anchors as the names to watch for. Resolved and superseded records stay behind. Turn World
State Alpha off afterwards; the two would inject overlapping notes.

## Settings

The panel (Extensions → Story Director) has the Story Suite's shared look, the same as the other
story extensions': a quick bar (the **Track the story** and **Hide behind the scenes**
switches, shown as Enabled/Disabled, then **Plan arc** and **Seed from World State**) and
folding sections, each with a one-line summary of what it is set to: Tracking & note,
Calendar, Map & travel, Arc planning, Capture, and Existing chat & compatibility. They start
closed; the ones you open are remembered in this browser.

| Setting | Default | |
|---|---|---|
| Tracking | on | Off: no note, no checks |
| Scene block | `World_State` | Where the time and place are read |
| Depth | 0 | Chat depth of the note's part for this reply (the fixed part goes after the main prompt) |
| Budget | 1000 tokens | Most the note may use; lowest-priority records drop first |
| Dormant after | 15 replies or 30 story days unseen | Left out of the note until mentioned again |
| Due soon | 3 days | Anything due this soon is never dormant |
| Calendar | Gregorian | Or your own months and era, and optionally a week of your own day names with the day the story is on (the note's header then shows today's weekday; Gregorian shows the real one) |
| Mirror Off-Screen | on | Writes active agendas into the scene block's Off-Screen section, for readers who keep that section in Story Block's World State (once tracking has started). The story's own lines for people with no agenda stay after them (since 0.9.26); a closed agenda's line goes. Since 0.9.31 each agenda is one short line, *Courier — rides south from Shorn; arrives Haywane 13, morning; next: delivers the writ*, without the travel leg's arithmetic, which stays in the tracker and the Director tab |
| Source of truth | Automatic | Calendar, timeline and NPCs: who keeps each when other story extensions are installed (see [Working with the other story extensions](#working-with-the-other-story-extensions)) |
| Map | north up, east right, 1 km per unit, roads × 1.25 | How the scene's coordinates read (see Places and the map) |
| World pack | none | Optional roads: places, edges, paces and travel rules, as JSON |
| Arc planning | manual, same as chat | When to plan, which model, how much chat it reads, answer length, stall window, running low, review, genre and tone, Director's note (used once, or kept), prompt |
| Capture | off | Off, when a reply has no `<Director>` block, or always; its model and answer length |

## The Director tab

What is due and arriving, every active record by kind except quests (they have their own
tab; pin a record to keep it in the note), the
arc and its beats, the dormant shelf, secrets, what was resolved recently, problems with the
last reply's changes, the places the story has been (with a map when there are coordinates),
and the route tool.

**Problems** with the last reply's changes are listed by severity: errors and warnings (a
missed date, a line on a key that is not tracked, a travel leg that does not add up) stay in
view; harmless **notes** (a key read as a near one, a record added from a `~`, something still
due, a date written in prose) fold into one closed **Notes** fold with their count. Only
warnings and errors raise the toast after a reply.

**Settled** records (World State Alpha's facts, or any record with `settled: yes`) are true
and going nowhere, so each section folds them into a closed **Settled** fold after its live
records. Folds you open stay open while you play; only *Do not reveal* closes again.

**It starts hidden.** The tracker is the story behind the scenes, so by default the tab shows
only the time and place, counts and what you can do (plan or end an arc, accept a waiting plan
without reading it, seed, route). **Reveal** opens it for that chat until you **Hide** it again
or reload; hidden text is not put on the page at all. Problems and notes show while hidden
(since 0.9.17), except those about an agenda, a planned beat, a clock or a secret: those are
counted on the lock (*2 problems behind the scenes*). Turn this off with **Hide behind the
scenes** in the settings' quick bar.

## The Journal tab

*Since 0.9.19.* A recap for coming back to a chat after a break: what your character saw and
heard, grouped by story day (as your calendar writes it), newest first. The last week of
story days is open; older ones fold under **Earlier days**. Since 0.9.39, once it holds more
than 15 entries a **search box** sits on top: it filters as you type by name, what happened,
giver or date (case and accents don't matter: *cafe* finds *Café*), shows *N of M*, opens
every day that matches (folded ones too) and says so when nothing does. Esc or the box's ✕
clears it; in the drawer or bottom sheet Esc closes the panel, as everywhere in it.

- **What happened**: a beat, event, hook or clock the story fired (`! Key — what happened`),
  with that line's own words; an event or hook the story closed, with its reason; a sign the
  story showed (`shown:`) of an event or hook.
- **Quests**: taken on (with the goal and giver as they were then), their `!` moments, and
  done, failed or abandoned.
- **Places**: each place on the day of its first visit, from the scene block's location.

It never shows what is still behind the scenes, so it needs no Reveal: no agendas (an NPC's
plans, and what they did off-screen), no secrets, no arc, no beat or clock that has not fired
(a beat closed without firing was a plan dropped), no `then:`, `on:` or `now:` from any line,
and no job only offered or turned down. People met are not listed yet.

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

## Working with the other story extensions

Story Director works alone. With Story Block, NPC State Delta or RPG Battle installed too, the
extensions find each other through the **Story Suite** handshake
([docs/STORY_SUITE.md](docs/STORY_SUITE.md)) and agree who is the source of truth for each
area, so the model is not told the same thing twice.

- While it tracks the story (the switch on, Story Block there), Story Director offers the
  **calendar**, the **timeline** (agendas, quests, clocks, arcs) and **NPCs**, and shares the
  same object as `globalThis.StoryDirector` (below). Turning tracking off stops it offering
  anything; it stays listed as switched off, so Story Suite can turn it back on.
- **NPCs** are NPC State Delta's while it is installed and on: it keeps who each NPC is.
  Story Director's agenda lines then give only what an NPC plans and when; one short line in
  the note, in the planner's request and in the capture call asks for that.
- **Calendar and timeline** are Story Director's on Automatic. NPC State Delta then uses its
  months and era (`calendar()`) instead of its own.
- **Settings → Existing chat & compatibility → Source of truth** has a choice per area:
  *Automatic* (the suite's order), *This extension*, or *The other one*. *The other one* stops
  Story Director offering that area to the others (it still reads dates with its own
  calendar); for the timeline it also stops the Off-Screen mirror while another extension
  keeps it. With no other story extension installed, every choice works like Automatic, and
  nothing changes.
- **Story Suite overlay:** with Story Block 0.9 or later and another story extension installed, *Manage
  all in Story Suite* (on top of the settings) opens one overlay for all of them, with this
  panel as a tab and one Source of truth table
  ([One place to manage them all](docs/STORY_SUITE.md#one-place-to-manage-them-all)). The
  overlay can also show what Story Director adds to your next reply (`api.manage.tokens()`):
  the note as it would be sent now, per section, at about 4 characters a token, plus about 60
  tokens of output for the `<Director>` lines it asks for (none when capture writes them on
  *always*). Planner and capture calls are separate quiet calls and are not counted.

## For other extensions

`globalThis.StoryDirector` (`apiVersion: 1`) is read-only, and is also what Story Director
shares through the Story Suite (`StorySuite.api('story-director')`):

- `calendar()`: the reader's calendar, `{ era, months: [{ name, days }] }` (plain copies; the
  Gregorian months until a calendar is set):

  ```js
  { era: 'CY', months: [{ name: 'Dawnwane', days: 30 }, { name: 'Haywane', days: 31 }, …] }
  ```

- `timeAt(index)`: the story time known at message `index`, in minutes on your calendar, or
  `null` when no scene block has stated one yet.
- `formatTime(abs)`: such a time written the way your calendar writes it.
- `encountersAt(index)`: the planned fights the story has reached at message `index`, read the
  way the note reads the scene there. Due (or arriving) ones come first, then those whose date
  falls within the due-soon window (3 story days by default):

  ```js
  [
      { key: 'Ambush at the weir', id: 'ambush at the weir', kind: 'beat',
        encounter: '3 bandit, bandit captain (boss)', place: 'Weir road', on: 'Haywane 14', status: 'due', reached: true },
      { key: 'Wolves on the ridge', id: 'wolves on the ridge', kind: 'beat',
        encounter: '2 x dire wolf rank D', place: '', on: 'Haywane 16', status: 'soon', reached: false },
  ]
  ```

  `reached` (since 0.9.18) is true when the reply at `index` fired the record (`! Key — …`):
  the scene got to the fight. A fight fired there is listed even though firing cleared its date.

  It returns `[]` when there are none, or when anything goes wrong. There is nothing to report
  back: the model closes the record with `!` or `-` when it narrates the outcome.
- `questsDoneAt(index)`: the quests the assistant reply at message `index` finished (a `-` line
  in that reply closed them, not as failed, abandoned, expired or superseded); quests finished
  in earlier replies are not listed, so a swipe is read afresh. `difficulty` is always one of
  `easy`, `normal`, `hard`, `nightmare`:

  ```js
  [
      { id: 'bounty on kettle jack', name: 'Bounty on Kettle Jack', type: 'bounty',
        difficulty: 'hard', reward: '40 crowns', giver: 'Warden Hale' },
  ]
  ```

  Plain copies; `[]` when there are none, while tracking is off, or when anything goes wrong.

RPG Battle uses it to give back HP and MP as story time passes, to offer the fights the story
has planned, and to offer XP for a finished quest.

## Development

Plain ES modules, no dependencies, Node.js 24:

```sh
npm run check   # syntax check of index.js and src/
npm test        # node:test suites
```

## License

GPL-3.0.

## Credits

With thanks to [Arif-salah](https://github.com/Arif-salah).
