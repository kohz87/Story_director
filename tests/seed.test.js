// Tests for src/seed.js: seeding records from a real World_State block, and the heading
// forms and section names it accepts.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readHeading, seedFromWorldState } from '../src/seed.js';

const WORLD_STATE = `**📅 Time:** CY 611, Haywane 12, 05:35 pm | **🌤 Loc:** Auvoth | Seventh Seal Terrace | [59.0, 110.0] | **🌡 Wx:** Freezing rain
---
**🧍 Ren:**
* *Outfit:* Soaked drake armor
* *Travel:* None - stationary
---
**👥 NPCs Present:**
**Chiyo:**
* *Mood:* Exhausted
---
**📡 Off-Screen:**
* **Senior Listener Geva — now:** District Bailiff Court | then: argues with magistrates | on: Haywane 12, 05:45 pm
* Master Giertnow: Bluewatch market | then: sells the mules | on: Haywane 14
* Brant — now: on the frontier road with a dray | then: reaches Auvoth | leg: Bluewatch Village → Auvoth 70 F, wagon 14/day → 5 | arrive: Haywane 17, evening
**🌍 World:**
* Canal Street Granary Fires — Lower city ablaze | then: citywide night curfew declared | on: Haywane 12, 06:00 pm
**🔥 Hooks:**
* River stranger — who pulled Ren from the sump; finding him settles the debt | then: he sends word | on: Haywane 15
**⏳ Clocks:**
* Hollin's Reach graves — washed graves left uncompleted → the first of the dead rise | due: Goldwane 28 | shown: none
**🎯 Arc Phase:** Escalation
**🎬 Scene Phase:** Breather`;

test('seeds the real block: 3 agendas, 1 event, 1 hook, 1 clock', () => {
    const { ops, counts } = seedFromWorldState(WORLD_STATE);
    assert.deepEqual(counts, { agenda: 3, event: 1, hook: 1, clock: 1 });
    assert.deepEqual(ops.map(op => [op.op, op.kind, op.key]), [
        ['+', 'agenda', 'Senior Listener Geva'],
        ['+', 'agenda', 'Master Giertnow'],
        ['+', 'agenda', 'Brant'],
        ['+', 'event', 'Canal Street Granary Fires'],
        ['+', 'hook', 'River stranger'],
        ['+', 'clock', 'Hollin\'s Reach graves'],
    ]);

    const [geva, giertnow, brant, fires, stranger, graves] = ops;
    assert.deepEqual(geva.fields, {
        now: 'District Bailiff Court', then: 'argues with magistrates', on: 'Haywane 12, 05:45 pm',
    });
    assert.deepEqual(giertnow.fields, { desc: 'Bluewatch market', then: 'sells the mules', on: 'Haywane 14' });
    assert.deepEqual(brant.fields, {
        now: 'on the frontier road with a dray',
        then: 'reaches Auvoth',
        leg: 'Bluewatch Village → Auvoth 70 F, wagon 14/day → 5',
        arrive: 'Haywane 17, evening',
    });
    assert.deepEqual(fires.fields, {
        desc: 'Lower city ablaze', then: 'citywide night curfew declared', on: 'Haywane 12, 06:00 pm',
    });
    assert.equal(stranger.fields.desc, 'who pulled Ren from the sump; finding him settles the debt');
    assert.deepEqual(graves.fields, {
        desc: 'washed graves left uncompleted → the first of the dead rise', due: 'Goldwane 28', shown: 'none',
    });
});

test('the PC card, NPCs Present and the phases never become records', () => {
    const keys = seedFromWorldState(WORLD_STATE).ops.map(op => op.key.toLowerCase());
    for (const stray of ['chiyo', 'mood', 'travel', 'outfit', 'ren', 'escalation', 'breather']) {
        assert.ok(!keys.some(key => key.includes(stray)), stray);
    }
});

test('reads plain and inline headings, other section names and None items', () => {
    const block = [
        'Elsewhere: Kade — now: the docks',
        '* None',
        '* Thys: watches the gate',
        '**Unresolved Threads**:',
        '* *None*',
        '- Who sold the weir route',
        '⏳ Consequence Timers:',
        '• Bells — ring at dusk | due: Haywane 13, dusk',
        '---',
        '* After a rule — not in any section',
        '**🌍 World events:** None',
        '**Planted Seeds:** A sealed letter',
        '**Timers:**',
        'Arc Phase: Rising',
        '* Not a clock — due: Haywane 20',
    ].join('\r\n');
    const { ops, counts } = seedFromWorldState(block);
    assert.deepEqual(counts, { agenda: 2, event: 0, hook: 2, clock: 1 });
    assert.deepEqual(ops.map(op => [op.kind, op.key]), [
        ['agenda', 'Kade'],
        ['agenda', 'Thys'],
        ['hook', 'Who sold the weir route'],
        ['clock', 'Bells'],
        ['hook', 'A sealed letter'],
    ]);
    assert.equal(ops[0].fields.now, 'the docks');
    assert.equal(ops[3].fields.due, 'Haywane 13, dusk');
});

test('an empty or list-less block seeds nothing', () => {
    const none = { ops: [], counts: { agenda: 0, event: 0, hook: 0, clock: 0 } };
    assert.deepEqual(seedFromWorldState(''), none);
    assert.deepEqual(seedFromWorldState(null), none);
    assert.deepEqual(seedFromWorldState('**📅 Time:** CY 611, Haywane 12\n* stray bullet'), none);
});

test('readHeading tells headings from items', () => {
    assert.deepEqual(readHeading('**📡 Off-Screen:**'), { name: 'offscreen', kind: 'agenda', inline: '' });
    assert.deepEqual(readHeading('**🎯 Arc Phase:** Escalation'), { name: 'arcphase', kind: null, inline: 'Escalation' });
    assert.deepEqual(readHeading('Clocks: none\r'), { name: 'clocks', kind: 'clock', inline: 'none' });
    assert.equal(readHeading('**Chiyo:**').name, 'chiyo');
    assert.equal(readHeading('* **Senior Listener Geva — now:** Court'), null);
    assert.equal(readHeading('**Senior Listener Geva — now:** Court'), null);
    assert.equal(readHeading('---'), null);
    assert.equal(readHeading('Geva walked in at 05:35.'), null);
    assert.equal(readHeading(''), null);
});
