// The v1 glue (index.v1.js) stays off a Story Block v2 host. It used to take the v2 host for a v1
// one and failed on the first reply with "sb.blockInText is not a function": v2 has no
// blockInText, registerBlock or onReply on its API. index.js is the only entry the manifest loads.
import test from 'node:test';
import assert from 'node:assert/strict';

const reached = [];
const v1Only = name => (...args) => {
    reached.push([name, args]);
    throw new TypeError(`${name} is a v1 call and must not reach a v2 host`);
};

globalThis.SillyTavern = {
    getContext: () => ({
        chat: [], chatMetadata: {}, extensionSettings: {}, chatId: 'v2-host',
        eventTypes: { CHAT_CHANGED: 'chat', MESSAGE_RECEIVED: 'reply' },
        eventSource: { on() {} },
    }),
};
// A v2 host as index.js sees it: apiVersion 2, no v1 methods.
globalThis.StoryBlock = Object.freeze({
    apiVersion: 2,
    version: '2.0.0-beta.2',
    ready: new Promise(() => {}),
    sdk: Object.freeze({ registerBlock: v1Only('registerBlock'), registerTab: v1Only('registerTab'), onReply: v1Only('onReply') }),
});

await import('../index.v1.js');
// init() waits on nothing in a v2 host, but give any stray timer or microtask a turn to run.
await new Promise(resolve => setTimeout(resolve, 20));

test('v1 glue registers nothing with a Story Block v2 host', () => {
    assert.deepEqual(reached, []);
});
