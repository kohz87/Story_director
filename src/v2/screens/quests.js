// Story Director v2, part screens: `story-director/quests` (SPEC §13.1), the Quests tab and game-view
// screen. Offers, active quests with their progress as an `ss.meter` ("Wolves 8/3") and the rolling
// progress note, finished quests folded away. No buttons (F95): taking on, turning down and giving up come
// from the reader's own words, turning in from the story (code checks and pays); each row says where the
// quest stands instead ("Ready to turn in — 3/3 wolves", "Not yet: 2/3 wolves", "Offered — say you take
// it"). Every row opens its details (F84: goal, progress note, terms, giver, due, taken and ended dates,
// history) in a screen-local `<details>` panel: templates have no dialog to open with a quest's data. The
// commands stay in the SDK for a card's or pack's own buttons. Everything comes from `quest.board`
// (queries.js), on the head state.

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
  <section class="sd-offers" data-if="q.board.hasOffers" aria-label="Offered">
    <h4 class="sd-h">Offered <small>{{ len(q.board.offers) }}</small></h4>
    <ul class="sd-list">
      <li class="sd-card sd-offer" data-each="q.board.offers as o" data-quest="{{ o.id }}">
        <span class="sd-key">{{ o.key }}</span>
        <p class="sd-line" data-if="o.goal">{{ o.goal }}</p>
        <p class="sd-meta">
          <span data-if="o.giver">From {{ o.giver }}</span>
          <span data-if="o.reward">Reward: {{ o.reward }}</span>
          <span data-if="o.due">Due {{ o.due }}</span>
        </p>
        <p class="sd-status" data-state="{{ o.status.state }}" role="note">{{ o.status.text }}</p>${details('o')}
      </li>
    </ul>
  </section>

  <section class="sd-active" aria-label="Quests">
    <h4 class="sd-h">Quests <small data-if="q.board.hasActive">{{ len(q.board.active) }}</small></h4>
    <p class="sd-empty" data-if="!q.board.hasActive">No quests taken on.</p>
    <ul class="sd-list">
      <li class="sd-card sd-quest" data-each="q.board.active as a" data-quest="{{ a.id }}"
          data-class="sd-met: a.ready; sd-ready: a.status.state == 'here'">
        <span class="sd-key">{{ a.key }}</span>
        <p class="sd-line" data-if="a.goal">{{ a.goal }}</p>
        <p class="sd-line sd-step" data-if="a.note"><span class="sd-tag">Now</span> {{ a.note }}</p>
        <p class="sd-meta">
          <span data-if="a.giver">From {{ a.giver }}</span>
          <span data-if="a.reward">Reward: {{ a.reward }}</span>
          <span data-if="a.due">Due {{ a.due }}</span>
        </p>
        <div class="sd-progress" data-if="a.meter">
          <ss-widget name="ss.meter" data-props='{"value":{{ a.progress.have }},"max":{{ a.progress.need }},"label":"{{ a.progress.label }}","text":"{{ a.progress.have }} of {{ a.progress.need }}","showValue":false,"tone":"accent"}'></ss-widget>
        </div>
        <p class="sd-status" data-state="{{ a.status.state }}" role="note">{{ a.status.text }}</p>${details('a')}
      </li>
    </ul>
  </section>

  <details class="sd-finished" data-if="q.board.hasFinished">
    <summary class="sd-h">Finished <small>{{ q.board.finishedCount }}</small></summary>
    <ul class="sd-list">
      <li class="sd-done" data-each="q.board.finished as f" data-quest="{{ f.id }}" data-outcome="{{ f.outcome }}">
        <span class="sd-key">{{ f.key }}</span> <span class="sd-tag">{{ f.outcomeText }}</span>
        <small data-if="f.reason"> — {{ f.reason }}</small>${details('f')}
      </li>
    </ul>
  </details>
</div>
`;

const CSS = `${BASE_CSS}
.sd-quests { display: grid; gap: 14px; padding: 4px 0; }
.sd-progress { margin-top: 2px; }
.sd-progress .ss-w-meter-label { font-weight: bold; font-variant-numeric: tabular-nums; }
.sd-met .sd-progress .ss-w-meter { --ss-w-tone: var(--sd-good); }
.sd-status { margin: 2px 0 0; font-size: 0.9em; }
.sd-status[data-state="here"] { color: var(--sd-good); font-weight: bold; }
.sd-status[data-state="ready"] { color: var(--sd-good); }
.sd-status[data-state="notyet"], .sd-status[data-state="untaken"] { opacity: 0.8; }
.sd-ready { border-color: var(--sd-good); }
.sd-more > summary { cursor: pointer; min-height: 28px; padding: 4px 0; font-size: 0.85em; opacity: 0.8; }
.sd-more[open] { padding: 6px 10px; border: 1px solid var(--sd-border); border-radius: var(--sd-radius);
  background: var(--sd-surface); }
.sd-facts { display: grid; gap: 2px; margin: 4px 0; }
.sd-facts > div { display: grid; grid-template-columns: 6.5em 1fr; gap: 6px; }
.sd-facts dt { opacity: 0.7; }
.sd-facts dd { margin: 0; overflow-wrap: anywhere; }
.sd-history { margin: 4px 0 0; padding-left: 1.2em; font-size: 0.85em; opacity: 0.85; }
.sd-history li { overflow-wrap: anywhere; }
.sd-step .sd-tag { margin-right: 4px; }
.sd-finished > summary { cursor: pointer; list-style-position: inside; padding: 8px 0; min-height: 28px; }
.sd-finished .sd-list { gap: 4px; }
.sd-done { padding: 4px 0; border-bottom: 1px solid var(--sd-border); overflow-wrap: anywhere; }
.sd-done .sd-key { color: inherit; font-weight: normal; }
.sd-done[data-outcome="done"] .sd-tag { border-color: var(--sd-good); }
.sd-done[data-outcome="failed"] .sd-tag { border-color: var(--sd-warn); }
@media (min-width: 720px) {
  .sd-offers .sd-list, .sd-active .sd-list { grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); }
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
