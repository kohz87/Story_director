# Story Director 2.5.0

Story Director is the story’s memory and clock. It tracks quests and story threads, the calendar and weather, and offers a map, World, Chronicle and optional arc planning. Checks use standalone actor bonuses and can include NPC State Delta’s social context.

RPG Battle is no longer supported. Its rules packs cannot be imported; existing RPG Battle chats should stay on the previous versions.

## Install

Install [Story Block](https://github.com/kohz87/Story_block), then [Story Director](https://github.com/kohz87/Story_director), and reload SillyTavern. [NPC State Delta](https://github.com/kohz87/npc_state_delta) is optional. Story Director requires Story Block 2.6.0 or later.

## Playing

Take a quest in the story and the narrator records it as a thread. Quest goals and rewards are story-told. The Quests screen lists open quests; the map, World and Chronicle show the places, people and events the story has recorded. The Director can plan an arc when requested. Calendar, checks, weather and arc settings are under Story Suite’s Settings. Checks roll for you at +0 until a check character is set up; check characters saved in earlier chats keep their bonuses.

The card under each reply (Status) shows that reply's time, weather, place, map coordinates and goal. With Story Block 2.10.0 or later it also shows what you were wearing (Wearing) and how you were (Condition) when the story set them, and, in a game whose pack gives your character a rank (such as Ersveil's "Guild rank"), that rank under the pack's own word; a row with nothing to say is left out, and with an older Story Block nothing changes.

## Trips

When the party sets out for a place, the narrator writes `~ trip Wolfmere Outpost | by: riding | via: Hollin's Reach` (`by:` is foot, riding, wagon, boat, ship and so on; `via:` is optional and may list several stops). Code plans the way along the routes the map knows (the packs' and the story's `+ route` lines), through each stop and the shortest by km, and keeps the stages with their dates. A ride goes at the pace of Story Block's slowest mount (Mounts), else the usual ride pace. A trip with no known route is refused with the gap named.

- `~ trip stop` ends the trip where the party is. `~ trip delay: 1 day | because: lame horse` pushes every arrival still ahead.
- Where the party is on the road is worked out from the story time, never stored. The narrator is told "On the road: …, 8 of 100 km, arrive Goldwane 16", and when a stage has been reached, to write `~ place` (Story Director never moves the place itself).
- A new `~ trip` while on the road must go on to the end of the stage or back to its start.
- The Status card under a reply has a **Travel** row, the World screen's Now view an "On the road" line, and the **Map** draws the route as a thick line, a "You" marker, the movers {{user}} knows of (events with a `leg:` and an `arrive:`; never agendas, clocks, beats or secrets) and an **On the road** panel (under the map on a phone).
- With Story Block 2.11.0 or later its header also shows a **Travel** line (under Rank, Wearing and Condition) while a trip is on.
- Switch it off under Features → Trips: nothing new in the prompt, the saved story or the screens. More in [docs/dev/trips.md](docs/dev/trips.md).

Story Block’s [guide](https://github.com/kohz87/Story_block/blob/main/docs/v2/GUIDE.md) explains installation and play. Report bugs in [Issues](https://github.com/kohz87/Story_director/issues).

Licensed under [MIT](LICENSE); the Story Block test copy is AGPL-3.0, see [NOTICE](NOTICE.md).
