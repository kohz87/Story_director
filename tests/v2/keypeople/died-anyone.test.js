// "- key Name | died" for anyone (keypeople/capture.js): a person who is not pinned is recorded as dead (a `gone` record, reason died) when the reply
// carries Story Block's `diedAny` rule mark; without the mark the line finds nobody, as before. A pinned person is unchanged. The record hides that
// person's own agenda (not a beat that names them) at read time (tracker/quiet.js). Old replies (recorded without the mark) gain nothing on a Re-read, a rebuild or a reload.
import test from 'node:test';
import assert from 'node:assert/strict';

import { OPENING, keyHost, pin, said, slice, validatorErrors } from './helpers.js';
import { MAX_GONE } from '../../../src/v2/keypeople/domain.js';

const OPEN = ['+ agenda Vorn — pawns the rations | now: the quay', '+ beat Vorn\'s Return — Vorn comes back | now: the quay', '+ agenda Ann — mends nets | now: the quay'];
const open = host => host.sdk.query('director.threads', { open: true }).map(thread => thread.key).sort();
const lastIndex = host => host.ctx.chat.length - 1;
const recordOf = (host, index) => host.ctx.chat[index].extra.storySuite;

async function start(extra = {}) {
    const host = await keyHost(extra);
    await host.send('Hello.', said('Dawn.', [...OPENING, ...OPEN]));
    return host;
}

test('unpinned + the mark: the death is recorded and told "Died: Name"; the person\'s agenda is hidden, their named beat and others stay', async () => {
    const host = await start();
    try {
        assert.deepEqual(open(host), ['Ann', 'Vorn', 'Vorn\'s Return']);
        await host.send('He falls.', said('Vorn dies.', ['- key Vorn | died']));
        assert.deepEqual(recordOf(host, lastIndex(host)).rules, ['diedAny']);
        assert.deepEqual(slice(host).gone.vorn, { name: 'Vorn', reason: 'died', on: host.sdk.query('director.time').minutes, rev: slice(host).gone.vorn.rev });
        assert.deepEqual(slice(host).pins, {});
        assert.deepEqual(slice(host).notes, {}, 'no card line: they were never a key person');
        assert.deepEqual(open(host), ['Ann', 'Vorn\'s Return']);
        assert.deepEqual(validatorErrors(host), []);
    } finally { host.close(); }
});

test('the receipt says "Died: Name"', async () => {
    const host = await start();
    try {
        await host.send('He falls.', said('Vorn dies.', ['- key Vorn | died']));
        const texts = host.store.receipts().map(entry => entry.receipt.summary ?? entry.receipt.text ?? JSON.stringify(entry.receipt));
        assert.ok(texts.some(text => /Died: Vorn/.test(text)), texts.join(' | '));
    } finally { host.close(); }
});

test('unpinned without the mark: NOT_FOUND and nothing written (a reply recorded before the rule)', async () => {
    const host = await start();
    try {
        const setRuleMarks = host.store.setRuleMarks;
        host.store.setRuleMarks = () => { throw new Error('no mark: an old chat'); };
        await host.send('He falls.', said('Vorn dies.', ['- key Vorn | died']));
        host.store.setRuleMarks = setRuleMarks;
        const at = lastIndex(host);
        assert.equal(recordOf(host, at).rules, undefined);
        assert.deepEqual(slice(host).gone, {});
        assert.match(host.turn.problems().map(problem => problem.message ?? String(problem)).join(' '), /Vorn is not a key person/);
        assert.deepEqual(open(host), ['Ann', 'Vorn', 'Vorn\'s Return']);
        // Re-read, rebuild, reload: still nothing, byte-identical.
        const live = JSON.stringify(host.head());
        assert.equal((await host.turn.reread(at)).ok, true);
        assert.equal(JSON.stringify(host.head()), live, 'a Re-read adds nothing');
        assert.equal(recordOf(host, at).rules, undefined, 'and no mark');
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), live, 'a rebuild');
        await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
        assert.equal(JSON.stringify(host.head()), live, 'a reload');
    } finally { host.close(); }
});

test('replay == live: a Re-read, a rebuild and a reload of a marked reply give the same state', async () => {
    const host = await start();
    try {
        await host.send('He falls.', said('Vorn dies.', ['- key Vorn | died']));
        const at = lastIndex(host);
        const live = JSON.stringify(host.head());
        assert.equal((await host.turn.reread(at)).ok, true);
        assert.deepEqual(slice(host).gone.vorn.reason, 'died');
        assert.deepEqual(Object.keys(slice(host).gone), ['vorn']);
        host.store.rebuild();
        assert.deepEqual(Object.keys(slice(host).gone), ['vorn']);
        const rebuilt = JSON.stringify(host.head());
        await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
        assert.equal(JSON.stringify(host.head()), rebuilt, 'a reload');
        assert.equal(JSON.parse(live).domains.keypeople.gone.vorn.name, 'Vorn');
        assert.deepEqual(open(host), ['Ann', 'Vorn\'s Return']);
    } finally { host.close(); }
});

test('a pinned person is unchanged: the pin goes, a card line is told, and the mark makes no difference', async () => {
    const host = await start();
    try {
        await pin(host, 'Mara');
        await host.send('Oh no.', said('The roof gives way.', ['- key Mara | died']));
        assert.deepEqual(slice(host).pins, {});
        assert.equal(slice(host).gone.mara.reason, 'died');
        const note = Object.values(slice(host).notes).at(-1);
        assert.deepEqual([note.kind, note.head], ['gone', 'Mara is no longer a key person']);
    } finally { host.close(); }
});

test('a pin found by alias takes the pinned path; the record is bounded to the newest MAX_GONE', async () => {
    const host = await start();
    try {
        await pin(host, 'Mara', { aliases: ['the Miller'] });
        await host.send('Oh no.', said('The Miller falls.', ['- key the Miller | died']));
        assert.equal(slice(host).gone.mara.reason, 'died');
        const names = Array.from({ length: MAX_GONE + 5 }, (_, i) => `Soul${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`);
        await host.send('Plague.', said('They all die.', names.map(name => `- key ${name} | died`)));
        const gone = Object.keys(slice(host).gone);
        assert.equal(gone.length, MAX_GONE);
        assert.ok(gone.includes(names.at(-1).toLowerCase()) && !gone.includes('mara'));
        assert.deepEqual(validatorErrors(host), []);
    } finally { host.close(); }
});
