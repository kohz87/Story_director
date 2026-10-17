// Tests for src/tracker.js: every op rule of the contract, driven through replay the way the
// extension rebuilds the tracker from a chat, plus markSeen and the no-mutation guarantee.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseChanges } from '../src/changes.js';
import { activeRecords, applyOps, emptyTracker, findRecord, markSeen, replay } from '../src/tracker.js';

function ops(text) {
    const parsed = parseChanges(text);
    assert.deepEqual(parsed.errors, [], text);
    return parsed.ops;
}

function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const child of Object.values(value)) deepFreeze(child);
    }
    return value;
}

const START = ops([
    '+ agenda Senior Listener Geva — now: District Bailiff Court | then: argues with magistrates | on: Haywane 12, 05:45 pm | people: Kade, Al',
    '+ clock Hollin\'s Reach graves — washed graves left uncompleted → the first of the dead rise | due: Goldwane 28 | shown: none',
    '+ event Canal Street Granary Fires — Lower city ablaze | then: citywide night curfew declared | on: Haywane 12, 06:00 pm',
    '+ hook River stranger — who pulled Ren from the sump',
    '+ agenda Hall-Warden Kell — now: the gatehouse',
].join('\n'));

test('emptyTracker has the contract shape', () => {
    assert.deepEqual(emptyTracker(), { version: 1, records: [], message: -1, time: null });
});

test('+ creates a full record', () => {
    const { tracker, problems } = applyOps(emptyTracker(), START, { message: 4, time: 1000 });
    assert.deepEqual(problems, []);
    assert.equal(tracker.records.length, 5);
    assert.equal(tracker.message, 4);
    assert.equal(tracker.time, 1000);
    assert.deepEqual(findRecord(tracker, 'Senior Listener Geva'), {
        key: 'Senior Listener Geva',
        id: 'senior listener geva',
        kind: 'agenda',
        status: 'active',
        fields: {
            desc: '', now: 'District Bailiff Court', then: 'argues with magistrates',
            on: 'Haywane 12, 05:45 pm', due: '', shown: '', leg: '', arrive: '', place: '',
            people: 'Kade, Al',
        },
        extra: {},
        created: { message: 4, time: 1000 },
        changed: { message: 4, time: 1000 },
        seen: { message: 4, time: 1000 },
        resolved: null,
        legSince: null,
        pinned: false,
        arc: null,
        history: [{ message: 4, op: '+', text: START[0].raw }],
    });
});

test('replay applies every op rule in chat order', () => {
    const entries = [
        { message: 0, time: 1000, text: 'The chat begins.', ops: START },
        // Duplicate add: applied as a change.
        { message: 1, time: 1060, text: '', ops: ops('+ agenda Senior Listener Geva — then: files the warrant | on: Haywane 13') },
        // Unknown keys: warn for ~, info for -.
        { message: 2, time: 1120, text: '', ops: ops('~ Thys — then: leaves\n- Ghost of Shorn — gone') },
        // `!` with no fields: then becomes now, then/on clear.
        { message: 3, time: 1180, text: '', ops: ops('! Canal Street Granary Fires — curfew declared') },
        // `!` with fields: only those apply.
        { message: 4, time: 1240, text: '', ops: ops('! Senior Listener Geva — warrant filed | then: waits for the seal | on: Haywane 14') },
        // A clock fires and resolves.
        { message: 5, time: 1300, text: '', ops: ops('! Hollin\'s Reach graves — the dead rise') },
        // Resolved and superseded.
        { message: 6, time: 1360, text: '', ops: ops('- River stranger — found and repaid\n- Hall-Warden Kell — superseded by the new garrison captain') },
        // Reopened.
        { message: 7, time: null, text: '', ops: ops('+ hook River stranger — returns asking for more | on: Haywane 20') },
        // Unknown key on `!`, and a reply with no change block.
        { message: 8, time: 1500, text: 'Nothing happens.', ops: ops('! Nobody — something') },
        { message: 9, time: 1560, text: 'Quiet.', ops: null },
    ];
    const { tracker, problems } = replay(entries);

    assert.deepEqual(problems.map(({ kind, severity, key, message }) => ({ kind, severity, key, message })), [
        { kind: 'duplicate-add', severity: 'info', key: 'Senior Listener Geva', message: 1 },
        { kind: 'unknown-key', severity: 'warn', key: 'Thys', message: 2 },
        { kind: 'unknown-key', severity: 'info', key: 'Ghost of Shorn', message: 2 },
        { kind: 'reopened', severity: 'info', key: 'River stranger', message: 7 },
        { kind: 'unknown-key', severity: 'warn', key: 'Nobody', message: 8 },
    ]);
    for (const problem of problems) assert.equal(typeof problem.text, 'string');

    // Nothing invented for unknown keys.
    assert.equal(tracker.records.length, 5);
    assert.equal(findRecord(tracker, 'Thys'), null);
    assert.equal(findRecord(tracker, 'Nobody'), null);

    // Duplicate add, then a fired line with fields.
    const geva = findRecord(tracker, 'senior listener geva');
    assert.equal(geva.status, 'active');
    assert.equal(geva.fields.now, 'District Bailiff Court');
    assert.equal(geva.fields.then, 'waits for the seal');
    assert.equal(geva.fields.on, 'Haywane 14');
    assert.equal(geva.fields.people, 'Kade, Al');
    assert.deepEqual(geva.history.map(entry => [entry.message, entry.op]), [[0, '+'], [1, '+'], [4, '!']]);
    assert.equal(geva.history[2].text, '! Senior Listener Geva — warrant filed | then: waits for the seal | on: Haywane 14');
    assert.deepEqual(geva.created, { message: 0, time: 1000 });
    assert.deepEqual(geva.changed, { message: 4, time: 1240 });

    // Fired without fields.
    const fires = findRecord(tracker, 'Canal Street Granary Fires');
    assert.equal(fires.status, 'active');
    assert.equal(fires.fields.now, 'citywide night curfew declared');
    assert.equal(fires.fields.then, '');
    assert.equal(fires.fields.on, '');
    assert.equal(fires.fields.desc, 'Lower city ablaze');

    // A clock fired is resolved.
    const graves = findRecord(tracker, 'Hollin’s Reach graves');
    assert.equal(graves.status, 'resolved');
    assert.deepEqual(graves.resolved, { message: 5, time: 1300, reason: 'fired' });

    // Superseded by its reason.
    const kell = findRecord(tracker, 'Hall-Warden Kell');
    assert.equal(kell.status, 'superseded');
    assert.deepEqual(kell.resolved, { message: 6, time: 1360, reason: 'superseded by the new garrison captain' });

    // Resolved, then reopened afresh; entry 7 had no time, so the last known one is used.
    const stranger = findRecord(tracker, 'River stranger');
    assert.equal(stranger.status, 'active');
    assert.equal(stranger.resolved, null);
    assert.equal(stranger.fields.desc, 'returns asking for more');
    assert.equal(stranger.fields.on, 'Haywane 20');
    assert.deepEqual(stranger.created, { message: 0, time: 1000 });
    assert.deepEqual(stranger.changed, { message: 7, time: 1360 });
    assert.deepEqual(stranger.history.map(entry => entry.op), ['+', '-', '+']);

    assert.equal(tracker.message, 9);
    assert.equal(tracker.time, 1560);
    assert.deepEqual(activeRecords(tracker).map(record => record.key), [
        'Senior Listener Geva', 'Canal Street Granary Fires', 'River stranger',
    ]);
    assert.deepEqual(activeRecords(tracker, { kind: 'agenda' }).map(record => record.key), ['Senior Listener Geva']);
});

test('- resolves with its reason; replaced and merged also supersede', () => {
    const { tracker } = replay([
        { message: 0, time: 0, ops: START },
        { message: 1, time: 10, ops: ops('- River stranger — left the city\n- Senior Listener Geva — replaced by Kade\n- Canal Street Granary Fires — merged into the riots') },
    ]);
    assert.equal(findRecord(tracker, 'River stranger').status, 'resolved');
    assert.deepEqual(findRecord(tracker, 'River stranger').resolved, { message: 1, time: 10, reason: 'left the city' });
    assert.equal(findRecord(tracker, 'Senior Listener Geva').status, 'superseded');
    assert.equal(findRecord(tracker, 'Canal Street Granary Fires').status, 'superseded');
});

test('~ changes only the given fields and extra', () => {
    const { tracker, problems } = replay([
        { message: 0, time: 0, ops: START },
        { message: 1, time: 5, ops: ops('~ Senior Listener Geva — then: files the warrant | mood: grim\n~ River stranger — on:') },
    ]);
    assert.deepEqual(problems, []);
    const geva = findRecord(tracker, 'Senior Listener Geva');
    assert.equal(geva.fields.now, 'District Bailiff Court');
    assert.equal(geva.fields.then, 'files the warrant');
    assert.equal(geva.fields.on, 'Haywane 12, 05:45 pm');
    assert.deepEqual(geva.extra, { mood: 'grim' });
    assert.deepEqual(geva.seen, { message: 1, time: 5 });
    assert.equal(findRecord(tracker, 'River stranger').fields.desc, 'who pulled Ren from the sump');
});

test('history keeps the newest 20 entries', () => {
    const entries = [{ message: 0, time: 0, ops: ops('+ agenda Geva — now: Court') }];
    for (let index = 1; index <= 25; index += 1) {
        entries.push({ message: index, time: index, ops: ops(`~ Geva — then: step ${index}`) });
    }
    const geva = findRecord(replay(entries).tracker, 'Geva');
    assert.equal(geva.history.length, 20);
    assert.deepEqual(geva.history[0], { message: 6, op: '~', text: '~ Geva — then: step 6' });
    assert.deepEqual(geva.history[19], { message: 25, op: '~', text: '~ Geva — then: step 25' });
    assert.equal(geva.fields.then, 'step 25');
});

test('markSeen matches keys and people as whole words', () => {
    const base = applyOps(emptyTracker(), ops([
        '+ agenda Ren — now: the sump',
        '+ agenda Senior Listener Geva — now: Court | people: Kade, Al',
        '+ hook Hollin\'s Reach graves — the dead rise',
    ].join('\n')), { message: 0, time: 0 }).tracker;
    const seen = (text, message = 1) =>
        markSeen(base, text, { message, time: 99 }).records
            .filter(record => record.seen.message === message)
            .map(record => record.key);

    assert.deepEqual(seen('Renata waits by the gate.'), []);
    assert.deepEqual(seen('"Ren," Renata says.'), ['Ren']);
    assert.deepEqual(seen('REN\'S sword is wet.'), ['Ren']);
    assert.deepEqual(seen('senior listener\ngeva frowns.'), ['Senior Listener Geva']);
    // People names, each at least 3 characters.
    assert.deepEqual(seen('Kade nods.'), ['Senior Listener Geva']);
    assert.deepEqual(seen('Al nods.'), []);
    assert.deepEqual(seen('Kadesh nods.'), []);
    // Either apostrophe style.
    assert.deepEqual(seen('Mud fills Hollin’s Reach graves.'), ['Hollin\'s Reach graves']);
    assert.deepEqual(seen(''), []);

    const marked = markSeen(base, 'Kade nods.', { message: 3, time: 120 });
    assert.deepEqual(findRecord(marked, 'Senior Listener Geva').seen, { message: 3, time: 120 });
    assert.deepEqual(findRecord(marked, 'Senior Listener Geva').changed, { message: 0, time: 0 });
    assert.notEqual(marked, base);
});

test('replay marks mentions before applying ops, and starts from a seed', () => {
    const seed = applyOps(emptyTracker(), START, { message: 0, time: 0 }).tracker;
    const { tracker } = replay([
        { message: 1, time: 60, text: 'Ren dreams of the river stranger.', ops: null },
        { message: 2, time: 120, text: 'Kade arrives.', ops: [] },
    ], { seed });
    assert.deepEqual(findRecord(tracker, 'River stranger').seen, { message: 1, time: 60 });
    assert.deepEqual(findRecord(tracker, 'Senior Listener Geva').seen, { message: 2, time: 120 });
    assert.deepEqual(findRecord(tracker, 'Canal Street Granary Fires').seen, { message: 0, time: 0 });
    assert.equal(tracker.message, 2);
    assert.equal(tracker.time, 120);
    assert.deepEqual(replay([]).tracker, emptyTracker());
});

test('findRecord takes a key or an id', () => {
    const { tracker } = applyOps(emptyTracker(), START, { message: 0 });
    assert.equal(findRecord(tracker, '**Hall-Warden Kell**').key, 'Hall-Warden Kell');
    assert.equal(findRecord(tracker, 'hall warden kell').key, 'Hall-Warden Kell');
    assert.equal(findRecord(tracker, 'Kell'), null);
    assert.equal(findRecord(tracker, ''), null);
});

test('inputs are never mutated', () => {
    const seed = deepFreeze(applyOps(emptyTracker(), START, { message: 0, time: 0 }).tracker);
    const entries = deepFreeze([
        { message: 1, time: 60, text: 'Kade and Ren argue.', ops: ops('~ Senior Listener Geva — then: files the warrant | mood: grim\n! Canal Street Granary Fires — curfew declared') },
        { message: 2, time: 120, text: '', ops: ops('! Hollin\'s Reach graves — the dead rise\n- River stranger — found\n+ agenda Hall-Warden Kell — now: the walls') },
        { message: 3, time: 180, text: '', ops: ops('+ hook River stranger — returns\n+ event Bells — ring all night') },
    ]);
    const before = JSON.stringify({ seed, entries });

    // Frozen objects throw on write in a module (strict mode), so any mutation fails here.
    const { tracker } = replay(entries, { seed });
    applyOps(seed, entries[1].ops, { message: 2, time: 120 });
    markSeen(seed, 'Kade, Ren and the river stranger', { message: 4, time: 240 });

    assert.equal(JSON.stringify({ seed, entries }), before);
    assert.notEqual(tracker, seed);
    assert.notEqual(tracker.records, seed.records);
    assert.equal(findRecord(seed, 'Hollin\'s Reach graves').status, 'active');
    assert.equal(findRecord(tracker, 'Hollin\'s Reach graves').status, 'resolved');
    assert.equal(tracker.records.length, 6);
});

test('legSince: stamped when a leg is set or changed, kept when the leg is copied, cleared with it', () => {
    const leg = 'Shorn → Varnhold Watch 35 B, courier 70/day → 0.5';
    const plus = { op: '+', kind: 'agenda', key: 'Courier', id: 'courier', fields: { now: 'rides south', leg }, extra: {}, reason: '', raw: '+ agenda Courier' };
    const copy = { op: '~', kind: null, key: 'Courier', id: 'courier', fields: { leg, then: 'delivers the writ' }, extra: {}, reason: '', raw: '~ Courier' };
    const next = { op: '~', kind: null, key: 'Courier', id: 'courier', fields: { leg: 'Varnhold Watch → Wolfmere Outpost 55 B, courier 70/day → 1' }, extra: {}, reason: '', raw: '~ Courier' };
    const clear = { op: '~', kind: null, key: 'Courier', id: 'courier', fields: { leg: '' }, extra: {}, reason: '', raw: '~ Courier' };
    const { tracker } = replay([
        { message: 1, ops: [plus], text: '', time: 100 },
        { message: 3, ops: [copy], text: '', time: 200 },
    ]);
    assert.deepEqual(findRecord(tracker, 'Courier').legSince, { message: 1, time: 100 }, 'a copied leg keeps its start');
    const moved = applyOps(tracker, [next], { message: 5, time: 300 }).tracker;
    assert.deepEqual(findRecord(moved, 'Courier').legSince, { message: 5, time: 300 });
    const cleared = applyOps(moved, [clear], { message: 7, time: 400 }).tracker;
    assert.equal(findRecord(cleared, 'Courier').legSince, null);
});
