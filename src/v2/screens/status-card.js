// Story Director v2, part screens: `story-director/status-card` (SPEC §13.1), the inline card under
// each reply (mount `card`). A clean two-column card, labels on the left: the story time, the
// place, the next thing coming due, the current goal (the active quest touched last: its goal and
// step) and that quest's progress. A card shows **that reply's** state: Story Block's card mount runs
// these bindings on `stateAt(index)`, so an older reply keeps the time, place and goal it had, and a
// line that reply changed is marked (`changed(…)` reads that reply's own changes).
// On under every reply by default, collapsed to its header (MODULES §F24): `defaultOn: true` is the field
// Story Block's screen registry reads (`cardsOn(id)`: the reader's own on/off wins, else `defaultOn`).

import { BASE_CSS } from './style.js';

export const STATUS_CARD_ID = 'story-director/status-card';

const TEMPLATE = `
<dl class="sd-status">
  <div class="sd-row sd-time" data-if="q.time.text" data-class="sd-new: changed('state.director.time')">
    <dt><i class="fa-solid fa-clock" aria-hidden="true"></i> Time</dt>
    <dd>{{ q.time.text }}</dd>
  </div>
  <div class="sd-row sd-place" data-if="state.scene.place.name" data-class="sd-new: changed('state.scene.place')">
    <dt><i class="fa-solid fa-location-dot" aria-hidden="true"></i> Place</dt>
    <dd>{{ state.scene.place.name }}<small data-if="state.scene.place.region"> · {{ state.scene.place.region }}</small></dd>
  </div>
  <div class="sd-row sd-next" data-if="q.next" data-class="sd-due: q.next.reached">
    <dt><i class="fa-solid fa-hourglass-half" aria-hidden="true"></i> Next</dt>
    <dd><b>{{ q.next.key }}</b><small data-if="q.next.when"> — {{ q.next.when }}</small><span class="sd-tag sd-due-tag" data-if="q.next.reached">due</span></dd>
  </div>
  <div class="sd-row sd-goal" data-if="q.goal" data-class="sd-new: changed(state.director.threads[q.goal.id])">
    <dt><i class="fa-solid fa-flag" aria-hidden="true"></i> Goal</dt>
    <dd><b>{{ q.goal.key }}</b><span data-if="q.goal.goal"> — {{ q.goal.goal }}</span>
      <small class="sd-step" data-if="q.goal.step">Now: {{ q.goal.step }}</small></dd>
  </div>
  <div class="sd-row sd-progress" data-if="q.progress.need" data-class="sd-met: q.progress.met">
    <dt><i class="fa-solid fa-list-check" aria-hidden="true"></i> Progress</dt>
    <dd><ss-widget name="ss.meter" data-props='{"value":{{ q.progress.have }},"max":{{ q.progress.need }},"label":"{{ q.progress.label }}","text":"{{ q.progress.have }} of {{ q.progress.need }}","showValue":false,"tone":"accent"}'></ss-widget></dd>
  </div>
</dl>
`;

const CSS = `${BASE_CSS}
.sd-status { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 2px 12px; margin: 0;
  padding: 8px 10px; border-left: 3px solid var(--sd-accent); border-radius: 6px; background: var(--sd-surface);
  font-size: 0.9em; line-height: 1.5; }
.sd-row { display: contents; }
.sd-row > dt { margin: 0; font-size: 0.8em; text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.65; white-space: nowrap; align-self: baseline; }
.sd-row > dt i { width: 1.1em; text-align: center; }
.sd-row > dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
.sd-row > dd small { opacity: 0.75; }
.sd-step { display: block; }
.sd-new > dd { color: var(--sd-accent); }
.sd-new > dt::after { content: " •"; color: var(--sd-accent); }
.sd-due > dd b { color: var(--sd-warn); }
.sd-due-tag { margin-left: 6px; border-color: var(--sd-warn); color: var(--sd-warn); }
.sd-progress > dd { align-self: center; }
.sd-progress .ss-w-meter-label { font-variant-numeric: tabular-nums; }
.sd-met .ss-w-meter { --ss-w-tone: var(--sd-good); }
@media (max-width: 360px) {
  .sd-status { grid-template-columns: minmax(0, 1fr); }
  .sd-row > dt { margin-top: 4px; }
}
`;

export const statusCardScreen = Object.freeze({
    id: STATUS_CARD_ID,
    title: 'Status',
    icon: 'fa-compass',
    mounts: ['card'],
    defaultOn: true,
    data: {
        time: { query: 'director.time' },
        next: { query: 'director.next' },
        goal: { query: 'director.goal' },
        progress: { query: 'quest.progress', args: { id: '$goal.id' } },
    },
    template: TEMPLATE,
    css: CSS,
});
