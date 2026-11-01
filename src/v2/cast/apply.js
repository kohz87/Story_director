// Story Director v2, part **cast**: how the three steps change the `cast` domain (pure: they change the draft they are given).
//
// * `sync`: the packs' cast entered, changed or left. New people join the world at the current story minute, at their start.
//   An unmet person whose entry changed takes the new words (name, aliases) and keeps where they are and what they do; a met
//   person keeps their dossier (it was made from the entry once; the pack never overwrites it); an entry that left the pack
//   takes an unmet person with it, quietly, and leaves a met one in the world.
// * `advance`: the planner's batch after a day change or a time skip: where people are and what they do now, a death where it is
//   allowed, the story minute the cast was moved to.
// * `meet`: the party and a person cross paths for the first time (no dice): `met` is set and the narrator is told this reply.
//
// The hook (index.js) runs the same functions on a copy of the state to know the world a step will leave, so what it decides and
// what the step does cannot differ. `env`: { now, rev, touch(key) (marks a change inside a person that a deleted reply may have
// made, `ctx.ifThere`), note(entry) (adds a note for the reply's card; absent on a copy), packName(pack) }.

import { MAX_DOING, MAX_PEOPLE, MAX_PLACE, MAX_REASON, cutPoints, cutWords, isAlive, isInt, isMet, isRecord, personKey, slotOf, tables } from './domain.js';

const noop = () => {};

/** A person as the world first holds them: at their start, doing their routine (else working towards their goal). */
export function newcomer(entry, { now, rev }) {
    return {
        pack: entry.pack, eid: entry.id, name: entry.name, ...(entry.aliases.length ? { aliases: [...entry.aliases] } : {}), ver: entry.ver, ...(entry.sig ? { sig: entry.sig } : {}),
        joined: isInt(now) ? now : null, where: entry.place, doing: cutWords(entry.routine || entry.goal, MAX_DOING), since: isInt(now) ? now : null,
        alive: true, met: null, heard: null, rev,
    };
}

const sameAliases = (a, b) => (Array.isArray(a) ? a : []).join('\u0001') === (Array.isArray(b) ? b : []).join('\u0001');

// ---- sync ------------------------------------------------------------------------------------------------------------------

/**
 * What the packs' cast asks of the world now: `{ add: [entry], update: [{ key, ver, name, aliases }], drop: [key], init, updated:
 * [{ pack, n, changed, from, to }] }`, all empty when nothing is to be done. `cast` is `castOf(query)` (entries.js).
 */
export function planSync(slice, cast, { now = null } = {}) {
    const { people } = tables(slice);
    const out = { add: [], update: [], drop: [], init: false, updated: [], changed: new Set() };
    if (!cast?.listed) return out;
    let room = MAX_PEOPLE - Object.keys(people).length;
    for (const entry of cast.entries) {
        const person = Object.hasOwn(people, entry.key) && isRecord(people[entry.key]) ? people[entry.key] : null;
        if (!person) {
            if (room > 0) {
                out.add.push(entry);
                room -= 1;
            }
            continue;
        }
        // A met person keeps the words they were met with: only the version and fingerprint they were last seen at move on. A version bump
        // alone is no change: what the entry says is (its fingerprint; a person kept before fingerprints existed has it noted silently).
        const edited = Boolean(entry.sig) && Boolean(person.sig) && person.sig !== entry.sig;
        const noted = Boolean(entry.sig) && person.sig !== entry.sig;
        if (person.ver !== entry.ver || noted || (!isMet(person) && (person.name !== entry.name || !sameAliases(person.aliases, entry.aliases)))) {
            out.update.push({ key: entry.key, ver: entry.ver, ...(entry.sig ? { sig: entry.sig } : {}), name: entry.name, aliases: [...entry.aliases] });
            if (!isMet(person) && (edited || person.name !== entry.name || !sameAliases(person.aliases, entry.aliases))) out.changed.add(entry.key);
        }
    }
    for (const [key, person] of Object.entries(people)) {
        if (!isRecord(person) || isMet(person) || cast.byKey.has(key) || !cast.enabled.has(person.pack)) continue;
        out.drop.push(key);
    }
    out.init = isInt(now) && !slotOf(slice?.day) && (cast.entries.length > 0 || Object.keys(people).length > 0);
    // A pack the chat already had people from, now with people it did not have: the first reply after says so (no names).
    const packs = [...new Set(out.add.map(entry => entry.pack))];
    for (const pack of packs) {
        const had = Object.values(people).filter(person => isRecord(person) && person.pack === pack);
        if (!had.length) continue;
        out.updated.push({
            pack, n: out.add.filter(entry => entry.pack === pack).length,
            changed: [...out.changed].filter(key => key.startsWith(`${pack}:`)).length,
            from: had[0].ver, to: cast.packs?.[pack]?.version ?? '',
        });
    }
    return out;
}

/** Whether a sync plan asks for nothing. */
export const syncEmpty = plan => !plan.add.length && !plan.update.length && !plan.drop.length && !plan.init;

/** The payload of `cast.sync` for a plan (what the step needs, no pack text beyond a person's start). */
export const syncPayload = plan => ({
    ...(plan.add.length ? { add: plan.add.map(entry => ({ pack: entry.pack, id: entry.id, name: entry.name, ...(entry.aliases.length ? { aliases: entry.aliases } : {}), ver: entry.ver, ...(entry.sig ? { sig: entry.sig } : {}), place: entry.place, doing: cutWords(entry.routine || entry.goal, MAX_DOING) })) } : {}),
    ...(plan.update.length ? { update: plan.update } : {}),
    ...(plan.drop.length ? { drop: plan.drop } : {}),
    ...(plan.updated.length ? { updated: plan.updated.map(item => ({ pack: item.pack, n: item.n, changed: item.changed, from: item.from, to: item.to })) } : {}),
    ...(plan.init ? { init: true } : {}),
});

/** Applies a `cast.sync` payload to `cast` (a draft or a copy). Returns `{ added, updated, dropped }`. */
export function applySync(cast, payload, env) {
    const { now = null, rev = 0, touch = noop, note = null, packName = pack => pack } = env;
    const done = { added: 0, updated: 0, dropped: 0 };
    for (const item of payload.add ?? []) {
        const key = personKey(item.pack, item.id);
        if (Object.hasOwn(cast.people, key) || Object.keys(cast.people).length >= MAX_PEOPLE) continue;
        cast.people[key] = newcomer({ ...item, aliases: item.aliases ?? [], routine: item.doing, goal: '' }, { now, rev });
        done.added += 1;
    }
    for (const item of payload.update ?? []) {
        if (!Object.hasOwn(cast.people, item.key) || !isRecord(cast.people[item.key])) continue;
        touch(item.key);
        const person = cast.people[item.key];
        person.ver = item.ver;
        if (item.sig) person.sig = item.sig;
        // A met person keeps the words they were met with; the entry's new ones are not copied over a dossier.
        if (!isMet(person)) {
            person.name = item.name;
            if (item.aliases?.length) person.aliases = [...item.aliases];
            else delete person.aliases;
        }
        done.updated += 1;
    }
    for (const key of payload.drop ?? []) {
        if (!Object.hasOwn(cast.people, key) || isMet(cast.people[key])) continue;
        delete cast.people[key];
        done.dropped += 1;
    }
    if (payload.init && !slotOf(cast.day) && isInt(now)) cast.day = [{ at: now, rev }];
    if (typeof note === 'function') {
        for (const item of payload.updated ?? []) {
            if (!(item.n > 0)) continue;
            const name = packName(item.pack);
            const people = item.n === 1 ? '1 new person now lives' : `${item.n} new people now live`;
            const changed = item.changed > 0 ? ` ${item.changed === 1 ? '1 unmet person\'s entry' : `${item.changed} unmet people's entries`} changed (kept where they are).` : '';
            note({
                kind: 'updated', head: `${name} pack updated`, tag: item.from && item.to && item.from !== item.to ? `${item.from} → ${item.to}` : 'new people',
                rest: `${people} in the world from today, hidden until you meet them.${changed} People you have met keep their dossiers as they are.`,
                line: `${name} pack updated: ${people} in the world`,
            });
        }
    }
    return done;
}

// ---- advance -----------------------------------------------------------------------------------------------------------------

const hoursText = minutes => {
    if (!isInt(minutes) || minutes <= 0) return '';
    const days = Math.round(minutes / 1440);
    if (minutes >= 1440 * 0.75) return `${Math.max(1, days)} day${Math.max(1, days) === 1 ? '' : 's'}`;
    const hours = Math.max(1, Math.round(minutes / 60));
    return `${hours} hour${hours === 1 ? '' : 's'}`;
};

/** Applies a `cast.advance` payload (`{ from, to, moves, died }`). Returns `{ moved, died, news }` (`news`: the met people's, for the note). */
export function applyAdvance(cast, payload, env) {
    const { rev = 0, touch = noop, note = null } = env;
    const to = isInt(payload.to) ? payload.to : null;
    const done = { moved: 0, died: 0, news: [] };
    for (const move of payload.moves ?? []) {
        const person = Object.hasOwn(cast.people, move.key) && isRecord(cast.people[move.key]) ? cast.people[move.key] : null;
        if (!person || !isAlive(person)) continue;
        touch(move.key);
        if (move.where) person.where = cutPoints(move.where, MAX_PLACE);
        if (move.doing) person.doing = cutWords(move.doing, MAX_DOING);
        person.since = to;
        if (isMet(person)) {
            // A slot, written whole (../slot.js): a later reply never changes inside what an earlier one wrote.
            person.heard = [{ on: to, text: cutWords(move.doing || move.where, MAX_DOING) }];
            done.news.push({ name: person.name, text: person.heard[0].text });
        }
        done.moved += 1;
    }
    for (const item of payload.died ?? []) {
        const person = Object.hasOwn(cast.people, item.key) && isRecord(cast.people[item.key]) ? cast.people[item.key] : null;
        if (!person || !isAlive(person) || isMet(person)) continue;
        touch(item.key);
        person.alive = false;
        person.doing = '';
        done.died += 1;
    }
    if (isInt(to)) cast.day = [{ at: to, rev }];
    if (typeof note === 'function' && (done.moved > 0 || done.died > 0)) {
        const news = done.news.slice(0, 2).map(entry => ` ${entry.name}, met: ${entry.text}.`).join('');
        const span = hoursText(isInt(payload.from) && isInt(to) ? to - payload.from : 0);
        note({
            kind: 'moved', head: 'While time passed', tag: span || 'time passed',
            rest: `${done.moved + done.died} cast member${done.moved + done.died === 1 ? '' : 's'} moved on off-screen (one short line each, only where something changed). You have not met them, so who and where stays hidden.${news}`,
            line: 'The cast moved on',
        });
    }
    return done;
}

// ---- meet ----------------------------------------------------------------------------------------------------------------------

// A routine that runs on for several places and hours is no sentence for a card or a cue: only a short "doing" is quoted.
const short = text => { const said = String(text ?? '').replace(/[.!?…]+$/, ''); return said.length <= 60 && !/[;]/.test(said) ? said : ''; };
const lowerFirst = text => text.replace(/^(\p{Lu})(\p{Ll})/u, (_all, first, second) => `${first.toLowerCase()}${second}`);

/** The reader's words for why two paths crossed (the card's "Why"). `reason`: the planner's sentence for a goal ('' for a place). */
export function whyText({ name, why, reason, doing, where }) {
    if (why === 'story') return `${name} was already in the story when the cast reached them (met in the story); no roll.`;
    if (why === 'goal') return `${cutPoints(reason, MAX_REASON - 60)} Their own goal pulls them to you, so they arrive; no roll.`.trim();
    const at = where ? ` at ${where}` : '';
    const said = lowerFirst(short(doing));
    return `${name} ${said ? `${said}${at}` : `is${at || ' here'}`}, and you are there: your first time here while they are. No roll.`;
}

/** The narrator's words for why now: where they are, or what pulls them. */
export function whyNarrator(person) {
    const met = person?.met ?? {};
    if (met.why === 'goal') return `${cutPoints(met.reason, 200)} Their own goal brings them to {{user}}.`.trim().replace(/^(\p{Ll})/u, c => c.toUpperCase());
    const said = lowerFirst(short(person?.doing));
    return `${said ? `${said}, ` : ''}they are at ${met.where || person?.where || 'this place'}, the place of this scene.`.replace(/^(\p{Ll})/u, c => c.toUpperCase());
}

/**
 * Applies a `cast.meet` payload (`{ at, who: [{ key, why, reason, place? }] }`). Returns the keys met. `place`: the party's place. Someone
 * who comes by their goal is where the party is, not at their start; someone the story already had in the scene (`why: 'story'`) is met at
 * that moment and is not brought in again (no cue).
 */
export function applyMeet(cast, payload, env) {
    const { now = null, rev = 0, touch = noop, note = null, packName = pack => pack } = env;
    const met = [];
    const cued = [];
    for (const item of payload.who ?? []) {
        const person = Object.hasOwn(cast.people, item.key) && isRecord(cast.people[item.key]) ? cast.people[item.key] : null;
        if (!person || !isAlive(person) || isMet(person)) continue;
        touch(item.key);
        const reason = item.why === 'goal' ? cutPoints(item.reason, MAX_REASON) : '';
        const here = cutPoints(item.place, MAX_PLACE);
        if (item.why !== 'place' && here) person.where = here;
        person.met = { on: isInt(now) ? now : null, where: person.where, why: item.why, reason, rev };
        const shown = cutPoints(whyText({ name: person.name, why: item.why, reason, doing: person.doing, where: person.where }), 400);
        met.push(item.key);
        if (item.why !== 'story') cued.push(item.key);
        if (typeof note === 'function') {
            note({
                kind: 'met', head: `Paths crossed: ${person.name}`, tag: `${packName(person.pack)} cast · ${item.why === 'story' ? 'met in the story' : 'first meeting'}`,
                rest: item.why === 'story' ? `Why: ${shown}` : `Why: ${shown} The narrator is told to bring them in; a swipe rewrites the scene, not who you meet.`,
                line: `Paths crossed: ${person.name}`,
            });
        }
    }
    if (cued.length && isInt(payload.at)) cast.meeting = [{ at: payload.at, keys: cued.slice(0, 4), rev }];
    return met;
}
