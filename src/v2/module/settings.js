// Story Director v2: namespaced settings and what each part reads.

import { calendarConfig, packCalendarOf } from '../tracker/time.js';
import { MODULE_ID } from './parts.js';
import { isObject } from './shared.js';

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

// A setting handed to another part through `reads`, as the chat uses it: the tracker's calendar
// setting becomes the chat's calendar (its `pack` preset resolved against the packs' calendar).
const READ_AS_USED = {
    'tracker.calendar': (value, query) => calendarConfig({ calendar: value ?? null }, packCalendarOf(query)),
};

/** A part's `reads` as [key, part id, path inside that part's settings, what the path names]. */
export function readsOf(settings) {
    const reads = isObject(settings?.reads) ? settings.reads : {};
    return Object.entries(reads).filter(([, path]) => typeof path === 'string' && path.includes('.'))
        .map(([key, path]) => {
            const [from, ...rest] = path.split('.');
            return [key, from, rest, path];
        });
}

// `settings(id?)` for a part: no id (or this module's) → the part's values (its defaults under the
// module's values, then what it reads from other parts); another id → as given. `query` resolves
// settings read as the chat uses them.
export function settingsFor(ns, base, { defaults = {}, reads = [], query = null } = {}) {
    return (id) => {
        if (id !== undefined && id !== null && id !== MODULE_ID) return (typeof base === 'function' ? base(id) : null) ?? {};
        const given = typeof base === 'function' ? base(MODULE_ID) : base;
        const values = { ...defaults, ...(isObject(given) ? given : {}) };
        const own = partSettings(ns, values);
        for (const [key, from, path, name] of reads) {
            if (own[key] !== undefined) continue;
            let value = partSettings(from, values);
            for (const step of path) value = isObject(value) ? value[step] : undefined;
            if (READ_AS_USED[name]) value = READ_AS_USED[name](value, query);
            if (value !== undefined) own[key] = value;
        }
        return own;
    };
}
