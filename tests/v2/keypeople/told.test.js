// Key people: the card line of a removal NPC State Delta made (archived or dead there) belongs to the reply that was being written when
// it was decided, not to the reply before it that holds the `keypeople.sync` step (review 183 follow-up 1). A swipe, a Re-read and a
// delete in the middle stay exact.
import test from 'node:test';
import assert from 'node:assert/strict';

import { OPENING, keyHost, pin, said, slice, validatorErrors } from './helpers.js';

const LATER = n => `~ time June 3, 1200, ${String(8 + n).padStart(2, '0')}:00 am`;
const notePaths = (host, index) => host.store.opsAt(index).map(op => String(op.path)).filter(path => path.startsWith('/domains/keypeople/notes/'));
const stepsOn = (host, index, type) => host.store.at(index) && (host.ctx.chat[index].extra?.storySuite?.receipts ?? []).filter(receipt => receipt.type === type);
const notesFor = (host, key) => Object.values(slice(host).notes).filter(note => note.key === key);

// Ren and Mara pinned and known to Delta; the reply at `at` is the first written after Mara was archived there.
async function archivedMara(t) {
    t.mock.method(console, 'warn', () => {});
    const people = { Ren: {}, Mara: {} };
    const host = await keyHost({ delta: people });
    await host.send('Hello.', said('Dawn.', OPENING));
    for (const name of ['Ren', 'Mara']) assert.equal((await pin(host, name)).ok, true, name);
    await host.send('Go.', said('Ren leaves.', ['+ away Ren — scouting | back: June 9, 1200', LATER(1)]));
    await host.send('Next.', said('Quiet.', [LATER(2)]));
    assert.deepEqual(Object.keys(slice(host).pins).sort(), ['mara', 'ren']);
    delete people.Mara;
    return { host, people };
}

test('Delta archives a key person: the line is on the reply being written, not on the one before it; the person is off the list before it', async t => {
    const { host } = await archivedMara(t);
    try {
        const before = host.ctx.chat.length - 1;
        await host.send('Next.', said('Quiet.', [LATER(3)]));
        const after = host.ctx.chat.length - 1;
        assert.equal(after, before + 2);
        // The step that took her off the list is on the reply before, the pin is gone and she is not owed once told.
        assert.equal(stepsOn(host, before, 'keypeople.sync').length, 1);
        assert.equal(slice(host).pins.mara, undefined);
        assert.equal(slice(host).gone.mara.reason, 'archived');
        assert.equal(slice(host).gone.mara.owed, undefined);
        // The card line is on the new reply only.
        assert.deepEqual(notePaths(host, before), [], 'the reply before has no line');
        assert.equal(notePaths(host, after).length, 1, 'the new reply has it');
        assert.equal(stepsOn(host, after, 'keypeople.tell').length, 1);
        const [note] = notesFor(host, 'mara');
        assert.equal(note.head, 'Mara is no longer a key person');
        assert.equal(note.rest, '(archived in NPC State Delta).');
        assert.equal(note.goneRev, slice(host).gone.mara.rev);
        assert.equal(note.lead, true);
        // Said once: the reply after has nothing to say, and Ren is untouched.
        await host.send('Next.', said('Quiet.', [LATER(4)]));
        assert.deepEqual(notePaths(host, host.ctx.chat.length - 1), []);
        assert.equal(notesFor(host, 'mara').length, 1);
        assert.equal(host.sdk.receipts().filter(entry => entry.receipt.type === 'keypeople.tell').length, 1);
        assert.equal(slice(host).away.ren.doing, 'scouting');
        assert.deepEqual(validatorErrors(host), []);
    } finally {
        host.close();
    }
});

test('a death in Delta reads died, with its day, on the new reply; two people at once are two lines on it', async t => {
    t.mock.method(console, 'warn', () => {});
    const people = { Ren: {}, Mara: {}, Brom: {} };
    const host = await keyHost({ delta: people });
    try {
        await host.send('Hello.', said('Dawn.', OPENING));
        for (const name of ['Ren', 'Mara', 'Brom']) await pin(host, name);
        await host.send('Next.', said('Quiet.', [LATER(1)]));
        await host.send('Next.', said('Quiet.', [LATER(2)]));
        delete people.Mara;
        people.Brom.lifeState = 'deceased';
        await host.send('Next.', said('Quiet.', [LATER(3)]));
        const after = host.ctx.chat.length - 1;
        assert.equal(notePaths(host, after).length, 2);
        assert.equal(notePaths(host, after - 2).length, 0);
        const [mara] = notesFor(host, 'mara');
        const [brom] = notesFor(host, 'brom');
        assert.match(brom.rest, /^\(died, /);
        assert.equal(mara.rest, '(archived in NPC State Delta).');
        assert.deepEqual([mara.lead, brom.lead].sort(), [false, true]);
        assert.deepEqual(validatorErrors(host), []);
    } finally {
        host.close();
    }
});

test('a swipe of the new reply says it again on the swipe, once; a Re-read keeps it on that reply, once', async t => {
    const { host } = await archivedMara(t);
    try {
        await host.send('Next.', said('Quiet.', [LATER(3)]));
        const after = host.ctx.chat.length - 1;
        await host.swipe(said('Another take.', [LATER(3)]));
        assert.equal(host.ctx.chat.length - 1, after);
        assert.equal(notePaths(host, after).length, 1, 'the swipe holds the line');
        assert.deepEqual(notePaths(host, after - 2), [], 'the reply before still has none');
        assert.equal(notesFor(host, 'mara').length, 1, 'one line, not two');
        assert.equal(slice(host).gone.mara.owed, undefined);
        assert.equal((await host.turn.reread(after)).ok, true);
        assert.equal(notePaths(host, after).length, 1, 'a Re-read keeps the line on its reply');
        assert.equal(notesFor(host, 'mara').length, 1);
        assert.deepEqual(notePaths(host, after - 2), []);
        const live = JSON.stringify(host.head());
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), live);
        assert.deepEqual(host.store.problems(), []);
        assert.deepEqual(validatorErrors(host), []);
    } finally {
        host.close();
    }
});

test('a reply without change lines cannot hold the line: it waits for the next reply that has lines, and is said once', async t => {
    const { host } = await archivedMara(t);
    try {
        await host.send('Next.', 'Quiet, no lines.');
        assert.equal(slice(host).gone.mara.owed, true);
        assert.equal(notesFor(host, 'mara').length, 0);
        await host.send('Next.', said('Quiet.', [LATER(4)]));
        assert.equal(slice(host).gone.mara.owed, undefined);
        assert.equal(notePaths(host, host.ctx.chat.length - 1).length, 1);
        assert.equal(notesFor(host, 'mara').length, 1);
    } finally {
        host.close();
    }
});

test('a delete in the middle: the new reply deleted, the next one says it; the reply with the step deleted, the person is pinned again and the old line says nothing', async t => {
    const { host, people } = await archivedMara(t);
    try {
        const check = where => {
            const live = JSON.stringify(host.head());
            host.store.rebuild();
            assert.equal(JSON.stringify(host.head()), live, `${where}: rebuild != live`);
            assert.deepEqual(host.store.problems(), [], `${where}: nothing is skipped`);
            assert.deepEqual(validatorErrors(host), [], where);
        };
        await host.send('Next.', said('Quiet.', [LATER(3)]));
        const after = host.ctx.chat.length - 1;
        check('after the reply');
        // The new reply (and the message that asked for it) is deleted: nothing is told yet, and the next reply tells it.
        await host.st.deleteMessage(after);
        await host.st.deleteMessage(after - 1);
        check('after deleting the new reply');
        assert.equal(slice(host).pins.mara, undefined);
        assert.equal(slice(host).gone.mara.owed, true);
        assert.equal(notesFor(host, 'mara').length, 0);
        await host.send('Again.', said('Quiet.', [LATER(3)]));
        assert.equal(notePaths(host, host.ctx.chat.length - 1).length, 1);
        assert.equal(slice(host).gone.mara.owed, undefined);
        check('after the next reply');
        // The reply that holds the step is deleted: she is pinned again, her line (kept on the later reply) is passed over or says nothing.
        const holder = host.ctx.chat.length - 3;
        assert.equal(stepsOn(host, holder, 'keypeople.sync').length, 1);
        await host.st.deleteMessage(holder);
        await host.st.deleteMessage(holder - 1);
        check('after deleting the reply with the step');
        assert.ok(slice(host).pins.mara, 'pinned again');
        assert.equal(slice(host).gone.mara, undefined);
        // The line the later reply kept is about a record that is not there: the card draws nothing for it (screens.test.js).
        assert.deepEqual(notesFor(host, 'mara').map(note => note.goneRev !== undefined), [true]);
        // Delta still says she is archived: the next reply takes her off again and tells it on itself.
        await host.send('Next.', said('Quiet.', [LATER(5)]));
        assert.equal(slice(host).pins.mara, undefined);
        assert.equal(notePaths(host, host.ctx.chat.length - 1).length, 1);
        check('after the removal again');
        void people;
    } finally {
        host.close();
    }
});

test('the story\'s death line and the reader\'s Unpin are told on the reply that did them, as before', async () => {
    const host = await keyHost();
    try {
        await host.send('Hello.', said('Dawn.', OPENING));
        await pin(host, 'Ren');
        await pin(host, 'Odda');
        await host.send('Go.', said('Ren dies.', ['- key Ren | died', LATER(1)]));
        assert.equal(notePaths(host, host.ctx.chat.length - 1).length, 1);
        assert.equal(slice(host).gone.ren.owed, undefined);
        const unpinned = await host.sdk.command('keypeople.unpin', { name: 'Odda' });
        assert.equal(unpinned.ok, true);
        assert.equal(notePaths(host, host.ctx.chat.length - 1).length, 2, 'the reader\'s Unpin is on the latest reply');
        assert.equal(Object.values(slice(host).notes).filter(note => note.key !== undefined).length, 0);
    } finally {
        host.close();
    }
});

test('the tell step is the system\'s: a click or the story cannot send it, a bad payload is refused, and one with nobody owed says nothing', async () => {
    const host = await keyHost();
    try {
        await host.send('Hello.', said('Dawn.', OPENING));
        const click = await host.sdk.command('keypeople.tell', { who: ['mara'] });
        assert.equal(click.ok, false);
        for (const payload of [undefined, {}, { who: 'mara' }, { who: [1] }, { who: ['a'], more: 1 }, { who: Array.from({ length: 25 }, (_, n) => `k${n}`) }]) {
            let out;
            try { out = await host.bus.run('keypeople.tell', payload, { cause: 'system', state: host.head() }); } catch (error) { out = { ok: false, code: error?.code }; }
            assert.equal(out.ok, false, JSON.stringify(payload));
        }
        const none = await host.bus.run('keypeople.tell', { who: ['nobody'] }, { cause: 'system', state: host.head() });
        assert.equal(none.ok, true);
        assert.deepEqual(none.ops.filter(op => String(op.path).includes('/notes/')), []);
    } finally {
        host.close();
    }
});
