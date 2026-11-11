// Story Director v2, part screens: `story-director/director` (SPEC §13.1), the Director screen: the author's view of the plan,
// in the game view only (no tab mount, so never in the Story panel's strip; always in the game view's bar, no switch). It shows
// everything, so it says so ("shows spoilers"); there is no Reveal step and the `screens.hideBehind` setting is harmless here.
//
// Cards, each short (the first few rows and "+N more" that opens it, no inner scroll box): the arc (widget `story-director.arc`,
// opened: name, beats played, what it is about, Plan next arc / End arc), then widget `story-director.plan` (behind.js, from
// `director.plan`): Beats, "Hooks the story is planning" (with Next), Off-screen (agendas: wants, At, Next), Secrets and
// Problems (those about the visible threads, then those behind the scenes); Off-screen agendas show their step bar, place and
// "arriving within the hour" (queries.js agendaSteps). The World pulse card (feature `story-director.pulse`, query `pulse.view`) and the
// Quiet scene switch (command `director.pulse.quiet`; Story Block's game-view header has no place for a module's switch, so it sits at the top
// here) lead the screen. No clock line (the hero header has it), no Quests
// (the Quests tab) and no World list (World's News). The beats, off-screen and secrets belong to the feature
// `story-director.threads` (src/v2/threads.js). Read-only but for the arc's own tools.

import { BASE_CSS } from './style.js';
import { BEHIND } from './reveal.js';
import { PLAN_WIDGET, RIPPLES_WIDGET } from './behind.js';
import { ARC_WIDGET } from '../arc/widget.js';
import { slotValue } from '../slot.js';
import { FEATURE as PULSE_FEATURE, modeOf, resultsOf } from '../pulse/effects.js';

export const DIRECTOR_ID = 'story-director/director';

/** The kinds in the order the screen shows them, with their headings (the tracker tab's order). */
export const KIND_GROUPS = Object.freeze([
    ['quest', 'Quests'], ['hook', 'Hooks'], ['agenda', 'Off-screen'], ['event', 'World'],
    ['clock', 'Clocks'], ['beat', 'Beats'], ['secret', 'Secrets'],
]);

/** The kinds the template itself draws: what the reader may see (the rest is behind the scenes, behind.js). */
export const OPEN_KIND_GROUPS = Object.freeze(KIND_GROUPS.filter(([kind]) => !BEHIND.has(kind)));

export { PULSE_FEATURE };

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const EFFECTS = { 'chronicle.rumor': 'rumour recorded', 'cast.meet': 'someone met', 'director.pulse.arrive': 'arrival set', 'director.pulse.shift': 'agenda step moved' };
const SKIPS = { fight: 'fight under way', rest: 'resting', jump: 'time jumped ahead', quiet: 'quiet scene', clock: 'story clock not set' };
const label = kind => { const words = String(kind ?? '').toLowerCase().replace(/_/g, ' '); return words.charAt(0).toUpperCase() + words.slice(1); };

// One stored result as a row: the die ('—' for a skipped reply), its kind, its line and what it changed.
function pulseRow(entry) {
    const skipped = entry.kind === 'SKIP';
    return {
        at: entry.at, die: skipped ? '—' : String(entry.d20 ?? '—'), skipped, label: skipped ? 'Skipped' : label(entry.kind),
        text: skipped ? (SKIPS[entry.skipped] ?? 'skipped') : (entry.text || (entry.kind === 'CALM' ? 'nothing happened' : '')),
        effect: EFFECTS[entry.effect?.type] ?? '',
    };
}

/**
 * `pulse.view` → the Director screen's World pulse card (feature `story-director.pulse`; null while it is off): `{ mode, quiet, card, show, now, rollAt, table, recent, count }`.
 * `mode`: the setting (off hides the card and the switch); `quiet`: the chat's quiet-scene flag; `show`: the setting "Show the roll under replies" (the
 * status card's row, for the reply at `now.at`); `now`: the latest result as a row (null before any); `rollAt`: that reply's place when `show` (the status card draws its row only under it), else -1; `table`: "standard · 3 away"; `recent`: the
 * the earlier stored results (at most 5; the newest is `now`), newest first. Read on the state it is given, so an older reply's card shows its own.
 */
export function pulseView(state, _args, _tools, settings = null) {
    const values = (typeof settings === 'function' ? settings() : settings) ?? {};
    const mode = modeOf({ mode: values['pulse.mode'] ?? values.mode });
    const director = state?.domains?.director;
    const rows = resultsOf(director).map(pulseRow).reverse();
    const last = resultsOf(director).at(-1);
    const agendas = Object.values(isRecord(director?.threads) ? director.threads : {}).filter(thread => thread?.kind === 'agenda' && thread.status === 'active').length;
    const away = agendas + Object.keys(state?.domains?.keypeople?.away ?? {}).length
        + Object.values(isRecord(state?.domains?.cast?.people) ? state.domains.cast.people : {}).filter(person => isRecord(person) && person.alive !== false && !person.met).length;
    const card = mode !== 'off';
    const show = card && (values['pulse.showUnderReply'] ?? values.showUnderReply) === true;
    return {
        mode, quiet: slotValue(director?.pulseQuiet)?.on === true, card, show,
        now: rows[0] ?? null, rollAt: show && rows.length ? rows[0].at : -1, recent: card ? rows.slice(1) : [], count: card ? Math.max(0, rows.length - 1) : 0,
        table: last?.table ? `${last.table === 'duo' ? 'duo' : 'standard'} · ${away} away` : '',
    };
}

const TEMPLATE = `
<div class="sd-director">
  <header class="sd-dir-head sd-wide">
    <h3 class="sd-dir-title">Director</h3>
    <span class="ss-pill sd-spoil">shows spoilers</span>
  </header>
  <div class="sd-quiet sd-wide ss-glass" data-if="q.pulse.card">
    <span aria-hidden="true">🌙</span><b>Quiet scene</b><small data-if="q.pulse.quiet">pulse paused</small>
    <button type="button" class="ss-switch" role="switch" aria-checked="false" aria-label="Quiet scene" data-if="!q.pulse.quiet" data-command="director.pulse.quiet" data-payload='{"on":true}'><span class="ss-switch-knob"></span></button>
    <button type="button" class="ss-switch ss-switch-on" role="switch" aria-checked="true" aria-label="Quiet scene" data-if="q.pulse.quiet" data-command="director.pulse.quiet" data-payload='{"on":false}'><span class="ss-switch-knob"></span></button>
  </div>
  <section class="sd-kind sd-wide sd-pulse ss-glass" data-kind="pulse" data-if="q.pulse.card">
    <h4 class="sd-h">World pulse <small>this reply</small></h4>
    <div class="sd-roll" data-if="q.pulse.now">
      <span class="sd-die" data-class="sd-skip: q.pulse.now.skipped">{{ q.pulse.now.die }}</span>
      <div class="sd-rollbody"><span class="sd-pkind">{{ q.pulse.now.label }}</span>
        <p class="sd-line">{{ q.pulse.now.text }}</p>
        <div class="sd-pills"><span class="ss-pill sd-eff" data-if="q.pulse.now.effect">{{ q.pulse.now.effect }}</span> <span class="ss-pill" data-if="q.pulse.table">{{ q.pulse.table }}</span></div>
      </div>
    </div>
    <p class="sd-line sd-muted" data-if="!q.pulse.now">No roll yet.</p>
    <p class="sd-meta"><span>Swipe for a fresh roll.</span></p>
  </section>
  <section class="sd-kind sd-wide sd-pulse sd-recent ss-glass" data-kind="pulse-recent" data-if="len(q.pulse.recent)">
    <h4 class="sd-h">Recent <small>last {{ q.pulse.count }}</small></h4>
    <div class="sd-li" data-each="q.pulse.recent as r">
      <b class="sd-n">{{ r.die }}</b>
      <div class="sd-rollbody"><span class="sd-pkind" data-class="sd-skip: r.skipped">{{ r.label }}</span>
        <p class="sd-line" data-class="sd-muted: r.skipped">{{ r.text }}</p>
        <div class="sd-pills" data-if="r.effect"><span class="ss-pill sd-eff">{{ r.effect }}</span></div>
      </div>
    </div>
  </section>
  <ss-widget class="sd-wide" name="${ARC_WIDGET}" data-props='{"bind":"q.arc","open":"true"}'></ss-widget>
  <p class="sd-empty sd-wide" data-if="!q.plan.any">Nothing planned yet.</p>
  <ss-widget class="sd-wide" name="${PLAN_WIDGET}" data-props='{"bind":"q.plan"}' data-if="q.plan.any"></ss-widget>
  <ss-widget class="sd-wide" name="${RIPPLES_WIDGET}" data-props='{"bind":"q.ripples"}' data-if="len(q.ripples)"></ss-widget>
</div>
`;

const CSS = `${BASE_CSS}
/* The World pulse card (mockup-pulse): a die, its kind and line, pills that wrap as wholes; the Quiet scene switch. */
.sd-pulse { display: grid; gap: 8px; padding: 12px 14px; min-width: 0; }
.sd-roll { display: grid; grid-template-columns: 48px minmax(0, 1fr); gap: 10px; align-items: center; min-width: 0; }
.sd-die { width: 48px; height: 48px; border-radius: 12px; border: 1.5px solid var(--sd-accent); display: flex; align-items: center; justify-content: center;
  font-size: 20px; font-weight: 700; background: color-mix(in srgb, var(--sd-accent) 18%, transparent); }
.sd-die.sd-skip { border-color: var(--sd-border); }
.sd-rollbody { min-width: 0; display: grid; gap: 2px; }
.sd-pkind { font-size: 0.8em; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--sd-warn); }
.sd-pkind.sd-skip, .sd-muted { color: var(--sd-muted); }
.sd-pills { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
.sd-pills .ss-pill { white-space: nowrap; }
.sd-eff { color: var(--sd-good); border-color: var(--sd-good); }
.sd-li { display: grid; grid-template-columns: 30px minmax(0, 1fr); gap: 8px; border-top: 1px solid var(--sd-border); padding-top: 6px; align-items: start; }
.sd-n { font-size: 0.9em; text-align: center; border: 1px solid var(--sd-border); border-radius: 7px; padding: 1px 0; }
.sd-quiet { display: flex; flex-direction: row; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 12px; min-width: 0; }
.sd-quiet b { flex: 1 1 auto; min-width: 0; }
.sd-quiet small { color: var(--sd-muted); }
/* An off-screen agenda's step bar (done steps filled, the current one lighter) and place line. */
.sd-stepsbox { display: grid; gap: 4px; margin-top: 4px; }
.sd-steps { display: flex; gap: 3px; }
.sd-steps i { flex: 1; height: 5px; border-radius: 3px; background: var(--sd-border); }
.sd-steps i.d { background: var(--sd-accent); }
.sd-steps i.c { background: color-mix(in srgb, var(--sd-accent) 55%, white); }
.sd-place { color: var(--sd-text); }
.sd-plan-card[data-kind="agenda"] li.sd-thread + li.sd-thread { border-top: 1px solid var(--sd-border); padding-top: 8px; margin-top: 4px; }
.sd-arriving { color: var(--sd-good); }
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
    // The World pulse card, the recent rolls and the quiet switch (feature `story-director.pulse`; null while it is off, so none is drawn).
    pulse: { query: 'pulse.view' },
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
