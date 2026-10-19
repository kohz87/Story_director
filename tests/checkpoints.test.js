// Story Director: checkpoints, the tracker kept at the back of the chat (0.9.30).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseChanges } from '../src/changes.js';
import { CHECKPOINTS_KEPT, CHECKPOINT_EVERY, CHECKPOINT_TRAIL, checkpointDue, compactTracker, compactVisits, locate, shiftTracker, usableCheckpoint, withCheckpoint } from '../src/checkpoints.js';
import { findRecord, questsDoneIn, replay } from '../src/tracker.js';

const ops = text => parseChanges(text).ops;
const signature = message => `${message.is_user ? 'u' : 'a'}:${message.mes}`;
const chatOf = count => Array.from({ length: count }, (_, index) => ({ is_user: index % 2 === 1, mes: `m${index}`, send_date: `d${index}` }));

test('a checkpoint plus the replies after it is the tracker a full replay gives', () => {
    const entries = [
        { message: 0, time: 0, ops: ops('+ quest Lone Grey Wolf — hunt the pack | giver: Verna | reward: 1 gold') },
        { message: 2, time: 10, ops: ops('+ hook Rat Granary — rats in the granary | giver: Danique') },
        { message: 4, time: 20, ops: ops('! Lone Grey Wolf — the pack is slain\n- Rat Granary — someone else took it') },
        { message: 6, time: 30, ops: ops('- Lone Grey Wolf — voucher cashed, bounty paid') },
    ];
    const full = replay(entries).tracker;
    const point = compactTracker(replay(entries.slice(0, 3)).tracker);
    const resumed = replay(entries.slice(3), { seed: point }).tracker;
    assert.equal(findRecord(resumed, 'Lone Grey Wolf').status, 'resolved');
    assert.deepEqual(questsDoneIn(resumed, 6), questsDoneIn(full, 6));
    // Closed records keep only what is still read: what fired and how they began.
    assert.deepEqual(findRecord(point, 'Rat Granary').history.map(entry => entry.op), ['+']);
    assert.deepEqual(findRecord(point, 'Lone Grey Wolf').history.map(entry => entry.op), ['+', '!'], 'an open record keeps all of it');
    assert.equal(findRecord(point, 'Lone Grey Wolf').history[1].time, 20, 'each line keeps its story time');
});

test('message numbers move with the messages deleted before a checkpoint', () => {
    const tracker = replay([{ message: 10, time: 5, ops: ops('+ quest Wolf — hunt | giver: Verna') }]).tracker;
    const moved = shiftTracker(tracker, -4);
    const wolf = findRecord(moved, 'Wolf');
    assert.equal(moved.message, 6);
    assert.equal(wolf.created.message, 6);
    assert.equal(wolf.history[0].message, 6);
    assert.equal(findRecord(tracker, 'Wolf').created.message, 10, 'the copy is new');
    assert.equal(shiftTracker(tracker, 0), tracker);
});

test('finding a checkpoint\'s reply: in place, moved back by deletions, or gone', () => {
    const chat = chatOf(30);
    const point = { message: 20, sig: signature(chat[20]), sendDate: 'd20', key: 'k', tracker: { records: [] } };
    assert.equal(locate(point, chat, signature), 20);
    assert.equal(locate(point, chat.slice(5), signature), 15, 'five older messages deleted');
    assert.equal(locate(point, chat.slice(0, 15), signature), null, 'rolled back past it');
    const edited = chat.map((message, index) => (index === 20 ? { ...message, mes: 'swiped' } : message));
    assert.equal(locate(point, edited, signature), null, 'its reply changed');
    // The newest usable one, under the same reading, at or before the message asked for.
    const older = { ...point, message: 10, sig: signature(chat[10]), sendDate: 'd10' };
    assert.equal(usableCheckpoint([older, point], chat, { signature, upTo: 29, key: 'k' }).index, 20);
    assert.equal(usableCheckpoint([older, point], chat.slice(0, 15), { signature, upTo: 14, key: 'k' }).index, 10, 'a rollback past the newest falls back on an older one');
    assert.equal(usableCheckpoint([older, point], chat, { signature, upTo: 29, key: 'other calendar' }), null);
});

test('when one is due: trailing the newest reply, one every so many replies, a few kept', () => {
    const replies = Array.from({ length: CHECKPOINT_TRAIL + 5 }, (_, index) => index * 2);
    assert.equal(checkpointDue(replies.slice(0, CHECKPOINT_TRAIL), null), null, 'not enough replies yet');
    assert.equal(checkpointDue(replies, null), replies[4]);
    assert.equal(checkpointDue(replies, replies[4]), null, 'just kept');
    const longer = Array.from({ length: CHECKPOINT_TRAIL + CHECKPOINT_EVERY + 5 }, (_, index) => index * 2);
    assert.equal(checkpointDue(longer, longer[4]), longer[4 + CHECKPOINT_EVERY]);
    let points = [];
    for (let index = 0; index < CHECKPOINTS_KEPT + 2; index++) points = withCheckpoint(points, { message: index * 40 });
    assert.deepEqual(points.map(point => point.message), Array.from({ length: CHECKPOINTS_KEPT }, (_, index) => (index + 2) * 40));
});

test('place visits: a stay over several replies is kept by its first and last', () => {
    const visit = (message, text) => ({ message, time: message, text });
    const visits = [visit(1, 'Harrowford'), visit(3, 'Harrowford'), visit(5, 'Harrowford'), visit(7, 'The Weir'), visit(9, 'Harrowford')];
    assert.deepEqual(compactVisits(visits).map(entry => entry.message), [1, 5, 7, 9]);
});
