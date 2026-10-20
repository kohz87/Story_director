# Changelog

## 0.9.31

- **Off-Screen lines are short and readable.** With *Mirror Off-Screen* on, each agenda was written into the World State as a full dump of its fields: *Bond collector — now: … | then: … | on: Goldwane 30, 06:40 am | leg: Glassdock → Bluewatch Village 440 km W, upstream 25/day → 18 days | arrive: Goldwane 30, 06:40 am*. It was hard to read and cost tokens on every reply. Now each agenda is one line that reads like the story's own: *Bond collector — on a supply barge up the Bluewatch Branch; arrives Goldwane 30, 06:40 am; next, on arrival: questions the quay inspector*, or *Marrit — at the customs shed; next: drinking at the Stray Oar (Goldwane 12, 01:00 pm)*. The travel leg's arithmetic stays in the tracker and the Director tab, where travel is checked. What each agenda does next, and when, is still there, because the note leaves agendas to this section. Seeding from a World State reads these lines back into their parts.

## 0.9.30

- **The tracker is kept at the back of the chat.** Until now, Story Director rebuilt quests, hooks and agendas by re-reading every reply from the very first message. So any old message that went missing could take a quest with it. Now it keeps a **checkpoint**: one copy of the tracker as it stood ten replies back, saved in the chat's own hidden data (not in any message, never sent to the model). The tracker is that copy plus the last few replies. Messages before it are never read again, so hiding them, summarising them away (Summarybook and the like) or deleting them changes nothing. A new checkpoint is taken every ten replies and the newest four are kept, about 7 KB each.
  - **Swipe, edit or delete** within the last ten or so replies rolls back exactly as before.
  - **A bigger rollback** (deleting replies past the newest checkpoint) falls back on an older checkpoint. Past all of them, the tracker is rebuilt from whatever messages are left, hidden ones included.
  - **Editing a reply older than the checkpoint** no longer changes the tracker: the past stays put.
  - **Changing the calendar or the scene block's tag** starts the checkpoints over, because they turn dates into numbers.
  - **Branches** check that the checkpoint's reply is really there before using it.
- The Journal dates its entries from the story time saved with each change line, so entries from before a checkpoint keep their day.

## 0.9.29

- **Hidden replies stay part of the story.** Story Director builds its quests, hooks and agendas by reading every reply's Director block from the start of the chat, and it skipped replies hidden from the model. Extensions that save context by hiding old messages (Summarybook hides messages 0–10, for example) therefore wiped out everything those replies had set up: the Lone Grey Wolf bounty and the rat granary job vanished from the Quests tab, the Finished fold and the Journal at once. Now a hidden reply that carries a Director or scene block is still read. Hiding only changes what the model sees, and the tracker keeps everything. Swiping and deleting still roll changes back as before. Hidden messages without those blocks (system notes, battle hand-offs) are still skipped. Quests lost this way come back on their own once you update and reload the chat.

## 0.9.28

- **A quest with only its pay left is no longer failed by the clock.** Lone Grey Wolf was done (the wolf dead, a voucher in hand) and its step was *turn in voucher at the bailiff hatch on Friday noon*, with `due: Goldwane 14, 12:00 pm`. That time was when the hatch opens, but Story Director read it as a deadline. When the hour came, the note told the story *Lone Grey Wolf — deadline reached (Slay the pack)*, so the story failed the quest while you were on your way to cash it. Now a quest whose step or now is only collecting the pay (*turn in the voucher*, *collect the bounty*, *return to Verna for payment*, *get paid*) is told as *pay waiting from Goldwane 14, 12:00 pm (…); the work is done, the hour fails nothing*. A `-` line that fails it only for time (*deadline passed*, *expired*, *too late*, *missed the window*) leaves it open, with a note in the Director tab. A failure for another reason (*the bailiff tore up the voucher*) still ends it, and so does cashing it. The Quests tab marks such a quest **pay waiting**, not *deadline passed*.
- **`- Key — failed: reason` counts as a failure.** A closing line that wrote its outcome as a label (*failed: the pack fled*, *done: pack slain*) was saved with no reason at all, and a quest with no reason counts as done, so a failed quest could award quest XP. The label and its text are now the reason.

## 0.9.27

- **A job you went and did counts as done.** An offer only became your quest when your message used words like *accept* or *I'll take it*, so a job you simply went and did stayed under **Offered** even after the story finished it: *! Barrow-Viper Clearing — cleared pit, 10 skins turned in to Verna* changed nothing. Now, when the story says an offer is done (a `!`, a `~ … step: completed` or a `-` that reads as finished) and your messages have spoken of it, it closes as your finished quest, and RPG Battle awards its quest XP. An offer you never spoke of still leaves the Offered list, but as news with no XP (someone else did it). Failed, given up or lapsed is never a quest done.
- **More ways to take a job on.** *We'll join the hunt*, *count us in* and *I'm up for it* now take a job, and so does a plain *yes*, *sure* or *aye* when the reply has only one new quest.
- **An offer you talked about no longer vanishes on its date.** Offers lapse when their deadline passes, but a job's `due` is often the day it happens (*the hunt rides out on Goldwane 15*). That is how the wolfhound hunt you were waiting for got closed as *offer lapsed*. Now an offer your messages have spoken of gets two more story days, the same grace a late beat gets, and stays under Offered with its date shown as overdue. An offer nobody mentioned still lapses on time.
- A `~` line that reads as over, on a name nothing is tracked by (*~ Quests: North Levee Vipers — step: completed*), no longer creates a new, never-closed hook.
- The Quests tab now shows once there is an offer, not only once there is a quest.

## 0.9.26

- **The Off-Screen mirror keeps the story's own lines.** With *Mirror Off-Screen* on, Story Director rewrote the World State's whole Off-Screen section from its tracked agendas, so the story's own lines were dropped: *Jor — crying in the granary alley*, *Lefty — hiding aboard the Kettle Wife*. Now the agendas come first and the story's lines for people the tracker has no agenda for stay after them. A line for an agenda that has been closed still goes, and so does one written under a name the agenda was also called by. NPC State Delta 1.2.10 reads this section to tell who has left the scene, so keeping these lines also keeps those people off its Present cards.

## 0.9.25

- **The distance Fix button stays in the Director tab.** In 0.9.24 the button only lived on the pop-up warning, which goes after 20 seconds. Now the warning also sits under Director tab → Problems → Warnings with its own **Fix** button, for as long as the latest reply carries the wrong figure. It is read from the reply itself, so it is there after a reload too, needs no Reveal, and goes once the reply is fixed or swiped away.

## 0.9.24

- **A wrong distance is caught the moment the reply arrives.** Until now, a travel time the story got wrong was only corrected in the note for the next reply, so it sat in the reply you were reading. Now each new reply is checked as it comes in. If it names a place on the world pack's roads and says a time far off the map, a warning shows at once: *“three days” to Ledgerford: by the map it is 18–33 days (ride to wagon) from Bluewatch Village; by boat, 21.* The warning has a **Fix** button that writes the map's figure into the reply (*…twenty-one days downstream*), using the way the sentence names (downstream: by boat) or else the quickest. The warning is also listed in the Director tab. Nothing changes unless you press Fix.

## 0.9.23

- **Distances for every place in play, on every reply.** The Distances line no longer waits for a place to be named in the latest exchange. Every note now carries the real trip to up to six places in play:
  - places your message names;
  - places the latest reply names;
  - places tied to an open quest, hook or agenda (a giver's town, a road an agent is on), never a secret's;
  - places named in the last ten messages.

  So when the story brings a place back, or an NPC mentions where a job is, the figures are already in front of it. Routes are worked out once per world pack and reused, and the line costs about 15 tokens a place.

## 0.9.22

- **The story is told how far places really are.** Story Director already checked travel times on its own records, but never what the story itself said. So Verna could call Ninebarge Crossing "three days downstream" when the world pack's routes make it 22 to 40 days. Now, with a world pack, the note after a reply lists the places that reply or your message named, with the real trip from where the scene is, from the quickest way to the slowest: *Distances from Bluewatch Village: Ninebarge Crossing 22–40 days (boat to foot)*. If the reply said a time far off the map (under half the quickest trip, or over twice the slowest), it adds *not three days* and asks the story to keep to the map when the trip comes up again. Your own message is never corrected, and nothing is written into the reply.

## 0.9.21

- **Weekdays follow your world.** Story Director never used weekday names itself, but it never told the story the world has none either. So a model would make up "Friday noon" for a deadline, and nobody in a world with no week could say which day that is. Now:
  - **No week:** with a custom calendar and no week, the note says so once, right after its header: *This world has no weekdays: name a day by its date (Goldwane 14), never Monday to Sunday.*
  - **A week of its own:** list its day names under Settings → Calendar → **Week**, then pick which one the story's current day is under **Today is**. The note's header then starts with today's weekday (*Ashday, CY 611, Goldwane 12, 12:18 pm*), and the week runs on from there.
  - **Gregorian:** the header shows the real weekday.

## 0.9.20

- **A quest you just took on no longer finishes in the same reply.** When the story turned an offered hook into a quest, it sometimes also wrote `- hook Lone Grey Wolf — Hunt the lone wolf…` to retire the hook. That line was read as the quest being finished, so the quest closed right away and RPG Battle awarded its XP. Now a `-` line on a quest taken on in that same reply leaves it open, unless its reason says the job is done or failed. A word like `hook` in front of a tracked name is read as a label, not as part of the name. The quest check also tells the story not to write a `-` line for the hook. Quests already closed this way in older chats reopen; the XP already given stays in that reply's Party block, and swiping or deleting that reply removes it.

## 0.9.19

Six improvements to how the Director keeps the world moving around your character.

- **Every planned beat now says how it reaches your character.** The arc planner gives each beat a `reach`: what it changes for you wherever you are, such as a price, a door shut or opened, someone's mood, a danger or an opening, without deciding what you do about it. When the beat comes due, the note's Due line adds it (`Due now: Guards sack the Stray Oar (Goldwane 13, 10:30 pm) · reach: the inn shuts for repairs; Marrit is out of work…`), and the While away recap does too. A beat that happens while you are elsewhere still leaves something concrete for the story to show. Beats still ahead keep their reach out of the note, and the Director tab shows it as a row on the beat.
- **A story with little left to do plans its next arc.** With arc planning on *Automatic*, a new arc is planned when fewer than 3 threads are open: hooks, clocks and the arc's beats still to play. Offers of work don't count, since they wait for you, and neither do quests, agendas or secrets. Change the number under Settings → Arc planning → *Running low at*; 0 turns it off. After a plan is asked for, this trigger waits 5 replies before asking again, so a plan you discarded doesn't come back after every reply.
- **A made-up name is remembered.** When the story calls a tracked job or thread by another name (`! Fold Wolf Contract — …` for *Wolf Hunt*), Story Director works out which record it means and keeps that name on the record. Later lines with the same name go straight to it, a `+` included: no second copy of the job, and no new note each time. The Director tab lists those names under *also called*. Like everything else, they go away if you swipe or delete the reply that brought them in.
- **When the story skips ahead, what happened in between comes as a recap.** After a night's sleep or days on the road (12 hours or more of story time since the reply before), everything that came due or arrived in that stretch is listed on one "While away" line, with the times it covers. The story is asked to bring them in as news, signs or aftermath, not as scenes your character lived through, and they are no longer piled onto "Due now". A quest deadline that passed in the gap says so, a planned fight there was fought off-screen (no Fight? offer), and secrets never appear.
- **Beats that slip close themselves, and offers that lapse get one reaction.** A planned beat the story never got to used to stay on the note's *Due now* line for ever. Once the story is more than two days past its date, the reply where that happens closes it as *slipped*, and the next note says once that it happened off-screen or not at all. A job you were offered but never took closes as *offer lapsed* when its deadline passes, and the next note says it went to someone else and that the person who offered it may mention it. Neither counts as your choice or as a failed quest, and deleting or swiping that reply undoes it.
- **A Journal to catch up with.** A new **Journal** tab in Story Block's sidebar recaps what your character saw and heard, by story day, newest first: what happened, the quests you took on and how they ended, and the places you first visited. It only shows what the story has already told you: no agendas, secrets, plans or beats still to come. So it needs no Reveal and is safe to read after a long break.

## 0.9.18

- **A planned fight is reached by the scene, not the clock.** `encountersAt` now says, per fight, whether the reply fired it (`reached`: a `! Key — …` line in that reply). A fight fired there is listed even though firing cleared its date. RPG Battle 0.5.18 offers a planned fight only when it is reached. A brawl at the Stray Oar while your character sits at the guild post no longer pops up as a fight; the story brings it in as news, as the Pacing line asks.

## 0.9.17

- **Problems read without Reveal.** With *Hide behind the scenes* on, the Director tab only counted problems, so reading a warning such as *"Fold Wolf Contract" is not tracked* meant revealing every agenda, beat and secret. Problems and notes now show while the tab is hidden. Only those about an agenda, a planned beat, a clock or a secret stay hidden, counted on the lock as *N problems behind the scenes*.

## 0.9.16

- **A made-up name for a tracked job still finds it.** A model wrote `! Fold Wolf Contract — …` for a job tracked under another name, and the line was ignored with a warning. When the usual matching finds nothing, a looser reading now tries: plurals folded (*wolves* is *wolf*), job words set aside (*contract*, *bounty*, *quest*…), and a word inside a longer one (*fold* in *sheepfold*). Then it tries every word of the name found in one record's own name, goal or description (*Wolf Hunt — kill ridge wolves threatening the sheep fold*). Only a single match is taken. With two, the warning names both and neither changes.

## 0.9.15

- **Quest choices are yours.** A model wrote `+ quest` for two jobs a clerk had only offered ("What's it going to be?"), and both showed as active quests. Taking a job on, turning it down and giving it up now come only from your own message, the one the reply answers. Finishing and failing stay with the story.
  - A `+ quest` counts only when your message accepts the job, in a sentence naming it, its giver or a word of its name (or with only one job in question). Otherwise it is kept as an offer.
  - A main quest is the story's to give, and an offer the story moves on (a step under way, not `0/1`) is one your character is already doing: both start at once.
  - A model's *abandoned*, *gave up*, *declined* or *refused* line changes nothing unless your message said so. Your giving up is read from your message only, no longer from the narration.
  - When your message takes an offer on or turns one down, the note asks the story to write the line.
  - The change instruction now says an offered job is `+ hook` with its giver and reward.
- **Offered** jobs fold away in the Quests tab, with no buttons, until taken on, turned down or past their deadline.
- **Abandon works behind the scenes, like a fight's hand-off.** The flag no longer edits the latest reply. The quest shows *giving up* with a **Keep** button until your next reply. That reply's note tells the story you give it up, and the reply records it: your choice is stamped on the message, and the closing line is added if the story left it out. A swipe is told again; deleting that reply takes the abandon back.
- Chats already played are re-read the same way on the next refresh, so jobs that were only offered move to Offered.

## 0.9.14

- **"! Encounter — …" is not a missing record.** A model wrote a Director line under the word *Encounter*. It showed as a warning ("Encounter" is not tracked), and the next note told the model to add it with `+ kind Encounter — …`, which invites a fake record. A key that only labels the line (*Encounter*, *Fight*, *Combat*, *Battle*, *Scene*, *Director*, *Status*, *Update*, *Changes*, or a kind word such as *Quest* or *Hook*) is now skipped quietly: no warning, and nothing in `Corrections:`. A record actually called that is still changed, and a `+` still adds one. Fights are RPG Battle's, from the `<Encounter>` block.

## 0.9.13

- **Taking a job on no longer finishes it.** A model wrote `+ quest Sheepfold Wolves — …` and then `- Hook Sheepfold Wolves — accepted by Wessel` to say the hook had become the quest. The `-` was read as closing the quest, so it showed as finished the moment it was accepted and RPG Battle gave its quest XP. A `-` whose reason says the job was taken on (*accepted*, *taken on*, *took up*, *signed up*, *agreed to*, *became a quest*) now makes a hook or event the quest, and on a quest it changes nothing. One that also speaks of pay or an ending (*reward accepted*, *8 silver paid*, *declined*, *finished*) still closes it. Chats already affected are fixed on the next refresh, because the tracker is rebuilt from the replies.

## 0.9.12

- **Quest deadlines at a clock time.** A deadline written as `Goldwane 12 sunset` or `Goldwane 30` is now shown at the time the calendar gives it: *Goldwane 12, 07:00 pm*, or for a date alone the end of its day, *Goldwane 30, 11:59 pm*. This applies in the Quests tab and in the Director's note, so the story sees the exact time too. A deadline already at a clock time, and words around the date, are kept as written; the record itself is unchanged. The change-line instruction now asks for dates with a clock time (4 tokens more).

## 0.9.11

- **Quieter quest cards.** Each quest read as a stack of labelled rows (GOAL, STEP, GIVER, REWARD, DEADLINE), a long description and a big Abandon button. A card is now the goal (or the description when there is no goal), the next step after an arrow, and one small line of giver, reward, deadline and place, each with an icon. A description beside a goal comes last, cut to two lines until clicked. The difficulty tag shows only when it is not normal. Abandon is a small flag at the end of the quest's name; a click turns it into *Abandon?* and a second click gives the quest up, as before.
- **"Goldwane 12 sunset" is not past at breakfast.** A deadline the calendar read as a date alone counted from the start of that day, so a quest due at sunset showed *deadline passed* that morning. A deadline without a time now runs to the end of its day, and `sunrise`, `daybreak`, `sunset` and `sundown` are parts of the day like `dawn` and `dusk` (a calendar's own parts of day still win).

## 0.9.10

- **`Hook: Key` is the key.** A model wrote `~ Hook: Sheepfold Wolves — giver: Nelke, …`: the key read as *Hook: Sheepfold Wolves*. A kind and a colon in front of a key (`Hook:`, `Quest:`, any kind word) now name the kind and are not part of the key; on a `+` with no kind yet, they set it. A colon after any other word (`Mister: Smith`) stays in the key.
- Goes with **Story Block 0.9.7**, which reads change lines a model wrote as `<!-- Director … -->` outside the envelope (no quest was captured from them).

## 0.9.9

- **`+ quest` on an offered hook makes it the quest.** A job the arc planner (or an earlier reply) offered as a hook (`+ hook Sheepfold Wolves — … | reward: 2 silver per ear`) and then taken on with `+ quest Sheepfold Wolves — … | giver: … | goal: …` only had the new fields applied ("already tracked; the + was applied as a change"): it stayed a hook and never reached the Quests tab. A `+ quest` on an active hook or event now turns it into the quest (the Director tab notes it), keeping its key, description and history; beats and agendas stay what they are. The tracker is replayed from the replies, so such quests appear on their own.

## 0.9.8

- **Fields written with commas.** A model wrote `+ quest Sheepfold Wolves — Cull up to 4 timber wolves | type: contract, giver: Nelke/Herders, goal: return right wolf ears, reward: 2 silver per head, due: Goldwane 12`, and everything after `type:` became the type: the quest had no giver, goal, reward or deadline, and the Quests tab put it under a heading made of that whole string. Fields run together with commas or semicolons are now split as if written with `|`, only before a field the format knows (so `giver: Nelke, the clerk` keeps its comma). The tracker is replayed from the replies, so such quests are read correctly on their own.

## 0.9.7

- **A quest is finished once.** A later reply that closed an already closed quest again (`- Wolves at the weir — the pack is dead`, repeated by the model; or a `~ … status: completed`, or a quest's `!` that says so) re-stamped it as closed in that reply, so `questsDoneAt` reported it again and RPG Battle, which now awards quest XP at once, gave it twice. Closing something already closed now changes nothing (a note, `already-closed`, in the Director tab); it stays finished in the reply that first closed it. Reopened with `+`, it can be finished again.

## 0.9.6

- **Giving up, however it is written.** *forfeit*, *quit*, *walked away*, *backed out*, *called off* (and *withdrew*) now close a quest as a failure wherever *failed* or *gave up* already did: a `~ … status:` / `outcome:`, a quest's `!`, and the Quest check on its step. A failure earns no quest XP. *quit* is a whole word, so "turned in, quite a haul" is still a quest done.
- **Your own message is heard.** When your latest message, or the reply's narration, gives up an open quest in a sentence that names it or its giver ("I give up on the Sheep-killer bounty", "Tell Garrow I quit"), the note's Quest check asks the story to close it with `- Key — abandoned` if it does. A negation ("I won't give up") does not count; only a hint, so the story still closes it. Only while the model writes change lines.

## 0.9.5

The story closes quests, not a click.

- **Done and Failed are gone.** They let a click declare an outcome the story never told, and a Done earned RPG Battle's quest XP. A quest is finished or failed only when the story says so.
- **Abandon** (asks twice) is the one closing left to the reader: giving a job up is a decision, like accepting one. It writes `- Key — abandoned` into the latest reply (deleting or swiping it takes it back); it is a failure, so no quest XP.
- **Quest check:** an open quest whose `step` or `now` reads as over (*completed*, *wolf slain, reward collected*, *delivered*, *failed*… but not *complete the ritual* or *done with the first part*) adds one line to the note asking the story to close it with `- Key — outcome` if it has, and to leave it if not. Only while the model writes change lines.

## 0.9.4

- **Bounties and contracts are quests again.** 0.9.2 stopped a `step` alone from turning a hook into a quest, but the arc planner offers jobs as hooks that already carry their pay (`+ hook Wolf pelts — … | reward: 2 silver each | type: bounty`), and taking one on is usually written as progress (`~ Wolf pelts — step: tracking the pack`), so offered bounties and contracts stayed hooks and left the Quests tab. A hook or event that is a job (it has, or the change gives it, a giver, a reward or a quest category) now becomes a quest when a `~` moves it on (giver, reward, goal, step or difficulty); a plain thread's step still does not, and beats never do. An event given a reward is a quest again, as before 0.9.2. The tracker is replayed from the replies, so the quests come back on their own.
- **An untracked job is a quest:** a `~` on a key that is not tracked, with a giver or a reward, adds a quest instead of a hook.

## 0.9.3

One home for each thing, so the model is not steered from several places at once.

- **The arc rides on its beats.** The note's separate `Arc:` line is gone: the arc's name and what it is about head the Beats line (`Beats — The Weir Debt (who sold the route): Toll riders reach the ford (Goldwane 19)`), and with every beat due or none left, that line is the arc alone. A beat that comes due is on *Due now* as before.
- **Off-screen said once.** While Story Director keeps the timeline, mirrors the agendas into the scene block's Off-Screen section (*Mirror Off-Screen*, on by default) and the chat has that block, the note leaves its *Off-screen* line out: the section already shows every active agenda. An agenda due or arriving is still on *Due now* / *Arriving*. The token readout follows.
- **Quests: the last loose rule.** A new line with no kind (`+ Herb run — goal: twelve moonleaf | step: two found`) was a quest for any quest field; it is a quest only with a `giver`, a `reward` or a quest `type` now, and a hook otherwise.
- Goes with **Story Block 0.9.5**, whose World State leaves out Unresolved Threads, Planted Seeds, Consequence Timers and Arc Phase while Story Director keeps the timeline.

## 0.9.2

- **Not every task is a quest.** Since 0.8.6 a `~` that gave a hook, event or beat a `step`, `goal` or `difficulty` turned it into a quest, and models write `step:` for any progress ("asked around at the inn"), so open threads and even arc beats filled the Quests tab. Now only a hook given a `giver` or a `reward`, or a hook or event named a quest (`type: quest` or a category such as bounty), becomes one; beats never do. The tracker is replayed from the replies, so threads turned into quests this way are threads again.
- **Jobs, not errands:** the change instruction says a quest is "a job {{user}} accepted, not an errand", and that a hook taken on gets its giver and reward (the instruction stays about 160 tokens); the capture prompt says the same.

## 0.9.1

Quests that never finished. A quest closed only on a `- Key — reason` line, and nothing told the model that this is how a quest ends, so models wrote `~ Sheep-killer — step: done` or `! Sheep-killer — the wolf is slain, reward paid`, and the quest stayed open (and RPG Battle never offered its XP).

- **The instruction says it:** quests, "done or failed: - it" (about 5 tokens; the instruction is about 155).
- **Read as finished:** a `~` whose quest `step:` or `now:`, or any record's `status:`, `state:`, `outcome:`, `result:` or `progress:`, is just *done*, *completed*, *finished*, *fulfilled*, *failed*, *abandoned*, *expired*… (alone or before punctuation, so `step: complete the hunt at dawn` stays a step), and a `!` on a quest that says it was completed, finished, done, turned in, rewarded or failed, close the record as its `-` would. The Director tab notes it (`closed-by-change`). A failure is closed but not a quest done.
- **Done and Failed in the Quests tab:** each open quest has both (asking twice); the `-` line is written into the latest reply, so the tracker, RPG Battle's quest XP and a swipe or delete all follow it.

## 0.9.0

Modern travel. Roads, paces and rest days were all pre-modern (bastion roads, wagons, a rest day every six days), so a story set now could not use world packs or `/route`.

- **Modern packs:** a pack with `"era": "modern"` (or `pace_km_per_hour`) has its own road codes (`MW` motorway, `RD` road, `ST` city streets, `OR` off-road, `TR` trail, `RL` railway, `HS` high-speed rail, `MT` metro, `FY` ferry, `SL` sea lane, `AR` air route) and modes (foot, bike, car, motorbike, bus, train, metro, ferry, ship, plane), with built-in paces in km an hour. A mode a code does not list cannot use it. The pack's own paces are merged over them, may take a mode off (`null`) or add codes (one to three letters).
- **Hours, not days:** each road rounds up to the quarter hour; routes, legs, corrections and findings read in hours (`2 h 15 min`); arrivals are checked to the quarter hour or a tenth of the trip.
- **Nights on long drives:** car, motorbike, bike and foot stop for the night after 10 hours on the road (`drive_hours_per_day`); public transport goes on.
- **Boarding:** trains 15 min, high-speed rail and ferries 30 min, ships 1 h, flights 2 h (`board_hours` per code).
- **Getting to the station:** train, plane, ferry, bus and metro trips reach their station by a short taxi or walk (up to 60 km), shown as `(car)`; modern routes take the fastest way.
- **Without a pack:** Settings → Map & travel → **Travel** (*Pre-modern* or *Modern*) chooses how `/route` estimates from coordinates; modern paces are door to door with boarding. The Director tab's route tool offers the era's modes.
- **README:** a Modern travel section with the codes and paces, and a modern version of the pack-making prompt.

## 0.8.8

- **Your world pack's coordinates win.** A reply's coordinates (`Hollin's Reach | … | [70, 104]`) used to win over the pack's for any place the story had been, so one wrong number from the model made the Places section and `/route` give the wrong distance and direction (Hollin's Reach "east" when the pack puts it south-west of Bluewatch). Now the pack's coordinates are used for every place it knows. When a reply's coordinates differ by more than one map unit, the place says "(world pack; the story wrote 70, 104)" and the Places section names it. Places the pack does not know keep the story's coordinates.
- **Apostrophes don't split places:** "Hollins Reach" in a reply is the pack's "Hollin's Reach", and a place the pack knows is shown with the pack's spelling.
- **A pack that contradicts itself is noted on import:** a road shorter than the straight line between its places (with `scale_km_per_unit`), and a road whose `bearing` (`"SW/NE"`) its coordinates do not give. When every bearing fits a map whose y grows southwards, one note says to set **North is** to *Down* instead. The import message now shows the first five notes in full (it showed one).
- **README: Making a world pack**, with what a pack must get right, the road codes, and a prompt that has any model write a pack from your lorebook or map.

## 0.8.7

- **The Director's note is used once.** The note stayed in the settings after it shaped an arc, so a goal you forgot (*bring the twins home*) went on steering every later plan. Now accepting the arc it shaped (with **Accept**, or without review) clears it, with a notice saying so. It stays when the plan is discarded or planned again, and when you change the note while the plan waits.
- **Keep the note for every plan:** a new switch under Arc planning (off by default) keeps the note for good, as before.

## 0.8.6

- **A hook you take on becomes the quest.** A job offered and tracked as a hook (*Sheep-killer*) stayed a hook after you took it, so it never reached the Quests tab and RPG Battle never offered quest XP for finishing it: the format had no way to say "this is now a quest", and a `~` adding its reward only added a part. Now a `~` that gives a hook, event or beat a quest's own part (`giver`, `goal`, `reward`, `step`, `difficulty`, or a quest category such as `type: bounty`; `type: quest` alone too) turns it into a quest, keeping its key, description and history; the Director tab notes it. Agendas, clocks, secrets and arcs are never turned.
- **The model is told.** The change instruction's quest fields say *a hook they take on: ~ it with these* (about 10 tokens; the instruction is now about 150), and the capture prompt says the same.

## 0.8.5

- **Placeholders are not text.** A model sometimes copies the format's own word as the text: `- Sheep-killer — part` resolved the record with the reason "part". A part that is only `part`, `summary`, `reason`, `what happened` or `label: value` is now ignored, so the record resolves with no reason (or a new one gets no description).
- **The format copied word for word.** `+ kind hook — Guild post crisis | label: The desk is insolvent` made a World record keyed "kind hook" with a *label* row. A `kind` (or `kind:`) written before the kind word is now skipped, so this reads as the hook *Guild post crisis*; and a part labelled `label:` or `field:` is plain text (the description). The tracker is replayed from the replies, so records already made this way are read again correctly.
- **Clearer format line:** the instruction and the capture prompt say `+ kind Key — summary | label: value` instead of `— part`, the same length.

## 0.8.4

Long parts trimmed in the note, notes folded. The Director tab filled with harmless `long-part` notes ("The bond: goal has 27 words (keep parts to 12)"), while the full text was repeated in the note before every reply.

- **Trimmed in the note, kept in the tracker:** each record part the note writes runs to at most 12 words for what a record is doing and when (`now`, `then`, `on`, `due`, `arrive`) and 16 for what it is (`desc`, a quest's `goal`, `step`, `giver`, `reward`, a fight's foes, and any other part), then ends in "…" at a word boundary, before an unclosed bracket when words are left. The tracker, the Director and Quests tabs, `questsDoneAt`, `encountersAt`, and the planner's and capture's view of the tracker keep every word; `api.manage.tokens()` counts the trimmed note.
- **No more `long-part` findings:** the note no longer pays for long parts, so they are not reported.
- **Notes fold away:** in the Director tab, findings of severity info (a near key, a record added from a `~`, something still due, a date in prose, a duplicate add, a reopened record, …) sit in one closed **Notes** fold with their count; errors and warnings stay in view under **Problems**, counted alone. The hidden tab's counts and the toast after a reply name errors and warnings only (the toast already did).
- **API (pure, `src/note.js`):** `NOTE_PART_WORDS` and `notePart(text, field)`.

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
