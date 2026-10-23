// Story Director v2, part screens: `story-director/quests` (SPEC §13.1), the Quests tab and game-view
// screen. Active quests with their progress as a glass bar ("Wolves 8/3") and the rolling progress note,
// finished quests folded away. There is no Offered list: the story's `+ quest` makes a quest active at
// once. No buttons (F95, README "There are no quest buttons"): giving up comes from the reader's own words,
// turning in from the story (code checks and pays); each row says where the quest stands instead ("Ready to
// turn in — 3/3 wolves", "Not yet: 2/3 wolves"). Every row opens its details (F84: goal, progress note,
// terms, giver, due, taken and ended dates, history) in a screen-local `<details>` panel: templates have no
// dialog to open with a quest's data. The commands stay in the SDK for a card's or pack's own buttons.
// Everything comes from `quest.board` (queries.js), on the head state.
//
// The rows are Story Block's list card (`ss-listcard`, view/glass.css) drawn from the template: the status
// tag sits on a line of its own under the row, so a long line wraps on a phone instead of pushing the name out.

import { BASE_CSS } from './style.js';

export const QUESTS_ID = 'story-director/quests';

// The details panel of one row: `x` is the row's loop name.
const details = x => `
        <details class="sd-more">
          <summary>Details</summary>
          <dl class="sd-facts">
            <div data-if="${x}.details.goal"><dt>Goal</dt><dd>{{ ${x}.details.goal }}</dd></div>
            <div data-if="${x}.details.note"><dt>Progress</dt><dd>{{ ${x}.details.note }}</dd></div>
            <div data-if="${x}.details.terms"><dt>Terms</dt><dd>{{ ${x}.details.terms }}</dd></div>
            <div data-if="${x}.details.owed"><dt>Owed</dt><dd>{{ ${x}.details.owed }}</dd></div>
            <div data-if="${x}.details.rank"><dt>Rank</dt><dd>{{ ${x}.details.rank }}</dd></div>
            <div data-if="${x}.details.giver"><dt>Giver</dt><dd>{{ ${x}.details.giver }}</dd></div>
            <div data-if="${x}.details.due"><dt>Due</dt><dd>{{ ${x}.details.due }}</dd></div>
            <div data-if="${x}.details.taken"><dt>Taken on</dt><dd>{{ ${x}.details.taken }}</dd></div>
            <div data-if="${x}.details.ended"><dt>Ended</dt><dd>{{ ${x}.details.ended }}</dd></div>
          </dl>
          <ol class="sd-history" data-if="${x}.details.hasHistory" aria-label="History">
            <li data-each="${x}.details.history as h">{{ h.text }}</li>
          </ol>
        </details>`;

const TEMPLATE = `
<div class="sd-quests">
  <section class="ss-listcard ss-glass sd-active" aria-label="Quests">
    <h4 class="ss-label ss-listcard-head sd-h">Quests <small data-if="q.board.hasActive">{{ len(q.board.active) }}</small></h4>
    <p class="ss-listcard-empty" data-if="!q.board.hasActive">No quests taken on.</p>
    <ul class="ss-listcard-rows">
      <li class="ss-listcard-row sd-quest" data-each="q.board.active as a" data-quest="{{ a.id }}"
          data-class="sd-met: a.ready; sd-ready: a.status.state == 'here'">
        <div class="ss-listcard-item">
          <span class="ss-listcard-main">
            <span class="ss-listcard-title">{{ a.key }}</span>
            <span class="ss-listcard-sub" data-if="a.goal">{{ a.goal }}</span>
            <span class="sd-meta">
              <span data-if="a.giver">From {{ a.giver }}</span>
              <span data-if="a.due">Due {{ a.due }}</span>
            </span>
          </span>
          <span class="ss-listcard-value" data-if="a.reward"><span class="ss-pill ss-pill-soft">{{ a.reward }}</span></span>
        </div>
        <div class="sd-bar" data-if="a.meter">
          <ss-widget name="ss.bar" data-props='{"value":{{ a.progress.have }},"max":{{ a.progress.need }},"label":"{{ a.progress.label }}","text":"{{ a.progress.have }} of {{ a.progress.need }}"}'></ss-widget>
        </div>
        <p class="sd-status" data-state="{{ a.status.state }}" role="note"><span class="ss-listcard-tag">{{ a.status.text }}</span></p>
        <p class="sd-line sd-step" data-if="a.note"><span class="ss-pill">Now</span> {{ a.note }}</p>${details('a')}
      </li>
    </ul>
  </section>

  <details class="ss-glass sd-finished" data-if="q.board.hasFinished">
    <summary class="ss-label sd-h">Finished <small>{{ q.board.finishedCount }}</small></summary>
    <ul class="ss-listcard-rows">
      <li class="ss-listcard-row sd-done" data-each="q.board.finished as f" data-quest="{{ f.id }}" data-outcome="{{ f.outcome }}">
        <div class="ss-listcard-item">
          <span class="ss-listcard-main">
            <span class="ss-listcard-title">{{ f.key }}</span>
            <span class="ss-listcard-sub" data-if="f.reason">{{ f.reason }}</span>
          </span>
          <span class="ss-listcard-tag sd-outcome">{{ f.outcomeText }}</span>
        </div>
        <p class="sd-line sd-owed" data-if="f.details.owed">{{ f.details.owed }}</p>${details('f')}
      </li>
    </ul>
  </details>
</div>
`;

const CSS = `${BASE_CSS}
.sd-quests { display: grid; gap: 14px; padding: 4px 0; min-width: 0; }
.sd-active, .sd-finished { min-width: 0; }
.sd-finished { padding: 8px 12px; }
.sd-finished > summary { cursor: pointer; list-style-position: inside; min-height: 28px; padding: 4px 0; }
.sd-quest, .sd-done { min-width: 0; }
.sd-quest > .ss-listcard-item, .sd-done > .ss-listcard-item { align-items: flex-start; }
.sd-quest .ss-listcard-main, .sd-done .ss-listcard-main { min-width: 0; }
.sd-quest .ss-listcard-title, .sd-done .ss-listcard-title, .sd-quest .ss-listcard-sub, .sd-done .ss-listcard-sub {
  overflow-wrap: anywhere; word-break: break-word; }
.sd-quest .ss-listcard-value { max-width: 45%; min-width: 0; }
.sd-quest .ss-pill, .sd-quest .ss-listcard-value .ss-pill { max-width: 100%; white-space: normal; overflow-wrap: anywhere; }
.sd-meta { margin-top: 2px; }
.sd-bar { padding: 0 6px; margin: 2px 0 6px; }
.sd-met .sd-bar .ss-bar { --ss-bar-color: var(--sd-good); }
.sd-status { margin: 0 6px 4px; min-width: 0; }
/* The status tag: its tone is the state's (Ready to turn in: good; Not yet: muted), and it wraps. */
.sd-status .ss-listcard-tag { display: inline-block; max-width: 100%; white-space: normal; overflow-wrap: anywhere;
  line-height: 1.35; padding: 3px 10px; }
.sd-status[data-state="here"] .ss-listcard-tag, .sd-status[data-state="ready"] .ss-listcard-tag { --ss-ring: var(--sd-good); }
.sd-status[data-state="notyet"] .ss-listcard-tag { --ss-ring: var(--sd-warn); }
.sd-status[data-state="untaken"] .ss-listcard-tag { --ss-ring: var(--sd-muted); }
.sd-ready > .ss-listcard-item { background: color-mix(in srgb, var(--sd-good) 12%, transparent); border-radius: var(--ss-radius-s); }
.sd-step { margin: 0 6px 4px; }
.sd-step .ss-pill { margin-right: 4px; }
.sd-more { margin: 0 6px 4px; }
.sd-more > summary { cursor: pointer; min-height: 28px; padding: 4px 0; font-size: 0.85em; color: var(--sd-muted); }
.sd-more[open] { padding: 6px 10px; border: 1px solid var(--sd-border); border-radius: var(--sd-radius); background: var(--sd-surface); }
.sd-facts { display: grid; gap: 2px; margin: 4px 0; }
.sd-facts > div { display: grid; grid-template-columns: 6.5em minmax(0, 1fr); gap: 6px; }
.sd-facts dt { color: var(--sd-muted); }
.sd-facts dd { margin: 0; overflow-wrap: anywhere; }
.sd-history { margin: 4px 0 0; padding-left: 1.2em; font-size: 0.85em; color: var(--sd-muted); }
.sd-history li { overflow-wrap: anywhere; }
.sd-done { padding-bottom: 4px; }
.sd-done .sd-outcome { --ss-ring: var(--sd-muted); }
.sd-done[data-outcome="done"] .sd-outcome { --ss-ring: var(--sd-good); }
.sd-done[data-outcome="failed"] .sd-outcome, .sd-done[data-outcome="abandoned"] .sd-outcome { --ss-ring: var(--sd-warn); }
.sd-done .sd-outcome { white-space: normal; max-width: 40%; }
.sd-owed { margin: 0 6px; color: var(--sd-muted); }
`;

export const questsScreen = Object.freeze({
    id: QUESTS_ID,
    title: 'Quests',
    icon: 'fa-scroll',
    mounts: ['tab', 'screen'],
    data: { board: { query: 'quest.board' } },
    template: TEMPLATE,
    css: CSS,
});
