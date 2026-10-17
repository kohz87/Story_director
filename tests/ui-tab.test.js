// The Director tab against the fake DOM: sections, labelled rows, pins, folds, the
// hidden secrets and the problems list.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom, texts } from './ui-fake-dom.js';

const doc = installFakeDom();
const { renderTab } = await import('../src/ui/tab.js');

// A Record as tracker.js builds it, with only what a test cares about filled in.
function record(key, kind, fields = {}, more = {}) {
    return {
        key,
        id: key.toLowerCase(),
        kind,
        status: 'active',
        fields: { desc: '', now: '', then: '', on: '', due: '', shown: '', leg: '', arrive: '', place: '', people: '', ...fields },
        extra: {},
        created: { message: 1, time: null },
        changed: { message: 1, time: null },
        seen: { message: 1, time: null },
        resolved: null,
        pinned: false,
        arc: null,
        history: [],
        ...more,
    };
}

const GEVA = record('Senior Listener Geva', 'agenda', { now: 'Bailiff Court', then: 'files the warrant', on: 'Goldwane 17' });
const FIRES = record('Canal Street fires', 'event', { desc: 'curfew in force' });
const STRANGER = record('River stranger', 'hook', { desc: 'who pulled Ren from the sump' }, { pinned: true });
const GRAVES = record("Hollin's Reach graves", 'clock', { desc: 'the dead rise', due: 'Goldwane 28', shown: 'sign' }, { extra: { omen: 'crows' } });
const COUNCIL = record('Council session opens', 'beat', { on: 'Goldwane 18, 09:00 am' });
const SALE = record("Saartje's sale", 'event', { desc: 'the auction', on: 'Goldwane 16' });
const COURIER = record('Courier', 'agenda', { leg: 'Varnhold road', arrive: 'Goldwane 16, morning' });
const BRENN = record('Old Brenn', 'agenda', { now: 'fishing' });
const MIRA = record('Mira', 'hook', { desc: 'owes a favour' });
const WEIR = record('Weir route', 'secret', { desc: 'Chiyo sold the weir route' });
const DEBT = record('Chiyo’s debt', 'secret', { desc: 'she owes the Guild 40 crowns' });
const OLD = record('Lost letter', 'hook', { desc: 'found' }, { status: 'resolved', resolved: { message: 9, time: null, reason: 'found in the archive' } });

function selection(over = {}) {
    return {
        now: 1000,
        place: 'Auvoth',
        due: [SALE],
        arriving: [COURIER],
        relevant: [GEVA, FIRES, STRANGER, GRAVES, COUNCIL].map((entry, index) => ({ record: entry, reason: 'test', priority: index + 1 })),
        dormant: [BRENN, MIRA],
        secrets: [WEIR, DEBT],
        resolvedRecently: [OLD],
        ...over,
    };
}

const EMPTY = { now: null, place: '', due: [], arriving: [], relevant: [], dormant: [], secrets: [], resolvedRecently: [] };

function render(options = {}) {
    const pane = doc.createElement('div');
    doc.body.appendChild(pane);
    renderTab(pane, { timeText: 'CY 611, Goldwane 16, 09:00 am', place: 'Auvoth', selection: selection(), ...options });
    return pane;
}

/** The labelled rows of a record: [[label, value]], plain rows as ['', value]. */
function facts(item) {
    const list = item.querySelector('.story-director-facts');
    if (!list) return [];
    const rows = [];
    for (const node of list.children) {
        if (node.tagName === 'DT') rows.push([node.textContent, null]);
        else if (node.classList.contains('is-plain')) rows.push(['', node.textContent]);
        else rows[rows.length - 1][1] = node.textContent;
    }
    return rows;
}

const itemFor = (pane, key) => pane.querySelectorAll('.story-director-record').find(node => node.querySelector('.story-director-record-key').textContent === key);
const subText = node => node.querySelector('.story-director-sub > span').textContent;

test('the tab replaces what was in the pane', () => {
    const pane = doc.createElement('div');
    pane.append(doc.createElement('p'));
    renderTab(pane, { selection: selection() });
    assert.equal(pane.children.length, 1);
    assert.ok(pane.children[0].classList.contains('story-director-tab'));
});

test('Now shows time and place', () => {
    const pane = render();
    assert.deepEqual(texts(pane, '.story-director-now-text'), ['CY 611, Goldwane 16, 09:00 am', 'Auvoth']);
    assert.ok(pane.querySelector('.story-director-now-item.is-time i.fa-solid.fa-clock'));
    assert.ok(pane.querySelector('.story-director-now-item.is-place i.fa-solid.fa-location-dot'));
});

test('empty state without canSeed: the line, no button', () => {
    for (const empty of [null, undefined, EMPTY]) {
        const pane = render({ selection: empty, timeText: '', place: '' });
        assert.equal(pane.querySelector('.story-director-empty-text').textContent, 'Nothing tracked yet.');
        assert.equal(pane.querySelector('.story-director-seed'), null);
        assert.equal(pane.querySelector('.story-director-section'), null);
        assert.equal(pane.querySelector('.story-director-now'), null);
    }
});

test('empty state with canSeed: a Seed button calling onSeed', () => {
    let seeds = 0;
    const pane = render({ selection: EMPTY, canSeed: true, onSeed: () => { seeds += 1; } });
    const seed = pane.querySelector('.story-director-empty .story-director-seed');
    assert.ok(seed.classList.contains('menu_button'));
    assert.equal(seed.textContent, 'Seed from World State');
    seed.click();
    assert.equal(seeds, 1);
    // Time and place still show above it.
    assert.ok(pane.querySelector('.story-director-now'));
});

test('due and arriving lists', () => {
    const pane = render();
    const due = pane.querySelector('.story-director-section.is-due');
    assert.equal(subText(due), 'Due now');
    assert.equal(due.querySelector('.story-director-count').textContent, '1');
    assert.deepEqual(texts(due, '.story-director-record-key'), ["Saartje's sale"]);
    assert.deepEqual(texts(due, '.story-director-tag'), ['World'], 'the kind shows beside the key');
    assert.deepEqual(facts(due.querySelector('.story-director-record')), [['', 'the auction'], ['on', 'Goldwane 16']]);

    const arriving = pane.querySelector('.story-director-section.is-arriving');
    assert.equal(subText(arriving), 'Arriving');
    assert.deepEqual(texts(arriving, '.story-director-record-key'), ['Courier']);
    assert.deepEqual(facts(arriving.querySelector('.story-director-record')), [['leg', 'Varnhold road'], ['arrive', 'Goldwane 16, morning']]);

    const none = render({ selection: selection({ due: [], arriving: [] }) });
    assert.equal(none.querySelector('.is-due'), null);
    assert.equal(none.querySelector('.is-arriving'), null);
});

test('records grouped by kind, in kind order, with labelled rows', () => {
    const pane = render();
    const groups = pane.querySelectorAll('.story-director-section').filter(node => ['is-agenda', 'is-event', 'is-hook', 'is-clock', 'is-beat'].some(name => node.classList.contains(name)));
    assert.deepEqual(groups.map(subText), ['Off-screen', 'World', 'Hooks', 'Clocks', 'Beats']);
    assert.deepEqual(groups.map(node => texts(node, '.story-director-record-key')), [
        ['Senior Listener Geva'], ['Canal Street fires'], ['River stranger'], ["Hollin's Reach graves"], ['Council session opens'],
    ]);
    assert.ok(groups[0].querySelector('.story-director-sub i.fa-solid.fa-satellite-dish'));

    assert.deepEqual(facts(itemFor(pane, 'Senior Listener Geva')), [['now', 'Bailiff Court'], ['then', 'files the warrant'], ['on', 'Goldwane 17']]);
    // desc heads the record; shown and labels the tracker does not know follow.
    assert.deepEqual(facts(itemFor(pane, "Hollin's Reach graves")), [['', 'the dead rise'], ['due', 'Goldwane 28'], ['shown', 'sign'], ['omen', 'crows']]);
    assert.equal(itemFor(pane, 'Senior Listener Geva').querySelector('.story-director-facts').tagName, 'DL');
});

test('a kind with no records has no section', () => {
    const pane = render({ selection: selection({ relevant: [{ record: GEVA, reason: '', priority: 6 }] }) });
    assert.ok(pane.querySelector('.story-director-section.is-agenda'));
    assert.equal(pane.querySelector('.story-director-section.is-event'), null);
    assert.equal(pane.querySelector('.story-director-section.is-beat'), null);
});

test('the pin toggle calls onPin(id, !pinned)', () => {
    const calls = [];
    const pane = render({ onPin: (id, pinned) => calls.push([id, pinned]) });
    const geva = itemFor(pane, 'Senior Listener Geva').querySelector('.story-director-pin');
    const stranger = itemFor(pane, 'River stranger').querySelector('.story-director-pin');
    assert.equal(geva.getAttribute('aria-pressed'), 'false');
    assert.equal(stranger.getAttribute('aria-pressed'), 'true');
    assert.ok(stranger.classList.contains('is-pinned'));
    assert.ok(geva.querySelector('i.fa-solid.fa-thumbtack'));
    geva.click();
    stranger.click();
    assert.deepEqual(calls, [['senior listener geva', true], ['river stranger', false]]);

    const noPin = render();
    assert.equal(noPin.querySelector('.story-director-pin'), null, 'no pins without onPin');
});

test('the pin click does not reach a clickable ancestor', () => {
    const pane = render({ onPin() {} });
    let bubbled = 0;
    pane.addEventListener('click', () => { bubbled += 1; });
    pane.querySelector('.story-director-pin').click();
    assert.equal(bubbled, 0);
});

test('dormant: folded details with a count', () => {
    const pane = render({ onPin() {} });
    const dormant = pane.querySelector('details.story-director-fold.is-dormant');
    assert.equal(dormant.open, false);
    assert.equal(subText(dormant.querySelector('summary')), 'Dormant');
    assert.equal(dormant.querySelector('summary .story-director-count').textContent, '2');
    assert.deepEqual(texts(dormant, '.story-director-record-key'), ['Old Brenn', 'Mira']);
    assert.ok(dormant.querySelector('.story-director-pin'), 'a dormant record can be pinned awake');

    assert.equal(render({ selection: selection({ dormant: [] }) }).querySelector('.is-dormant'), null);
});

test('do not reveal: secret text is not in the DOM until the fold opens', () => {
    const pane = render();
    const secrets = pane.querySelector('details.story-director-fold.is-secrets');
    assert.equal(subText(secrets.querySelector('summary')), 'Do not reveal');
    assert.equal(secrets.querySelector('summary .story-director-count').textContent, '2');
    assert.equal(secrets.open, false);
    for (const hidden of ['Weir route', 'Chiyo sold the weir route', 'she owes the Guild 40 crowns']) {
        assert.ok(!pane.textContent.includes(hidden), `${hidden} is not in the DOM`);
    }

    // What the browser does on a summary click: open, then fire "toggle".
    secrets.open = true;
    secrets.dispatch('toggle');
    assert.deepEqual(texts(secrets, '.story-director-record-key'), ['Weir route', 'Chiyo’s debt']);
    assert.ok(pane.textContent.includes('she owes the Guild 40 crowns'));
    assert.equal(secrets.querySelector('.story-director-pin'), null);

    secrets.open = false;
    secrets.dispatch('toggle');
    assert.ok(!pane.textContent.includes('Chiyo sold the weir route'), 'closing drops the text again');
});

test('a secret that strays into another list is still not shown', () => {
    const pane = render({ selection: selection({ due: [WEIR], resolvedRecently: [DEBT] }) });
    assert.ok(!pane.textContent.includes('Chiyo sold the weir route'));
    assert.ok(!pane.textContent.includes('she owes the Guild'));
});

test('resolved recently: folded, with the reason', () => {
    const superseded = record('Old plan', 'beat', {}, { status: 'superseded', resolved: { message: 9, time: null, reason: 'replaced by the council' } });
    const pane = render({ selection: selection({ resolvedRecently: [OLD, superseded] }) });
    const resolved = pane.querySelector('details.story-director-fold.is-resolved');
    assert.equal(resolved.open, false);
    assert.equal(resolved.querySelector('summary .story-director-count').textContent, '2');
    assert.deepEqual(texts(resolved, '.story-director-record-key'), ['Lost letter', 'Old plan']);
    assert.deepEqual(texts(resolved, '.story-director-tag'), ['found in the archive', 'superseded']);
});

test('problems grouped by severity, errors first', () => {
    const findings = [
        { kind: 'unfired', severity: 'info', key: 'Courier', message: 'Still due.' },
        { kind: 'parse', severity: 'warn', key: null, message: 'Line 2 is not a change.' },
        { kind: 'unknown-key', severity: 'error', key: 'Nobody', message: 'No such record.' },
        { kind: 'missed', severity: 'warn', key: 'Geva', message: 'Missed by two days.' },
    ];
    const pane = render({ findings });
    const section = pane.querySelector('.story-director-section.is-problems');
    assert.equal(subText(section), 'Problems');
    assert.equal(section.querySelector('.story-director-sub .story-director-count').textContent, '4');
    const groups = section.querySelectorAll('.story-director-problems');
    assert.deepEqual(groups.map(node => node.querySelector('.story-director-problems-label').textContent), ['Errors', 'Warnings', 'Notes']);
    assert.deepEqual(groups.map(node => node.classList.contains(`is-${['error', 'warn', 'info'][groups.indexOf(node)]}`)), [true, true, true]);
    assert.deepEqual(texts(groups[1], '.story-director-problem-text'), ['Line 2 is not a change.', 'Missed by two days.']);
    assert.deepEqual(texts(groups[1], '.story-director-problem-key'), ['Geva']);
    assert.deepEqual(texts(groups[0], '.story-director-problem-kind'), ['unknown-key']);

    assert.equal(render({ findings: [] }).querySelector('.is-problems'), null);
    // Problems still show when nothing is tracked yet.
    const empty = render({ selection: EMPTY, findings: [findings[1]] });
    assert.ok(empty.querySelector('.story-director-empty'));
    assert.deepEqual(texts(empty, '.story-director-problem-text'), ['Line 2 is not a change.']);
});

test('formatDate rewrites date parts when given', () => {
    const seen = [];
    const formatDate = (value, { record: owner, field }) => {
        seen.push([owner.key, field, value]);
        return field === 'arrive' ? null : `${value} (in 1 day)`;
    };
    const pane = render({ formatDate });
    assert.deepEqual(facts(itemFor(pane, 'Senior Listener Geva')), [['now', 'Bailiff Court'], ['then', 'files the warrant'], ['on', 'Goldwane 17 (in 1 day)']]);
    assert.deepEqual(facts(itemFor(pane, "Hollin's Reach graves"))[1], ['due', 'Goldwane 28 (in 1 day)']);
    // A falsy result keeps the text as written.
    assert.deepEqual(facts(itemFor(pane, 'Courier'))[1], ['arrive', 'Goldwane 16, morning']);
    // Only date parts go through it.
    assert.ok(seen.every(([, field]) => ['on', 'due', 'arrive'].includes(field)));
    assert.ok(seen.some(([key]) => key === 'Courier'));

    const throwing = render({ formatDate: () => { throw new Error('bad date'); } });
    assert.deepEqual(facts(itemFor(throwing, 'Senior Listener Geva'))[2], ['on', 'Goldwane 17']);
});

test('model text is never parsed as markup', () => {
    const evil = record('<img src=x onerror=alert(1)>', 'event', { desc: '<b>bold</b>' });
    const pane = render({ selection: selection({ relevant: [{ record: evil, reason: '', priority: 6 }] }) });
    assert.ok(pane.descendants().every(node => !node.html));
    assert.equal(itemFor(pane, '<img src=x onerror=alert(1)>').querySelector('.is-plain').textContent, '<b>bold</b>');
});

test('route tool: shown with a world pack, asks onRoute, keeps its last answer across redraws', () => {
    const asked = [];
    const route = { places: ['Shorn', 'Auvoth'], onRoute: (from, to, mode) => { asked.push([from, to, mode]); return `${from} → ${to} by ${mode}`; } };
    const pane = doc.createElement('div');
    renderTab(pane, { selection: null, route });
    const tool = pane.querySelector('.story-director-fold.is-route');
    assert.ok(tool, 'a route fold');
    pane.querySelector('.story-director-route-input.is-from').value = 'Shorn';
    pane.querySelector('.story-director-route-input.is-to').value = 'Auvoth';
    pane.querySelector('.story-director-route-mode').value = 'ride';
    pane.querySelector('.story-director-route-go').click();
    assert.deepEqual(asked, [['Shorn', 'Auvoth', 'ride']]);
    assert.equal(pane.querySelector('.story-director-route-result').textContent, 'Shorn → Auvoth by ride');

    const again = doc.createElement('div');
    renderTab(again, { selection: null, route });
    assert.equal(again.querySelector('.story-director-route-result').textContent, 'Shorn → Auvoth by ride', 'kept across a redraw');
    assert.equal(again.querySelector('.story-director-route-input.is-from').value, 'Shorn');

    const none = doc.createElement('div');
    renderTab(none, { selection: null });
    assert.equal(none.querySelector('.story-director-fold.is-route'), null, 'no pack, no tool');
});

test('arc: current arc with beat progress, plan and end buttons', () => {
    const calls = [];
    const pane = doc.createElement('div');
    renderTab(pane, {
        selection: null,
        arc: {
            current: { key: 'The Weir Bullion', kind: 'arc', fields: { desc: 'who sold the weir route' } },
            beats: { done: 1, total: 4 },
            onPlan: () => calls.push('plan'),
            onEnd: () => calls.push('end'),
        },
    });
    const section = pane.querySelector('.story-director-section.is-arc');
    assert.ok(section, 'an arc section');
    assert.equal(section.querySelector('.story-director-arc-name').textContent, 'The Weir Bullion');
    assert.equal(section.querySelector('.story-director-arc-progress').textContent, '1 of 4 beats');
    section.querySelector('.story-director-arc-plan').click();
    section.querySelector('.story-director-arc-end').click();
    assert.deepEqual(calls, ['plan', 'end']);

    const empty = doc.createElement('div');
    renderTab(empty, { selection: null, arc: { current: null, busy: true } });
    assert.match(empty.querySelector('.story-director-arc-desc').textContent, /No arc/);
    assert.equal(empty.querySelector('.story-director-arc-end'), null, 'nothing to end');
    assert.equal(empty.querySelector('.story-director-arc-plan').disabled, true, 'busy while planning');
});

test('arc: a draft is editable, and Accept hands back the edited lines', () => {
    const accepted = [];
    let discarded = 0;
    const arc = {
        current: null,
        draft: { key: 'd1', text: '+ arc The Weir Bullion — who sold the route | arc: arc-1', findings: [{ severity: 'warn', message: 'A date is in the past.' }] },
        onAccept: text => accepted.push(text),
        onDiscard: () => { discarded++; },
    };
    const pane = doc.createElement('div');
    renderTab(pane, { selection: null, arc });
    const area = pane.querySelector('.story-director-draft-text');
    assert.match(area.value, /The Weir Bullion/);
    assert.equal(pane.querySelector('.story-director-draft-finding').textContent, 'A date is in the past.');
    area.value = '+ arc Edited — by the reader | arc: arc-1';
    area.dispatch('input');
    // A redraw keeps what the reader typed.
    const again = doc.createElement('div');
    renderTab(again, { selection: null, arc });
    assert.equal(again.querySelector('.story-director-draft-text').value, '+ arc Edited — by the reader | arc: arc-1');
    again.querySelector('.story-director-draft-accept').click();
    again.querySelector('.story-director-draft-discard').click();
    assert.deepEqual(accepted, ['+ arc Edited — by the reader | arc: arc-1']);
    assert.equal(discarded, 1);
});

test('spoiler guard: locked shows counts and actions, and none of the hidden text', () => {
    const record = (key, kind, fields = {}) => ({ key, id: key.toLowerCase(), kind, status: 'active', fields: { desc: '', now: '', then: '', on: '', due: '', shown: '', leg: '', arrive: '', place: '', people: '', ...fields }, extra: {}, pinned: false, history: [] });
    const selection = {
        due: [record('Geva', 'agenda', { then: 'reissues the warrants' })],
        arriving: [],
        relevant: [{ record: record('Council session opens', 'beat', { desc: 'the legation forces a vote' }) }],
        dormant: [record('Old feud', 'hook')],
        secrets: [record('Kade sold the route', 'secret')],
        resolvedRecently: [],
    };
    const calls = [];
    const arc = { current: { key: 'The Weir Bullion', kind: 'arc', fields: { desc: 'who sold the weir route' } }, beats: { done: 1, total: 3 }, onPlan: () => calls.push('plan'), onEnd: () => calls.push('end') };
    const pane = doc.createElement('div');
    renderTab(pane, { timeText: 'Haywane 12', place: 'Auvoth', selection, findings: [{ severity: 'warn', key: 'Geva', message: 'Geva: the leg starts at Shorn' }], arc, spoiler: { locked: true, onReveal: () => calls.push('reveal') } });
    const all = pane.textContent;
    for (const hidden of ['reissues the warrants', 'Council session opens', 'legation', 'Old feud', 'Kade', 'The Weir Bullion', 'weir route', 'leg starts']) {
        assert.ok(!all.includes(hidden), `"${hidden}" is not in the page`);
    }
    assert.match(all, /Haywane 12/, 'time and place still show');
    assert.match(pane.querySelector('.story-director-lock-counts').textContent, /1 due · 3 tracked records · 1 problem/);
    assert.match(pane.querySelector('.story-director-section.is-arc').textContent, /An arc is in progress \(1 of 3 beats played\)/);
    pane.querySelector('.story-director-arc-plan').click();
    pane.querySelector('.story-director-arc-end').click();
    pane.querySelector('.story-director-reveal').click();
    assert.deepEqual(calls, ['plan', 'end', 'reveal']);

    const open = doc.createElement('div');
    renderTab(open, { selection, arc, spoiler: { locked: false, onHide: () => calls.push('hide') } });
    assert.match(open.textContent, /Council session opens/, 'revealed shows everything');
    open.querySelector('.story-director-hide').click();
    assert.equal(calls.at(-1), 'hide');
});

test('spoiler guard: a waiting plan can be accepted without reading it', () => {
    const accepted = [];
    const draft = { key: 'd2', text: '+ arc Secret Plan — spoilers | arc: arc-2' };
    const pane = doc.createElement('div');
    renderTab(pane, { selection: null, arc: { current: null, draft, onAccept: text => accepted.push(text), onDiscard() {} }, spoiler: { locked: true, onReveal() {} } });
    assert.ok(!pane.textContent.includes('Secret Plan'));
    assert.equal(pane.querySelector('.story-director-draft-text'), null, 'the plan is not in the page');
    pane.querySelector('.story-director-draft-accept').click();
    assert.deepEqual(accepted, ['+ arc Secret Plan — spoilers | arc: arc-2']);
    assert.ok(pane.querySelector('.story-director-draft-review'));
});

test('settled records fold away at the end of their section, without a "settled" row', () => {
    const FACT = record('Ditch tax', 'event', { desc: 'Armed men demand a raised ditch tax' }, { extra: { settled: 'yes', since: 'Haywane 2' } });
    const pane = render({ selection: selection({ relevant: [FIRES, FACT, GEVA].map((entry, index) => ({ record: entry, reason: 'test', priority: index + 1 })) }) });
    const world = pane.querySelector('.story-director-section.is-event');
    assert.deepEqual(texts(world, ':scope > .story-director-records > .story-director-record > .story-director-record-head .story-director-record-key'), ['Canal Street fires']);
    const fold = world.querySelector('details.story-director-fold.is-settled');
    assert.equal(fold.open, false);
    assert.equal(subText(fold.querySelector('summary')), 'Settled');
    assert.equal(fold.querySelector('summary .story-director-count').textContent, '1');
    const item = fold.querySelector('.story-director-record');
    assert.equal(item.querySelector('.story-director-record-key').textContent, 'Ditch tax');
    assert.deepEqual(facts(item), [['', 'Armed men demand a raised ditch tax'], ['since', 'Haywane 2']]);
    // Off-screen has nothing settled: no fold there.
    assert.equal(pane.querySelector('.story-director-section.is-agenda .is-settled'), null);

    // A section with only settled records still shows its heading, then the fold.
    const only = render({ selection: selection({ relevant: [{ record: FACT, reason: 'test', priority: 1 }] }) });
    assert.ok(only.querySelector('.story-director-section.is-event details.is-settled'));
    assert.equal(only.querySelector('.story-director-section.is-event > .story-director-records'), null);
});

test('an opened fold stays open when the tab redraws; secrets close again', () => {
    const pane = render();
    const dormant = pane.querySelector('details.is-dormant');
    dormant.open = true;
    dormant.dispatch('toggle');
    const secrets = pane.querySelector('details.is-secrets');
    secrets.open = true;
    secrets.dispatch('toggle');
    const again = render();
    assert.equal(again.querySelector('details.is-dormant').open, true);
    assert.equal(again.querySelector('details.is-secrets').open, false);
    assert.doesNotMatch(again.textContent, /weir route/);
    const reopened = again.querySelector('details.is-dormant');
    reopened.open = false;
    reopened.dispatch('toggle');
    assert.equal(render().querySelector('details.is-dormant').open, false);
});

test('places: a fold with a map, distances from here, and shown even while hidden', async () => {
    const { buildPlaceBook } = await import('../src/places.js');
    const book = buildPlaceBook([
        { message: 1, time: 10, text: 'Shorn | Gate | [0, 0]' },
        { message: 3, time: 20, text: 'Mill | Wheelhouse | [3, 4]' },
    ]);
    const places = { book, map: { kmPerUnit: 10, north: 'up' }, formatTime: time => `t${time}` };
    const pane = render({ places });
    const fold = pane.querySelector('details.story-director-fold.is-places');
    assert.equal(subText(fold.querySelector('summary')), 'Places');
    assert.equal(fold.querySelector('summary .story-director-count').textContent, '2');
    assert.ok(fold.querySelector('.story-director-map'), 'a map');
    assert.equal(fold.querySelectorAll('.story-director-map-dot.is-here').length, 1);
    const items = fold.querySelectorAll('.story-director-record.is-place');
    assert.deepEqual(items.map(item => item.querySelector('.story-director-record-key').textContent), ['Mill', 'Shorn']);
    assert.ok(items[0].classList.contains('is-here'));
    assert.deepEqual(facts(items[1]), [['map', '0, 0'], ['from here', '50 km SW'], ['visits', '1 · last t10'], ['spots', 'Gate']]);

    const locked = render({ places, spoiler: { locked: true, onReveal() {} } });
    assert.ok(locked.querySelector('details.is-places'), 'where the story has been is no secret');

    const plain = render({ places: { book: buildPlaceBook([{ message: 1, text: 'Heron Ford | Camp' }]) } });
    assert.equal(plain.querySelector('.story-director-map'), null);
    assert.match(plain.querySelector('.story-director-places-hint').textContent, /No map coordinates yet/);
    assert.equal(render({ places: { book: buildPlaceBook([]) } }).querySelector('.is-places'), null);
});

test('quests live in their own tab: the Director tab does not list them', () => {
    const BOUNTY = record('Bounty on Kettle Jack', 'quest', { goal: 'bring him in alive' });
    const pane = render({ selection: selection({ relevant: [GEVA, BOUNTY].map((entry, index) => ({ record: entry, reason: 'test', priority: index + 1 })) }) });
    assert.doesNotMatch(pane.textContent, /Kettle Jack/);
    assert.match(pane.textContent, /Senior Listener Geva/);
});

test('a planned fight: an encounter row and a fight tag in the record head', () => {
    const ambush = record('Ambush at the weir', 'beat', { desc: 'bandits hit the road', on: 'Goldwane 16', place: 'Weir road', encounter: '3 bandit, bandit captain (boss)' });
    const later = record('Wolves on the ridge', 'beat', { on: 'Goldwane 19', encounter: '2 x dire wolf rank D' });
    const pane = render({ selection: selection({ due: [ambush], relevant: [{ record: later, reason: 'beat', priority: 2 }, { record: COUNCIL, reason: 'beat', priority: 2 }] }) });

    const due = itemFor(pane, 'Ambush at the weir');
    assert.deepEqual(texts(due, '.story-director-tag'), ['Beats', 'fight']);
    assert.ok(due.querySelector('.story-director-tag.is-fight'));
    assert.deepEqual(facts(due), [['', 'bandits hit the road'], ['on', 'Goldwane 16'], ['place', 'Weir road'], ['encounter', '3 bandit, bandit captain (boss)']]);

    const planned = itemFor(pane, 'Wolves on the ridge');
    assert.deepEqual(texts(planned, '.story-director-tag'), ['fight']);
    assert.deepEqual(facts(planned), [['on', 'Goldwane 19'], ['encounter', '2 x dire wolf rank D']]);
    assert.equal(itemFor(pane, 'Council session opens').querySelector('.story-director-tag.is-fight'), null, 'no foes, no tag');
});
