// Key people tests: a real Story Block host (the testkit) with Story Director, and small stand-ins for NPC State Delta.
import { createHost } from '../../vendor/story-block/testkit/index.js';
import { createModule } from '../../../src/v2/module.js';

export const STATIC_KEY = 'story_suite_static';
export const TAIL_KEY = 'story_suite_tail_1';
export const sent = (host, key) => host.st.promptLog.filter(entry => entry.key === key && entry.value).map(entry => entry.value);
export const said = (text, lines = []) => (lines.length ? `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>` : text);
export const OPENING = ['~ time June 3, 1200, 08:00 am', '~ place Harrow | kind: settlement'];

/** The Key people block of the tail the last generation was sent (the header and its away lines), or ''. */
export function keyTail(host) {
    const lines = (sent(host, TAIL_KEY).at(-1) ?? '').split('\n');
    const at = lines.findIndex(line => line.startsWith('[Key people]'));
    if (at < 0) return '';
    const block = [lines[at]];
    for (const line of lines.slice(at + 1)) {
        if (!/^[^:\[]+: away/.test(line)) break;
        block.push(line);
    }
    return block.join('\n');
}

/**
 * NPC State Delta's queries as a test module: `people` is `{ name: { aliases?, lifeState?, role? } }`, those it tracks that are not
 * archived (`npc.known`); `npc.dossier` finds them by name or alias. `people` may change between replies.
 */
export function fakeDelta(people = {}) {
    const find = name => {
        const want = String(name ?? '').toLowerCase();
        return Object.keys(people).find(key => key.toLowerCase() === want || (people[key]?.aliases ?? []).some(alias => alias.toLowerCase() === want)) ?? null;
    };
    return {
        id: 'npc-state-delta',
        name: 'NPC State Delta (test stand-in)',
        version: '0.0.0-test',
        domains: {},
        commands: {},
        queries: {
            'npc.known': () => Object.keys(people),
            'npc.present': () => [],
            'npc.dossier': (_state, { name } = {}) => (find(name) ? { name: find(name), aliases: people[find(name)].aliases ?? [], role: people[find(name)].role ?? '', lifeState: people[find(name)].lifeState ?? 'alive' } : null),
            'npc.meters': () => null,
        },
    };
}

/** A host with Story Director (and a Delta stand-in when `delta` is given); `settings`: Story Director's (dotted keys). */
export async function keyHost({ delta = null, settings = {}, features = {}, extra = [] } = {}) {
    let host = null;
    const module = createModule({ host: { settings: id => host?.sdk.settings(id) ?? null, substitute: text => host?.sdk.substitute(text) } });
    host = await createHost({ modules: [...(delta ? [fakeDelta(delta)] : []), module, ...extra], settings: { modules: { 'story-director': settings }, features } });
    return host;
}

/** `host.head().domains.keypeople`, as plain JSON. */
export const slice = host => structuredClone(host.head().domains.keypeople);

export const pin = (host, name, more = {}) => host.sdk.command('keypeople.pin', { name, ...more });
export const unpin = (host, name) => host.sdk.command('keypeople.unpin', { name });

/** The validators of every domain on the head state: [] when all hold. */
export function validatorErrors(host) {
    const state = host.head();
    const out = [];
    for (const name of Object.keys(state.domains)) {
        const validate = host.registry.validator(name);
        if (typeof validate === 'function') out.push(...(validate(state.domains[name], state) ?? []).map(error => `${name}: ${error}`));
    }
    return out;
}
