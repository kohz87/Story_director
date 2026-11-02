// The cast leaves the page alone: keeping the newest reply's card in view is Story Block's (its card mount), so a reply with a cast note
// for it touches neither the chat element nor a timer.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createCastHooks } from '../../../src/v2/cast/hooks.js';
import { createPlans } from '../../../src/v2/cast/plan.js';

test('a reply with a cast note for it: afterReceive does not look at the page or set a timer', () => {
    const touched = [];
    const realDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    const realTimeout = globalThis.setTimeout;
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { querySelector: selector => { touched.push(selector); return null; } } });
    globalThis.setTimeout = (...args) => { touched.push('timer'); return realTimeout(...args); };
    try {
        const hooks = createCastHooks({ plans: createPlans() });
        const view = { state: { domains: { cast: { people: {}, notes: { cn_00000001: { at: 4, kind: 'met' } }, day: null, meeting: null } } }, chat: { length: 5 }, feature: () => true, settings: () => ({}) };
        assert.equal(hooks.afterReceive(view), undefined);
        assert.deepEqual(touched, []);
    } finally {
        globalThis.setTimeout = realTimeout;
        if (realDocument) Object.defineProperty(globalThis, 'document', realDocument);
        else delete globalThis.document;
    }
});
