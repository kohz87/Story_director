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
    <ul class="sd-cards">
      <li class="sd-card sd-quest" data-each="q.board.active as a" data-quest="{{ a.id }}"
          data-class="sd-met: a.ready; sd-ready: a.status.state == 'here'">
        <div class="sd-head">
          <span class="sd-title" title="{{ a.key }}">{{ a.key }}</span>
          <span class="sd-pills">
            <span class="ss-pill sd-st" data-state="ready" data-if="a.status.state == 'here'" title="{{ a.status.text }}">Ready</span>
            <span class="ss-pill sd-st" data-state="notyet" data-if="a.status.state == 'notyet'" title="{{ a.status.text }}">Not yet</span>
            <span class="ss-pill ss-pill-soft sd-reward" data-if="a.reward" title="{{ a.reward }}">Reward {{ a.reward }}</span>
          </span>
        </div>
        <p class="sd-sum" data-if="a.goal">{{ a.goal }}</p>
        <p class="sd-from" data-if="a.giver">From {{ a.giver }}</p>
        <div class="sd-bar" data-if="a.meter">
          <ss-widget name="ss.bar" data-props='{"value":{{ a.progress.have }},"max":{{ a.progress.need }},"label":"{{ a.progress.label }}","text":"{{ a.progress.have }} of {{ a.progress.need }}"}'></ss-widget>
        </div>
        <p class="sd-status" data-state="{{ a.status.state }}" role="note">{{ a.status.text }}</p>
        <p class="sd-now" data-if="a.note"><b>Now:</b> <span>{{ a.note }}</span></p>${details('a')}
      </li>
    </ul>
  </section>

  <details class="ss-glass sd-finished" data-if="q.board.hasFinished">
    <summary class="ss-label sd-h">Finished <small>{{ q.board.finishedCount }}</small></summary>
    <ul class="sd-cards">
      <li class="sd-card sd-done" data-each="q.board.finished as f" data-quest="{{ f.id }}" data-outcome="{{ f.outcome }}">
        <div class="sd-head">
          <span class="sd-title" title="{{ f.key }}">{{ f.key }}</span>
          <span class="sd-pills"><span class="ss-pill sd-outcome" title="{{ f.outcomeText }}">{{ f.outcomeText }}</span></span>
        </div>
        <p class="sd-sum" data-if="f.reason">{{ f.reason }}</p>
        <p class="sd-now" data-if="f.details.owed"><b>Owed:</b> <span>{{ f.details.owed }}</span></p>${details('f')}
      </li>
    </ul>
  </details>
</div>
`;

// Every quest is one card: the header (title, then the pills: status and reward; the pills move under the title when the
// screen is narrow, 420px or less), the summary, "From" in small text, the progress bar, "Now:" and the Details fold.
// The same markup in the Story panel and the game view; the game view lays the cards out in columns (320px or more each).
const CSS = `${BASE_CSS}
.sd-quests { display: grid; gap: 14px; padding: 4px 0; min-width: 0; container-type: inline-size; }
.sd-active, .sd-finished { min-width: 0; }
.sd-finished { padding: 8px 12px; }
.sd-finished > summary { cursor: pointer; list-style-position: inside; min-height: 28px; padding: 4px 0; }
.sd-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(320px, 100%), 1fr)); gap: 8px; margin: 0; padding: 0; list-style: none; min-width: 0; }
.sd-quest, .sd-done { display: grid; gap: 8px; margin: 0; padding: 12px 14px; min-width: 0; border: 1px solid var(--sd-border); border-radius: var(--sd-radius); background: var(--sd-surface); }
.sd-quest.sd-ready { border-color: var(--sd-good); }
.sd-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; min-width: 0; }
.sd-title { flex: 1 1 12em; min-width: 0; font-weight: 800; overflow-wrap: anywhere; word-break: break-word; }
.sd-pills { display: flex; flex-wrap: wrap; gap: 6px; flex: 0 1 auto; justify-content: flex-end; min-width: 0; max-width: 100%; }
.sd-pills .ss-pill { white-space: nowrap; flex-shrink: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; margin: 0; }
.sd-st { font-weight: 700; }
.sd-st[data-state="ready"] { --ss-ring: var(--sd-good); }
.sd-st[data-state="notyet"] { --ss-ring: var(--sd-warn); }
.sd-sum, .sd-now, .sd-from, .sd-status { margin: 0; overflow-wrap: anywhere; }
.sd-status { font-size: 0.85em; color: var(--sd-muted); }
.sd-from { font-size: 0.85em; color: var(--sd-muted); }
.sd-bar { margin: 0; }
.sd-met .sd-bar .ss-bar { --ss-bar-color: var(--sd-good); }
.sd-more { margin: 0; }
.sd-more > summary { cursor: pointer; min-height: 28px; padding: 4px 0; font-size: 0.85em; color: var(--sd-muted); }
.sd-more[open] { padding: 8px 10px; border: 1px solid var(--sd-border); border-radius: var(--sd-radius); background: var(--sd-surface); }
.sd-facts { display: grid; gap: 4px; margin: 4px 0; }
.sd-facts > div { display: grid; grid-template-columns: 6.5em minmax(0, 1fr); gap: 6px; }
.sd-facts dt { color: var(--sd-muted); }
.sd-facts dd { margin: 0; overflow-wrap: anywhere; }
.sd-history { margin: 4px 0 0; padding-left: 1.2em; font-size: 0.85em; color: var(--sd-muted); }
.sd-history li { overflow-wrap: anywhere; }
.sd-done .sd-outcome { --ss-ring: var(--sd-muted); }
.sd-done[data-outcome="done"] .sd-outcome { --ss-ring: var(--sd-good); }
.sd-done[data-outcome="failed"] .sd-outcome, .sd-done[data-outcome="abandoned"] .sd-outcome { --ss-ring: var(--sd-warn); }
/* A narrow screen (the Story panel, a phone): the pills take a row of their own under the title. */
@container (max-width: 420px) {
  .sd-pills { flex-basis: 100%; justify-content: flex-start; }
}
/* The game view's wide screen: at most about three columns, not rows across the whole window. */
@media (min-width: 900px) {
  .sd-active .sd-cards, .sd-finished .sd-cards { max-width: 1000px; }
}
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
