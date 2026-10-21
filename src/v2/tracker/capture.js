// Story Director v2, tracker part: Director change lines applied as story commands (pure).
//
// Story Block hands each `<Changes>` line of a Director kind to `apply(ctx, line)` as a command
// of cause `story` (SPEC §4.2), the line parsed by the shared grammar (§4.4) as
// `{ op, kind, name, text, labels }`. The line is turned into the op v1's parser makes of
// `op Name — text | label: value` and run through v1's `applyOps` on the domain read as a v1
// tracker (convert.js), so every v1 rule holds: near keys, a quest closed by its step, a job
// offered and not taken until the reader accepts it, giving up and turning down only on the
// reader's word, pay waiting, closing twice changing nothing. A line the rules cannot use is a
// Problem on the Director tab, never an error for the reader.

import { lineKey, parseChanges } from '../../changes.js';
import { applyOps, isOffer } from '../../tracker.js';
import { fromRecord, keysOf, orderedThreads, toRecord, toTracker } from './convert.js';
import { PROBLEM_LIMIT } from './domain.js';
import { calendarOf, packCalendarOf, settingsFrom, timeAfter } from './time.js';

const ID_CHARS = '0123456789abcdefghijklmnopqrstuvwxyz';
// A stand-in for "another new quest in this reply" (see applyThreadLine): a name nobody writes.
const OTHER_QUEST = Object.freeze({ op: '+', kind: 'quest', key: 'Qqxzq Qqxzq', id: 'qqxzq qqxzq', fields: {}, extra: {}, reason: '', raw: '' });
const OFFERED_TEXT = key => `"${key}" was offered, not taken on: it stays an offer until {{user}} accepts it.`;

/** The revision this command commits as (`ctx.rev`, MODULES §F2), 0 when the host does not say. */
export function revOf(ctx) {
    return Number.isSafeInteger(ctx?.rev) ? ctx.rev : 0;
}

/**
 * The reader's own message the reply answers (the capture ctx's `ctx.chat.lastUser`), or null.
 * v1's gate: a job is the reader's to take on, give up or turn down, and only their message can
 * do it. With none, nothing is taken.
 */
export function readerSaid(ctx) {
    const said = ctx?.chat?.lastUser ?? null;
    return typeof said === 'string' ? said : null;
}

// The capture ctx's carrier `{ index, swipe, key }` as one plain value: its key, else
// "index:swipe" (a swipe of the same reply is another reply), else a bare index or key.
function carrierKey(value) {
    if (value && typeof value === 'object') {
        if (typeof value.key === 'string' && value.key) return value.key;
        if (Number.isSafeInteger(value.index)) return `${value.index}:${Number.isSafeInteger(value.swipe) ? value.swipe : 0}`;
        return null;
    }
    return Number.isSafeInteger(value) || (typeof value === 'string' && value) ? value : null;
}

// Which reply a line comes from: the host's carrier (`ctx.carrier`), else read from the line's
// place in its block (a first line, or one not after the last line read, starts a reply).
function replyOf(ctx, line) {
    for (const value of [ctx?.carrier, line?.carrier]) {
        const key = carrierKey(value);
        if (key !== null) return key;
    }
    return null;
}

/** Moves `director.turn` on when `line` starts another reply's Director lines. */
export function beginTurn(director, ctx, line) {
    const turn = director.turn;
    const reply = replyOf(ctx, line);
    const index = Number.isSafeInteger(line?.index) ? line.index : -1;
    const fresh = reply !== null ? reply !== turn.reply || (index >= 0 && index <= turn.index)
        : index <= 0 || index <= turn.index;
    if (fresh) director.turn = { n: turn.n + 1, reply, index, from: director.time.minutes, quests: [], lone: null };
    else director.turn.index = index;
    return director.turn;
}

// `Hook: Sheepfold Wolves`, a kind and a colon written in front of the name (v1 0.9.10).
function bareName(name) {
    const text = String(name ?? '').replace(/\*\*|__|[*`]/g, '').trim();
    const prefixed = text.match(/^([A-Za-z]+)\s*:\s*(\S.*)$/s);
    return prefixed && ['agenda', 'event', 'hook', 'quest', 'clock', 'beat', 'secret', 'arc'].includes(prefixed[1].toLowerCase()) ? prefixed[2].trim() : text;
}

/** The line as v2 wrote it, for history and problems. */
export function lineText(line) {
    const labels = Object.entries(line?.labels ?? {}).map(([label, value]) => ` | ${label}: ${value}`).join('');
    return `${line?.op ?? ''} ${line?.kind ?? ''} ${line?.name ?? ''}${line?.text ? ` — ${line.text}` : ''}${labels}`.trim();
}

/**
 * The v1 op a v2 line is: `{ op }`, or `{ error }`. The text and labels go through v1's own
 * parser (a stand-in key keeps the name out of it), so `— step: done`, `| reason: …`, a
 * difficulty word and the rest read exactly as v1 reads them.
 */
export function toV1Op(line) {
    const op = line?.op;
    if (!['+', '-', '~', '!'].includes(op)) return { error: `"${lineText(line)}" asks code to decide something; Director lines use + ~ - or !.` };
    const key = bareName(line?.name);
    const id = lineKey(key);
    if (!id) return { error: `"${lineText(line)}" names nothing.` };
    const labels = Object.entries(line?.labels ?? {})
        .map(([label, value]) => ` | ${String(label).trim().toLowerCase()}:${String(value ?? '').trim() ? ` ${String(value).trim()}` : ''}`)
        .join('');
    const text = String(line?.text ?? '').trim();
    const stand = `${op}${op === '+' ? ` ${line.kind}` : ''} x${text ? ` — ${text}` : ''}${labels}`;
    const parsed = parseChanges(stand).ops[0];
    if (!parsed) return { error: `"${lineText(line)}" could not be read.` };
    return {
        op: {
            ...parsed,
            kind: op === '+' ? line.kind : null,
            key,
            id,
            raw: String(line?.raw ?? '').trim() || lineText(line),
        },
    };
}

// Thread IDs come from `ctx.id('th')` (deterministic from the receipt's seed, so a rebuild or a
// test gives the same ones); from ctx.rng() only for a host that has no ctx.id.
function newId(ctx, taken) {
    for (let tries = 0; tries < 64; tries += 1) {
        let id = typeof ctx?.id === 'function' ? ctx.id('th') : '';
        if (!/^th_[0-9a-z]{8}$/.test(id ?? '')) {
            id = 'th_';
            for (let i = 0; i < 8; i += 1) id += ID_CHARS[Math.floor(ctx.rng() * ID_CHARS.length) % ID_CHARS.length];
        }
        if (!taken.has(id)) {
            taken.add(id);
            return id;
        }
    }
    throw new Error('No free thread id.');
}

/** Adds a problem to the Director's list (the newest 50 are kept). */
export function addProblem(director, ctx, problem) {
    const entry = { rev: revOf(ctx), turn: director.turn.n, ...problem };
    for (const name of Object.keys(entry)) if (entry[name] === undefined) delete entry[name];
    director.problems = [...director.problems, entry].slice(-PROBLEM_LIMIT);
}

const withArticle = word => `${/^[aeiou]/.test(word) ? 'an' : 'a'} ${word}`;

// Writes the records the rules returned onto the draft: only threads that changed, and the key
// index, so the command's ops are the change and nothing else.
function writeBack(director, records, ctx, offeredIds) {
    const rev = revOf(ctx);
    const before = new Map(orderedThreads(director).map(thread => [lineKey(thread.key), thread]));
    const ids = new Set(Object.keys(director.threads));
    let order = Math.max(-1, ...orderedThreads(director).map(thread => thread.track?.order ?? 0));
    const idOf = new Map();
    for (const record of records) {
        const prev = before.get(record.id) ?? null;
        const id = prev?.id ?? newId(ctx, ids);
        idOf.set(record.id, id);
        const thread = fromRecord(record, prev, { id, rev, order: prev ? undefined : (order += 1), offered: offeredIds.has(record.id) });
        if (JSON.stringify(thread) !== JSON.stringify(prev)) director.threads[id] = thread;
    }
    const keys = keysOf(records, record => idOf.get(record.id));
    for (const name of Object.keys(director.keys)) if (!Object.hasOwn(keys, name)) delete director.keys[name];
    for (const [name, id] of Object.entries(keys)) if (director.keys[name] !== id) director.keys[name] = id;
    return idOf;
}

/** `apply(ctx, line)` for agenda, event, hook, quest, clock, beat and secret lines. */
export function applyThreadLine(ctx, line) {
    const director = ctx.draft('director');
    beginTurn(director, ctx, line);
    const raw = lineText(line);
    const read = toV1Op(line);
    if (read.error) {
        addProblem(director, ctx, { kind: 'unread', severity: 'warn', key: String(line?.name ?? ''), op: line?.op, text: read.error });
        return { summary: `Director: ${raw} (not used)`, narrate: false, data: { thread: null, problems: ['unread'] } };
    }
    const op = read.op;
    const said = readerSaid(ctx);
    const tracker = toTracker(director, { contracts: true });
    const ops = [op];
    const named = director.threads[director.keys[op.id]];
    // v1 0.9.20: "+ quest Key" then "- hook Key — <what the hook was>" in one reply leaves the job
    // open. Lines come one at a time here, so the reply's `+ quest` is put back in front of the
    // `-` (an active record named again changes nothing) and its own finding is dropped.
    const again = op.op === '-' && named?.status === 'active' && director.turn.quests.includes(named.id);
    if (again) ops.unshift({ op: '+', kind: 'quest', key: named.key, id: lineKey(named.key), fields: {}, extra: {}, reason: '', raw: '' });
    // v1 0.9.27: "yes" or "I'll take it" takes a job only when it is the reply's one new quest. A
    // second `+ quest` in the reply is read beside a stand-in for the first.
    const newQuest = op.op === '+' && op.kind === 'quest';
    const crowd = newQuest && director.turn.quests.some(id => id !== named?.id);
    if (crowd) ops.unshift(OTHER_QUEST);
    const result = applyOps(tracker, ops, { message: director.turn.n, time: director.time.minutes, said });
    const findings = (again ? result.problems.slice(1) : result.problems).filter(finding => finding.key !== OTHER_QUEST.key);
    const records = result.tracker.records.filter(record => record.id !== OTHER_QUEST.id);

    // A `~` on a name not tracked becomes v1's hook; the line's own kind says what it is.
    const added = findings.find(finding => finding.kind === 'untracked-added');
    if (added && line.kind !== 'quest' && line.kind !== 'hook') {
        const record = records.find(entry => entry.id === op.id);
        if (record?.kind === 'hook') {
            record.kind = line.kind;
            added.message = `"${op.key}" was not tracked; added as ${withArticle(line.kind)}.`;
        }
    }
    const reached = record => record.id === op.id || (record.aliases ?? []).includes(op.id);
    const offered = findings.some(finding => finding.kind === 'offered');
    const offeredIds = new Set(offered ? records.filter(reached).map(record => record.id) : []);
    const before = named ? toRecord(named, []).kind : null;
    const idOf = writeBack(director, records, ctx, offeredIds);
    const target = records.find(reached);
    const thread = target ? idOf.get(target.id) : null;
    for (const finding of findings) {
        addProblem(director, ctx, {
            kind: finding.kind, severity: finding.severity, key: finding.key ?? undefined, op: finding.op ?? op.op,
            text: finding.message, candidates: finding.candidates,
        });
    }
    let took = false;
    if (newQuest && thread) {
        // The reply's first new quest, taken while it was the only one: read again once another comes.
        if (crowd) recheckLone(director, ctx, said, thread);
        took = takenInWords(ctx, director, thread, named, said);
        if (!crowd && !director.turn.quests.length && !offered && director.threads[thread].kind === 'quest' && !(named?.kind === 'quest' && !named.offer)) {
            // Kept without the v1 key `id` (a lowercase name): Story Block checks every `id` in the
            // state is a well-formed ID. applyOps reads the key from `key` again.
            const { id: _key, ...loneOp } = op;
            director.turn.lone = { id: thread, op: structuredClone(loneOp), was: before, took };
        }
        if (!director.turn.quests.includes(thread)) director.turn.quests = [...director.turn.quests, thread];
    }
    return { summary: `Director: ${raw}`, narrate: false, data: { thread, problems: findings.map(finding => finding.kind), ...(took ? { taken: true } : {}) } };
}

/*
 * A quest the reader's own words took on (v1's rules made this reply's `+ quest` a quest, not an
 * offer, and the reader wrote a message) is taken on from now, as the Take on button does: fights
 * count from this receipt's rev. Part `quests` owns `taken`, `target` and `reward`, so this asks
 * it with `quest.take`; without that command only `taken` is set. True when it was taken.
 */
function takenInWords(ctx, director, id, named, said) {
    const thread = director.threads[id];
    if (!said || !String(said).trim() || !thread || thread.kind !== 'quest' || thread.offer || thread.taken || thread.status !== 'active') return false;
    // Already a quest before this line (an earlier reply took it): not taken now.
    if (named && named.kind === 'quest' && !named.offer && named.status === 'active') return false;
    try {
        ctx.call('quest.take', { id });
    } catch (error) {
        if (error?.code !== 'UNKNOWN_COMMAND') throw error;
        thread.taken = { rev: revOf(ctx) };
        thread.rev = revOf(ctx);
    }
    return Boolean(director.threads[id]?.taken);
}

// The reply's first `+ quest`, taken on while it was the only new quest, is read again beside the
// second: when the reader's words do not name it, it goes back to being an offer.
function recheckLone(director, ctx, said, current) {
    const lone = director.turn.lone;
    director.turn.lone = null;
    const thread = lone && lone.id !== current ? director.threads[lone.id] : null;
    // A quest taken on in this reply's words (lone.took) may still go back to being an offer.
    if (!thread || thread.status !== 'active' || thread.offer || (thread.taken && !lone.took) || thread.kind !== 'quest') return;
    const was = lone.was ?? 'hook';
    const record = { ...toRecord(thread, []), kind: was };
    const base = { version: 1, records: lone.was ? [record] : [], message: director.turn.n, time: director.time.minutes };
    const again = applyOps(base, [OTHER_QUEST, lone.op], { message: director.turn.n, time: director.time.minutes, said });
    if (!again.problems.some(finding => finding.kind === 'offered' && finding.key !== OTHER_QUEST.key)) return;
    thread.offer = true;
    if (lone.took) {
        thread.taken = null;
        thread.target = null;
        thread.reward = null;
    }
    thread.rev = revOf(ctx);
    thread.track = { ...thread.track, was };
    if (!isOffer({ ...record, status: 'active' })) thread.track.typed = true;
    director.problems = director.problems.filter(problem => !(problem.turn === director.turn.n && problem.kind === 'became-quest' && lineKey(problem.key ?? '') === lineKey(thread.key)));
    addProblem(director, ctx, { kind: 'offered', severity: 'info', key: thread.key, op: '+', text: OFFERED_TEXT(thread.key) });
}

/** `apply(ctx, line)` for `time` lines: `~ time <date, clock time>`, `! time +2h`. */
export function applyTimeLine(ctx, line) {
    const director = ctx.draft('director');
    beginTurn(director, ctx, line);
    const settings = settingsFrom(typeof ctx.settings === 'function' ? ctx.settings() : ctx.settings);
    const calendar = calendarOf(settings, packCalendarOf(ctx.query));
    const next = timeAfter(line, director.time.minutes, calendar);
    if (next.error) {
        addProblem(director, ctx, { kind: 'time', severity: 'warn', key: String(line?.name ?? ''), op: line?.op, text: next.error });
        return { summary: `Director: ${lineText(line)} (not used)`, narrate: false, data: { minutes: director.time.minutes } };
    }
    const before = director.time.minutes;
    if (next.minutes !== before) director.time.minutes = next.minutes;
    return {
        summary: `Story time: ${calendar.format(next.minutes)}.`,
        narrate: false,
        data: { minutes: next.minutes, from: before },
    };
}
