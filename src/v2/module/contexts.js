// Story Director v2: the ctx, view and tools handed to each part.

import { MODULE_ID } from './parts.js';
import { partSettings, settingsFor } from './settings.js';
import { BUILD_QUERIES, isObject } from './shared.js';

// The handler ctx a part sees: the host's, with settings() reading the part's own, and `fights`
// (whether a module runs fights, see fightRunner).
export function partCtx(ns, ctx, shared) {
    const own = shared(ns);
    return Object.freeze({ ...ctx, fights: own.env.fights, settings: settingsFor(ns, id => ctx.settings(id), { ...own, query: ctx.query }) });
}

// The view a part's tail, tab or hook sees: the host's, with settings() reading the part's own.
export function partView(ns, view, shared) {
    if (!isObject(view)) return view;
    const base = typeof view.settings === 'function'
        ? id => view.settings(id)
        : id => (id === undefined || id === null || id === MODULE_ID ? view.settings : {});
    const own = shared(ns);
    return Object.freeze({
        ...view, fights: own.env.fights, settings: settingsFor(ns, base, { ...own, query: view.query }),
        // `model.callModel(request)` and `model.chat()`: the host's model call and the chat's messages, for a part that asks a model about the
        // story (the cast's planner); absent where there is no model call.
        ...(own.model ? { model: own.model } : {}),
        // `story.chat()`: the chat's messages, with or without a model call (the cast reads the reply it brought a person into).
        story: own.story,
    });
}

// A view whose `query` answers a question asked again, with the same arguments, from what it answered the first time. For one
// prompt build only (the tail): the state, the settings and the packs cannot change while it runs, so every part and `learn` ask the
// same of the same, and the work (the atlas's world, the scene) is done once. An answer that threw is not kept.
export function memoQueries(view) {
    if (!isObject(view) || typeof view.query !== 'function') return view;
    const answers = new Map();
    const query = (name, args) => {
        let key;
        try { key = `${name}\u0000${JSON.stringify(args) ?? ''}`; } catch { return view.query(name, args); }
        if (answers.has(key)) return answers.get(key);
        const value = view.query(name, args);
        answers.set(key, value);
        return value;
    };
    BUILD_QUERIES.add(query);
    return Object.freeze({ ...view, query });
}

// The tools a part's query sees: the host's (`query`, `receipts`, …) plus settings(), substitute() and feature(id).
export function partTools(ns, tools, shared, host) {
    const base = typeof tools === 'function' ? { query: tools } : isObject(tools) ? tools : {};
    const settings = typeof base.settings === 'function' ? id => base.settings(id) : id => host.settings(id);
    const substitute = typeof base.substitute === 'function' ? base.substitute : host.substitute;
    const feature = typeof base.feature === 'function' ? base.feature : host.feature;
    return Object.freeze({
        ...base,
        ...(typeof feature === 'function' ? { feature: id => feature(id) } : {}),
        settings: settingsFor(ns, settings, { ...shared(ns), query: base.query ?? null }),
        substitute: text => {
            let out;
            try { out = substitute?.(text); } catch { out = undefined; }
            return typeof out === 'string' ? out : String(text ?? '');
        },
    });
}

// Queries whose args take a part setting when the caller leaves it out: { query: { arg: setting } }.
const SETTING_ARGS = {
    'atlas.routes': { map: 'map' },
    'atlas.travel': { map: 'map' },
};

export function withSettingArgs(name, args, tools) {
    const fill = SETTING_ARGS[name];
    if (!fill) return args;
    const out = isObject(args) ? { ...args } : {};
    let settings = null;
    for (const [arg, key] of Object.entries(fill)) {
        if (out[arg] !== undefined && out[arg] !== null) continue;
        settings ??= tools.settings();
        if (settings[key] !== undefined) out[arg] = settings[key];
    }
    return out;
}
