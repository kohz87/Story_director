// The Assist safety net and the story clock, the live path (final live check FL-3): the reply comes without
// a <Changes> block, the safety net's model call answers in plain lines (`! time +20m`, no <Changes> tags,
// as a small model does), and Story Director's `time` kind moves the clock. The reader sees it on the
// reply's card as "! time +20m (assist)" (the card's `assisted` list is the reply's receipts marked
// `assist`, Story Block's ui-host; its folded header counts them). Story Block and Story Director only (no
// RPG Battle, no NSD).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHost } from '../../vendor/story-block/testkit/index.js';
import { CORE_FEATURE } from '../../vendor/story-block/src/v2/features.js';
import { createModule } from '../../../src/v2/module.js';

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
