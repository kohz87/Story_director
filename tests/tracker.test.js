// Tests for src/tracker.js: every op rule of the contract, driven through replay the way the
// extension rebuilds the tracker from a chat, plus markSeen and the no-mutation guarantee.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseChanges } from '../src/changes.js';
import { activeRecords, applyOps, emptyTracker, findRecord, keyWords, markSeen, nearMatches, questsDoneIn, replay, untrackedCorrections } from '../src/tracker.js';

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
            people: 'Kade, Al', encounter: '', type: '', giver: '', goal: '', reward: '', step: '', difficulty: '',
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
        assert.deepEqual(findRecord(tracker, 'Footing at Bluewatch').history.at(-1), { message: 1, op: '~', text: `~ ${key} — now: a room at the inn` });
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
    assert.deepEqual(added.history, [{ message: 1, op: '~', text: '~ Lantern Guild dues — now: two silver owed | people: Brann' }]);
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
