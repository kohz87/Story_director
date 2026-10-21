// Story Director v2, part screens: `story-director/quests` (SPEC §13.1), the Quests tab and game-view
// screen. Offers with Take on / Turn down; active quests with their progress as an `ss.meter`
// ("Wolves 8/3") and Finish, which stays off with the reason until the quest can be turned in;
// finished quests folded away. Everything it shows comes from `quest.board` (queries.js), on the
// head state; the buttons run the quests part's commands with `{ id }`, and those commands check
// every rule again.

import { BASE_CSS } from './style.js';

export const QUESTS_ID = 'story-director/quests';

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
        <div class="sd-actions">
          <button class="menu_button sd-btn sd-take" data-command="quest.take" data-payload='{"id":"{{ o.id }}"}' title="Take on {{ o.key }}">Take on</button>
          <button class="menu_button sd-btn sd-quiet sd-decline" data-command="quest.decline" data-payload='{"id":"{{ o.id }}"}' title="Turn down {{ o.key }}">Turn down</button>
        </div>
      </li>
    </ul>
  </section>

  <section class="sd-active" aria-label="Quests">
    <h4 class="sd-h">Quests <small data-if="q.board.hasActive">{{ len(q.board.active) }}</small></h4>
    <p class="sd-empty" data-if="!q.board.hasActive">No quests taken on.</p>
    <ul class="sd-list">
      <li class="sd-card sd-quest" data-each="q.board.active as a" data-quest="{{ a.id }}"
          data-class="sd-met: a.progress.met; sd-ready: !a.finish.blocked">
        <span class="sd-key">{{ a.key }}</span>
        <p class="sd-line" data-if="a.goal">{{ a.goal }}</p>
        <p class="sd-line sd-step" data-if="a.step"><span class="sd-tag">Now</span> {{ a.step }}</p>
        <p class="sd-meta">
          <span data-if="a.giver">From {{ a.giver }}</span>
          <span data-if="a.reward">Reward: {{ a.reward }}</span>
          <span data-if="a.due">Due {{ a.due }}</span>
        </p>
        <div class="sd-progress" data-if="a.meter">
          <ss-widget name="ss.meter" data-props='{"value":{{ a.progress.have }},"max":{{ a.progress.need }},"label":"{{ a.progress.label }}","text":"{{ a.progress.have }} of {{ a.progress.need }}","showValue":false,"tone":"accent"}'></ss-widget>
        </div>
        <div class="sd-actions">
          <button class="menu_button sd-btn sd-take" data-if="a.canTake" data-command="quest.take" data-payload='{"id":"{{ a.id }}"}' title="Count toward {{ a.key }} from now">Take on</button>
          <button class="menu_button sd-btn sd-finish" data-if="a.finish.show" data-command="quest.finish" data-payload='{"id":"{{ a.id }}"}'
                  data-bind-attr="disabled: a.finish.blocked; title: a.finish.title; aria-disabled: a.finish.blocked">Finish</button>
          <button class="menu_button sd-btn sd-quiet sd-abandon" data-command="quest.abandon" data-payload='{"id":"{{ a.id }}"}' title="Give up {{ a.key }}">Give up</button>
        </div>
        <p class="sd-reason" data-if="a.finish.reason" role="note">{{ a.finish.reason }}</p>
      </li>
    </ul>
  </section>

  <details class="sd-finished" data-if="q.board.hasFinished">
    <summary class="sd-h">Finished <small>{{ q.board.finishedCount }}</small></summary>
    <ul class="sd-list">
      <li class="sd-done" data-each="q.board.finished as f" data-quest="{{ f.id }}" data-outcome="{{ f.outcome }}">
        <span class="sd-key">{{ f.key }}</span> <span class="sd-tag">{{ f.outcomeText }}</span>
        <small data-if="f.reason"> — {{ f.reason }}</small>
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
.sd-ready .sd-finish { border-color: var(--sd-good); }
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
