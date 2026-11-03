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

import { applyAdvance, applyMeet, applySync, planSync, syncEmpty, syncPayload } from './apply.js';
import { cutPoints, isInt, keysOfPerson } from './domain.js';
import { castOf, fightOn, packName, partyPlace, presentKeys, ask } from './entries.js';
import { MAX_PEOPLE_ASKED, MAX_TOKENS, castRequest, readCast, touches } from './plan.js';
import { CALL_MS, FEATURE, HOLD_MS, castOn, settingsOf } from './settings.js';
import { askedAbout, batchKey, chooseMeetings, dueMove, fingerprint, judgeKey, metInTheStory, movable, paceOf, refsOf, unshown } from './world.js';

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
            const result = await model.callModel({ profile, system: request.system, prompt: request.prompt, maxTokens: MAX_TOKENS, feature: FEATURE, timeoutMs: CALL_MS });
            if (!result?.ok) return { ok: false };
            const read = readCast(result.text, { refs, allow });
            return mode === 'judge' ? { ok: true, moves: [], comes: read.comes, died: [] } : { ok: true, ...read };
        });
    }

    function batchPeople(slice, frame, due) {
        return movable(slice, frame.cast, { to: due.to, present: frame.present, pinned: frame.pinned, unmetDie: frame.settings.unmetDie });
    }

    /** `afterReceive(view)`: asks the planner in the background when the cast is due to move or a goal may have been touched. */
    function afterReceive(view) {
        if (!castOn(view)) return undefined;
        if (typeof view?.model?.callModel !== 'function') return undefined;
        const frame = frameOf(view);
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
        const recent = recentStory(view?.model?.chat?.());
        const eligible = movable(slice, frame.cast, { present: frame.present, pinned: frame.pinned }).filter(item => !item.met && item.entry.drawnTo.length);
        const touched = eligible.filter(item => touches(item.entry.drawnTo, recent));
        if (touched.length) askPlanner(view, frame, judgeKey(print, frame.now), 'judge', touched, null);
        return undefined;
    }

    /** `beforeGenerate(view, info)`: `{ commands }` or nothing. */
    async function beforeGenerate(view, info = {}) {
        if (!castOn(view) || info?.commit === false || !REPLY_TYPES.has(normalizeType(info?.type))) return undefined;
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
                    const result = entry.status === 'done' && entry.result?.ok ? entry.result : { moves: [], comes: [], died: [] };
                    const allowedDeaths = new Set(list.filter(item => item.mayDie).map(item => item.key));
                    const died = result.died.filter(item => allowedDeaths.has(item.key)).map(item => ({ key: item.key }));
                    // A place the planner names that is one of the pack's goes by the pack's own name for it.
                    const moves = result.moves.map(move => ({ ...move, where: frame.cast.places.match(move.where) ?? move.where }));
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
        }

        // 3. Paths cross.
        if (at !== null) {
            const picks = chooseMeetings(world, frame.cast, {
                now: frame.now, party: frame.party, comes, fight: fightOn(frame.query, view?.state, { leanOn: typeof view?.feature !== 'function' || view.feature('story-block.rpg') !== false }), pace: paceOf(frame.settings), present: frame.present, pinned: frame.pinned,
            });
            // Someone the story already has in the scene is met at once, as they are (no cue, no pace).
            picks.push(...metInTheStory(world, frame.cast, { present: frame.present, party: frame.party }));
            if (picks.length) {
                const payload = { at, who: picks, names };
                commands.push({ type: 'cast.meet', payload });
                applyMeet(world, payload, { now: frame.now, rev });
            }
        }
        return commands.length ? { commands } : undefined;
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
        const keys = unshown(slice, { index: info.index, text: shownText(message.mes), present: presentKeys(queryOf(view), view?.state) });
        return keys.length ? { commands: [{ type: 'cast.withdraw', payload: { at: info.index, keys } }] } : undefined;
    }

    return { afterReceive, afterCapture, beforeGenerate };
}
