// Story Director v2, chronicle part: the Days screen (feature `story-director.digest`, SPEC §13.1).
//
// A tab and a full-screen view: every story day the chronicle has a digest for, newest first, each
// folded to its one line and opening to what the day held (where the party went, quests, fights, money,
// NPC stages, world news, and what the story was told). A search box keeps the days whose text holds
// what the reader typed (the template's `contains`, on the screen's own draft: nothing is saved). All
// of it comes from `chronicle.dayBoard` (queries.js) on the head state; there is nothing to click but
// the folds, since the digests are code's record of the story. Colours follow SillyTavern's theme
// through Story Block's --ss-* properties, as the Chronicle does.

import { DIGEST_FEATURE } from './days.js';

export const DAYS_ID = 'story-director/days';

const TEMPLATE = `
<div class="dy">
  <p class="dy-empty" data-if="!q.board.hasDays">No story day has ended yet. When the story's clock passes midnight, the day before is written here.</p>
  <label class="dy-find" data-if="q.board.hasDays">
    <span class="dy-find-label">Search the days</span>
    <input type="search" data-draft="find" placeholder="A place, a quest, a name…" maxlength="80" aria-label="Search the days">
  </label>
  <ol class="dy-list" data-if="q.board.hasDays" aria-label="Story days, newest first">
    <li class="dy-day" data-each="q.board.days as d" data-if="contains(d.search, draft.find)" data-day="{{ d.day }}" data-brief="{{ d.brief }}">
      <details class="dy-fold">
        <summary class="dy-head"><span class="dy-date">{{ d.date }}</span> <span class="dy-line">{{ d.line }}</span></summary>
        <div class="dy-body">
          <p class="dy-short" data-if="d.brief">Only this line is kept for an older day.</p>
          <ul class="dy-facts" data-if="d.hasFacts">
            <li data-each="d.facts as f">{{ f }}</li>
          </ul>
          <section class="dy-part" data-if="d.hasNpcs">
            <h5 class="dy-h">People</h5>
            <ul><li data-each="d.npcs as n">{{ n }}</li></ul>
          </section>
          <section class="dy-part" data-if="d.hasWorld">
            <h5 class="dy-h">The wider world</h5>
            <ul><li data-each="d.world as w">{{ w }}</li></ul>
          </section>
          <section class="dy-part" data-if="d.hasHappened">
            <h5 class="dy-h">What happened</h5>
            <ul><li data-each="d.happened as h">{{ h }}</li></ul>
            <p class="dy-more" data-if="d.more">…and {{ d.more }} more.</p>
          </section>
        </div>
      </details>
    </li>
  </ol>
</div>
`;

const CSS = `
:root {
  --dy-radius: var(--ss-radius, 10px);
  --dy-accent: var(--ss-accent, var(--SmartThemeQuoteColor, currentColor));
  --dy-border: var(--ss-border, var(--SmartThemeBorderColor, rgba(127, 127, 127, 0.35)));
  --dy-surface: var(--ss-chat-surface, var(--SmartThemeBlurTintColor, transparent));
  color: var(--ss-text, var(--SmartThemeBodyColor, inherit));
}
.dy { display: grid; gap: 10px; padding: 4px 0; }
.dy-empty { margin: 0; opacity: 0.65; font-style: italic; }
.dy-find { display: grid; gap: 2px; font-size: 0.85em; }
.dy-find-label { opacity: 0.75; }
.dy-find input { width: 100%; box-sizing: border-box; min-height: 36px; }
.dy-list { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
.dy-day { border: 1px solid var(--dy-border); border-radius: var(--dy-radius); background: var(--dy-surface); min-width: 0; }
.dy-head { cursor: pointer; padding: 8px 12px; min-height: 28px; overflow-wrap: anywhere; list-style-position: inside; }
.dy-date { font-weight: bold; color: var(--dy-accent); }
.dy-line { opacity: 0.85; }
.dy-day[data-brief="true"] .dy-line { opacity: 0.7; }
.dy-body { display: grid; gap: 6px; padding: 0 12px 10px; overflow-wrap: anywhere; }
.dy-body ul { margin: 0; padding-left: 1.2em; }
.dy-facts { list-style: none; padding-left: 0 !important; }
.dy-h { margin: 4px 0 2px; font-size: 0.9em; opacity: 0.8; }
.dy-short, .dy-more { margin: 0; font-size: 0.85em; opacity: 0.65; }
`;

/** The Days screen definition (hidden while the digest feature is off). */
export const daysScreen = Object.freeze({
    id: DAYS_ID,
    title: 'Days',
    icon: 'fa-calendar-days',
    mounts: Object.freeze(['tab', 'screen']),
    feature: DIGEST_FEATURE,
    template: TEMPLATE,
    css: CSS,
    data: Object.freeze({
        board: Object.freeze({ query: 'chronicle.dayBoard' }),
    }),
});
