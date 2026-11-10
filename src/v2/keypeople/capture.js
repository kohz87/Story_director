// Story Director v2, part **keypeople**: the change lines and the commands that write the `keypeople` domain.
//
// Kinds (feature `story-director.key-people`):
// - `away`: `+ away Ren — scouting the north road | back: Goldwane 18` (a key person leaves for a while; `~` changes what
//   they do or when they are due back), `! away Ren — reached Wolfmere Outpost` (a step on the timeline; `back:` may move
//   the date), `- away Ren` (they are back). Only a pinned person may be away.
// - `key`: `- key Ren | died` (the story records a death: the pin goes, with its reason). Nothing else takes someone off
//   the list from the story: the reader unpins. A person who is not pinned is recorded as dead too (a `gone` record with reason `died`, no pin
//   to take off) when the reply carries Story Block's `diedAny` rule mark (`ctx.carrier.rules`); on a reply without it the line finds nobody, as before.
//
// Commands:
// - `keypeople.pin { name, aliases?, nsd? }` and `keypeople.unpin { name }` (cause `ui`: the reader's, on the latest reply).
// - `keypeople.sync { who?, known? }` (cause `system`, from the hook before a reply, nsd.js): the people NPC State Delta says are
//   archived or dead are unpinned with that reason. Nothing is ever written to NPC State Delta. The step is stored on the reply before the
//   one being written, so its card line is not written here: the pin goes at once (the narrator must not be told of them) and the
//   `gone` record is marked `owed`.
// - `keypeople.tell { who }` (cause `system`, from the hook after the reply's lines, index.js): the card line of those removals, written on
//   the reply that was being written when they were decided, so it is that reply's card that says it.
//
// Replay: every record is added whole under its key; a change inside an away record is marked `ctx.ifThere` (so it is
// passed over when the reply that made the record was deleted); what a reply tells its card goes in `notes`, one new key
// per note (never changed after), the oldest replies' dropped.

import { idFrom } from '../writes.js';
import {
    MAX_ALIASES, MAX_CAP, MAX_DOING, MAX_GONE, MAX_NOTE_REPLIES, MAX_STEP, MAX_STEPS, DEFAULT_CAP, REASONS,
    awayOf, cleanName, cutPoints, findPin, isInt, isRecord, keyOf,
} from './domain.js';
import { calendarFrom, dateText, readBack } from './time.js';

const asText = value => (typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value));
const revOf = ctx => (isInt(ctx?.rev) ? ctx.rev : 0);
const nowOf = ctx => {
    try {
        const minutes = typeof ctx?.time === 'function' ? ctx.time() : null;
        return isInt(minutes) ? minutes : null;
    } catch {
        return null;
    }
};
const query = ctx => (typeof ctx?.query === 'function' ? (name, args) => ctx.query(name, args) : null);

/** The `cap` setting: 0 to MAX_CAP, else the default. */
export function capOf(settings) {
    const value = settings?.cap;
    return isInt(value) && value >= 0 ? Math.min(MAX_CAP, value) : DEFAULT_CAP;
}

/** The line as the story wrote it, for messages. */
function lineText(line) {
    const labels = Object.entries(line?.labels ?? {}).map(([label, value]) => ` | ${label}: ${value}`).join('');
    return `${line?.op ?? ''} ${line?.kind ?? ''} ${line?.name ?? ''}${line?.text ? ` — ${line.text}` : ''}${labels}`.trim();
}

// The JSON pointer of one away record (or taken-off record), inside the domain.
const awayPath = key => `/away/${String(key).replace(/~/g, '~0').replace(/\//g, '~1')}`;
const gonePath = key => `/gone/${String(key).replace(/~/g, '~0').replace(/\//g, '~1')}`;

// ---- notes and removal -------------------------------------------------------------------------------------------------

// One note for the reply's card (and its closed line): a new key each time, never changed after. `lead`: the first of its reply.
// `key` and `goneRev` (a removal told after the step that made it, `keypeople.tell`): the taken-off record it is about, so the card
// says nothing when that record is not there any more (the reply that made it was deleted).
function addNote(ctx, kp, { kind, name, head, rest, key, goneRev }) {
    const sid = ctx.carrier?.sid ?? ctx.reply?.sid ?? null;
    const rev = revOf(ctx);
    const same = note => note.sid === sid && (sid !== null || note.rev === rev);
    const id = idFrom(ctx, 'kn', kp.notes);
    kp.notes[id] = { sid, kind, name, head: cutPoints(head, 200), rest: cutPoints(rest, 300), lead: !Object.values(kp.notes).some(same), rev, ...(key !== undefined ? { key, goneRev } : {}) };
    // The newest replies' notes only: whole replies go, oldest first, so a reply never loses its lead.
    const order = [];
    for (const [other, note] of Object.entries(kp.notes)) {
        const mark = `${note.sid ?? ''}|${note.sid === null ? note.rev : ''}`;
        let group = order.find(entry => entry.mark === mark);
        if (!group) order.push(group = { mark, ids: [] });
        group.ids.push(other);
    }
    for (const group of order.slice(0, Math.max(0, order.length - MAX_NOTE_REPLIES))) for (const old of group.ids) delete kp.notes[old];
}

/**
 * Takes `key` off the list (the draft `kp`): the pin and its away record go, `gone` records why, and the reply's card is
 * told. `reason`: died | archived | unpinned. Returns the sentence for the receipt.
 */
function writeGone(ctx, kp, key, name, reason, now, defer = false) {
    delete kp.gone[key];
    // `owed`: the card line is for the reply that follows this step (`keypeople.tell`), not the reply that holds it.
    kp.gone[key] = { name, reason, on: now, rev: revOf(ctx), ...(defer ? { owed: true } : {}) };
    const keys = Object.keys(kp.gone);
    for (const old of keys.slice(0, Math.max(0, keys.length - MAX_GONE))) delete kp.gone[old];
}

function removePin(ctx, kp, key, pin, reason, calendar, now, { defer = false } = {}) {
    delete kp.pins[key];
    if (Object.hasOwn(kp.away, key)) delete kp.away[key];
    writeGone(ctx, kp, key, pin.name, reason, now, defer);
    const why = whyText(reason, calendar, now);
    if (!defer) addNote(ctx, kp, { kind: 'gone', name: pin.name, head: `${pin.name} is no longer a key person`, rest: `(${why}).` });
    return `${pin.name} is no longer a key person (${why}).`;
}

/** Why a person left the list, in words: "died, Goldwane 18", "archived in NPC State Delta", "unpinned". */
function whyText(reason, calendar, now) {
    const day = dateText(calendar, now);
    return reason === 'died' ? `died${day ? `, ${day}` : ''}` : reason === 'archived' ? 'archived in NPC State Delta' : 'unpinned';
}

// ---- the story's lines ------------------------------------------------------------------------------------------------

const labelOf = (labels, names) => names.map(name => labels[name]).find(value => value !== undefined);

function awaySummary(name, away, calendar) {
    const back = dateText(calendar, away.back);
    return `Key person: ${name} is away${away.doing ? `, ${away.doing}` : ''}${back ? `, back ${back}` : ''}.`;
}

/** `apply(ctx, line)` for `away` lines. */
export function applyAwayLine(ctx, line) {
    const op = line?.op;
    if (!['+', '~', '!', '-'].includes(op)) return ctx.fail('INVALID', `"${lineText(line)}": away lines use +, ~, ! or -.`);
    const name = cleanName(line?.name);
    if (!keyOf(name)) return ctx.fail('INVALID', `"${lineText(line)}" names nobody.`);
    const kp = ctx.draft('keypeople');
    const found = findPin(kp, name);
    if (!found) return ctx.fail('NOT_FOUND', `${name} is not a key person, so cannot be away (only a pinned person can be; the reader pins them on the World screen).`);
    const { key, pin } = found;
    const labels = isRecord(line?.labels) ? line.labels : {};
    const now = nowOf(ctx);
    const calendar = calendarFrom(query(ctx));
    const text = cutPoints(asText(line?.text), op === '!' ? MAX_STEP : MAX_DOING);
    const backLabel = labelOf(labels, ['back', 'return', 'returns', 'returning', 'until', 'due']);
    let back;
    let problem = '';
    if (backLabel !== undefined && op !== '-') {
        const read = readBack(calendar, backLabel, now);
        if (read.error) problem = `${pin.name}: ${read.error} The return date was left as it was.`;
        else back = read.back;
    }
    const existing = awayOf(kp, key);

    if (op === '-') {
        if (!existing) return ctx.fail('NOT_FOUND', `${pin.name} is not away.`);
        ctx.ifThere('keypeople', awayPath(key));
        const left = dateText(calendar, existing.since);
        const here = dateText(calendar, now);
        const span = left && here ? (left === here ? `away ${left}` : `away ${left} – ${here}`) : left ? `away since ${left}` : 'away';
        delete kp.away[key];
        addNote(ctx, kp, { kind: 'back', name: pin.name, head: `${pin.name} is back`, rest: `${existing.doing ? `from ${existing.doing} ` : ''}(key person, ${span}).` });
        return { summary: `Key person: ${pin.name} is back${existing.doing ? ` from ${existing.doing}` : ''}.`, narrate: false, data: { person: key, back: true } };
    }

    if (op === '!') {
        if (!existing) return ctx.fail('NOT_FOUND', `${pin.name} is not away, so there is no step to add.`);
        if (!text) return ctx.fail('INVALID', `"${lineText(line)}" says nothing happened; write ! away ${pin.name} — where they got to.`);
        ctx.ifThere('keypeople', awayPath(key));
        const away = kp.away[key];
        const last = away.steps.at(-1);
        const moved = back !== undefined && back !== away.back;
        if (back !== undefined) away.back = back;
        if (last && last.text === text) {
            if (moved) away.rev = revOf(ctx);
            return { summary: `Key person: ${pin.name} is unchanged.`, narrate: false, data: { person: key }, ...(problem ? { problem } : {}) };
        }
        away.steps.push({ date: now, text });
        if (away.steps.length > MAX_STEPS) away.steps.splice(0, away.steps.length - MAX_STEPS);
        away.rev = revOf(ctx);
        return { summary: `Key person: ${pin.name}, ${text}.`, narrate: false, data: { person: key, step: true }, ...(problem ? { problem } : {}) };
    }

    // + and ~: they go away, or what they do and when they are due back changes.
    if (!existing) {
        const away = { name: pin.name, doing: text, since: now, back: back ?? null, steps: [], rev: revOf(ctx) };
        kp.away[key] = away;
        return { summary: awaySummary(pin.name, away, calendar), narrate: false, data: { person: key, away: true }, ...(problem ? { problem } : {}) };
    }
    ctx.ifThere('keypeople', awayPath(key));
    const away = kp.away[key];
    const changed = (text && text !== away.doing) || (back !== undefined && back !== away.back);
    if (text) away.doing = text;
    if (back !== undefined) away.back = back;
    if (changed) away.rev = revOf(ctx);
    return { summary: changed ? awaySummary(pin.name, away, calendar) : `Key person: ${pin.name} is unchanged.`, narrate: false, data: { person: key }, ...(problem ? { problem } : {}) };
}

// A word that says someone died (the line's text, its labels or their values).
const DEATH = /(?<![\p{L}\p{N}])(?:died|dies|dead|death|killed|slain|murdered|perished)(?![\p{L}\p{N}])/iu;

/** `apply(ctx, line)` for `key` lines: only `- key Name | died`. */
export function applyKeyLine(ctx, line) {
    if (line?.op !== '-') return ctx.fail('INVALID', `"${lineText(line)}": a key line is "- key Name | died" (the reader pins and unpins).`);
    const name = cleanName(line?.name);
    if (!keyOf(name)) return ctx.fail('INVALID', `"${lineText(line)}" names nobody.`);
    const labels = isRecord(line?.labels) ? line.labels : {};
    if (![asText(line?.text), ...Object.keys(labels), ...Object.values(labels).map(asText)].some(part => DEATH.test(part))) {
        return ctx.fail('REFUSED', `${name} leaves the key list only when they die (- key ${name} | died); the reader unpins anyone else.`);
    }
    const kp = ctx.draft('keypeople');
    const found = findPin(kp, name);
    if (!found) {
        // Anyone the story kills, not only a pinned person, but only on a reply captured under that rule (Story Block's `diedAny` mark, `ctx.carrier.rules`):
        // a reply recorded before it keeps the old answer when it is read again, so it never gains a death it did not have. Same `gone` record, no card line.
        if (!(Array.isArray(ctx.carrier?.rules) && ctx.carrier.rules.includes('diedAny'))) return ctx.fail('NOT_FOUND', `${name} is not a key person.`);
        const key = keyOf(name);
        writeGone(ctx, kp, key, name, 'died', nowOf(ctx));
        return { summary: `Died: ${name}`, narrate: false, data: { person: key, died: true } };
    }
    const summary = removePin(ctx, kp, found.key, found.pin, 'died', calendarFrom(query(ctx)), nowOf(ctx));
    return { summary: `Key person: ${summary}`, narrate: false, data: { person: found.key, removed: 'died' } };
}

// ---- the commands ------------------------------------------------------------------------------------------------------

function aliasesOf(ctx, value, name) {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > 24) return ctx.fail('INVALID', 'keypeople.pin: aliases is a list of names.');
    const out = [];
    for (const given of value) {
        if (typeof given !== 'string') return ctx.fail('INVALID', 'keypeople.pin: an alias is a name.');
        const alias = cleanName(given);
        if (keyOf(alias) && keyOf(alias) !== keyOf(name) && !out.some(other => keyOf(other) === keyOf(alias))) out.push(alias);
        if (out.length >= MAX_ALIASES) break;
    }
    return out;
}

const PIN_FIELDS = ['name', 'aliases', 'nsd'];

/** `keypeople.pin { name, aliases? }` (cause `ui`): the reader makes someone a key person, up to the cap. */
export function pin(ctx, payload = {}) {
    if (ctx.cause !== 'ui') return ctx.fail('REFUSED', 'Only you pin a key person; the story cannot.');
    if (!isRecord(payload) || Object.keys(payload).some(field => !PIN_FIELDS.includes(field))) return ctx.fail('INVALID', 'keypeople.pin takes { name, aliases? }.');
    if (typeof payload.name !== 'string') return ctx.fail('INVALID', 'keypeople.pin needs a name.');
    if (payload.nsd !== undefined && typeof payload.nsd !== 'boolean') return ctx.fail('INVALID', 'keypeople.pin: nsd is true or false.');
    const name = cleanName(payload.name);
    if (!keyOf(name)) return ctx.fail('INVALID', 'keypeople.pin needs a name with letters or digits in it.');
    const aliases = aliasesOf(ctx, payload.aliases, name);
    const kp = ctx.draft('keypeople');
    const found = findPin(kp, name, aliases);
    if (found) return { summary: `${found.pin.name} is already a key person.`, narrate: false, data: { person: found.key, edit: true } };
    const cap = capOf(ctx.settings());
    if (Object.keys(kp.pins).length >= cap) return ctx.fail('LIMITED', `You can have ${cap} key ${cap === 1 ? 'person' : 'people'}; unpin someone first (Settings, Modules, Story Director, Key people).`);
    const key = keyOf(name);
    kp.pins[key] = { name, since: nowOf(ctx), rev: revOf(ctx), ...(aliases.length ? { aliases } : {}), ...(payload.nsd === true ? { nsd: true } : {}) };
    delete kp.gone[key];
    return { summary: `${name} is now a key person.`, narrate: false, data: { person: key, pinned: true, edit: true } };
}

/** `keypeople.unpin { name }` (cause `ui`): the reader takes someone off the list. */
export function unpin(ctx, payload = {}) {
    if (ctx.cause !== 'ui') return ctx.fail('REFUSED', 'Only you unpin a key person; the story cannot (a death is a "- key Name | died" line).');
    if (!isRecord(payload) || Object.keys(payload).some(field => field !== 'name') || typeof payload.name !== 'string') return ctx.fail('INVALID', 'keypeople.unpin takes { name }.');
    const kp = ctx.draft('keypeople');
    const found = findPin(kp, payload.name);
    if (!found) return ctx.fail('NOT_FOUND', `${cleanName(payload.name) || 'That person'} is not a key person.`);
    const summary = removePin(ctx, kp, found.key, found.pin, 'unpinned', calendarFrom(query(ctx)), nowOf(ctx));
    return { summary, narrate: false, data: { person: found.key, removed: 'unpinned', edit: true } };
}

const SYNC_REASONS = REASONS.filter(reason => reason !== 'unpinned');

/**
 * `keypeople.sync { who?: [{ name, reason }], known?: [name | { name, id? }] }` (cause `system`, from the hook before a reply): what NPC State
 * Delta says about the pinned. `who`: archived or dead there, so they leave the list with that reason. `known`: pinned people
 * it knows now (noted on their pin, so a later disappearance reads as archived). Someone not pinned any more is skipped.
 * Refused from anywhere else.
 */
export function sync(ctx, payload = {}) {
    if (ctx.cause !== 'system') return ctx.fail('REFUSED', 'Who leaves the key list because NPC State Delta archived or lost them is decided by Story Director itself.');
    const { who = [], known = [] } = isRecord(payload) ? payload : {};
    if (!isRecord(payload) || Object.keys(payload).some(field => !['who', 'known'].includes(field)) || !Array.isArray(who) || !Array.isArray(known) || who.length > 24 || known.length > 24) {
        return ctx.fail('INVALID', 'keypeople.sync takes { who?: [{ name, reason }], known?: [name | { name, id? }] }.');
    }
    const kp = ctx.draft('keypeople');
    const calendar = calendarFrom(query(ctx));
    const now = nowOf(ctx);
    const told = [];
    const keys = [];
    for (const entry of who) {
        if (!isRecord(entry) || typeof entry.name !== 'string' || !SYNC_REASONS.includes(entry.reason)) return ctx.fail('INVALID', `keypeople.sync: each of who is { name, reason: ${SYNC_REASONS.join(' | ')} }.`);
        const found = findPin(kp, entry.name);
        if (!found) continue;
        told.push(removePin(ctx, kp, found.key, found.pin, entry.reason, calendar, now, { defer: true }));
        keys.push(found.key);
    }
    for (const entry of known) {
        const name = typeof entry === 'string' ? entry : entry?.name;
        const id = isRecord(entry) ? entry.id : undefined;
        if (typeof name !== 'string' || (id !== undefined && !(typeof id === 'string' && /^np_[0-9a-z]{8}$/.test(id)))) return ctx.fail('INVALID', 'keypeople.sync: known is a list of names, or { name, id? }.');
        const found = findPin(kp, name);
        if (!found || (found.pin.nsd === true && (id === undefined || found.pin.npc === id))) continue;
        // Inside a pin the reply that made it may be gone: passed over then (SPEC §2.2 rule d).
        ctx.ifThere('keypeople', `/pins/${found.key}`);
        found.pin.nsd = true;
        if (id !== undefined) found.pin.npc = id;
    }
    return { summary: told.join(' '), narrate: false, data: { removed: keys } };
}

/**
 * `keypeople.tell { who: [key] }` (cause `system`, from the hook after a reply's story lines): the card line of removals that
 * `keypeople.sync` made on the reply before (their `gone` record is `owed`). It is written on the reply being written when they were decided.
 * Someone not owed any more (told already, or taken off the list again) is skipped; nothing is said for them twice.
 */
export function tell(ctx, payload = {}) {
    if (ctx.cause !== 'system') return ctx.fail('REFUSED', 'The card line of a removal NPC State Delta made is written by Story Director itself.');
    if (!isRecord(payload) || Object.keys(payload).some(field => field !== 'who') || !Array.isArray(payload.who) || payload.who.length > 24 || payload.who.some(key => typeof key !== 'string')) {
        return ctx.fail('INVALID', 'keypeople.tell takes { who: [key] }.');
    }
    const kp = ctx.draft('keypeople');
    const calendar = calendarFrom(query(ctx));
    const told = [];
    const keys = [];
    for (const key of payload.who) {
        const entry = Object.hasOwn(kp.gone, key) ? kp.gone[key] : null;
        if (!isRecord(entry) || entry.owed !== true) continue;
        // The record may be gone when the reply that made it was deleted: passed over then (SPEC §2.2 rule d).
        ctx.ifThere('keypeople', gonePath(key));
        delete entry.owed;
        const why = whyText(entry.reason, calendar, entry.on);
        addNote(ctx, kp, { kind: 'gone', name: entry.name, head: `${entry.name} is no longer a key person`, rest: `(${why}).`, key, goneRev: entry.rev });
        told.push(`${entry.name} is no longer a key person (${why}).`);
        keys.push(key);
    }
    return { summary: told.length ? `Key person: ${told.join(' ')}` : '', narrate: false, data: { told: keys } };
}
