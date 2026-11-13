// The Assist safety net and the story clock, the live path (final live check FL-3): the reply comes without
// a <Changes> block, the safety net's model call answers in plain lines (`! time +20m`, no <Changes> tags,
// as a small model does), and Story Director's `time` kind moves the clock. The reader sees it on the
// reply's card as "! time +20m (assist)" (the card's `assisted` list is the reply's receipts marked
// `assist`, Story Block's ui-host; its folded header counts them). Story Block and Story Director only (no
// example fight runner, no NSD).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHost } from '../../vendor/story-block/testkit/index.js';
import { CORE_FEATURE } from '../../vendor/story-block/src/v2/features.js';
import { assistSections } from '../../vendor/story-block/src/v2/capture.js';
import { createModule } from '../../../src/v2/module.js';
import { THREADS_FEATURE } from '../../../src/v2/threads.js';

const reply = (text, lines = []) => (lines.length ? `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>` : text);
const assisted = host => host.sdk.receipts().map(entry => entry.receipt).filter(receipt => receipt.assist === 'now' || receipt.assist === 'late');

// The clock is set by the first reply; the safety net is on from the second (`net`).
async function started(answer, { net = true } = {}) {
    let host = null;
    const module = createModule({ host: { settings: id => host?.sdk.settings(id) ?? null, substitute: text => host?.sdk.substitute(text) } });
    const asked = [];
    host = await createHost({ modules: [module], callModel: async prompt => { asked.push(prompt); return answer; } });
    await host.send('Hello.', reply('The harbour at dawn.', ['~ time June 3, 1200, 08:00 am']));
    if (net) host.features.set(CORE_FEATURE.extractor, true);
    return { host, asked };
}
const minutes = host => host.sdk.query('director.time').minutes;
// The safety net's call runs after the reply is captured, without being awaited by the send.
const settle = () => new Promise(resolve => setTimeout(resolve, 60));

for (const [what, answer] of [
    ['plain lines', '! time +20m'],
    ['lines between <Changes> tags', '<Changes>\n! time +20m\n</Changes>'],
    ['lines with spaces around them', '  ! time +20m  '],
]) {
    test(`assist, ${what}: "! time +20m" moves the clock 20 minutes, marked (assist) with its line, kept on the reply`, async () => {
        const { host, asked } = await started(answer);
        try {
            const before = minutes(host);
            await host.send('We wait a while longer by the weir.', 'Another stretch of time goes by at the weir.');
            await settle();
            assert.equal(asked.length, 1, 'one call for the reply');
            assert.equal(minutes(host) - before, 20, 'the clock moved 20 minutes, no more');
            const marked = assisted(host);
            assert.equal(marked.length, 1);
            assert.deepEqual([marked[0].type, marked[0].assist, marked[0].assistLine], ['capture.time', 'now', '! time +20m']);
            assert.equal(host.sdk.query('assist.status').extractor.last.outcome, 'lines');
            const mes = host.ctx.chat.at(-1).mes;
            assert.match(mes, /<Changes-assist>\n! time \+20m\n<\/Changes-assist>/);
            // The next reply gets its own call and its own 20 minutes; the first reply's line is not applied again.
            const after = minutes(host);
            await host.send('And then?', 'The weir is quiet.');
            await settle();
            assert.equal(minutes(host), after + 20, 'its own answer, once');
            assert.equal(assisted(host).length, 2);
        } finally {
            host.close();
        }
    });
}

test('assist: with the safety net off the same answer is never asked for; the clock does not move', async () => {
    const { host, asked } = await started('! time +20m', { net: false });
    try {
        const before = minutes(host);
        await host.send('We wait.', 'Twenty minutes pass.');
        await settle();
        assert.equal(asked.length, 0);
        assert.equal(minutes(host), before);
        assert.deepEqual(assisted(host), []);
    } finally {
        host.close();
    }
});

test('assist: a line the reply\'s own block already has is not applied twice', async () => {
    const { host } = await started('! time +20m');
    try {
        const before = minutes(host);
        await host.send('We wait.', reply('Twenty minutes pass.', ['! time +20m']));
        await settle();
        assert.equal(minutes(host) - before, 20, 'once, the story\'s');
        assert.deepEqual(assisted(host), []);
    } finally {
        host.close();
    }
});

// World news and factions through the safety net, with Story Director's real chronicle part (the owner's live lines, 13 Nov).
const WORLD_LINES = [
    '~ weather thinning mist, warm sunlight',
    '+ faction Red Cords — pier crew locking down the salt barges | Bluewatch Village | stance: neutral',
    '+ world Shornmarch Wolf-Push — Shornmarch skirmishers pushing wolves onto the timber track; convoy pay doubled | state: ongoing | timber track | factions: Shornmarch',
    '+ world Shackles Retaliation — Watch-Captain sending rider to Ledgerford over two dead Shackles collectors | state: looming | Bluewatch Village | factions: Shackles',
];
test('assist: + world and + faction lines apply like the main block\'s (real chronicle), and nothing is refused', async () => {
    let host = null;
    const module = createModule({ host: { settings: id => host?.sdk.settings(id) ?? null, substitute: text => host?.sdk.substitute(text) } });
    const kinds = '~ weather, + world, ~ world, + faction, ~ faction';
    host = await createHost({ modules: [module], settings: { modules: { 'story-block': { assistExtractorKinds: kinds } } }, callModel: async () => `<Changes>\n${WORLD_LINES.join('\n')}\n</Changes>` });
    try {
        host.features.set(THREADS_FEATURE, true);
        await host.send('Hello.', reply('The harbour at dawn.', ['~ time June 3, 1200, 08:00 am']));
        host.features.set(CORE_FEATURE.extractor, true);
        await host.send('We watch the pier.', 'The Red Cords lock down the salt barges while wolves press the timber track.');
        await settle();
        const marked = assisted(host).map(receipt => receipt.type);
        assert.deepEqual(marked, ['capture.weather', 'capture.faction', 'capture.world', 'capture.world']);
        const problems = host.turn.problems().filter(item => item.code === 'UNKNOWN_KIND');
        assert.deepEqual(problems, []);
    } finally {
        host.close();
    }
});

// Through the real host path (vendored Story Block with the `assistFaction` rule mark): a safety-net faction line never moves the stance of a known faction.
async function worldHost(answer, { maxChangeLines } = {}) {
    let host = null;
    const module = createModule({ host: { settings: id => host?.sdk.settings(id) ?? null, substitute: text => host?.sdk.substitute(text) } });
    const kinds = '~ weather, + world, ~ world, + faction, ~ faction';
    host = await createHost({ modules: [module], settings: { modules: { 'story-block': { assistExtractorKinds: kinds, ...(maxChangeLines ? { maxChangeLines } : {}) } } }, callModel: async () => answer() });
    host.features.set(THREADS_FEATURE, true);
    return host;
}
const stanceOf = (host, name) => host.sdk.query('chronicle.factions', {}).find(row => row.name === name)?.stance;

test('assist: a safety-net faction line never resets the stance of a known faction (real host, rule mark); a new faction is written whole', async () => {
    let line = '~ faction Red Cords — now openly hostile | stance: hostile';
    const host = await worldHost(() => `<Changes>\n${line}\n</Changes>`);
    try {
        await host.send('Hello.', reply('The harbour at dawn.', ['~ time June 3, 1200, 08:00 am', '+ faction Red Cords — pier crew | Bluewatch Village | stance: neutral']));
        host.features.set(CORE_FEATURE.extractor, true);
        assert.equal(stanceOf(host, 'Red Cords'), 'neutral');
        await host.send('We watch the pier.', 'The Red Cords glare at the Watch.');
        await settle();
        assert.ok(host.ctx.chat.at(-1).extra.storySuite.rules.includes('assistFaction'), 'the new reply carries the mark');
        assert.equal(stanceOf(host, 'Red Cords'), 'neutral', 'stance stays the main model\'s');
        line = '+ faction Blue Lamps — lamplighters | Bluewatch Village | stance: friendly';
        await host.send('We walk on.', 'The Blue Lamps light the quay.');
        await settle();
        assert.equal(stanceOf(host, 'Blue Lamps'), 'friendly', 'a new faction is written whole');
        // The stance a reader/main block sets in a reply's own block still works.
        await host.send('Again.', reply('Red Cords turn on the Watch.', ['~ faction Red Cords | stance: hostile']));
        assert.equal(stanceOf(host, 'Red Cords'), 'hostile');
    } finally {
        host.close();
    }
});

test('assist: held Story Director lines are visibly refused; release and Re-read leave a low-cap reply unchanged (real chronicle)', async () => {
    const { announceModules } = await import('../../vendor/story-block/src/v2/sdk/lifecycle.js');
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    let calls = 0;
    const host = await worldHost(async () => { calls += 1; await gate; return `<Changes>\n${WORLD_LINES.join('\n')}\n</Changes>`; }, { maxChangeLines: 10 });
    try {
        // Keep the Director's independent weather hook off here: the barrier suppresses that hook live,
        // but it would otherwise add a weather key when it runs again on Re-read after the barrier lifts.
        host.features.set('story-director.weather', false);
        await host.send('Hello.', reply('The harbour at dawn.', ['~ time June 3, 1200, 08:00 am']));
        host.features.set(CORE_FEATURE.extractor, true);
        const main = Array.from({ length: 9 }, (_, i) => `+ faction Existing ${i} | stance: neutral`);
        const sent = await host.send('We watch the pier.', reply('The Red Cords lock down the salt barges while wolves press the timber track.', main));
        host.registry.setRestore('pending', 'Restoring a save point.');
        announceModules(host.registry, host.events);
        release();
        await settle();
        assert.equal(calls, 1);
        const refused = host.turn.problems().filter(item => item.index === sent.index && item.code === 'MODULE_HELD');
        assert.deepEqual(refused.map(item => item.line), WORLD_LINES.slice(1));
        assert.ok(refused.every(item => /Story Director was held back \(Restoring a save point\.\); this line was not used\./.test(item.message)));
        assert.equal(host.turn.problems().some(item => item.index === sent.index && item.code === 'UNKNOWN_KIND'), false);
        assert.deepEqual(assisted(host).map(receipt => receipt.type), ['capture.weather']);
        assert.deepEqual(assistSections(host.ctx.chat[sent.index].mes).now, [WORLD_LINES[0]]);
        host.registry.setRestore('idle');
        announceModules(host.registry, host.events);
        await settle();
        assert.deepEqual(assisted(host).map(receipt => receipt.type), ['capture.weather']);
        assert.equal(host.sdk.query('chronicle.events', { open: true }).length, 0);
        assert.equal(stanceOf(host, 'Red Cords'), undefined);
        // The refused lines consume no cap and are absent from stored assist sections, so Re-read matches live.
        const types = () => host.ctx.chat[sent.index].extra.storySuite.receipts.filter(receipt => receipt.type.startsWith('capture.')).map(receipt => [receipt.type, receipt.assist]);
        const before = JSON.stringify(types()), chronicle = JSON.stringify(host.head().domains.chronicle), scene = JSON.stringify(host.head().domains.scene);
        const again = await host.sdk.reread(sent.index);
        assert.equal(again.ok, true);
        assert.equal(again.problems.some(item => item.code === 'TOO_MANY'), false);
        assert.equal(JSON.stringify(types()), before);
        assert.equal(JSON.stringify(host.head().domains.chronicle), chronicle);
        assert.equal(JSON.stringify(host.head().domains.scene), scene);
        assert.equal(calls, 1);
        assert.equal(host.sdk.query('chronicle.events', { open: true }).length, 0);
    } finally {
        host.close();
    }
});

for (const worldFirst of [true, false]) {
    test(`assist: new faction stance survives ${worldFirst ? 'world-first' : 'faction-first'} order, known factions stay protected, Re-read matches`, async () => {
        const event = '+ world Pier Lockdown — barges held | place: Bluewatch | factions: Red Cords, Old Guard';
        const faction = '+ faction Red Cords — pier crew | stance: hostile';
        const lines = [...(worldFirst ? [event, faction] : [faction, event]), '~ faction Old Guard | stance: hostile', '~ faction Main Made | stance: hostile'];
        const host = await worldHost(() => lines.join('\n'));
        try {
            await host.send('Hello.', reply('The harbour at dawn.', ['~ time June 3, 1200, 08:00 am', '+ faction Old Guard | stance: neutral']));
            host.features.set(CORE_FEATURE.extractor, true);
            const sent = await host.send('We watch.', reply('A crew blocks the pier.', ['+ world Earlier News | factions: Main Made']));
            await settle();
            assert.ok(host.ctx.chat[sent.index].extra.storySuite.rules.includes('assistFactionFresh'));
            assert.equal(stanceOf(host, 'Red Cords'), 'hostile');
            assert.equal(stanceOf(host, 'Old Guard'), 'neutral');
            assert.equal(stanceOf(host, 'Main Made'), '', 'created by the main block, before the assist answer');
            const live = JSON.stringify(host.head().domains.chronicle);
            const receipts = JSON.stringify(host.ctx.chat[sent.index].extra.storySuite.receipts.map(r => [r.type, r.assist]));
            const again = await host.sdk.reread(sent.index);
            assert.equal(again.ok, true, JSON.stringify(again));
            assert.equal(JSON.stringify(host.head().domains.chronicle), live);
            assert.equal(JSON.stringify(host.ctx.chat[sent.index].extra.storySuite.receipts.map(r => [r.type, r.assist])), receipts);
        } finally { host.close(); }
    });
}

test('assist: replies without the new rule mark keep the earlier stance behavior on Re-read', async () => {
    let answer = '+ world Pier Lockdown | factions: Red Cords\n+ faction Red Cords | stance: hostile';
    const host = await worldHost(() => answer);
    try {
        await host.send('Hello.', reply('The harbour.', ['+ faction Old Guard | stance: neutral']));
        host.features.set(CORE_FEATURE.extractor, true);
        const setter = host.store.setRuleMarks;
        host.store.setRuleMarks = (index, names) => setter(index, names.filter(name => name !== 'assistFactionFresh'));
        const old = await host.send('Look.', 'The crew block the pier.');
        await settle();
        host.store.setRuleMarks = setter;
        assert.ok(host.ctx.chat[old.index].extra.storySuite.rules.includes('assistFaction'));
        assert.ok(!host.ctx.chat[old.index].extra.storySuite.rules.includes('assistFactionFresh'));
        assert.equal(stanceOf(host, 'Red Cords'), '');
        const before = JSON.stringify(host.head().domains.chronicle);
        assert.equal((await host.sdk.reread(old.index)).ok, true);
        assert.equal(JSON.stringify(host.head().domains.chronicle), before);

        // An even older reply without assistFaction keeps allowing its known faction's stance change.
        answer = '~ faction Old Guard | stance: hostile';
        host.store.setRuleMarks = (index, names) => setter(index, names.filter(name => !['assistFaction', 'assistFactionFresh'].includes(name)));
        const older = await host.send('Again.', 'The guard turns hostile.');
        await settle();
        host.store.setRuleMarks = setter;
        assert.equal(stanceOf(host, 'Old Guard'), 'hostile');
        const earlier = JSON.stringify(host.head().domains.chronicle);
        assert.equal((await host.sdk.reread(older.index)).ok, true);
        assert.equal(JSON.stringify(host.head().domains.chronicle), earlier);
    } finally { host.close(); }
});
