// B-b7-combos-9 (v1 / `main`, 0.9.46): Story Director v1 on a page whose Story Block is v2.
// storyBlock() accepts any `apiVersion >= 1` (MIN_STORY_BLOCK_API), so the v2 global
// ({ apiVersion: 2, version: '2.0.0-alpha.1', ready, sdk }) is taken for a v1 host: its setup calls
// sb.registerBlock (TypeError, an unhandled rejection / page error) and every reply logs
// "[Story Director] note failed TypeError: sb.blockInText is not a function" (seen live, M1/M3).
// The reader is told nothing. (B-b7-combos-9)

import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './ui-fake-dom.js';

const doc = installFakeDom();
const drawer = doc.createElement('div');
drawer.id = 'extensions_settings';
doc.body.appendChild(drawer);

const sdk = Object.freeze({ apiVersion: 2, registerModule: async () => sdk, modules: () => [] });
globalThis.StoryBlock = Object.freeze({ apiVersion: 2, version: '2.0.0-alpha.1', ready: Promise.resolve(sdk), sdk });
globalThis.toastr = Object.fromEntries(['info', 'success', 'warning', 'error'].map(level => [level, () => null]));
const ctx = {
    chat: [], chatMetadata: {}, chatId: 'chat-0', extensionSettings: {}, name1: 'Ren', name2: 'Narrator',
    getCurrentChatId: () => ctx.chatId, saveMetadataDebounced: () => {}, saveMetadata: async () => {},
    saveSettingsDebounced: () => {}, setExtensionPrompt: () => {}, eventSource: { on: () => {} }, event_types: {},
};
globalThis.SillyTavern = { getContext: () => ctx };

test('Story Director v1 does not take Story Block v2 for a v1 host (no error on load)', async () => {
    const failures = [];
    const onFailure = error => failures.push(String(error?.message ?? error));
    process.on('unhandledRejection', onFailure);
    process.on('uncaughtException', onFailure);
    const errors = [];
    const consoleError = console.error;
    console.error = (...args) => errors.push(args.map(arg => String(arg?.message ?? arg)).join(' '));
    try {
        await import('../index.js');
        for (let round = 0; round < 20; round += 1) await new Promise(resolve => setTimeout(resolve, 25));
    } finally {
        console.error = consoleError;
        process.off('unhandledRejection', onFailure);
        process.off('uncaughtException', onFailure);
    }
    assert.deepEqual([...failures, ...errors.filter(text => /is not a function/.test(text))], [], 'v1 calls the v1 API on the v2 global');
});

// The module keeps timers running once it is set up; end the process when the test is done.
test.after(() => setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref?.());
