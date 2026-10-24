// Story Director v2: SillyTavern entry point.
//
// v2 Story Director is a module of Story Block v2 (docs/v2/SPEC.md on Story Block's main branch):
// Story Block keeps the state, reads the replies' <Changes> blocks, builds the prompt and hosts
// the tabs and settings; this file only registers module `story-director` (src/v2/module.js)
// once `globalThis.StoryBlock.ready` resolves. Without a v2 host it shows one line in the
// extensions drawer saying Story Block v2 is needed, and does nothing else.
//
// The v1 glue (index.v1.js and the v1 parts of src/) stays in the repository for its pure rules,
// which v2 reuses, but is not loaded.

import { MODULE_ID, MODULE_NAME, VERSION, storyDirectorModule } from './src/v2/module.js';
import { arcController } from './src/v2/arc/index.js';

export const NEEDS_HOST = 'Story Director 2 needs Story Block v2: install or update Story Block, then reload.';
const NOTICE_ID = 'story_director_needs_host';
const WAIT_MS = 250;
const WAIT_TRIES = 40;   // ten seconds for Story Block to come up

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

/** The v2 host when it is there: `globalThis.StoryBlock` with apiVersion 2 and `ready`, else null. */
export function v2Host(root = globalThis) {
    const host = root?.StoryBlock;
    return host && host.apiVersion === 2 && host.ready && typeof host.ready.then === 'function' ? host : null;
}

/** The one-line notice in the extensions drawer (once). Returns whether it is shown. */
export function showNeedsHost(doc = globalThis.document) {
    if (!doc?.getElementById) return false;
    if (doc.getElementById(NOTICE_ID)) return true;
    const drawer = doc.getElementById('extensions_settings2') ?? doc.getElementById('extensions_settings');
    if (!drawer) return false;
    const line = doc.createElement('div');
    line.id = NOTICE_ID;
    line.className = 'story-director-needs-host';
    line.textContent = NEEDS_HOST;
    drawer.appendChild(line);
    return true;
}

/**
 * Waits for Story Block v2 and registers the module. `deps` (tests): { root, doc, wait, tries,
 * module }. Resolves to { registered: true, sdk } or { registered: false, reason }.
 */
export async function start({ root = globalThis, doc = globalThis.document, wait = pause, tries = WAIT_TRIES, module = storyDirectorModule } = {}) {
    let host = v2Host(root);
    for (let n = 0; !host && n < tries; n += 1) {
        await wait(WAIT_MS);
        host = v2Host(root);
    }
    if (!host) {
        // The drawer may not be there yet either; keep trying for a while.
        for (let n = 0; !showNeedsHost(doc) && n < tries; n += 1) await wait(WAIT_MS);
        return { registered: false, reason: NEEDS_HOST };
    }
    const sdk = await host.ready;
    if (sdk.modules?.().some(entry => entry.id === MODULE_ID)) return { registered: true, sdk };
    try {
        await sdk.registerModule(module);
    } catch (error) {
        console.error(`[${MODULE_NAME}] could not register with Story Block:`, error);
        return { registered: false, reason: error?.message ?? String(error) };
    }
    // Arc planning by itself (setting arc.trigger: auto) looks after every reply.
    try { sdk.on?.('turn', turn => { void arcController().onTurn(turn).catch(error => console.warn(`[${MODULE_NAME}] arc planning:`, error?.message ?? error)); }); } catch { /* an older host */ }
    console.info(`[${MODULE_NAME}] v${VERSION} registered with Story Block v2.`);
    return { registered: true, sdk };
}

// SillyTavern loads this file as a module; tests import it with globalThis.STORY_DIRECTOR_NO_START.
if (!globalThis.STORY_DIRECTOR_NO_START) void start();
