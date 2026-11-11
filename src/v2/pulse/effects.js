// Story Director v2, part **pulse** (feature `story-director.pulse`): the World pulse. Before each reply, code rolls a d20 from the
// step's seed (`director.pulse { at }`, a system step from beforeGenerate: the same bytes of state + seed give the same roll; a swipe
// is a new step with a new seed, so it rolls again), picks an entry from tables.js, applies its effect and records the result in the
// slot `director.pulse = [{ results: [last 5] }]`. The tail gets one optional line "World this reply: …" (none on CALM or a skip).
// A reply is skipped, and the skip recorded, during a fight, after an explicit rest, after a jump of 6+ story hours, while the
// reader's quiet-scene flag is set (`director.pulse.quiet { on }`, slot `director.pulseQuiet`) and while the clock is unset.
// The builders below are pure (no state, no ctx, no model call); the part (the command, hook, tail, settings) is at the end.
//
// Each builder takes the candidates the caller has already filtered (what could be used here) and the roll's draw units
// (tables.js drawsFrom): `actor` picks the candidate, `line` decides the rest. It returns `{ kind, type, payload, tail, receipt }`:
// the command the hook runs (`chronicle.rumor`, `cast.meet`, `director.pulse.arrive`, `director.pulse.shift`), the tail text
// without its label (worldLine adds "World this reply:"), and what `director.pulse` stores. `null` means the entry cannot
// happen with these candidates; the caller then steps down the table (tables.js resolveKind does not know the candidates).
//
// * skipReason: why a reply writes no roll at all, the first that holds: 'fight', 'rest', 'jump' (JUMP_MINUTES or more since
//   the last reply), 'quiet' (the chat's quiet-scene flag), 'clock' (no story clock). '' when the reply is rolled.
// * Rumour (GOSSIP_SURGE, OVERHEARD_DETAIL): one known fact becomes a `looming` chronicle event. Known facts only: a candidate
//   whose name is in `behind` (the lineKeys of hidden names, world/known.js hiddenNames) is dropped before the pick.
// * Chance meeting (CHANCE_MEETING): one unmet, living cast person is met at `place` (`cast.meet`, why 'goal').
// * Arrival (ENTER_CHECK): one off-screen agenda's `arrive` moves 1 or 2 replies' worth of story minutes ahead (REPLY_MINUTES).
// * Shift (TASK_SHIFT): one off-screen agenda's `on` moves early or late by 1 to 4 hours. Agenda dates are calendar text, so
//   the caller parses them (`abs`: story minutes) and gives `format(minutes)` back; without `format` the entry cannot happen.
// * Names: a person or agenda is named in the tail only when the caller says the name is known to {{user}} (`named`); else the
//   line stays general, so a hidden agenda or secret never reaches the note.
// * Tail lines are plain text: plainSlot (no braces, angle brackets or line breaks), cut by code points.

import { lineKey } from '../../changes.js';
import { dateOf } from '../../relevance.js';
import { slotValue, toSlot } from '../slot.js';
import { fightOn } from '../cast/entries.js';
import { calendarFrom } from '../keypeople/time.js';
import { orderedThreads } from '../tracker/convert.js';
import { ask, cutPoints, namesPerson, sceneOf } from '../tracker/scene.js';
import { drawsFrom, d20Of, fillSlots, flavourFor, pickIndex, placeGroupOf, plainSlot, resolveKind, tableFor, QUIET_FALLBACK } from './tables.js';

export const JUMP_MINUTES = 360;
export const REPLY_MINUTES = 20;
export const TAIL_CHARS = 160;
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

/** The tail line for an effect's text: "World this reply: …", plain and at most TAIL_CHARS; '' when there is no text. */
export function worldLine(text) {
    const body = plainSlot(text, TAIL_CHARS);
    return body ? `World this reply: ${body}` : '';
}

/**
 * A rumour from one known fact (`known`: [{ id, name, summary, place, factions }]), for GOSSIP_SURGE (talk) or OVERHEARD_DETAIL
 * (snatches). The chronicle event is `looming` and is keyed by the chat's length (`at`), so a swipe that removes the reply removes it.
 */
export function rumourEntry(kind, { known = [], behind = new Set(), at = null, place = '', draw = {} } = {}) {
    if (!isInt(at)) return null;
    const facts = (Array.isArray(known) ? known : [])
        .filter(fact => isRecord(fact) && plainSlot(fact.name, NAME_MAX) && !behind.has(lineKey(fact.name)))
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
        payload: { at, event: { id, name: `Rumour of ${name}`, summary, state: 'looming', place: where, factions } },
        tail,
        receipt: { event: id },
    };
}

/**
 * CHANCE_MEETING: one unmet, living cast person (`cast`: the cast domain) comes across the party at `place` (required: a place
 * the reader is at). Met by the pulse, so the person is met now; the note's line does not name them.
 */
export function meetEntry({ cast = null, at = null, place = '', draw = {} } = {}) {
    const where = plainSlot(place, NAME_MAX);
    if (!isInt(at) || !where || !isRecord(cast?.people)) return null;
    const people = Object.keys(cast.people).sort()
        .map(key => ({ key, person: cast.people[key] }))
        .filter(({ person }) => isRecord(person) && person.alive !== false && !person.met && plainSlot(person.name, NAME_MAX));
    const pick = people[pickIndex(people.length, unit(draw.actor))];
    if (!pick) return null;
    return {
        kind: 'CHANCE_MEETING',
        type: 'cast.meet',
        payload: { at, who: [{ key: pick.key, why: 'goal', reason: 'chance meeting', place: where }] },
        // Unnamed: the cast's own cue (`[Cast] …`, pinned) is the only text that names an unmet person.
        tail: `Someone new crosses your path in ${where}.`,
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
 */
export function shiftEntry({ agendas = [], at = null, format = null, draw = {} } = {}) {
    if (!isInt(at) || typeof format !== 'function') return null;
    const open = (Array.isArray(agendas) ? agendas : [])
        .filter(item => isRecord(item) && plainSlot(item.id, NAME_MAX) && typeof item.text === 'string' && item.text.trim() && Number.isFinite(item.abs))
        .map(item => ({ ...item, id: plainSlot(item.id, NAME_MAX) }))
        .sort(byId);
    const pick = open[pickIndex(open.length, unit(draw.actor))];
    if (!pick) return null;
    const line = unit(draw.line);
    const early = line < 0.5;
    const hours = 1 + Math.floor(frac(line * 2) * 4);
    const shift = (early ? -1 : 1) * hours * 60;
    const to = plainSlot(format(pick.abs + shift), NAME_MAX);
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
 * The extra fields an agenda line leaves: `step` (which step it is on, from 1), `steps` (how many, from the agenda's own `then` list
 * "a; b; c" or kept once set, at most) and `since` (the story minute the step began), when `now` or `then` moved; `where` (the atlas
 * place `now` names, given by the caller). A `step` the line itself wrote is left alone. `before` is the thread's fields (null: new).
 * Returns the fields to merge (all text), or null for no change.
 */
export function agendaProgress(before, after, { minutes = null, where = '' } = {}) {
    const moved = !before || before.now !== after.now || before.then !== after.then;
    const patch = {};
    if (moved && (after.now || after.then)) {
        const steps = Number(after.steps) > 0 ? Number(after.steps) : (segments(after.then) ? segments(after.then) + 1 : 0);
        const base = Number(after.step) > 0 && after.step !== before?.step ? Number(after.step) : (before ? (Number(before.step) || 1) + 1 : 1);
        const step = steps ? Math.min(steps, base) : base;
        if (String(step) !== after.step) patch.step = String(step);
        if (steps && String(steps) !== after.steps) patch.steps = String(steps);
        if (isInt(minutes) && String(minutes) !== after.since) patch.since = String(minutes);
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
export const RESULTS_MAX = 5;
const EFFECTS = new Set(['GOSSIP_SURGE', 'OVERHEARD_DETAIL', 'CHANCE_MEETING', 'ENTER_CHECK', 'TASK_SHIFT']);
const WEATHER_WORDS = [['rain', /rain|drizzle|shower|storm/i], ['snow', /snow|blizzard|sleet/i], ['fog', /fog|mist|haze/i], ['wind', /wind|gale|gust/i], ['heat', /heat|hot|scorch|swelter/i]];

/** The one static sentence, taught while the feature is on: the same bytes every reply. */
export const PULSE_STATIC = 'World pulse: "World this reply" in the note is a small thing that happens around {{user}}; weave it in lightly, never resolve it for {{user}}.';

const settingsOf = source => { const value = typeof source === 'function' ? source() : source; return isRecord(value) ? value : {}; };
/** Whether the feature is on (`ctx.feature` / `view.feature` when the host has them, F100), else on. */
export const pulseOn = source => (typeof source?.feature === 'function' ? source.feature(FEATURE) !== false : true);
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
    return Object.values(instances).some(item => { const at = item?.chat?.fields?.['rested-at']; return isInt(at) && at > from && at <= now + 1; });
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
function rollEntry({ ctx, director, state, query, scene, draw, at, clock, mode }) {
    const here = ask(query, 'atlas.here', {}, null);
    const place = cutPoints(here?.name || scene.place, NAME_MAX);
    const group = placeGroupOf(here?.placeKind ?? here?.kind ?? '');
    const weather = weatherFrom(ask(query, 'scene.weather', {}, null)?.text);
    const calendar = calendarFrom(query);
    const agendas = offscreenAgendas(director, scene);
    const people = state.domains.cast?.people;
    const unmet = Object.values(isRecord(people) ? people : {}).filter(person => isRecord(person) && person.alive !== false && !person.met);
    const known = ask(query, 'chronicle.events', { open: true }, []);
    const away = Object.keys(state.domains.keypeople?.away ?? {}).length;
    const names = new Set(scene.people.map(person => person.key));
    for (const name of [...ask(query, 'npc.known', {}, []), ...Object.values(isRecord(people) ? people : {}).map(person => person?.name)]) if (lineKey(name)) names.add(lineKey(name));
    const lively = mode === 'lively';
    const counts = { present: scene.people.length, offscreen: lively ? agendas.length + away + unmet.length : 1, known: lively ? known.length : 1, cast: lively ? unmet.length : 1 };
    const table = tableFor({ named: names.size, offscreen: agendas.length + away + unmet.length });
    const d20 = d20Of(draw.d20);
    const blocked = new Set();
    for (let tries = 0; tries < 8; tries += 1) {
        const rolled = resolveKind(table, d20, { group, weather, counts, blocked });
        // Quiet: an effect entry keeps its band but reads as its flavour fallback.
        if (!lively && QUIET_FALLBACK[rolled.kind]) rolled.kind = QUIET_FALLBACK[rolled.kind];
        const base = { d20, table, kind: rolled.kind, ...(place ? { place } : {}) };
        if (!EFFECTS.has(rolled.kind)) {
            const who = scene.people.length ? scene.people[pickIndex(scene.people.length, draw.actor)]?.name : '';
            const text = rolled.kind === 'CALM' ? '' : fillSlots(flavourFor(rolled.kind, draw.line, { group, weather }), { name: who, place });
            return { ...base, ...(who && text.includes(who) ? { who } : {}), text: plainSlot(text, TAIL_CHARS) };
        }
        const made = effectFor(rolled.kind, {
            known, behind: new Set(), at, place, draw, cast: state.domains.cast, now: clock, format: minutes => calendar.format(minutes),
            agendas: agendas.map(thread => ({ id: thread.id, name: thread.key, named: false, arrive: thread.fields?.arrive, text: thread.fields?.on, abs: dateOf(thread, 'on', { calendar, reference: clock })?.abs })),
        });
        if (made && applyEffect(ctx, director, made, place)) return { ...base, text: plainSlot(made.tail, TAIL_CHARS), effect: { type: made.type, ...made.receipt } };
        blocked.add(rolled.kind);
    }
    return { d20, table, kind: 'CALM', text: '' };
}

// The effect's step: another part's command (the same receipt), or the agenda's own date on the thread (marked ctx.ifThere).
function applyEffect(ctx, director, made, place) {
    if (made.type === 'chronicle.rumor' || made.type === 'cast.meet') {
        try { ctx.call(made.type, made.payload); return true; } catch { return false; }
    }
    const thread = director.threads?.[made.payload.thread];
    if (!thread || thread.status !== 'active') return false;
    if (typeof ctx.ifThere === 'function') ctx.ifThere('director', `/threads/${thread.id}`);
    thread.fields = { ...thread.fields, [made.payload.field]: made.payload.to, ...(made.payload.field === 'arrive' && place ? { where: place } : {}) };
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
    const state = { domains: { director, scene: read('scene'), cast: read('cast'), keypeople: read('keypeople'), dataModules: read('dataModules') } };
    const query = typeof ctx.query === 'function' ? (name, args) => ctx.query(name, args) : null;
    // The draws come first and always: a skip or a step-down never shifts them.
    const draw = drawsFrom(ctx.rng);
    const before = resultsOf(director).filter(entry => entry.at !== at);
    const clock = isInt(director.time?.minutes) ? director.time.minutes : null;
    const last = before.at(-1);
    const scene = sceneOf(query, state);
    const skipped = skipReason({
        fight: fightOn(query, state), rested: restedSince(state, last?.clock, clock), quiet: slotValue(director.pulseQuiet)?.on === true, clock,
        jumpMinutes: isInt(last?.clock) && isInt(clock) ? clock - last.clock : null,
    });
    const entry = skipped ? { kind: 'SKIP', skipped, text: '' } : rollEntry({ ctx, director, state, query, scene, draw, at, clock, mode });
    director.pulse = toSlot({ results: [...before, { at, clock, ...entry }].slice(-RESULTS_MAX) });
    return { summary: '', narrate: false, data: { kind: entry.kind, ...(entry.d20 ? { d20: entry.d20 } : {}), ...(skipped ? { skipped } : {}) } };
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
    return { commands: [{ type: PULSE, payload: { at: Math.max(0, length - (type === 'swipe' ? 1 : 0)) } }] };
}

/** `context.tail(view)`: the latest result's line while it is this reply's (the chat's length is its `at` or one more), as an optional line. */
export function pulseTail(view) {
    const last = resultsOf(view?.state?.domains?.director).at(-1);
    const length = view?.chat?.length;
    if (!last || !pulseOn(view) || modeOf(settingsOf(view.settings)) === 'off' || !isInt(last.at) || !isInt(length) || length < last.at || length >= last.at + 2) return { lines: [], optional: [] };
    const line = last.skipped || last.kind === 'CALM' ? '' : worldLine(last.text);
    return { lines: [], optional: line ? [line] : [] };
}

const tagged = fn => Object.assign(fn, { feature: FEATURE });

export const part = {
    features: [{
        id: FEATURE,
        label: 'World pulse',
        describe: 'Before each reply a d20 decides if something small happens around you: an incident, news, a chance meeting, an arrival. The note carries one line. Skipped after a rest or a long time jump, and in a quiet scene.',
        default: true,
    }],
    commands: { [PULSE]: tagged((ctx, payload) => pulseCommand(ctx, payload)), [QUIET]: tagged((ctx, payload) => quietCommand(ctx, payload)) },
    context: { tail: pulseTail, parts: [{ feature: FEATURE, static: () => PULSE_STATIC }] },
    hooks: { beforeGenerate: pulseHook },
    settings: {
        defaults: { mode: 'lively', showUnderReply: false },
        schema: {
            mode: { type: 'choice', label: 'World pulse', options: [...MODES], feature: FEATURE },
            showUnderReply: { type: 'bool', label: 'Show the pulse under the reply', feature: FEATURE },
        },
    },
};
