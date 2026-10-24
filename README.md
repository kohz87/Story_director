# Story Director 2.0.0-beta.2

> This is the **`v2` branch**: Story Suite v2, first beta. It is for test play, not for your real campaigns yet.
> Story Director 1 is on the [`main` branch](https://github.com/kohz87/Story_director/tree/main).

## What it is

Story Director is the story's memory and clock. It keeps the calendar and the time, the quests you take on, the
threads the narrator is steering (events, hooks, clocks, secrets), a map, a journal of each story day, and the
**World** screen that shows only what your character knows. It can also plan the story's next arc and keep it
hidden until you ask.

It is a module of [Story Block](https://github.com/kohz87/Story_block), the host of Story Suite v2. It needs no
fights or stats, so it works without [RPG Battle](https://github.com/kohz87/rpg_battle) (a mystery or a dating
sim), and it shows more with [NPC State Delta](https://github.com/kohz87/npc_state_delta).

## Install

1. SillyTavern **1.19 or newer**; try the beta in a separate profile.
2. Install **Story Block first** from `https://github.com/kohz87/Story_block`, branch **`v2`**.
3. **Extensions → Install extension**, paste `https://github.com/kohz87/Story_director`, choose the branch
   **`v2`**, reload.

Needs (`requires`): Story Block **2.0.0-beta.2 or later** (arc planning's model call needs it too). Works with, but
does not need, RPG Battle (quest ranks follow its rank ladder; quest fights) and NPC State Delta (the people on the
World screen). Update Story Block before Story Director. Install help:
[guide, Installing](https://github.com/kohz87/Story_block/blob/v2/docs/v2/GUIDE.md#installing).

## What you get

Switches are in **Settings → Features**. "No switch" means it is always on.

- **Quests** (Quests tab, no switch): say you take a job and the story writes it down; it is under way at once.
  The row shows progress and where it stands (Not yet, Ready, Ready to turn in). There are no quest buttons; you
  turn in by telling the story.
- **Turn-ins settle in the same reply:** a turn-in the story writes is checked where the reply ends up (after its
  `~ place` and `+ present` lines) and paid in that reply, once, even after a Continue. Safeguards:
  a tail line "Ready to turn in: Name (to giver, at place)", an automatic turn-in when the goal is met, you are at
  the giver and the reply shows it was handed in (a reward coin or item counts), and no double pay when the story
  also wrote the coin. **Settings → Quests → Story's-word turn-ins per reply** (1-5, default 1) limits goals code
  cannot count.
- **The coin words rule:** a reward in a coin the chat does not know ("40 silver" where money is pennies) is not
  paid by code. The row keeps the story's words, and a Problem names the chat's money. Rewards are shown in
  Story Block's coin words.
- **A reward in an unknown coin is owed, not lost:** if the quest is turned in anyway ("30 copper bits" with no
  such coin), it closes as usual and the reward is kept as **owed**. The quest card (Quests screen, the quest's
  details and the done list) says "Reward owed: 30 copper bits (add copper bits in Settings → Coins)" and the Problem
  is worded as owed. Once Story Block's coins count the word (your **Settings → Coins**, or a pack's), the next reply
  that has story lines pays it automatically, once, and the reply after is told ("Elula's 30 copper bits for
  Sluice-Rat Bounty are paid"). Code prices it as any reward (held to the quest's rank, within the reply's story
  money; what does not fit stays owed for the next reply) and never at a guessed rate: without Coins it stays owed.
  If the story also writes the `+ coin` for it in that reply, the coin counts as the reward and nothing is paid on
  top. Swipe, delete, Re-read and reload keep it right (deleting the reply that paid puts it back to owed).
- **World** (tab; `story-director.world`, on): **Now** shows the place (its kind and region, marked when the last
  reply moved you there), the story time and **who is here**: with NPC State Delta each person is its own card,
  with their Inner chatter thought inside it; without Delta, a name. It follows the story with no tab switch. Then
  the news, events and factions you know of, and what is coming in 30 story days.
- **Journal** (inside World; `story-director.digest` *Day digest*, on): one entry per story day, written by
  code from what happened.
- **The Director note shows what can happen now** (no switch): the model is told the threads tied to this place or
  to someone here, those due soon, and what your message names; the rest is one line "Elsewhere, not in this scene"
  (**Calendar → Threads elsewhere named in the note**, default 2). Only threads your character knows of.
- **NPC initiative** (`story-director.initiative`, on): before a reply, code may pick one person here with an open
  thread to take the first step; the note names them. **Calendar → NPC initiative: replies before the same person
  again** (default 2).
- **Weather from the calendar** (`story-director.weather`, on): each story day gets weather from the season and
  region (a pack may bring its own table), shown on Scene, Home, the Status card and, where World takes the
  Scene's place in the panel, on World → Now → Here. A `~ weather` line the story writes wins for that day and place.
- **Status card** (folded, under each reply): the place with its map coordinates when the atlas knows it, and the
  weather. It never shows the next planned beat, so it cannot spoil.
- **Arc planning** (Director tab; `story-director.arc`, on): **Plan arc** asks a planner model for the next arc;
  you read it, then **Accept**, **Plan again** or **Discard**. People's plans, beats, clocks and secrets stay
  hidden until **Reveal**. Settings: *Arc planning: Planner connection*, *When to plan*, *Accept planned arcs
  automatically* (off).
- **Map** (tab): places and routes, and travel between them. **Chronicle** (tab): the world events under way and the
  factions, each editable. The calendar and the story time are set under **Calendar** and **Time**.

## How a turn works

The model writes the story and ends it with a hidden `<Changes>` list. Story Director's lines look like this:

```
<Changes>
- quest Sluice-Rat Bounty — turned in
~ place Bluewatch Village, Guild Office | kind: settlement
+ present Elula
~ weather cold drizzle, low fog
</Changes>
```

Code reads each line as a suggestion: it checks the quest's goal and the place, pays the reward once within the
reply's money budget, moves the clock by a capped step and skips anything that does not fit (listed under
**Problems**). Swipe, delete, Re-read and reload stay correct because the state is kept with each reply. Details:
Story Block's [GUIDE](https://github.com/kohz87/Story_block/blob/v2/docs/v2/GUIDE.md) (Quests, The World screen,
Arc planning) and [SPEC](https://github.com/kohz87/Story_block/blob/v2/docs/v2/SPEC.md).

## Settings

Story Suite settings (the **Settings** button on the Story Suite bar) → the **Story Director** fold, in groups.

| Setting | Group | Default |
|---|---|---|
| Calendar, Era, Months, Leap years, Weekdays | Calendar | Gregorian, or the pack's |
| Longest time jump (story days) | Calendar | 30 |
| Threads elsewhere named in the note | Calendar | 2 |
| While away recap after a jump of (story hours) | Time | 6 |
| Day digest: whole days kept / days kept in all | Chronicle | 14 / 120 |
| Story's-word turn-ins per reply | Quests | 1 |
| Quest ranks follow the rank ladder | Quests | on |
| Behind the scenes: hide until Reveal | General | on |
| Arc planning: Planner connection, When to plan | Arc planning | chat's connection, when I press Plan arc |

## With the other extensions

- **Story Block alone:** all of the above works; the people on World are names.
- **With RPG Battle:** quest ranks and rewards follow your Terms ladder, kill quests bring quest-sized fights.
- **With NPC State Delta:** World → Now → Here draws its cards, and the note and initiative know who is near.

## Known issues in this beta

- **Turn-in, then leaving the giver in the same reply.** If a turn-in line is followed by a later line in the same
  reply that moves you away from the giver, the quest is still paid. Without a later Director line, the payment can
  arrive at the next request, and the row says so.
- Story Block's **Changed this reply** card does not yet show a payout made by this same-reply step or the
  calendar's weather change; the Quests row and the wallet are right.
- In a chat saved before this update, a quest Finish click can still be paid twice on Re-read of that reply.
- The Story Suite look: Quests, Director, World, the status card, the HUD, the Map and Chronicle are on the glass; the arc prompt editor in the Settings window (`arc/settings.js`) still uses SillyTavern's button, and NPC State Delta draws its own cards.

The full list is in Story Block's [RELEASES](https://github.com/kohz87/Story_block/blob/v2/docs/v2/RELEASES.md).

## Links

- [Player guide](https://github.com/kohz87/Story_block/blob/v2/docs/v2/GUIDE.md), [Changelog](CHANGELOG.md),
  [Releases and known issues](https://github.com/kohz87/Story_block/blob/v2/docs/v2/RELEASES.md)
- Developers: [docs/dev](docs/dev/), [DESIGN](docs/DESIGN.md), [ARCHITECTURE](docs/ARCHITECTURE.md), [CLAUDE.md](CLAUDE.md)
- History, decisions and the after-beta list: `suite-notes/` in
  [kohz87/inventory-block](https://github.com/kohz87/inventory-block/tree/claude/hopeful-babbage-tipaw8/suite-notes)
