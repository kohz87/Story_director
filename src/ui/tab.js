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
// `formatDate(value, { record, field })`, when given, rewrites the date parts (on, due,
// arrive) for display, e.g. "Goldwane 17 · tomorrow"; a falsy result or a throw keeps
// the text as written.

const KIND_GROUPS = [
    { kind: 'agenda', label: 'Off-screen', icon: 'fa-satellite-dish' },
    { kind: 'event', label: 'World', icon: 'fa-earth-americas' },
    { kind: 'hook', label: 'Hooks', icon: 'fa-fire' },
    { kind: 'clock', label: 'Clocks', icon: 'fa-hourglass-half' },
    { kind: 'beat', label: 'Beats', icon: 'fa-flag' },
];

// Labelled rows in this order; desc heads the record as a plain line (it is what the
// record is), and labels the tracker does not know follow as written.
const FACT_FIELDS = ['now', 'then', 'on', 'due', 'leg', 'arrive', 'place', 'people', 'shown'];
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
    if (!lazy) body.append(...fill());
    else {
        details.addEventListener('toggle', () => {
            if (details.open) body.replaceChildren(...fill());
            else body.replaceChildren();
        });
    }
    return details;
}

// ---------------------------------------------------------------------------
// Records

const text = value => String(value ?? '').trim();

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
    for (const [label, value] of Object.entries(record.extra ?? {})) if (text(value)) facts.push({ label, value: text(value) });
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

function renderProblems(findings) {
    const groups = SEVERITIES.map(group => ({ ...group, items: findings.filter(finding => finding?.severity === group.severity) }));
    // A severity the contract does not name still shows, with the notes.
    const known = new Set(SEVERITIES.map(group => group.severity));
    groups[2].items.push(...findings.filter(finding => finding && !known.has(finding.severity)));
    const shown = groups.filter(group => group.items.length);
    if (!shown.length) return null;
    return section('is-problems', [
        sub('Problems', 'fa-stethoscope', shown.reduce((sum, group) => sum + group.items.length, 0)),
        ...shown.map(group => el('div', { className: `story-director-problems is-${group.severity}` }, [
            el('div', { className: 'story-director-problems-label' }, [icon(group.icon), el('span', { text: group.label })]),
            el('ul', { className: 'story-director-problem-list' }, group.items.map(finding => el('li', { className: 'story-director-problem' }, [
                finding.key ? el('span', { className: 'story-director-problem-key', text: finding.key }) : null,
                el('span', { className: 'story-director-problem-text', text: finding.message ?? '' }),
                finding.kind ? el('code', { className: 'story-director-problem-kind', text: finding.kind }) : null,
            ]))),
        ])),
    ]);
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
// Route tool (with a world pack)

const MODES = ['foot', 'ride', 'wagon', 'boat', 'courier'];
// The last route asked for survives the tab redrawing itself after every reply.
let lastRoute = { from: '', to: '', mode: 'foot', result: '', open: false };

function renderRoute({ places = [], onRoute }) {
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
    const mode = el('select', { className: 'text_pole story-director-route-mode', attrs: { 'aria-label': 'Travel by' } }, MODES.map(name => {
        const option = el('option', { text: name });
        option.value = name;
        return option;
    }));
    mode.value = lastRoute.mode;
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

export function renderTab(pane, { timeText = '', place = '', selection, findings = [], formatDate = null, canSeed = false, onSeed = null, onPin = null, route = null } = {}) {
    const root = el('div', { className: 'story-director-tab' });
    const options = { formatDate, onPin };
    const now = renderNow(timeText || '', place || selection?.place || '');
    if (now) root.append(now);

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
            if (records.length) root.append(section(`is-${group.kind}`, [sub(group.label, group.icon), recordList(records, options)]));
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

    const problems = renderProblems(Array.isArray(findings) ? findings : []);
    if (problems) root.append(problems);
    if (route && typeof route.onRoute === 'function') root.append(renderRoute(route));
    pane.replaceChildren(root);
}
