// NPC initiative and the scene-filtered note on a whole Story Block host: the pick is made once before
// a reply (a system step with its own seed) and a swipe, a Re-read or a reload gives the same one; the
// static part is the same bytes every reply, with the initiative line only while its feature is on;
// it works with NPC State Delta (a stand-in answering its queries) and without it.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHost } from '../../vendor/story-block/testkit/index.js';
import { createModule } from '../../../src/v2/module.js';
import { FEATURE, INITIATIVE_STATIC } from '../../../src/v2/tracker/initiative.js';

const STATIC_KEY = 'story_suite_static';
const TAIL_KEY = 'story_suite_tail_1';
const sent = (host, key) => host.st.promptLog.filter(entry => entry.key === key && entry.value).map(entry => entry.value);
const reply = (text, lines = []) => (lines.length ? `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>` : text);
const picks = host => host.sdk.receipts().filter(entry => entry.receipt.type === 'director.initiative');
const initiativeIn = text => String(text ?? '').split('\n').find(line => line.startsWith('Initiative:')) ?? '';

// NPC State Delta's queries only (a stand-in): who it knows, their dossiers and trust.
function fakeNsd() {
    const dossiers = { Elula: { name: 'Elula', aliases: ['the ferrywoman', 'ferrywoman'], location: 'Harrow' }, Bram: { name: 'Bram', aliases: [], location: 'Kesh' } };
    const find = name => dossiers[Object.keys(dossiers).find(key => key.toLowerCase() === String(name ?? '').toLowerCase()) ?? ''] ?? Object.values(dossiers).find(entry => entry.aliases.includes(String(name ?? '').toLowerCase())) ?? null;
    return {
        id: 'npc-state-delta',
        name: 'NPC State Delta (test stand-in)',
        version: '0.0.0-test',
        queries: {
            'npc.known': () => Object.keys(dossiers),
            'npc.present': () => [],
            'npc.dossier': (_state, args) => find(args?.name),
            'npc.meters': (_state, args) => (find(args?.name) ? { name: find(args.name).name, meters: { trust: 40 } } : null),
        },
    };
}

async function newHost(modules = [], settings = undefined) {
    let host = null;
    const module = createModule({ host: { settings: id => host?.sdk.settings(id) ?? null, substitute: text => host?.sdk.substitute(text) } });
    host = await createHost({ modules: [...modules, module], ...(settings ? { settings } : {}) });
    return host;
}

const OPENING = ['~ time June 3, 1200, 08:00 am', '~ place Harrow | kind: settlement', '+ present Elula',
    '+ hook Wolf Contract — wolves at the fold | giver: Elula | goal: Kill 3 wolves | reward: 4 gold',
    '+ hook Herb Run — moonleaf for the healer | giver: Mother Ysolde',
    '+ agenda Bram — moves salt | now: Kesh'];

for (const withNsd of [false, true]) {
    test(`initiative ${withNsd ? 'with' : 'without'} NPC State Delta: one pick per reply, the same after a swipe and a Re-read`, async t => {
        t.mock.method(console, 'warn', () => {});
        const host = await newHost(withNsd ? [fakeNsd()] : []);
        try {
            // With NSD the scene may name her by an alias: her dossier gives the name she goes by.
            const opening = withNsd ? OPENING.map(entry => (entry === '+ present Elula' ? '+ present the ferrywoman' : entry)) : OPENING;
            await host.send('Hello.', reply('Harrow at dawn.', opening));
            await host.send('I look around.', reply('Elula waves.'));
            const line = initiativeIn(sent(host, TAIL_KEY).at(-1));
            assert.equal(line, 'Initiative: Elula may approach You about Wolf Contract.', '{{user}} filled in');
            const tail = sent(host, TAIL_KEY).at(-1);
            // The scene first: the quest of the person present; the hook elsewhere by name; the agenda at Kesh not at all.
            assert.match(tail, /Hooks: Wolf Contract/);
            assert.match(tail, /Elsewhere, not in this scene: Herb Run \(hook\)/);
            assert.doesNotMatch(tail, /Bram/);
            const count = picks(host).length;
            assert.equal(count, 1);
            // A swipe of the same reply: no new pick, the same line.
            await host.swipe(reply('Elula waves again.'));
            assert.equal(initiativeIn(sent(host, TAIL_KEY).at(-1)), line);
            assert.equal(picks(host).length, count);
            const slot = structuredClone(host.head().domains.director.initiative);
            // A Re-read of the reply keeps the pick.
            assert.equal((await host.sdk.reread(host.ctx.chat.length - 1)).ok, true);
            assert.deepEqual(host.head().domains.director.initiative, slot);
            // The next reply: Elula cools down (never two replies running), nobody else is there.
            await host.send('And then?', reply('Quiet.'));
            assert.equal(initiativeIn(sent(host, TAIL_KEY).at(-1)), '');
            await host.send('Later.', reply('Still quiet.'));
            assert.equal(initiativeIn(sent(host, TAIL_KEY).at(-1)), line, 'after the cooldown she may again');
            // A rebuild gives the same state (the pick is in the receipts' ops).
            const live = JSON.stringify(host.head());
            host.store.rebuild();
            assert.equal(JSON.stringify(host.head()), live);
        } finally {
            host.close();
        }
    });
}

test('the static part: byte-identical reply to reply, with the initiative line only while the feature is on', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await newHost();
    try {
        await host.send('Hello.', reply('Harrow at dawn.', OPENING));
        await host.send('I look around.', reply('Elula waves.', ['+ hook Night Bell — a bell at night | now: Harrow']));
        await host.send('On.', reply('The day goes on.', ['! time +3h', '- hook Night Bell — it stopped']));
        const statics = sent(host, STATIC_KEY);
        assert.ok(statics.length >= 3);
        assert.equal(new Set(statics).size, 1, 'the same bytes every reply');
        const on = statics[0];
        const lines = on.split('\n');
        const own = lines.filter(line => line.startsWith(INITIATIVE_STATIC.split('{{user}}')[0]));
        assert.equal(own.length, 1, 'the initiative line is there once while on');
        // Off: the line goes (once, for the next reply), the tail has no Initiative line and no pick is made.
        host.features.set(FEATURE, false);
        const before = picks(host).length;
        await host.send('Again.', reply('Elula nods.'));
        await host.send('More.', reply('Elula smiles.'));
        const off = sent(host, STATIC_KEY).slice(-2);
        assert.equal(off[0], off[1]);
        assert.equal(off[0], lines.filter(line => line !== own[0]).join('\n'), 'the same bytes but for the line');
        assert.equal(initiativeIn(sent(host, TAIL_KEY).at(-1)), '');
        assert.equal(picks(host).length, before);
    } finally {
        host.close();
    }
});

// ---- World pulse on the real host: its roll rides the reply's own receipt, so a re-roll replaces it ----

test('pulse: a regenerate, a swipe or a delete of the reply takes its roll and effects back (no stacking); a rebuild is the same', async () => {
    const host = await newHost();
    try {
        await host.send('Begin.', reply('Harrow wakes.', [...OPENING, '+ present Bram', '+ present Orsa',
            '+ agenda Courier — rides in | now: far north | then: reaches the gate | on: June 3, 1200, 06:00 pm | arrive: June 3, 1200, 05:00 pm',
            '+ world Wolf Plague — wolves in the fold | state: ongoing', '+ world Grain Tax — the levy rises | state: ongoing']));
        const original = () => host.head().domains.director.threads;
        const dateOf = (threads, field) => Object.values(threads).map(thread => thread.fields?.[field]).join('|');
        const base = { on: dateOf(original(), 'on'), arrive: dateOf(original(), 'arrive') };
        const effects = () => {
            const threads = original();
            const rumours = Object.values(host.head().domains.chronicle.events).filter(event => event.rumour !== undefined).length;
            return { rumours, arrived: dateOf(threads, 'arrive') === base.arrive ? 0 : 1, shifted: dateOf(threads, 'on') === base.on ? 0 : 1 };
        };
        const last = () => host.head().domains.director.pulse[0].results.at(-1);
        const pulses = () => host.sdk.receipts().filter(entry => entry.receipt.type === 'director.pulse');
        await host.send('Go on.', reply('Reply.'));
        const seen = new Set();
        const check = label => {
            const sum = Object.values(effects()).reduce((a, b) => a + b, 0);
            assert.equal(pulses().length, 2, `${label}: one roll per reply (the opening reply is skipped, the second rolled), never stacked`);
            assert.ok(sum <= 1 && sum === (['chronicle.rumor', 'director.pulse.arrive', 'director.pulse.shift'].includes(last().effect?.type) ? 1 : 0), `${label}: ${JSON.stringify(effects())} of ${last().kind}`);
            if (last().effect) seen.add(last().effect.type);
        };
        for (let n = 0; n < 12; n += 1) { await host.regenerate('Again.'); check(`regenerate ${n}`); }
        for (let n = 0; n < 12; n += 1) { await host.swipe('Another.'); check(`swipe ${n}`); }
        assert.ok(seen.size >= 1, 'a roll with an effect happened');
        assert.ok(host.st.promptLog.some(entry => String(entry.value ?? '').includes('World this reply: ')), 'the line reached a prompt');
        const before = JSON.stringify(host.head().domains);
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head().domains), before, 'a rebuild gives the same world');
        // Delete the reply alone: its roll and effects go with it.
        await host.st.deleteMessage(host.st.ctx.chat.length - 1);
        assert.deepEqual(effects(), { rumours: 0, arrived: 0, shifted: 0 });
        assert.equal(pulses().length, 1);
    } finally {
        host.close();
    }
});

test('pulse: a chance meeting reaches the narrator with the cast cue, names the person, and survives the reply that shows them', async () => {
    const { castHost, castSource, entry, said, sent: sentTo, withRoads } = await import('../cast/helpers.js');
    // Gwenmar is two hours from Harrow by the pack's road: by 10:30 (2.5 hours after the cast's first minute) she can be here.
    const host = await castHost({ source: withRoads(castSource([entry('sera', { start: { place: 'Gwenmar', goal: 'find her brother', routine: '' } })])), features: { 'story-director.pulse': true } });
    try {
        await host.send('Hello.', said('Start.', ['~ time June 3, 1200, 08:00 am', '~ place Harrow | kind: settlement', '+ present Elula', '+ present Bram', '+ present Orsa', '+ agenda Courier — rides in | now: far north | on: June 3, 1200, 06:00 pm', '+ world Plague — coughing in the fold | state: ongoing']));
        await host.send('Wait.', said('Time passes.', ['~ time June 3, 1200, 10:30 am']));
        // This reply rolls too: if its own roll meets her (about one in ten), it must show her as well, or the cast withdraws the meeting
        // (an unshown person is unmet again) and the check below sees no meeting.
        await host.send('Go.', said('Sera steps out of the crowd.', ['~ time June 3, 1200, 10:30 am']));
        const last = () => host.head().domains.director.pulse[0].results.at(-1);
        // Every swipe's reply shows Sera (the reply is written before the roll is known), so a roll that meets her must keep the meeting.
        let tries = 0;
        while (last().kind !== 'CHANCE_MEETING' && tries < 80) { await host.swipe(said('Sera steps out of the crowd.', ['~ time June 3, 1200, 10:30 am'])); tries += 1; }
        assert.equal(last().kind, 'CHANCE_MEETING', 'a swipe rolled the chance meeting');
        const tail = sentTo(host, TAIL_KEY).at(-1) ?? '';
        assert.match(tail, /World this reply: Sera crosses your path in Harrow/, 'the pulse line names the person');
        assert.match(tail, /\[Cast\] Sera comes into the scene in this reply/, 'the narrator got the cast cue for the person met');
        assert.ok(!('cue' in last()), 'the cue is told, not stored in the roll');
        // If this ever fails again (TODO: flaky 11 Nov, `met` missing): the message carries what the cast and the pulse held, so the cause can be read off it.
        const evidence = () => JSON.stringify({ person: host.head().domains.cast.people['ersveil:sera'], meeting: host.head().domains.cast.meeting, roll: last(), tries, receipts: host.sdk.receipts().slice(-8).map(item => [item.index, item.receipt.type, item.receipt.summary]) });
        assert.equal(host.head().domains.cast.people['ersveil:sera']?.met?.why, 'goal', `the meeting survives the reply that shows her: ${evidence()}`);
        assert.ok(!host.sdk.receipts().some(item => item.receipt.type === 'cast.withdraw'), 'nothing was taken back');
    } finally {
        host.close();
    }
});

test('pulse: nobody who is too far away is chanced upon (no road known, or the time since they were placed is short): the roll steps down and nobody is moved', async () => {
    const { castHost, castSource, entry, said, withRoads } = await import('../cast/helpers.js');
    for (const [label, source, time] of [['no road', castSource([entry('rika', { start: { place: 'Auvoth / Pale Market', goal: 'a licence', routine: '' } })]), '10:30 am'], ['road, too little time', withRoads(castSource([entry('rika', { start: { place: 'Gwenmar', goal: 'a licence', routine: '' } })])), '08:30 am']]) {
        const host = await castHost({ source, features: { 'story-director.pulse': true } });
        try {
            await host.send('Hello.', said('Start.', ['~ time June 3, 1200, 08:00 am', '~ place Harrow | kind: settlement']));
            await host.send('Go.', said('Nothing happens.', [`~ time June 3, 1200, ${time}`]));
            for (let tries = 0; tries < 60; tries += 1) await host.swipe(said('Nothing happens.', [`~ time June 3, 1200, ${time}`]));
            const kinds = new Set(host.head().domains.director.pulse[0].results.map(result => result.kind));
            assert.ok(!kinds.has('CHANCE_MEETING'), `${label}: no chance meeting`);
            const rika = host.head().domains.cast.people['ersveil:rika'];
            assert.deepEqual([rika.met, rika.where], [null, source.entries[0].start.place], `${label}: unmet and where she was`);
        } finally {
            host.close();
        }
    }
});

test('pulse, rule 2: run5cast reply 14, Rika (Auvoth / Pale Market, 3.5 days by the frontier road) is never chanced upon in Drowned Bell taproom 1730 minutes in, though the map\'s straight line makes it half a day', async () => {
    const { castHost, castSource, entry, said } = await import('../cast/helpers.js');
    // Ersveil 2.9.6's places and road as the pack writes them; the taproom is the story's, placed on the map by the atlas with no road.
    const source = castSource([entry('rika', { start: { place: 'Auvoth / Pale Market', goal: 'A Guild licence and a crew.', routine: '' } })]);
    source.places = [
        { name: 'Bluewatch Village', region: 'River Confederacy: Bluewatch', kind: 'village', x: 64, y: 110 },
        { name: 'Bluewatch Village / Guild Office', region: 'River Confederacy: Bluewatch', kind: 'guild office', x: 64, y: 110 },
        { name: 'Auvoth', region: 'Auvoth Compact', kind: 'city', x: 59, y: 110 },
        { name: 'Auvoth / Pale Market', region: 'Auvoth Compact', kind: 'district', x: 59.4, y: 109.6 },
    ];
    source.routes = [{ from: 'Auvoth', to: 'Bluewatch Village', kind: 'frontier road', km: 70 }];
    const host = await castHost({ source, features: { 'story-director.pulse': true } });
    try {
        // The cast joins at the first minute (the clock is set first); the party goes into the taproom with three named people (the Standard
        // table, as in the run) and 1730 minutes pass; the next reply sits at that clock (no jump to skip on), and the one after rolls as reply 14 did.
        await host.send('Hello.', said('Start.', ['~ time June 3, 1200, 08:00 am', '~ place Bluewatch Village | kind: settlement | region: bluewatch', '+ agenda Courier — rides in | now: far north | on: June 9, 1200, 06:00 pm']));
        await host.send('Look.', said('The village.', ['~ time June 3, 1200, 08:00 am']));
        await host.send('A drink.', said('The taproom.', ['~ place Drowned Bell taproom | kind: settlement | region: bluewatch', '+ present Hal', '+ present Temiwa', '+ present Karn', '~ time June 4, 1200, 12:50 pm']));
        await host.send('Sit.', said('Nothing happens.', ['~ time June 4, 1200, 12:50 pm']));
        await host.send('Wait.', said('Nothing happens.', ['~ time June 4, 1200, 12:50 pm']));
        const trip = host.sdk.query('atlas.travel', { from: 'Auvoth / Pale Market', to: 'Drowned Bell taproom' });
        assert.equal(trip?.source, 'map', `the trap is there: no road to the taproom, only the straight line (${JSON.stringify(trip)})`);
        assert.ok(trip.days * 1440 <= 1730, `the straight line fits the time (${trip.days} days)`);
        // Under rule 1 these 60 swipes roll her chance meeting 16 times (checked when this test was written); under rule 2 never.
        const rolled = [];
        for (let tries = 0; tries < 60; tries += 1) {
            await host.swipe(said('Nothing happens.', ['~ time June 4, 1200, 12:50 pm']));
            const last = host.head().domains.director.pulse[0].results.at(-1);
            rolled.push(last.kind);
            assert.equal(last.table, 'std', 'the Standard table, which has the chance meeting');
        }
        assert.ok(!rolled.includes('CHANCE_MEETING'), `no chance meeting (${[...new Set(rolled)].join(', ')})`);
        const rika = host.head().domains.cast.people['ersveil:rika'];
        assert.deepEqual([rika.met, rika.where], [null, 'Auvoth / Pale Market'], 'unmet and where she was');
        assert.ok(host.sdk.receipts().filter(item => item.receipt.type === 'director.pulse').every(item => item.receipt.replan?.payload?.reach === 3), 'every new step carries rule 2 with the town rules');
    } finally {
        host.close();
    }
});

// ---- Kept lines: the Initiative line and the world pulse line survive a tight, crowded tail (tailBudget 550) ----

const CROWD = Array.from({ length: 14 }, (_, n) => `+ hook Crowd ${n} — a long errand number ${n} in the busy lanes of Harrow | giver: Elula | goal: Do thing ${n} for the people of the town | reward: ${n + 4} gold`);

test('kept lines: under tailBudget 550 with a crowded tail the Initiative line and the world pulse line still reach the prompt', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await newHost([], { host: { tailBudget: 550 }, features: { 'story-director.pulse': true } });
    try {
        await host.send('Hello.', reply('Harrow at dawn.', [...OPENING, ...CROWD]));
        await host.send('I look around.', reply('Elula waves.', ['~ time June 3, 1200, 08:10 am']));
        const crowded = sent(host, TAIL_KEY).at(-1);
        assert.ok(crowded.split('\n').length >= 3, 'the tail is not empty');
        assert.equal(initiativeIn(crowded), 'Initiative: Elula may approach You about Wolf Contract.', 'the Initiative line is kept');
        // A swipe rolls the world pulse again; once a roll with a line comes, it is told as well under the same budget.
        const last = () => host.head().domains.director.pulse?.[0]?.results?.at(-1);
        let tries = 0;
        while (!sent(host, TAIL_KEY).at(-1).includes('World this reply: ') && tries < 60) { await host.swipe(reply('Elula waves again.', ['~ time June 3, 1200, 08:10 am'])); tries += 1; }
        const tail = sent(host, TAIL_KEY).at(-1);
        assert.match(tail, /World this reply: /, `a pulse line (kind ${last()?.kind}) is told under the tight budget`);
        assert.equal(initiativeIn(tail), 'Initiative: Elula may approach You about Wolf Contract.', 'the Initiative line is still there');
        // The pulse receipt marks its cue kept; the receipt is the only thing stored (the prompt is not).
        assert.ok(host.sdk.receipts().filter(entry => entry.receipt.type === 'director.pulse').every(entry => entry.receipt.data?.keep === undefined || entry.receipt.data.keep === true));
    } finally {
        host.close();
    }
});
