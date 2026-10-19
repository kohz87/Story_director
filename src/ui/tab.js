// The "Director" tab in Story Block's sidebar.
//
// Drawn like Story Block's World State board, so the two tabs read as one panel: a
// framed "now" box, quiet uppercase section labels with an icon, one entry per record
// with hairlines between, and each record's parts as short labelled rows. Everything
// arrives as parameters (the Selection from relevance.js, findings from checks.js); this
// module only draws.
//
// Record keys and values are written by the model, so every node is filled through
// textContent. Secrets are something the reader's character does not know: they are not
// in the DOM at all until their fold is opened, and leave it again when it closes.
//
// Settled records (World State Alpha's facts, or any record with `settled: yes`) are true
// and going nowhere: nothing due, nothing moving. They fold away at the end of their
// section, so the live ones read first.
//
// `formatDate(value, { record, field })`, when given, rewrites the date parts (on, due,
// arrive) for display, e.g. "Goldwane 17 · tomorrow"; a falsy result or a throw keeps
// the text as written.

import { bearing, distanceKm } from '../places.js';

const KIND_GROUPS = [
    { kind: 'agenda', label: 'Off-screen', icon: 'fa-satellite-dish' },
    { kind: 'event', label: 'World', icon: 'fa-earth-americas' },
    { kind: 'hook', label: 'Hooks', icon: 'fa-fire' },
    { kind: 'clock', label: 'Clocks', icon: 'fa-hourglass-half' },
    { kind: 'beat', label: 'Beats', icon: 'fa-flag' },
];

// Labelled rows in this order; desc heads the record as a plain line (it is what the
// record is), and labels the tracker does not know follow as written.
const FACT_FIELDS = ['goal', 'step', 'giver', 'reward', 'difficulty', 'now', 'then', 'on', 'due', 'leg', 'arrive', 'place', 'encounter', 'reach', 'people', 'shown'];
const DATE_FIELDS = new Set(['on', 'due', 'arrive']);

const SEVERITIES = [
    { severity: 'error', label: 'Errors', icon: 'fa-circle-exclamation' },
    { severity: 'warn', label: 'Warnings', icon: 'fa-triangle-exclamation' },
    { severity: 'info', label: 'Notes', icon: 'fa-circle-info' },
];

// ---------------------------------------------------------------------------
// DOM helpers (the same shapes as Story Block's editor.js)

function el(tag, { className, text, title, attrs } = {}, children = []) {
    const node = globalThis.document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    if (title) {
        node.title = title;
        node.setAttribute('aria-label', title);
    }
    for (const [name, value] of Object.entries(attrs ?? {})) node.setAttribute(name, value);
    for (const child of children) if (child) node.append(child);
    return node;
}

function icon(name) {
    return el('i', { className: `fa-solid ${name}`, attrs: { 'aria-hidden': 'true' } });
}

function button(label, className, { iconName, title, onClick } = {}) {
    const node = el('button', { className: `menu_button ${className}`, title });
    node.type = 'button';
    if (iconName) node.append(icon(iconName));
    if (label) node.append(el('span', { text: label }));
    if (onClick) node.addEventListener('click', onClick);
    return node;
}

/** The quiet section label: an icon, then the name in small capitals. */
function sub(label, iconName, count = null) {
    return el('div', { className: 'story-director-sub' }, [
        icon(iconName),
        el('span', { text: label }),
        count === null ? null : el('span', { className: 'story-director-count', text: String(count) }),
    ]);
}

function section(className, children) {
    return el('section', { className: `story-director-section ${className}` }, children);
}

// Which folds are open, by class name. The tab redraws on every chat event; a fold that
// snapped shut each time would be no use. Secrets are not remembered: they close again.
const openFolds = new Set();

/**
 * A folded section: `<details>` whose summary carries the label and a count. `fill`
 * builds the content; with `lazy` it runs only while the fold is open, and the content
 * is dropped again when it closes.
 */
function fold(className, label, iconName, count, fill, { lazy = false } = {}) {
    const body = el('div', { className: 'story-director-fold-body' });
    const details = el('details', { className: `story-director-fold ${className}` }, [
        el('summary', { className: 'story-director-fold-summary' }, [sub(label, iconName, count)]),
        body,
    ]);
    // A fill may leave gaps (null) for parts it has nothing for; append would print them.
    const parts = () => fill().filter(Boolean);
    if (!lazy) {
        body.append(...parts());
        if (openFolds.has(className)) details.open = true;
        details.addEventListener('toggle', () => {
            if (details.open) openFolds.add(className);
            else openFolds.delete(className);
        });
    } else {
        details.addEventListener('toggle', () => {
            if (details.open) body.replaceChildren(...parts());
            else body.replaceChildren();
        });
    }
    return details;
}

// ---------------------------------------------------------------------------
// Records

const text = value => String(value ?? '').trim();

const isSettled = record => /^(?:yes|true|y)$/i.test(text(record?.extra?.settled));

function dateText(value, record, field, formatDate) {
    if (typeof formatDate !== 'function' || !DATE_FIELDS.has(field)) return value;
    try {
        const formatted = formatDate(value, { record, field });
        return formatted ? String(formatted) : value;
    } catch {
        return value;
    }
}

/** [{ label, value }]: the labelled rows of a record, empty parts left out. */
function factsOf(record, formatDate) {
    const fields = record.fields ?? {};
    const facts = FACT_FIELDS.filter(field => text(fields[field])).map(field => ({ label: field, value: dateText(text(fields[field]), record, field, formatDate) }));
    for (const [label, value] of Object.entries(record.extra ?? {})) {
        // The fold a settled record sits in already says so.
        if (label === 'settled' && isSettled(record)) continue;
        if (text(value)) facts.push({ label, value: text(value) });
    }
    return facts;
}

function renderFacts(record, formatDate) {
    const list = el('dl', { className: 'story-director-facts' });
    const desc = text(record.fields?.desc);
    if (desc) list.append(el('dd', { className: 'is-plain', text: desc }));
    for (const fact of factsOf(record, formatDate)) {
        list.append(el('dt', { text: fact.label }), el('dd', { text: fact.value }));
    }
    return list.children.length ? list : null;
}

function pinButton(record, onPin) {
    const pinned = Boolean(record.pinned);
    const node = button('', `story-director-pin${pinned ? ' is-pinned' : ''}`, {
        iconName: 'fa-thumbtack',
        title: pinned ? `Unpin ${record.key}` : `Pin ${record.key}: keep it in the note, never dormant`,
        onClick: event => {
            // The pane may sit inside a clickable card; the pin is its own action.
            event?.stopPropagation?.();
            onPin(record.id, !pinned);
        },
    });
    node.setAttribute('aria-pressed', String(pinned));
    return node;
}

function renderRecord(record, { formatDate, onPin, note = '' }) {
    const item = el('li', { className: `story-director-record is-${record.kind ?? 'record'}${record.pinned ? ' is-pinned' : ''}` });
    item.dataset.recordId = record.id;
    const head = el('div', { className: 'story-director-record-head' }, [
        el('span', { className: 'story-director-record-key', text: record.key }),
        note ? el('span', { className: 'story-director-tag', text: note }) : null,
        // A planned fight (its foes are the encounter row): RPG Battle offers it when due.
        text(record.fields?.encounter) ? el('span', { className: 'story-director-tag is-fight', text: 'fight' }) : null,
        typeof onPin === 'function' ? pinButton(record, onPin) : null,
    ]);
    item.append(head);
    const facts = renderFacts(record, formatDate);
    if (facts) item.append(facts);
    return item;
}

function recordList(records, options, noteFor = () => '') {
    return el('ul', { className: 'story-director-records' }, records.map(record => renderRecord(record, { ...options, note: noteFor(record) })));
}

const KIND_LABEL = Object.fromEntries(KIND_GROUPS.map(group => [group.kind, group.label]));

// ---------------------------------------------------------------------------
// Sections

function renderNow(timeText, place) {
    const items = [
        text(timeText) ? { key: 'time', label: 'Time', icon: 'fa-clock', value: text(timeText) } : null,
        text(place) ? { key: 'place', label: 'Place', icon: 'fa-location-dot', value: text(place) } : null,
    ].filter(Boolean);
    if (!items.length) return null;
    const list = el('ul', { className: 'story-director-now', attrs: { 'aria-label': 'Now' } });
    for (const item of items) {
        list.append(el('li', { className: `story-director-now-item is-${item.key}` }, [
            icon(item.icon),
            el('span', { className: 'story-director-sr', text: `${item.label}: ` }),
            el('span', { className: 'story-director-now-text', text: item.value }),
        ]));
    }
    return list;
}

// Notes (severity info, or one the contract does not name) are harmless: they fold away under
// one "Notes" fold, so errors and warnings read first and alone.
function isNote(finding) {
    return finding.severity === 'info' || !SEVERITIES.some(group => group.severity === finding.severity);
}

function problemList(items) {
    return el('ul', { className: 'story-director-problem-list' }, items.map(finding => el('li', { className: 'story-director-problem' }, [
        finding.key ? el('span', { className: 'story-director-problem-key', text: finding.key }) : null,
        el('span', { className: 'story-director-problem-text', text: finding.message ?? '' }),
        finding.kind ? el('code', { className: 'story-director-problem-kind', text: finding.kind }) : null,
    ])));
}

function renderProblems(findings) {
    const present = findings.filter(Boolean);
    const notes = present.filter(isNote);
    const groups = SEVERITIES.filter(group => group.severity !== 'info')
        .map(group => ({ ...group, items: present.filter(finding => finding.severity === group.severity) }))
        .filter(group => group.items.length);
    if (!groups.length && !notes.length) return null;
    const serious = groups.reduce((sum, group) => sum + group.items.length, 0);
    const notesGroup = SEVERITIES.find(group => group.severity === 'info');
    return section('is-problems', [
        serious ? sub('Problems', 'fa-stethoscope', serious) : null,
        ...groups.map(group => el('div', { className: `story-director-problems is-${group.severity}` }, [
            el('div', { className: 'story-director-problems-label' }, [icon(group.icon), el('span', { text: group.label })]),
            problemList(group.items),
        ])),
        notes.length ? fold('is-notes', notesGroup.label, notesGroup.icon, notes.length, () => [
            el('div', { className: 'story-director-problems is-info' }, [problemList(notes)]),
        ]) : null,
    ]);
}

// The records the lock keeps hidden: what the story has planned, not what the reader has seen.
const HIDDEN_KINDS = new Set(['agenda', 'beat', 'clock', 'secret']);
const keyOf = key => String(key ?? '').toLowerCase().replace(/['’‘`]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function hiddenKeys(selection) {
    const lists = ['due', 'arriving', 'relevant', 'dormant', 'secrets', 'resolvedRecently'];
    const records = lists.flatMap(name => (selection?.[name] ?? []).map(entry => entry?.record ?? entry)).filter(Boolean);
    return new Set(records.filter(record => HIDDEN_KINDS.has(record.kind)).map(record => keyOf(record.key)));
}

// Defensive: whatever built the selection, a secret only ever shows behind its fold.
const nonSecret = list => (Array.isArray(list) ? list : []).filter(record => record && record.kind !== 'secret');

function isEmpty(selection) {
    if (!selection) return true;
    return ['due', 'arriving', 'relevant', 'dormant', 'secrets', 'resolvedRecently'].every(list => !selection[list]?.length);
}

/**
 * Render the Director tab into `pane` (Story Block calls tab.render(pane) and leaves the
 * pane's content to us).
 */
// ---------------------------------------------------------------------------
// Arc (v0.4): the current arc, its beats, and a new plan waiting for review

// The draft text the reader is editing survives the tab redrawing itself.
let draftEdit = { key: '', text: '' };

function renderArc({ current = null, beats = null, draft = null, busy = false, error = '', onPlan = null, onEnd = null, onAccept = null, onDiscard = null }) {
    const children = [sub('Arc', 'fa-compass')];
    if (current) {
        const head = el('div', { className: 'story-director-arc-head' }, [
            el('span', { className: 'story-director-arc-name', text: current.key }),
            beats && beats.total ? el('span', { className: 'story-director-arc-progress', text: `${beats.done} of ${beats.total} beats` }) : null,
        ]);
        children.push(head);
        if (text(current.fields?.desc)) children.push(el('p', { className: 'story-director-arc-desc', text: current.fields.desc }));
    } else {
        children.push(el('p', { className: 'story-director-arc-desc is-empty', text: 'No arc planned yet.' }));
    }

    if (draft) {
        const key = String(draft.key ?? draft.text ?? '');
        if (draftEdit.key !== key) draftEdit = { key, text: String(draft.text ?? '') };
        const area = el('textarea', { className: 'text_pole story-director-draft-text', attrs: { rows: '8', spellcheck: 'false', 'aria-label': 'New arc plan' } });
        area.value = draftEdit.text;
        area.addEventListener('input', () => { draftEdit = { key, text: area.value }; });
        const findings = Array.isArray(draft.findings) ? draft.findings : [];
        children.push(el('div', { className: 'story-director-draft' }, [
            el('div', { className: 'story-director-draft-label', text: 'New plan — edit, then accept' }),
            area,
            findings.length ? el('ul', { className: 'story-director-draft-findings' }, findings.map(finding => el('li', {
                className: `story-director-draft-finding is-${finding.severity ?? 'info'}`,
                text: finding.message ?? '',
            }))) : null,
            el('div', { className: 'story-director-arc-actions' }, [
                button('Accept', 'story-director-draft-accept', { iconName: 'fa-check', onClick: () => onAccept?.(draftEdit.text) }),
                button('Discard', 'story-director-draft-discard', { iconName: 'fa-xmark', onClick: () => onDiscard?.() }),
                button('Plan again', 'story-director-draft-replan', { iconName: 'fa-rotate', onClick: () => onPlan?.() }),
            ]),
        ]));
    } else {
        const actions = el('div', { className: 'story-director-arc-actions' }, [
            button(busy ? 'Planning…' : (current ? 'Plan next arc' : 'Plan arc'), 'story-director-arc-plan', { iconName: 'fa-wand-magic-sparkles', onClick: () => onPlan?.() }),
            current ? button('End arc', 'story-director-arc-end', { iconName: 'fa-flag-checkered', onClick: () => onEnd?.() }) : null,
        ]);
        actions.querySelectorAll?.('button').forEach?.(node => { node.disabled = Boolean(busy); });
        children.push(actions);
    }
    if (text(error)) children.push(el('p', { className: 'story-director-arc-error', text: error, attrs: { role: 'alert' } }));
    return section('is-arc', children);
}

// ---------------------------------------------------------------------------
// Route tool (with a world pack)

const MODES = ['foot', 'ride', 'wagon', 'boat', 'courier'];
// A modern map's modes (0.9.0).
const MODERN_MODES = ['foot', 'bike', 'car', 'bus', 'train', 'ferry', 'plane'];
// The last route asked for survives the tab redrawing itself after every reply.
let lastRoute = { from: '', to: '', mode: 'foot', result: '', open: false };

function renderRoute({ places = [], onRoute, era = 'pre-modern' }) {
    const modes = era === 'modern' ? MODERN_MODES : MODES;
    const listId = 'story-director-places';
    const datalist = el('datalist', { attrs: { id: listId } }, places.map(name => {
        const option = el('option');
        option.value = name;
        return option;
    }));
    const field = (className, label, value) => {
        const input = el('input', { className: `text_pole story-director-route-input ${className}`, attrs: { type: 'text', list: listId, 'aria-label': label, placeholder: label } });
        input.value = value;
        return input;
    };
    const from = field('is-from', 'From', lastRoute.from);
    const to = field('is-to', 'To', lastRoute.to);
    const mode = el('select', { className: 'text_pole story-director-route-mode', attrs: { 'aria-label': 'Travel by' } }, modes.map(name => {
        const option = el('option', { text: name });
        option.value = name;
        return option;
    }));
    mode.value = modes.includes(lastRoute.mode) ? lastRoute.mode : modes[0];
    const result = el('div', { className: 'story-director-route-result', text: lastRoute.result, attrs: { 'aria-live': 'polite' } });
    const go = button('Route', 'story-director-route-go', {
        iconName: 'fa-route',
        onClick: () => {
            let answer;
            try {
                answer = onRoute?.(from.value.trim(), to.value.trim(), mode.value) ?? '';
            } catch (error) {
                answer = error instanceof Error ? error.message : String(error);
            }
            lastRoute = { from: from.value, to: to.value, mode: mode.value, result: String(answer), open: true };
            result.textContent = lastRoute.result;
        },
    });
    const details = fold('is-route', 'Route', 'fa-map', null, () => [
        datalist,
        el('div', { className: 'story-director-route-form' }, [from, to, mode, go]),
        result,
    ]);
    if (lastRoute.open) details.setAttribute('open', '');
    details.addEventListener('toggle', () => { lastRoute = { ...lastRoute, open: Boolean(details.open) }; });
    return details;
}

// ---------------------------------------------------------------------------
// Places: where the story has been, from the scene's location, on a small map

const SVG = 'http://www.w3.org/2000/svg';

function svg(tag, attrs = {}, children = []) {
    const doc = globalThis.document;
    const node = doc.createElementNS ? doc.createElementNS(SVG, tag) : doc.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
    for (const child of children) if (child) node.append(child);
    return node;
}

const tidy = value => String(Math.round(value * 100) / 100);

// Coordinates turned so north is up and east is right on screen, whatever the map's own axes.
function renderMap(places, current, map) {
    const plotted = places.filter(place => place.coords);
    if (!plotted.length) return null;
    const east = map?.east === 'left' ? -1 : 1;
    const north = map?.north === 'down' ? -1 : 1;
    const points = plotted.map(place => ({ place, x: place.coords.x * east, y: -place.coords.y * north }));
    const xs = points.map(point => point.x);
    const ys = points.map(point => point.y);
    let [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    // One place, or places in a line, still get a box to sit in.
    const span = Math.max(maxX - minX, maxY - minY, 1);
    const pad = span * 0.12;
    if (maxX - minX < span * 0.3) { const mid = (minX + maxX) / 2; minX = mid - span * 0.15; maxX = mid + span * 0.15; }
    if (maxY - minY < span * 0.3) { const mid = (minY + maxY) / 2; minY = mid - span * 0.15; maxY = mid + span * 0.15; }
    const base = Math.max(maxX - minX + pad * 2, maxY - minY + pad * 2);
    const font = base * 0.045;
    const radius = base * 0.014;
    // Room on the right for the labels, which run east of their dots.
    const box = [minX - pad, minY - pad, maxX - minX + pad * 2 + font * 7, maxY - minY + pad * 2];
    const visited = points.filter(point => point.place.visits);
    const drawing = svg('svg', {
        class: 'story-director-map',
        viewBox: box.map(tidy).join(' '),
        preserveAspectRatio: 'xMidYMid meet',
        role: 'img',
        'aria-label': `Map of ${visited.length} visited ${visited.length === 1 ? 'place' : 'places'}`,
    });
    // Places only a world pack knows: faint dots, no labels, behind the rest.
    for (const point of points.filter(entry => !entry.place.visits)) {
        drawing.append(svg('circle', { class: 'story-director-map-dot is-known', cx: tidy(point.x), cy: tidy(point.y), r: tidy(radius * 0.6) }));
    }
    for (const point of visited) {
        const here = point.place.key === current;
        const dot = svg('circle', { class: `story-director-map-dot${here ? ' is-here' : ''}`, cx: tidy(point.x), cy: tidy(point.y), r: tidy(here ? radius * 1.6 : radius) });
        const title = svg('title');
        title.textContent = point.place.name;
        dot.append(title);
        const label = svg('text', { class: 'story-director-map-label', x: tidy(point.x + radius * 2), y: tidy(point.y + font * 0.35), 'font-size': tidy(font) });
        label.textContent = point.place.name;
        drawing.append(dot, label);
    }
    const compass = svg('text', { class: 'story-director-map-north', x: tidy(box[0] + box[2] - font), y: tidy(box[1] + font * 1.2), 'font-size': tidy(font), 'text-anchor': 'middle' });
    compass.textContent = 'N';
    drawing.append(compass);
    return drawing;
}

function renderPlaces({ book, map = null, formatTime = null } = {}) {
    const places = (book?.places ?? []).filter(place => place.visits);
    if (!places.length) return null;
    const here = places.find(place => place.key === book.current) ?? null;
    const away = place => {
        if (!here || place.key === here.key) return '';
        const km = distanceKm(here, place, map ?? undefined);
        return km === null ? '' : `${Math.round(km)} km ${bearing(here, place, map ?? undefined)}`.trim();
    };
    const items = places.map(place => {
        const item = el('li', { className: `story-director-record is-place${place.key === book.current ? ' is-here' : ''}` });
        item.append(el('div', { className: 'story-director-record-head' }, [
            el('span', { className: 'story-director-record-key', text: place.name }),
            place.key === book.current ? el('span', { className: 'story-director-tag', text: 'here' }) : null,
        ]));
        const facts = el('dl', { className: 'story-director-facts' });
        const add = (label, value) => { if (value) facts.append(el('dt', { text: label }), el('dd', { text: value })); };
        const story = place.storyCoords ? `; the story wrote ${tidy(place.storyCoords.x)}, ${tidy(place.storyCoords.y)}` : '';
        add('map', place.coords ? `${tidy(place.coords.x)}, ${tidy(place.coords.y)}${place.coordsFrom === 'pack' ? ` (world pack${story})` : ''}` : '');
        add('from here', away(place));
        const last = typeof formatTime === 'function' && place.lastTime !== null ? formatTime(place.lastTime) : '';
        add('visits', `${place.visits}${last ? ` · last ${last}` : ''}`);
        add('spots', place.spots.slice(0, 6).join(' · '));
        item.append(facts);
        return item;
    });
    const noCoords = !(book.places ?? []).some(place => place.coords);
    const disagree = places.filter(place => place.storyCoords);
    return fold('is-places', 'Places', 'fa-map-location-dot', places.length, () => [
        renderMap(book.places ?? [], book.current, map),
        disagree.length ? el('p', { className: 'story-director-places-hint is-disagree', text: `The story's coordinates for ${disagree.map(place => place.name).join(', ')} differ from your world pack; distances and directions use the pack's.` }) : null,
        noCoords ? el('p', { className: 'story-director-places-hint', text: 'No map coordinates yet. Ask for them in the scene\'s location (like "Auvoth | Terrace | [59.0, 110.0]") or import a world pack, and these places go on a map with distances.' }) : null,
        el('ul', { className: 'story-director-records' }, items),
    ]);
}

// ---------------------------------------------------------------------------
// Spoiler guard: the tracker is the story behind the scenes, so it stays hidden until asked

function countsOf(selection, findings) {
    const tracked = ['due', 'arriving', 'dormant'].reduce((sum, list) => sum + nonSecret(selection?.[list]).length, 0)
        + nonSecret((selection?.relevant ?? []).map(entry => entry?.record ?? entry)).length;
    // Notes are not problems: the lock counts errors and warnings only.
    const problems = findings.filter(finding => finding && !isNote(finding)).length;
    return { due: nonSecret(selection?.due).length + nonSecret(selection?.arriving).length, tracked, problems };
}

function renderLock(counts, onReveal) {
    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
    const facts = [
        counts.due ? `${counts.due} due` : null,
        plural(counts.tracked, 'tracked record'),
        counts.problems ? `${plural(counts.problems, 'problem')} behind the scenes` : null,
    ].filter(Boolean).join(' · ');
    return section('is-locked', [
        el('div', { className: 'story-director-lock' }, [
            icon('fa-eye-slash'),
            el('div', { className: 'story-director-lock-text' }, [
                el('p', { className: 'story-director-lock-title', text: 'Behind the scenes' }),
                el('p', { className: 'story-director-lock-hint', text: 'Agendas, planned beats, clocks and secrets stay hidden so the story can still surprise you.' }),
                el('p', { className: 'story-director-lock-counts', text: facts }),
            ]),
        ]),
        button('Reveal', 'story-director-reveal', { iconName: 'fa-eye', onClick: () => onReveal?.() }),
    ]);
}

// The arc without its content: what can be done, never what was planned.
function renderArcLocked({ current = null, beats = null, draft = null, busy = false, error = '', onPlan = null, onEnd = null, onAccept = null, onDiscard = null }, onReveal) {
    const children = [sub('Arc', 'fa-compass')];
    let actions;
    if (draft) {
        children.push(el('p', { className: 'story-director-arc-desc', text: 'A new arc plan is waiting.' }));
        actions = [
            button('Accept without reading', 'story-director-draft-accept', { iconName: 'fa-check', onClick: () => onAccept?.(String(draft.text ?? '')) }),
            button('Review', 'story-director-draft-review', { iconName: 'fa-eye', onClick: () => onReveal?.() }),
            button('Discard', 'story-director-draft-discard', { iconName: 'fa-xmark', onClick: () => onDiscard?.() }),
        ];
    } else {
        const progress = beats && beats.total ? ` (${beats.done} of ${beats.total} beats played)` : '';
        children.push(el('p', { className: 'story-director-arc-desc', text: current ? `An arc is in progress${progress}.` : 'No arc planned yet.' }));
        actions = [
            button(busy ? 'Planning…' : (current ? 'Plan next arc' : 'Plan arc'), 'story-director-arc-plan', { iconName: 'fa-wand-magic-sparkles', onClick: () => onPlan?.() }),
            current ? button('End arc', 'story-director-arc-end', { iconName: 'fa-flag-checkered', onClick: () => onEnd?.() }) : null,
        ];
    }
    const row = el('div', { className: 'story-director-arc-actions' }, actions);
    if (busy && !draft) row.querySelectorAll?.('button').forEach?.(node => { node.disabled = true; });
    children.push(row);
    if (text(error)) children.push(el('p', { className: 'story-director-arc-error', text: error, attrs: { role: 'alert' } }));
    return section('is-arc', children);
}

export function renderTab(pane, { timeText = '', place = '', selection, findings = [], formatDate = null, canSeed = false, onSeed = null, onPin = null, route = null, arc = null, spoiler = null, places = null } = {}) {
    const root = el('div', { className: 'story-director-tab' });
    const options = { formatDate, onPin };
    const now = renderNow(timeText || '', place || selection?.place || '');
    if (now) root.append(now);
    const list = Array.isArray(findings) ? findings : [];

    // Locked: nothing hidden is put into the page at all, only counts and what can be done.
    if (spoiler?.locked) {
        if (arc) root.append(renderArcLocked(arc, spoiler.onReveal));
        if (isEmpty(selection) && canSeed) {
            root.append(el('div', { className: 'story-director-empty' }, [
                el('p', { className: 'story-director-empty-hint', text: 'The latest World State block has lines that can start the tracker.' }),
                button('Seed from World State', 'story-director-seed', { iconName: 'fa-seedling', onClick: () => onSeed?.() }),
            ]));
        }
        // (0.9.17) Problems are read without revealing: only those about what is behind the
        // scenes (an agenda, a planned beat, a clock, a secret) stay hidden, and are counted.
        const hidden = hiddenKeys(selection);
        const behind = list.filter(finding => finding?.key && hidden.has(keyOf(finding.key)));
        root.append(renderLock(countsOf(selection, behind), spoiler.onReveal));
        const openProblems = renderProblems(list.filter(finding => !behind.includes(finding)));
        if (openProblems) root.append(openProblems);
        // Where the story has been is no secret: the reader was there.
        const placesFold = places ? renderPlaces(places) : null;
        if (placesFold) root.append(placesFold);
        if (route && typeof route.onRoute === 'function') root.append(renderRoute(route));
        pane.replaceChildren(root);
        return;
    }
    if (spoiler) {
        root.append(el('div', { className: 'story-director-unlocked' }, [
            el('span', { className: 'story-director-unlocked-text', text: 'Behind the scenes is showing.' }),
            button('Hide', 'story-director-hide', { iconName: 'fa-eye-slash', onClick: () => spoiler.onHide?.() }),
        ]));
    }
    if (arc) root.append(renderArc(arc));

    if (isEmpty(selection)) {
        const empty = el('div', { className: 'story-director-empty' }, [el('p', { className: 'story-director-empty-text', text: 'Nothing tracked yet.' })]);
        if (canSeed) {
            empty.append(
                el('p', { className: 'story-director-empty-hint', text: 'The latest World State block has lines that can start the tracker.' }),
                button('Seed from World State', 'story-director-seed', { iconName: 'fa-seedling', onClick: () => onSeed?.() }),
            );
        }
        root.append(empty);
    } else {
        const kindNote = record => KIND_LABEL[record.kind] ?? '';
        const due = nonSecret(selection.due);
        if (due.length) {
            root.append(section('is-due', [sub('Due now', 'fa-bell', due.length), recordList(due, options, kindNote)]));
        }
        const arriving = nonSecret(selection.arriving);
        if (arriving.length) {
            root.append(section('is-arriving', [sub('Arriving', 'fa-route', arriving.length), recordList(arriving, options, kindNote)]));
        }

        const relevant = nonSecret((selection.relevant ?? []).map(entry => entry?.record ?? entry));
        for (const group of KIND_GROUPS) {
            const records = relevant.filter(record => record.kind === group.kind);
            if (!records.length) continue;
            const live = records.filter(record => !isSettled(record));
            const settled = records.filter(isSettled);
            root.append(section(`is-${group.kind}`, [
                sub(group.label, group.icon),
                live.length ? recordList(live, options) : null,
                settled.length ? fold(`is-settled is-${group.kind}-settled`, 'Settled', 'fa-check', settled.length, () => [recordList(settled, options)]) : null,
            ]));
        }

        const dormant = nonSecret(selection.dormant);
        if (dormant.length) {
            root.append(fold('is-dormant', 'Dormant', 'fa-bed', dormant.length, () => [recordList(dormant, options, kindNote)]));
        }
        const secrets = selection.secrets ?? [];
        if (secrets.length) {
            // Pins mean nothing for a secret (it is always in the note), so none here.
            root.append(fold('is-secrets', 'Do not reveal', 'fa-eye-slash', secrets.length,
                () => [recordList(secrets, { formatDate })], { lazy: true }));
        }
        const resolved = nonSecret(selection.resolvedRecently);
        if (resolved.length) {
            const reasonOf = record => (record.status === 'superseded' ? 'superseded' : text(record.resolved?.reason) || 'resolved');
            root.append(fold('is-resolved', 'Resolved recently', 'fa-circle-check', resolved.length,
                () => [recordList(resolved, { formatDate }, reasonOf)]));
        }
    }

    const problems = renderProblems(list);
    if (problems) root.append(problems);
    const placesFold = places ? renderPlaces(places) : null;
    if (placesFold) root.append(placesFold);
    if (route && typeof route.onRoute === 'function') root.append(renderRoute(route));
    pane.replaceChildren(root);
}
