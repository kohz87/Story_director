// Story Director v2, chronicle part: the Chronicle screen (SPEC §13.1), data like every screen.
//
// A tab and a full-screen view: the world events under way first (each with its state, place,
// factions, since when and the last news), then the resolved ones folded away, then the
// factions. Everything comes from `chronicle.board` (queries.js) on the head state. Each entry
// folds out an Edit form: its fields fill the screen's draft (`draft.ev[<id>]`,
// `draft.fa[<id>]`), and Save sends them as `chronicle.edit { id, … }`; an empty field keeps what
// is there and `none` clears a place, factions, an area or a stance. Resolved, Reopen and Remove
// are one click each (`chronicle.edit` with a state, `chronicle.remove`). The commands run with
// cause `ui` and check every rule again. Colours follow SillyTavern's theme through Story
// Block's --ss-* properties, as the Director's other screens do; cards and packs may restyle or
// replace it by its id.

export const CHRONICLE_ID = 'story-director/chronicle';

const STATE_OPTIONS = `<option value="">(as it is)</option><option value="looming">looming</option><option value="ongoing">ongoing</option><option value="resolved">resolved</option>`;

const TEMPLATE = `
<div class="ch">
  <section class="ch-events" aria-label="World events">
    <h4 class="ch-h">Events <small data-if="q.board.hasOpen">{{ q.board.openCount }} under way</small></h4>
    <p class="ch-empty" data-if="!q.board.hasOpen">Nothing is under way in the wider world.</p>
    <ul class="ch-list" data-if="q.board.hasOpen">
      <li class="ch-card ch-event" data-each="q.board.open as e" data-event="{{ e.id }}" data-state="{{ e.state }}">
        <div class="ch-top"><span class="ch-name">{{ e.name }}</span> <span class="ch-tag">{{ e.state }}</span></div>
        <p class="ch-line" data-if="e.summary">{{ e.summary }}</p>
        <p class="ch-meta">
          <span data-if="e.place"><i class="fa-solid fa-location-dot" aria-hidden="true"></i> {{ e.place }}</span>
          <span data-if="e.factionsText"><i class="fa-solid fa-flag" aria-hidden="true"></i> {{ e.factionsText }}</span>
          <span data-if="e.sinceText">Since {{ e.sinceText }}</span>
          <span data-if="e.updatedAgo">Last news {{ e.updatedAgo }}</span>
        </p>
        <details class="ch-edit">
          <summary>Edit</summary>
          <div class="ch-form">
            <label>Name <input data-draft="ev[e.id].name" data-bind-attr="placeholder: e.name" maxlength="80"></label>
            <label>What is happening <textarea data-draft="ev[e.id].summary" data-bind-attr="placeholder: e.summary" rows="2" maxlength="300"></textarea></label>
            <label>State <select data-draft="ev[e.id].state">${STATE_OPTIONS}</select></label>
            <label>Place <input data-draft="ev[e.id].place" data-bind-attr="placeholder: e.place" maxlength="80"></label>
            <label>Factions <input data-draft="ev[e.id].factions" data-bind-attr="placeholder: e.factionsText" maxlength="300"></label>
            <p class="ch-hint">Empty fields stay as they are; write none to clear a place or the factions.</p>
          </div>
          <div class="ch-actions">
            <button class="menu_button ch-btn ch-save" data-command="chronicle.edit" title="Save the changes to {{ e.name }}"
                    data-payload='{"id":"{{ e.id }}","name":"{{ draft.ev[e.id].name }}","summary":"{{ draft.ev[e.id].summary }}","state":"{{ draft.ev[e.id].state }}","place":"{{ draft.ev[e.id].place }}","factions":"{{ draft.ev[e.id].factions }}"}'>Save</button>
            <button class="menu_button ch-btn ch-resolve" data-command="chronicle.edit" data-payload='{"id":"{{ e.id }}","state":"resolved"}' title="{{ e.name }} is over">Resolved</button>
            <button class="menu_button ch-btn ch-quiet ch-remove" data-command="chronicle.remove" data-payload='{"id":"{{ e.id }}"}' title="Take {{ e.name }} out of the chronicle">Remove</button>
          </div>
        </details>
      </li>
    </ul>
  </section>

  <details class="ch-resolved" data-if="q.board.hasResolved">
    <summary class="ch-h">Resolved <small>{{ q.board.resolvedCount }}</small></summary>
    <ul class="ch-list ch-done-list">
      <li class="ch-done" data-each="q.board.resolved as r" data-event="{{ r.id }}">
        <span class="ch-name">{{ r.name }}</span><small data-if="r.summary"> — {{ r.summary }}</small><small class="ch-when" data-if="r.updatedText"> ({{ r.updatedText }})</small>
        <span class="ch-actions">
          <button class="menu_button ch-btn ch-quiet ch-reopen" data-command="chronicle.edit" data-payload='{"id":"{{ r.id }}","state":"ongoing"}' title="{{ r.name }} is under way again">Reopen</button>
          <button class="menu_button ch-btn ch-quiet ch-remove" data-command="chronicle.remove" data-payload='{"id":"{{ r.id }}"}' title="Take {{ r.name }} out of the chronicle">Remove</button>
        </span>
      </li>
    </ul>
  </details>

  <section class="ch-factions" aria-label="Factions">
    <h4 class="ch-h">Factions <small data-if="q.board.hasFactions">{{ q.board.factionCount }}</small></h4>
    <p class="ch-empty" data-if="!q.board.hasFactions">No factions recorded yet.</p>
    <ul class="ch-list" data-if="q.board.hasFactions">
      <li class="ch-card ch-faction" data-each="q.board.factions as f" data-faction="{{ f.id }}">
        <div class="ch-top"><span class="ch-name">{{ f.name }}</span> <span class="ch-tag" data-if="f.stance">{{ f.stance }}</span></div>
        <p class="ch-line" data-if="f.summary">{{ f.summary }}</p>
        <p class="ch-meta">
          <span data-if="f.area"><i class="fa-solid fa-location-dot" aria-hidden="true"></i> {{ f.area }}</span>
          <span data-if="f.eventsText"><i class="fa-solid fa-bolt" aria-hidden="true"></i> {{ f.eventsText }}</span>
        </p>
        <details class="ch-edit">
          <summary>Edit</summary>
          <div class="ch-form">
            <label>Name <input data-draft="fa[f.id].name" data-bind-attr="placeholder: f.name" maxlength="80"></label>
            <label>Who they are <textarea data-draft="fa[f.id].summary" data-bind-attr="placeholder: f.summary" rows="2" maxlength="300"></textarea></label>
            <label>Area <input data-draft="fa[f.id].area" data-bind-attr="placeholder: f.area" maxlength="80"></label>
            <label>Stance <input data-draft="fa[f.id].stance" data-bind-attr="placeholder: f.stance" maxlength="80"></label>
            <p class="ch-hint">Empty fields stay as they are; write none to clear an area or a stance.</p>
          </div>
          <div class="ch-actions">
            <button class="menu_button ch-btn ch-save" data-command="chronicle.edit" title="Save the changes to {{ f.name }}"
                    data-payload='{"id":"{{ f.id }}","name":"{{ draft.fa[f.id].name }}","summary":"{{ draft.fa[f.id].summary }}","area":"{{ draft.fa[f.id].area }}","stance":"{{ draft.fa[f.id].stance }}"}'>Save</button>
            <button class="menu_button ch-btn ch-quiet ch-remove" data-command="chronicle.remove" data-payload='{"id":"{{ f.id }}"}' title="Take {{ f.name }} out of the chronicle">Remove</button>
          </div>
        </details>
      </li>
    </ul>
  </section>
</div>
`;

const CSS = `
:root {
  --ch-gap: var(--ss-gap, 8px);
  --ch-radius: var(--ss-radius, 10px);
  --ch-accent: var(--ss-accent, var(--SmartThemeQuoteColor, currentColor));
  --ch-border: var(--ss-border, var(--SmartThemeBorderColor, rgba(127, 127, 127, 0.35)));
  --ch-surface: var(--ss-chat-surface, var(--SmartThemeBlurTintColor, transparent));
  --ch-warn: var(--ss-w-warn, #e0a030);
  --ch-good: var(--ss-w-good, #5cb85c);
  color: var(--ss-text, var(--SmartThemeBodyColor, inherit));
}
.ch { display: grid; gap: 14px; padding: 4px 0; }
.ch-h { display: flex; align-items: baseline; gap: 6px; margin: 0 0 6px; font-size: 1em; }
.ch-h small { opacity: 0.65; font-weight: normal; }
.ch-list { display: grid; gap: var(--ch-gap); margin: 0; padding: 0; list-style: none; }
.ch-card { display: grid; gap: 4px; padding: 10px 12px; border: 1px solid var(--ch-border);
  border-radius: var(--ch-radius); background: var(--ch-surface); min-width: 0; }
.ch-top { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; }
.ch-name { font-weight: bold; color: var(--ch-accent); overflow-wrap: anywhere; }
.ch-line { margin: 0; overflow-wrap: anywhere; }
.ch-meta { display: flex; flex-wrap: wrap; gap: 4px 12px; margin: 0; font-size: 0.85em; opacity: 0.8; }
.ch-meta:not(:has(*)) { display: none; }
.ch-meta i { color: var(--ch-accent); margin-right: 2px; }
.ch-tag { display: inline-block; padding: 0 6px; border-radius: 999px; font-size: 0.75em; line-height: 1.6;
  border: 1px solid var(--ch-border); opacity: 0.85; white-space: nowrap; }
.ch-event[data-state="looming"] .ch-tag { border-color: var(--ch-warn); }
.ch-event[data-state="ongoing"] .ch-tag { border-color: var(--ch-accent); }
.ch-edit > summary { cursor: pointer; font-size: 0.85em; opacity: 0.8; min-height: 28px; padding: 4px 0; }
.ch-form { display: grid; gap: 6px; margin: 4px 0; }
.ch-form label { display: grid; gap: 2px; font-size: 0.85em; }
.ch-form input, .ch-form textarea, .ch-form select { width: 100%; box-sizing: border-box; min-height: 36px; }
.ch-hint { margin: 0; font-size: 0.8em; opacity: 0.65; }
.ch-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
.ch-btn { min-height: 44px; min-width: 44px; margin: 0; padding: 6px 14px; flex: 1 1 auto; cursor: pointer; }
.ch-btn.ss-busy { opacity: 0.7; cursor: progress; }
.ch-quiet { background: transparent; }
.ch-empty { margin: 0; opacity: 0.65; font-style: italic; }
.ch-resolved > summary { cursor: pointer; list-style-position: inside; padding: 8px 0; min-height: 28px; }
.ch-done-list { gap: 4px; }
.ch-done { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px; padding: 4px 0; border-bottom: 1px solid var(--ch-border); overflow-wrap: anywhere; }
.ch-done .ch-name { color: inherit; font-weight: normal; }
.ch-done .ch-actions { margin: 0 0 0 auto; }
.ch-done .ch-btn { flex: 0 0 auto; }
@media (min-width: 600px) {
  .ch-btn { flex: 0 0 auto; min-height: 36px; }
}
@media (min-width: 720px) {
  .ch-events .ch-list, .ch-factions .ch-list { grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); }
}
`;

/** The Chronicle screen definition. */
export const chronicleScreen = Object.freeze({
    id: CHRONICLE_ID,
    title: 'Chronicle',
    icon: 'fa-landmark',
    mounts: Object.freeze(['tab', 'screen']),
    template: TEMPLATE,
    css: CSS,
    data: Object.freeze({
        board: Object.freeze({ query: 'chronicle.board' }),
    }),
});
