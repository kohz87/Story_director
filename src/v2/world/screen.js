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
// One scene header: the Game view's hero header shows the place, the time and the weather above every screen, so there Here
// shows the people (and the trip) only; the Story panel's tab has no hero and keeps the place, weather and date lines. The
// News and events and the Factions are the feature `story-director.threads`' (src/v2/threads.js): off, they are not drawn.
//
// `story-director/days` (the old Days screen's id) is kept as a dialog of the Journal alone, so an older
// layout or a reader's own copy that names it still finds a screen; it is no tab and no game-view screen.

import { BASE_CSS } from '../screens/style.js';
import { DIGEST_FEATURE } from '../chronicle/days.js';
import { FEATURE } from './known.js';
import { PEOPLE_WIDGET } from './people.js';
import { EVENTS_WIDGET } from './events-widget.js';
import { KEY_PEOPLE_WIDGET } from '../keypeople/widget.js';

export const WORLD_ID = 'story-director/world';
export const DAYS_ID = 'story-director/days';

// The one place a World section label is drawn: its words, an optional count (shown when `when` holds), and
// the rule after it. The separator is `.wv-label::after` in CSS (a 1px hairline in the border token), so
// changing how labels are set off is a change to that one rule. `card: true` heads a list card.
const label = (text, { level = 'h4', count = '', when = '', show = '', card = false, scene = false } = {}) => {
    const tag = level === 'h5' ? 'h5' : 'h4';
    const shown = count ? ` <small${when ? ` data-if="${when}"` : ''}>${count}</small>` : '';
    const classes = ['ss-label', 'wv-label', tag === 'h4' ? 'sd-h' : 'wv-h', card ? 'ss-listcard-head' : '', scene ? 'wv-scene' : ''].filter(Boolean).join(' ');
    return `<${tag} class="${classes}"${show ? ` data-if="${show}"` : ''}>${text}${shown}</${tag}>`;
};

const JOURNAL = `
  <p class="sd-empty" data-if="!q.journal.on">The day digest is off (Features), so the Journal has nothing to show.</p>
  <p class="sd-empty" data-if="q.journal.on && !q.journal.hasDays">No story day is written yet. What each day held is kept here as the story's clock moves on.</p>
  <label class="wv-find" data-if="q.journal.hasDays">
    <span class="wv-find-label">Search the journal</span>
    <input type="search" data-draft="find" placeholder="A place, a quest, a name…" maxlength="80" aria-label="Search the journal">
  </label>
  <ol class="wv-days" data-if="q.journal.hasDays" aria-label="Story days, newest first">
    <li class="wv-day ss-glass" data-each="q.journal.days as d" data-if="contains(d.search, draft.find)" data-day="{{ d.day }}" data-brief="{{ d.brief }}" data-today="{{ d.today }}">
      <details class="wv-fold">
        <summary class="wv-head"><span class="wv-top"><span class="wv-date">{{ d.date }}</span> <span class="ss-pill" data-if="d.today">today so far</span></span> <span class="wv-line">{{ d.short }}</span></summary>
        <div class="wv-body">
          <p class="wv-note" data-if="d.brief">Only this line is kept for an older day.</p>
          <ul class="wv-facts" data-if="d.hasFacts">
            <li data-each="d.facts as f">{{ f }}</li>
          </ul>
          <section class="wv-part" data-if="d.hasMet">
            ${label('Met', { level: 'h5' })}
            <ul><li data-each="d.met as m">{{ m }}</li></ul>
          </section>
          <section class="wv-part" data-if="d.hasWorld">
            ${label('News', { level: 'h5' })}
            <ul><li data-each="d.world as w">{{ w }}</li></ul>
          </section>
          <section class="wv-part" data-if="d.hasNpcs">
            ${label('People', { level: 'h5' })}
            <ul><li data-each="d.npcs as n">{{ n }}</li></ul>
          </section>
          <section class="wv-part" data-if="d.hasHappened">
            ${label('What happened', { level: 'h5' })}
            <ul><li data-each="d.happened as h">{{ h }}</li></ul>
            <ss-widget class="wv-more" name="${EVENTS_WIDGET}" data-props='{"day":"{{ d.day }}","total":"{{ d.total }}"}' data-if="d.more"></ss-widget>
          </section>
        </div>
      </details>
    </li>
  </ol>`;

// Around here's heading: the place on one line, cut with "…" when it is long (its full text is the tooltip), then the time of day, which goes
// first when the two do not fit together (CSS: `.wv-around .wv-label > small`).
const AROUND_WHERE = '<span class="wv-clip" data-if="q.cast.place" title="{{ q.cast.place }}">{{ q.cast.place }}</span> <span class="wv-day" data-if="q.cast.day">{{ q.cast.dayText }}</span>';

const NOW = `
  <section class="sd-kind wv-here ss-glass" data-kind="here" aria-label="Here">
    ${label('Here', { scene: true })}
    <p class="wv-place wv-scene" data-if="q.world.here.place" data-class="wv-moved: q.world.here.moved"><i class="fa-solid fa-location-dot" aria-hidden="true"></i> <span class="sd-key">{{ q.world.here.place.name }}</span> <span class="ss-pill wv-kind" data-if="q.world.here.place.kind">{{ q.world.here.place.kind }}</span> <small data-if="q.world.here.place.region">· {{ q.world.here.place.region }}</small> <span class="ss-pill ss-pill-soft wv-moved-tag" data-if="q.world.here.moved">moved here this reply</span></p>
    <p class="sd-empty wv-scene" data-if="!q.world.here.place">Nowhere named yet.</p>
    <p class="wv-weather wv-scene" data-if="q.world.here.weather"><i class="fa-solid fa-cloud-sun" aria-hidden="true"></i> <span class="sd-key">Weather</span> <span>{{ q.world.here.weather }}</span></p>
    <p class="wv-weather wv-road" data-if="q.trip.row"><i class="fa-solid fa-route" aria-hidden="true"></i> <span class="sd-key">On the road</span> <span>{{ q.trip.row }}</span></p>
    ${label('People here', { count: '{{ len(q.world.here.people) }}', show: 'q.world.here.hasPeople' })}
    <ss-widget name="${PEOPLE_WIDGET}" data-props='{"bind":"q.world.here"}' data-if="q.world.here.hasPeople"></ss-widget>
    <p class="sd-empty" data-if="!q.world.here.hasPeople">No one else is in the scene.</p>
  </section>
  <section class="sd-kind wv-around ss-glass" data-kind="around" aria-label="Around here" data-if="q.cast.on == true">
    ${label('Around here', { count: AROUND_WHERE, when: 'q.cast.heading' })}
    <div class="wv-row" data-if="q.cast.hasNear"><span>Cast whose paths may cross yours here</span><b>{{ q.cast.near }}, not yet met</b></div>
    <div class="wv-row" data-if="q.cast.hasMet"><span>Cast you have met</span><span class="wv-row-list"><span class="wv-row-item" data-each="q.cast.metList as m">{{ m.name }}<small data-if="m.news">, last heard: {{ m.news }}</small></span></span></div>
    <div class="wv-row"><span>Met from the {{ q.cast.packLabel }}</span><b>{{ q.cast.met }} of {{ q.cast.total }}</b></div>
    <p class="wv-note">{{ q.cast.note }}</p>
  </section>
  <section class="sd-kind wv-key ss-glass" data-kind="key" aria-label="Key people" data-if="q.keys.on == true">
    ${label('Key people', { count: '{{ q.keys.countText }}' })}
    <ss-widget name="${KEY_PEOPLE_WIDGET}" data-props='{"bind":"q.keys"}'></ss-widget>
  </section>
  <section class="sd-kind wv-upcoming ss-listcard ss-glass" data-kind="upcoming" aria-label="Upcoming">
    ${label('Upcoming', { card: true, count: 'next {{ q.world.upcomingDays }} days' })}
    <p class="ss-listcard-empty" data-if="!q.world.clockSet">The story's clock is not set, so nothing has a date yet.</p>
    <p class="ss-listcard-empty" data-if="q.world.clockSet && !q.world.hasUpcoming">Nothing you know of is coming up.</p>
    <ul class="ss-listcard-rows" data-if="q.world.hasUpcoming">
      <li class="ss-listcard-row wv-item" data-each="q.world.upcoming as u" data-kind="{{ u.kind }}" data-class="wv-overdue: u.overdue">
        <div class="ss-listcard-item">
          <span class="ss-listcard-main">
            <span class="ss-listcard-title">{{ u.name }}</span>
            <span class="ss-listcard-sub" data-if="u.goal">{{ u.goal }}</span>
            <span class="sd-meta"><span>{{ u.when }}</span><span class="ss-pill" data-if="u.overdue">overdue</span><span data-if="u.kind == 'quest'">Quest due</span><span data-if="u.kind == 'holiday'">Holiday</span><span data-if="u.kind == 'event'">Event</span><span data-if="u.kind == 'hook'">Lead</span></span>
          </span>
          <span class="ss-listcard-value" data-if="u.label"><span class="ss-pill">{{ u.label }}</span></span>
        </div>
      </li>
    </ul>
  </section>
  <section class="sd-kind wv-news ss-listcard ss-glass" data-kind="news" aria-label="News and events" data-if="q.threads.on">
    ${label('News and events', { card: true, count: '{{ q.world.newsCount }}', when: 'q.world.hasNews' })}
    <p class="ss-listcard-empty" data-if="!q.world.hasNews">No news yet.</p>
    <ul class="ss-listcard-rows" data-if="q.world.hasNews">
      <li class="ss-listcard-row wv-item" data-each="q.world.news as n" data-kind="{{ n.kind }}" data-state="{{ n.state }}">
        <div class="ss-listcard-item">
          <span class="ss-listcard-main">
            <span class="ss-listcard-title">{{ n.name }}</span>
            <span class="ss-listcard-sub" data-if="n.summary">{{ n.summary }}</span>
            <span class="sd-meta"><span data-if="n.place">At {{ n.place }}</span><span data-if="n.factions">{{ n.factions }}</span><span data-if="n.ago">{{ n.ago }}</span></span>
          </span>
          <span class="ss-listcard-value" data-if="n.state"><span class="ss-pill">{{ n.state }}</span></span>
        </div>
      </li>
    </ul>
  </section>
  <section class="sd-kind wv-factions ss-listcard ss-glass" data-kind="factions" aria-label="Factions" data-if="q.threads.on">
    ${label('Factions', { card: true, count: '{{ q.world.factionCount }}', when: 'q.world.hasFactions' })}
    <p class="ss-listcard-empty" data-if="!q.world.hasFactions">No factions known yet.</p>
    <ul class="ss-listcard-rows" data-if="q.world.hasFactions">
      <li class="ss-listcard-row wv-item" data-each="q.world.factions as f">
        <div class="ss-listcard-item">
          <span class="ss-listcard-main">
            <span class="ss-listcard-title">{{ f.name }}</span>
            <span class="ss-listcard-sub" data-if="f.summary">{{ f.summary }}</span>
            <span class="sd-meta"><span data-if="f.area">Holds {{ f.area }}</span><span data-if="f.stance">Toward you: {{ f.stance }}</span></span>
          </span>
        </div>
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
    <p class="wv-when wv-scene" data-if="q.world.today"><i class="fa-solid fa-clock" aria-hidden="true"></i> {{ q.world.today }}</p>
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
.wv-views { display: inline-flex; flex-wrap: wrap; gap: 6px; max-width: 100%; }
.wv-view { position: relative; display: inline-flex; cursor: pointer; }
.wv-view input { position: absolute; opacity: 0; inset: 0; margin: 0; cursor: pointer; }
.wv-view span { display: inline-flex; align-items: center; gap: 6px; min-height: 40px; padding: 0 16px; white-space: nowrap;
  border: 1px solid var(--sd-border); border-radius: var(--ss-radius-pill); background: var(--sd-surface); font-weight: 700; }
.wv-view input:checked + span, .wv-views:not(:has(input:checked)) .wv-view:first-child span { background: var(--ss-accent-soft); border-color: var(--sd-accent); }
.wv-view input:focus-visible + span { outline: 2px solid var(--sd-accent); outline-offset: 2px; }
.wv-when { margin: 0; font-size: 0.9em; color: var(--sd-muted); overflow-wrap: anywhere; }
.wv-when i { color: var(--sd-accent); }
.wv-now { display: grid; gap: 14px; min-width: 0; }
.wv-here { display: grid; gap: 8px; padding: 12px 14px; min-width: 0; }
.wv-label { display: flex; align-items: center; gap: 10px; margin: 0 0 6px; min-width: 0; white-space: nowrap; }
/* The separator: a hairline filling the rest of the row, centred on the label; it shrinks to nothing rather than push the label. */
.wv-label::after { content: ""; flex: 1 1 0; min-width: 0; height: 1px; background: var(--ss-rule, var(--ss-border)); }
.wv-label small { color: var(--sd-text); font-weight: normal; }
.wv-h.wv-label { margin: 4px 0 2px; font-size: 0.9em; color: var(--sd-muted); }
.wv-label.ss-listcard-head { margin-bottom: 2px; padding: 0 6px; }
.wv-place { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; margin: 0; overflow-wrap: anywhere; }
.wv-place i, .wv-weather i { color: var(--sd-accent); }
.wv-place .sd-key { font-size: 1.15em; font-weight: 800; }
.wv-place.wv-moved { padding-left: 8px; border-left: 3px solid var(--sd-accent); }
.wv-kind { text-transform: capitalize; }
.wv-weather { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; margin: 0; overflow-wrap: anywhere; }
/* The scene lines the Game view's hero header already shows (BASE_CSS sets --sd-line-display to none there): the place, the weather
   and the empty-place note, the "Here" heading over them, and the date by the view switch. "On the road" is not one of them. */
.wv-place.wv-scene, .wv-weather.wv-scene { display: var(--sd-line-display, flex); }
.sd-empty.wv-scene, .wv-when.wv-scene { display: var(--sd-line-display, block); }
/* The "Here" heading is one of them: with the place and weather lines gone, a bare heading would sit above the people. */
.wv-label.wv-scene { display: var(--sd-line-display, flex); }
.wv-scene[hidden] { display: none; }
.wv-upcoming, .wv-news, .wv-factions, .wv-key { min-width: 0; }
.wv-key { display: grid; gap: 4px; padding: 12px 14px; align-content: start; }
.wv-key-body { display: grid; gap: 8px; min-width: 0; }
.wv-key-list { display: grid; margin: 0; padding: 0; list-style: none; }
.wv-key-row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 2px 10px; align-items: start; padding: 8px 0; border-top: 1px solid var(--sd-border); }
.wv-key-row:first-child { border-top: 0; padding-top: 2px; }
.wv-key-star { color: var(--sd-warn); line-height: 1.3; }
.wv-key-name { font-weight: 700; overflow-wrap: anywhere; }
.wv-key-pill { display: inline-block; padding: 0 8px; border: 1px solid var(--sd-border); border-radius: var(--ss-radius-pill); font-size: 0.8em; white-space: nowrap; }
.wv-key-pill.is-away { border-color: var(--sd-accent); color: var(--sd-accent-text); }
.wv-key-pill.is-here { border-color: var(--sd-good); color: var(--sd-good); }
.wv-key-sub { grid-column: 2; font-size: 0.85em; line-height: 1.45; overflow-wrap: anywhere; }
/* The host keeps every button at least 44px (a touch target): pills at that height here, and on a phone Unpin is a link-like button, not a circle. */
.wv-key-unpin { grid-column: 3; grid-row: 1 / span 3; align-self: start; margin: 0; padding: 0 16px; font: inherit; font-size: 0.8em; line-height: 1.4; cursor: pointer; color: inherit; background: none; border: 1px solid var(--sd-border); border-radius: var(--ss-radius-pill); }
.wv-key-actions { display: flex; flex-wrap: wrap; gap: 6px; }
@media (max-width: 599px) { .wv-key-unpin { margin-block: -8px; padding: 0 6px; border-color: transparent; text-decoration: underline; color: var(--sd-accent-text); } }
.wv-key-actions .wv-key-pin { flex: 0 0 auto; width: 7em; padding: 0 18px; border-radius: var(--ss-radius-pill); }
/* The Pin list stays inside the card and scrolls there (a phone keeps the card within the room under the header). */
.wv-key-choices { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; max-height: min(260px, 32vh); overflow-y: auto; overscroll-behavior: contain; min-width: 0; }
.wv-key-pick { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; width: 100%; margin: 0; padding: 6px 12px; font: inherit; text-align: left; cursor: pointer; color: inherit; background: var(--sd-surface); border: 1px solid var(--sd-border); border-radius: var(--sd-radius); }
.wv-key-pick:hover { border-color: var(--sd-accent); }
.wv-key-from { color: var(--sd-muted); }
.wv-key-note { margin: 0; font-size: 0.8em; line-height: 1.45; color: var(--sd-muted); }
.wv-around { display: grid; gap: 4px; padding: 12px 14px; align-content: start; min-width: 0; }
/* The heading is "AROUND HERE" (never shrinks), the place cut with an ellipsis, then the time of day. The time of day wraps to a second line
   when it does not fit beside the place, and the one-line height of the small clips it: it goes first, the place only after it. */
.wv-around .wv-label { min-width: 0; }
.wv-around .wv-label > small { display: flex; flex-wrap: wrap; column-gap: .35em; flex: 0 1 auto; min-width: 0; max-width: 100%; line-height: 1.3; max-height: 1.3em; overflow: hidden; }
.wv-clip { min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wv-day { flex: none; white-space: nowrap; }
.wv-row { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 10px; padding: 6px 0; border-top: 1px solid var(--sd-border); }
.wv-row-list { display: grid; gap: 2px; text-align: right; min-width: 0; overflow-wrap: anywhere; }
.wv-row-item small { color: var(--sd-muted); }
.wv-item .ss-listcard-title, .wv-item .ss-listcard-sub { overflow-wrap: anywhere; }
.wv-item .ss-listcard-value { max-width: 45%; min-width: 0; }
.wv-item .ss-pill { max-width: 100%; white-space: normal; overflow-wrap: anywhere; }
.wv-item[data-state="resolved"] .ss-listcard-sub { color: var(--sd-muted); }
.wv-cast { display: block; min-width: 0; margin: 0 0 6px; }
.wv-cast[hidden], .wv-people[hidden] { display: none; }
.wv-thought { display: flex; align-items: flex-start; gap: 6px; margin: 4px 0 0; font-size: 0.85em; font-style: italic; color: var(--sd-text);
  overflow-wrap: anywhere; white-space: normal; text-align: left; }
.wv-thought i { color: var(--sd-accent); margin-top: 2px; }
.wv-person { display: grid; gap: 2px; max-width: 100%; }
.wv-people { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; padding: 0; list-style: none; }
.wv-chip { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; min-height: 40px; padding: 2px 14px; border: 1px solid var(--sd-border);
  border-radius: var(--ss-radius-pill); background: var(--sd-surface); color: var(--sd-text); font: inherit; overflow-wrap: anywhere; }
.wv-chip .wv-stance { font-size: 0.8em; color: var(--sd-muted); }
.wv-chip.wv-link { cursor: pointer; margin: 0; width: auto; flex-direction: row; white-space: nowrap; }
.wv-chip .wv-name { white-space: normal; }
.wv-chip.wv-link:not(:disabled):hover { border-color: var(--sd-accent); }
.wv-chip.wv-link:focus-visible { outline: 2px solid var(--sd-accent); outline-offset: 2px; }
.wv, .wv-journal, .wv-days, .wv-body, .wv-part, .wv-find { grid-template-columns: minmax(0, 1fr); }
.wv-journal { display: grid; gap: 10px; min-width: 0; }
.wv-fold, .wv-part, .wv-find, .wv-days > li { min-width: 0; max-width: 100%; }
.wv-part { display: grid; gap: 2px; }
/* Every Journal line wraps inside its card; a section rule stops at the card's edge. */
.wv-journal, .wv-journal li, .wv-journal .wv-find-label { overflow-wrap: anywhere; }
.wv-part .wv-label { overflow: hidden; max-width: 100%; }
.wv-part .wv-label::after { min-width: 0; }
.wv-more { display: block; min-width: 0; }
.wv-more-btn { justify-self: start; min-height: 40px; }
.wv-events { margin: 6px 0 0; padding-left: 1.2em; display: grid; gap: 2px; overflow-wrap: anywhere; min-width: 0; }
.wv-empty { margin: 0; color: var(--sd-muted); font-style: italic; }
.wv-find { display: grid; gap: 2px; font-size: 0.85em; }
.wv-find-label { color: var(--sd-muted); }
.wv-find input { width: 100%; box-sizing: border-box; min-height: 40px; }
.wv-days { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
.wv-day { min-width: 0; padding: 0; }
.wv-day[data-today="true"] { border-color: var(--sd-accent); }
.wv-head { cursor: pointer; padding: 10px 14px; min-height: 40px; overflow-wrap: anywhere; list-style-position: inside; }
.wv-date { font-weight: 800; color: var(--sd-text); }
/* The date and the pill on the first line; the summary below it, in body text, wrapping normally (4px between the lines). */
.wv-top { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.wv-line { display: block; margin-top: 4px; color: var(--sd-text); }
.wv-body { display: grid; gap: 6px; padding: 0 14px 12px; overflow-wrap: anywhere; }
.wv-body ul { margin: 0; padding-left: 1.2em; }
.wv-facts { list-style: none; padding-left: 0 !important; }
.wv-note { margin: 0; font-size: 0.85em; color: var(--sd-muted); }
@media (min-width: 720px) {
  .wv-now { grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); align-items: start; }
  .wv-here { grid-column: 1 / -1; }
}
`;

const DATA = Object.freeze({
    world: Object.freeze({ query: 'director.world' }),
    // `{ on: true }` while the feature `story-director.threads` is on, null while it is off: the News and the Factions read it.
    threads: Object.freeze({ query: 'director.threads.on' }),
    journal: Object.freeze({ query: 'director.journal' }),
    // The Key people section (keypeople part, feature `story-director.key-people`): `{ on: true, … }`, null while the feature is off.
    keys: Object.freeze({ query: 'director.keyPeople.view' }),
    // The Around here section (cast part, feature `story-director.cast`): the numbers and the met people's news, null while off or with no cast.
    cast: Object.freeze({ query: 'director.cast.view' }),
    // The trip (atlas.trip, feature story-director.trip), shown under the weather while one is on: null with none.
    trip: Object.freeze({ query: 'atlas.trip' }),
});

/** The World screen (feature `story-director.world`). */
export const worldScreen = Object.freeze({
    id: WORLD_ID,
    title: 'World',
    icon: 'fa-earth-americas',
    bar: true,
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
