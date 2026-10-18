// Tests for src/changes.js: the change-line grammar on real model output, the key and part
// rules, and the formatOp round trip.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FIELDS, KINDS, KIND_ALIASES, QUEST_DIFFICULTIES, formatOp, lineKey, parseChanges, questDifficulty } from '../src/changes.js';

// Real <Director> output, including a bulleted op, a bolded op and a stray prose line.
const REAL = [
    '+ agenda Courier — now: rides south from Shorn | then: delivers the writ | leg: Shorn → Varnhold Watch 35 B, courier 70/day → 0.5 | arrive: Haywane 13, morning',
    '~ Senior Listener Geva — then: files the warrant with the Bailiff Court | on: Haywane 13, 09:00 am',
    '- Thys — left the city',
    '- Hall-Warden Kell — superseded by the new garrison captain',
    '! Canal Street Granary Fires — curfew declared',
    '* + hook River stranger — who pulled Ren from the sump; finding him settles the debt | then: he sends word | on: Haywane 15',
    '**~ Brant:** then: reaches Auvoth | arrive: Haywane 17, evening',
    '+ Senior Listener Geva — now: District Bailiff Court | then: argues with magistrates | on: Haywane 12, 05:45 pm',
    '+ clock Hollin\'s Reach graves — washed graves left uncompleted → the first of the dead rise | due: Goldwane 28 | shown: none',
    'this line is not a change',
].join('\n');

function withoutRaw(op) {
    const { raw, ...rest } = op;
    return rest;
}

function only(text) {
    const { ops, errors } = parseChanges(text);
    assert.deepEqual(errors, []);
    assert.equal(ops.length, 1);
    return ops[0];
}

test('exports the kinds, fields and aliases of the contract', () => {
    assert.deepEqual(KINDS, ['agenda', 'event', 'hook', 'quest', 'clock', 'beat', 'secret', 'arc']);
    assert.deepEqual(FIELDS, ['desc', 'now', 'then', 'on', 'due', 'shown', 'leg', 'arrive', 'place', 'people', 'encounter', 'type', 'giver', 'goal', 'reward', 'step', 'difficulty']);
    assert.equal(KIND_ALIASES.bounty, 'quest');
    assert.equal(KIND_ALIASES.contract, 'quest');
    assert.equal(KIND_ALIASES.offscreen, 'agenda');
    assert.equal(KIND_ALIASES['off-screen'], 'agenda');
    assert.equal(KIND_ALIASES.npc, 'agenda');
    assert.equal(KIND_ALIASES.world, 'event');
    assert.equal(KIND_ALIASES.thread, 'hook');
    assert.equal(KIND_ALIASES.hooks, 'hook');
    assert.equal(KIND_ALIASES.timer, 'clock');
    assert.equal(KIND_ALIASES.clocks, 'clock');
    assert.equal(KIND_ALIASES.plan, 'beat');
    assert.equal(KIND_ALIASES['off-limits'], 'secret');
});

test('lineKey squashes case, markdown and punctuation', () => {
    assert.equal(lineKey('**Senior Listener Geva**'), 'senior listener geva');
    assert.equal(lineKey('  Senior   Listener\tGeva '), 'senior listener geva');
    assert.equal(lineKey('Hollin\'s Reach graves'), 'hollins reach graves');
    assert.equal(lineKey('Hollin’s Reach graves'), 'hollins reach graves');
    assert.equal(lineKey('Jean-Luc'), 'jean luc');
    assert.equal(lineKey('Canal Street Granary Fires!'), 'canal street granary fires');
    assert.equal(lineKey(lineKey('Hall-Warden Kell')), 'hall warden kell');
    assert.equal(lineKey(''), '');
});

test('parses the real change lines', () => {
    const { ops, errors } = parseChanges(REAL);
    assert.equal(ops.length, 9);
    assert.deepEqual(errors, [
        { line: 10, text: 'this line is not a change', message: errors[0].message },
    ]);

    assert.deepEqual(withoutRaw(ops[0]), {
        op: '+', kind: 'agenda', key: 'Courier', id: 'courier',
        fields: {
            now: 'rides south from Shorn',
            then: 'delivers the writ',
            leg: 'Shorn → Varnhold Watch 35 B, courier 70/day → 0.5',
            arrive: 'Haywane 13, morning',
        },
        extra: {}, reason: '',
    });
    assert.equal(ops[0].raw, REAL.split('\n')[0]);

    assert.deepEqual(withoutRaw(ops[1]), {
        op: '~', kind: null, key: 'Senior Listener Geva', id: 'senior listener geva',
        fields: { then: 'files the warrant with the Bailiff Court', on: 'Haywane 13, 09:00 am' },
        extra: {}, reason: '',
    });

    assert.deepEqual(withoutRaw(ops[2]), {
        op: '-', kind: null, key: 'Thys', id: 'thys', fields: {}, extra: {}, reason: 'left the city',
    });
    assert.equal(ops[3].key, 'Hall-Warden Kell');
    assert.equal(ops[3].reason, 'superseded by the new garrison captain');

    assert.deepEqual(withoutRaw(ops[4]), {
        op: '!', kind: null, key: 'Canal Street Granary Fires', id: 'canal street granary fires',
        fields: {}, extra: {}, reason: 'curfew declared',
    });

    // A bullet before an op is decoration.
    assert.deepEqual(withoutRaw(ops[5]), {
        op: '+', kind: 'hook', key: 'River stranger', id: 'river stranger',
        fields: {
            desc: 'who pulled Ren from the sump; finding him settles the debt',
            then: 'he sends word',
            on: 'Haywane 15',
        },
        extra: {}, reason: '',
    });

    // Bold stripped; with no dash the key ends at the colon.
    assert.deepEqual(withoutRaw(ops[6]), {
        op: '~', kind: null, key: 'Brant', id: 'brant',
        fields: { then: 'reaches Auvoth', arrive: 'Haywane 17, evening' },
        extra: {}, reason: '',
    });

    // No kind written: `now` makes it an agenda.
    assert.equal(ops[7].kind, 'agenda');
    assert.equal(ops[7].fields.now, 'District Bailiff Court');
    assert.equal(ops[7].fields.on, 'Haywane 12, 05:45 pm');

    assert.deepEqual(withoutRaw(ops[8]), {
        op: '+', kind: 'clock', key: 'Hollin\'s Reach graves', id: 'hollins reach graves',
        fields: {
            desc: 'washed graves left uncompleted → the first of the dead rise',
            due: 'Goldwane 28',
            shown: 'none',
        },
        extra: {}, reason: '',
    });
});

test('only a spaced hyphen ends a key', () => {
    assert.equal(only('~ Jean-Luc Picard - then: hails the ship').key, 'Jean-Luc Picard');
    assert.equal(only('~ Jean-Luc Picard - then: hails the ship').fields.then, 'hails the ship');
    assert.equal(only('- Jean-Luc – retired').key, 'Jean-Luc');
    assert.equal(only('- Jean-Luc – retired').reason, 'retired');
    // No separator at all: the whole first part is the key.
    assert.deepEqual(withoutRaw(only('- Jean-Luc')), {
        op: '-', kind: null, key: 'Jean-Luc', id: 'jean luc', fields: {}, extra: {}, reason: '',
    });
    assert.equal(only('~ Thys—then: waits').key, 'Thys');
});

test('the colon ends a key only after at most 8 words', () => {
    assert.equal(only('~ One two three four five six seven eight: then: x').key, 'One two three four five six seven eight');
    const long = only('! one two three four five six seven eight nine: then it burned');
    assert.equal(long.key, 'one two three four five six seven eight nine: then it burned');
    // The key search stays inside the first part, so a later spaced hyphen cannot move it.
    const brant = only('~ Brant: then: reaches Auvoth | leg: Bluewatch → Auvoth - by wagon');
    assert.equal(brant.key, 'Brant');
    assert.equal(brant.fields.leg, 'Bluewatch → Auvoth - by wagon');
});

test('a key ending in a field word gives that label to the first part', () => {
    const geva = only('~ **Geva now:** District Bailiff Court | then: argues');
    assert.equal(geva.key, 'Geva');
    assert.deepEqual(geva.fields, { now: 'District Bailiff Court', then: 'argues' });
    // Capitalised, it is part of the name.
    const race = only('+ event The Long Leg: a race along the coast');
    assert.equal(race.key, 'The Long Leg');
    assert.equal(race.fields.desc, 'a race along the coast');
});

test('labelled parts go to fields, short labels to extra, the rest to desc or reason', () => {
    const op = only('+ agenda Geva — at the court | now: Court | mood: grim | Deeply Held Private Belief: x | people: Kade, Ren');
    assert.deepEqual(op.fields, {
        desc: 'at the court; Deeply Held Private Belief: x',
        now: 'Court',
        people: 'Kade, Ren',
    });
    assert.deepEqual(op.extra, { mood: 'grim' });

    // Times and tight colons stay inside values; a known field may skip the space.
    const times = only('~ Geva — meets Kade at 09:00 | on:Haywane 13, 09:00 am');
    assert.equal(times.fields.desc, 'meets Kade at 09:00');
    assert.equal(times.fields.on, 'Haywane 13, 09:00 am');

    // An empty labelled part is a deliberate clear.
    assert.deepEqual(only('~ Geva — then: | on:').fields, { then: '', on: '' });

    const fired = only('! Fires — curfew declared | then: riots | reason: the bells rang');
    assert.equal(fired.reason, 'curfew declared; the bells rang');
    assert.deepEqual(fired.fields, { then: 'riots' });
});

test('+ infers or reads a kind, including aliases', () => {
    assert.equal(only('+ Courier — leg: Shorn → Varnhold 35 B').kind, 'agenda');
    assert.equal(only('+ Graves — the dead rise | due: Goldwane 28').kind, 'clock');
    assert.equal(only('+ Fires — the lower city burns').kind, 'event');
    assert.equal(only('+ off-screen Geva — then: waits').kind, 'agenda');
    assert.equal(only('+ NPC Geva — then: waits').kind, 'agenda');
    assert.equal(only('+ timer Graves — due: Goldwane 28').kind, 'clock');
    assert.equal(only('+ off-limits Kade sold the route').kind, 'secret');
    assert.equal(only('+ plan Council session opens — on: Goldwane 18').kind, 'beat');

    const bank = only('+ world World Bank — opens');
    assert.equal(bank.kind, 'event');
    assert.equal(bank.key, 'World Bank');
    // A kind word with no key after it is the key.
    assert.equal(only('+ world — burns').key, 'world');
    // Only `+` takes a kind.
    assert.equal(only('~ agenda — then: x').key, 'agenda');
});

test('blank lines are skipped and junk lines are errors, never crashes', () => {
    const { ops, errors } = parseChanges('\n  \n---\n+\n+ — nothing\n*** \nGeva walked in.\r\n~ Geva — then: x\r\n');
    assert.equal(ops.length, 1);
    assert.equal(ops[0].fields.then, 'x');
    assert.deepEqual(errors.map(error => error.line), [3, 4, 5, 6, 7]);
    assert.deepEqual(parseChanges(''), { ops: [], errors: [] });
    assert.deepEqual(parseChanges(null), { ops: [], errors: [] });
});

test('formatOp round-trips the real lines', () => {
    for (const op of parseChanges(REAL).ops) {
        const line = formatOp(op);
        const back = parseChanges(line);
        assert.deepEqual(back.errors, [], line);
        assert.deepEqual(withoutRaw(back.ops[0]), withoutRaw(op), line);
    }
    assert.equal(
        formatOp(parseChanges(REAL).ops[6]),
        '~ Brant — then: reaches Auvoth | arrive: Haywane 17, evening',
    );
});

test('formatOp round-trips awkward hand-built ops', () => {
    const ops = [
        // desc that would read as a label, and an extra.
        { op: '+', kind: 'event', key: 'Fires', id: 'fires', fields: { desc: 'Lower city: ablaze' }, extra: { mood: 'grim' }, reason: '' },
        // A reason that would read as a label.
        { op: '-', kind: null, key: 'Thys', id: 'thys', fields: {}, extra: {}, reason: 'cause: left the city' },
        // A key containing a colon, with no parts.
        { op: '-', kind: null, key: 'Operation: Nightfall', id: 'operation nightfall', fields: {}, extra: {}, reason: '' },
        // Explicit clears.
        { op: '~', kind: null, key: 'Geva', id: 'geva', fields: { desc: '', then: '', on: '' }, extra: {}, reason: '' },
        // A fired line with fields, including desc.
        { op: '!', kind: null, key: 'Geva', id: 'geva', fields: { desc: 'tired', then: 'waits', on: 'Haywane 14' }, extra: {}, reason: 'warrant filed' },
        // A key starting with an alias word.
        { op: '+', kind: 'agenda', key: 'World Bank courier', id: 'world bank courier', fields: { now: 'Shorn' }, extra: {}, reason: '' },
        { op: '+', kind: 'hook', key: 'Jean-Luc', id: 'jean luc', fields: {}, extra: {}, reason: '' },
    ];
    for (const op of ops) {
        const line = formatOp(op);
        const back = parseChanges(line);
        assert.deepEqual(back.errors, [], line);
        assert.deepEqual(withoutRaw(back.ops[0]), op, line);
    }

    // A `+` with no kind writes the inferred one.
    const bare = { op: '+', kind: null, key: 'World Bank', id: 'world bank', fields: { due: 'Goldwane 28' }, extra: {}, reason: '' };
    assert.equal(formatOp(bare), '+ clock World Bank — due: Goldwane 28');
});

test('a quest line: its own fields, kind inferred from them, and aliases', () => {
    const { ops } = parseChanges('+ quest Bounty on Kettle Jack — giver: Warden Hale | goal: bring him in alive | reward: 40 crowns | due: Haywane 30\n+ Herb run — goal: twelve moonleaf | step: two found\n+ bounty Wolf pelts — reward: 2 silver each');
    assert.deepEqual(ops.map(op => op.kind), ['quest', 'hook', 'quest'], 'a goal and a step alone are an open thread (0.9.3)');
    assert.equal(ops[2].fields.type, 'bounty', 'the word written is its category');
    assert.equal(ops[0].fields.type, undefined);
    assert.deepEqual(ops[0].fields, { giver: 'Warden Hale', goal: 'bring him in alive', reward: '40 crowns', due: 'Haywane 30' });
    // Written back in field order, so it reads back the same.
    assert.equal(formatOp(ops[0]), '+ quest Bounty on Kettle Jack — due: Haywane 30 | giver: Warden Hale | goal: bring him in alive | reward: 40 crowns');
    assert.deepEqual(parseChanges(formatOp(ops[0])).ops[0].fields, ops[0].fields);
});

test('an encounter: stored as written on a beat, a quest or a clock, and written back the same', () => {
    const beat = only('+ beat Ambush at the weir — on: Haywane 14 | place: Weir road | encounter: 3 bandit, bandit captain (boss)');
    assert.equal(beat.kind, 'beat');
    assert.deepEqual(beat.fields, { on: 'Haywane 14', place: 'Weir road', encounter: '3 bandit, bandit captain (boss)' });
    assert.equal(formatOp(beat), '+ beat Ambush at the weir — on: Haywane 14 | place: Weir road | encounter: 3 bandit, bandit captain (boss)');
    assert.deepEqual(withoutRaw(only(formatOp(beat))), withoutRaw(beat));

    // Never parsed beyond storing it: counts, ×, ranks and roles stay as the model wrote them.
    for (const foes of ['2 x dire wolf rank D', '2 × dire wolf rank D, 1 alpha wolf (boss) rank C', 'Kettle Jack (boss), 3 thug healer']) {
        assert.equal(only(`~ Ambush at the weir — encounter: ${foes}`).fields.encounter, foes);
    }
    const bounty = only('+ bounty Kettle Jack — goal: bring him in | encounter: Kettle Jack (boss), 2 thug');
    assert.equal(bounty.kind, 'quest');
    assert.equal(bounty.fields.encounter, 'Kettle Jack (boss), 2 thug');
    assert.equal(only('+ Wolf pack — due: Haywane 20 | encounter: 4 wolf').kind, 'clock');
    // Foes and nothing else to say what it is: a planned fight is a beat.
    assert.equal(only('+ Ridge wolves — on: Haywane 15 | encounter: 2 x dire wolf').kind, 'beat');
    assert.equal(only('+ Ridge wolves — encounter:2 dire wolf').fields.encounter, '2 dire wolf', 'a known field may skip the space');
});

test('a quest difficulty: four words, synonyms, unknown or missing reads normal', () => {
    assert.deepEqual(QUEST_DIFFICULTIES, ['easy', 'normal', 'hard', 'nightmare']);
    const cases = {
        easy: 'easy', Trivial: 'easy', 'simple errand': 'easy',
        normal: 'normal', medium: 'normal', Moderate: 'normal',
        hard: 'hard', '**Difficult**': 'hard', 'very tough': 'hard',
        nightmare: 'nightmare', deadly: 'nightmare', 'near impossible': 'nightmare', EXTREME: 'nightmare',
        '': 'normal', brutish: 'normal', '???': 'normal',
    };
    for (const [written, expected] of Object.entries(cases)) assert.equal(questDifficulty(written), expected, written);
    assert.equal(questDifficulty(undefined), 'normal');
    assert.equal(questDifficulty(null), 'normal');
});

test('difficulty is a quest field: stored as one of the four words, inferred, and written back', () => {
    const op = only('+ quest Kettle Jack — giver: Warden Hale | difficulty: Deadly | reward: 40 crowns');
    assert.equal(op.kind, 'quest');
    assert.deepEqual(op.fields, { giver: 'Warden Hale', difficulty: 'nightmare', reward: '40 crowns' });
    assert.equal(formatOp(op), '+ quest Kettle Jack — giver: Warden Hale | reward: 40 crowns | difficulty: nightmare');
    assert.deepEqual(withoutRaw(only(formatOp(op))), withoutRaw(op));

    assert.equal(only('+ Rat cellar — difficulty: trivial').kind, 'hook', 'the field alone is no quest (0.9.3)');
    assert.equal(only('+ Rat cellar — difficulty: trivial | giver: the innkeeper').kind, 'quest', 'a giver makes it one');
    assert.equal(only('+ Rat cellar — type: bounty').kind, 'quest', 'so does a quest type');
    assert.equal(only('~ Kettle Jack — difficulty: medium').fields.difficulty, 'normal');
    assert.equal(only('~ Kettle Jack — difficulty: whatever the gods decide').fields.difficulty, 'normal', 'unknown reads normal');
    assert.equal(only('~ Kettle Jack — difficulty:').fields.difficulty, '', 'an empty one clears it');
    assert.equal(only('~ Kettle Jack — difficulty:hard').fields.difficulty, 'hard', 'a known field may skip the space');
});

test('a placeholder copied from the format is no text', () => {
    const { ops, errors } = parseChanges([
        '- Sheep-killer — part',
        '! Bell — what happened',
        '+ hook Post-Rent — summary | now: the rent is due',
        '- Toll — Reason',
        '- Gate — partly flooded',
    ].join('\n'));
    assert.deepEqual(errors, []);
    assert.deepEqual(ops.map(op => op.reason), ['', '', '', '', 'partly flooded']);
    assert.equal(ops[2].fields.desc, undefined);
    assert.equal(ops[2].fields.now, 'the rent is due');
});

test('the format copied word for word still reads as the record it means', () => {
    const { ops, errors } = parseChanges([
        '+ kind hook — Guild post crisis | label: The frontier desk is insolvent',
        '+ kind: quest Wolf bounty — goal: kill the sheep-killer',
        '+ kind Hook Watch — the Watch is hiring',
        '~ Road to Auvoth — label: notice at the Stray Oar',
    ].join('\n'));
    assert.deepEqual(errors, []);
    assert.deepEqual(ops.map(op => [op.kind, op.key]), [['hook', 'Guild post crisis'], ['quest', 'Wolf bounty'], ['hook', 'Watch'], [null, 'Road to Auvoth']]);
    assert.equal(ops[0].fields.desc, 'The frontier desk is insolvent');
    assert.deepEqual(ops[0].extra, {});
    assert.equal(ops[1].fields.goal, 'kill the sheep-killer');
    assert.equal(ops[2].fields.desc, 'the Watch is hiring');
    assert.equal(ops[3].fields.desc, 'notice at the Stray Oar');
    // A record really keyed "Kind" is still read as before.
    assert.equal(parseChanges('+ hook Kind — a gentle stranger').ops[0].key, 'Kind');
});

test('fields run together with commas or semicolons are split as if written with "|" (0.9.8)', () => {
    const op = only('+ quest Sheepfold Wolves — Cull up to 4 timber wolves | type: contract, giver: Nelke/Herders, goal: return right wolf ears, reward: 2 silver per head, due: Goldwane 12');
    assert.equal(op.kind, 'quest');
    assert.deepEqual(op.fields, { desc: 'Cull up to 4 timber wolves', type: 'contract', giver: 'Nelke/Herders', goal: 'return right wolf ears', reward: '2 silver per head', due: 'Goldwane 12' });
    assert.deepEqual(only('~ Geva — now: Bailiff Court; then: files the warrant; on: Goldwane 17').fields, { now: 'Bailiff Court', then: 'files the warrant', on: 'Goldwane 17' });
    // A comma inside a value stays when no field follows it.
    assert.equal(only('+ quest Ledger — giver: Nelke, the clerk | reward: 4 silver, paid on return').fields.giver, 'Nelke, the clerk');
    assert.equal(only('+ quest Ledger — giver: Nelke, the clerk | reward: 4 silver, paid on return').fields.reward, '4 silver, paid on return');
    assert.equal(only('+ hook Old Tom — the herder, on the moor road').fields.desc, 'the herder, on the moor road', '"on" without a colon is a word');
});
