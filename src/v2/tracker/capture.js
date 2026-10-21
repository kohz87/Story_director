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
import { fromRecord, keysOf, orderedThreads, outcomeOf, toRecord, toTracker } from './convert.js';
import { PROBLEM_LIMIT, PROBLEM_ROOM } from './domain.js';
import { applyMet, capNote, markOffer, noGoalProblem, onlyOwnLabels, questHasGoal, splitQuestLine, storyTurnIn } from './quest-lines.js';
import { calendarOf, maxJumpMinutes, packCalendarOf, settingsFrom, timeAfter } from './time.js';

/** The offer cooldown (F88, the quests part's `offerCooldown`, read by this part) when nothing sets it. */
export const OFFER_COOLDOWN = 6;
/** The longest thread name kept, in characters: a longer one is cut (at a space when there is one). */
export const KEY_CHARS = 120;
/** The longest thread summary kept, in characters: a longer one is cut (at a space when there is one). */
export const SUMMARY_CHARS = 600;
/** New threads one reply's lines may add; a line that would add more is not used (a Problem says so). */
export const NEW_THREADS_PER_REPLY = 16;
// The longest a line is quoted in a summary or a Problem.
const QUOTE_CHARS = 300;
// Labels Story Block's generic state rules reserve (ops.js checkOps: `qty` is a count, `id` and
// `…_id` are IDs, three keys no state may hold): kept under such a name in `fields`, they would get
// the whole line refused. They mean nothing to the Director, so they are left out with a Problem.
const RESERVED_LABEL = /^(?:qty|id|.+_id|.+Id|__proto__|constructor|prototype)$/;
// `xp:` on a quest: quest XP is RPG Battle's, scaled by difficulty (MODULES §F5); never a written amount.
const IGNORED_LABELS = new Set(['xp', 'exp', 'experience']);

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

const clip = value => (value.length > QUOTE_CHARS ? `${value.slice(0, QUOTE_CHARS - 1)}…` : value);

/** The line as v2 wrote it, for history and problems (at most QUOTE_CHARS long). */
export function lineText(line) {
    const labels = Object.entries(line?.labels ?? {}).map(([label, value]) => ` | ${label}: ${value}`).join('');
    return clip(`${line?.op ?? ''} ${line?.kind ?? ''} ${line?.name ?? ''}${line?.text ? ` — ${line.text}` : ''}${labels}`.trim());
}

/** A thread name at most KEY_CHARS long: cut at the last space before the limit when there is one. */
export function capKey(key) {
    const text = String(key ?? '');
    if (text.length <= KEY_CHARS) return text;
    const head = text.slice(0, KEY_CHARS);
    const space = head.lastIndexOf(' ');
    return (space >= KEY_CHARS / 2 ? head.slice(0, space) : head).trim();
}

/** A summary at most SUMMARY_CHARS long, ending "…" when cut: at the last space past half of it when there is one. */
export function capSummary(summary) {
    const text = String(summary ?? '');
    if (text.length <= SUMMARY_CHARS) return text;
    const head = text.slice(0, SUMMARY_CHARS - 1);
    const space = head.lastIndexOf(' ');
    return `${(space >= SUMMARY_CHARS / 2 ? head.slice(0, space) : head).trimEnd()}…`;
}

/**
 * The line without the labels the Director does not keep (RESERVED_LABEL, IGNORED_LABELS):
 * `{ line, dropped: [label] }`.
 */
export function withoutDroppedLabels(line) {
    const labels = line?.labels;
    if (!labels || typeof labels !== 'object') return { line, dropped: [] };
    const kept = {};
    const dropped = [];
    for (const [label, value] of Object.entries(labels)) {
        const name = String(label).trim();
        if (RESERVED_LABEL.test(name) || RESERVED_LABEL.test(name.toLowerCase()) || IGNORED_LABELS.has(name.toLowerCase())) dropped.push(name);
        else kept[label] = value;
    }
    return dropped.length ? { line: { ...line, labels: kept }, dropped } : { line, dropped };
}

function droppedProblem(line, dropped) {
    const xp = dropped.filter(label => IGNORED_LABELS.has(label.toLowerCase()));
    const other = dropped.filter(label => !IGNORED_LABELS.has(label.toLowerCase()));
    const said = [
        xp.length ? `${xp.map(label => `"${label}:"`).join(', ')} is ignored: quest XP comes from the quest's difficulty, never a written amount` : '',
        other.length ? `${other.map(label => `"${label}:"`).join(', ')} ${other.length === 1 ? 'is a name' : 'are names'} the Director does not keep` : '',
    ].filter(Boolean).join('; ');
    return { kind: 'label', severity: 'info', key: capKey(bareName(line?.name)), op: line?.op, text: `${said}; the rest of the line is used.` };
}

/**
 * The v1 op a v2 line is: `{ op }`, or `{ error }`. The text and labels go through v1's own
 * parser (a stand-in key keeps the name out of it), so `— step: done`, `| reason: …`, a
 * difficulty word and the rest read exactly as v1 reads them.
 */
export function toV1Op(line) {
    const op = line?.op;
    if (!['+', '-', '~', '!'].includes(op)) return { error: `"${lineText(line)}" asks code to decide something; Director lines use + ~ - or !.` };
    const written = bareName(line?.name);
    const key = capKey(written);
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
            raw: clip(String(line?.raw ?? '').trim()) || lineText(line),
        },
        ...(key !== written ? { cut: written.length } : {}),
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

/**
 * Adds a problem to the Director's list. The list is only added to until it holds PROBLEM_ROOM, then
 * cut back to the newest PROBLEM_LIMIT: an append is one small change in the receipt, where cutting it
 * to 50 every time made each new problem rewrite the whole list. Readers show the newest 50.
 */
export function addProblem(director, ctx, problem) {
    const entry = { rev: revOf(ctx), turn: director.turn.n, ...problem };
    for (const name of Object.keys(entry)) if (entry[name] === undefined) delete entry[name];
    if (director.problems.length >= PROBLEM_ROOM) director.problems = [...director.problems.slice(-(PROBLEM_LIMIT - 1)), entry];
    else director.problems.push(entry);
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

// The quests part's offer cooldown as this part reads it (`settings.reads`), else the default.
function offerCooldown(ctx) {
    let value;
    try {
        value = (typeof ctx?.settings === 'function' ? ctx.settings() : ctx?.settings)?.offerCooldown;
    } catch {
        value = undefined;
    }
    return Number.isSafeInteger(value) && value >= 0 ? value : OFFER_COOLDOWN;
}

/** `apply(ctx, line)` for agenda, event, hook, quest, clock, beat and secret lines. */
export function applyThreadLine(ctx, given) {
    const director = ctx.draft('director');
    beginTurn(director, ctx, given);
    const raw = lineText(given);
    // Labels the Director does not keep are left out first (a Problem says which).
    const { line: kept, dropped } = withoutDroppedLabels(given);
    if (dropped.length) addProblem(director, ctx, droppedProblem(given, dropped));
    // A quest line's own labels (F83 `met:`, F85 `progress:`) are taken out before v1 reads it.
    const { line, met, metText } = splitQuestLine(kept);
    if (met !== null && onlyOwnLabels(line)) return metOnly(ctx, director, line, met, metText, raw);
    const read = toV1Op(line);
    if (read.error) {
        addProblem(director, ctx, { kind: 'unread', severity: 'warn', key: String(line?.name ?? ''), op: line?.op, text: read.error });
        return { summary: `Director: ${raw} (not used)`, narrate: false, data: { thread: null, problems: ['unread'] } };
    }
    const op = read.op;
    if (read.cut) addProblem(director, ctx, { kind: 'long-name', severity: 'info', key: op.key, op: op.op, text: `A name ${read.cut} characters long was cut to "${op.key}" (names are at most ${KEY_CHARS}).` });
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
    // F94: a taken quest the story closes as done is turned in by code, or kept open with the reason.
    if (named && named.kind === 'quest' && named.status === 'active' && named.taken && op.op !== '+') {
        const trial = applyOps(toTracker(director), ops, { message: director.turn.n, time: director.time.minutes, said });
        const record = trial.tracker.records.find(entry => entry.id === lineKey(named.key));
        if (record && record.status !== 'active' && outcomeOf(record) === 'done') {
            if (met !== null) applyMet(ctx, director.threads[named.id], met, metText, revOf(ctx));
            const out = storyTurnIn(ctx, director, named, { addProblem, raw });
            if (out) return out;
        }
    }
    const result = applyOps(tracker, ops, { message: director.turn.n, time: director.time.minutes, said });
    const findings = (again ? result.problems.slice(1) : result.problems).filter(finding => finding.key !== OTHER_QUEST.key);
    const records = result.tracker.records.filter(record => record.id !== OTHER_QUEST.id);
    // One reply adds at most NEW_THREADS_PER_REPLY threads: past that a line that would add one is not used.
    const known = new Set(orderedThreads(director).map(thread => lineKey(thread.key)));
    const adding = records.filter(record => !known.has(record.id)).length;
    const addedSoFar = Number.isSafeInteger(director.turn.added) ? director.turn.added : 0;
    if (adding > 0 && addedSoFar + adding > NEW_THREADS_PER_REPLY) {
        addProblem(director, ctx, { kind: 'too-many', severity: 'warn', key: op.key, op: op.op, text: `"${op.key}" was not added: one reply adds at most ${NEW_THREADS_PER_REPLY} new threads.` });
        return { summary: `Director: ${raw} (not used)`, narrate: false, data: { thread: null, problems: ['too-many'] } };
    }
    if (adding > 0) director.turn.added = addedSoFar + adding;

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
    // A summary (v1's `desc`) longer than SUMMARY_CHARS is cut, with a Problem.
    for (const record of records) {
        const desc = String(record.fields?.desc ?? '');
        if (desc.length <= SUMMARY_CHARS) continue;
        record.fields.desc = capSummary(desc);
        addProblem(director, ctx, { kind: 'long-summary', severity: 'info', key: record.key, op: op.op, text: `The summary of "${record.key}" was ${desc.length} characters long; it was cut to ${SUMMARY_CHARS}.` });
    }
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
    const current = thread ? director.threads[thread] : null;
    if (current?.kind === 'quest') {
        capNote(current);
        // F82: a quest the story starts with no goal is kept and flagged once.
        if (op.op === '+' && current.status === 'active' && !(named?.kind === 'quest') && !questHasGoal(ctx, current)) addProblem(director, ctx, noGoalProblem(current));
        if (met !== null) {
            const { problem } = applyMet(ctx, current, met, metText, revOf(ctx));
            if (problem) addProblem(director, ctx, problem);
        }
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
    // F88: an offer is shown now, or held until the offer cooldown has passed: only one this line made
    // an offer (an older offer, kept from before offers were marked, is never held afterwards).
    if (current && !(named?.offer && named.status === 'active')) {
        markOffer(director, director.threads[thread], offerCooldown(ctx));
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
    markOffer(director, thread, offerCooldown(ctx));
}

// `~ quest Name | met: yes` and nothing else (F83): read without v1's rules, which would count a bare
// `~` as the story touching the thread or add a name it does not know.
function metOnly(ctx, director, line, met, metText, raw) {
    const id = director.keys[lineKey(bareName(line.name))];
    const thread = id ? director.threads[id] : null;
    if (!thread) {
        addProblem(director, ctx, { kind: 'met', severity: 'warn', key: String(line.name ?? ''), op: '~', text: `"${String(line.name ?? '').trim()}" is not a tracked quest; met: changed nothing.` });
        return { summary: `Director: ${raw} (not used)`, narrate: false, data: { thread: null, problems: ['met'] } };
    }
    const { problem } = applyMet(ctx, thread, met, metText, revOf(ctx));
    if (problem) addProblem(director, ctx, problem);
    return { summary: `Director: ${raw}`, narrate: false, data: { thread: thread.id, problems: problem ? [problem.kind] : [] } };
}

/** `apply(ctx, line)` for `time` lines: `~ time <date, clock time>`, `! time +2h`. */
export function applyTimeLine(ctx, line) {
    const director = ctx.draft('director');
    beginTurn(director, ctx, line);
    const settings = settingsFrom(typeof ctx.settings === 'function' ? ctx.settings() : ctx.settings);
    const calendar = calendarOf(settings, packCalendarOf(ctx.query));
    const next = timeAfter(line, director.time.minutes, calendar, { maxJump: maxJumpMinutes(settings) });
    if (next.problem) addProblem(director, ctx, { kind: 'time', severity: 'warn', key: String(line?.name ?? '').slice(0, KEY_CHARS), op: line?.op, text: next.problem });
    if (next.error) {
        addProblem(director, ctx, { kind: 'time', severity: 'warn', key: String(line?.name ?? '').slice(0, KEY_CHARS), op: line?.op, text: next.error });
        return { summary: `Director: ${lineText(line)} (not used)`, narrate: false, data: { minutes: director.time.minutes } };
    }
    const before = director.time.minutes;
    if (next.minutes !== before) director.time.minutes = next.minutes;
    return {
        summary: `Story time: ${calendar.format(next.minutes)}.`,
        narrate: false,
        data: { minutes: next.minutes, from: before, ...(next.held ? { held: next.held } : {}) },
    };
}
