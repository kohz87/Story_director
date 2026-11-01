// The living cast tests: a real Story Block host (the testkit) with Story Director, the packs' cast stood in for (Story Block's
// `packs.content({ kind: 'cast' })` is answered from `source`), and a scripted model for the planner.
import { createHost } from '../../vendor/story-block/testkit/index.js';
import { createFakeModel } from '../../vendor/story-block/testkit/model.js';
import { createModule } from '../../../src/v2/module.js';
import { castPlans } from '../../../src/v2/cast/index.js';

export const STATIC_KEY = 'story_suite_static';
export const TAIL_KEY = 'story_suite_tail_1';
export const sent = (host, key) => host.st.promptLog.filter(entry => entry.key === key && entry.value).map(entry => entry.value);
export const said = (text, lines = []) => (lines.length ? `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>` : text);
export const OPENING = ['~ time June 3, 1200, 08:00 am', '~ place Harrow | kind: settlement'];

/** A pack's cast entry as Story Block lists it (`pack` and `packVersion` added by the packs). */
export function entry(id, more = {}, { pack = 'ersveil', packVersion = '1.1.0' } = {}) {
    return {
        pack, packVersion, id, name: id[0].toUpperCase() + id.slice(1), about: `${id} is somebody.`, look: 'weathered', voice: 'low', personality: 'wary',
        start: { place: 'Harrow', goal: `${id} wants something`, routine: 'is about' }, drawnTo: [], secrets: [{ title: 'Hidden thing', text: 'Never said.', meter: 'trust', at: 60 }],
        ...more,
    };
}

/** The cast the test packs list, changed between replies as a test needs: `source.entries`, `source.packs` (`packs.list`). */
export function castSource(entries = [], { name = 'Ersveil', version = '1.1.0' } = {}) {
    return { entries, packs: [{ id: 'ersveil', name, version, enabled: true }] };
}

/**
 * A host with Story Director, a scripted planner (`model`) and the cast from `source`. `queries`: more queries a test module answers
 * (a fight, for example). `settings`: Story Director's (dotted keys).
 */
export async function castHost({ source = castSource(), model = createFakeModel([]), settings = {}, features = {}, queries = {}, extra = [], parts = undefined } = {}) {
    castPlans.clear();
    let host = null;
    const module = createModule({
        ...(parts ? { parts } : {}),
        host: { settings: id => host?.sdk.settings(id) ?? null, substitute: text => host?.sdk.substitute(text), callModel: request => host.sdk.callModel(request), chat: () => host.ctx.chat },
    });
    const stub = Object.keys(queries).length ? [{ id: 'cast-test-stub', name: 'Test stand-in', version: '0.0.0-test', domains: {}, commands: {}, queries }] : [];
    host = await createHost({ modules: [...stub, ...extra, module], callModel: model, settings: { modules: { 'story-director': settings }, features } });
    // Story Block's own packs part does not know the cast kind yet in the vendored copy: answer it here, the rest as it is.
    const real = host.registry.query.bind(host.registry);
    host.registry.query = name => {
        if (name === 'packs.content') {
            const fn = real(name);
            return (state, args, tools) => (args?.kind === 'cast' ? structuredClone(source.entries) : fn?.(state, args, tools));
        }
        if (name === 'packs.list') return () => structuredClone(source.packs);
        return real(name);
    };
    host.source = source;
    host.model = model;
    return host;
}

/** Lets the planner's background call finish (it is asked after a reply, used before the next). */
export const settle = () => castPlans.idle();

/** `host.head().domains.cast`, as plain JSON. */
export const slice = host => structuredClone(host.head().domains.cast);
export const people = host => slice(host).people;

export const receipts = (host, type) => host.sdk.receipts().filter(item => item.receipt.type === type);

/** The Cast cue of the tail the last generation was sent, or ''. */
export const castCue = host => (sent(host, TAIL_KEY).at(-1) ?? '').split('\n').filter(line => line.startsWith('[Cast]')).join('\n');

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

export { createFakeModel };
