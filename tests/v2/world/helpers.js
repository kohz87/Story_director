// World part tests: a real Story Block host (the testkit) with Story Director, and small stand-ins for
// NPC State Delta (its queries `npc.known`, `npc.dossier`, `npc.meters`) and RPG Battle.
import { createHost } from '../../vendor/story-block/testkit/index.js';
import { withD1 } from '../helpers/d1.js';
import { createModule } from '../../../src/v2/module.js';
import { fakeRpgBattle } from '../integration/helpers/fake-rpg.js';
import { worldScreen } from '../../../src/v2/world/index.js';
import { compileTemplate, renderTemplate } from '../../vendor/story-block/src/v2/view/template/index.js';
import { conditionEvaluator } from '../../vendor/story-block/src/v2/view/bind.js';
import { compile, evaluate } from '../../vendor/story-block/src/v2/events/index.js';
import { installFakeDom } from '../../ui-fake-dom.js';

export const said = (text, lines = []) => (lines.length ? `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>` : text);
export const squash = text => String(text ?? '').replace(/\s+/g, ' ').trim();

/**
 * NPC State Delta's queries as a test module: dossiers for `people` ({ name: { rank?, disposition?, stages?,
 * aliases? } }), found by name or alias, any case (as Delta's npc.dossier). `people` may change later (a scan).
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
            'npc.dossier': (_state, { name } = {}) => (find(name) ? { name: find(name) } : null),
            'npc.meters': (_state, { name } = {}) => (find(name) ? { key: find(name), name: find(name), meters: {}, stages: {}, ...people[find(name)] } : null),
        },
    };
}

/** A host with Story Director (and `rpg` / `delta` stand-ins); `settings`: Story Director's. */
export async function worldHost({ rpg = false, delta = null, settings = {}, extra = [], features = {} } = {}) {
    let host = null;
    const module = withD1(createModule({ host: { settings: id => host?.sdk.settings(id) ?? null, substitute: text => host?.sdk.substitute(text) } }));
    host = await createHost({
        modules: [...(rpg ? [fakeRpgBattle()] : []), ...(delta ? [fakeDelta(delta)] : []), module, ...extra],
        settings: { modules: { 'story-director': settings }, features },
    });
    return host;
}

/** Draws the World screen with `q` (its data), `draft` and widgets; → { el, view, warnings, set(draft) }. */
export function drawWorld(q, { draft = {}, widgets = {}, screen = worldScreen } = {}) {
    const doc = installFakeDom();
    doc.head = doc.createElement('head');
    const el = doc.createElement('div');
    el.setAttribute('data-ss-screen', screen.id);
    doc.body.appendChild(el);
    const compiled = compileTemplate(screen.template);
    const warnings = [...compiled.warnings];
    const own = { ...draft };
    const scopeOf = () => ({ state: {}, q, draft: own, settings: {}, mount: 'tab', screenId: screen.id, api: {} });
    const view = renderTemplate(el, compiled, scopeOf(), {
        evaluate: conditionEvaluator({ compile, evaluate }),
        widgets,
        onWarn: message => warnings.push(message),
    });
    return { el, view, warnings, doc, set: next => { Object.assign(own, next); view.update(scopeOf()); } };
}

/** The World screen's data as the host answers it. */
export const worldData = host => ({ world: host.sdk.query('director.world'), journal: host.sdk.query('director.journal') });
