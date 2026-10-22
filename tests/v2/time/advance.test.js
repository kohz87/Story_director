// Time part: `director.advance`, another module's rule moving the story clock on (RPG Battle's
// crafting), on the real Story Block v2 host with a crafting stand-in: the clock moves as a `~ time`
// line moves it, held to a day a call and to once a reply per cause; a click is refused; the receipt
// names the cause; the settle and the day digest follow; a swipe and a middle delete replay cleanly.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHost } from '../../vendor/story-block/testkit/index.js';
import { createModule } from '../../../src/v2/module.js';
import { fakeRpgBattle } from '../integration/helpers/fake-rpg.js';
import { fakeCraft } from './helpers/fake-craft.js';
import { ADVANCE, MAX_ADVANCE, advanceClaim, spanText } from '../../../src/v2/time/advance.js';
import { DIGEST } from '../../../src/v2/chronicle/days.js';

const HOUR = 60;
const reply = (text, lines = []) => (lines.length ? `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>` : text);
const receipts = host => host.sdk.receipts().map(entry => entry.receipt);
const clock = host => host.sdk.query('time.now').minutes;

async function newHost() {
    let host = null;
    const module = createModule({ host: { settings: id => host?.sdk.settings(id) ?? null, substitute: text => host?.sdk.substitute(text) } });
    host = await createHost({ modules: [fakeRpgBattle(), module, fakeCraft()] });
    return host;
}

function validatorErrors(host) {
    const state = host.head();
    return Object.keys(state.domains).flatMap(name => (host.registry.validator(name)?.(state.domains[name], state) ?? []).map(error => `${name}: ${error}`));
}

function sameOnReload(host, where) {
    const live = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live, `${where}: rebuild != live`);
    assert.deepEqual(host.store.problems(), [], `${where}: a block no longer applies`);
    assert.deepEqual(validatorErrors(host), [], where);
}

test('a craft line moves the clock through director.advance, once a reply per cause; the next reply may again', async () => {
    const host = await newHost();
    await host.send('Start.', reply('The forge.', ['~ time June 3, 1200, 08:00 am']));
    const start = clock(host);
    await host.send('I forge.', reply('Hammer and tongs.', ['! craft Iron Sword | hours: 2']));
    assert.equal(clock(host), start + 2 * HOUR);
    const craft = receipts(host).find(receipt => receipt.type === 'capture.craft');
    assert.deepEqual(craft.data.clock, { minutes: start + 2 * HOUR, from: start, advanced: 120, cause: 'fake-craft', reason: 'Astra crafts Iron Sword' });
    assert.equal(host.sdk.query('time.now').text, 'June 3, 1200, 10:00 am');
    // The claim is the reply's own: its record sid, under the calling module's name.
    const claims = Object.keys(host.head().meta.claims).filter(key => key.startsWith('advance:'));
    assert.deepEqual(claims, [advanceClaim('fake-craft', host.store.carrierSid(host.ctx.chat.length - 1))]);

    // Two crafts in one reply: both are made, the clock moves once; another cause moves it again.
    await host.send('Two more.', reply('More work.', ['! craft Nail | hours: 1', '! craft Hook | hours: 3', '! craft Bread | hours: 1 | cause: cook']));
    assert.equal(clock(host), start + 2 * HOUR + HOUR + HOUR);
    const made = receipts(host).filter(receipt => receipt.type === 'capture.craft').slice(-3);
    assert.deepEqual(made.map(receipt => receipt.data.clock.advanced), [60, 0, 60]);
    assert.equal(made[1].data.clock.held, 'once');
    // The next reply is a reply of its own.
    await host.send('Again.', reply('Again.', ['! craft Ring | hours: 1']));
    assert.equal(clock(host), start + 5 * HOUR);
    sameOnReload(host, 'after the crafts');
    host.close();
});

test('held to a day a call; a click is refused; bad minutes or cause, or no story time, are refused', async () => {
    const host = await newHost();
    // No story time yet.
    const early = await host.bus.command(ADVANCE, { minutes: 30, cause: 'rest' }, { cause: 'system' });
    assert.deepEqual([early.ok, early.code], [false, 'REFUSED']);
    await host.send('Start.', reply('Camp.', ['~ time June 3, 1200, 08:00 am']));
    const start = clock(host);
    const click = await host.sdk.command(ADVANCE, { minutes: 30 });
    assert.deepEqual([click.ok, click.code], [false, 'REFUSED']);
    for (const payload of [{ minutes: 0 }, { minutes: -5 }, { minutes: 1.5 }, { minutes: '30' }, { minutes: 30, cause: 'Not a label!' }]) {
        const out = await host.bus.command(ADVANCE, payload, { cause: 'system' });
        assert.deepEqual([out.ok, out.code], [false, 'INVALID'], JSON.stringify(payload));
    }
    assert.equal(clock(host), start, 'nothing moved');
    // A host step outside any reply: no claim to key on; the receipt names its cause.
    const long = await host.bus.command(ADVANCE, { minutes: 3000, cause: 'rest', reason: 'A long rest' }, { cause: 'system' });
    assert.ok(long.ok);
    assert.equal(long.receipt.type, ADVANCE);
    assert.equal(long.receipt.summary, `Story time: June 4, 1200, 08:00 am (${spanText(MAX_ADVANCE)} on: A long rest).`);
    assert.deepEqual(long.receipt.data, { minutes: start + MAX_ADVANCE, from: start, advanced: MAX_ADVANCE, cause: 'rest', reason: 'A long rest', asked: 3000 });
    assert.equal(clock(host), start + MAX_ADVANCE);
    assert.equal(spanText(90), '1 h 30 min');
    host.close();
});

test('the clock moved by a rule is settled and crosses days for the digest like a time line', async () => {
    const host = await newHost();
    await host.send('Start.', reply('Late at the forge.', ['~ time June 3, 1200, 10:00 pm', '+ coin 12']));
    await host.send('All night.', reply('Through the night.', ['! craft Plate Armour | hours: 10']));
    await host.send('Morning.', reply('Dawn.'));
    assert.equal(host.sdk.query('time.now').date, 'June 4, 1200');
    const settle = receipts(host).filter(receipt => receipt.type === 'time.settle').at(-1);
    assert.equal(settle.data.minutes, clock(host));
    assert.equal(receipts(host).filter(receipt => receipt.type === DIGEST).length, 1);
    const [day] = host.sdk.query('chronicle.days');
    assert.equal(day.date, 'June 3, 1200');
    assert.match(day.line, /12 gold in/);
    host.close();
});

test('a swipe takes the move back with its reply; a middle delete replays cleanly', async () => {
    const host = await newHost();
    await host.send('Start.', reply('The forge.', ['~ time June 3, 1200, 08:00 am']));
    const start = clock(host);
    await host.send('One.', reply('One.', ['! craft Nail | hours: 1']));
    await host.send('Two.', reply('Two.', ['! craft Hook | hours: 2']));
    await host.send('Three.', reply('Three.', ['! craft Ring | hours: 3']));
    assert.equal(clock(host), start + 6 * HOUR);
    // A swipe of the last reply: its move goes, the new swipe moves the clock once again.
    await host.swipe(reply('Three, again.', ['! craft Ring | hours: 4', '! craft Ring | hours: 4']));
    assert.equal(clock(host), start + 7 * HOUR);
    sameOnReload(host, 'after the swipe');
    // Deleting "Two." takes its claim with it; the later reply's move still applies as written.
    const at = host.ctx.chat.findIndex(message => message.is_user && message.mes === 'Two.');
    await host.st.deleteMessage(at + 1);
    await host.st.deleteMessage(at);
    sameOnReload(host, 'after the delete');
    assert.equal(Object.keys(host.head().meta.claims).filter(key => key.startsWith('advance:')).length, 2);
    await host.send('Four.', reply('Four.', ['! craft Cup | hours: 1']));
    sameOnReload(host, 'after the next reply');
    const again = await newHost();
    await again.st.loadChat(structuredClone(host.ctx.chat));
    assert.deepEqual(again.store.problems(), []);
    assert.equal(JSON.stringify(again.head().domains), JSON.stringify(host.head().domains), 'a fresh load gives the live state');
    again.close();
    host.close();
});
