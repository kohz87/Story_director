// Story Director v2: the module definition (MODULES §A, §C). The parts (tracker, quests) are
// merged here into the one `sdk.registerModule` definition of module `story-director`:
//
// - domains, commands, queries: the parts' own, each name owned by one part (a clash throws);
// - capture: every part's kinds with their one-line grammar; `apply` dispatches by `line.kind`
//   to the part that owns the kind;
// - context: statics joined in part order (the same bytes every reply), tails concatenated in
//   part order, budgets summed;
// - hooks: every part's function of a name, called in part order;
// - settings: each part's keys are namespaced under its part id (`tracker.dormantReplies`), a
//   `group` field is flattened into dotted keys (`tracker.calendar.months`) because the Story
//   Suite overlay shows flat fields. A part reads its own settings back as it wrote them: the
//   ctx, view and api handed to it have `settings()` → that part's values, un-namespaced;
// - tabs: the parts' tabs in part order.
// Parts never import each other; they talk through commands and queries (ctx.call, ctx.query).

import { part as tracker } from './tracker/index.js';
import { part as quests } from './quests/index.js';

export const MODULE_ID = 'story-director';
export const MODULE_NAME = 'Story Director';
export const VERSION = '2.0.0-alpha.1';

/** The parts in their fixed order: [id, part]. The order is the static prompt's order. */
export const PARTS = Object.freeze([['tracker', tracker], ['quests', quests]]);

const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

// ---- settings --------------------------------------------------------------------------------

/** A schema field as the overlay knows it: `choices` is `options`. */
function overlayField(field) {
    if (!isObject(field)) return field;
    const { choices, ...rest } = field;
    return field.type === 'choice' && rest.options === undefined && Array.isArray(choices) ? { ...rest, options: choices } : rest;
}

/**
 * One part's settings, namespaced: `{ defaults, schema }` with keys `<ns>.<key>` and a group's
 * fields `<ns>.<group>.<field>` (labels "Group: Field"). Defaults of a group that the schema has
 * no field for (v1 calendar details) are kept under the same dotted keys.
 */
export function namespaced(ns, settings = {}) {
    const defaults = {};
    const schema = {};
    const groups = new Set();
    for (const [key, field] of Object.entries(settings.schema ?? {})) {
        if (isObject(field) && field.type === 'group') {
            groups.add(key);
            for (const [sub, inner] of Object.entries(field.fields ?? {})) {
                const label = [field.label, inner?.label].filter(Boolean).join(': ');
                schema[`${ns}.${key}.${sub}`] = overlayField(label ? { ...inner, label } : inner);
            }
        } else schema[`${ns}.${key}`] = overlayField(field);
    }
    for (const [key, value] of Object.entries(settings.defaults ?? {})) {
        if (groups.has(key) && isObject(value)) for (const [sub, inner] of Object.entries(value)) defaults[`${ns}.${key}.${sub}`] = structuredClone(inner);
        else defaults[`${ns}.${key}`] = structuredClone(value);
    }
    return { defaults, schema };
}

/** A part's own settings out of the module's (namespaced) values: dotted keys made nested again. */
export function partSettings(ns, values) {
    const out = {};
    const prefix = `${ns}.`;
    for (const [key, value] of Object.entries(isObject(values) ? values : {})) {
        if (!key.startsWith(prefix)) continue;
        const path = key.slice(prefix.length).split('.');
        let at = out;
        for (const name of path.slice(0, -1)) {
            if (!isObject(at[name])) at[name] = {};
            at = at[name];
        }
        at[path.at(-1)] = structuredClone(value);
    }
    return out;
}

// `settings(id?)` for a part: no id (or this module's) → the part's values; another id → as given.
function settingsFor(ns, base) {
    return (id) => {
        if (id !== undefined && id !== null && id !== MODULE_ID) return typeof base === 'function' ? base(id) : {};
        const values = typeof base === 'function' ? base(MODULE_ID) : base;
        return partSettings(ns, values);
    };
}

// The handler ctx a part sees: the host's, with settings() reading the part's own.
function partCtx(ns, ctx) {
    return Object.freeze({ ...ctx, settings: settingsFor(ns, id => ctx.settings(id)) });
}

// The view a part's tail, tab or hook sees: the host's, with settings() reading the part's own.
function partView(ns, view) {
    if (!isObject(view)) return view;
    const base = typeof view.settings === 'function'
        ? id => view.settings(id)
        : id => (id === undefined || id === null || id === MODULE_ID ? view.settings : {});
    return Object.freeze({ ...view, settings: settingsFor(ns, base) });
}

// ---- merging ---------------------------------------------------------------------------------

function own(table, name, ns, what) {
    if (Object.hasOwn(table, name)) throw new Error(`Story Director: ${what} "${name}" is in two parts (${table[name]} and ${ns}).`);
    table[name] = ns;
}

const linesOf = value => (Array.isArray(value) ? value.filter(line => typeof line === 'string') : []);

// Several parts' functions under one hook name, called in part order. beforeGenerate answers
// (string[] | { lines, commands }) are joined; canGenerate gives the first refusal; any other
// hook gives the last answer that is not undefined.
function mergeHook(name, entries) {
    if (entries.length === 1) {
        const [[ns, fn]] = entries;
        return (view, ...rest) => fn(partView(ns, view), ...rest);
    }
    return async (view, ...rest) => {
        if (name === 'beforeGenerate') {
            const lines = [];
            const commands = [];
            for (const [ns, fn] of entries) {
                const out = await fn(partView(ns, view), ...rest);
                lines.push(...linesOf(Array.isArray(out) ? out : out?.lines));
                if (Array.isArray(out?.commands)) commands.push(...out.commands);
            }
            return { lines, commands };
        }
        let answer;
        for (const [ns, fn] of entries) {
            const out = await fn(partView(ns, view), ...rest);
            if (name === 'canGenerate' && (out === false || (isObject(out) && out.ok === false))) return out;
            if (out !== undefined) answer = out;
        }
        return answer;
    };
}

/**
 * The module definition for `sdk.registerModule` (SPEC §6) from `parts` ([id, part], in order;
 * default: tracker, quests).
 */
export function createModule({ parts = PARTS } = {}) {
    const owners = { domain: {}, command: {}, query: {}, kind: {}, tab: {} };
    const domains = {};
    const commands = {};
    const queries = {};
    const kinds = {};
    const appliers = {};
    const hooks = {};
    const tabs = [];
    const defaults = {};
    const schema = {};
    const statics = [];
    const tails = [];
    let budget = 0;

    for (const [ns, part] of parts) {
        for (const [name, domain] of Object.entries(part.domains ?? {})) {
            own(owners.domain, name, ns, 'the domain');
            domains[name] = domain;
        }
        for (const [type, handler] of Object.entries(part.commands ?? {})) {
            own(owners.command, type, ns, 'the command');
            commands[type] = (ctx, payload) => handler(partCtx(ns, ctx), payload);
        }
        for (const [name, query] of Object.entries(part.queries ?? {})) {
            own(owners.query, name, ns, 'the query');
            queries[name] = query;
        }
        for (const [kind, spec] of Object.entries(part.kinds ?? {})) {
            own(owners.kind, kind, ns, 'the change-line kind');
            kinds[kind] = { grammar: spec.grammar, ...(spec.aliases ? { aliases: spec.aliases } : {}) };
            appliers[kind] = (ctx, line) => spec.apply(partCtx(ns, ctx), line);
            for (const alias of spec.aliases ?? []) appliers[alias] = appliers[kind];
        }
        if (typeof part.context?.static === 'function') statics.push(part.context.static);
        if (typeof part.context?.tail === 'function') tails.push([ns, part.context.tail]);
        if (Number.isInteger(part.context?.budget) && part.context.budget > 0) budget += part.context.budget;
        for (const [name, fn] of Object.entries(part.hooks ?? {})) {
            if (typeof fn !== 'function') continue;
            (hooks[name] ??= []).push([ns, fn]);
        }
        if (part.settings) {
            const named = namespaced(ns, part.settings);
            Object.assign(defaults, named.defaults);
            Object.assign(schema, named.schema);
        }
        for (const tab of part.tabs ?? []) {
            own(owners.tab, tab.id, ns, 'the tab');
            tabs.push({ ...tab, render: (el, view, api) => tab.render(el, partView(ns, view), api) });
        }
    }

    const def = {
        id: MODULE_ID,
        name: MODULE_NAME,
        version: VERSION,
        domains,
        commands,
        queries,
        context: {
            // The same bytes every reply: each part's static is fixed text.
            static: () => statics.map(fn => String(fn() ?? '').trim()).filter(Boolean).join('\n'),
            tail(view) {
                const lines = [];
                const optional = [];
                for (const [ns, tail] of tails) {
                    const out = tail(partView(ns, view)) ?? {};
                    lines.push(...linesOf(out.lines));
                    optional.push(...linesOf(out.optional));
                }
                return { lines, optional };
            },
            budget: budget || 1,
        },
        hooks: Object.fromEntries(Object.entries(hooks).map(([name, entries]) => [name, mergeHook(name, entries)])),
        settings: { defaults, schema },
        tabs,
    };
    if (Object.keys(kinds).length) {
        def.capture = {
            kinds,
            apply(ctx, line) {
                const apply = appliers[line?.kind] ?? appliers[String(line?.word ?? '').toLowerCase()];
                if (!apply) return ctx.fail('INVALID', `Story Director does not keep "${line?.kind}" lines.`);
                return apply(ctx, line);
            },
        };
    }
    return def;
}

/** The module, built once. */
export const storyDirectorModule = createModule();
