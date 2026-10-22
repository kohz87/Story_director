// Final soak (live soak seed 23, testkit fuzz seed 4): deleting a reply from the middle of the chat drops the
// world-line changes of a LATER reply that is still there. Before each reply with more than three open world
// events, chronicle.surface (a system cue stored on the previous carrier) raises chronicle.round and writes
// chronicle.seen whole. A world line in the next reply also writes chronicle.seen whole (pick.js / domain
// slots), with the rounds that cue set. Delete the carrier holding the cue and the round goes back, so the
// next reply's block no longer validates ("chronicle.seen[...] must be a round so far") and is skipped as a
// whole: "- world Salt Tax Riots" is lost (the event is ongoing again), with anything else in that block.
// A reload replays the same way, and the next checkpoint stores the loss. In the live soak the same thing
// took a later reply's `! rest` claim with it. Invariant 2 (a delete restores the state of that point) and 7.
// Fixed: `chronicle.seenAt` is kept by event id (add/remove by key, a scratch field) and `round` is a
// counter; a round past `round` after a delete is read as just shown, never refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../vendor/story-block/testkit/index.js';
import { createModule } from '../../../src/v2/module.js';
import { surface } from '../../../src/v2/chronicle/pick.js';
import { seenOf, validateChronicle } from '../../../src/v2/chronicle/domain.js';
import { lines, makeState, runCommand } from '../chronicle/helpers/fake-ctx.js';

const reply = (text, lines = []) => (lines.length ? `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>` : text);

test('final: deleting an earlier reply does not drop a later reply\'s world line (chronicle.seen vs round)', async t => {
    t.mock.method(console, 'warn', () => {});
    let host = null;
    const module = createModule({ host: { settings: id => host?.sdk.settings(id) ?? null, substitute: text => host?.sdk.substitute(text) } });
    host = await createHost({ modules: [module] });
    t.after(() => host.close());
    await host.send('News?', reply('Bad news everywhere.', [
        '~ time June 3, 1200, 08:00 am', '~ place Harrow | kind: settlement',
        '+ world Salt Tax Riots — the salt tax riots | state: ongoing | place: Auvoth',
        '+ world Hill Rains — the hills drown | state: ongoing | place: the northern hills',
        '+ world Wolf Winter — wolves come down | state: ongoing | place: the north marches',
        '+ world Confederacy Levy — every second son | state: ongoing | place: the river',
    ]));
    for (let i = 0; i < 3; i++) await host.send('We wait.', reply('Rain.', ['! time +2h']));
    const cueCarrier = host.ctx.chat.length - 1;
    await host.send('And the riots?', reply('They burn out.', ['- world Salt Tax Riots — the riots burn out']));
    const types = host.ctx.chat[cueCarrier].extra.storySuite.receipts.map(receipt => receipt.type);
    assert.ok(types.includes('chronicle.surface'), 'the carrier before the last reply holds the surface cue');
    const state = name => Object.values(host.head().domains.chronicle.events).find(event => event.name === name)?.state;
    assert.equal(state('Salt Tax Riots'), 'resolved');

    await host.st.deleteMessage(cueCarrier);   // the reader deletes an earlier reply (not the last one)

    assert.deepEqual(host.store.problems().map(problem => problem.why), [], 'no stored change of the later reply is skipped');
    assert.equal(state('Salt Tax Riots'), 'resolved', 'the later reply still ended the riots');
    const live = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live, 'rebuild equals live');
    assert.deepEqual(validateChronicle(host.head().domains.chronicle), []);
});

test('an older chat (rounds in the whole `seen` slot) still loads and picks; new rounds go by key', () => {
    let state = lines(makeState(), ['A', 'B', 'C', 'D'].map(name => `+ world ${name} Trouble — afoot | state: ongoing`).join('\n')).state;
    const ids = Object.keys(state.domains.chronicle.events).sort();
    const { seenAt: _none, ...old } = state.domains.chronicle;
    state = { ...state, domains: { ...state.domains, chronicle: { ...old, seen: [{ [ids[0]]: 2, [ids[1]]: 2 }], round: 2 } } };
    assert.deepEqual(validateChronicle(state.domains.chronicle), []);
    const run = runCommand(state, surface, { at: 6 }, { cause: 'system' });
    const chronicle = run.state.domains.chronicle;
    assert.equal(chronicle.round, 3);
    assert.deepEqual(chronicle.seen, [{ [ids[0]]: 2, [ids[1]]: 2 }], 'the old slot is never written');
    assert.equal(Object.keys(chronicle.seenAt).length, 3, 'the pick\'s rounds by key');
    assert.ok(Object.values(chronicle.seenAt).every(round => round === 3));
    assert.equal(Object.keys(seenOf(chronicle)).length, 4, 'read together');
    assert.deepEqual(validateChronicle(chronicle), []);
});
