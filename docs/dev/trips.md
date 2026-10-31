# Trips (feature `story-director.trip`, atlas part)

Files: `src/v2/atlas/trip.js` (planning, position, words), `trip-shape.js` (what `atlas.trips` holds), `trip-capture.js` (the `trip` line),
`trip-query.js` (`atlas.trip`: the trip and the movers), `widget.js` (the Map's route, "You", movers, panel), `note.js` (`tripTail`).

## The line

`~ trip <Place> | by: riding | via: A, B`, `~ trip stop`, `~ trip delay: 1 day | because: …`. One grammar line, owned by the feature
(`kinds.trip.feature`, which `module.js` now passes on to Story Block): off, the line leaves the static prompt and a trip line is a quiet
`FEATURE_OFF` Problem. A refusal's sentence is the reason only: Story Block puts `"<line>" was not used:` in front.

## Planning (at capture, once)

From where {{user}} is (the scene's place, or the derived place on the road, see "a new trip mid-road") to the destination along
**known routes only** (`worldOf(atlas, packs)`: the packs' routes and the story's `+ route` lines), through each `via`, shortest by km
(Dijkstra, ties by place order as travel.js). One leg per route hop: `{ from, to, km, kind, days, start, arrive }`, `days` by travel.js's
`legDays` (round-up to the half day) at the mode's pace, a river/sea/air route at its own mode's (`hopMode`). A route the story gave in hours
counts those hours. Pace for `by: riding`: Story Block's query `mounts.pace` (`{ pace, mounts, riders, short, slowest }`; with `short > 0` its
`pace` is already the walking pace, and no mount is named) when it answers, else the default ride pace (35); foot and the rest use the default
paces. `setOut` is the story time of the reply (`ctx.time()` at the line); no clock, no trip.

A trip begun **mid-road** continues along the current leg: onward to its end or back to its start (the fewer km in all; onward on a tie). Its
first leg runs the road in the direction of travel with `skip` km already behind; the others follow. When neither end has a route to the
destination the line is refused naming both gaps, and the old trip stands.

## What is kept

`atlas.trips`, absent until a trip is made (an older save reads as none; `scratch: ['trips']` so replay makes the object on the way): one record
per line under `<rev>.<n>`: `go` (the plan, as made), `delay` (`at`, `minutes`, `because`). A `go` or a `stop` removes every earlier record; the
trip read back (`tripOf`) is the newest `go` with the delays after it applied: a delay holds the leg being travelled where it is (`holds`) and
starts the later legs later. Because delays are records of their own, deleting the reply that made the trip leaves a later delay with nothing to
move, and never a failing block. At most 8 delays a trip.

## Derived, not stored

`positionOf(trip, now)`: the current leg, km along its road, at a place or between two, arrived. `tripView` adds the words; it is `null` when
there is no trip, no clock, or the trip is **over**: it has arrived and the scene's place is a place the trip never named. "Arrived at X, <date>"
shows until then, or until a new trip starts.

## What the narrator is told (`tripTail`, a `context.parts` tail under the feature, budget `TRIP_TAIL_BUDGET`)

`On the road: Bluewatch Village → Hollin's Reach, 8 of 100 km, arrive Goldwane 16; then Wolfmere Outpost, Goldwane 19.` and, once a stage's
arrival has passed while the scene's place is still not there, `{{user}} has reached Hollin's Reach (Goldwane 16): write ~ place Hollin's Reach.`

## Screens

`atlas.trip` (feature-tagged, null while off) → `{ on, phase, to, pace, setOut, arrive, row, legs, leg, along, of, you, movers, delays }`.
`row` is the Status card's **Travel** row (icon fa-route, after Coordinates), the World screen's "On the road" line under the weather, and
what a Home header line would show. The Map screen binds it as the widget's `trip` prop: the legs as `.sd-map-trip-leg` lines over the known
routes, "You" at `you.t` along its leg, the movers as diamonds, and the `.sd-map-road` panel (over the map's corner; under it on a phone).

**Movers** are the Director's open `event` threads with `leg:` (two places on the map) and an `arrive:` still ahead, not planner-made, and
not named like an agenda, clock, beat, secret or arc: what `world/known.js` keeps from {{user}} stays out (it never shows agendas, even
revealed).

## Home

Story Block's Home header and cards have no slot a module can add to, so Story Director cannot put the "TRAVEL …" line or an "On the road" card
there itself. Story Block needs a few lines: bind `atlas.trip` in Home's data and show `q.trip.row` (hidden when null).
