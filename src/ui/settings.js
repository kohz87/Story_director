// Story Director settings panel.
//
// Drawn in the Story Suite's shared look (src/suite.css, docs/STORY_SUITE.md "One look for the
// four settings panels"): SillyTavern's inline-drawer whose content is a `story-suite-panel`,
// the Manage all line, a quick bar with the switches and main actions, then folding sections
// of `story-suite-row`s (a bold label, a small hint, the control). Block names, tags and month
// names are typed by the reader, so every node is built with createElement and filled through
// textContent / value, never innerHTML.
//
// The panel keeps its own copy of the settings and hands a full new object to onChange
// after every edit; the object it was given is never touched. update(settings) redraws
// the sections for settings changed elsewhere, leaving the drawer and the status line as
// they are (rebuilding the drawer would fold it shut).

const DEFAULTS = {
    enabled: true,
    sceneTag: 'World_State',
    depth: 1,
    budgetTokens: 1000,
    dormantReplies: 15,
    dormantDays: 30,
    dueSoonDays: 3,
    mirrorOffscreen: true,
    spoilerGuard: true,
    calendar: { preset: 'custom', era: '', months: [], daysPerMonth: 30 },
    arc: { trigger: 'manual', model: { source: 'chat' }, recent: 60, maxTokens: 1500, stallDays: 7, autoAccept: false, genre: '', note: '', prompt: '' },
    capture: { mode: 'off', model: { source: 'chat' }, maxTokens: 800 },
    map: { north: 'up', east: 'right', kmPerUnit: 1, roadFactor: 1.25, era: 'pre-modern' },
    sourceOfTruth: { calendar: 'auto', timeline: 'auto', npc: 'auto' },
};

// The Story Suite areas Story Director shares, and what each choice means here.
const SOURCE_AREAS = [
    ['calendar', 'Calendar and story time', 'Dates are always read with Story Director’s own calendar. The other one: it stops offering it to the others.'],
    ['timeline', 'Timeline', 'Agendas, quests, clocks, arcs. The other one: it stops offering it and stops mirroring agendas into World State.'],
    ['npc', 'Who each NPC is', 'Automatic: NPC State Delta, when it is here; agenda lines then give only what an NPC plans and when.'],
];
const SOURCE_CHOICES = [
    { value: 'auto', label: 'Automatic' },
    { value: 'mine', label: 'This extension' },
    { value: 'theirs', label: 'The other one' },
];

// Bounds for the number fields; a value outside them is clamped, not rejected.
const LIMITS = {
    depth: [0, 100],
    budgetTokens: [100, 20000],
    dormantReplies: [1, 1000],
    dormantDays: [1, 3650],
    dueSoonDays: [0, 365],
    daysPerMonth: [1, 1000],
    recent: [4, 400],
    maxTokens: [200, 16000],
    stallDays: [1, 365],
    captureTokens: [100, 8000],
};

const PRESET_LABELS = { custom: 'Custom (your months)', gregorian: 'Gregorian (real months, leap years)' };

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

function textInput(id, value, placeholder = '') {
    const node = el('input', { className: 'text_pole', attrs: { id } });
    node.type = 'text';
    node.value = value ?? '';
    if (placeholder) node.placeholder = placeholder;
    return node;
}

function numberInput(id, value, [min, max]) {
    const node = el('input', { className: 'text_pole', attrs: { id, min: String(min), max: String(max), step: '1', inputmode: 'numeric' } });
    node.type = 'number';
    node.value = String(value ?? '');
    return node;
}

/** A number with its unit after it (`story-suite-number`). */
function withUnit(input, unit) {
    return el('span', { className: 'story-suite-number' }, [input, unit ? el('small', { text: unit }) : null]);
}

function select(id, options, value) {
    const node = el('select', { className: 'text_pole', attrs: { id } });
    for (const option of options) {
        const item = el('option', { text: option.label });
        item.value = option.value;
        node.append(item);
    }
    node.value = String(value);
    return node;
}

/** An on/off switch: a checkbox, which suite.css shows as an Enabled/Disabled pill on its row. */
function toggle(id, checked, label) {
    const input = el('input', { attrs: { id, role: 'switch', 'aria-label': label } });
    input.type = 'checkbox';
    input.checked = Boolean(checked);
    return input;
}

/**
 * A setting (`story-suite-row`): `<span><b>name</b><small>hint · status</small></span>` and the
 * control beside it. A `label` for the control when it has an id, so the whole row is its
 * target (a checkbox flips from anywhere on the row); a plain div otherwise. `stacked` puts a
 * large control (a prompt with its button) on a line of its own under the text.
 */
function row(name, hint, control, { id, status = '', stacked = false, className = '' } = {}) {
    const small = [hint, status].filter(Boolean).join(' · ');
    const classes = ['story-suite-row', stacked ? 'is-stacked' : '', className].filter(Boolean).join(' ');
    return el(id ? 'label' : 'div', { className: classes, attrs: id ? { for: id } : {} }, [
        el('span', {}, [el('b', { text: name }), small ? el('small', { text: small }) : null]),
        control,
    ]);
}

// Which sections the reader keeps open: presentation only, remembered per browser. All start
// closed, as in every Story Suite panel.
const OPEN_GROUPS_KEY = 'story_director_settings_open_groups';
const DEFAULT_OPEN_GROUPS = [];
let openGroups = null;

function loadOpenGroups() {
    try {
        const parsed = JSON.parse(globalThis.localStorage?.getItem?.(OPEN_GROUPS_KEY) ?? 'null');
        if (Array.isArray(parsed)) return new Set(parsed.filter(item => typeof item === 'string'));
    } catch {
        // Private windows and blocked storage: the default is fine.
    }
    return new Set(DEFAULT_OPEN_GROUPS);
}

function saveOpenGroups(groups) {
    try { globalThis.localStorage?.setItem?.(OPEN_GROUPS_KEY, JSON.stringify([...groups])); } catch { /* optional */ }
}

function sectionHead(text) {
    return el('div', { className: 'story-suite-subhead', text });
}

function muted(text, className = '') {
    return el('p', { className: `story-suite-muted ${className}`.trim(), text });
}

// ---------------------------------------------------------------------------
// Values

/** The settings with every field present, as a fresh object the panel may change. */
function complete(settings) {
    const given = settings && typeof settings === 'object' ? settings : {};
    const calendar = given.calendar && typeof given.calendar === 'object' ? given.calendar : {};
    const arc = given.arc && typeof given.arc === 'object' ? given.arc : {};
    const capture = given.capture && typeof given.capture === 'object' ? given.capture : {};
    const map = given.map && typeof given.map === 'object' ? given.map : {};
    const sources = given.sourceOfTruth && typeof given.sourceOfTruth === 'object' ? given.sourceOfTruth : {};
    // structuredClone so nothing the panel later changes reaches the caller's object,
    // including fields this panel does not know about (partsOfDay, a newer version's keys).
    return structuredClone({
        ...DEFAULTS,
        ...given,
        calendar: {
            ...DEFAULTS.calendar,
            ...calendar,
            // Bare month names (a world pack's shape) become { name, days } like the rest.
            months: (Array.isArray(calendar.months) ? calendar.months : [])
                .map(month => (typeof month === 'string' ? { name: month, days: calendar.daysPerMonth ?? DEFAULTS.calendar.daysPerMonth } : month))
                .filter(month => month && typeof month === 'object'),
        },
        arc: { ...DEFAULTS.arc, ...arc, model: arc.model && typeof arc.model === 'object' ? { ...arc.model } : { ...DEFAULTS.arc.model } },
        capture: { ...DEFAULTS.capture, ...capture, model: capture.model && typeof capture.model === 'object' ? { ...capture.model } : { ...DEFAULTS.capture.model } },
        map: { ...DEFAULTS.map, ...map },
        sourceOfTruth: { ...DEFAULTS.sourceOfTruth, ...sources },
    });
}

function clampInt(text, [min, max], fallback) {
    const value = Math.round(Number(String(text).trim()));
    if (String(text).trim() === '' || !Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, value));
}

/**
 * Months textarea -> [{ name, days }]. One month per line, `Name` or `Name | days`; a bare
 * name (or a day count that is not a positive number) takes the calendar's days per month.
 */
export function parseMonths(text, daysPerMonth = DEFAULTS.calendar.daysPerMonth) {
    const months = [];
    for (const line of String(text ?? '').split(/\r?\n/)) {
        const [rawName, rawDays = ''] = line.split('|');
        const name = rawName.trim();
        if (!name) continue;
        const days = Math.round(Number(rawDays.trim()));
        months.push({ name, days: rawDays.trim() && days > 0 ? Math.min(days, LIMITS.daysPerMonth[1]) : daysPerMonth });
    }
    return months;
}

/** The reverse: months with the default length are written as a bare name. */
export function formatMonths(months, daysPerMonth = DEFAULTS.calendar.daysPerMonth) {
    return (months ?? [])
        .map(month => (typeof month === 'string' ? { name: month, days: daysPerMonth } : month))
        .filter(month => month?.name)
        .map(month => (month.days && month.days !== daysPerMonth ? `${month.name} | ${month.days}` : month.name))
        .join('\n');
}

// ---------------------------------------------------------------------------
// Settings panel

/**
 * Render the Story Director settings into `container`.
 * `blocks` = [{ tag, name }]: the scene blocks Story Block knows, for the scene select.
 * `others` = names of the other Story Suite extensions announced now.
 * `suiteLink` shows the "Manage all in Story Suite" line, which calls `onOpenSuite()`.
 * Returns `{ root, update(settings), setOthers(names), setSource(area, choice), setEnabled(on), setSuiteLink(shown) }`.
 */
export function renderSettings(container, { settings, blocks = [], onChange, onSeed, onPlanArc = null, version = '', status = '', packSummary = '', onImportPack = null, onClearPack = null, profiles = null, defaultPlannerPrompt = '', onImportWsa = null, others = [], suiteLink = false, onOpenSuite = null } = {}) {
    let summary = packSummary;
    // The other Story Suite extensions announced now, by name; see setOthers.
    let suiteNames = [...others];
    openGroups ??= loadOpenGroups();
    let current = complete(settings);

    // Re-rendering into the same container keeps whatever the runtime last wrote into the
    // status line instead of blanking it until the next reply.
    const previousStatus = container.querySelector?.('#story_director_status')?.textContent ?? '';
    const statusNode = el('div', { className: 'story-suite-notice story-director-status', text: status || previousStatus, attrs: { id: 'story_director_status', 'aria-live': 'polite' } });
    const view = el('div', { className: 'story-director-view' });
    // Story Suite's overlay, while Story Block offers it; outside the view, so redraws keep it.
    // data-story-suite-link lets the overlay hide it while the panel sits inside the overlay.
    const suiteLinkNode = el('div', { className: 'story-suite-manage', attrs: { 'data-story-suite-link': '' } }, [
        button('Manage all in Story Suite', 'story-director-open-suite', { iconName: 'fa-layer-group', title: 'Open Story Suite: every story extension\'s settings and one Source of truth table', onClick: () => onOpenSuite?.() }),
    ]);
    const showSuiteLink = shown => {
        if (shown) suiteLinkNode.removeAttribute('hidden');
        else suiteLinkNode.setAttribute('hidden', '');
    };
    showSuiteLink(suiteLink);
    const root = el('div', { className: 'story-director-settings' }, [
        el('div', { className: 'inline-drawer' }, [
            el('div', { className: 'inline-drawer-toggle inline-drawer-header' }, [
                el('b', {}, [
                    document.createTextNode('Story Director'),
                    version ? el('span', { className: 'story-director-version', text: ` ${version}` }) : null,
                ]),
                el('div', { className: 'inline-drawer-icon fa-solid fa-circle-chevron-down down' }),
            ]),
            el('div', { className: 'inline-drawer-content story-suite-panel' }, [suiteLinkNode, statusNode, view]),
        ]),
    ]);
    container.replaceChildren(root);

    // Every edit goes through here: a fresh copy, changed, handed on whole.
    function commit(change) {
        const next = complete(current);
        change(next);
        current = next;
        refreshSummaries();
        onChange?.(complete(current));
    }

    function bindNumber(input, key, read = settingsValue => settingsValue[key], write = (next, value) => { next[key] = value; }) {
        input.addEventListener('change', () => {
            const value = clampInt(input.value, LIMITS[key], read(current));
            // Show what was kept: a clamped number, or the old one for text that is not a number.
            input.value = String(value);
            if (value !== read(current)) commit(next => write(next, value));
        });
    }

    function renderTracking() {
        // Story Block's blocks when it lists any; otherwise the tag typed by hand.
        let scene;
        if (blocks.length) {
            const options = blocks.map(block => ({ value: String(block.tag), label: block.name && block.name !== block.tag ? `${block.name} <${block.tag}>` : `<${block.tag}>` }));
            // A tag Story Block no longer lists stays selectable, so opening the panel never changes it.
            if (!options.some(option => option.value === current.sceneTag)) options.unshift({ value: current.sceneTag, label: `<${current.sceneTag}> (not found)` });
            scene = select('story_director_scene', options, current.sceneTag);
            scene.addEventListener('change', () => commit(next => { next.sceneTag = scene.value; }));
        } else {
            scene = textInput('story_director_scene', current.sceneTag, DEFAULTS.sceneTag);
            scene.addEventListener('input', () => commit(next => { next.sceneTag = scene.value.trim() || DEFAULTS.sceneTag; }));
        }

        const depth = numberInput('story_director_depth', current.depth, LIMITS.depth);
        bindNumber(depth, 'depth');
        const budget = numberInput('story_director_budget', current.budgetTokens, LIMITS.budgetTokens);
        bindNumber(budget, 'budgetTokens');

        return [
            row('Scene block', blocks.length ? 'The block that holds the time and place.' : 'Tag of the block that holds the time and place.', scene, { id: 'story_director_scene' }),
            row('Note depth', 'How many messages from the end the note goes in.', withUnit(depth, 'messages'), { id: 'story_director_depth' }),
            row('Note budget', 'Most tokens the note may use; the least relevant records go first.', withUnit(budget, 'tokens'), { id: 'story_director_budget' }),
        ];
    }

    function renderDormant() {
        const replies = numberInput('story_director_dormant_replies', current.dormantReplies, LIMITS.dormantReplies);
        bindNumber(replies, 'dormantReplies');
        const days = numberInput('story_director_dormant_days', current.dormantDays, LIMITS.dormantDays);
        bindNumber(days, 'dormantDays');
        const dueSoon = numberInput('story_director_due_soon', current.dueSoonDays, LIMITS.dueSoonDays);
        bindNumber(dueSoon, 'dueSoonDays');
        return [
            sectionHead('Dormant shelf'),
            row('After replies', 'A record not seen for this many replies rests on the shelf.', withUnit(replies, 'replies'), { id: 'story_director_dormant_replies' }),
            row('After story days', 'Or not seen for this many days of story time.', withUnit(days, 'days'), { id: 'story_director_dormant_days' }),
            row('Due soon', 'Records due within this many days never go dormant.', withUnit(dueSoon, 'days'), { id: 'story_director_due_soon' }),
        ];
    }

    function renderCalendar() {
        const calendar = current.calendar;
        const preset = select('story_director_preset', Object.entries(PRESET_LABELS).map(([value, label]) => ({ value, label })), calendar.preset === 'gregorian' ? 'gregorian' : 'custom');
        const era = textInput('story_director_era', calendar.era, 'CY');
        era.addEventListener('input', () => commit(next => { next.calendar.era = era.value.trim(); }));

        const months = el('textarea', { className: 'text_pole story-director-months', attrs: { id: 'story_director_months', rows: '6', spellcheck: 'false' } });
        months.placeholder = 'Dawnwane\nHaywane | 31\nGoldwane';
        months.value = formatMonths(calendar.months, calendar.daysPerMonth);
        months.addEventListener('input', () => commit(next => { next.calendar.months = parseMonths(months.value, next.calendar.daysPerMonth); }));

        const perMonth = numberInput('story_director_days_per_month', calendar.daysPerMonth, LIMITS.daysPerMonth);
        bindNumber(perMonth, 'daysPerMonth', settingsValue => settingsValue.calendar.daysPerMonth, (next, value) => {
            // Months written as a bare name follow the default length, as the textarea shows them.
            const before = next.calendar.daysPerMonth;
            next.calendar.months = next.calendar.months.map(month => (month.days === before ? { ...month, days: value } : month));
            next.calendar.daysPerMonth = value;
        });

        // The month list only means something for a custom calendar.
        const customRows = [
            row('Months', 'One per line, in order: Name, or Name | days.', months, { id: 'story_director_months', className: 'is-custom' }),
            row('Days per month', 'For months written without a length.', withUnit(perMonth, 'days'), { id: 'story_director_days_per_month', className: 'is-custom' }),
        ];
        const showCustom = () => customRows.forEach(node => {
            if (preset.value === 'gregorian') node.setAttribute('hidden', '');
            else node.removeAttribute('hidden');
        });
        preset.addEventListener('change', () => {
            commit(next => { next.calendar.preset = preset.value === 'gregorian' ? 'gregorian' : 'custom'; });
            showCustom();
        });
        showCustom();

        return [
            row('Calendar', 'How dates in the story are read.', preset, { id: 'story_director_preset' }),
            row('Era', 'Written before the year, as in “CY 611”. Leave empty for none.', era, { id: 'story_director_era' }),
            ...customRows,
        ];
    }

    function renderMirror() {
        const mirror = toggle('story_director_mirror', current.mirrorOffscreen, 'Mirror off-screen agendas');
        mirror.addEventListener('change', () => commit(next => { next.mirrorOffscreen = Boolean(mirror.checked); }));
        return [
            row('Mirror off-screen agendas', 'Rewrite the scene block’s Off-Screen list from the tracker, for a World State that keeps one.', mirror, { id: 'story_director_mirror' }),
        ];
    }

    function suiteText() {
        return suiteNames.length
            ? `Also here: ${suiteNames.join(', ')}. Automatic gives each area to its specialist.`
            : 'No other story extension is here, so every choice works like Automatic.';
    }

    // Story Suite: who is the source of truth when several story extensions share an area.
    function renderSources() {
        const rows = SOURCE_AREAS.map(([area, name, hint]) => {
            const id = `story_director_source_${area}`;
            const value = SOURCE_CHOICES.some(choice => choice.value === current.sourceOfTruth[area]) ? current.sourceOfTruth[area] : 'auto';
            const choice = select(id, SOURCE_CHOICES, value);
            choice.addEventListener('change', () => commit(next => { next.sourceOfTruth[area] = choice.value; }));
            return row(name, hint, choice, { id });
        });
        return [
            muted(suiteText(), 'story-director-suite-note'),
            ...rows,
        ];
    }

    // The world pack is the reader's map: it lives beside the settings, not inside them, so
    // importing goes through its own callbacks and never through onChange.
    // How map coordinates read; with them the story's places get distances without a pack.
    function renderMapSettings() {
        const map = current.map;
        const north = select('story_director_map_north', [
            { value: 'up', label: 'Up: y grows to the north (a chart)' },
            { value: 'down', label: 'Down: y grows to the south (an image)' },
        ], map.north === 'down' ? 'down' : 'up');
        north.addEventListener('change', () => commit(next => { next.map.north = north.value === 'down' ? 'down' : 'up'; }));
        const east = select('story_director_map_east', [
            { value: 'right', label: 'Right: x grows to the east' },
            { value: 'left', label: 'Left: x grows to the west' },
        ], map.east === 'left' ? 'left' : 'right');
        east.addEventListener('change', () => commit(next => { next.map.east = east.value === 'left' ? 'left' : 'right'; }));
        const era = select('story_director_map_era', [
            { value: 'pre-modern', label: 'Pre-modern: on foot, horse, wagon, boat; km a day' },
            { value: 'modern', label: 'Modern: car, bus, train, ferry, plane; km an hour' },
        ], map.era === 'modern' ? 'modern' : 'pre-modern');
        era.addEventListener('change', () => commit(next => { next.map.era = era.value === 'modern' ? 'modern' : 'pre-modern'; }));
        const decimal = (id, key, value, [min, max], step) => {
            const input = el('input', { className: 'text_pole', attrs: { id, min: String(min), max: String(max), step: String(step), inputmode: 'decimal' } });
            input.type = 'number';
            input.value = String(value);
            input.addEventListener('change', () => {
                const number = Number(String(input.value).trim());
                const kept = Number.isFinite(number) && String(input.value).trim() !== '' ? Math.min(max, Math.max(min, number)) : current.map[key];
                input.value = String(kept);
                if (kept !== current.map[key]) commit(next => { next.map[key] = kept; });
            });
            return input;
        };
        const scale = decimal('story_director_map_scale', 'kmPerUnit', map.kmPerUnit, [0.001, 100000], 'any');
        const factor = decimal('story_director_map_factor', 'roadFactor', map.roadFactor, [1, 3], 0.05);
        return [
            muted('Places come from the scene\'s location as the story goes (Director tab → Places). When the location carries coordinates, like "Auvoth | Terrace | [59.0, 110.0]", they go on a map with distances, and /route estimates trips between them. No world pack needed.'),
            row('Travel', 'How trips are counted without a world pack (a pack says its own era).', era, { id: 'story_director_map_era' }),
            row('North is', 'Which way the y coordinate runs.', north, { id: 'story_director_map_north' }),
            row('East is', 'Which way the x coordinate runs.', east, { id: 'story_director_map_east' }),
            row('Map scale', 'How far one coordinate unit is.', withUnit(scale, 'km per unit'), { id: 'story_director_map_scale' }),
            row('Road factor', 'Roads wind: straight-line km × this for trips over land.', withUnit(factor, '×'), { id: 'story_director_map_factor' }),
            sectionHead('World pack (optional)'),
        ];
    }

    function renderPack() {
        const message = el('div', { className: 'story-suite-notice story-director-pack-message', attrs: { 'aria-live': 'polite' } });
        const report = result => {
            if (!result) return;
            // A new summary redraws the sections; the message goes into the fresh copy.
            if (result.summary !== undefined) {
                summary = result.summary;
                render();
            }
            const target = view.querySelector?.('.story-director-pack-message') ?? message;
            target.textContent = result.message ?? '';
        };
        const importText = async text => {
            if (!onImportPack) return;
            try {
                report(await onImportPack(text));
            } catch (error) {
                message.textContent = error instanceof Error ? error.message : String(error);
            }
        };

        const file = el('input', { className: 'story-director-pack-file', attrs: { id: 'story_director_pack_file', type: 'file', accept: '.json,application/json' } });
        file.type = 'file';
        file.addEventListener('change', async () => {
            const picked = file.files?.[0];
            if (picked) await importText(await picked.text());
        });
        const paste = el('textarea', { className: 'text_pole story-director-pack-paste', attrs: { id: 'story_director_pack_paste', rows: '4', spellcheck: 'false' } });
        paste.placeholder = 'Or paste the world pack JSON here';
        const importButton = button('Import', 'story-director-pack-import', { iconName: 'fa-file-import', onClick: () => void importText(paste.value) });
        const clear = button('Clear', 'story-director-pack-clear', { iconName: 'fa-trash-can', onClick: async () => report(await onClearPack?.()) });
        if (!summary) clear.disabled = true;

        return [
            row('Roads', summary ? 'Travel legs are checked against its roads, and /route follows them.' : 'Only needed for real roads, paces and travel checks; import it as JSON.', clear, { className: 'is-pack', status: summary ? `Now: ${summary}` : 'Now: none' }),
            row('Import a file', 'A world pack JSON (places, edges, pace_km_per_day, travel_rules, calendar).', file, { id: 'story_director_pack_file', stacked: true }),
            row('Or paste it', '', el('div', { className: 'story-director-pack-paste-wrap' }, [paste, importButton]), { id: 'story_director_pack_paste', stacked: true }),
            message,
        ];
    }

    // Arc planning: one model call per arc, on the chat's model or a connection profile.
    function renderArc() {
        const arc = current.arc;
        const trigger = select('story_director_arc_trigger', [
            { value: 'manual', label: 'Manual (Plan arc / End arc)' },
            { value: 'auto', label: 'Automatic (at arc end or when stalled)' },
        ], arc.trigger === 'auto' ? 'auto' : 'manual');
        trigger.addEventListener('change', () => commit(next => { next.arc.trigger = trigger.value === 'auto' ? 'auto' : 'manual'; }));

        // Connection profiles carry their own API and model; null means Connection Manager is off.
        const model = modelSelect('story_director_arc_model', arc.model);
        model.addEventListener('change', () => commit(next => {
            next.arc.model = model.value ? { source: 'profile', profileId: model.value } : { source: 'chat' };
        }));

        const recent = numberInput('story_director_arc_recent', arc.recent, LIMITS.recent);
        bindNumber(recent, 'recent', value => value.arc.recent, (next, value) => { next.arc.recent = value; });
        const maxTokens = numberInput('story_director_arc_tokens', arc.maxTokens, LIMITS.maxTokens);
        bindNumber(maxTokens, 'maxTokens', value => value.arc.maxTokens, (next, value) => { next.arc.maxTokens = value; });
        const stall = numberInput('story_director_arc_stall', arc.stallDays, LIMITS.stallDays);
        bindNumber(stall, 'stallDays', value => value.arc.stallDays, (next, value) => { next.arc.stallDays = value; });
        const autoAccept = toggle('story_director_arc_accept', arc.autoAccept, 'Use new plans without review');
        autoAccept.addEventListener('change', () => commit(next => { next.arc.autoAccept = Boolean(autoAccept.checked); }));

        const genre = textInput('story_director_arc_genre', arc.genre, 'Dark fantasy, political intrigue, slow burn');
        genre.addEventListener('input', () => commit(next => { next.arc.genre = genre.value; }));
        const note = el('textarea', { className: 'text_pole story-director-arc-note', attrs: { id: 'story_director_arc_note', rows: '3' } });
        note.placeholder = 'A goal, a pace, a beat you want: “Bring the guild into it; slow down after the fire.”';
        note.value = arc.note;
        note.addEventListener('input', () => commit(next => { next.arc.note = note.value; }));
        const keepNote = toggle('story_director_arc_keep_note', arc.keepNote === true, 'Keep the note for every plan');
        keepNote.addEventListener('change', () => commit(next => { next.arc.keepNote = Boolean(keepNote.checked); }));

        const prompt = el('textarea', { className: 'text_pole story-director-arc-prompt', attrs: { id: 'story_director_arc_prompt', rows: '8', spellcheck: 'false' } });
        prompt.value = arc.prompt || defaultPlannerPrompt;
        // Stored only when it differs from the built-in, so a better default reaches everyone.
        prompt.addEventListener('input', () => commit(next => { next.arc.prompt = prompt.value === defaultPlannerPrompt ? '' : prompt.value; }));
        const reset = button('Reset prompt', 'story-director-arc-reset', {
            iconName: 'fa-rotate-left',
            onClick: () => {
                prompt.value = defaultPlannerPrompt;
                commit(next => { next.arc.prompt = ''; });
            },
        });

        return [
            row('When to plan', 'Planning is one model call per arc; tracking stays every reply.', trigger, { id: 'story_director_arc_trigger' }),
            row('Model', profiles === null ? 'Connection Manager is off, so plans use the chat’s own connection.' : 'A connection profile has its own API and model; a cheaper one is fine.', model, { id: 'story_director_arc_model' }),
            row('Messages to read', 'How much recent chat the planner sees.', withUnit(recent, 'messages'), { id: 'story_director_arc_recent' }),
            row('Answer length', 'Most tokens the plan may use.', withUnit(maxTokens, 'tokens'), { id: 'story_director_arc_tokens' }),
            row('Stalled after', 'Automatic: plan again when no beat is due within this many story days.', withUnit(stall, 'days'), { id: 'story_director_arc_stall' }),
            row('Use plans without review', 'Off: a new plan waits in the Director tab for you to accept.', autoAccept, { id: 'story_director_arc_accept' }),
            row('Genre and tone', 'Told to the planner as written.', genre, { id: 'story_director_arc_genre' }),
            row('Director’s note', arc.keepNote === true ? 'Your hand on the wheel, read at every plan.' : 'Your hand on the wheel for the next plan; cleared once you accept that arc.', note, { id: 'story_director_arc_note' }),
            row('Keep the note for every plan', 'Off: the note is used once, so it cannot steer later arcs if you forget it.', keepNote, { id: 'story_director_arc_keep_note' }),
            row('Planning prompt', 'Macros: {{recent}}, {{tracker}}, {{now}}, {{place}}, {{nearby}}, {{note}}, {{genre}}, {{previous_arc}}.', el('div', { className: 'story-director-arc-prompt-wrap' }, [prompt, reset]), { id: 'story_director_arc_prompt', stacked: true }),
        ];
    }

    // A model picker shared by planning and capture: the chat's own model or a profile.
    function modelSelect(id, setting) {
        const options = [{ value: '', label: 'Same as chat' }, ...(profiles ?? []).map(profile => ({ value: String(profile.id), label: String(profile.name ?? profile.id) }))];
        const selected = setting?.source === 'profile' ? String(setting.profileId ?? '') : '';
        if (selected && !options.some(option => option.value === selected)) options.push({ value: selected, label: '(missing profile)' });
        return select(id, options, selected);
    }

    // Capture: a second call writes the change lines, for models that do not write them well.
    function renderCapture() {
        const capture = current.capture;
        const mode = select('story_director_capture_mode', [
            { value: 'off', label: 'Off (the model writes its own changes)' },
            { value: 'fallback', label: 'When a reply has no <Director> block' },
            { value: 'always', label: 'Always (the model is not asked to write changes)' },
        ], ['fallback', 'always'].includes(capture.mode) ? capture.mode : 'off');
        mode.addEventListener('change', () => commit(next => { next.capture.mode = mode.value; }));
        const model = modelSelect('story_director_capture_model', capture.model);
        model.addEventListener('change', () => commit(next => {
            next.capture.model = model.value ? { source: 'profile', profileId: model.value } : { source: 'chat' };
        }));
        const tokens = numberInput('story_director_capture_tokens', capture.maxTokens, LIMITS.captureTokens);
        bindNumber(tokens, 'captureTokens', value => value.capture.maxTokens, (next, value) => { next.capture.maxTokens = value; });
        return [
            row('Capture changes', 'A second call reads each exchange and writes the changes, for models that skip or garble them.', mode, { id: 'story_director_capture_mode' }),
            row('Capture model', 'A small, fast model is enough.', model, { id: 'story_director_capture_model' }),
            row('Answer length', 'Most tokens a capture answer may use.', withUnit(tokens, 'tokens'), { id: 'story_director_capture_tokens' }),
        ];
    }

    function renderSeed() {
        const wsaFile = el('input', { className: 'story-director-wsa-file', attrs: { id: 'story_director_wsa_file', type: 'file', accept: '.json,application/json' } });
        wsaFile.type = 'file';
        wsaFile.addEventListener('change', async () => {
            const picked = wsaFile.files?.[0];
            if (picked) onImportWsa?.(await picked.text());
            wsaFile.value = '';
        });
        return [
            row('Import from World State Alpha', 'An exported World State Alpha bundle: its active facts and developments become World records.', wsaFile, { id: 'story_director_wsa_file', stacked: true }),
        ];
    }

    // The switch and the things done most often, above the groups.
    function renderQuickbar() {
        const enabled = toggle('story_director_enabled', current.enabled, 'Track the story');
        enabled.addEventListener('change', () => commit(next => { next.enabled = Boolean(enabled.checked); }));
        const guard = toggle('story_director_spoiler', current.spoilerGuard, 'Hide behind the scenes');
        guard.addEventListener('change', () => commit(next => { next.spoilerGuard = Boolean(guard.checked); }));
        return el('div', { className: 'story-suite-quickbar' }, [
            row('Track the story', 'Read <Director> change lines and add the note before each reply.', enabled, { id: 'story_director_enabled' }),
            row('Hide behind the scenes', 'The Director tab keeps agendas, planned beats, clocks and secrets hidden until you press Reveal; problems about anything else still show.', guard, { id: 'story_director_spoiler' }),
            el('div', { className: 'story-suite-actions' }, [
                onPlanArc ? button('Plan arc', 'story-director-plan', { iconName: 'fa-wand-magic-sparkles', onClick: () => onPlanArc() }) : null,
                button('Seed from World State', 'story-director-seed', { iconName: 'fa-seedling', title: 'Turn the latest World State’s Off-Screen, World, Hooks and Clocks lines into records', onClick: () => onSeed?.() }),
            ]),
        ]);
    }

    // Each section's summary line says what its main setting is now, kept up to date on edits.
    let summaries = [];

    function refreshSummaries() {
        for (const { node, summarize } of summaries) node.textContent = summarize();
    }

    function fold(key, title, summarize, rows) {
        const small = el('small', { text: summarize() });
        summaries.push({ node: small, summarize });
        const details = el('details', { className: 'story-suite-fold', attrs: { 'data-fold': key } }, [
            el('summary', {}, [el('b', { text: title }), small]),
            el('div', { className: 'story-suite-fold-body' }, rows),
        ]);
        if (openGroups.has(key)) details.setAttribute('open', '');
        details.addEventListener('toggle', () => {
            if (details.open) openGroups.add(key);
            else openGroups.delete(key);
            saveOpenGroups(openGroups);
        });
        return details;
    }

    const CAPTURE_SHORT = { off: 'Off', fallback: 'When a reply has none', always: 'Always' };
    const profileName = setting => {
        if (setting?.source !== 'profile') return 'same model as chat';
        const found = (profiles ?? []).find(profile => String(profile.id) === String(setting.profileId));
        return found ? String(found.name ?? found.id) : 'a missing profile';
    };
    const summarizers = {
        tracking: () => `<${current.sceneTag}> · depth ${current.depth} · up to ${current.budgetTokens} tokens`,
        calendar: () => {
            const calendar = current.calendar;
            if (calendar.preset === 'gregorian') return `Gregorian${calendar.era ? ` · ${calendar.era}` : ''}`;
            const count = calendar.months.length;
            return count ? `${count} ${count === 1 ? 'month' : 'months'}${calendar.era ? ` · ${calendar.era}` : ''}` : 'Your months: none yet';
        },
        pack: () => `${current.map.era === 'modern' ? 'Modern · ' : ''}${current.map.kmPerUnit} km per unit · ${summary ? 'world pack loaded' : 'no world pack'}`,
        arc: () => `${current.arc.trigger === 'auto' ? 'Automatic' : 'Manual'} · ${profileName(current.arc.model)}`,
        capture: () => (current.capture.mode === 'off' || !CAPTURE_SHORT[current.capture.mode]
            ? 'Off'
            : `${CAPTURE_SHORT[current.capture.mode]} · ${profileName(current.capture.model)}`),
        chat: () => `Mirror ${current.mirrorOffscreen ? 'on' : 'off'} · source of truth ${SOURCE_AREAS.every(([area]) => (current.sourceOfTruth[area] ?? 'auto') === 'auto') ? 'Automatic' : 'your choices'}`,
    };

    function render() {
        summaries = [];
        view.replaceChildren(
            renderQuickbar(),
            el('div', { className: 'story-suite-folds' }, [
                fold('tracking', 'Tracking & note', summarizers.tracking, [...renderTracking(), ...renderDormant()]),
                fold('calendar', 'Calendar', summarizers.calendar, renderCalendar()),
                fold('pack', 'Map & travel', summarizers.pack, [...renderMapSettings(), ...renderPack()]),
                fold('arc', 'Arc planning', summarizers.arc, renderArc()),
                fold('capture', 'Capture', summarizers.capture, renderCapture()),
                fold('chat', 'Existing chat & compatibility', summarizers.chat, [...renderSeed(), ...renderMirror(), sectionHead('Source of truth'), ...renderSources()]),
            ]),
        );
    }

    render();

    return {
        root,
        update(next, { packSummary: nextSummary } = {}) {
            current = complete(next);
            if (nextSummary !== undefined) summary = nextSummary;
            render();
        },
        /** The other Story Suite extensions changed: only the note says so, nothing redraws. */
        setOthers(names) {
            suiteNames = [...(names ?? [])];
            const note = view.querySelector?.('.story-director-suite-note');
            if (note) note.textContent = suiteText();
        },
        /**
         * A Source of truth choice saved elsewhere (Story Suite's overlay): kept for the next
         * edit and shown in its select, without redrawing or calling onChange.
         */
        setSource(area, choice) {
            if (!SOURCE_AREAS.some(([known]) => known === area) || !SOURCE_CHOICES.some(option => option.value === choice)) return;
            current = complete(current);
            current.sourceOfTruth[area] = choice;
            const control = view.querySelector?.(`#story_director_source_${area}`);
            if (control) control.value = choice;
            refreshSummaries();
        },
        /** The tracking switch flipped elsewhere: kept and shown, without onChange. */
        setEnabled(on) {
            current = complete(current);
            current.enabled = Boolean(on);
            const control = view.querySelector?.('#story_director_enabled');
            if (control) control.checked = current.enabled;
        },
        /** Story Suite's overlay became available, or stopped being. */
        setSuiteLink(shown) {
            showSuiteLink(Boolean(shown));
        },
    };
}
