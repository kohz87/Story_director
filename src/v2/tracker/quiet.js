// Story Director v2, tracker part: threads that stop counting as open (read time only; nothing is stored, closed or written).
//
// Two kinds, both worked out from what the state already holds, so a rebuilt, swiped or reloaded chat reads the same:
// * a beat the story has fired: the quest log the Chronicle keeps (`chronicle.questLog`, each line as the story wrote it) says
//   its last line that mattered was a `!`; a line that writes its date again (`+`, `on:`, `due:`) makes it live (v1's lapses.js rule);
// * a dead person's own threads: their agenda (the key is their name or an alias) and a beat whose key names them in whole words
//   ("Vorn's Return"). Dead = NPC State Delta's `npc.dossier` says `lifeState: 'deceased'` (by name or alias, and by the np_ id
//   a pinned person carries, which also answers for an archived dossier), or the story's own "- key Name | died" for a pinned person
//   (the `gone` record). Without NPC State Delta, and with nobody dead, nothing is quiet. Secrets, hooks, quests, clocks, events
//   and any thread that merely mentions someone are never touched. If Delta stops saying deceased the threads are back.
//
// `quietThreads` → Set of thread ids; `dropThreads(director, ids)` → the same director without them (the same object when none).

import { lineKey } from '../../changes.js';
import { ask, cutPoints, flat, wholeWord } from './scene.js';

const MAX_PROBES = 60;
const PER_THREAD = 12;
const NP_ID = /^np_[0-9a-z]{8}$/;
const WRITES_DATE = /(?<![\p{L}\p{N}])(?:on|due)\s*:/iu;
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Whether the quest-log lines of a thread (`[{ rev, text }]`) say its beat was fired and not dated again since. */
export function firedByLog(lines) {
    for (const entry of [...lines].sort((a, b) => b.rev - a.rev)) {
        const text = String(entry.text ?? '').trimStart();
        if (text.startsWith('+') || WRITES_DATE.test(text)) return false;
        if (text.startsWith('!')) return true;
    }
    return false;
}

function logsById(chronicle) {
    const out = new Map();
    const log = isRecord(chronicle?.questLog) ? chronicle.questLog : {};
    for (const [rev, entry] of Object.entries(log)) {
        if (!/^\d+$/.test(rev) || !isRecord(entry) || typeof entry.thread !== 'string') continue;
        if (!out.has(entry.thread)) out.set(entry.thread, []);
        out.get(entry.thread).push({ rev: Number(rev), text: entry.text });
    }
    return out;
}

// The words a beat's key may name a person by: runs of 1 to 3 words, "'s" taken off ("Vorn's Return" → Vorn, Vorn's Return…).
function candidates(key) {
    const words = flat(key).split(' ').map(word => word.replace(/['’]s$/iu, '')).filter(Boolean);
    const out = [];
    for (let size = 1; size <= 3; size += 1) for (let at = 0; at + size <= words.length; at += 1) out.push(words.slice(at, at + size).join(' '));
    return out.filter(name => name.length >= 3).slice(0, PER_THREAD);
}

const aliasesOf = value => (Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []);
const namesOf = dossier => [dossier?.name, ...aliasesOf(dossier?.aliases)].map(name => cutPoints(name, 80)).filter(name => name.length >= 3);

/** The names of the dead among the threads' own names and the pinned: `[{ names: [name…] }]`. */
function deadPeople(query, director, state) {
    if (!Array.isArray(ask(query, 'npc.known', {}, null))) return [];
    const dead = [];
    const seen = new Set();
    let probes = 0;
    const take = (dossier, extra = []) => {
        if (dossier?.lifeState !== 'deceased') return;
        const names = [...new Set([...namesOf(dossier), ...extra])];
        const key = names.map(lineKey).sort().join('|');
        if (names.length && !seen.has(key)) { seen.add(key); dead.push({ names }); }
    };
    const asked = new Set();
    for (const thread of Object.values(isRecord(director?.threads) ? director.threads : {})) {
        if (!isRecord(thread) || thread.status !== 'active' || (thread.kind !== 'agenda' && thread.kind !== 'beat')) continue;
        for (const name of thread.kind === 'agenda' ? [flat(thread.key)] : candidates(thread.key)) {
            const key = lineKey(name);
            if (!key || asked.has(key) || probes >= MAX_PROBES) continue;
            asked.add(key);
            probes += 1;
            const dossier = ask(query, 'npc.dossier', { name }, null);
            // Exact only: the answer must go by the very name asked for.
            if (isRecord(dossier) && namesOf(dossier).some(own => lineKey(own) === key)) take(dossier);
        }
    }
    const pins = isRecord(state?.domains?.keypeople?.pins) ? Object.values(state.domains.keypeople.pins) : [];
    for (const pin of pins.slice(0, 40)) {
        if (!isRecord(pin) || typeof pin.npc !== 'string' || !NP_ID.test(pin.npc) || probes >= MAX_PROBES) continue;
        probes += 1;
        const dossier = ask(query, 'npc.dossier', { id: pin.npc }, null);
        if (isRecord(dossier)) take(dossier, [pin.name, ...aliasesOf(pin.aliases)].map(name => cutPoints(name, 80)).filter(name => name.length >= 3));
    }
    return dead;
}

// The story's own "- key Name | died" for a pinned person.
function storyDead(state) {
    const gone = isRecord(state?.domains?.keypeople?.gone) ? Object.values(state.domains.keypeople.gone) : [];
    return gone.filter(entry => isRecord(entry) && entry.reason === 'died').map(entry => ({ names: [cutPoints(entry.name, 80)].filter(name => name.length >= 3) })).filter(person => person.names.length);
}

/** The ids of the open threads that no longer wait on the story: a fired beat, and a dead person's agenda or named beat. */
export function quietThreads(director, { state = null, query = null } = {}) {
    const ids = new Set();
    const threads = Object.values(isRecord(director?.threads) ? director.threads : {}).filter(thread => isRecord(thread) && thread.status === 'active');
    if (!threads.some(thread => thread.kind === 'beat' || thread.kind === 'agenda')) return ids;
    const logs = logsById(state?.domains?.chronicle);
    for (const thread of threads) if (thread.kind === 'beat' && logs.has(thread.id) && firedByLog(logs.get(thread.id))) ids.add(thread.id);
    const dead = [...deadPeople(query, director, state), ...storyDead(state)];
    if (!dead.length) return ids;
    for (const thread of threads) {
        const key = flat(thread.key);
        if (thread.kind === 'agenda' && dead.some(person => person.names.some(name => lineKey(name) === lineKey(key)))) ids.add(thread.id);
        else if (thread.kind === 'beat' && dead.some(person => person.names.some(name => wholeWord(key, name)))) ids.add(thread.id);
    }
    return ids;
}

/** `director` without the threads `ids` names (the same object when there are none). Their keys stay, as the tail's other cuts leave them. */
export function dropThreads(director, ids) {
    if (!ids?.size || !isRecord(director?.threads)) return director;
    return { ...director, threads: Object.fromEntries(Object.entries(director.threads).filter(([id, thread]) => !ids.has(id) && !ids.has(thread?.id))) };
}
