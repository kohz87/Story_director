// Tests for src/mirror.js: writing active agendas into a World_State block's Off-Screen
// section without touching anything else.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mirrorOffscreen } from '../src/mirror.js';
import { seedFromWorldState } from '../src/seed.js';

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

const OFFSCREEN_START = WORLD_STATE.indexOf('**📡 Off-Screen:**');
const WORLD_START = WORLD_STATE.indexOf('**🌍 World:**');

function agenda(key, fields = {}, extra = {}) {
    const blank = { desc: '', now: '', then: '', on: '', due: '', shown: '', leg: '', arrive: '', place: '', people: '' };
    return { key, id: key.toLowerCase(), kind: 'agenda', status: 'active', fields: { ...blank, ...fields }, ...extra };
}

const AGENDAS = [
    agenda('Senior Listener Geva', { now: 'District Bailiff Court', then: 'files the warrant', on: 'Haywane 13, 09:00 am' }),
    agenda('Courier', {
        now: 'rides south from Shorn', then: 'delivers the writ',
        leg: 'Shorn → Varnhold Watch 35 B, courier 70/day → 0.5', arrive: 'Haywane 13, morning',
    }),
    agenda('Master Giertnow', { desc: 'Bluewatch market', then: 'sells the mules' }),
    agenda('Thys'),
    agenda('Brant', { now: 'Auvoth' }, { status: 'resolved' }),
    { ...agenda('Canal Street Granary Fires', { now: 'curfew' }), kind: 'event' },
];

const EXPECTED_SECTION = [
    '**📡 Off-Screen:**',
    // (0.9.31) Short lines: what they do, when they arrive, what next (and when); no leg.
    '* Senior Listener Geva — District Bailiff Court; next: files the warrant (Haywane 13, 09:00 am)',
    '* Courier — rides south from Shorn; arrives Haywane 13, morning; next: delivers the writ',
    '* Master Giertnow — Bluewatch market; next: sells the mules',
    '* Thys',
].join('\n');

test('replaces an existing Off-Screen section, leaving the rest byte for byte', () => {
    const result = mirrorOffscreen(WORLD_STATE, AGENDAS);
    const prefix = WORLD_STATE.slice(0, OFFSCREEN_START);
    const suffix = WORLD_STATE.slice(WORLD_START - 1); // the newline before World onward
    assert.equal(result, prefix + EXPECTED_SECTION + suffix);
    assert.ok(result.startsWith(prefix));
    assert.ok(result.endsWith(suffix));
});

test('writes * None when no agenda is active and the story listed nobody else', () => {
    // Brant's agenda is closed and Geva's and Giertnow's are tracked: none of their lines stay.
    const tracked = [AGENDAS[4], { ...AGENDAS[0], status: 'resolved' }, { ...AGENDAS[2], status: 'resolved' }, AGENDAS[5]];
    const result = mirrorOffscreen(WORLD_STATE, tracked);
    assert.equal(
        result,
        `${WORLD_STATE.slice(0, OFFSCREEN_START)}**📡 Off-Screen:**\n* None${WORLD_STATE.slice(WORLD_START - 1)}`,
    );
    assert.equal(mirrorOffscreen('Loc: Auvoth\n**📡 Off-Screen:**\n* None', null), 'Loc: Auvoth\n**📡 Off-Screen:**\n* None');
});

test('the story\'s own lines for people with no agenda stay, after the agendas; a closed agenda\'s line goes (0.9.26)', () => {
    // Only Brant (closed) is known: Geva's and Giertnow's lines are the story's and stay.
    const result = mirrorOffscreen(WORLD_STATE, [AGENDAS[4]]);
    assert.equal(result, `${WORLD_STATE.slice(0, OFFSCREEN_START)}**📡 Off-Screen:**
* **Senior Listener Geva — now:** District Bailiff Court | then: argues with magistrates | on: Haywane 12, 05:45 pm
* Master Giertnow: Bluewatch market | then: sells the mules | on: Haywane 14${WORLD_STATE.slice(WORLD_START - 1)}`);
    const alley = 'Loc: Guild\n**📡 Off-Screen:**\n* Jor — crying in the granary alley\n* Bond collector — on a barge\n* None';
    assert.equal(mirrorOffscreen(alley, [agenda('Bond collector', { now: 'leaving Glassdock' })]),
        'Loc: Guild\n**📡 Off-Screen:**\n* Bond collector — leaving Glassdock\n* Jor — crying in the granary alley');
    // A name the agenda was also called by is the agenda's too.
    assert.equal(mirrorOffscreen('**📡 Off-Screen:**\n* The collector — on a barge', [agenda('Bond collector', {}, { aliases: ['the collector'] })]),
        '**📡 Off-Screen:**\n* Bond collector');
});

test('inserts the section before the World heading when there is none', () => {
    const without = WORLD_STATE.slice(0, OFFSCREEN_START) + WORLD_STATE.slice(WORLD_START);
    const result = mirrorOffscreen(without, AGENDAS);
    assert.equal(result, `${WORLD_STATE.slice(0, OFFSCREEN_START)}${EXPECTED_SECTION}\n${WORLD_STATE.slice(WORLD_START)}`);
});

test('inserts before the first later heading, or appends', () => {
    const phases = 'Time: Haywane 12\n---\n**🎬 Scene Phase:** Breather\n**🔥 Hooks:**\n* None';
    assert.equal(
        mirrorOffscreen(phases, [AGENDAS[3]]),
        'Time: Haywane 12\n---\n**📡 Off-Screen:**\n* Thys\n**🎬 Scene Phase:** Breather\n**🔥 Hooks:**\n* None',
    );
    assert.equal(mirrorOffscreen('Time: Haywane 12', [AGENDAS[3]]), 'Time: Haywane 12\n**📡 Off-Screen:**\n* Thys');
    assert.equal(mirrorOffscreen('Time: Haywane 12\n', [AGENDAS[3]]), 'Time: Haywane 12\n**📡 Off-Screen:**\n* Thys\n');
    assert.equal(mirrorOffscreen('', []), '**📡 Off-Screen:**\n* None');
});

test('the section ends at a rule or the end, keeps blank lines and CRLF, and takes a heading', () => {
    const block = [
        'Loc: Auvoth',
        'Off-Screen: Brant — now: the road',
        '* Thys — now: the gate',
        '',
        '* Kade — now: the docks',
        '',
        '---',
        'Arc Phase: Escalation',
        '',
    ].join('\r\n');
    const result = mirrorOffscreen(block, [AGENDAS[3]], { heading: '**Off-Screen:**' });
    assert.equal(result, 'Loc: Auvoth\r\n**Off-Screen:**\r\n* Thys\r\n* Kade — now: the docks\r\n\r\n---\r\nArc Phase: Escalation\r\n');

    const atEnd = 'Loc: Auvoth\n**📡 Off-Screen:**\n* Old line';
    assert.equal(mirrorOffscreen(atEnd, []), 'Loc: Auvoth\n**📡 Off-Screen:**\n* None');
});

test('mirrored lines read back through the seeder with their parts (0.9.31: the leg stays in the tracker)', () => {
    const { ops, counts } = seedFromWorldState(mirrorOffscreen(WORLD_STATE, AGENDAS));
    assert.equal(counts.agenda, 4);
    assert.deepEqual(ops[0].fields, { now: 'District Bailiff Court', then: 'files the warrant', on: 'Haywane 13, 09:00 am' });
    assert.deepEqual(ops[1].fields, { now: 'rides south from Shorn', then: 'delivers the writ', arrive: 'Haywane 13, morning' });
    assert.deepEqual(ops[2].fields, { now: 'Bluewatch market', then: 'sells the mules' });
});

test('a mirrored line is short: no leg, no labels; a date on the next step or alone (0.9.31)', () => {
    const lines = mirrorOffscreen('', [
        agenda('Bond collector', { now: 'on a supply barge up the Bluewatch Branch', then: 'questions the quay inspector', on: 'Goldwane 30, 06:40 am', leg: 'Glassdock → Bluewatch Village 440 km W, upstream 25/day → 18 days', arrive: 'Goldwane 30, 06:40 am' }),
        agenda('Marrit', { now: 'at the customs shed', on: 'Goldwane 12, 01:00 pm' }),
    ]).split('\n');
    assert.deepEqual(lines.slice(1), [
        '* Bond collector — on a supply barge up the Bluewatch Branch; arrives Goldwane 30, 06:40 am; next, on arrival: questions the quay inspector',
        '* Marrit — at the customs shed; on Goldwane 12, 01:00 pm',
    ]);
    assert.ok(!lines.join('\n').includes('km'), 'the leg stays in the tracker');
    // Read back, the date alone is the agenda's `on`, and an arrival with a next step is both.
    const { ops } = seedFromWorldState(lines.join('\n'));
    assert.deepEqual(ops[0].fields, { now: 'on a supply barge up the Bluewatch Branch', then: 'questions the quay inspector', on: 'Goldwane 30, 06:40 am', arrive: 'Goldwane 30, 06:40 am' });
    assert.deepEqual(ops[1].fields, { now: 'at the customs shed', on: 'Goldwane 12, 01:00 pm' });
});
