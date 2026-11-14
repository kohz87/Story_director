// Story Director v2, part **pulse** (feature `story-director.pulse`): the World pulse. Before each reply, code rolls a d20 from the
// step's seed (`director.pulse { at }`, a system step from beforeGenerate: the same bytes of state + seed give the same roll; a swipe
// is a new step with a new seed, so it rolls again), picks an entry from tables.js, applies its effect and records the result in the
// slot `director.pulse = [{ results: [last 5] }]`. The step is a host prelude: it is previewed for the prompt and stored on the generated reply
// itself (same seed), so a swipe, a regenerate or a delete of the reply takes its roll and effects back. Its receipt's summary is the one
// "World this reply: …" cue (none on CALM or a skip; at most 40 tokens), told in the leading note, not an optional tail line.
// A reply is skipped (and the skip recorded) in a fight, after a rest or a 6+ hour jump, in a quiet scene and while the clock is unset.
// Pulse step version 2 (payload `pulse: 2`, new replies; older steps replay as written): each result has an `intensity`; never two intrusive or the same kind running;
// a flavour kind with `invent: true` shows a short `text` and carries the narrator `brief` for the note (setting `invents`), else a fixed line (flavour-more.js).
// The builders below are pure (no state, no ctx, no model call); the part (the command, hook, settings) is at the end.
//
// Each builder takes the filtered candidates and the roll's draw units (tables.js drawsFrom): `actor` picks the candidate, `line` decides the
// rest. It returns `{ kind, type, payload, tail, receipt }` (the command the hook runs, the tail text without its label, what `director.pulse`
// stores), or `null` when the entry cannot happen with these candidates; the caller then steps down the table.
//
// * skipReason: why a reply writes no roll: 'fight', 'rest', 'jump' (JUMP_MINUTES+), 'quiet', 'clock'; '' when rolled.
// * Rumour (GOSSIP_SURGE, OVERHEARD_DETAIL): one known fact becomes a `looming` chronicle event. Known facts only: a candidate
//   whose name is in `behind` (the lineKeys of hidden names, world/known.js hiddenNames) is dropped before the pick.
// * Chance meeting (CHANCE_MEETING): one unmet, living cast person is met at `place` (`cast.meet`, why 'goal').
// * Arrival (ENTER_CHECK): one off-screen agenda's `arrive` moves 1 or 2 replies' worth of story minutes ahead (REPLY_MINUTES).
// * Shift (TASK_SHIFT): one off-screen agenda's `on` moves early or late by 1 to 4 hours. Agenda dates are calendar text, so
//   the caller parses them (`abs`: story minutes) and gives `format(minutes)` back; without `format` the entry cannot happen.
// * Names: a person or agenda is named only when `named` (known to {{user}}); else the line stays general.
// * Tail lines are plain text: plainSlot (no braces, angle brackets or line breaks), cut by code points.

import { lineKey } from '../../changes.js';
import { dateOf } from '../../relevance.js';
import { slotValue, toSlot } from '../slot.js';
import { castOf, fightOn, foesLeftover, foesSignature, partyPlace, pinnedKeys, presentKeys, roadsOf, travelOf } from '../cast/entries.js';
import { chanceCandidates } from '../cast/world.js';
import { cueOf } from '../cast/note.js';
import { hiddenNames } from '../world/known.js';
import { calendarFrom } from '../keypeople/time.js';
import { isPersona, personaName } from '../tracker/initiative.js';
import { orderedThreads } from '../tracker/convert.js';
import { ask, cutPoints, namesPerson, sceneOf } from '../tracker/scene.js';
import { drawsFrom, d20Of, fillSlots, flavourFor, pickIndex, placeGroupOf, plainSlot, resolveKind, tableFor, briefFor, intensityOf, ACTOR_NEEDS, QUIET_FALLBACK, QUIET_SPREAD } from './tables.js';

export const JUMP_MINUTES = 360;
export const REPLY_MINUTES = 20;
/**
 * A Foes slot the narrator never cleared is a fight only while it moves: when the live slots read the same on this many replies running (the
 * replies' own rolls record them, `foes`), the pulse rolls again. A step from a reply written before this rule has no `age` flag and keeps the old rule.
 */
export const STALE_REPLIES = 2;
// The note line is at most 40 tokens (4 chars each): the label and TAIL_CHARS of text stay under 150; BRIEF_CHARS is the version 2 narrator brief.
export const TAIL_CHARS = 128;
export const BRIEF_CHARS = 330;
export const RUMOUR_ROOM = 54;
export const SKIP_REASONS = Object.freeze(['fight', 'rest', 'jump', 'quiet', 'clock']);
const NAME_MAX = 80;
const TOPIC_MAX = 120;
const FACTIONS_MAX = 4;

const isInt = value => Number.isSafeInteger(value);
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const unit = value => (Number.isFinite(value) ? Math.max(0, Math.min(0.999999999, value)) : 0);
const frac = value => value - Math.floor(value);
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Why a reply is skipped (no roll, no receipt, no tail line), or '' for a rolled reply. `jumpMinutes`: story minutes since the
 * last reply (null when unknown); `clock`: the story minute now (null while the clock is not set).
 */
export function skipReason({ fight = false, rested = false, jumpMinutes = null, quiet = false, clock = null } = {}) {
    if (fight) return 'fight';
    if (rested) return 'rest';
    if (isInt(jumpMinutes) && jumpMinutes >= JUMP_MINUTES) return 'jump';
    if (quiet) return 'quiet';
    if (!isInt(clock)) return 'clock';
    return '';
}

/** `text` plain and cut at a word to at most `max` characters (no cut when it fits). */
export function cutWord(text, max = TAIL_CHARS) {
    const flat = plainSlot(text, 400);
    if (flat.length <= max) return flat;
    const cut = flat.slice(0, max);
    const space = cut.lastIndexOf(' ');
    return (space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.\-–—]+$/, '');
}

/** The tail line for an effect's text: "World this reply: …", plain and cut at a word to TAIL_CHARS; '' when there is no text. */
export function worldLine(text, max = TAIL_CHARS) {
    const body = cutWord(text, max);
    return body ? `World this reply: ${body}` : '';
}

/**
 * A rumour from one known fact (`known`: [{ id, name, summary, place, factions }]), for GOSSIP_SURGE (talk) or OVERHEARD_DETAIL
 * (snatches). The chronicle event is `looming` and is keyed by the chat's length (`at`), so a swipe that removes the reply removes it.
 */
export function rumourEntry(kind, { known = [], behind = new Set(), at = null, place = '', draw = {} } = {}) {
    if (!isInt(at)) return null;
    const facts = (Array.isArray(known) ? known : [])
        .filter(fact => isRecord(fact) && !fact.rumour && plainSlot(fact.name, NAME_MAX) && !/^rumou?rs? of /i.test(plainSlot(fact.name, NAME_MAX)) && !behind.has(lineKey(fact.name)))
        .map(fact => ({ ...fact, id: plainSlot(fact.id ?? fact.name, NAME_MAX) }))
        .sort(byId);
    const fact = facts[pickIndex(facts.length, unit(draw.actor))];
    if (!fact) return null;
    const name = plainSlot(fact.name, NAME_MAX);
    const summary = plainSlot(fact.summary, TOPIC_MAX) || name;
    const where = plainSlot(place, NAME_MAX);
    const factions = (Array.isArray(fact.factions) ? fact.factions : []).map(item => plainSlot(item, NAME_MAX)).filter(Boolean).slice(0, FACTIONS_MAX);
    const id = `pulse-${at}`;
    const tail = kind === 'OVERHEARD_DETAIL'
        ? `Snatches of talk${where ? ` in ${where}` : ''} mention ${summary}.`
        : `Talk${where ? ` in ${where}` : ''} runs to ${summary}.`;
    return {
        kind,
        type: 'chronicle.rumor',
        payload: { at, event: { id, name: `Rumour of ${name}`, summary, state: 'looming', place: where, factions, rumour: name } },
        tail,
        receipt: { event: id },
    };
}

/**
 * CHANCE_MEETING: one unmet, living cast person (`cast`: the cast domain) comes across the party at `place` (required: a place
 * the reader is at). Met by the pulse, so the person is met now; the line names them (the cast's own cue rides with it, see `rollEntry`).
 */
export function meetEntry({ cast = null, at = null, place = '', draw = {}, here = null, persona = '' } = {}) {
    const where = plainSlot(place, NAME_MAX);
    if (!isInt(at) || !where || !isRecord(cast?.people)) return null;
    const people = Object.keys(cast.people).sort()
        .map(key => ({ key, person: cast.people[key] }))
        .filter(({ key, person }) => isRecord(person) && person.alive !== false && !person.met && plainSlot(person.name, NAME_MAX) && !isPersona({ key, name: person.name }, persona));
    const pick = people[pickIndex(people.length, unit(draw.actor))];
    if (!pick) return null;
    return {
        kind: 'CHANCE_MEETING',
        type: 'cast.meet',
        // `here` (every new reply: the keys of candidates already at the place): met by place, nobody is moved; the rest come by their way there.
        payload: { at, who: [here?.has(pick.key) ? { key: pick.key, why: 'place', reason: '' } : { key: pick.key, why: 'goal', reason: 'chance meeting', place: where }] },
        // The person is met in this reply, so the line may name them; the cast's cue (who they are, how to bring them in) goes with it.
        tail: `${plainSlot(pick.person.name, NAME_MAX)} crosses your path in ${where}, by chance.`,
        receipt: { who: pick.key },
    };
}

/**
 * ENTER_CHECK: an off-screen agenda's `arrive` moves 1 or 2 replies ahead of `now` (story minutes). `agendas`: [{ id, name, named }]
 * (open, off-screen, with an arrival or a leg); `format(minutes)` gives the calendar text for the new date (null: cannot happen).
 */
export function arrivalEntry({ agendas = [], now = null, at = null, format = null, draw = {} } = {}) {
    if (!isInt(now) || !isInt(at) || typeof format !== 'function') return null;
    const open = (Array.isArray(agendas) ? agendas : []).filter(item => isRecord(item) && plainSlot(item.id, NAME_MAX)).map(item => ({ ...item, id: plainSlot(item.id, NAME_MAX) })).sort(byId);
    const pick = open[pickIndex(open.length, unit(draw.actor))];
    if (!pick) return null;
    const replies = 1 + Math.floor(unit(draw.line) * 2);
    const arriveAt = now + replies * REPLY_MINUTES;
    const text = plainSlot(format(arriveAt), NAME_MAX);
    if (!text) return null;
    const who = pick.named ? plainSlot(pick.name, NAME_MAX) : '';
    return {
        kind: 'ENTER_CHECK',
        type: 'director.pulse.arrive',
        payload: { at, thread: pick.id, field: 'arrive', from: typeof pick.arrive === 'string' ? pick.arrive : '', to: text },
        tail: who ? `${who} may arrive soon.` : 'Someone you have been expecting may arrive soon.',
        receipt: { thread: pick.id, arriveAt },
    };
}

/**
 * TASK_SHIFT: an off-screen agenda's step `on` moves early or late by 1 to 4 hours. `agendas`: [{ id, name, named, text, abs }] where
 * `text` is the stored date and `abs` its story minutes (the caller parses it); `format(minutes)` gives the new date's text.
 * Direction is the `line` draw below one half (early); the hours come from its fractional part, so they do not depend on it.
 * An early shift is clamped to `now` (story minutes) + REPLY_MINUTES: `on` never moves into the past.
 */
export function shiftEntry({ agendas = [], at = null, now = null, format = null, draw = {} } = {}) {
    if (!isInt(at) || !isInt(now) || typeof format !== 'function') return null;
    const open = (Array.isArray(agendas) ? agendas : [])
        .filter(item => isRecord(item) && plainSlot(item.id, NAME_MAX) && typeof item.text === 'string' && item.text.trim() && Number.isFinite(item.abs))
        .map(item => ({ ...item, id: plainSlot(item.id, NAME_MAX) }))
        .sort(byId);
    const pick = open[pickIndex(open.length, unit(draw.actor))];
    if (!pick) return null;
    const line = unit(draw.line);
    const early = line < 0.5;
    const hours = 1 + Math.floor(frac(line * 2) * 4);
    // Never into the past: an early shift stops REPLY_MINUTES after `now`, and one that would not move the date earlier cannot happen.
    const target = early ? Math.max(pick.abs - hours * 60, now + REPLY_MINUTES) : pick.abs + hours * 60;
    if (early && target >= pick.abs) return null;
    const shift = target - pick.abs;
    const to = plainSlot(format(target), NAME_MAX);
    if (!to) return null;
    const who = pick.named ? plainSlot(pick.name, NAME_MAX) : '';
    const tail = early
        ? (who ? `${who} is ahead of schedule.` : 'Something out of sight is running ahead of schedule.')
        : (who ? `${who} is running late.` : 'Something out of sight is running late.');
    return {
        kind: 'TASK_SHIFT',
        type: 'director.pulse.shift',
        payload: { at, thread: pick.id, field: 'on', from: pick.text.trim(), to, shift },
        tail,
        receipt: { thread: pick.id, from: pick.abs, to: pick.abs + shift },
    };
}

/**
 * One effect entry by kind, with the candidates in `ctx` (the builder's own options). Flavour kinds and CALM are not effects:
 * they give null here. Unknown kinds give null.
 */
export function effectFor(kind, ctx = {}) {
    if (kind === 'GOSSIP_SURGE' || kind === 'OVERHEARD_DETAIL') return rumourEntry(kind, ctx);
    if (kind === 'CHANCE_MEETING') return meetEntry(ctx);
    if (kind === 'ENTER_CHECK') return arrivalEntry(ctx);
    if (kind === 'TASK_SHIFT') return shiftEntry(ctx);
    return null;
}

// ---- agenda progress (capture.js calls these while the feature is on) --------------------------------------------------------------

const segments = text => String(text ?? '').split(/\s*(?:;|→|->)\s*/).filter(Boolean).length;

/**
 * The extra fields an agenda line leaves: `stepAt` (which step it is on, from 1), `stepOf` (how many, from the agenda's own `then` list
 * "a; b; c" or kept once set) and `stepSince` (the story minute the step began), when `now` or `then` moved; `where` (the atlas place
 * `now` names, given by the caller). The names never meet the narrator's own `step` field. `before` is the thread's fields (null: new).
 * Returns the fields to merge (all text), or null for no change. Old agendas without them stay valid.
 */
export function agendaProgress(before, after, { minutes = null, where = '' } = {}) {
    const moved = !before || before.now !== after.now || before.then !== after.then;
    const patch = {};
    if (moved && (after.now || after.then)) {
        const of = Number(after.stepOf) > 0 ? Number(after.stepOf) : (segments(after.then) ? segments(after.then) + 1 : 0);
        const base = before ? (Number(before.stepAt) || 1) + 1 : 1;
        const at = of ? Math.min(of, base) : base;
        if (String(at) !== after.stepAt) patch.stepAt = String(at);
        if (of && String(of) !== after.stepOf) patch.stepOf = String(of);
        if (isInt(minutes) && String(minutes) !== after.stepSince) patch.stepSince = String(minutes);
    }
    if (plainSlot(where, NAME_MAX) && where !== after.where) patch.where = plainSlot(where, NAME_MAX);
    return Object.keys(patch).length ? patch : null;
}

/** The atlas place `text` names (its name), or ''. `query`: a ctx's or a view's. */
export const placeNamed = (query, text) => (plainSlot(text, NAME_MAX) ? plainSlot(ask(query, 'atlas.place', { name: plainSlot(text, NAME_MAX) }, null)?.name, NAME_MAX) : '');

// ---- the part ----------------------------------------------------------------------------------------------------------------------

export const FEATURE = 'story-director.pulse';
export const PULSE = 'director.pulse';
export const QUIET = 'director.pulse.quiet';
export const MODES = Object.freeze(['off', 'quiet', 'lively']);
export const RESULTS_MAX = 6;
const EFFECTS = new Set(['GOSSIP_SURGE', 'OVERHEARD_DETAIL', 'CHANCE_MEETING', 'ENTER_CHECK', 'TASK_SHIFT']);
const WEATHER_WORDS = [['rain', /rain|drizzle|shower|storm/i], ['snow', /snow|blizzard|sleet/i], ['fog', /fog|mist|haze/i], ['wind', /wind|gale|gust/i], ['heat', /heat|hot|scorch|swelter/i]];

/** The one static sentence, taught while the feature is on: the same bytes every reply. */
export const PULSE_STATIC = 'World pulse: "World this reply" in the note is a small thing that happens around {{user}}; weave it in lightly, never resolve it for {{user}}.';

const settingsOf = source => { const value = typeof source === 'function' ? source() : source; return isRecord(value) ? value : {}; };
/** Whether the feature is on (`ctx.feature` / `view.feature` when the host has them, F100), else on. */
export const pulseOn = source => (typeof source?.feature === 'function' ? source.feature(FEATURE) !== false : true);
/** Whether the pulse is on and not set to off: the agenda progress is written only then. */
export const pulseActive = source => pulseOn(source) && modeOf(settingsOf(source?.settings)) !== 'off';
/** The `mode` setting: off, quiet (flavour only) or lively (the default). */
export const modeOf = settings => (MODES.includes(settings?.mode) ? settings.mode : 'lively');
/** The recorded results, oldest first. */
export const resultsOf = director => { const value = slotValue(director?.pulse); return Array.isArray(value?.results) ? value.results.filter(isRecord) : []; };
/** The weather word an ENV_SHIFT line knows, from the scene's weather text; null for none. */
export const weatherFrom = text => WEATHER_WORDS.find(([, pattern]) => pattern.test(String(text ?? '')))?.[0] ?? null;

// An explicit rest: a data module's last full rest (`rested-at`, the clock or clock + 1) falls after the last roll's clock.
function restedSince(state, from, now) {
    const instances = state?.domains?.dataModules?.instances;
    if (!isInt(from) || !isInt(now) || !isRecord(instances)) return false;
    const marks = item => [item?.chat, ...Object.values(isRecord(item?.characters) ? item.characters : {})].map(part => part?.fields?.['rested-at']);
    return Object.values(instances).some(item => marks(item).some(at => isInt(at) && at > from && at <= now + 1));
}

// Open agendas the scene does not reach (not tied to its place, not naming anyone present), by id.
function offscreenAgendas(director, scene) {
    const place = String(scene.place ?? '').toLowerCase();
    const tied = thread => place.length >= 3 && ['place', 'now', 'leg', 'where'].some(name => String(thread.fields?.[name] ?? '').toLowerCase().includes(place));
    const record = thread => ({ key: thread.key, fields: thread.fields ?? {} });
    return orderedThreads(director).filter(thread => thread.kind === 'agenda' && thread.status === 'active' && !tied(thread)
        && !scene.people.some(person => namesPerson(record(thread), person, { strict: true })));
}

// The roll's entry for this reply: the kind from the table (stepping past what cannot happen), its effect applied, its line.
function rollEntry({ ctx, director, state, query, scene, draw, at, clock, mode, reach = 0, persona = '', v2 = false, invents = true, recent = [] }) {
    const here = ask(query, 'atlas.here', {}, null);
    const place = cutPoints(here?.name || scene.place, NAME_MAX);
    const group = placeGroupOf(here?.placeKind ?? here?.kind ?? '');
    const weather = weatherFrom(ask(query, 'scene.weather', {}, null)?.text);
    const calendar = calendarFrom(query);
    const agendas = offscreenAgendas(director, scene);
    const people = state.domains.cast?.people;
    // Reach (every new reply): only people who can be at the party's place now cross its path by chance; 2: road trips only, the party's place or town, from the last known place too;
    // 3 (new steps): the place and its town by the atlas's ids and parent links, a road or wilderness only itself (cast/world.js `atPlace`). Reach 2 replays as it was (`old`).
    // {{user}} is never the subject of an event (the narrator would be ordered to write the player's actions): not a mood, not a chance meeting. Only a step that carries `persona` (every new reply) knows it; an older reply re-read keeps its rolls.
    const others = scene.people.filter(person => !isPersona(person, persona));
    const party = reach === 2 ? { ...partyPlace(query, state), old: true } : partyPlace(query, state);
    const near = reach ? chanceCandidates(state.domains.cast, castOf(query), { party, now: clock, travel: reach >= 2 ? roadsOf(query) : travelOf(query), strict: reach >= 2, present: presentKeys(query, state), pinned: pinnedKeys(query) }).filter(item => !isPersona({ key: item.key, name: item.person?.name }, persona)) : null;
    const unmet = Object.entries(isRecord(people) ? people : {}).filter(([key, person]) => isRecord(person) && person.alive !== false && !person.met && !isPersona({ key, name: person.name }, persona)).map(([, person]) => person);
    const open = ask(query, 'chronicle.events', { open: true }, []);
    // Old pulse rumours are closed first (their time is up, or the event they were about ended). Only the pulse's own are candidates for the facts, never its rumours.
    if (open.some(event => event?.rumour)) { try { ctx.call('chronicle.rumor', { at, expire: true }); } catch { /* the roll goes on */ } }
    const room = open.length < RUMOUR_ROOM;
    // A fact already told as a rumour (open or over) is not told again: the roll steps down rather than write nothing.
    const told = new Set(ask(query, 'chronicle.events', {}, []).filter(event => event?.rumour).map(event => lineKey(event.rumour)));
    const known = room ? open.filter(event => !event?.rumour && !told.has(lineKey(event?.name))) : [];
    const behind = hiddenNames(state).behind;
    const converge = thread => {
        const fields = thread.fields ?? {};
        if (fields.leg || fields.arrive) return true;
        const there = ask(query, 'atlas.place', { name: plainSlot(fields.where || fields.place, NAME_MAX) }, null)?.region;
        return Boolean(lineKey(here?.region) && lineKey(there) === lineKey(here?.region));
    };
    const away = Object.keys(state.domains.keypeople?.away ?? {}).length;
    const names = new Set(scene.people.map(person => person.key));
    for (const name of [...ask(query, 'npc.known', {}, []), ...Object.values(isRecord(people) ? people : {}).map(person => person?.name)]) if (lineKey(name)) names.add(lineKey(name));
    const lively = mode === 'lively';
    const counts = { present: others.length, offscreen: lively ? agendas.length + away + unmet.length : 1, known: lively ? known.length : 1, cast: lively ? (near ? near.length : unmet.length) : 1 };
    const table = tableFor({ named: names.size, offscreen: agendas.length + away + unmet.length });
    const d20 = d20Of(draw.d20);
    // Version 2: how strongly it shows; never the same kind twice running, nor two intrusive ones; the narrator may invent the event from what the note holds.
    const lastKind = v2 ? recent.at(-1)?.kind : '';
    const intensity = v2 ? intensityOf(draw.d20, recent.at(-1)?.intensity) : '';
    const material = v2 && invents && (others.length > 0 || open.length > 0 || orderedThreads(director).some(thread => thread.status === 'active'));
    const blocked = new Set(lastKind && lastKind !== 'CALM' ? [lastKind] : []);
    for (let tries = 0; tries < 8; tries += 1) {
        const rolled = resolveKind(table, d20, { group, weather, counts, blocked });
        // Quiet: an effect entry keeps its band but reads as its flavour fallback.
        const quiet = !lively && (v2 ? QUIET_SPREAD : QUIET_FALLBACK)[rolled.kind];
        if (quiet && v2 && quiet === lastKind) { blocked.add(rolled.kind); continue; } else if (quiet) rolled.kind = quiet;
        const base = { d20, table, kind: rolled.kind, ...(intensity ? { intensity } : {}), ...(place ? { place } : {}) };
        if (!EFFECTS.has(rolled.kind)) {
            const who = others.length ? others[pickIndex(others.length, draw.actor)]?.name : '';
            if (material && rolled.kind !== 'CALM') return { ...base, invent: true, text: `${rolled.kind.toLowerCase().replaceAll('_', ' ')} (${intensity}): the narrator invents it`, brief: cutWord(briefFor({ kind: rolled.kind, intensity, group, name: ACTOR_NEEDS[rolled.kind] === 'present' ? who : '', recent }), BRIEF_CHARS) };
            const text = rolled.kind === 'CALM' ? '' : fillSlots(flavourFor(rolled.kind, draw.line, { group, weather, wide: v2 }), { name: who, place });
            return { ...base, ...(who && text.includes(who) ? { who } : {}), text: cutWord(text, TAIL_CHARS) };
        }
        const made = effectFor(rolled.kind, {
            known, behind, at, place, draw, cast: near ? { people: Object.fromEntries(near.map(item => [item.key, item.person])) } : state.domains.cast, persona, here: near ? new Set(near.filter(item => item.here).map(item => item.key)) : null, now: clock, format: minutes => calendar.format(minutes),
            agendas: agendas.filter(rolled.kind === 'ENTER_CHECK' ? converge : () => true).map(thread => ({ id: thread.id, name: thread.key, named: false, arrive: thread.fields?.arrive, text: thread.fields?.on, abs: dateOf(thread, 'on', { calendar, reference: clock })?.abs })),
        });
        if (made && applyEffect(ctx, director, made)) {
            const cue = made.type === 'cast.meet' ? meetingCue(ctx, query, made.receipt.who) : '';
            return { ...base, ...(cue ? { cue } : {}), text: cutWord(made.tail, TAIL_CHARS), effect: { type: made.type, ...made.receipt } };
        }
        blocked.add(rolled.kind);
    }
    return { d20, table, kind: 'CALM', text: '' };
}

// The cast's own cue for the person the pulse just met (read from this step's draft), as the cast part tells a meeting: '' when it cannot be made.
function meetingCue(ctx, query, key) {
    try {
        const person = ctx.read('cast')?.people?.[key];
        return isRecord(person?.met) ? `[Cast] ${cueOf(person, castOf(query).byKey.get(key))}` : '';
    } catch { return ''; }
}

// The effect's step: another part's command (the same receipt), or the agenda's own date on the thread (marked ctx.ifThere).
function applyEffect(ctx, director, made) {
    if (made.type === 'chronicle.rumor' || made.type === 'cast.meet') {
        try { ctx.call(made.type, made.payload); return true; } catch { return false; }
    }
    const thread = director.threads?.[made.payload.thread];
    if (!thread || thread.status !== 'active') return false;
    if (typeof ctx.ifThere === 'function') ctx.ifThere('director', `/threads/${thread.id}`);
    // Only the date moves: nobody is placed anywhere (no `where`), so no one is teleported.
    thread.fields = { ...thread.fields, [made.payload.field]: made.payload.to };
    if (isInt(ctx.rev)) thread.rev = ctx.rev;
    return true;
}

/** `director.pulse { at }` (cause `system`, from the hook; refused from a click): the roll for the reply being written, recorded. */
export function pulseCommand(ctx, payload = {}) {
    if (ctx?.cause === 'ui') return ctx.fail('REFUSED', 'The world pulse is rolled by Story Director itself.');
    const at = payload?.at;
    if (!(isInt(at) && at >= 0)) return ctx.fail('INVALID', 'director.pulse: "at" must be the chat\'s length (a whole number).');
    const mode = modeOf(settingsOf(ctx.settings));
    if (mode === 'off') return { summary: '', narrate: false, data: { skipped: 'off' } };
    const director = ctx.draft('director');
    const read = name => { try { return typeof ctx.read === 'function' ? ctx.read(name) : null; } catch { return null; } };
    const state = { domains: { director, scene: read('scene'), arc: read('arc'), cast: read('cast'), keypeople: read('keypeople'), dataModules: read('dataModules') } };
    const query = typeof ctx.query === 'function' ? (name, args) => ctx.query(name, args) : null;
    // The draws come first and always: a skip or a step-down never shifts them.
    const draw = drawsFrom(ctx.rng);
    const before = resultsOf(director).filter(entry => entry.at !== at);
    const v2 = payload?.pulse === 2;
    const recent = before.filter(entry => entry.kind && entry.kind !== 'SKIP').slice(-3);
    const clock = isInt(director.time?.minutes) ? director.time.minutes : null;
    const last = before.at(-1);
    const scene = sceneOf(query, state);
    // Only a step that carries `age` (every new reply) knows a leftover Foes slot; an older reply re-read keeps the rule it was written under.
    const foes = foesSignature(state);
    const stale = payload?.age === 1 && foesLeftover(state, before, STALE_REPLIES);
    const skipped = skipReason({
        fight: fightOn(query, state, { leanOn: !stale }), rested: restedSince(state, last?.clock, clock), quiet: slotValue(director.pulseQuiet)?.on === true, clock,
        jumpMinutes: isInt(last?.clock) && isInt(clock) ? clock - last.clock : null,
    });
    // A skipped reply still closes the rumours that are over (they would stay in the narrator's chronicle note otherwise).
    if (skipped && ask(query, 'chronicle.events', { open: true }, []).some(event => event?.rumour)) { try { ctx.call('chronicle.rumor', { at, expire: true }); } catch { /* the skip goes on */ } }
    const { cue = '', ...entry } = skipped ? { kind: 'SKIP', skipped, text: '' } : rollEntry({ ctx, director, state, query, scene, draw, at, clock, mode, reach: [1, 2, 3].includes(payload?.reach) ? payload.reach : 0, persona: typeof payload?.persona === 'string' ? payload.persona : '', v2, invents: settingsOf(ctx.settings).invents !== false, recent });
    director.pulse = toSlot({ results: [...before, { at, clock, ...entry, ...(payload?.age === 1 && foes ? { foes } : {}) }].slice(-RESULTS_MAX) });
    // The line rides the reply's own receipt as its [Happened] cue (a prelude: previewed for the prompt, stored with the generated reply), so
    // a swipe, a regenerate or a delete of the reply takes the roll and its effects back; a CALM or skipped roll tells nothing.
    const line = skipped || entry.kind === 'CALM' ? '' : worldLine(entry.brief ?? entry.text, entry.brief ? BRIEF_CHARS : TAIL_CHARS);
    // A chance meeting also carries the cast's cue for the person met: the prelude is previewed on the head state, which has no meeting yet.
    return { summary: cue && line ? `${line}\n${cue}` : line, narrate: Boolean(line), data: { keep: true, kind: entry.kind, ...(entry.d20 ? { d20: entry.d20 } : {}), ...(skipped ? { skipped } : {}) } };
}

/** `director.pulse.quiet { on }` (the reader's): the quiet-scene flag, a slot written whole; while it is on every reply is skipped. */
export function quietCommand(ctx, payload = {}) {
    if (typeof payload?.on !== 'boolean') return ctx.fail('INVALID', 'director.pulse.quiet takes { on: true | false }.');
    ctx.draft('director').pulseQuiet = toSlot({ on: payload.on });
    return { summary: payload.on ? 'Quiet scene: the world pulse rests.' : 'Quiet scene is over: the world pulse goes on.', narrate: false, data: { on: payload.on } };
}

/** `beforeGenerate(view, info)`: one `director.pulse` step per reply written (a normal reply, a swipe or a regenerate; a Continue commits nothing). */
export function pulseHook(view, info = {}) {
    if (!view?.state?.domains?.director || !pulseOn(view) || modeOf(settingsOf(view.settings)) === 'off') return undefined;
    const type = String(info?.type ?? 'normal').toLowerCase();
    const length = view?.chat?.length;
    if (info?.commit === false || !['normal', 'swipe', 'regenerate'].includes(type) || !isInt(length)) return undefined;
    // The chat holds the reply being swiped, so the reply's place is one below its length.
    return { commands: [{ type: PULSE, payload: { at: Math.max(0, length - (type === 'swipe' ? 1 : 0)), age: 1, reach: 3, pulse: 2, persona: personaName() } }] };
}

// A prelude (Story Block registry.isPrelude): the host previews it for the prompt and stores it on the generated reply with the same seed.
const tagged = (fn, extra = {}) => Object.assign(fn, { feature: FEATURE, ...extra });

export const part = {
    features: [{
        id: FEATURE,
        label: 'World pulse',
        describe: 'Before each reply a d20 decides if something small happens around you: an incident, news, a chance meeting, an arrival. One line goes with the reply. Skipped after a rest or a long jump, and in a quiet scene.',
        default: true,
    }],
    commands: { [PULSE]: tagged((ctx, payload) => pulseCommand(ctx, payload), { prelude: true }), [QUIET]: tagged((ctx, payload) => quietCommand(ctx, payload)) },
    context: { parts: [{ feature: FEATURE, static: () => PULSE_STATIC }] },
    hooks: { beforeGenerate: pulseHook },
    settings: {
        defaults: { mode: 'lively', showUnderReply: false, invents: true },
        schema: {
            mode: {
                type: 'choice', form: 'segmented', label: 'World pulse', feature: FEATURE,
                options: [{ value: 'off', label: 'Off' }, { value: 'quiet', label: 'Quiet' }, { value: 'lively', label: 'Lively' }],
                help: 'Off: nothing. Quiet: small background touches only. Lively: rumours, meetings, arrivals and schedule shifts too.',
            },
            invents: { type: 'bool', label: 'Pulse invents events (model)', help: 'On: the note asks the narrator to invent one small event from the people and threads in play. Off: fixed lines.', feature: FEATURE },
            showUnderReply: { type: 'bool', label: 'Show the roll under replies', help: 'Off: only the Director tab shows it (spoilers).', feature: FEATURE },
        },
    },
};
