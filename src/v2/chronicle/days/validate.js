// Story Director v2, chronicle part: validation of day digests, facts and quest history. Pure.

import { slotValue } from '../../slot.js';
import {
    ENTRY_HAPPENED, ENTRY_KEY, FOLD_AT, FULL_CEILING, KEEP_CEILING, MAX_DATE, MAX_HAPPENED,
    MAX_ITEM, MAX_LINE, MAX_MET, MAX_NAME, MAX_NPCS, MAX_PLACES, MAX_QUESTS, MAX_WORLD,
    QUEST_LOG_TEXT, codePoints, isInt, isRecord,
} from './shared.js';

const QUEST_LOG_CEILING = 3000;
const THREAD_REF = /^[A-Za-z0-9_.:-]{1,64}$/;
const ENTRY_CEILING = 4000;

// ---- the validator ----------------------------------------------------------------------------

const KEYS_FULL = ['day', 'date', 'line', 'brief', 'count', 'happened', 'more', 'places', 'quests', 'fights', 'money', 'npcs', 'world', 'met', 'revs', 'made', 'src'];
const KEYS_BRIEF = ['day', 'date', 'line', 'brief', 'count', 'made'];
const textOk = (value, max) => typeof value === 'string' && codePoints(value) <= max;
const textsOk = (list, max, each) => Array.isArray(list) && list.length <= max && list.every(item => textOk(item, each));
const countOk = value => isInt(value) && value >= 0;

function digestErrors(key, stored) {
    const at = `chronicle.days.${key}`;
    if (!Array.isArray(stored) || stored.length !== 1 || !isRecord(stored[0])) return [`${at} must hold one day digest.`];
    const digest = stored[0];
    const errors = [];
    if (!isInt(digest.day) || String(digest.day) !== key) errors.push(`${at} is kept under another day.`);
    if (!textOk(digest.date, MAX_DATE)) errors.push(`${at}.date must be text of at most ${MAX_DATE} characters.`);
    if (!textOk(digest.line, MAX_LINE)) errors.push(`${at}.line must be text of at most ${MAX_LINE} characters.`);
    if (typeof digest.brief !== 'boolean') errors.push(`${at}.brief must be true or false.`);
    if (!countOk(digest.count)) errors.push(`${at}.count must be a whole number.`);
    if (!countOk(digest.made)) errors.push(`${at}.made must be a revision.`);
    const keys = digest.brief === true ? KEYS_BRIEF : KEYS_FULL;
    for (const field of Object.keys(digest)) if (!keys.includes(field)) errors.push(`${at} has an unknown field "${field}".`);
    if (digest.brief !== false) return errors;
    if (!textsOk(digest.happened, MAX_HAPPENED, MAX_ITEM)) errors.push(`${at}.happened must be at most ${MAX_HAPPENED} lines.`);
    if (!countOk(digest.more)) errors.push(`${at}.more must be a whole number.`);
    if (!textsOk(digest.places, MAX_PLACES, MAX_NAME)) errors.push(`${at}.places must be at most ${MAX_PLACES} names.`);
    const quests = digest.quests;
    if (!isRecord(quests) || Object.keys(quests).some(name => !['taken', 'done', 'failed', 'dropped'].includes(name))
        || !['taken', 'done', 'failed', 'dropped'].every(name => textsOk(quests[name], MAX_QUESTS, MAX_NAME))) errors.push(`${at}.quests must be lists of at most ${MAX_QUESTS} names.`);
    const fights = digest.fights;
    if (!isRecord(fights) || Object.keys(fights).length !== 4 || !['count', 'won', 'lost', 'fled'].every(name => countOk(fights[name]))) errors.push(`${at}.fights must be whole numbers.`);
    const money = digest.money;
    if (!isRecord(money) || Object.keys(money).length !== 2 || !countOk(money.in) || !countOk(money.out)) errors.push(`${at}.money must be { in, out } in whole numbers.`);
    if (!textsOk(digest.npcs, MAX_NPCS, MAX_ITEM)) errors.push(`${at}.npcs must be at most ${MAX_NPCS} lines.`);
    if (!textsOk(digest.world, MAX_WORLD, MAX_ITEM)) errors.push(`${at}.world must be at most ${MAX_WORLD} lines.`);
    if (digest.met !== undefined && !textsOk(digest.met, MAX_MET, MAX_NAME)) errors.push(`${at}.met must be at most ${MAX_MET} names.`);
    if (!Array.isArray(digest.revs) || digest.revs.length > 2 || !digest.revs.every(countOk)) errors.push(`${at}.revs must be [first, last] revisions.`);
    if (digest.src !== undefined && (!Array.isArray(digest.src) || !digest.src.length || digest.src.length > FOLD_AT * 2 || !digest.src.every(countOk))) errors.push(`${at}.src must be the revisions of its day's entries.`);
    return errors;
}

// ---- the day facts kept as replies go (chronicle.dayFacts, chronicle.noted) ----------------------
//
// Story Block keeps a receipt's `data` only for the last couple of hundred replies (its storage trim),
// so a long day cannot be read back from the receipts when it ends (RX-TL-3). Instead, before each
// reply, `chronicle.note` reads the receipts committed since the last note (fresh, whole) and keeps
// what they hold for the day digest as small entries under `chronicle.dayFacts["<day>.<rev>"]` (`rev`
// is the note's own receipt revision): added whole, never changed, on the reply the note is a receipt
// of, so deleting or swiping that reply takes exactly its facts away. When a day's digest is written
// from them, its entries stay while the digest is whole (the newest FOLLOW_MAX of them, newest days
// first): the digest follows them (daysOf), so a reply of that day deleted later takes its facts out
// of the digest and its time-skip line. They are removed by key when the day goes short or past
// FOLLOW_MAX (its digest then stays as it was, `src` cleared), and at once for a day not written from
// them. `chronicle.noted = [{ rev, minutes, from, settle, gap? }]` is where the
// notes got to: the revision and the clock after the last one, the day notes began (`from`), the
// time part's last settle jump seen (`settle`), and, while the digest feature is off, where the day
// facts stopped (`gap: { rev, minutes }`): the first note with the feature back on reads the receipts
// from there, so the days that ended while it was off are written too (B-c2-3).

// The quest history (quest.details, F84) is read from receipts too: `chronicle.questLog["<rev>"] =
// { thread, text }` keeps, per receipt revision, the summary of each receipt that touched a quest or
// thread, written by the note on the reply it belongs to; the newest QUEST_LOG_KEPT per thread stay.

function entryErrors(key, entry) {
    const at = `chronicle.dayFacts.${key}`;
    const match = ENTRY_KEY.exec(key);
    if (!match) return [`chronicle.dayFacts["${key}"] is not "<day>.<rev>".`];
    if (!isRecord(entry) || entry.day !== Number(match[1])) return [`${at} is not a day's facts.`];
    const errors = [];
    if (!countOk(entry.count) || !countOk(entry.more)) errors.push(`${at}.count and .more must be whole numbers.`);
    if (!Array.isArray(entry.happened) || entry.happened.length > ENTRY_HAPPENED
        || !entry.happened.every(item => isRecord(item) && textOk(item.text, MAX_ITEM) && typeof item.told === 'boolean')) errors.push(`${at}.happened must be at most ${ENTRY_HAPPENED} { text, told }.`);
    if (!textsOk(entry.places, MAX_PLACES, MAX_NAME)) errors.push(`${at}.places must be at most ${MAX_PLACES} names.`);
    const fights = entry.fights;
    if (!isRecord(fights) || !['count', 'won', 'lost', 'fled'].every(name => countOk(fights[name]))) errors.push(`${at}.fights must be whole numbers.`);
    if (!isRecord(entry.money) || !countOk(entry.money.in) || !countOk(entry.money.out)) errors.push(`${at}.money must be { in, out } in whole numbers.`);
    const nameOrNull = value => value === null || textOk(value, MAX_NAME);
    if (!Array.isArray(entry.npcs) || entry.npcs.length > MAX_NPCS * 2
        || !entry.npcs.every(move => isRecord(move) && textOk(move.name, MAX_NAME) && textOk(move.meter, MAX_NAME) && nameOrNull(move.from) && nameOrNull(move.to))) errors.push(`${at}.npcs must be stage moves.`);
    if (!Array.isArray(entry.world) || entry.world.length > MAX_WORLD
        || !entry.world.every(item => isRecord(item) && textOk(item.id, MAX_NAME) && textOk(item.text, MAX_ITEM))) errors.push(`${at}.world must be at most ${MAX_WORLD} { id, text }.`);
    if (!Array.isArray(entry.revs) || ![0, 2].includes(entry.revs.length) || !entry.revs.every(countOk)) errors.push(`${at}.revs must be [first, last] revisions.`);
    if (entry.met !== undefined && !textsOk(entry.met, MAX_MET, MAX_NAME)) errors.push(`${at}.met must be at most ${MAX_MET} names.`);
    for (const field of Object.keys(entry)) {
        if (!['day', 'count', 'happened', 'more', 'places', 'fights', 'money', 'npcs', 'world', 'met', 'revs'].includes(field)) errors.push(`${at} has an unknown field "${field}".`);
    }
    return errors;
}

/** The validator's part for `days` and `written` (both optional: a chronicle from before digests has neither). */
export function validateDays(slice) {
    const errors = [];
    if (slice.dayFacts !== undefined) {
        if (!isRecord(slice.dayFacts)) errors.push('chronicle.dayFacts is not an object.');
        else {
            const entries = Object.entries(slice.dayFacts);
            for (const [key, entry] of entries) errors.push(...entryErrors(key, entry));
            if (entries.length > ENTRY_CEILING) errors.push(`The chronicle keeps at most ${ENTRY_CEILING} day-facts entries.`);
        }
    }
    if (slice.questLog !== undefined) {
        if (!isRecord(slice.questLog)) errors.push('chronicle.questLog is not an object.');
        else {
            const entries = Object.entries(slice.questLog);
            if (entries.some(([key, entry]) => !/^\d{1,15}$/.test(key) || !isRecord(entry) || !THREAD_REF.test(entry.thread ?? '') || !textOk(entry.text, QUEST_LOG_TEXT)
                || Object.keys(entry).some(field => field !== 'thread' && field !== 'text'))) errors.push('chronicle.questLog entries must be { thread, text } under a revision.');
            if (entries.length > QUEST_LOG_CEILING) errors.push(`The chronicle keeps at most ${QUEST_LOG_CEILING} quest history lines.`);
        }
    }
    if (slice.noted !== undefined && slice.noted !== null) {
        const noted = slotValue(slice.noted);
        const settleOk = value => value === null || (isRecord(value) && (value.from === null || isInt(value.from)) && isInt(value.to));
        const gapOk = value => value === undefined || (isRecord(value) && (value.rev === null || countOk(value.rev))
            && (value.minutes === null || isInt(value.minutes)) && Object.keys(value).every(key => key === 'rev' || key === 'minutes'));
        if (!noted || !Array.isArray(slice.noted) || slice.noted.length !== 1 || !countOk(noted.rev)
            || !(noted.minutes === null || isInt(noted.minutes)) || !(noted.from === null || isInt(noted.from)) || !settleOk(noted.settle)
            || !gapOk(noted.gap) || Object.keys(noted).some(key => !['rev', 'minutes', 'from', 'settle', 'gap'].includes(key))) {
            errors.push('chronicle.noted must be null or { rev, minutes, from, settle, gap? }.');
        }
    }
    if (slice.days !== undefined) {
        if (!isRecord(slice.days)) errors.push('chronicle.days is not an object.');
        else {
            const entries = Object.entries(slice.days);
            for (const [key, stored] of entries) {
                if (!/^-?\d{1,15}$/.test(key)) errors.push(`chronicle.days["${key}"] is not a day.`);
                else errors.push(...digestErrors(key, stored));
            }
            if (entries.length > KEEP_CEILING) errors.push(`The chronicle keeps at most ${KEEP_CEILING} days.`);
            if (entries.filter(([, stored]) => slotValue(stored)?.brief === false).length > FULL_CEILING) errors.push(`The chronicle keeps at most ${FULL_CEILING} whole days.`);
        }
    }
    if (slice.written !== undefined && slice.written !== null) {
        const written = slotValue(slice.written);
        if (!written || !Array.isArray(slice.written) || slice.written.length !== 1 || !isInt(written.through)
            || !Array.isArray(written.days) || written.days.length > KEEP_CEILING || !written.days.every(isInt)
            || !(written.at === null || countOk(written.at)) || typeof written.skip !== 'boolean'
            || Object.keys(written).some(key => !['through', 'days', 'at', 'skip'].includes(key))) {
            errors.push('chronicle.written must be null or { through, days, at, skip }.');
        }
    }
    return errors;
}
