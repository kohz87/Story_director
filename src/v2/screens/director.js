// Story Director v2, part screens: `story-director/director` (SPEC §13.1), the Director tab and
// game-view screen: the story time on the chat's calendar (`director.time`) and the place in its header,
// the arc panel (widget `story-director.arc`, arc/widget.js), then the threads the reader may see
// (quests, hooks, world events) grouped by kind (open ones first, closed ones folded under them), then
// behind the scenes (widget `story-director.behind`: agendas, beats, clocks and secrets, hidden behind
// Reveal per chat, reveal.js), then the problems the last replies' Director lines had about the rest,
// newest first. Secrets show by name only. Read-only: the threads come from `director.threads` (bindings per kind: all, open, closed), the
// problems from `director.problems` (their `{{user}}` written out; one about an offer or a missing goal
// only while that is still so). An older chat's offer, which the Quests tab no longer shows, is tagged
// "offered" here.

import { BASE_CSS } from './style.js';
import { BEHIND } from './reveal.js';
import { BEHIND_WIDGET } from './behind.js';
import { ARC_WIDGET } from '../arc/widget.js';

export const DIRECTOR_ID = 'story-director/director';

/** The kinds in the order the screen shows them, with their headings (the tracker tab's order). */
export const KIND_GROUPS = Object.freeze([
    ['quest', 'Quests'], ['hook', 'Hooks'], ['agenda', 'Off-screen'], ['event', 'World'],
    ['clock', 'Clocks'], ['beat', 'Beats'], ['secret', 'Secrets'],
]);

/** The kinds the template itself draws: what the reader may see (the rest is behind the scenes, behind.js). */
export const OPEN_KIND_GROUPS = Object.freeze(KIND_GROUPS.filter(([kind]) => !BEHIND.has(kind)));

// What a thread line shows: its key, then what the story last said of it. Secrets: the name only.
function threadItem(list, kind) {
    if (kind === 'secret') {
        return `<li class="sd-thread" data-each="${list} as t" data-thread="{{ t.id }}"><span class="sd-key">{{ t.key }}</span></li>`;
    }
    return `<li class="sd-thread" data-each="${list} as t" data-thread="{{ t.id }}">
          <span class="sd-key">{{ t.key }}</span>
          <span class="sd-tag" data-if="t.offer">offered</span>
          <span class="sd-tag sd-ready" data-if="t.ready">ready</span>
          <span class="sd-tag sd-outcome" data-if="t.ended">{{ t.ended.outcome }}</span>
          <p class="sd-line" data-if="t.summary">{{ t.summary }}</p>
          <p class="sd-meta">
            <span data-if="t.fields.step">Now: {{ t.fields.step }}</span>
            <span data-if="t.fields.now">At: {{ t.fields.now }}</span>
            <span data-if="t.fields.then">Next: {{ t.fields.then }}</span>
            <span data-if="t.fields.giver">From {{ t.fields.giver }}</span>
            <span data-if="t.fields.due">Due {{ t.fields.due }}</span>
            <span data-if="t.fields.on">On {{ t.fields.on }}</span>
            <span data-if="t.fields.arrive">Arrives {{ t.fields.arrive }}</span>
          </p>
        </li>`;
}

function section(kind, title) {
    const every = `q.${kind}`;
    const open = `q.${kind}_open`;
    const closed = `q.${kind}_closed`;
    return `
  <section class="sd-kind" data-kind="${kind}" data-if="len(${every})">
    <h4 class="sd-h">${title} <small data-if="len(${open})">{{ len(${open}) }}</small></h4>
    <ul class="sd-list sd-threads">
        ${threadItem(open, kind)}
    </ul>
    <details class="sd-closed" data-if="len(${closed})">
      <summary>Closed <small>{{ len(${closed}) }}</small></summary>
      <ul class="sd-list sd-threads">
        ${threadItem(closed, kind)}
      </ul>
    </details>
  </section>`;
}

const TEMPLATE = `
<div class="sd-director">
  <header class="sd-clock" data-if="q.time.text" role="status" aria-label="Story time">
    <i class="fa-solid fa-clock" aria-hidden="true"></i> <span class="sd-when">{{ q.time.text }}</span>
    <span class="sd-where" data-if="state.scene.place.name">· {{ state.scene.place.name }}</span>
  </header>
  <ss-widget class="sd-wide" name="${ARC_WIDGET}" data-props='{"bind":"q.arc"}'></ss-widget>
  <p class="sd-empty" data-if="!len(q.all)">Nothing tracked yet.</p>
${OPEN_KIND_GROUPS.map(([kind, title]) => section(kind, title)).join('\n')}
  <ss-widget class="sd-wide" name="${BEHIND_WIDGET}" data-props='{"bind":"q.behind"}' data-if="q.behind.total"></ss-widget>
  <section class="sd-kind sd-problems-box" data-kind="problems" data-if="len(q.problems)">
    <h4 class="sd-h">Problems <small>{{ len(q.problems) }}</small></h4>
    <ol class="sd-list sd-problems">
      <li class="sd-problem" data-each="q.problems as p" data-kind="{{ p.kind }}">
        <span class="sd-tag">{{ p.kind }}</span> {{ p.text }}
      </li>
    </ol>
  </section>
</div>
`;

const CSS = `${BASE_CSS}
.sd-director { display: grid; gap: 14px; padding: 4px 0; }
.sd-clock { margin: 0; font-size: 0.9em; overflow-wrap: anywhere; }
.sd-clock i { color: var(--sd-accent); margin-right: 2px; }
.sd-threads { gap: 6px; }
.sd-thread { padding: 6px 10px; border-left: 3px solid var(--sd-accent); border-radius: 4px;
  background: var(--sd-surface); overflow-wrap: anywhere; }
.sd-thread .sd-tag { margin-left: 4px; }
.sd-closed > summary { cursor: pointer; padding: 6px 0; opacity: 0.75; }
.sd-closed .sd-thread { border-left-color: var(--sd-border); opacity: 0.75; }
.sd-kind[data-kind="clock"] .sd-thread { border-left-color: var(--sd-warn); }
.sd-kind[data-kind="secret"] .sd-thread { border-left-style: dashed; }
/* Problems are stored oldest first; the newest is shown on top. */
.sd-problems { display: flex; flex-direction: column-reverse; max-height: 18em; overflow-y: auto; gap: 4px; }
.sd-problem { padding: 4px 0; border-bottom: 1px solid var(--sd-border); font-size: 0.9em; overflow-wrap: anywhere; }
/* The arc panel and behind the scenes (widgets drawn into this screen, so this sheet styles them too). */
.sd-arc { display: grid; gap: 6px; padding: 8px 10px; border: 1px solid var(--sd-border); border-radius: var(--sd-radius);
  background: var(--sd-surface); min-width: 0; }
.sd-arc .sd-h { margin: 0; }
.sd-arc-desc, .sd-arc-head, .sd-arc-note, .sd-arc-needs { margin: 0; overflow-wrap: anywhere; }
.sd-arc-note, .sd-arc-needs, .sd-arc-none { font-size: 0.9em; opacity: 0.85; }
.sd-arc-text { width: 100%; min-height: 9em; font-family: inherit; font-size: 0.9em; resize: vertical; box-sizing: border-box; }
.sd-arc-findings { gap: 2px; font-size: 0.85em; opacity: 0.85; }
.sd-arc-finding.sd-warn { color: var(--sd-warn); }
/* Buttons keep their icon and label on one line (SillyTavern's menu_button is a flex box, which drops the space). */
.sd-arc .sd-btn, .sd-behind .sd-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; white-space: nowrap; }
.sd-behind { display: grid; gap: 14px; min-width: 0; }
.sd-lock { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 10px; align-items: start; padding: 8px 10px;
  border: 1px dashed var(--sd-border); border-radius: var(--sd-radius); }
.sd-lock-icon { margin-top: 3px; color: var(--sd-accent); }
.sd-lock-text { display: grid; gap: 2px; min-width: 0; }
.sd-lock .sd-actions { grid-column: 1 / -1; }
.sd-unlocked { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; font-size: 0.9em; opacity: 0.85; }
.sd-unlocked .sd-btn { flex: 0 0 auto; }
@media (min-width: 720px) {
  .sd-director { grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); align-items: start; }
  .sd-empty, .sd-clock, .sd-wide { grid-column: 1 / -1; }
  .sd-behind { grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); align-items: start; }
  .sd-unlocked, .sd-lock, .sd-behind .sd-problems-box { grid-column: 1 / -1; }
}
`;

const data = {
    time: { query: 'director.time' },
    all: { query: 'director.threads' },
    // The problems about what the reader may see; those behind the scenes are in `behind`.
    problems: { query: 'director.problems', args: { behind: false } },
    arc: { query: 'director.arc' },
    behind: { query: 'director.behind' },
};
for (const [kind] of OPEN_KIND_GROUPS) {
    data[kind] = { query: 'director.threads', args: { kind } };
    data[`${kind}_open`] = { query: 'director.threads', args: { kind, status: 'active' } };
    data[`${kind}_closed`] = { query: 'director.threads', args: { kind, status: 'resolved' } };
}

export const directorScreen = Object.freeze({
    id: DIRECTOR_ID,
    title: 'Director',
    icon: 'fa-compass',
    mounts: ['tab', 'screen'],
    data,
    template: TEMPLATE,
    css: CSS,
});
