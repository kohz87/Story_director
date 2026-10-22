// Story Director v2, part **world**: the World screen (`story-director/world`, a tab and a game-view screen,
// SPEC §13.1) with two views the reader switches between: **Now** (Here: the place and the people present;
// the news, events and factions {{user}} knows; what {{user}} knows is coming) and **Journal** (each story
// day: where {{user}} went, who they met, the news, the quests; the day digest's data, which the Days
// screen showed before). Only what {{user}} knows (known.js); the Director tab stays the GM's view, with
// what is behind the scenes behind Reveal. The view picked is the screen's own draft (nothing is saved);
// Now shows until Journal is picked. Read-only: nothing here is a story action (F95), and the only
// buttons are the people's dossier links (widget `story-director.people`, people.js).
//
// Here covers what Story Block's Scene tab shows, so Story Block hides Scene by default while World is there
// (MODULES §F119): the place with its kind and region and "moved here this reply" (Story Block's
// `scene.moved`), the weather (`scene.weather`: the Scene tab's, which would otherwise be lost with it), the
// story time in the header while the clock is set, and the people: NPC State Delta's own
// present-cast cards (portraits, now lines, meters) when it is there, else names; each with their thought
// from the newest reply's Inner chatter.
//
// `story-director/days` (the old Days screen's id) is kept as a dialog of the Journal alone, so an older
// layout or a reader's own copy that names it still finds a screen; it is no tab and no game-view screen.

import { BASE_CSS } from '../screens/style.js';
import { DIGEST_FEATURE } from '../chronicle/days.js';
import { FEATURE } from './known.js';
import { PEOPLE_WIDGET } from './people.js';

export const WORLD_ID = 'story-director/world';
export const DAYS_ID = 'story-director/days';

const JOURNAL = `
  <p class="wv-empty" data-if="!q.journal.on">The day digest is off (Features), so the Journal has nothing to show.</p>
  <p class="wv-empty" data-if="q.journal.on && !q.journal.hasDays">No story day is written yet. What each day held is kept here as the story's clock moves on.</p>
  <label class="wv-find" data-if="q.journal.hasDays">
    <span class="wv-find-label">Search the journal</span>
    <input type="search" data-draft="find" placeholder="A place, a quest, a name…" maxlength="80" aria-label="Search the journal">
  </label>
  <ol class="wv-days" data-if="q.journal.hasDays" aria-label="Story days, newest first">
    <li class="wv-day" data-each="q.journal.days as d" data-if="contains(d.search, draft.find)" data-day="{{ d.day }}" data-brief="{{ d.brief }}" data-today="{{ d.today }}">
      <details class="wv-fold">
        <summary class="wv-head"><span class="wv-date">{{ d.date }}</span> <span class="sd-tag" data-if="d.today">today so far</span> <span class="wv-line">{{ d.short }}</span></summary>
        <div class="wv-body">
          <p class="wv-note" data-if="d.brief">Only this line is kept for an older day.</p>
          <ul class="wv-facts" data-if="d.hasFacts">
            <li data-each="d.facts as f">{{ f }}</li>
          </ul>
          <section class="wv-part" data-if="d.hasMet">
            <h5 class="wv-h">Met</h5>
            <ul><li data-each="d.met as m">{{ m }}</li></ul>
          </section>
          <section class="wv-part" data-if="d.hasWorld">
            <h5 class="wv-h">News</h5>
            <ul><li data-each="d.world as w">{{ w }}</li></ul>
          </section>
          <section class="wv-part" data-if="d.hasNpcs">
            <h5 class="wv-h">People</h5>
            <ul><li data-each="d.npcs as n">{{ n }}</li></ul>
          </section>
          <section class="wv-part" data-if="d.hasHappened">
            <h5 class="wv-h">What happened</h5>
            <ul><li data-each="d.happened as h">{{ h }}</li></ul>
            <p class="wv-note" data-if="d.more">…and {{ d.more }} more.</p>
          </section>
        </div>
      </details>
    </li>
  </ol>`;

const NOW = `
  <section class="sd-kind wv-here" data-kind="here" aria-label="Here">
    <h4 class="sd-h">Here</h4>
    <p class="wv-place" data-if="q.world.here.place" data-class="wv-moved: q.world.here.moved"><i class="fa-solid fa-location-dot" aria-hidden="true"></i> <span class="sd-key">{{ q.world.here.place.name }}</span> <span class="sd-tag wv-kind" data-if="q.world.here.place.kind">{{ q.world.here.place.kind }}</span> <small data-if="q.world.here.place.region">· {{ q.world.here.place.region }}</small> <span class="sd-tag wv-moved-tag" data-if="q.world.here.moved">moved here this reply</span></p>
    <p class="sd-empty" data-if="!q.world.here.place">Nowhere named yet.</p>
    <p class="wv-weather" data-if="q.world.here.weather"><i class="fa-solid fa-cloud-sun" aria-hidden="true"></i> <span class="sd-key">Weather</span> <span>{{ q.world.here.weather }}</span></p>
    <ss-widget name="${PEOPLE_WIDGET}" data-props='{"bind":"q.world.here"}' data-if="q.world.here.hasPeople"></ss-widget>
    <p class="sd-empty" data-if="!q.world.here.hasPeople">No one else is in the scene.</p>
  </section>
  <section class="sd-kind wv-upcoming" data-kind="upcoming" aria-label="Upcoming">
    <h4 class="sd-h">Upcoming <small>next {{ q.world.upcomingDays }} days</small></h4>
    <p class="sd-empty" data-if="!q.world.clockSet">The story's clock is not set, so nothing has a date yet.</p>
    <p class="sd-empty" data-if="q.world.clockSet && !q.world.hasUpcoming">Nothing you know of is coming up.</p>
    <ul class="sd-list wv-list" data-if="q.world.hasUpcoming">
      <li class="wv-item" data-each="q.world.upcoming as u" data-kind="{{ u.kind }}" data-class="wv-overdue: u.overdue">
        <span class="sd-key">{{ u.name }}</span> <span class="sd-tag">{{ u.label }}</span>
        <p class="sd-meta"><span>{{ u.when }}</span><span data-if="u.kind == 'quest'">Quest due</span><span data-if="u.kind == 'holiday'">Holiday</span><span data-if="u.kind == 'event'">Event</span><span data-if="u.kind == 'hook'">Lead</span></p>
        <p class="sd-line" data-if="u.goal">{{ u.goal }}</p>
      </li>
    </ul>
  </section>
  <section class="sd-kind wv-news" data-kind="news" aria-label="News and events">
    <h4 class="sd-h">News and events <small data-if="q.world.hasNews">{{ q.world.newsCount }}</small></h4>
    <p class="sd-empty" data-if="!q.world.hasNews">No news yet.</p>
    <ul class="sd-list wv-list" data-if="q.world.hasNews">
      <li class="wv-item" data-each="q.world.news as n" data-kind="{{ n.kind }}" data-state="{{ n.state }}">
        <span class="sd-key">{{ n.name }}</span> <span class="sd-tag" data-if="n.state">{{ n.state }}</span>
        <p class="sd-line" data-if="n.summary">{{ n.summary }}</p>
        <p class="sd-meta"><span data-if="n.place">At {{ n.place }}</span><span data-if="n.factions">{{ n.factions }}</span><span data-if="n.ago">{{ n.ago }}</span></p>
      </li>
    </ul>
  </section>
  <section class="sd-kind wv-factions" data-kind="factions" aria-label="Factions">
    <h4 class="sd-h">Factions <small data-if="q.world.hasFactions">{{ q.world.factionCount }}</small></h4>
    <p class="sd-empty" data-if="!q.world.hasFactions">No factions known yet.</p>
    <ul class="sd-list wv-list" data-if="q.world.hasFactions">
      <li class="wv-item" data-each="q.world.factions as f">
        <span class="sd-key">{{ f.name }}</span>
        <p class="sd-line" data-if="f.summary">{{ f.summary }}</p>
        <p class="sd-meta"><span data-if="f.area">Holds {{ f.area }}</span><span data-if="f.stance">Toward you: {{ f.stance }}</span></p>
      </li>
    </ul>
  </section>`;

const TEMPLATE = `
<div class="wv">
  <header class="wv-top">
    <div class="wv-views" role="radiogroup" aria-label="World view">
      <label class="wv-view"><input type="radio" name="wv-view" data-draft="view" value="now"> <span><i class="fa-solid fa-earth-americas" aria-hidden="true"></i> Now</span></label>
      <label class="wv-view"><input type="radio" name="wv-view" data-draft="view" value="journal"> <span><i class="fa-solid fa-book" aria-hidden="true"></i> Journal</span></label>
    </div>
    <p class="wv-when" data-if="q.world.today"><i class="fa-solid fa-clock" aria-hidden="true"></i> {{ q.world.today }}</p>
  </header>
  <div class="wv-now" data-if="draft.view != 'journal'">${NOW}
  </div>
  <div class="wv-journal" data-if="draft.view == 'journal'">${JOURNAL}
  </div>
</div>
`;

const CSS = `${BASE_CSS}
.wv { display: grid; gap: 12px; padding: 4px 0; min-width: 0; }
.wv-top { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
.wv-views { display: inline-flex; border: 1px solid var(--sd-border); border-radius: 999px; overflow: hidden; }
.wv-view { position: relative; display: inline-flex; cursor: pointer; }
.wv-view input { position: absolute; opacity: 0; inset: 0; margin: 0; cursor: pointer; }
.wv-view span { display: inline-flex; align-items: center; gap: 6px; min-height: 40px; padding: 0 16px; white-space: nowrap; }
.wv-view input:checked + span, .wv-views:not(:has(input:checked)) .wv-view:first-child span { background: var(--sd-accent); color: var(--ss-on-accent, var(--SmartThemeBlurTintColor, #fff)); }
.wv-view input:focus-visible + span { outline: 2px solid var(--sd-accent); outline-offset: -2px; }
.wv-when { margin: 0; font-size: 0.9em; opacity: 0.85; overflow-wrap: anywhere; }
.wv-when i { color: var(--sd-accent); }
.wv-now { display: grid; gap: 14px; min-width: 0; }
.wv-place { margin: 0 0 6px; overflow-wrap: anywhere; }
.wv-place i, .wv-weather i { color: var(--sd-accent); }
.wv-weather { margin: 0 0 6px; overflow-wrap: anywhere; }
.wv-list { gap: 6px; }
.wv-item { padding: 6px 10px; border-left: 3px solid var(--sd-accent); border-radius: 4px; background: var(--sd-surface); overflow-wrap: anywhere; min-width: 0; }
.wv-item[data-kind="holiday"] { border-left-color: var(--sd-good); }
.wv-item.wv-overdue { border-left-color: var(--sd-warn); }
.wv-item[data-state="resolved"] { opacity: 0.75; border-left-color: var(--sd-border); }
.wv-item .sd-tag { margin-left: 4px; }
.wv-place.wv-moved { padding-left: 6px; border-left: 3px solid var(--sd-accent); }
.wv-kind { text-transform: capitalize; }
.wv-cast { display: block; min-width: 0; margin: 0 0 6px; }
.wv-cast[hidden], .wv-people[hidden] { display: none; }
.wv-thought { display: flex; align-items: flex-start; gap: 6px; margin: 4px 0 0; font-size: 0.85em; font-style: italic; opacity: 0.9;
  overflow-wrap: anywhere; white-space: normal; text-align: left; }
.wv-thought i { color: var(--sd-accent); margin-top: 2px; }
.wv-person { display: grid; gap: 2px; max-width: 100%; }
.wv-people { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; padding: 0; list-style: none; }
.wv-chip { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; min-height: 36px; padding: 2px 12px; border: 1px solid var(--sd-border);
  border-radius: 999px; background: var(--sd-surface); overflow-wrap: anywhere; }
.wv-chip .wv-stance { font-size: 0.8em; opacity: 0.8; }
.wv-chip.wv-link { cursor: pointer; font: inherit; color: inherit; margin: 0; width: auto; flex-direction: row; white-space: nowrap; }
.wv-chip .wv-name { white-space: normal; }
.wv-chip.wv-link:hover, .wv-chip.wv-link:focus-visible { border-color: var(--sd-accent); }
.wv-journal { display: grid; gap: 10px; min-width: 0; }
.wv-empty { margin: 0; opacity: 0.65; font-style: italic; }
.wv-find { display: grid; gap: 2px; font-size: 0.85em; }
.wv-find-label { opacity: 0.75; }
.wv-find input { width: 100%; box-sizing: border-box; min-height: 36px; }
.wv-days { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
.wv-day { border: 1px solid var(--sd-border); border-radius: var(--sd-radius); background: var(--sd-surface); min-width: 0; }
.wv-day[data-today="true"] { border-color: var(--sd-accent); }
.wv-head { cursor: pointer; padding: 8px 12px; min-height: 28px; overflow-wrap: anywhere; list-style-position: inside; }
.wv-date { font-weight: bold; color: var(--sd-accent); }
.wv-line { opacity: 0.85; }
.wv-day[data-brief="true"] .wv-line { opacity: 0.7; }
.wv-body { display: grid; gap: 6px; padding: 0 12px 10px; overflow-wrap: anywhere; }
.wv-body ul { margin: 0; padding-left: 1.2em; }
.wv-facts { list-style: none; padding-left: 0 !important; }
.wv-h { margin: 4px 0 2px; font-size: 0.9em; opacity: 0.8; }
.wv-note { margin: 0; font-size: 0.85em; opacity: 0.65; }
@media (min-width: 720px) {
  .wv-now { grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); align-items: start; }
  .wv-here { grid-column: 1 / -1; }
}
`;

const DATA = Object.freeze({
    world: Object.freeze({ query: 'director.world' }),
    journal: Object.freeze({ query: 'director.journal' }),
});

/** The World screen (feature `story-director.world`). */
export const worldScreen = Object.freeze({
    id: WORLD_ID,
    title: 'World',
    icon: 'fa-earth-americas',
    mounts: Object.freeze(['tab', 'screen']),
    feature: FEATURE,
    template: TEMPLATE,
    css: CSS,
    data: DATA,
});

/** The old Days screen's id: the Journal alone, as a dialog (no tab, no game-view screen). */
export const daysScreen = Object.freeze({
    id: DAYS_ID,
    title: 'Journal',
    icon: 'fa-book',
    mounts: Object.freeze(['dialog']),
    feature: DIGEST_FEATURE,
    template: `<div class="wv"><div class="wv-journal">${JOURNAL}\n</div></div>`,
    css: CSS,
    data: Object.freeze({ journal: Object.freeze({ query: 'director.journal' }) }),
});
