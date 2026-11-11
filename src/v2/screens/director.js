// Story Director v2, part screens: `story-director/director` (SPEC §13.1), the Director screen: the author's view of the plan,
// in the game view only (no tab mount, so never in the Story panel's strip; always in the game view's bar, no switch). It shows
// everything, so it says so ("shows spoilers"); there is no Reveal step and the `screens.hideBehind` setting is harmless here.
//
// Cards, each short (the first few rows and "+N more" that opens it, no inner scroll box): the arc (widget `story-director.arc`,
// opened: name, beats played, what it is about, Plan next arc / End arc), then widget `story-director.plan` (behind.js, from
// `director.plan`): Beats, "Hooks the story is planning" (with Next), Off-screen (agendas: wants, At, Next), Secrets and
// Problems (those about the visible threads, then those behind the scenes). No clock line (the hero header has it), no Quests
// (the Quests tab) and no World list (World's News). The beats, off-screen and secrets belong to the feature
// `story-director.threads` (src/v2/threads.js). Read-only but for the arc's own tools.

import { BASE_CSS } from './style.js';
import { BEHIND } from './reveal.js';
import { PLAN_WIDGET, RIPPLES_WIDGET } from './behind.js';
import { ARC_WIDGET } from '../arc/widget.js';

export const DIRECTOR_ID = 'story-director/director';

/** The kinds in the order the screen shows them, with their headings (the tracker tab's order). */
export const KIND_GROUPS = Object.freeze([
    ['quest', 'Quests'], ['hook', 'Hooks'], ['agenda', 'Off-screen'], ['event', 'World'],
    ['clock', 'Clocks'], ['beat', 'Beats'], ['secret', 'Secrets'],
]);

/** The kinds the template itself draws: what the reader may see (the rest is behind the scenes, behind.js). */
export const OPEN_KIND_GROUPS = Object.freeze(KIND_GROUPS.filter(([kind]) => !BEHIND.has(kind)));

const TEMPLATE = `
<div class="sd-director">
  <header class="sd-dir-head sd-wide">
    <h3 class="sd-dir-title">Director</h3>
    <span class="ss-pill sd-spoil">shows spoilers</span>
  </header>
  <ss-widget class="sd-wide" name="${ARC_WIDGET}" data-props='{"bind":"q.arc","open":"true"}'></ss-widget>
  <p class="sd-empty sd-wide" data-if="!q.plan.any">Nothing planned yet.</p>
  <ss-widget class="sd-wide" name="${PLAN_WIDGET}" data-props='{"bind":"q.plan"}' data-if="q.plan.any"></ss-widget>
  <ss-widget class="sd-wide" name="${RIPPLES_WIDGET}" data-props='{"bind":"q.ripples"}' data-if="len(q.ripples)"></ss-widget>
</div>
`;

const CSS = `${BASE_CSS}
.sd-director { display: grid; gap: 14px; padding: 4px 0; min-width: 0; grid-template-columns: minmax(0, 1fr); align-items: start; }
.sd-director > * { min-width: 0; }
.sd-director > ss-widget { display: block; }
.sd-empty, .sd-wide { grid-column: 1 / -1; }
.sd-dir-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 10px; }
.sd-dir-title { margin: 0; font-size: 1.1em; font-weight: 700; }
.sd-spoil { border-color: var(--sd-warn); color: var(--sd-warn); font-weight: 600; }
.sd-kind { min-width: 0; }
.sd-thread .sd-key, .sd-thread .sd-line { overflow-wrap: anywhere; }
.sd-thread .sd-meta { margin-top: 2px; }
.sd-outcome { text-transform: lowercase; }
/* Problems and every card list grow with their rows (a card shows the first few and "+N more"): no inner scroll box. */
.sd-problem { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 4px 8px; font-size: 0.9em; }
.sd-problem .sd-ptag { flex: 0 1 auto; max-width: 24ch; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sd-more { justify-self: start; min-height: 40px; }
.sd-plan-card { display: grid; gap: 4px; padding: 12px 14px; align-content: start; }
.sd-arc.ss-listcard { gap: 8px; }
/* The arc panel and behind the scenes (widgets drawn into this screen, so this sheet styles them too). */
.sd-arc { display: grid; gap: 8px; min-width: 0; }
.sd-arc .sd-h { margin: 0; }
.sd-arc-desc, .sd-arc-head, .sd-arc-note, .sd-arc-needs { margin: 0; overflow-wrap: anywhere; }
.sd-arc-note, .sd-arc-needs, .sd-arc-none { font-size: 0.9em; color: var(--sd-muted); }
.sd-arc-text { width: 100%; min-height: 9em; font: inherit; font-size: 0.9em; resize: vertical; box-sizing: border-box; }
.sd-arc-findings { gap: 2px; font-size: 0.85em; color: var(--sd-muted); }
.sd-arc-finding.sd-warn { border-left: 3px solid var(--sd-warn); padding-left: 6px; }
/* Buttons keep their icon and label on one line (the block's button is a flex box with a gap). */
.sd-arc .sd-btn, .sd-behind .sd-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; white-space: nowrap; }
.sd-behind { display: grid; gap: 14px; min-width: 0; grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr)); align-items: start; }
.sd-behind > * { min-width: 0; }
.sd-lock { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 10px; align-items: start; padding: 10px 12px;
  border: 1px dashed var(--sd-border); border-radius: var(--ss-radius-l); min-width: 0; }
.sd-lock-icon { margin-top: 3px; color: var(--sd-accent); }
.sd-lock-text { display: grid; gap: 2px; min-width: 0; }
.sd-lock .sd-actions { grid-column: 1 / -1; }
.sd-closed { padding: 2px 0; }
.sd-closed > summary { cursor: pointer; min-height: 40px; display: flex; align-items: center; gap: 6px; color: var(--sd-muted); }
.sd-unlocked { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; font-size: 0.9em; color: var(--sd-muted); }
.sd-unlocked .sd-btn { flex: 0 0 auto; }
.sd-unlocked, .sd-lock, .sd-behind .sd-problems-box { grid-column: 1 / -1; }
.sd-ripples { display: grid; min-width: 0; }
.sd-ripple { display: grid; gap: 2px; padding: 4px 0; }
.sd-ripple-bar { display: block; height: 6px; border-radius: 3px; background: var(--sd-border); overflow: hidden; }
.sd-ripple-fill { display: block; height: 100%; background: var(--sd-accent); }
`;

const data = {
    arc: { query: 'director.arc' },
    // The cards below the arc: the hooks with their Next, and (threads feature on) beats, off-screen, secrets, then every problem.
    plan: { query: 'director.plan' },
    // Each pack power's hidden sway (the Ripples card; empty without a pack table), always shown (no Reveal).
    ripples: { query: 'ripples.sway' },
};

export const directorScreen = Object.freeze({
    id: DIRECTOR_ID,
    title: 'Director',
    icon: 'fa-compass',
    // Game view only: no `tab` mount, so the Story panel's strip never has it; `bar` puts it in the game view's bar.
    mounts: ['screen'],
    bar: true,
    data,
    template: TEMPLATE,
    css: CSS,
});
