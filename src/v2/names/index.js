// Story Director v2, part **names**: the names' core (pure: the name key and the titles a name is compared by, the banned and
// overused names, the collision check, the deterministic suggestion pick from a pack's `names` lists, the one-line profile of
// a minor person) and the part built on it (feature `story-director.names`, on by default like the pulse; domain `names`).
//
// * Kind `person`: `+ person Name | look: … | flaw: … | voice: … | temper: …`, written once when a named person first appears. The
//   name is checked against the names in use (`people`: declared before; `seen`: the scene, the whole cast incl. unmet people,
//   NPC State Delta's dossiers and the key people, stored by the step before each reply, so apply reads only its own domain)
//   and the banned lists (the setting's, the pack's, the built-in overused names). A refusal is a Problem on the reply card and a
//   cue pinned to the next reply to rename the person ("already used": never who by). A fine name is stored whole with its profile.
// * Tail (optional lines): the profile of up to 4 stored people who are in the scene or named in the last reply (≤160 characters
//   each), and 2-3 unused suggestions from the pack's names (query `packs.content { kind: 'names' }`; none without it).
// * Query `names.profile { name }` gives a stored profile (NPC State Delta seeds a dossier from it). Settings: banned names,
//   how many suggestions (3). Stored people: the newest 80. Nothing from prose; replay-safe (everything added whole under its key).
// tests/v2/integration/module.test.js and host.test.js hold the tests; tests/v2/break/fuzz-delete.test.js sends `person` lines.

import { lineKey } from '../../changes.js';
import { personMatches } from '../../tracker-words.js';
import { sha256 } from '../hash.js';

export const DEFAULT_SUGGESTIONS = 3;
export const MAX_SUGGESTIONS = 8;
export const MAX_BANNED = 200;
export const MAX_NAME = 80;
export const PROFILE_FIELDS = Object.freeze(['look', 'flaw', 'voice', 'temper']);
export const MAX_FIELD = 30;
export const MAX_PROFILE = 160;
export const MAX_MINOR = 80;

// The built-in list of given names the models reach for again and again (checked as the given name, any case).
export const OVERUSED = Object.freeze(['Elara', 'Vane', 'Vance', 'Seraphina', 'Kael']);

// Titles and rank words a name may open with ("Sister Temiwa", "Watch-Captain Roelof"): not part of the given name.
const TITLES = new Set([
    'sister', 'brother', 'father', 'mother', 'bailiff', 'factor', 'junior', 'senior', 'watch', 'captain', 'lord',
    'lady', 'duke', 'duchess', 'prince', 'princess', 'king', 'queen', 'master', 'mistress', 'dame', 'sir', 'madam',
    'mr', 'mrs', 'ms', 'dr', 'old', 'young', 'the', 'a', 'an',
]);
const MIN_EDIT_LENGTH = 4;

/** Text as one plain line: control and format characters out, spaces made one. */
const flat = value => (typeof value === 'string' || typeof value === 'number' ? String(value) : '')
    .replace(/[\p{Cc}\p{Cf}]+/gu, ' ').replace(/\s+/g, ' ').trim();

/** `value` flattened and cut to `max` code points (never inside a character), with an ellipsis when it was longer. */
export function cutPoints(value, max) {
    const chars = Array.from(flat(value));
    return chars.length <= max ? chars.join('') : `${chars.slice(0, Math.max(0, max - 1)).join('').trimEnd()}…`;
}

/** A name as it is kept: flat, cut to MAX_NAME code points. */
export const cleanName = value => cutPoints(value, MAX_NAME);

/** The identity of a name: `lineKey` (lower case, punctuation squashed) after accents are taken off ("Élara" is "elara"). '' for a name with no letters or digits. */
export const nameKey = value => lineKey(flat(value).normalize('NFD').replace(/\p{M}/gu, ''));

/** The key without its leading titles ("Sister Temiwa" → "temiwa"); a name that is only titles keeps them. */
export function bareKey(value) {
    const words = nameKey(value).split(' ').filter(Boolean);
    let i = 0;
    while (i < words.length - 1 && TITLES.has(words[i])) i++;
    return words.slice(i).join(' ');
}

/** The given name: the first word of the bare key ('' for no name). */
export const givenKey = value => bareKey(value).split(' ')[0] ?? '';

/** Two names are the same person's name: equal keys, or equal once their titles are dropped. */
export function sameName(left, right) {
    const a = nameKey(left);
    const b = nameKey(right);
    if (!a || !b) return false;
    return a === b || bareKey(left) === bareKey(right);
}

// Strings one edit apart (one insertion, deletion or substitution), or equal.
function withinOneEdit(a, b) {
    if (a === b) return true;
    const [short, long] = a.length <= b.length ? [a, b] : [b, a];
    if (long.length - short.length > 1) return false;
    let i = 0;
    while (i < short.length && short[i] === long[i]) i++;
    if (long.length === short.length) return short.slice(i + 1) === long.slice(i + 1);
    return short.slice(i) === long.slice(i + 1);
}

/** A list count clamped to 0..MAX_SUGGESTIONS; a value that is not a number takes DEFAULT_SUGGESTIONS. */
export function clampCount(value) {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n)) return DEFAULT_SUGGESTIONS;
    return Math.min(MAX_SUGGESTIONS, Math.max(0, n));
}

/**
 * The banned names from the setting's text: one name per line or per comma, flat, cut to MAX_NAME, duplicates (by key)
 * and empty entries dropped, at most MAX_BANNED. Pure; the setting is read by the caller.
 */
export function parseBanned(text) {
    const out = [];
    const seen = new Set();
    for (const raw of String(text ?? '').split(/[\n,]/)) {
        const name = cleanName(raw);
        const key = nameKey(name);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(name);
        if (out.length >= MAX_BANNED) break;
    }
    return out;
}

/**
 * The collision check of a name a reply brings in, against the names already known. `known` is an array of names or of
 * `{ name, by }` entries (`by` is a label the caller chooses; it is returned as given, so the caller decides what may
 * be said about an unmet person); `banned` is the setting's list (plus a pack's); `overused` the built-in list; `self` is
 * the person's own name, whose entry is skipped. Returns `{ ok, reasons }`, reasons in the order banned, overused, taken,
 * first, near, one per kind: `taken` (the same name), `first` (the same given name), `near` (a given name one edit away,
 * both four letters or more: "Bregja" for "Bregje").
 */
export function checkName(name, { known = [], banned = [], overused = OVERUSED, self = '' } = {}) {
    const cleaned = cleanName(name);
    const given = givenKey(cleaned);
    if (!nameKey(cleaned)) return { ok: false, reasons: [{ kind: 'empty' }] };
    const reasons = [];
    const add = (kind, by) => { if (!reasons.some(reason => reason.kind === kind)) reasons.push(by === undefined ? { kind } : { kind, by }); };

    for (const entry of banned) {
        const key = nameKey(entry);
        if (!key) continue;
        if (sameName(cleaned, entry) || (!key.includes(' ') && key === given)) { add('banned', cleanName(entry)); break; }
    }
    if (overused.some(word => nameKey(word) === given)) add('overused', given);

    const selfBare = nameKey(self) ? bareKey(self) : '';
    for (const entry of known) {
        const other = typeof entry === 'string' ? entry : entry?.name;
        const by = typeof entry === 'object' && entry?.by !== undefined ? String(entry.by) : undefined;
        if (!nameKey(other) || (selfBare && bareKey(other) === selfBare)) continue;
        const otherGiven = givenKey(other);
        if (sameName(cleaned, other)) add('taken', by);
        else if (given && otherGiven === given) add('first', by);
        else if (given.length >= MIN_EDIT_LENGTH && otherGiven.length >= MIN_EDIT_LENGTH && withinOneEdit(given, otherGiven)) add('near', by);
    }
    return { ok: reasons.length === 0, reasons };
}

// The culture whose `regions` name a part of the scene's region ("River Confederacy: Bluewatch" has "River Confederacy").
function cultureFor(names, region) {
    const here = flat(region).toLowerCase();
    if (!here) return null;
    for (const [key, culture] of Object.entries(names)) {
        if (key === 'banned' || !culture || typeof culture !== 'object' || Array.isArray(culture)) continue;
        const regions = Array.isArray(culture.regions) ? culture.regions : [];
        if (regions.some(region => { const want = flat(region).toLowerCase(); return want && here.includes(want); })) return culture;
    }
    return null;
}

/**
 * Up to `count` (0..MAX_SUGGESTIONS) unused names for a new person, from a pack's `names` lists: `names` is
 * `{ banned?: [...], <culture>: { regions: [...], given: [...] } }`, the culture picked by the scene's `region`. A name
 * is dropped when checkName refuses it against `used` (the names in use) and the banned lists. The rest are ranked by
 * sha256 of `seed` and the name's key, so the same seed (a reply's id and the chat's length) gives the same names on every
 * swipe and replay, whatever order the pack lists them in. No pack list, or no matching region: []. Pure.
 */
export function pickSuggestions({ names, region = '', used = [], banned = [], count = DEFAULT_SUGGESTIONS, seed = '' } = {}) {
    if (!names || typeof names !== 'object' || Array.isArray(names)) return [];
    const culture = cultureFor(names, region);
    if (!culture) return [];
    const max = clampCount(count);
    const ban = [...(Array.isArray(names.banned) ? names.banned : []), ...banned];
    const known = used.map(name => ({ name, by: 'used' }));
    const seen = new Set();
    const pool = [];
    for (const raw of Array.isArray(culture.given) ? culture.given : []) {
        const name = cleanName(raw);
        const key = nameKey(name);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        if (checkName(name, { known, banned: ban }).ok) pool.push({ name, rank: sha256(`${flat(seed)}|${key}`) });
    }
    pool.sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0));
    return pool.slice(0, max).map(entry => entry.name);
}

/**
 * A minor person's one-line profile from the text after the name: `look: … | flaw: … | voice: … | temper: …`, the labels
 * in any order; a segment with no label fills the first empty field in turn. Each field is flat and cut to MAX_FIELD
 * code points; segments beyond the four are counted in `extra`. Returns `{ profile, text, ok, extra }`, `ok` when any
 * field has text, `text` the stored line (profileText).
 */
export function parseProfile(value) {
    const profile = Object.fromEntries(PROFILE_FIELDS.map(field => [field, '']));
    const plain = [];
    for (const segment of flat(value).split('|').map(part => part.trim()).filter(Boolean)) {
        const match = /^(look|flaw|voice|temper)\s*:(.*)$/i.exec(segment);
        const field = match ? match[1].toLowerCase() : '';
        if (field && !profile[field]) profile[field] = cutPoints(match[2], MAX_FIELD);
        else if (!field) plain.push(segment);
    }
    for (const field of PROFILE_FIELDS) {
        if (!profile[field] && plain.length) profile[field] = cutPoints(plain.shift(), MAX_FIELD);
    }
    return { profile, text: profileText(profile), ok: PROFILE_FIELDS.some(field => profile[field] !== ''), extra: plain.length };
}

/**
 * The stored one-line profile: the four labelled fields joined by ` | ` (the grammar's own separator, so the line reads
 * back through parseProfile), each cut to MAX_FIELD code points, the whole cut to MAX_PROFILE. A field's `|` becomes `/`.
 */
export function profileText(profile) {
    const parts = PROFILE_FIELDS
        .map(field => [field, cutPoints(String(profile?.[field] ?? '').replace(/\|/g, '/'), MAX_FIELD)])
        .filter(([, text]) => text !== '')
        .map(([field, text]) => `${field}: ${text}`);
    return cutPoints(parts.join(' | '), MAX_PROFILE);
}

/**
 * The minor people kept under the cap: `people` is `{ key: { first, ... } }` where `first` is the reply the person first
 * appeared in. Over `max`, the oldest (lowest `first`, then key) are evicted. Returns `{ people, evicted }` with the
 * kept entries (a new object) and the evicted keys in eviction order. Pure.
 */
export function capMinor(people = {}, max = MAX_MINOR) {
    const keys = Object.keys(people ?? {});
    const over = keys.length - Math.max(0, Math.floor(Number(max)) || 0);
    const order = keys.slice().sort((a, b) => (Number(people[a]?.first) || 0) - (Number(people[b]?.first) || 0) || (a < b ? -1 : a > b ? 1 : 0));
    const evicted = over > 0 ? order.slice(0, over) : [];
    const gone = new Set(evicted);
    const kept = {};
    for (const key of keys) if (!gone.has(key)) kept[key] = people[key];
    return { people: kept, evicted };
}

// ---- the part -----------------------------------------------------------------------------------------------------------------
export const FEATURE = 'story-director.names';
const GRAMMAR = '+ person Name | look: … | flaw: … | voice: … | temper: … (once, when a named person first appears: a new name, never the player, a known or pack person)';
const MAX_SEEN = 200;
const MAX_TAKEN = 30;
const MAX_ALIASES = 12;
const MAX_TAIL_PROFILES = 4;
const TAIL_HEADER = 'Unused names (pick one for any new person):';

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isInt = value => Number.isSafeInteger(value);
const ask = (query, name, args = {}) => {
    try { return (typeof query === 'function' ? query(name, args) : null) ?? null; } catch { return null; }
};
const queryOf = source => (typeof source?.query === 'function' ? (name, args) => source.query(name, args) : null);
const settingsOf = source => {
    let values = null;
    try { values = typeof source?.settings === 'function' ? source.settings() : null; } catch { values = null; }
    return { banned: parseBanned(isRecord(values) ? values.banned : ''), count: clampCount(isRecord(values) && values.suggestions !== undefined ? values.suggestions : DEFAULT_SUGGESTIONS) };
};
const namesOf = list => (Array.isArray(list) ? list : []).map(entry => (typeof entry === 'string' ? entry : entry?.name)).filter(name => typeof name === 'string');

/** Whether the feature is on (`source.feature` when the host has it); unlike the older parts it is off when the host cannot say. */
export function namesOn(source) {
    try { return typeof source?.feature === 'function' && source.feature(FEATURE) === true; } catch { return false; }
}

/** The pack's `names` lists (`packs.content { kind: 'names' }`): the entries' cultures joined, their banned lists joined; null when none. */
export function packNames(query) {
    const out = { banned: [] };
    for (const item of [].concat(ask(query, 'packs.content', { kind: 'names' }) ?? [])) {
        const names = isRecord(item?.names) ? item.names : item;
        if (!isRecord(names)) continue;
        for (const [key, value] of Object.entries(names)) {
            if (key === 'banned' && Array.isArray(value)) out.banned.push(...value);
            else if (key !== 'banned' && isRecord(value) && !Object.hasOwn(out, key)) out[key] = value;
        }
    }
    return Object.keys(out).length > 1 || out.banned.length ? out : null;
}

export const initialNames = () => ({ people: {}, seen: {}, taken: {} });
const tables = slice => ({ people: isRecord(slice?.people) ? slice.people : {}, seen: isRecord(slice?.seen) ? slice.seen : {}, taken: isRecord(slice?.taken) ? slice.taken : {} });
const identityKey = entry => `@${sha256(JSON.stringify([entry.source, entry.name, entry.aliases])).slice(0, 24)}`;
const identityOk = entry => isRecord(entry) && typeof entry.source === 'string' && entry.source.length > 0 && entry.source.length <= 200 && typeof entry.name === 'string' && !!nameKey(entry.name) && Array.from(entry.name).length <= MAX_NAME && Array.isArray(entry.aliases) && entry.aliases.length <= MAX_ALIASES && entry.aliases.every(alias => typeof alias === 'string' && !!nameKey(alias) && Array.from(alias).length <= MAX_NAME);

/** The validator: [] or sentences. */
export function validateNames(slice) {
    if (!isRecord(slice) || !['people', 'seen', 'taken'].every(table => isRecord(slice[table]))) return ['names is not { people, seen, taken }.'];
    const errors = [];
    const nameOk = (key, entry) => isRecord(entry) && typeof entry.name === 'string' && Array.from(entry.name).length <= MAX_NAME && nameKey(entry.name) === key && isInt(entry.rev);
    for (const [key, entry] of Object.entries(slice.people)) {
        const profile = entry?.profile;
        if (!nameOk(key, entry) || !isInt(entry.first) || (profile !== null && !(isRecord(profile) && PROFILE_FIELDS.every(field => typeof profile[field] === 'string' && Array.from(profile[field]).length <= MAX_FIELD)))) errors.push(`names.people.${key} is not { name, first, profile, rev }.`);
    }
    for (const [key, entry] of Object.entries(slice.seen)) if (!(entry?.source === undefined ? nameOk(key, entry) : identityOk(entry) && identityKey(entry) === key && isInt(entry.rev))) errors.push(`names.seen.${key} is not a name or identity.`);
    for (const [key, entry] of Object.entries(slice.taken)) if (!nameOk(key, entry) || typeof entry.told !== 'boolean') errors.push(`names.taken.${key} is not { name, rev, told }.`);
    if (Object.keys(slice.people).length > MAX_MINOR || Object.keys(slice.seen).length > MAX_SEEN || Object.keys(slice.taken).length > MAX_TAKEN) errors.push('names holds more entries than it may.');
    for (const key of Object.keys(slice)) if (!['people', 'seen', 'taken'].includes(key)) errors.push(`names has an unknown field "${key}".`);
    return errors.slice(0, 10);
}

const revOf = ctx => (isInt(ctx?.rev) ? ctx.rev : 0);
const jsonKey = key => String(key).replace(/~/g, '~0').replace(/\//g, '~1');
const oldest = (table, keep) => { for (const key of Object.keys(table).slice(0, Math.max(0, Object.keys(table).length - keep))) delete table[key]; };
const reasonText = reason => (reason.kind === 'banned' ? 'it is on the banned list' : reason.kind === 'overused' ? 'models overuse that name' : reason.kind === 'taken' ? 'it is already used' : reason.kind === 'first' ? 'its first name is already used' : 'it is one letter from a name in use');

/** `apply` for `person` lines: the check, the stored person (name and one-line profile, frozen), and the Problem and cue on a refusal. */
export function applyPerson(ctx, line) {
    const name = cleanName(line?.name);
    const key = nameKey(name);
    if (line?.op !== '+' || !key) return ctx.fail('INVALID', `"${line?.op ?? ''} person ${name}": a person line is "+ person Name | look: … | flaw: … | voice: … | temper: …".`);
    const slice = ctx.draft('names');
    const { people, seen, taken } = tables(slice);
    const settings = settingsOf(ctx);
    const packed = packNames(queryOf(ctx));
    const others = [...Object.values(people), ...Object.values(seen)];
    // A unique full, partial, titled or alias match is the same person. Multiple candidates are a collision.
    const matches = personMatches(name, others, bareKey);
    if (matches === 1) return { summary: `Name: ${name} is known already.`, narrate: false, data: { person: key, known: true } };
    const known = others.flatMap(entry => [entry.name, ...(entry.aliases ?? [])]).map(name => ({ name, by: 'used' }));
    const { reasons } = checkName(name, { known, banned: [...settings.banned, ...(packed?.banned ?? [])] });
    if (matches > 1 && !reasons.some(reason => reason.kind === 'taken')) reasons.push({ kind: 'taken', by: 'used' });
    const read = parseProfile([line?.text, ...Object.entries(isRecord(line?.labels) ? line.labels : {}).map(([label, value]) => `${label}: ${value}`)].filter(Boolean).join(' | '));
    if (!reasons.length) {
        people[key] = { name, first: revOf(ctx), profile: read.ok ? read.profile : null, rev: revOf(ctx) };
        for (const evicted of capMinor(people).evicted) delete people[evicted];
        delete seen[key];
        return { summary: `Name: ${name} is new${read.ok ? `; ${read.text}` : ''}.`, narrate: false, data: { person: key } };
    }
    const why = reasons.map(reasonText).join('; ');
    if (reasons.some(reason => reason.kind !== 'near')) {
        if (Object.hasOwn(taken, key) && typeof ctx.ifThere === 'function') ctx.ifThere('names', `/taken/${jsonKey(key)}`);
        delete taken[key];
        taken[key] = { name, rev: revOf(ctx), told: false };
        oldest(taken, MAX_TAKEN);
    }
    return { summary: `Name: ${name} is not a fresh name (${why}).`, narrate: false, data: { person: key, taken: true }, problem: `${name}: ${why}. ${reasons.every(reason => reason.kind === 'near') ? 'Check it is not the same person under another spelling.' : 'The next reply asks the narrator for another name (or swipe).'}` };
}

/** `names.seen { who, identities? }` (system): record names and the aliases belonging to each known person. */
function seeSeen(ctx, payload = {}) {
    if (ctx.cause !== 'system') return ctx.fail('REFUSED', 'The names others use are noted by Story Director itself.');
    if (!isRecord(payload) || !Array.isArray(payload.who) || payload.who.length > 60 || payload.who.some(name => typeof name !== 'string') || (payload.identities !== undefined && (!Array.isArray(payload.identities) || payload.identities.length > 60 || payload.identities.some(entry => !identityOk(entry))))) return ctx.fail('INVALID', 'names.seen takes { who: [name], identities?: [person] }.');
    const { people, seen } = tables(ctx.draft('names'));
    for (const raw of payload.who) {
        const name = cleanName(raw);
        const key = nameKey(name);
        if (key && !Object.hasOwn(people, key) && !Object.hasOwn(seen, key)) seen[key] = { name, rev: revOf(ctx) };
    }
    for (const entry of payload.identities ?? []) if (!Object.hasOwn(seen, identityKey(entry))) seen[identityKey(entry)] = { name: entry.name, source: entry.source, aliases: entry.aliases, rev: revOf(ctx) };
    oldest(seen, MAX_SEEN);
    return { summary: 'Names noted.', narrate: false };
}

/** `names.told { who }` (system): the rename cue of these refusals went to the narrator with this reply. */
function told(ctx, payload = {}) {
    if (ctx.cause !== 'system') return ctx.fail('REFUSED', 'The rename cue is marked told by Story Director itself.');
    if (!isRecord(payload) || !Array.isArray(payload.who) || payload.who.length > MAX_TAKEN || payload.who.some(key => typeof key !== 'string')) return ctx.fail('INVALID', 'names.told takes { who: [key] }.');
    const { taken } = tables(ctx.draft('names'));
    for (const key of payload.who) if (Object.hasOwn(taken, key)) { ctx.ifThere('names', `/taken/${jsonKey(key)}`); taken[key].told = true; }
    return { summary: 'Rename cue told.', narrate: false };
}

/** Names and linked aliases from the scene, cast, NPC State Delta and key people; recorded before the reply for replay. */
function othersOf(view) {
    const query = queryOf(view);
    const cast = view?.state?.domains?.cast?.people;
    const keys = view?.state?.domains?.keypeople;
    const identities = [];
    const add = (source, person, fallback = '') => {
        const name = cleanName(person?.name || fallback), aliases = [...new Set((Array.isArray(person?.aliases) ? person.aliases : []).map(cleanName).filter(alias => nameKey(alias)))].slice(0, MAX_ALIASES);
        if (nameKey(name)) identities.push({ source: source.slice(0, 200), name, aliases });
    };
    const known = namesOf(ask(query, 'npc.known')).slice(0, MAX_SEEN);
    for (const name of known) {
        const dossier = ask(query, 'npc.dossier', { name });
        const id = ask(query, 'npc.identity', { name })?.id;
        add(`npc:${typeof id === 'string' ? id : nameKey(name)}`, dossier, name);
    }
    for (const [key, person] of Object.entries(isRecord(cast) ? cast : {})) add(`cast:${key}`, person);
    for (const [key, person] of Object.entries(isRecord(keys?.pins) ? keys.pins : {})) add(`pin:${key}`, person);
    const names = [...namesOf(ask(query, 'scene.present')), ...known, ...identities.flatMap(person => [person.name, ...person.aliases]), ...Object.values(isRecord(keys?.gone) ? keys.gone : {}).map(entry => entry?.name)].filter(name => typeof name === 'string' && nameKey(name));
    return { names, identities };
}

const suggestionsFor = (view, slice, count, seed) => {
    const { people, seen } = tables(slice);
    const names = packNames(queryOf(view));
    const settings = settingsOf(view);
    return names ? pickSuggestions({ names, region: view?.state?.domains?.scene?.place?.region ?? '', used: [...Object.values(people), ...Object.values(seen)].flatMap(entry => [entry.name, ...(entry.aliases ?? [])]).concat(othersOf(view).names), banned: settings.banned, count, seed }) : [];
};

/** `beforeGenerate(view, info)`: one `names.seen` step for names newly in use, one `names.told` step and the pinned rename cue for refusals not told yet. */
export function beforeGenerate(view, info = {}) {
    if (!namesOn(view)) return undefined;
    const slice = view?.state?.domains?.names;
    const { people, seen, taken } = tables(slice);
    const commands = [];
    if (info?.commit !== false) {
        const others = othersOf(view);
        const identities = others.identities.filter(entry => !Object.hasOwn(seen, identityKey(entry))).slice(0, 60);
        const linked = new Set(others.identities.filter(entry => identities.includes(entry) || seen[identityKey(entry)]).flatMap(entry => [entry.name, ...entry.aliases]).map(nameKey));
        const who = [...new Set(others.names.map(cleanName))].filter(name => !linked.has(nameKey(name)) && !Object.hasOwn(people, nameKey(name)) && !Object.hasOwn(seen, nameKey(name))).slice(0, 60);
        if (who.length || identities.length) commands.push({ type: 'names.seen', payload: { who, ...(identities.length ? { identities } : {}) } });
    }
    const owed = Object.entries(taken).filter(([, entry]) => entry.told !== true);
    const lines = owed.map(([key, entry], at) => {
        const [fresh] = settingsOf(view).count ? suggestionsFor(view, slice, 1, `${key}|${view?.chat?.length ?? 0}|${at}`) : [];
        return { text: `[Names] "${entry.name}" is not a fresh name (already used or not allowed). Call that person ${fresh ? `"${fresh}"` : 'by another, unused name'} from now on.`, keep: true };
    });
    if (owed.length && info?.commit !== false) commands.push({ type: 'names.told', payload: { who: owed.map(([key]) => key) } });
    return commands.length || lines.length ? { ...(commands.length ? { commands } : {}), ...(lines.length ? { lines } : {}) } : undefined;
}

/** The stored profile of the person `name` goes by, as `{ name, look, flaw, voice, temper, text }`, or null. */
function profileOf(slice, name) {
    const { people } = tables(slice);
    const entry = Object.hasOwn(people, nameKey(name)) ? people[nameKey(name)] : Object.values(people).find(other => sameName(other.name, name));
    return entry?.profile ? { name: entry.name, ...entry.profile, text: profileText(entry.profile) } : null;
}

/** `context.tail(view)` → `{ lines, optional }`: the profiles of the stored people who are back in the scene, then the suggestions (optional lines). */
export function tail(view) {
    if (!namesOn(view)) return { lines: [], optional: [] };
    const slice = view?.state?.domains?.names;
    const settings = settingsOf(view);
    const present = namesOf(ask(queryOf(view), 'scene.present'));
    const chat = view?.story?.chat?.();
    const last = String((Array.isArray(chat) ? chat.findLast(message => message && !message.is_user) : null)?.mes ?? '');
    const named = name => new RegExp(`(?<![\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'iu').test(last);
    const optional = Object.values(tables(slice).people)
        .filter(entry => entry.profile && (present.some(name => sameName(name, entry.name)) || (last && named(entry.name))))
        .slice(0, MAX_TAIL_PROFILES).map(entry => cutPoints(`${entry.name}: ${PROFILE_FIELDS.map(field => entry.profile[field]).filter(Boolean).join('; ')}`, MAX_PROFILE));
    const picks = suggestionsFor(view, slice, settings.count, `${view?.chat?.length ?? 0}`);
    if (picks.length) optional.push(`${TAIL_HEADER} ${picks.join(', ')}`);
    return { lines: [], optional };
}

export const part = {
    features: [{ id: FEATURE, label: 'Names', describe: 'Checks the name of a person who first appears (banned, overused and already-used names), offers unused names from the pack, and remembers a one-line profile for minor people.', default: true }],
    domains: { names: { initial: initialNames, validate: validateNames } },
    commands: { 'names.seen': Object.assign(seeSeen, { feature: FEATURE }), 'names.told': Object.assign(told, { feature: FEATURE }) },
    queries: { 'names.profile': Object.assign((state, args = {}, tools) => (namesOn(tools) ? profileOf(state?.domains?.names, args?.name) : null), { feature: FEATURE }) },
    kinds: { person: { grammar: GRAMMAR, apply: applyPerson, feature: FEATURE } },
    context: { static: () => '', tail },
    hooks: { beforeGenerate: Object.assign(beforeGenerate, { feature: FEATURE }) },
    settings: {
        section: 'Names',
        defaults: { banned: '', suggestions: DEFAULT_SUGGESTIONS },
        schema: {
            banned: { type: 'text', label: 'Banned names', multiline: true, max: 2000, feature: FEATURE, help: 'One name per line (or comma): a first name stops a new person from taking it.' },
            suggestions: { type: 'int', label: 'Name suggestions', min: 0, max: MAX_SUGGESTIONS, feature: FEATURE, help: 'Unused names from the pack offered to the narrator for new people each reply (0 turns it off).' },
        },
    },
    tabs: [],
};
