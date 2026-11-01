// The card of a reply someone arrived in is kept where the reader can see it: SillyTavern scrolls to the newest message as it lands and
// Story Block draws the card a moment later, so the card could sit just below the visible chat until the next reply. A reader who was at
// the bottom is scrolled down again once the card is there; one who scrolled up is left alone.
import test from 'node:test';
import assert from 'node:assert/strict';

import { atBottom, createFollow, revealNewestCard } from '../../../src/v2/cast/follow.js';
import { createCastHooks } from '../../../src/v2/cast/hooks.js';
import { createPlans } from '../../../src/v2/cast/plan.js';

// A chat element with a layout: `cardBottom` is where the newest reply's card ends, `chatBottom` where the visible chat does.
function fakeChat({ scrollTop = 1600, scrollHeight = 2400, clientHeight = 780, cardBottom = 860, chatBottom = 820, card = true } = {}) {
    const last = { querySelector: selector => (selector === '.ss-card' && card ? { getBoundingClientRect: () => ({ bottom: chat.cardBottom }) } : null) };
    const chat = { scrollTop, scrollHeight, clientHeight, cardBottom, getBoundingClientRect: () => ({ bottom: chatBottom }), querySelectorAll: selector => (selector === '.mes' ? [{ querySelector: () => null }, last] : []) };
    return chat;
}
const page = chat => ({ querySelector: selector => (selector === '#chat' ? chat : null) });
// Timers that run when the test says.
function clock() {
    const queue = [];
    return { setTimeout: (fn, ms) => { queue.push({ fn, ms }); return queue.length; }, clearTimeout: () => { queue.length = 0; }, run: () => { const next = queue.shift(); next?.fn(); return Boolean(next); }, size: () => queue.length };
}

test('one look: a card below the visible chat scrolls the chat to the bottom; one in view, or none yet, moves nothing', () => {
    const hidden = fakeChat();
    assert.equal(revealNewestCard(hidden), 'moved');
    assert.equal(hidden.scrollTop, hidden.scrollHeight);
    const seen = fakeChat({ cardBottom: 800 });
    assert.equal(revealNewestCard(seen), 'seen');
    assert.equal(seen.scrollTop, 1600);
    assert.equal(revealNewestCard(fakeChat({ card: false })), 'none');
    assert.equal(revealNewestCard(null), 'none');
    assert.equal(revealNewestCard({}), 'none');
    assert.equal(atBottom(fakeChat()), true);
    assert.equal(atBottom(fakeChat({ scrollTop: 100 })), false);
    assert.equal(atBottom(null), false);
});

test('the follower: a reader at the bottom is scrolled down once the card is drawn (a few tries); a reader who scrolled up is not followed', () => {
    const chat = fakeChat({ card: false });
    const timers = clock();
    const follow = createFollow({ doc: () => page(chat), timers });
    assert.equal(follow(), true);
    timers.run();
    assert.equal(chat.scrollTop, 1600, 'no card yet: nothing moved, tries again');
    assert.equal(timers.size(), 1);
    // The card is drawn below the fold.
    chat.querySelectorAll = () => [{ querySelector: () => ({ getBoundingClientRect: () => ({ bottom: 870 }) }) }];
    timers.run();
    assert.equal(chat.scrollTop, 2400, 'scrolled to the bottom');
    // A reader who was reading earlier replies stays where they are.
    const above = fakeChat({ scrollTop: 200 });
    const other = clock();
    assert.equal(createFollow({ doc: () => page(above), timers: other })(), false);
    assert.equal(other.size(), 0);
    assert.equal(createFollow({ doc: () => null, timers: other })(), false, 'no page');
    // It stops when the reader scrolls up between two tries.
    const moving = fakeChat({ card: false });
    const third = clock();
    createFollow({ doc: () => page(moving), timers: third })();
    third.run();
    moving.scrollTop = 100;
    third.run();
    assert.equal(third.size(), 0);
});

test('the hook asks to follow only for a reply that has a cast note for it (a person came in, the cast moved on, the pack was updated)', () => {
    let asked = 0;
    const hooks = createCastHooks({ plans: createPlans(), follow: () => { asked += 1; } });
    const view = (at, length) => ({ state: { domains: { cast: { people: {}, notes: { cn_00000001: { at, kind: 'met' } }, day: null, meeting: null } } }, chat: { length }, feature: () => true, settings: () => ({}) });
    hooks.afterReceive(view(4, 5));
    assert.equal(asked, 1, 'the note is for the reply that just landed (index 4 of 5 messages)');
    hooks.afterReceive(view(2, 5));
    assert.equal(asked, 1, 'a note for an earlier reply: nothing');
    hooks.afterReceive({ ...view(4, 5), feature: () => false });
    assert.equal(asked, 1, 'off');
    hooks.afterReceive({ state: { domains: {} }, chat: { length: 5 }, feature: () => true, settings: () => ({}) });
    assert.equal(asked, 1, 'an older chat');
});
