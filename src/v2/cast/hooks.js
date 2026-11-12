// Story Director v2, part **cast**: the two hooks that run the living cast.
//
// * `afterReceive` (a reply has arrived and been read): when the story day changed or a stretch of time passed since the cast last
//   moved, or a goal the story just touched may be pulling someone to the party, the planner is asked (plan.js) in the background, on
//   the model's own connection or the chat's (which is free by then). Nothing is written here.
// * `beforeGenerate` (a reply is about to be written): up to three system steps, in this order, each only when it has something to say:
//   `cast.sync` (the packs' cast joined, changed or left), `cast.advance` (the planner's answer, or the clock followed back), `cast.meet`
//   (someone crosses the party's path, by place and routine or by a goal the planner cited). The steps are on the reply, so a swipe takes
//   them back and does them again (the planner's answer is kept, so who comes does not change with a rewrite of the scene), and a
//   rebuild gives the same world. A Continue (the same reply goes on) commits nothing.
//
// Without a model (an older Story Block, or the call failing) nobody moves, and meetings by place still happen. With no cast in the
// enabled packs the hooks do nothing at all, so the prompt and the state are as they were.

import { applyAdvance, applyJourney, applyMeet, applyRumor, applySync, planSync, syncEmpty, syncPayload } from './apply.js';
import { sha256 } from '../hash.js';
import { personaName } from '../tracker/initiative.js';
import { cueLines, pinned } from './note.js';
import { cutPoints, isInt, keysOfPerson, slotOf } from './domain.js';
import { castOf, fightOn, foesLeftover, linksOf, packName, pulseResults, partyPlace, presentKeys, roadsOf, seenKeys, ask } from './entries.js';
import { MAX_PEOPLE_ASKED, MAX_SOUGHT, MAX_TOKENS, castRequest, readCast, touches } from './plan.js';
import { kindWords } from './sought.js';
import { CALL_MS, FEATURE, HOLD_MS, castOn, settingsOf } from './settings.js';
import { askedAbout, batchKey, chooseMeetings, chooseRumor, dueMove, fingerprint, judgeKey, metInTheStory, moveReach, movable, paceOf, placedOf, refsOf, seekable, sortComes, unshown } from './world.js';

const REPLY_TYPES = new Set(['normal', 'regenerate', 'swipe']);
const normalizeType = type => String(type ?? 'normal').toLowerCase();
const queryOf = view => (typeof view?.query === 'function' ? (name, args) => view.query(name, args) : null);

// The hidden parts of a message out, as the arc planner reads the story.
const MARKUP = /<!--[\s\S]*?-->|<(think|thinking|reasoning|Changes|Changes-assist|Changes-assist-next)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

/** The words of a message as the reader sees them: hidden comments and the change block out. */
export const shownText = mes => String(mes ?? '').replace(MARKUP, ' ');

/** The last few messages of the story as plain text, the newest characters kept. */
export function recentStory(chat, { messages = 3, chars = 3500 } = {}) {
    const list = (Array.isArray(chat) ? chat : []).filter(message => message && !message.is_system).slice(-messages);
    const text = list.map(message => `${message.name || (message.is_user ? 'User' : 'Narrator')}: ${String(message.mes ?? '').replace(MARKUP, '').replace(/\n{3,}/g, '\n\n').trim()}`).join('\n\n');
    return text.length > chars ? text.slice(text.length - chars) : text;
}

// ---- what the reader asked for -------------------------------------------------------------------------------------------------------

const byReader = message => Boolean(message) && message.is_user === true && !message.is_system;
const byStory = message => Boolean(message) && !message.is_user && !message.is_system;

/** The reader's latest message and the story's last reply as the reader sees them, or null when neither has words. */
export function soughtTexts(chat) {
    const list = Array.isArray(chat) ? chat : [];
    const reader = list.findLast(byReader);
    const reply = list.findLast(byStory);
    const texts = { reader: shownText(reader?.mes).trim(), reply: shownText(reply?.mes).trim() };
    return texts.reader || texts.reply ? texts : null;
}

/** The chat as it stands for the reply being written: a reply being swiped or redone is not part of it. */
const baseOf = (chat, type) => {
    const list = Array.isArray(chat) ? chat : [];
    return list.length && byStory(list.at(-1)) && (type === 'swipe' || type === 'regenerate') ? list.slice(0, -1) : list;
};

/** The chat as the last reply left it (what `afterReceive` saw): the reader's message that came after the last reply is not part of it. */
const afterReply = chat => {
    const list = Array.isArray(chat) ? chat : [];
    const last = list.findLastIndex(byStory);
    return last < 0 ? [] : list.slice(0, last + 1);
};

const soughtKey = (print, texts) => `sought|${print}|${sha256(`${texts.reader}\u0000${texts.reply}`).slice(0, 12)}`;

function chatId() {
    try {
        const id = globalThis.SillyTavern?.getContext?.()?.getCurrentChatId?.();
        return typeof id === 'string' ? id : '';
    } catch {
        return '';
    }
}

const minutesOf = view => {
    const value = view?.state?.domains?.director?.time?.minutes;
    return isInt(value) ? value : null;
};

// What both hooks read: the cast the packs list, the state's slice, the scene, who is pinned.
function frameOf(view) {
    const query = queryOf(view);
    const cast = castOf(query);
    const slice = view?.state?.domains?.cast;
    const now = minutesOf(view);
    const pinned = new Set();
    const keyPeople = ask(query, 'director.keyPeople', {}, null);
    for (const entry of Array.isArray(keyPeople) ? keyPeople : []) {
        if (entry && typeof entry === 'object' && !entry.removed) for (const key of keysOfPerson(entry)) pinned.add(key);
    }
    return {
        query, cast, slice, now, pinned,
        present: presentKeys(query, view?.state),
        party: partyPlace(query, view?.state),
        settings: settingsOf(view?.settings),
        calendar: ask(query, 'time.now', {}, null),
    };
}

const copyOf = slice => {
    const own = structuredClone(slice && typeof slice === 'object' ? slice : {});
    return { people: own.people ?? {}, notes: own.notes ?? {}, day: own.day ?? null, meeting: own.meeting ?? null };
};

const placesOf = query => {
    const list = ask(query, 'packs.content', { kind: 'places' }, null);
    return (Array.isArray(list) ? list : []).map(place => cutPoints(place?.name, 80)).filter(Boolean);
};

const elapsedText = (from, to) => {
    const minutes = to - from;
    if (minutes >= 1440 * 0.75) {
        const days = Math.max(1, Math.round(minutes / 1440));
        return `${days} day${days === 1 ? '' : 's'}`;
    }
    const hours = Math.max(1, Math.round(minutes / 60));
    return `${hours} hour${hours === 1 ? '' : 's'}`;
};

// A planner call whose connection failed (error FAILED) is made once more, but only while the reply's own wait (HOLD_MS) has not run out;
// a refusal or an empty answer is not asked again, an answer that does not parse is no failure at all, and a timeout (CALL_MS is longer
// than HOLD_MS) has already used up the wait, so it is not asked again either. One extra request at most, only after such a failure.
const RETRY_ON = new Set(['FAILED']);
async function callOnce(model, request) {
    const startedAt = Date.now();
    const first = await model.callModel(request);
    if (first?.ok || !RETRY_ON.has(first?.error) || Date.now() - startedAt >= HOLD_MS) return first;
    return model.callModel(request);
}

/** The line the reply a planner call failed for is told (through the problem channel of the hook's answer). */
export const PLAN_FAILED = Object.freeze({ code: 'CAST_PLAN_FAILED', message: 'cast planner failed for this reply' });
const failedPlan = entry => entry?.status === 'failed' || (entry?.status === 'done' && entry.result?.ok === false);
// A failure belongs to the reply it was first told on (a swipe of that reply has the same `at` and is told again); later replies plan normally.
const toldHere = (entry, at) => {
    if (!failedPlan(entry)) return false;
    entry.toldAt ??= at ?? -1;
    return entry.toldAt === (at ?? -1);
};

/** The plans the hooks share (in memory), and the counters tests read. */
export function createCastHooks({ plans }) {
    // Asks the planner for `mode` over `people`, keeping the answer under `key`.
    function askPlanner(view, frame, key, mode, list, due) {
        const model = view?.model;
        if (typeof model?.callModel !== 'function') return null;
        const asked = list.slice(0, MAX_PEOPLE_ASKED);
        const refs = refsOf(asked);
        const allow = {
            come: new Set(asked.filter(item => !item.met && item.entry.drawnTo.length).map(item => item.key)),
            die: new Set(mode === 'batch' ? asked.filter(item => item.mayDie).map(item => item.key) : []),
        };
        const request = castRequest({
            mode, people: asked.map(askedAbout),
            now: frame.calendar?.text ?? '', elapsed: due ? elapsedText(due.from, due.to) : '',
            place: [frame.party.place, frame.party.region].filter(Boolean).join(', '),
            places: placesOf(frame.query), recent: recentStory(view?.model?.chat?.()),
        });
        const profile = frame.settings.profile;
        return plans.start(key, async () => {
            const result = await callOnce(model, { profile, system: request.system, prompt: request.prompt, maxTokens: MAX_TOKENS, feature: FEATURE, timeoutMs: CALL_MS });
            if (!result?.ok) return { ok: false };
            const read = readCast(result.text, { refs, allow });
            return mode === 'judge' ? { ok: true, moves: [], comes: read.comes, died: [] } : { ok: true, ...read };
        });
    }

    // Asks the planner whether the reader's message (or the story's last reply) looks for the kind of person one of `list` is.
    function askSought(view, frame, key, list, texts) {
        const model = view?.model;
        if (typeof model?.callModel !== 'function') return null;
        const asked = list.slice(0, MAX_SOUGHT);
        const refs = refsOf(asked);
        const request = castRequest({
            mode: 'sought', now: frame.calendar?.text ?? '', place: [frame.party.place, frame.party.region].filter(Boolean).join(', '), texts,
            people: asked.map(item => ({ ref: item.ref, name: item.person.name, goal: item.entry.goal, routine: item.entry.routine, where: item.person.where, kind: kindWords(item.entry), met: false })),
        });
        const allow = { seek: new Set(asked.map(item => item.key)), kind: new Map(asked.map(item => [item.key, item.entry])) };
        return plans.start(key, async () => {
            const result = await model.callModel({ profile: frame.settings.profile, system: request.system, prompt: request.prompt, maxTokens: MAX_TOKENS, feature: FEATURE, timeoutMs: CALL_MS });
            if (!result?.ok) return { ok: false };
            // The cited words must stand in the reader's message or the reply as they were when the planner read them (readCast refuses others).
            return { ok: true, moves: [], comes: [], died: [], sought: readCast(result.text, { refs, allow, texts: [texts.reader, texts.reply] }).sought ?? [] };
        });
    }

    // The sought people for the reply being written: asked of the reader's newest message now when the planner has a connection of its own
    // (it can be waited for), else what was asked after the last reply (the chat's own connection is free only then). Null-safe: [] for none.
    async function soughtFor(view, frame, world, print, type, waitMs = HOLD_MS) {
        if (typeof view?.model?.callModel !== 'function') return [];
        const chat = view.model.chat?.();
        const base = baseOf(chat, type);
        const gate = texts => seekable(world, frame.cast, { present: frame.present, pinned: frame.pinned, text: texts.reader });
        const now = soughtTexts(base);
        if (now && frame.settings.profile) {
            const list = gate(now);
            const key = soughtKey(print, now);
            if (list.length) {
                const entry = plans.peek(key) ?? askSought(view, frame, key, list, now);
                const settled = entry ? await plans.settled(key, waitMs) : null;
                if (settled?.status === 'done' && settled.result?.ok && settled.result.sought.length) return settled.result.sought;
            }
        }
        const before = soughtTexts(afterReply(base));
        const entry = before ? plans.peek(soughtKey(print, before)) : null;
        return entry?.status === 'done' && entry.result?.ok ? entry.result.sought : [];
    }

    function batchPeople(slice, frame, due) {
        return movable(slice, frame.cast, { to: due.to, present: frame.present, pinned: frame.pinned, unmetDie: frame.settings.unmetDie });
    }

    /** `afterReceive(view)`: asks the planner in the background when the cast is due to move or a goal may have been touched. */
    function afterReceive(view) {
        if (!castOn(view)) return undefined;
        if (typeof view?.model?.callModel !== 'function') return undefined;
        const frame = frameOf(view);
        if (frame.cast.listed && frame.cast.entries.length && !frame.settings.profile) {
            // The reader may be looking for a kind of person: asked of the planner now, used by the next reply. (A named connection is asked
            // in `beforeGenerate` instead, about the message that is going out, and waited for.)
            const texts = soughtTexts(view?.model?.chat?.());
            const list = texts ? seekable(frame.slice, frame.cast, { present: frame.present, pinned: frame.pinned, text: texts.reader }) : [];
            if (list.length) askSought(view, frame, soughtKey(fingerprint(frame.slice, chatId()), texts), list, texts);
        }
        if (!frame.cast.listed || !frame.cast.entries.length || !isInt(frame.now)) return undefined;
        const slice = frame.slice;
        const print = fingerprint(slice, chatId());
        const due = dueMove(slice, frame.now);
        if (due && !due.reset) {
            const list = batchPeople(slice, frame, due);
            if (list.length) askPlanner(view, frame, batchKey(print, due), 'batch', list, due);
            return undefined;
        }
        // Between two moves: a goal the story just came near.
        // The planner is asked as before when the story came near a goal; whether it may act is the code's (`sortComes`: a real link, within reach).
        const recent = recentStory(view?.model?.chat?.());
        const eligible = movable(slice, frame.cast, { present: frame.present, pinned: frame.pinned }).filter(item => !item.met && item.entry.drawnTo.length);
        const touched = eligible.filter(item => touches(item.entry.drawnTo, recent));
        if (touched.length) askPlanner(view, frame, judgeKey(print, frame.now), 'judge', touched, null);
        return undefined;
    }

    /** `beforeGenerate(view, info)`: `{ commands }` or nothing. */
    async function beforeGenerate(view, info = {}) {
        if (!castOn(view)) return undefined;
        // A Continue (the same reply goes on) commits nothing but is told the same cue again (from the state it has).
        if (info?.commit === false) {
            if (normalizeType(info?.type) !== 'continue') return undefined;
            const cast = castOf(queryOf(view));
            const lines = cueLines(view?.state?.domains?.cast, cast, isInt(view?.chat?.length) ? view.chat.length : null);
            return lines.length ? { lines: pinned(lines) } : undefined;
        }
        if (!REPLY_TYPES.has(normalizeType(info?.type))) return undefined;
        const startedAt = Date.now();
        const frame = frameOf(view);
        if (!frame.cast.listed) return undefined;
        const commands = [];
        const rev = isInt(view?.state?.meta?.rev) ? view.state.meta.rev + 1 : 0;
        // The index the reply about to be written lands at: the cards of these steps go under it.
        const at = isInt(view?.chat?.length) ? view.chat.length - (normalizeType(info?.type) === 'swipe' ? 1 : 0) : null;
        const world = copyOf(frame.slice);
        const print = fingerprint(frame.slice, chatId());
        const names = Object.fromEntries(Object.keys(frame.cast.packs).slice(0, 8).map(pack => [pack, cutPoints(packName(frame.cast, pack), 80)]));

        // 1. The packs' cast: who joined, changed or left.
        const plan = planSync(world, frame.cast, { now: frame.now });
        if (!syncEmpty(plan)) {
            const payload = { ...syncPayload(plan), names, ...(at !== null ? { at } : {}) };
            commands.push({ type: 'cast.sync', payload });
            applySync(world, payload, { now: frame.now, rev });
        }
        if (!frame.cast.entries.length && !Object.keys(world.people).length) return commands.length ? { commands } : undefined;

        // 2. A day change or a time skip: the planner's answer (or only the clock, when it went back).
        let comes = [];
        let planFailed = false;
        const due = dueMove(world, frame.now);
        if (due?.reset) {
            commands.push({ type: 'cast.advance', payload: { from: due.from, to: due.to, ...(at !== null ? { at } : {}) } });
            applyAdvance(world, { from: due.from, to: due.to }, { rev });
        } else if (due) {
            const list = batchPeople(world, frame, due);
            if (list.length && typeof view?.model?.callModel === 'function') {
                const key = batchKey(print, due);
                let entry = plans.peek(key);
                const fresh = !entry;
                // A named connection answers at once; the chat's own only once the reply is over, so it is asked after the last reply
                // (afterReceive) and used now; when it was not, it is asked now and used by the next reply.
                if (!entry) entry = askPlanner(view, frame, key, 'batch', list, due);
                entry = entry && (!fresh || frame.settings.profile) ? await plans.settled(key, HOLD_MS) : null;
                if (entry && entry.status !== 'pending') {
                    planFailed = toldHere(entry, at);
                    const result = entry.status === 'done' && entry.result?.ok ? entry.result : { moves: [], comes: [], died: [] };
                    const allowedDeaths = new Set(list.filter(item => item.mayDie).map(item => item.key));
                    const died = result.died.filter(item => allowedDeaths.has(item.key)).map(item => ({ key: item.key }));
                    // A place the planner names that is one of the pack's goes by the pack's own name for it.
                    // A move the road trip does not fit in the time since they were placed, or since they left their last known place, is left out,
                    // as is one with no road towards the party's place, town or region (the town by the atlas's ids and parent links); one with no road elsewhere keeps that last known place (`from`).
                    // Someone on a journey towards the party is not moved (their landing time is the trip's from where they set out).
                    const reach = { party: frame.party, to: due.to, travel: roadsOf(frame.query), placed: placedOf(world) };
                    const moves = result.moves.map(move => ({ ...move, where: frame.cast.places.match(move.where) ?? move.where })).flatMap(move => {
                        const person = world.people[move.key];
                        if (!person) return [move];
                        const fit = slotOf(person.coming) ? null : moveReach(person, move.where, reach);
                        return fit ? [fit.from ? { ...move, from: fit.from } : move] : [];
                    });
                    const payload = { from: due.from, to: due.to, ...(at !== null ? { at } : {}), ...(moves.length ? { moves } : {}), ...(died.length ? { died } : {}) };
                    commands.push({ type: 'cast.advance', payload });
                    applyAdvance(world, payload, { rev });
                    comes = result.comes ?? [];
                }
            }
        } else if (frame.now !== null) {
            let entry = plans.peek(judgeKey(print, frame.now));
            if (entry?.status === 'pending') entry = await plans.settled(judgeKey(print, frame.now), HOLD_MS);
            if (entry?.status === 'done' && entry.result?.ok) comes = entry.result.comes ?? [];
            planFailed = toldHere(entry, at);
        }

        // 3. Paths cross.
        if (at !== null) {
            // A Foes slot that has not moved over the last replies (the pulse's records) is a leftover, not a fight (the pulse's own rule).
            const leanOn = (typeof view?.feature !== 'function' || view.feature('story-block.rpg') !== false) && !foesLeftover(view?.state, pulseResults(view?.state, at));
            const fight = fightOn(frame.query, view?.state, { leanOn });
            const sought = await soughtFor(view, frame, world, print, normalizeType(info?.type), Math.max(0, HOLD_MS - (Date.now() - startedAt)));
            // (The hook as a whole has HOOK_MS: the planner's batch and the sought answer share the one wait, so a slow connection cannot time the step out.)
            // A goal pulls only with a real link and only from within reach; from far it is a journey (landing after the real trip), not an arrival.
            const roads = roadsOf(frame.query);
            const sorted = sortComes(world, frame.cast, { comes, party: frame.party, now: frame.now, travel: roads, links: linksOf(frame.query, view?.state), present: frame.present, pinned: frame.pinned });
            if (sorted.start.length || sorted.stop.length || sorted.land.length) {
                const payload = { ...(sorted.start.length ? { start: sorted.start } : {}), ...(sorted.stop.length ? { stop: sorted.stop } : {}), ...(sorted.land.length ? { land: sorted.land } : {}) };
                commands.push({ type: 'cast.journey', payload });
                applyJourney(world, payload, { now: frame.now, rev });
            }
            const picks = chooseMeetings(world, frame.cast, {
                now: frame.now, party: frame.party, comes: sorted.meet, sought, fight, pace: paceOf(frame.settings), present: frame.present, pinned: frame.pinned, travel: roads, persona: personaName(),
            });
            // Someone sought who is elsewhere is heard of, with no name (no meeting in this reply to share the cue with).
            const rumor = chooseRumor(world, frame.cast, { party: frame.party, sought, fight, met: picks, present: frame.present, pinned: frame.pinned });
            // Someone the story already has in the scene is met at once, as they are (no cue, no pace).
            picks.push(...metInTheStory(world, frame.cast, { present: frame.present, party: frame.party, persona: personaName() }));
            if (picks.length) {
                const payload = { at, who: picks, names };
                commands.push({ type: 'cast.meet', payload });
                applyMeet(world, payload, { now: frame.now, rev });
            }
            if (rumor) {
                const payload = { at, who: [rumor], names };
                commands.push({ type: 'cast.rumor', payload });
                applyRumor(world, payload, { now: frame.now, rev });
            }
        }
        // The cue and the rumor go as pinned lines of this reply (Story Block keeps a `keep` cue whatever the tail budget says).
        const lines = pinned(cueLines(world, frame.cast, isInt(view?.chat?.length) ? view.chat.length : null));
        const problems = planFailed ? [PLAN_FAILED] : [];
        return commands.length || lines.length || problems.length ? { ...(commands.length ? { commands } : {}), ...(lines.length ? { lines } : {}), ...(problems.length ? { problems } : {}) } : undefined;
    }

    /**
     * `afterCapture(view, info)` (once the reply's change lines have run, and again on a Re-read): a person the meeting brought into this reply
     * who the reply does not show (their name or an alias in its words, or a `+ present` line) has their meeting taken back, as one
     * `cast.withdraw` step on the reply. It runs before NPC State Delta's step after the reply, so no dossier is made for them.
     */
    function afterCapture(view, info = {}) {
        if (!castOn(view)) return undefined;
        const slice = view?.state?.domains?.cast;
        if (!slice?.meeting || !isInt(info?.index)) return undefined;
        const chat = typeof view?.story?.chat === 'function' ? view.story.chat() : null;
        const message = Array.isArray(chat) ? chat[info.index] : null;
        if (!message || typeof message.mes !== 'string') return undefined;
        const keys = unshown(slice, { index: info.index, text: shownText(message.mes), present: presentKeys(queryOf(view), view?.state), seen: seenKeys(info.receipts) });
        return keys.length ? { commands: [{ type: 'cast.withdraw', payload: { at: info.index, keys } }] } : undefined;
    }

    return { afterReceive, afterCapture, beforeGenerate };
}
