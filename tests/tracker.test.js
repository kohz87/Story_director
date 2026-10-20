// Tests for src/tracker.js: every op rule of the contract, driven through replay the way the
// extension rebuilds the tracker from a chat, plus markSeen and the no-mutation guarantee.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { lineKey, parseChanges } from '../src/changes.js';
import { activeRecords, applyOps, emptyTracker, findRecord, givenUpIn, keyWords, markSeen, nearMatches, questsDoneIn, replay, untrackedCorrections } from '../src/tracker.js';

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
            people: 'Kade, Al', encounter: '', reach: '', type: '', giver: '', goal: '', reward: '', step: '', difficulty: '',
        },
        extra: {},
        created: { message: 4, time: 1000 },
        changed: { message: 4, time: 1000 },
        seen: { message: 4, time: 1000 },
        resolved: null,
        legSince: null,
        pinned: false,
        arc: null,
        aliases: [],
        history: [{ message: 4, op: '+', text: START[0].raw, time: 1000 }],
    });
});

test('replay applies every op rule in chat order', () => {
    const entries = [
        { message: 0, time: 1000, text: 'The chat begins.', ops: START },
        // Duplicate add: applied as a change.
        { message: 1, time: 1060, text: '', ops: ops('+ agenda Senior Listener Geva — then: files the warrant | on: Haywane 13') },
        // Unknown keys: warn for a ~ with nothing to add, info for -.
        { message: 2, time: 1120, text: '', ops: ops('~ Thys\n- Ghost of Shorn — gone') },
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
    assert.deepEqual(geva.history[0], { message: 6, op: '~', text: '~ Geva — then: step 6', time: 6 });
    assert.deepEqual(geva.history[19], { message: 25, op: '~', text: '~ Geva — then: step 25', time: 25 });
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

test('arcs: one at a time, and planned records remember their arc', () => {
    const lines = text => parseChanges(text).ops;
    const { tracker } = replay([
        { message: 1, text: '', time: 10, ops: lines('+ arc The Weir Bullion — who sold the weir route | arc: arc-1\n+ beat Council session opens | on: Goldwane 18 | arc: arc-1') },
        { message: 3, text: '', time: 20, ops: lines('+ arc The Long Winter — the passes close | arc: arc-2') },
    ]);
    const first = findRecord(tracker, 'The Weir Bullion');
    const second = findRecord(tracker, 'The Long Winter');
    assert.equal(first.status, 'superseded', 'a new arc closes the old one');
    assert.equal(first.resolved.reason, 'a new arc began');
    assert.equal(second.status, 'active');
    assert.equal(second.arc, 'arc-2');
    const beat = findRecord(tracker, 'Council session opens');
    assert.equal(beat.arc, 'arc-1');
    assert.equal(beat.extra.arc, undefined, 'the arc is identity, not a shown part');
});

test('an encounter is a field like any other: set, changed, and closed with its record', () => {
    const steps = [
        { message: 0, time: 1000, text: '', ops: parseChanges('+ beat Ambush at the weir — on: Haywane 14 | encounter: 3 bandit, bandit captain (boss)').ops },
        { message: 1, time: 1060, text: '', ops: parseChanges('~ Ambush at the weir — encounter: 4 bandit, bandit captain (boss)').ops },
    ];
    const { tracker } = replay(steps);
    assert.equal(findRecord(tracker, 'Ambush at the weir').fields.encounter, '4 bandit, bandit captain (boss)');
    const fought = replay([...steps, { message: 2, time: 1120, text: '', ops: parseChanges('- Ambush at the weir — the bandits fled').ops }]).tracker;
    assert.equal(findRecord(fought, 'Ambush at the weir').status, 'resolved');
});

// (0.9.19)
test('a reach is a field like any other: stored on the record, changed with ~, not an extra', () => {
    const steps = [
        { message: 0, time: 1000, text: '', ops: parseChanges('+ beat Guards sack the Stray Oar — convoy guards wreck the taproom | on: Goldwane 13 | reach: the inn shuts for repairs').ops },
        { message: 1, time: 1060, text: '', ops: parseChanges('~ Guards sack the Stray Oar — reach: the inn shuts; Marrit is out of work').ops },
    ];
    const first = findRecord(replay(steps.slice(0, 1)).tracker, 'Guards sack the Stray Oar');
    assert.equal(first.fields.reach, 'the inn shuts for repairs');
    assert.deepEqual(first.extra, {});
    assert.equal(findRecord(replay(steps).tracker, 'Guards sack the Stray Oar').fields.reach, 'the inn shuts; Marrit is out of work');
});

test('questsDoneIn: the quests a reply finished, not earlier ones, failures or other kinds', () => {
    const steps = [
        { message: 1, time: 1000, text: '', ops: ops([
            '+ bounty Kettle Jack — giver: Warden Hale | goal: bring him in alive | reward: 40 crowns | difficulty: hard',
            '+ quest Rat cellar — giver: Old Mags | reward: 5 copper',
            '+ quest Herb run — goal: twelve moonleaf | difficulty: easy',
            '+ quest Lost ring — giver: Widow Pell | difficulty: tough',
            '+ hook Stranger at the weir — who pulled Ren out',
        ].join('\n')) },
        { message: 3, time: 1060, text: '', ops: ops('- Herb run — twelve moonleaf delivered') },
        { message: 5, time: 1120, text: '', ops: ops([
            '- Kettle Jack — turned in alive, paid',
            '- Rat cellar',
            '- Lost ring — failed, the ring went into the river',
            '- Stranger at the weir — he was the warden',
        ].join('\n')) },
        { message: 7, time: 1180, text: '', ops: ops('~ Kettle Jack — reward: 40 crowns and a pardon') },
    ];
    const at = upTo => replay(steps.filter(step => step.message <= upTo)).tracker;

    assert.deepEqual(questsDoneIn(at(5), 5), [
        { id: 'kettle jack', name: 'Kettle Jack', type: 'bounty', difficulty: 'hard', reward: '40 crowns', giver: 'Warden Hale' },
        { id: 'rat cellar', name: 'Rat cellar', type: '', difficulty: 'normal', reward: '5 copper', giver: 'Old Mags' },
    ], 'several in one reply; a failed quest and a hook are not done; no difficulty is normal');
    assert.deepEqual(questsDoneIn(at(3), 3), [{ id: 'herb run', name: 'Herb run', type: '', difficulty: 'easy', reward: '', giver: '' }]);
    assert.deepEqual(questsDoneIn(at(5), 3).map(quest => quest.id), ['herb run'], 'each reply keeps its own');
    assert.deepEqual(questsDoneIn(at(5), 4), [], 'a message that finished nothing');
    assert.deepEqual(questsDoneIn(at(7), 7), [], 'done earlier, touched later: not done again');
    assert.deepEqual(questsDoneIn(at(1), 1), [], 'none');
    assert.deepEqual(questsDoneIn(emptyTracker(), 0), []);
    assert.deepEqual(questsDoneIn(null, 'x'), []);

    // Plain copies: changing one changes nothing in the tracker.
    const tracker = at(5);
    questsDoneIn(tracker, 5)[0].name = 'changed';
    assert.equal(findRecord(tracker, 'Kettle Jack').key, 'Kettle Jack');

    // Reopened and finished again in a later reply: done in that one.
    const again = replay([...steps,
        { message: 9, time: 1240, text: '', ops: ops('+ quest Rat cellar — reward: 8 copper | difficulty: simple') },
        { message: 11, time: 1300, text: '', ops: ops('- Rat cellar — cleared again') },
    ]).tracker;
    assert.deepEqual(questsDoneIn(again, 11).map(quest => [quest.id, quest.difficulty, quest.reward]), [['rat cellar', 'easy', '8 copper']]);
});

test('questsDoneIn: superseded or given-up quests are not done', () => {
    const { tracker } = replay([
        { message: 0, time: 0, text: '', ops: ops('+ quest A — goal: a\n+ quest B — goal: b\n+ quest C — goal: c') },
        { message: 2, time: 60, text: '', ops: ops('- A — replaced by the guild contract\n- B — abandoned when the bridge fell\n- C — expired') },
    ]);
    assert.deepEqual(questsDoneIn(tracker, 2), []);
});

// v0.8.3: change lines on keys that are not tracked.

const BLUEWATCH = ops([
    '+ hook Footing at Bluewatch — the party needs a foothold in the village',
    '+ agenda Senior Listener Geva — now: Court',
    '+ event The Fall of the Weir — the old weir gave way',
].join('\n'));

function after(lines) {
    return replay([
        { message: 0, time: 0, ops: BLUEWATCH },
        { message: 1, time: 10, ops: ops(lines) },
    ]);
}

test('keyWords drops case, punctuation, a leading article and small connective words', () => {
    assert.deepEqual(keyWords('Footing in Bluewatch'), ['footing', 'bluewatch']);
    assert.deepEqual(keyWords('**The** footing, at BLUEWATCH!'), ['footing', 'bluewatch']);
    assert.deepEqual(keyWords('A Fall of the Weir'), ['fall', 'weir']);
    // Only a leading article goes; "a" inside a key stays.
    assert.deepEqual(keyWords('Plan a Heist'), ['plan', 'a', 'heist']);
    assert.deepEqual(keyWords('The'), []);
});

test('a ~ on a near key is applied to the one record it means', () => {
    for (const key of ['Footing in Bluewatch', 'FOOTING IN BLUEWATCH', 'The Footing, Bluewatch', 'Footing for Bluewatch!']) {
        const { tracker, problems } = after(`~ ${key} — now: a room at the inn`);
        assert.equal(findRecord(tracker, 'Footing at Bluewatch').fields.now, 'a room at the inn', key);
        assert.equal(tracker.records.length, 3, key);
        assert.deepEqual(problems.map(({ kind, severity, text }) => ({ kind, severity, text })), [
            { kind: 'near-key', severity: 'info', text: `"${key}" read as "Footing at Bluewatch".` },
        ], key);
        assert.deepEqual(findRecord(tracker, 'Footing at Bluewatch').history.at(-1), { message: 1, op: '~', text: `~ ${key} — now: a room at the inn`, time: 10 });
    }
});

test('near keys: containment of two words or more, word overlap, and ! and -', () => {
    // The shorter key's words inside the longer's (two words or more).
    let result = after('~ Senior Listener Geva of the Court — then: files the warrant');
    assert.equal(findRecord(result.tracker, 'Senior Listener Geva').fields.then, 'files the warrant');
    result = after('! Weir Fall — the river floods | now: flooded fields');
    assert.equal(findRecord(result.tracker, 'The Fall of the Weir').fields.now, 'flooded fields');
    // One word is not enough to be contained: Geva alone is not a match.
    result = after('~ Geva — then: files the warrant');
    assert.equal(findRecord(result.tracker, 'Senior Listener Geva').fields.then, '');
    assert.equal(findRecord(result.tracker, 'Geva').kind, 'hook');
    // A `-` on a near key resolves it.
    result = after('- Fall of Weir — rebuilt');
    assert.equal(findRecord(result.tracker, 'The Fall of the Weir').status, 'resolved');
    assert.equal(result.problems[0].kind, 'near-key');
    // Jaccard 3/4: three of four words shared.
    const four = replay([{ message: 0, time: 0, ops: ops('+ hook Smugglers under Shorn docks tunnel — rumours') }]).tracker;
    assert.deepEqual(nearMatches(four.records, 'Smugglers Shorn tunnel').map(entry => entry.record.key), ['Smugglers under Shorn docks tunnel']);
    assert.deepEqual(nearMatches(four.records, 'Smugglers Shorn harbour tunnel'), []);
});

test('two near records are never guessed between', () => {
    const base = ops('+ hook Footing at Bluewatch — a foothold\n+ hook Footing on Bluewatch — another');
    const { tracker, problems } = replay([
        { message: 0, time: 0, ops: base },
        { message: 1, time: 10, ops: ops('~ Footing in Bluewatch — now: a room at the inn') },
    ]);
    assert.equal(tracker.records.length, 2);
    assert.ok(tracker.records.every(record => record.fields.now === ''));
    assert.deepEqual(problems.map(({ kind, severity, key, op, candidates }) => ({ kind, severity, key, op, candidates })), [
        { kind: 'unknown-key', severity: 'warn', key: 'Footing in Bluewatch', op: '~', candidates: ['Footing at Bluewatch', 'Footing on Bluewatch'] },
    ]);
    assert.equal(problems[0].text, '"Footing in Bluewatch" is not tracked (it could be "Footing at Bluewatch" or "Footing on Bluewatch"); the ~ line was ignored.');
    assert.deepEqual(untrackedCorrections(problems), [
        '"Footing in Bluewatch" is not tracked: use its exact key ("Footing at Bluewatch" or "Footing on Bluewatch") or add it with "+ kind Footing in Bluewatch — …".',
    ]);
});

test('an exact word match wins over looser ones, and resolved records are not matched', () => {
    const { tracker, problems } = replay([
        { message: 0, time: 0, ops: ops('+ hook Footing at Bluewatch — a foothold\n+ hook Footing at Bluewatch docks — another\n+ hook Old Mill fire — smoke') },
        { message: 1, time: 5, ops: ops('- Old Mill fire — out') },
        { message: 2, time: 10, ops: ops('~ Footing in Bluewatch — now: a room\n! The Old Mill Fire — rekindled') },
    ]);
    assert.equal(findRecord(tracker, 'Footing at Bluewatch').fields.now, 'a room');
    assert.equal(findRecord(tracker, 'Footing at Bluewatch docks').fields.now, '');
    // Only active records are matched: the resolved fire is not fired again.
    assert.equal(findRecord(tracker, 'Old Mill fire').status, 'resolved');
    assert.deepEqual(problems.filter(problem => problem.message === 2).map(problem => problem.kind), ['near-key', 'unknown-key']);
});

test('a ~ with something to say on a key that is not tracked adds a hook', () => {
    const { tracker, problems } = after('~ Lantern Guild dues — now: two silver owed | people: Brann');
    const added = findRecord(tracker, 'Lantern Guild dues');
    assert.equal(added.kind, 'hook');
    assert.equal(added.status, 'active');
    assert.equal(added.fields.now, 'two silver owed');
    assert.equal(added.fields.people, 'Brann');
    assert.deepEqual(added.created, { message: 1, time: 10 });
    assert.deepEqual(added.history, [{ message: 1, op: '~', text: '~ Lantern Guild dues — now: two silver owed | people: Brann', time: 10 }]);
    assert.deepEqual(problems.map(({ kind, severity, key, text }) => ({ kind, severity, key, text })), [
        { kind: 'untracked-added', severity: 'info', key: 'Lantern Guild dues', text: '"Lantern Guild dues" was not tracked; added as a hook (write "+ kind Key" to set its kind).' },
    ]);
    assert.deepEqual(untrackedCorrections(problems), []);
    // A later ~ finds it by its key.
    const next = replay([{ message: 2, time: 20, ops: ops('~ Lantern Guild dues — then: paid') }], { seed: tracker });
    assert.deepEqual(next.problems, []);
    assert.equal(findRecord(next.tracker, 'Lantern Guild dues').fields.then, 'paid');
});

test('a type: that names a kind sets the added record\'s kind', () => {
    let { tracker, problems } = after('~ Bell tower collapse — type: clock | due: Haywane 20');
    assert.equal(findRecord(tracker, 'Bell tower collapse').kind, 'clock');
    assert.equal(findRecord(tracker, 'Bell tower collapse').fields.type, '');
    assert.match(problems[0].text, /added as a clock/);
    ({ tracker, problems } = after('~ Wolf pelts — type: bounty | reward: 10 crowns'));
    assert.equal(findRecord(tracker, 'Wolf pelts').kind, 'quest');
    assert.equal(findRecord(tracker, 'Wolf pelts').fields.type, 'bounty');
    ({ tracker, problems } = after('~ Ashen pact — type: agenda | now: waits'));
    assert.match(problems[0].text, /added as an agenda/);
    // A type that is no kind is a hook's part like any other.
    ({ tracker } = after('~ Side work — type: errand | now: open'));
    assert.equal(findRecord(tracker, 'Side work').kind, 'hook');
    assert.equal(findRecord(tracker, 'Side work').fields.type, 'errand');
});

test('~ with nothing to say and ! on a key that is not tracked are ignored and corrected; - stays a note', () => {
    const { tracker, problems } = after('~ Lantern Guild dues\n~ Lantern Guild dues — now:\n! Harbour riot — it broke out | now: fires\n- Ghost of Shorn — gone');
    assert.equal(tracker.records.length, 3);
    assert.deepEqual(problems.map(({ kind, severity, key, op }) => ({ kind, severity, key, op })), [
        { kind: 'unknown-key', severity: 'warn', key: 'Lantern Guild dues', op: '~' },
        { kind: 'unknown-key', severity: 'warn', key: 'Lantern Guild dues', op: '~' },
        { kind: 'unknown-key', severity: 'warn', key: 'Harbour riot', op: '!' },
        { kind: 'unknown-key', severity: 'info', key: 'Ghost of Shorn', op: '-' },
    ]);
    assert.equal(problems[2].text, '"Harbour riot" is not tracked; the ! line was ignored.');
    // Once per key; a `-` needs no correction.
    assert.deepEqual(untrackedCorrections(problems), [
        '"Lantern Guild dues" is not tracked: add it with "+ kind Lantern Guild dues — …" before changing it.',
        '"Harbour riot" is not tracked: add it with "+ kind Harbour riot — …" before changing it.',
    ]);
});

test('untrackedCorrections: at most three, only unknown ~ and ! lines', () => {
    const problem = (key, op = '~', kind = 'unknown-key') => ({ kind, severity: 'warn', key, op, message: 4, text: '' });
    const lines = untrackedCorrections([
        problem('One'), problem('one'), problem('Two', '!'), problem('Gone', '-'), problem('Near', '~', 'near-key'),
        problem('Three'), problem('Four'),
    ]);
    assert.deepEqual(lines.map(line => line.split('"')[1]), ['One', 'Two', 'Three']);
    assert.deepEqual(untrackedCorrections([problem('One')], { limit: 0 }), []);
    assert.deepEqual(untrackedCorrections(null), []);
});

test('corrections come only from the latest reply', () => {
    const { problems } = replay([
        { message: 0, time: 0, ops: BLUEWATCH },
        { message: 1, time: 5, ops: ops('! Harbour riot — it broke out') },
        { message: 2, time: 6, text: 'The player speaks.', ops: null },
        { message: 3, time: 10, ops: ops('~ Lantern Guild dues') },
        { message: 5, time: 20, ops: ops('~ Footing at Bluewatch — now: settled') },
    ]);
    assert.deepEqual(untrackedCorrections(problems, { message: 3 }), [
        '"Lantern Guild dues" is not tracked: add it with "+ kind Lantern Guild dues — …" before changing it.',
    ]);
    // The newest reply changed only what is tracked: nothing to correct, nothing repeated.
    assert.deepEqual(untrackedCorrections(problems, { message: 5 }), []);
    assert.equal(untrackedCorrections(problems).length, 2);
});

test('a hook taken on becomes a quest: ~ with its own parts (0.8.6)', () => {
    const start = applyOps(emptyTracker(), parseChanges('+ hook Sheep-killer — Beast taking sheep by the drainage ditch\n+ event Market day — stalls on the green\n+ agenda Marrit — now: unloading').ops, { message: 1, time: 0 }).tracker;
    const taken = applyOps(start, parseChanges('~ Sheep-killer — giver: Hobb | reward: 4 silver | difficulty: easy | type: bounty').ops, { message: 3, time: 0 });
    const quest = findRecord(taken.tracker, 'Sheep-killer');
    assert.equal(quest.kind, 'quest');
    assert.equal(quest.fields.type, 'bounty');
    assert.equal(quest.fields.giver, 'Hobb');
    assert.equal(quest.fields.desc, 'Beast taking sheep by the drainage ditch', 'what it was is kept');
    assert.ok(taken.problems.some(problem => problem.kind === 'became-quest'));
    // Done in a later reply, it counts as a finished quest (RPG Battle's quest XP).
    const done = applyOps(taken.tracker, parseChanges('- Hook Sheep-killer — slain at the ditch').ops, { message: 5, time: 0 });
    assert.deepEqual(questsDoneIn(done.tracker, 5).map(entry => [entry.name, entry.difficulty, entry.reward]), [['Sheep-killer', 'easy', '4 silver']]);
    // `type: quest` alone makes one, and says nothing more.
    const typed = applyOps(start, parseChanges('~ Market day — type: quest').ops, { message: 3, time: 0 }).tracker;
    assert.equal(findRecord(typed, 'Market day').kind, 'quest');
    assert.equal(findRecord(typed, 'Market day').fields.type ?? '', '');
    // Plain changes, or someone off-screen, stay what they were.
    const plain = applyOps(start, parseChanges('~ Sheep-killer — shown: tracks by the pen\n~ Marrit — reward: a cut of the cargo').ops, { message: 3, time: 0 }).tracker;
    assert.equal(findRecord(plain, 'Sheep-killer').kind, 'hook');
    assert.equal(findRecord(plain, 'Marrit').kind, 'agenda');
});

test('a quest closed without a - line: step done, status completed, a ! that says so (0.9.1)', () => {
    const start = applyOps(emptyTracker(), ops('+ quest Sheep-killer — kill the wolf | giver: Garrow | step: track it to the den | reward: 2 silver'), { message: 1 }).tracker;
    const after = (line, message = 2) => applyOps(start, ops(line), { message });
    for (const line of [
        '~ Sheep-killer — step: done',
        '~ Sheep-killer — status: completed',
        '~ Sheep-killer — step: completed — the wolf is dead, Garrow paid',
        '! Sheep-killer — the wolf is slain and the reward paid',
        '! Sheep-killer — quest completed',
    ]) {
        const { tracker, problems } = after(line);
        const quest = findRecord(tracker, 'Sheep-killer');
        assert.equal(quest.status, 'resolved', line);
        assert.equal(problems[0].kind, 'closed-by-change', line);
        assert.equal(questsDoneIn(tracker, 2).length, 1, `${line}: counts as done for RPG Battle`);
    }
    // Failure closes it too, but is not a quest done.
    const failed = after('~ Sheep-killer — outcome: failed — the flock is lost').tracker;
    assert.equal(findRecord(failed, 'Sheep-killer').status, 'resolved');
    assert.deepEqual(questsDoneIn(failed, 2), []);
    // A step still to do, or a ! that only moves it on, keeps it open.
    for (const line of ['~ Sheep-killer — step: complete the hunt at dawn', '~ Sheep-killer — step: done tracking, now the den', '! Sheep-killer — tracks found by the river']) {
        assert.equal(findRecord(after(line).tracker, 'Sheep-killer').status, 'active', line);
    }
    // Other kinds close on a status, not on their now.
    const hook = applyOps(emptyTracker(), ops('+ hook River stranger — who pulled Ren out'), { message: 1 }).tracker;
    assert.equal(findRecord(applyOps(hook, ops('~ River stranger — status: resolved'), { message: 2 }).tracker, 'River stranger').status, 'resolved');
    const agenda = applyOps(emptyTracker(), ops('+ agenda Geva — plots | now: waiting'), { message: 1 }).tracker;
    assert.equal(findRecord(applyOps(agenda, ops('~ Geva — now: done.'), { message: 2 }).tracker, 'Geva').status, 'active');
});

test('a step that opens with the ending and confirms it closes the quest; one that goes on to more work does not (0.9.42)', () => {
    const start = applyOps(emptyTracker(), ops('+ quest EastBluffWolves — hunt the crag wolves | giver: Fenna | step: find the pack | reward: 2 gold'), { message: 1 }).tracker;
    const after = line => applyOps(start, ops(line), { message: 2 });
    for (const line of [
        '~ EastBluffWolves — goal: Hunt starved crag wolf pack | reward: Claimed 2 gold | step: Completed and turned in to Fenna',
        '~ EastBluffWolves — step: Completed and turned in to Fenna',
        '~ EastBluffWolves — step: Done — bounty paid by Fenna',
        '~ EastBluffWolves — step: Finished and the reward collected',
        '~ EastBluffWolves — step: Completed and reported | reward: Claimed 2 gold',
    ]) {
        const { tracker, problems } = after(line);
        const quest = findRecord(tracker, 'EastBluffWolves');
        assert.equal(quest.status, 'resolved', line);
        assert.equal(problems[0].kind, 'closed-by-change', line);
        assert.equal(questsDoneIn(tracker, 2).length, 1, line);
    }
    // Still work to do, or a reward only promised: open.
    for (const line of [
        '~ EastBluffWolves — step: done tracking, now the den',
        '~ EastBluffWolves — step: Completed and heading back to Fenna',
        '~ EastBluffWolves — step: Completed and heading back | reward: 2 gold, paid on return',
        '~ EastBluffWolves — step: Finished the hunt, pelts to skin',
    ]) {
        assert.equal(findRecord(after(line).tracker, 'EastBluffWolves').status, 'active', line);
    }
});

test('progress on a plain thread or a beat is not a quest; progress on an offered job is (0.9.2, 0.9.4)', () => {
    const start = applyOps(emptyTracker(), ops([
        '+ hook River stranger — who pulled Ren out',
        '+ beat Toll riders — reach the ford | on: Goldwane 19',
        '+ event Market day — stalls on the green',
        '+ hook Wolf pelts — the tanner pays for pelts | reward: 2 silver each | difficulty: hard',
        '+ hook Courier run — a sealed letter for Brightwater | type: contract',
    ].join('\n')), { message: 1 }).tracker;
    const after = line => applyOps(start, ops(line), { message: 2 }).tracker;
    // A plain thread: progress is not taking on a job.
    assert.equal(findRecord(after('~ River stranger — step: asked around at the inn'), 'River stranger').kind, 'hook');
    assert.equal(findRecord(after('~ River stranger — goal: find her | difficulty: hard'), 'River stranger').kind, 'hook');
    assert.equal(findRecord(after('~ River stranger — shown: wet footprints'), 'River stranger').kind, 'hook');
    // Beats are the world's.
    assert.equal(findRecord(after('~ Toll riders — giver: the Reeve | reward: 5 silver'), 'Toll riders').kind, 'beat');
    // An offered job moved on: the planner's bounty with its reward, a contract by its type.
    const pelts = findRecord(after('~ Wolf pelts — step: tracking the pack'), 'Wolf pelts');
    assert.equal(pelts.kind, 'quest');
    assert.equal(pelts.fields.reward, '2 silver each', 'its parts are kept');
    assert.equal(findRecord(after('~ Courier run — step: on the road north'), 'Courier run').kind, 'quest');
    assert.equal(findRecord(after('~ Wolf pelts — shown: a pelt hung at the tannery'), 'Wolf pelts').kind, 'hook', 'a change that does not move it on');
    // Taking on with a giver or reward, or naming it a quest, as before.
    assert.equal(findRecord(after('~ River stranger — giver: Lyra | reward: a favour owed'), 'River stranger').kind, 'quest');
    assert.equal(findRecord(after('~ Market day — reward: a free pie'), 'Market day').kind, 'quest');
    assert.equal(findRecord(after('~ Market day — type: bounty'), 'Market day').kind, 'quest');
    // An untracked key written with a giver or reward is a quest, not a hook.
    const untracked = applyOps(start, ops('~ Kettle Jack bounty — giver: Warden Hale | reward: 40 crowns'), { message: 2 }).tracker;
    assert.equal(findRecord(untracked, 'Kettle Jack bounty').kind, 'quest');
    assert.equal(findRecord(applyOps(start, ops('~ Odd lights — now: over the marsh'), { message: 2 }).tracker, 'Odd lights').kind, 'hook');
});

test('giving up: forfeit, quit and walked away close a quest as a failure; "quite" does not (0.9.6)', () => {
    const start = applyOps(emptyTracker(), ops('+ quest Sheep-killer — kill the wolf | giver: Garrow | reward: 2 silver'), { message: 1 }).tracker;
    for (const line of ['~ Sheep-killer — outcome: forfeit', '~ Sheep-killer — status: quit', '! Sheep-killer — Ren walked away from the hunt', '- Sheep-killer — called off after the flood']) {
        const tracker = applyOps(start, ops(line), { message: 2 }).tracker;
        assert.equal(findRecord(tracker, 'Sheep-killer').status, 'resolved', line);
        assert.deepEqual(questsDoneIn(tracker, 2), [], `${line}: a failure, no quest XP`);
    }
    const done = applyOps(start, ops('- Sheep-killer — turned in, quite a haul'), { message: 2 }).tracker;
    assert.equal(questsDoneIn(done, 2).length, 1, '"quite" is not "quit"');
});

test('givenUpIn: the open quests a message says are given up, by key or giver; negations do not count (0.9.6)', () => {
    const tracker = applyOps(emptyTracker(), ops('+ quest Sheep-killer — kill the wolf | giver: Garrow | reward: 2 silver\n+ quest Herb run — moonleaf | giver: Mother Ysolde | reward: 5 copper'), { message: 1 }).tracker;
    assert.deepEqual(givenUpIn(tracker, 'I give up on the Sheep-killer bounty. It is not worth my neck.'), ['Sheep-killer']);
    assert.deepEqual(givenUpIn(tracker, 'Tell Garrow I quit.'), ['Sheep-killer'], 'by the giver');
    assert.deepEqual(givenUpIn(tracker, "I won't give up on the Sheep-killer."), [], 'a negation');
    assert.deepEqual(givenUpIn(tracker, 'I give up. The rain wins.'), [], 'no quest named');
    assert.deepEqual(givenUpIn(tracker, 'We pick moonleaf for the Herb run. Ren gives up on sleep.'), [], 'the quest and the giving up in different sentences');
    assert.deepEqual(givenUpIn(tracker, 'I walk away from the Herb run and Mother Ysolde.'), ['Herb run']);
});

test('closing a closed quest again changes nothing: it stays finished in the reply that first closed it (0.9.7)', () => {
    let tracker = applyOps(emptyTracker(), ops('+ quest Wolves at the weir — the pack | giver: Kael | reward: 4 silver'), { message: 1 }).tracker;
    tracker = applyOps(tracker, ops('- Wolves at the weir — the pack is dead'), { message: 3 }).tracker;
    assert.equal(questsDoneIn(tracker, 3).length, 1);
    for (const line of ['- Wolves at the weir — the pack is dead', '~ Wolves at the weir — status: completed', '! Wolves at the weir — reward paid']) {
        const again = applyOps(tracker, ops(line), { message: 7 });
        assert.deepEqual(questsDoneIn(again.tracker, 7), [], `${line}: not finished a second time`);
        assert.equal(findRecord(again.tracker, 'Wolves at the weir').resolved.message, 3);
        assert.equal(again.problems[0].kind, 'already-closed');
    }
    // Reopened with a +, it can be finished again.
    const reopened = applyOps(tracker, ops('+ quest Wolves at the weir — a second pack | giver: Kael | reward: 4 silver'), { message: 5 }).tracker;
    assert.equal(questsDoneIn(applyOps(reopened, ops('- Wolves at the weir — done'), { message: 7 }).tracker, 7).length, 1);
});

test('"+ quest Key" on a hook or event already tracked makes it the quest (0.9.9)', () => {
    const start = applyOps(emptyTracker(), ops('+ hook Sheepfold Wolves — wolves at the east fold | reward: 2 silver per ear\n+ beat Toll riders — reach the ford | on: Goldwane 19\n+ agenda Geva — now: Bailiff Court'), { message: 1 }).tracker;
    const { tracker, problems } = applyOps(start, ops('+ quest Sheepfold Wolves — Cull up to 4 timber wolves | type: contract, giver: Nelke/Herders, goal: return right wolf ears, reward: 2 silver per head, due: Goldwane 12'), { message: 2 });
    const quest = findRecord(tracker, 'Sheepfold Wolves');
    assert.equal(quest.kind, 'quest');
    assert.equal(quest.fields.type, 'contract');
    assert.equal(quest.fields.giver, 'Nelke/Herders');
    assert.equal(problems[0].kind, 'became-quest');
    // Beats and agendas stay what they are; a + of the same kind is a change, as before.
    assert.equal(findRecord(applyOps(start, ops('+ quest Toll riders — escort them'), { message: 2 }).tracker, 'Toll riders').kind, 'beat');
    assert.equal(findRecord(applyOps(start, ops('+ quest Geva — follow her'), { message: 2 }).tracker, 'Geva').kind, 'agenda');
    assert.equal(applyOps(start, ops('+ hook Sheepfold Wolves — again'), { message: 2 }).problems[0].kind, 'duplicate-add');
});

test('a "- … accepted" line takes a job on, it does not finish it (0.9.13)', () => {
    const start = applyOps(emptyTracker(), ops('+ hook Sheepfold Wolves — wolves at the east fold | giver: Nelke'), { message: 1 }).tracker;
    // As written: the quest, then the hook "closed" because it was accepted.
    const reply = '+ quest Sheepfold Wolves — Cull four timber wolves | type: contract | giver: Nelke | reward: 8 silver | due: Goldwane 13, 08:00 am | difficulty: easy\n- Hook Sheepfold Wolves — accepted by Wessel';
    const { tracker, problems } = applyOps(start, ops(reply), { message: 2 });
    const quest = findRecord(tracker, 'Sheepfold Wolves');
    assert.equal(quest.kind, 'quest');
    assert.equal(quest.status, 'active');
    assert.deepEqual(questsDoneIn(tracker, 2), []);
    assert.ok(problems.some(problem => problem.kind === 'taken-on'));
    // On a hook alone, the - makes it the quest.
    const taken = applyOps(start, ops('- Sheepfold Wolves — taken on by Wessel'), { message: 2 }).tracker;
    assert.equal(findRecord(taken, 'Sheepfold Wolves').kind, 'quest');
    assert.equal(findRecord(taken, 'Sheepfold Wolves').status, 'active');
    // Pay, an ending or a refusal still close it.
    const quested = applyOps(start, ops('+ quest Sheepfold Wolves — cull them | giver: Nelke'), { message: 2 }).tracker;
    for (const reason of ['reward accepted, 8 silver paid', 'done, Nelke accepted the ears and the job is finished', 'declined the job', 'cleared']) {
        assert.equal(findRecord(applyOps(quested, ops(`- Sheepfold Wolves — ${reason}`), { message: 3 }).tracker, 'Sheepfold Wolves').status, 'resolved', reason);
    }
});

test('"- hook Key — <what the hook was>" beside "+ quest Key" does not finish the quest (0.9.20)', () => {
    const start = applyOps(emptyTracker(), ops('+ hook Lone Grey Wolf — Hunt the lone wolf killing sheep past the western ditch | giver: Verna'), { message: 1 }).tracker;
    // As written in a reply: the quest, then the hook it came from "closed" with its old text.
    const reply = "+ quest Lone Grey Wolf — Hunt the wolf pack preying on Gerrick's sheepfold | type: bounty | giver: Verna | reward: 1 gold | difficulty: ordinary\n- hook Lone Grey Wolf — Hunt the lone wolf killing sheep past the western ditch";
    const { tracker, problems } = applyOps(start, ops(reply), { message: 2, said: "I'll take the wolf bounty." });
    const quest = findRecord(tracker, 'Lone Grey Wolf');
    assert.equal(quest.kind, 'quest');
    assert.equal(quest.status, 'active');
    assert.deepEqual(questsDoneIn(tracker, 2), []);
    assert.ok(problems.some(problem => problem.kind === 'taken-on'));
    assert.deepEqual(quest.aliases ?? [], [], 'the kind word is not remembered as a name');
    // Not accepted: the offer stays an offer, not closed by the hook's line.
    const offer = findRecord(applyOps(start, ops(reply), { message: 2, said: 'I look around the square.' }).tracker, 'Lone Grey Wolf');
    assert.equal(offer.status, 'active');
    // With no hook tracked before, the same pair still leaves the quest open.
    assert.equal(findRecord(applyOps(emptyTracker(), ops(reply), { message: 2, said: "I'll take the wolf bounty." }).tracker, 'Lone Grey Wolf').status, 'active');
    // A reason that says the job is over still ends it, in the same reply or later.
    assert.equal(findRecord(applyOps(tracker, ops('- hook Lone Grey Wolf — the wolf is slain and the bounty paid out'), { message: 3 }).tracker, 'Lone Grey Wolf').status, 'resolved');
    assert.equal(findRecord(applyOps(start, ops("+ quest Lone Grey Wolf — hunt it | giver: Verna\n- Lone Grey Wolf — done, Verna paid"), { message: 2, said: "I'll take the wolf bounty." }).tracker, 'Lone Grey Wolf').status, 'resolved');
    // A later plain "- Key — the wolf is dead" on the quest still closes it, as before.
    assert.equal(findRecord(applyOps(tracker, ops('- Lone Grey Wolf — cleared'), { message: 3 }).tracker, 'Lone Grey Wolf').status, 'resolved');
});

test('a line keyed by a label ("! Encounter — …") is skipped quietly and never asked to be added (0.9.14)', () => {
    const start = applyOps(emptyTracker(), ops('+ hook Sheepfold Wolves — wolves at the east fold'), { message: 1 }).tracker;
    const { tracker, problems } = applyOps(start, ops('! Encounter — 4 timber wolves attack at the fold\n~ Combat — wolves engaged\n~ Quest — step: fight\n- Scene — over'), { message: 2 });
    assert.equal(tracker.records.length, 1, 'nothing added');
    assert.deepEqual(problems.map(problem => [problem.kind, problem.severity]), [['label-key', 'info'], ['label-key', 'info'], ['label-key', 'info'], ['label-key', 'info']]);
    assert.deepEqual(untrackedCorrections(problems, { message: 2 }), []);
    // A record that is really called so is still changed.
    const named = applyOps(emptyTracker(), ops('+ event Encounter — a stranger at the gate'), { message: 1 }).tracker;
    assert.equal(findRecord(applyOps(named, ops('! Encounter — the stranger speaks'), { message: 2 }).tracker, 'Encounter').fields.now, '');
    assert.equal(applyOps(named, ops('! Encounter — the stranger speaks'), { message: 2 }).problems.length, 0);
});

test('choices are the reader\'s: a + quest counts only when their message took the job on (0.9.15)', async () => {
    const { isOffer, offersChosenIn } = await import('../src/tracker.js');
    const offerLines = '+ quest Rat Culling — Kill granary rats | type: side | giver: Danique | reward: 8 copper a sack\n+ quest Wolf Hunt — Kill ridge wolves | type: side | giver: Danique | reward: 4 silver';
    // Danique only offered them: both stay offers, not quests.
    const offeredOnly = applyOps(emptyTracker(), ops(offerLines), { message: 1, said: 'I pay the fee and ask what work there is.' });
    assert.deepEqual(offeredOnly.tracker.records.map(r => [r.key, r.kind, isOffer(r)]), [['Rat Culling', 'hook', true], ['Wolf Hunt', 'hook', true]]);
    assert.ok(offeredOnly.problems.every(p => p.kind === 'offered'));
    // Taking one on by name: only that one is a quest.
    const took = applyOps(emptyTracker(), ops(offerLines), { message: 1, said: 'Accept the sheep-fold wolf hunt contract and head past the ditch.' });
    assert.deepEqual(took.tracker.records.map(r => r.kind), ['hook', 'quest']);
    // One job offered: "I'll take it" is enough. A refusal or a negation is not acceptance.
    const single = '+ quest Wolf Hunt — Kill ridge wolves | giver: Danique | reward: 4 silver';
    assert.equal(applyOps(emptyTracker(), ops(single), { message: 1, said: 'Fine. I\'ll take it.' }).tracker.records[0].kind, 'quest');
    assert.equal(applyOps(emptyTracker(), ops(single), { message: 1, said: 'I won\'t take it.' }).tracker.records[0].kind, 'hook');
    assert.equal(applyOps(emptyTracker(), ops(single), { message: 1, said: null }).tracker.records[0].kind, 'hook', 'no message: an offer');
    // A main quest is the story's to give.
    assert.equal(applyOps(emptyTracker(), ops('+ quest The bond — pay it off | type: main'), { message: 1, said: null }).tracker.records[0].kind, 'quest');
    // Later: the reader accepts, and the model's + quest (or "- … accepted") now counts.
    const later = applyOps(offeredOnly.tracker, ops('+ quest Wolf Hunt — Kill ridge wolves'), { message: 3, said: 'I\'ll do the wolf job.' }).tracker;
    assert.equal(findRecord(later, 'Wolf Hunt').kind, 'quest');
    assert.equal(findRecord(applyOps(offeredOnly.tracker, ops('- Wolf Hunt — accepted by Wessel'), { message: 3, said: 'What does it pay?' }).tracker, 'Wolf Hunt').kind, 'hook');
    // The story moving it on means the character is doing it; "0/1" is not under way.
    assert.equal(findRecord(applyOps(offeredOnly.tracker, ops('~ Wolf Hunt — step: tracking the pack past the ditch'), { message: 3, said: 'I head out.' }).tracker, 'Wolf Hunt').kind, 'quest');
    assert.equal(findRecord(applyOps(offeredOnly.tracker, ops('~ Wolf Hunt — step: 0/1'), { message: 3, said: 'Hm.' }).tracker, 'Wolf Hunt').kind, 'hook');
    // Without the gate (no reader message given), the old behaviour.
    assert.equal(applyOps(emptyTracker(), ops(single), { message: 1 }).tracker.records[0].kind, 'quest');
    // offersChosenIn reads a message for the note.
    assert.deepEqual(offersChosenIn(offeredOnly.tracker, 'I accept the rat work.'), ['Rat Culling']);
    assert.deepEqual(offersChosenIn(offeredOnly.tracker, 'No thanks to the wolves.', 'refuse'), ['Wolf Hunt']);
});

test('giving a job up or turning it down needs the reader\'s word; failing it is the story\'s (0.9.15)', () => {
    const start = applyOps(emptyTracker(), ops('+ quest Wolf Hunt — Kill ridge wolves | giver: Danique | reward: 4 silver'), { message: 1, said: 'I take the wolf hunt.' }).tracker;
    const kept = applyOps(start, ops('- Wolf Hunt — abandoned'), { message: 3, said: 'I look around the fold.' });
    assert.equal(findRecord(kept.tracker, 'Wolf Hunt').status, 'active');
    assert.equal(kept.problems[0].kind, 'not-chosen');
    assert.equal(findRecord(applyOps(start, ops('~ Wolf Hunt — status: abandoned'), { message: 3, said: 'Onward.' }).tracker, 'Wolf Hunt').status, 'active');
    // The reader said so (in words, or with the Abandon button's line).
    assert.equal(findRecord(applyOps(start, ops('- Wolf Hunt — abandoned'), { message: 3, said: 'I give up on the wolf hunt, it is hopeless.' }).tracker, 'Wolf Hunt').status, 'resolved');
    // The Abandon flag: the reader's choice stamped on the reply, whatever their message says.
    assert.equal(findRecord(applyOps(start, ops('- Wolf Hunt — abandoned'), { message: 3, said: 'Onward.', chosen: ['wolf hunt'] }).tracker, 'Wolf Hunt').status, 'resolved');
    const replayed = replay([{ message: 3, ops: ops('- Wolf Hunt — abandoned'), text: '', time: null, said: 'Onward.', chosen: ['wolf hunt'] }], { seed: start });
    assert.equal(findRecord(replayed.tracker, 'Wolf Hunt').status, 'resolved');
    // Outcomes stay the story's.
    for (const reason of ['failed, the wolves scattered the flock', 'expired at sundown', 'done, ears delivered']) {
        assert.equal(findRecord(applyOps(start, ops(`- Wolf Hunt — ${reason}`), { message: 3, said: 'Hm.' }).tracker, 'Wolf Hunt').status, 'resolved', reason);
    }
    // An offer turned down only on the reader's word too.
    const offer = applyOps(emptyTracker(), ops('+ quest Rat Culling — rats | giver: Danique | reward: 8 copper'), { message: 1, said: 'Tell me more.' }).tracker;
    assert.equal(findRecord(applyOps(offer, ops('- Rat Culling — declined'), { message: 3, said: 'Okay.' }).tracker, 'Rat Culling').status, 'active');
    assert.equal(findRecord(applyOps(offer, ops('- Rat Culling — declined'), { message: 3, said: 'I decline the rat job.' }).tracker, 'Rat Culling').status, 'resolved');
});

test('a made-up name for a tracked job still finds it: plurals, compounds, job words, its description (0.9.16)', () => {
    const rec = (key, fields = {}) => ({ key, id: key.toLowerCase(), status: 'active', kind: 'quest', fields: { desc: '', goal: '', ...fields } });
    const sheep = [rec('Sheepfold Wolves'), rec('Rat Culling', { desc: 'Kill granary rats' })];
    assert.deepEqual(nearMatches(sheep, 'Fold Wolf Contract').map(m => m.record.key), ['Sheepfold Wolves']);
    const ridge = [rec('Wolf Hunt', { desc: 'Kill ridge wolves threatening the sheep fold' }), rec('Rat Culling', { desc: 'Kill granary rats' })];
    assert.deepEqual(nearMatches(ridge, 'Fold Wolf Contract').map(m => m.record.key), ['Wolf Hunt']);
    assert.deepEqual(nearMatches(ridge, 'Granary Rats').map(m => m.record.key), ['Rat Culling']);
    // A job word alone says nothing; two that fit are both named, neither taken.
    assert.deepEqual(nearMatches(ridge, 'The Contract'), []);
    const two = [rec('Sheepfold Wolves'), rec('Wolves of the Fold')];
    assert.equal(nearMatches(two, 'Fold Wolf Bounty').length, 2);
    // Applied: the ! goes to the one it means.
    const start = applyOps(emptyTracker(), ops('+ quest Wolf Hunt — Kill ridge wolves threatening the sheep fold | giver: Danique | reward: 4 silver'), { message: 1 }).tracker;
    const { problems } = applyOps(start, ops('! Fold Wolf Contract — the pack broke the hurdles again'), { message: 2 });
    assert.equal(problems[0].kind, 'near-key');
});

// (0.9.19) Aliases: a made-up name a line reached a record by is remembered on it.

const WOLF_HUNT = '+ quest Wolf Hunt — Kill ridge wolves threatening the sheep fold | giver: Danique | reward: 4 silver';

test('a name read as a record once is remembered, and later lines with it apply quietly (0.9.19)', () => {
    const entries = [
        { message: 1, time: 0, text: '', ops: ops(WOLF_HUNT) },
        { message: 3, time: 10, text: '', ops: ops('! Fold Wolf Contract — the pack broke the hurdles again\n~ Fold Wolf Contract — step: tracking the pack') },
        { message: 5, time: 20, text: '', ops: ops('~ **Fold Wolf Contract** — step: at the den') },
    ];
    const { tracker, problems } = replay(entries);
    // Matched once, in the first line; the second line of that reply and the next reply find it by its alias.
    assert.deepEqual(problems.map(problem => [problem.kind, problem.message]), [['near-key', 3]]);
    const hunt = findRecord(tracker, 'Wolf Hunt');
    assert.deepEqual(hunt.aliases, ['fold wolf contract']);
    assert.equal(hunt.fields.step, 'at the den');
    assert.deepEqual(hunt.history.map(entry => entry.message), [1, 3, 3, 5], 'each line leaves its trace on the record');
    assert.equal(tracker.records.length, 1);
    // Closed by its alias, it is a quest done; closing it again by that name changes nothing.
    const done = applyOps(tracker, ops('- Fold Wolf Contract — ears delivered, Danique paid'), { message: 7 });
    assert.deepEqual(done.problems, []);
    assert.deepEqual(questsDoneIn(done.tracker, 7).map(quest => quest.name), ['Wolf Hunt']);
    const again = applyOps(done.tracker, ops('- Fold Wolf Contract — done\n~ Fold Wolf Contract — reward: 4 silver and a ham'), { message: 9 });
    assert.equal(again.problems[0].kind, 'already-closed');
    assert.equal(again.tracker.records.length, 1, 'no new hook for a name it already has');
    assert.deepEqual(questsDoneIn(again.tracker, 9), []);
    // Nothing is remembered from an ambiguous key, a new hook or an exact key.
    const two = replay([
        { message: 1, time: 0, ops: ops('+ hook Footing at Bluewatch — a foothold\n+ hook Footing on Bluewatch — another') },
        { message: 2, time: 0, ops: ops('~ Footing in Bluewatch — now: a room\n~ Lantern Guild dues — now: owed\n~ Footing at Bluewatch — now: settled') },
    ]).tracker;
    assert.ok(two.records.every(record => record.aliases.length === 0));
});

test('a + on a remembered name is that record: a change, the quest taken on, or still an offer (0.9.19)', () => {
    const start = replay([
        { message: 1, time: 0, ops: ops('+ hook Sheepfold Wolves — wolves at the east fold | reward: 2 silver per ear') },
        { message: 2, time: 0, ops: ops('~ Fold Wolf Contract — shown: tracks by the pen') },
    ]).tracker;
    assert.deepEqual(findRecord(start, 'Sheepfold Wolves').aliases, ['fold wolf contract']);
    assert.equal(findRecord(start, 'Sheepfold Wolves').kind, 'hook');
    // A + of the same kind: applied as a change, saying which record it is.
    const plain = applyOps(start, ops('+ hook Fold Wolf Contract — now: the pack circles'), { message: 3 });
    assert.equal(plain.tracker.records.length, 1);
    assert.deepEqual(plain.problems.map(problem => [problem.kind, problem.message]), [
        ['duplicate-add', '"Fold Wolf Contract" is already tracked as "Sheepfold Wolves"; the + was applied as a change.'],
    ]);
    assert.equal(findRecord(plain.tracker, 'Sheepfold Wolves').fields.now, 'the pack circles');
    // + quest: the job taken on only on the reader's word (0.9.15), never a second record.
    const offered = applyOps(start, ops('+ quest Fold Wolf Contract — cull the pack | giver: Nelke'), { message: 3, said: 'What does it pay?' });
    assert.equal(offered.tracker.records.length, 1);
    assert.equal(findRecord(offered.tracker, 'Sheepfold Wolves').kind, 'hook');
    assert.equal(offered.problems[0].kind, 'offered');
    const taken = applyOps(start, ops('+ quest Fold Wolf Contract — cull the pack | giver: Nelke'), { message: 3, said: 'Fine, I\'ll take it.' });
    assert.equal(taken.tracker.records.length, 1);
    assert.equal(findRecord(taken.tracker, 'Sheepfold Wolves').kind, 'quest');
    assert.equal(findRecord(taken.tracker, 'Sheepfold Wolves').fields.giver, 'Nelke');
    assert.equal(taken.problems[0].kind, 'became-quest');
    // With two jobs in the reply, the reader names this one by the name the story gave it.
    const both = '+ quest Fold Wolf Contract — cull the pack | giver: Nelke\n+ quest Rat Culling — rats | giver: Danique | reward: 8 copper';
    const named = applyOps(start, ops(both), { message: 3, said: 'I accept the fold wolf contract.' }).tracker;
    assert.deepEqual(named.records.map(record => [record.key, record.kind]), [['Sheepfold Wolves', 'quest'], ['Rat Culling', 'hook']]);
    // Closed, a + on the name reopens it, as one on its key would.
    const closed = applyOps(start, ops('- Sheepfold Wolves — the pack moved on'), { message: 3 }).tracker;
    const reopened = applyOps(closed, ops('+ hook Fold Wolf Contract — the pack is back'), { message: 4 });
    assert.equal(reopened.problems[0].kind, 'reopened');
    assert.equal(reopened.tracker.records.length, 1);
    assert.equal(findRecord(reopened.tracker, 'Sheepfold Wolves').status, 'active');
    assert.deepEqual(findRecord(reopened.tracker, 'Sheepfold Wolves').aliases, ['fold wolf contract'], 'its names are identity, kept');
});

test('aliases: a record\'s own id wins, the first record keeps a name two claim, the newest eight are kept (0.9.19)', () => {
    const base = applyOps(emptyTracker(), ops('+ hook Sheepfold Wolves — wolves at the fold\n+ hook Wolves of the Fold — the other pack\n+ hook Fold Wolf Contract — a real record by that name'), { message: 1 }).tracker;
    // Built by hand: both packs claim the same name, and one claims another record's key.
    const claimed = { ...base, records: base.records.map((record, index) => ({ ...record, aliases: index < 2 ? ['the fold pack', 'fold wolf contract'] : [] })) };
    const { tracker, problems } = applyOps(claimed, ops('~ The Fold Pack — now: howling\n~ Fold Wolf Contract — now: signed'), { message: 2 });
    assert.deepEqual(problems, [], 'neither line is matched afresh, so neither is ambiguous');
    assert.deepEqual(tracker.records.map(record => record.fields.now), ['howling', '', 'signed']);
    assert.equal(findRecord(claimed, 'the fold pack').key, 'Sheepfold Wolves');
    assert.equal(findRecord(claimed, 'Fold Wolf Contract').key, 'Fold Wolf Contract');
    // A name already held is not taken by another record: the first keeps it.
    const once = replay([
        { message: 1, time: 0, ops: ops('+ hook Sheepfold Wolves — wolves at the fold') },
        { message: 2, time: 0, ops: ops('~ Fold Wolf Bounty — now: tracks') },
        { message: 3, time: 0, ops: ops('+ hook Wolves of the Fold — the other pack') },
        { message: 4, time: 0, ops: ops('~ Fold Wolf Bounty — now: howling') },
    ]);
    assert.deepEqual(once.tracker.records.map(record => [record.key, record.fields.now, record.aliases]), [
        ['Sheepfold Wolves', 'howling', ['fold wolf bounty']], ['Wolves of the Fold', '', []],
    ]);
    assert.deepEqual(once.problems.map(problem => problem.kind), ['near-key'], 'two records fit now, but the name is already the first one\'s');
    // At most eight names, the newest kept.
    const names = ['Footing in Bluewatch', 'Footing on Bluewatch', 'Footing for Bluewatch', 'Footing to Bluewatch', 'Footing from Bluewatch', 'The Footing at Bluewatch', 'Footing, Bluewatch', 'A Footing in Bluewatch', 'Footing of Bluewatch', 'Footing and Bluewatch'];
    let many = applyOps(emptyTracker(), ops('+ hook Footing at Bluewatch — a foothold'), { message: 0 }).tracker;
    many = applyOps(many, ops(names.map((name, index) => `~ ${name} — now: room ${index}`).join('\n')), { message: 1 }).tracker;
    const footing = findRecord(many, 'Footing at Bluewatch');
    assert.equal(footing.aliases.length, 8);
    assert.deepEqual(footing.aliases, names.slice(2).map(name => lineKey(name)));
    assert.equal(footing.fields.now, 'room 9');
    assert.equal(findRecord(many, 'Footing in Bluewatch'), null, 'the oldest names are let go');
});

test('aliases replay deterministically, roll back with the reply, and need nothing from older trackers (0.9.19)', () => {
    const entries = [
        { message: 1, time: 0, text: '', ops: ops(WOLF_HUNT) },
        { message: 3, time: 10, text: '', ops: ops('! Fold Wolf Contract — the pack attacks') },
        { message: 5, time: 20, text: '', ops: ops('~ Fold Wolf Contract — step: at the den') },
    ];
    assert.deepEqual(replay(entries), replay(entries));
    // The reply that made the alias swiped away: the name is gone with it.
    const rolled = replay(entries.slice(0, 1)).tracker;
    assert.deepEqual(findRecord(rolled, 'Wolf Hunt').aliases, []);
    assert.equal(findRecord(rolled, 'Fold Wolf Contract'), null);
    const later = replay([entries[0], entries[2]]);
    assert.equal(later.problems[0].kind, 'near-key', 'without it, the next line is matched afresh');
    // A tracker saved before 0.9.19 has no aliases at all, and inputs stay untouched.
    const old = applyOps(emptyTracker(), ops(WOLF_HUNT), { message: 1 }).tracker;
    const seed = deepFreeze({ ...old, records: old.records.map(({ aliases: _a, ...record }) => record) });
    const { tracker } = replay(entries.slice(1), { seed });
    assert.equal(seed.records[0].aliases, undefined);
    assert.deepEqual(findRecord(tracker, 'Wolf Hunt').aliases, ['fold wolf contract']);
    assert.equal(findRecord(tracker, 'Wolf Hunt').fields.step, 'at the den');
    assert.equal(findRecord(seed, 'Fold Wolf Contract'), null);
});

test('findRecord finds a record by a name it was reached by (0.9.19)', () => {
    const { tracker } = replay([
        { message: 1, time: 0, ops: ops(WOLF_HUNT) },
        { message: 2, time: 0, ops: ops('~ Fold Wolf Contract — step: tracking') },
    ]);
    assert.equal(findRecord(tracker, 'Fold Wolf Contract').key, 'Wolf Hunt');
    assert.equal(findRecord(tracker, '**fold wolf contract!**').key, 'Wolf Hunt');
    assert.equal(findRecord(tracker, 'wolf hunt').key, 'Wolf Hunt');
    assert.equal(findRecord(tracker, 'Fold Wolf'), null, 'an alias is matched whole');
});

test('an offer the story says is done closes as the quest {{user}} finished, when they spoke of it (0.9.27)', () => {
    const offer = '+ hook Barrow-Viper Clearing — clear the viper pit by the barrow | giver: Verna | reward: 2 silver';
    const start = applyOps(emptyTracker(), ops(offer), { message: 1, said: 'I ask Verna for work.' }).tracker;
    assert.equal(findRecord(start, 'Barrow-Viper Clearing').kind, 'hook');
    // The reader went and did it, never saying "I accept".
    const went = applyOps(start, ops('~ Barrow-Viper Clearing — now: at the pit'), { message: 3, said: 'I head out to the barrow and clear the vipers.' }).tracker;
    assert.ok(findRecord(went, 'Barrow-Viper Clearing').engaged, 'naming the job marks it spoken of');
    const { tracker, problems } = applyOps(went, ops('! Barrow-Viper Clearing — cleared pit, 10 skins turned in to Verna'), { message: 5, said: 'I hand Verna the skins.' });
    const done = findRecord(tracker, 'Barrow-Viper Clearing');
    assert.equal(done.kind, 'quest');
    assert.equal(done.status, 'resolved');
    assert.deepEqual(questsDoneIn(tracker, 5).map(quest => quest.name), ['Barrow-Viper Clearing']);
    assert.ok(problems.some(problem => problem.kind === 'done-offer'));
    // `~ … step: completed` and `- … — done` say the same.
    assert.equal(findRecord(applyOps(went, ops('~ Barrow-Viper Clearing — step: completed, voucher paid'), { message: 5, said: 'I collect my pay.' }).tracker, 'Barrow-Viper Clearing').kind, 'quest');
    assert.equal(questsDoneIn(applyOps(went, ops('- Barrow-Viper Clearing — skins handed in, bounty paid'), { message: 5, said: 'I wait.' }).tracker, 5).length, 1);
    // Never spoken of: the offer still closes (it is off the Offered list), but it was no quest of theirs.
    const elsewhere = applyOps(start, ops('! Barrow-Viper Clearing — completed by the Hollin brothers'), { message: 3, said: 'I sleep in.' }).tracker;
    assert.equal(findRecord(elsewhere, 'Barrow-Viper Clearing').status, 'resolved');
    assert.equal(findRecord(elsewhere, 'Barrow-Viper Clearing').kind, 'hook');
    assert.deepEqual(questsDoneIn(elsewhere, 3), []);
    // Failed, given up or lapsed is no quest done; a `!` that is only news changes nothing.
    assert.equal(findRecord(applyOps(went, ops('- Barrow-Viper Clearing — offer lapsed'), { message: 5 }).tracker, 'Barrow-Viper Clearing').kind, 'hook');
    assert.equal(findRecord(applyOps(went, ops('- Barrow-Viper Clearing — the job failed, the pit collapsed'), { message: 5, said: 'I look.' }).tracker, 'Barrow-Viper Clearing').kind, 'hook');
    assert.equal(findRecord(applyOps(went, ops('! Barrow-Viper Clearing — the guide withdrew'), { message: 5, said: 'I look.' }).tracker, 'Barrow-Viper Clearing').status, 'active', 'a `!` on an offer closes it only when it says done');
    assert.equal(findRecord(applyOps(went, ops('! Barrow-Viper Clearing — a viper bites the guide'), { message: 5, said: 'I look.' }).tracker, 'Barrow-Viper Clearing').status, 'active');
});

test('a `~` reading as over on nothing tracked makes no record (0.9.27)', () => {
    const { tracker, problems } = applyOps(emptyTracker(), ops('~ Quests: North Levee Vipers — step: completed, voucher paid'), { message: 2, said: 'I collect.' });
    assert.equal(tracker.records.length, 0);
    assert.ok(problems.some(problem => problem.kind === 'unknown-key' && problem.severity === 'info'));
    // One that is not over still adds a hook, as before.
    assert.equal(applyOps(emptyTracker(), ops('~ Levee Vipers — step: hunting'), { message: 2 }).tracker.records.length, 1);
});

test('taking a job: "we" as well as "I", joining, and a plain yes to the one new quest (0.9.27)', () => {
    const hook = '+ hook Wolfhound Hunt — run down the wolfhounds | giver: Burl | reward: 1 gold';
    const start = applyOps(emptyTracker(), ops(hook), { message: 1, said: 'Hello.' }).tracker;
    const take = (said, line = '+ quest Wolfhound Hunt — run down the wolfhounds | giver: Burl | reward: 1 gold') => findRecord(applyOps(start, ops(line), { message: 3, said }).tracker, 'Wolfhound Hunt').kind;
    assert.equal(take("We'll join the wolfhound hunt."), 'quest');
    assert.equal(take('Count us in, Burl.'), 'quest');
    assert.equal(take("Sure, I'm up for it."), 'quest');
    assert.equal(take('Yes.'), 'quest', 'a plain yes to the reply\'s one new quest');
    assert.equal(take('I look at the map.'), 'hook');
    assert.equal(take("I won't join the hunt."), 'hook');
    // A plain yes with two new quests in the reply says which one only by name.
    assert.equal(take('Yes.', '+ quest Wolfhound Hunt — run down the wolfhounds | giver: Burl\n+ quest Ferry Run — row the ferry | giver: Ola'), 'hook');
});

test('a quest with only its pay left is not failed for the hour passing (0.9.28)', () => {
    const start = applyOps(emptyTracker(), ops('+ quest Lone Grey Wolf — hunt the pack | giver: Verna | reward: 1 gold\n~ Lone Grey Wolf — step: turn in voucher at bailiff hatch on Friday noon | due: Goldwane 14, 12:00 pm'), { message: 1 }).tracker;
    for (const line of ['- Lone Grey Wolf — failed: deadline passed', '- Lone Grey Wolf — voucher expired, too late', '~ Lone Grey Wolf — status: failed (missed the window)']) {
        const { tracker, problems } = applyOps(start, ops(line), { message: 3, said: 'I wait.' });
        assert.equal(findRecord(tracker, 'Lone Grey Wolf').status, 'active', line);
        assert.ok(problems.some(problem => problem.kind === 'pay-waiting'), line);
    }
    // Done is done, and a failure that is not about time still ends it.
    assert.deepEqual(questsDoneIn(applyOps(start, ops('- Lone Grey Wolf — voucher cashed, 1 gold paid'), { message: 3 }).tracker, 3).map(quest => quest.name), ['Lone Grey Wolf']);
    assert.equal(findRecord(applyOps(start, ops('- Lone Grey Wolf — failed: the bailiff tore up the voucher'), { message: 3 }).tracker, 'Lone Grey Wolf').status, 'resolved');
    // While the work is still to do, a passed deadline fails it as before.
    const hunting = applyOps(emptyTracker(), ops('+ quest Wolves — hunt the pack | giver: Verna | step: track the pack | due: Goldwane 14'), { message: 1 }).tracker;
    assert.equal(findRecord(applyOps(hunting, ops('- Wolves — failed: deadline passed'), { message: 3 }).tracker, 'Wolves').status, 'resolved');
});

test('"- Key — failed: deadline passed" is a failure, not a quest done (0.9.28)', () => {
    const start = applyOps(emptyTracker(), ops('+ quest Wolves — hunt the pack | giver: Verna | step: track the pack'), { message: 1 }).tracker;
    const failed = applyOps(start, ops('- Wolves — failed: the pack fled north'), { message: 3 }).tracker;
    assert.equal(findRecord(failed, 'Wolves').resolved.reason, 'failed: the pack fled north');
    assert.deepEqual(questsDoneIn(failed, 3), []);
    const done = applyOps(start, ops('- Wolves — done: pack slain'), { message: 3 }).tracker;
    assert.equal(questsDoneIn(done, 3).length, 1);
});

test('"took down all three contracts" takes on the three offers shown last; turning them all down does not (0.9.32)', () => {
    const old = applyOps(emptyTracker(), ops('+ hook Mill Pond Eel — drive off the eel | giver: Miller Bram | reward: 4 silver'), { message: 1 }).tracker;
    const board = [
        '+ hook Wicker Bed Hogs — drive the hogs off the wicker beds | giver: Reeve Hollis | reward: 6 silver',
        '+ hook Granary Rats — clear the second granary | giver: Factor Dunn | reward: 5 silver',
        '+ hook Lost Ledger — find the tithe ledger | giver: Brother Aldo | reward: 3 silver',
    ].join('\n');
    const start = applyOps(old, ops(board), { message: 3 }).tracker;
    const said = 'I nodded and took down all three contracts and head south to the wicker beds with a rented handcart, it wasn\'t hard to spot when the hogs are still digging there.';
    const taken = ['~ Wicker Bed Hogs — accepted | type: bounty', '~ Granary Rats — accepted | type: bounty', '~ Lost Ledger — accepted | type: bounty', '~ Mill Pond Eel — accepted'].join('\n');
    const { tracker } = applyOps(start, ops(taken), { message: 5, said });
    for (const key of ['Wicker Bed Hogs', 'Granary Rats', 'Lost Ledger']) assert.equal(findRecord(tracker, key).kind, 'quest', key);
    // The older offer was not among the three on the board.
    assert.notEqual(findRecord(tracker, 'Mill Pond Eel').kind, 'quest');
    // "Both jobs" is the two shown last; no word for taking them on is still no choice.
    const two = applyOps(start, ops(taken), { message: 5, said: 'I take both jobs.' }).tracker;
    assert.deepEqual(['Wicker Bed Hogs', 'Granary Rats', 'Lost Ledger'].map(key => findRecord(two, key).kind === 'quest').filter(Boolean).length, 2);
    const looked = applyOps(start, ops(taken), { message: 5, said: 'I read all three contracts twice.' }).tracker;
    assert.ok(['Wicker Bed Hogs', 'Granary Rats', 'Lost Ledger'].every(key => findRecord(looked, key).kind !== 'quest'));
    assert.ok(['Wicker Bed Hogs', 'Granary Rats'].every(key => findRecord(applyOps(start, ops(taken), { message: 5, said: "I don't take any of them; I turned them all down." }).tracker, key).kind !== 'quest'));
});

test('an offer taken on with the button is a quest on the reply\'s "~ Key — accepted", whatever the message said (0.9.33)', () => {
    const start = applyOps(emptyTracker(), ops('+ hook Lime Kiln Bats — clear the bats | giver: Elke | reward: 5 silver\n+ hook Drake Shallows — kill the drake | giver: Elke | reward: 2 gold'), { message: 1 }).tracker;
    const reply = '~ Lime Kiln Bats — accepted\n- Drake Shallows — declined';
    const { tracker } = applyOps(start, ops(reply), { message: 3, said: 'I head for the Stray Oar.', taken: ['lime kiln bats'], chosen: ['drake shallows'] });
    assert.equal(findRecord(tracker, 'Lime Kiln Bats').kind, 'quest');
    assert.equal(findRecord(tracker, 'Drake Shallows').status, 'resolved');
    // Without the stamps the same lines change nothing: the message chose neither.
    const plain = applyOps(start, ops(reply), { message: 3, said: 'I head for the Stray Oar.' }).tracker;
    assert.notEqual(findRecord(plain, 'Lime Kiln Bats').kind, 'quest');
    assert.equal(findRecord(plain, 'Drake Shallows').status, 'active');
});
