// Story Director v2, part screens: `story-director/status-card` (SPEC §13.1), the inline card under
// each reply (mount `card`). Rows with no box of their own (they sit in the card's fold), labels on the
// left: the story time, the place, its map coordinates when the atlas knows them, the weather (Story
// Block's `scene.weather`, when the story set one), a Travel row while a trip is on (feature `story-director.trip`), {{user}}'s rank, what they are wearing and their condition (Story Block's
// `scene.you`, 2.10.0 and later, when the story set them; the Rank only in a game whose pack gives one, under that pack's own word, such as
// "Guild rank"), the current goal (the active quest touched last:
// its goal and step, with that quest's progress). A row with no value is left out. What the reply did to the key people list (someone
// back, someone no longer a key person) leads the card and its closed line, from the keypeople part's notes (`state.keypeople.notes`), and
// what the cast did (paths crossed, the cast moved on, a pack updated) heads it the same way, from the cast part's notes (`state.cast.notes`);
// a cast step is stored on the reply before the one it is for, so a note names the message its card goes under (`at`, compared with the
// card's `index`) instead of the reply's own changes. Only what {{user}} knows (world/known.js): the next thing coming
// due is not here (a planned beat or clock would spoil the story); the Director screen shows it, behind
// Reveal. A card shows **that reply's** state: Story Block's card mount runs
// these bindings on `stateAt(index)`, so an older reply keeps the time, place and goal it had, and a
// line that reply changed is marked (`changed(…)` reads that reply's own changes).
// On under every reply by default, collapsed to its header (MODULES §F24): `defaultOn: true` is the field
// Story Block's screen registry reads (`cardsOn(id)`: the reader's own on/off wins, else `defaultOn`).

import { BASE_CSS } from './style.js';

export const STATUS_CARD_ID = 'story-director/status-card';

// The rows sit directly in the card's fold (Story Block's card mount draws the fold): no box of their own. A row with
// no value is left out. Labels are the muted small-caps column; values are body text.
const TEMPLATE = `
<div class="sd-castnotes" data-if="len(state.cast.notes) > 0">
  <div class="sd-castnote" data-each="state.cast.notes as n" data-if="n.at == index" data-kind="{{ n.kind }}">
    <span class="sd-castnote-ico" aria-hidden="true"><i class="fa-solid fa-user-plus" data-if="n.kind == 'met'"></i><i class="fa-solid fa-hourglass-half" data-if="n.kind == 'moved'"></i><i class="fa-solid fa-cloud-arrow-up" data-if="n.kind == 'updated'"></i></span>
    <span class="sd-castnote-body"><b>{{ n.head }}</b> <span class="ss-pill ss-pill-soft">{{ n.tag }}</span><small>{{ n.rest }}</small></span>
  </div>
</div>
<div class="sd-keynotes" data-if="len(state.keypeople.notes) > 0">
  <p class="sd-keynote" data-each="state.keypeople.notes as n" data-if="changed(n)" data-kind="{{ n.kind }}"><span class="sd-keynote-star" aria-hidden="true">★</span> <span><b>{{ n.head }}</b> {{ n.rest }}</span></p>
</div>
<dl class="sd-status">
  <div class="sd-row sd-time" data-if="q.time.text" data-class="sd-new: changed('state.director.time')">
    <dt><i class="fa-solid fa-clock" aria-hidden="true"></i> Time</dt>
    <dd>{{ q.time.text }}</dd>
  </div>
  <div class="sd-row sd-weather" data-if="q.status.weather">
    <dt><i class="fa-solid fa-cloud-sun" aria-hidden="true"></i> Weather</dt>
    <dd>{{ q.status.weather }}</dd>
  </div>
  <div class="sd-row sd-place" data-if="state.scene.place.name" data-class="sd-new: changed('state.scene.place')">
    <dt><i class="fa-solid fa-location-dot" aria-hidden="true"></i> Place</dt>
    <dd>{{ state.scene.place.name }}<small data-if="state.scene.place.region"> · {{ state.scene.place.region }}</small></dd>
  </div>
  <div class="sd-row sd-coords" data-if="q.status.coords">
    <dt><i class="fa-solid fa-crosshairs" aria-hidden="true"></i> Coordinates</dt>
    <dd>{{ q.status.coords }}</dd>
  </div>
  <div class="sd-row sd-travel" data-if="q.trip.row">
    <dt><i class="fa-solid fa-route" aria-hidden="true"></i> Travel</dt>
    <dd>{{ q.trip.row }}</dd>
  </div>
  <div class="sd-row sd-rank" data-if="q.status.rank">
    <dt><i class="fa-solid fa-user" aria-hidden="true"></i> {{ q.status.rankLabel }}</dt>
    <dd>{{ q.status.rank }}</dd>
  </div>
  <div class="sd-row sd-wearing" data-if="q.status.wearing">
    <dt><i class="fa-solid fa-user" aria-hidden="true"></i> Wearing</dt>
    <dd>{{ q.status.wearing }}</dd>
  </div>
  <div class="sd-row sd-condition" data-if="q.status.condition">
    <dt><i class="fa-solid fa-user" aria-hidden="true"></i> Condition</dt>
    <dd>{{ q.status.condition }}</dd>
  </div>
  <div class="sd-row sd-goal" data-if="q.goal" data-class="sd-new: changed(state.director.threads[q.goal.id])">
    <dt><i class="fa-solid fa-flag" aria-hidden="true"></i> Goal</dt>
    <dd><b>{{ q.goal.key }}</b><span data-if="q.goal.goal"> — {{ q.goal.goal }}</span>
      <small class="sd-step" data-if="q.goal.step">Now: {{ q.goal.step }}</small>
    </dd>
  </div>
</dl>
`;

const CSS = `${BASE_CSS}
.sd-status { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 6px 14px; align-items: baseline;
  margin: 0; padding: 0; min-width: 0; font-size: 0.9em; line-height: 1.45; background: none; border: 0; box-shadow: none; }
.sd-row { display: contents; }
.sd-row > dt { margin: 0; font-variant: small-caps; letter-spacing: 0.04em; color: color-mix(in srgb, var(--sd-text) 80%, transparent); white-space: nowrap; align-self: baseline; }
.sd-row > dt i { width: 1.1em; text-align: center; color: var(--sd-accent); }
.sd-row > dd { margin: 0; min-width: 0; overflow-wrap: anywhere; color: var(--sd-text); }
.sd-row > dd small { color: var(--sd-muted); }
.sd-step { display: block; }
.sd-new > dd { color: var(--sd-accent-text); }
.sd-new > dt::after { content: " •"; color: var(--sd-accent); }
.sd-keynotes { display: grid; gap: 6px; margin: 0 0 10px; }
.sd-keynotes:not(:has(.sd-keynote)) { display: none; }
.sd-keynote { display: flex; gap: 8px; align-items: baseline; margin: 0; padding: 6px 10px; font-size: 0.9em; line-height: 1.45; border: 1px solid var(--sd-border); border-radius: var(--sd-radius); overflow-wrap: anywhere; }
.sd-keynote[data-kind="back"] { border-color: var(--sd-warn); }
.sd-castnotes { display: grid; gap: 6px; margin: 0 0 10px; }
.sd-castnotes:not(:has(.sd-castnote)) { display: none; }
.sd-castnote { display: flex; gap: 10px; align-items: baseline; margin: 0; padding: 8px 12px; font-size: 0.9em; line-height: 1.45; border: 1px solid var(--sd-border); border-radius: var(--sd-radius); overflow-wrap: anywhere; }
.sd-castnote[data-kind="met"] { border-color: var(--sd-accent); background: var(--ss-accent-soft); }
.sd-castnote-ico { color: var(--sd-accent); }
.sd-castnote-body { display: grid; gap: 4px; min-width: 0; }
.sd-castnote-body small { color: var(--sd-muted); }
.sd-keynote-star { color: var(--sd-warn); }
.sd-progress { display: block; margin-top: 4px; }
.sd-progress .ss-bar-label { font-variant-numeric: tabular-nums; }
.sd-met .ss-bar { --ss-bar-color: var(--sd-good); }
`;

// The card's own words: its title heads its section in Story Block's one "This reply" card, and `summary` is its part of that
// card's one line ("1:30 pm, Bluewatch Village"), a template read in the card's scope like the body (`q.status.summary` is the
// same text, from `director.status`). A host that draws the card on its own shows the title in its header, as before.
export const STATUS_TITLE = 'Where things stand';
// A key person's return or removal this reply leads the line ("Ren is back · 1:30 pm, Bluewatch Village"): their notes are what the reply changed in `keypeople.notes`.
export const STATUS_SUMMARY = '<span data-each="state.cast.notes as n" data-if="n.at == index">{{ n.line }} · </span><span data-each="state.keypeople.notes as n" data-if="changed(n)">{{ n.head }} · </span>{{ q.status.summary }}';

export const statusCardScreen = Object.freeze({
    id: STATUS_CARD_ID,
    title: STATUS_TITLE,
    summary: STATUS_SUMMARY,
    icon: 'fa-compass',
    mounts: ['card'],
    defaultOn: true,
    data: {
        time: { query: 'director.time' },
        // The place's map coordinates, the weather, {{user}}'s rank, what they wear and their condition (screens/queries.js statusExtras).
        status: { query: 'director.status' },
        // The reply's trip (atlas.trip, feature story-director.trip): null with none, and the row is left out.
        trip: { query: 'atlas.trip' },
        goal: { query: 'director.goal' },
    },
    template: TEMPLATE,
    css: CSS,
});
