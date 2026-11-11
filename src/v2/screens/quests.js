// Neutral goals and old quest history, read through SD threads without an RPG dependency.

import { BASE_CSS } from './style.js';
import { QUESTS_WIDGET } from './quest-cards.js';

export const QUESTS_ID = 'story-director/quests';

// SD's neutral/read-only view uses only its own retained projection, including old quests. The cards are the widget
// `story-director.quests` (quest-cards.js, display only). The plain list under it is what a Story Block with no widgets
// shows (the renderer's "no widget" note is hidden); once the widget has drawn it marks its host `sd-qw-drawn` and the CSS hides the list.
const TEMPLATE = `
<div class="sd-quests">
  <ss-widget class="sd-qw" name="${QUESTS_WIDGET}" data-props='{"bind":"q.threads"}'></ss-widget>
  <section class="ss-listcard ss-glass sd-plain" aria-label="Goals and quest history">
    <h4>Goals and quest history</h4>
    <ul class="sd-cards">
      <li class="sd-card" data-each="q.threads as t" data-if="t.kind == 'quest' || t.rpg != null || t.fields.goal != null">
        <b>{{ t.key }}</b><p>{{ t.summary }}</p>
        <p>{{ t.fields.goal }}</p><p>{{ t.fields.progress }}</p><p>{{ t.fields.step }}</p>
        <p>{{ t.status }}</p><p data-if="t.offer">Offered</p>
        <p data-if="t.rpg != null || t.owed != null || t.ready != null">From an earlier version (read only)</p>
        <p data-if="t.owed != null && t.rpg == null">Reward from an earlier version: {{ t.owed.text }}</p>
      </li>
    </ul>
  </section>
</div>`;

// Every quest is one card: the header (title, then the pills: status and reward; the pills move under the title when the
// screen is narrow, 420px or less), the summary, "From" in small text, the progress bar, "Now:" and the Details fold.
// The same markup in the Story panel and the game view; the game view lays the cards out in columns (320px or more each).
const CSS = `${BASE_CSS}
.sd-quests { display: grid; gap: 14px; padding: 4px 0; min-width: 0; container-type: inline-size; }
.sd-active, .sd-finished { min-width: 0; }
.sd-qw { display: block; min-width: 0; }
.sd-qw-drawn + .sd-plain { display: none; }
/* A host with no such widget writes its own "no widget" note into this element: hidden, the plain list is all there is. */
.sd-qw.ss-widget-missing { display: none; }
/* The quest cards (quest-cards.js): Story Block's quest-card look as Story Director's copy, on its tokens with fallbacks. */
.sd-q-root { display: flex; flex-direction: column; gap: 10px; min-width: 0; color: var(--ss-text, inherit); }
.sd-q-root * { box-sizing: border-box; }
.sd-q-sec { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.sd-q-label { margin: 0; font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--ss-muted, color-mix(in srgb, currentColor 65%, transparent)); }
.sd-q-list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 460px)); gap: 8px; }
.sd-q { display: grid; align-content: start; gap: 5px; padding: 10px 12px; border: 1px solid var(--ss-border, color-mix(in srgb, currentColor 25%, transparent)); border-radius: var(--ss-radius, var(--ss-radius-m, 10px)); background: var(--ss-surface, transparent); min-width: 0; }
.sd-q1 { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: center; }
.sd-qt { font-size: 15px; font-weight: 600; min-width: 0; overflow-wrap: anywhere; }
.sd-chip { display: inline-flex; align-items: center; padding: 0 .55em; border-radius: 999px; font-size: 12px; line-height: 1.35; border: 1px solid currentColor; white-space: nowrap; }
.sd-chip-accent { color: var(--ss-accent, currentColor); }
.sd-chip-good { color: var(--ss-good, seagreen); }
.sd-chip-bad { color: var(--ss-bad, indianred); }
.sd-chip-neutral { color: var(--ss-muted, color-mix(in srgb, currentColor 65%, transparent)); }
.sd-q2 { margin: 0; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; color: var(--ss-muted, color-mix(in srgb, currentColor 65%, transparent)); font-size: 13px; line-height: 1.4; overflow-wrap: anywhere; }
.sd-q2[data-open="true"] { -webkit-line-clamp: unset; display: block; }
.sd-q3 { display: flex; align-items: center; gap: 6px; font-size: 13px; min-width: 0; }
.sd-q3[hidden] { display: none; }
.sd-q-icon { flex: none; width: 14px; height: 14px; color: var(--ss-accent, currentColor); }
.sd-q-icon.sd-q-done { color: var(--ss-good, seagreen); }
.sd-q-step { min-width: 0; overflow-wrap: anywhere; }
.sd-q-more { flex: none; margin-left: auto; margin-block: 0; font-size: 12px; }
.sd-q-more[hidden] { display: none; }
.sd-q-more:focus-visible, .sd-q-fold > summary:focus-visible { outline: 2px solid var(--ss-accent, currentColor); outline-offset: 2px; }
.sd-q-rows { display: grid; grid-template-columns: 5.6em minmax(0, 1fr); gap: 2px 8px; margin: 2px 0 0; font-size: 12.5px; }
.sd-q-rows dt { color: var(--ss-muted, color-mix(in srgb, currentColor 65%, transparent)); }
.sd-q-rows dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
.sd-q-old { margin: 0; font-size: 12px; color: var(--ss-muted, color-mix(in srgb, currentColor 65%, transparent)); overflow-wrap: anywhere; }
.sd-q-none { margin: 0; color: var(--ss-muted, color-mix(in srgb, currentColor 65%, transparent)); font-size: 13px; }
.sd-q-fold { border-top: 1px solid color-mix(in srgb, var(--ss-muted, currentColor) 22%, transparent); min-width: 0; }
.sd-q-fold > summary { display: flex; align-items: center; gap: 8px; min-height: 44px; cursor: pointer; color: var(--ss-muted, color-mix(in srgb, currentColor 65%, transparent)); font-size: 13px; font-weight: 600; list-style: none; }
.sd-q-fold > summary::-webkit-details-marker { display: none; }
.sd-q-fold > summary::before { content: ""; width: 7px; height: 7px; border-right: 2px solid currentColor; border-bottom: 2px solid currentColor; transform: rotate(-45deg); transition: transform .15s; }
.sd-q-fold[open] > summary::before { transform: rotate(45deg); }
@media (prefers-reduced-motion: reduce) { .sd-q-fold > summary::before { transition: none; } }
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
/* A wide screen: at most about three columns, not rows across the whole window (a cap on the content, not a window query). */
.sd-active .sd-cards, .sd-finished .sd-cards { max-width: 1000px; }
`;

export const questsScreen = Object.freeze({
    id: QUESTS_ID,
    title: 'Quests',
    icon: 'fa-scroll',
    bar: true,
    mounts: ['tab', 'screen'],
    data: { threads: { query: 'director.threads' } },
    template: TEMPLATE,
    css: CSS,
});
