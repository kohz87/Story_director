// Story Director v2, part **ripples**: a hidden, derived sway per named power (pure; nothing stored).
//
// A pack's content section `ripples` names the powers rival claimants can win over, the tiers and caps the
// scoring uses, and the pack's own world directions. Nothing is stored: every call rebuilds each power's sway
// from the head state the wiring hands in (quests, chronicle events, Story Block standing changes, board fights
// won), so a swipe, a rebuild, a reload or a delete gives the same answer for the same state.
//
// * **Table** (`validateRipples`): a section that is not an object, or has no usable power, is ignored with a
//   Problem (`table` null). A bad power is dropped with a Problem and the rest stay. Ids are lowercase slugs and
//   unique; base is 0..100; tiers and caps are whole numbers (else their default).
// * **Signals** (`swayOf`). Each signal's total is clamped to its own cap (`caps.quest`, `caps.event`,
//   `caps.standing`, `caps.fight`), then the power's total to ±`caps.power`. Sway = base + total, 0..100.
//   - quests: a resolved quest scores for ONE power, the one it served: the giver's (the giver names the power's
//     labels or givers); with no giver match, the power the key, name or summary names when that is only one.
//     Two or more claimants named: none. done: +small, or +great when `great`; failed: −failed; abandoned: −abandoned.
//   - world events: a resolved event (`open: false`) the pack gives a direction to (`worldDirections`: matched by
//     name, aka or id, folded). The favoured power gets +great, or −great when how it ended (the event's summary)
//     has one of the entry's `unless` words; a power the event's factions name gets −small when the event went
//     the favoured way.
//   - standing: Story Block's standing key change since the chat's start: its value minus the power's `standingBase` (0).
//   - fights: a board fight won against a group naming one of the power's `npcs` (its own people): −fight × the weight.
// * **Inputs** (plain arrays, newest first is the wiring's choice; ties keep that order):
//   `quests [{ key, name, giver, summary, outcome: 'done'|'failed'|'abandoned'|null, great, at }]`,
//   `events [{ id, name, aka: [name], summary, factions: [name], open, at }]`, `standing [{ key, delta, at }]`,
//   `fights [{ won, groups: [name], at }]`.
// * **Leader** (`leaderOf`): the top or bottom power among a list of ids (pack order breaks ties); null when
//   there is no table, no powers to pick from, or `pick` is neither 'top' nor 'bottom'.
// Names match case-folded, as whole words ("Corvin's" matches Corvin; "Chasseurs" does not match Hasse).

import { questDifficulty } from '../../changes.js';
import { foldedQuests } from '../tracker/fold.js';

export const RIPPLES_SECTION = 'ripples';
export const DEFAULT_TIERS = Object.freeze({ small: 4, great: 8, failed: 3, abandoned: 1, fight: 2 });
export const DEFAULT_CAPS = Object.freeze({ quest: 12, event: 12, standing: 10, fight: 6, power: 20 });
const KINDS = Object.freeze(['quest', 'event', 'standing', 'fight']);
const MAX_POWERS = 12;
const MAX_LIST = 20;
const MAX_NAME = 80;
const MAX_TEXT = 160;
const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;

const text = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const fold = value => text(value).normalize('NFKC').toLowerCase();
const cut = (value, max) => Array.from(value).slice(0, max).join('');
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const list = value => (Array.isArray(value) ? value : []);
const whole = (value, max) => Number.isSafeInteger(value) && value >= 0 && value <= max;
const clamp = (value, limit) => Math.max(-limit, Math.min(limit, value));
const when = value => (Number.isSafeInteger(value) ? value : null);

const WORDS = new Map();
/** The whole-word test of one folded needle (cached: a table has few names). */
function wordTest(want) {
    if (!WORDS.has(want)) {
        if (WORDS.size > 500) WORDS.clear();
        WORDS.set(want, new RegExp(`(?<![\\p{L}\\p{N}])${want.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'u'));
    }
    return WORDS.get(want);
}

/** True when `haystack` (folded once by the caller, or here) holds one of the non-empty `needles` as a whole word. */
function mentions(haystack, needles) {
    const hay = fold(haystack);
    return needles.some(needle => {
        const want = fold(needle);
        return want !== '' && wordTest(want).test(hay);
    });
}

/** A power's labels: its name and aliases (folded text is matched, so the case is kept for display only). */
const labelsOf = power => [power.name, ...power.aliases];

/** Short text lists: trimmed, de-duplicated (case-folded), at most MAX_LIST entries. */
function namesOf(raw, problems, where) {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) {
        problems.push(`${where} is not a list`);
        return [];
    }
    const out = [];
    for (const item of raw.slice(0, MAX_LIST)) {
        const value = cut(text(item), MAX_NAME);
        if (value && !out.some(seen => fold(seen) === fold(value))) out.push(value);
    }
    return out;
}

/** Whole-number settings: each key of `defaults` read from `raw` (bad values keep the default, with a Problem). */
function numbersOf(raw, defaults, max, problems, where) {
    const out = { ...defaults };
    if (raw === undefined || raw === null) return out;
    if (!isObject(raw)) {
        problems.push(`${where} is not an object`);
        return out;
    }
    for (const key of Object.keys(defaults)) {
        if (raw[key] === undefined) continue;
        if (whole(raw[key], max)) out[key] = raw[key];
        else problems.push(`${where}.${key} must be a whole number 0..${max}`);
    }
    return out;
}

/** One power of the section, or null with a Problem. */
function powerOf(raw, index, seen, problems) {
    const where = `ripples.powers[${index}]`;
    if (!isObject(raw)) return problems.push(`${where} is not an object`), null;
    const id = text(raw.id);
    if (!SLUG.test(id)) return problems.push(`${where}.id must be a lowercase slug`), null;
    if (seen.has(id)) return problems.push(`${where}.id "${id}" is repeated`), null;
    const name = cut(text(raw.name), MAX_NAME);
    if (!name) return problems.push(`${where}.name is missing`), null;
    if (!whole(raw.base, 100)) return problems.push(`${where}.base must be a whole number 0..100`), null;
    const npcs = [];
    for (const item of list(raw.npcs).slice(0, MAX_LIST)) {
        const npc = isObject(item) ? { name: cut(text(item.name), MAX_NAME), weight: item.weight ?? 1 } : null;
        if (!npc?.name || !whole(npc.weight, 3) || npc.weight < 1) {
            problems.push(`${where}.npcs: an entry needs a name and a weight 1..3`);
            continue;
        }
        npcs.push(npc);
    }
    seen.add(id);
    return {
        id,
        name,
        aliases: namesOf(raw.aliases, problems, `${where}.aliases`),
        factions: namesOf(raw.factions, problems, `${where}.factions`),
        givers: namesOf(raw.givers, problems, `${where}.givers`),
        npcs,
        base: raw.base,
        standing: text(raw.standing) || null,
        standingBase: Number.isSafeInteger(raw.standingBase) ? raw.standingBase : 0,
    };
}

/** The pack's world directions: `{ event, favours, unless }`, `favours` a power id of the table, `unless` words of a bad ending. */
function directionsOf(raw, powerIds, problems) {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) {
        problems.push('ripples.worldDirections is not a list');
        return [];
    }
    const out = [];
    for (const item of raw.slice(0, MAX_LIST)) {
        const event = isObject(item) ? cut(text(item.event), MAX_NAME) : '';
        const favours = isObject(item) ? text(item.favours) : '';
        if (!event || !powerIds.includes(favours)) {
            problems.push('ripples.worldDirections: an entry needs an event and the id of a power');
            continue;
        }
        out.push({ event, favours, unless: namesOf(item.unless, problems, 'ripples.worldDirections.unless') });
    }
    return out;
}

/**
 * Validates a pack's `ripples` section: `{ table, problems }`. `table` is `{ powers, tiers, caps, worldDirections }`
 * or null (no section, or nothing usable in it). `standingModule` names Story Block's standing data module. Never throws.
 */
export function validateRipples(section) {
    const problems = [];
    if (section === undefined || section === null) return { table: null, problems };
    if (!isObject(section)) return { table: null, problems: ['ripples: the section is not an object'] };
    if (!Array.isArray(section.powers)) return { table: null, problems: ['ripples.powers is not a list'] };
    if (section.powers.length > MAX_POWERS) problems.push(`ripples.powers has more than ${MAX_POWERS} entries; the rest are ignored`);
    const seen = new Set();
    const powers = [];
    section.powers.slice(0, MAX_POWERS).forEach((raw, index) => {
        const power = powerOf(raw, index, seen, problems);
        if (power) powers.push(power);
    });
    if (!powers.length) return { table: null, problems: [...problems, 'ripples: no usable power'] };
    const tiers = numbersOf(section.tiers, DEFAULT_TIERS, 50, problems, 'ripples.tiers');
    const caps = numbersOf(section.caps, DEFAULT_CAPS, 100, problems, 'ripples.caps');
    const worldDirections = directionsOf(section.worldDirections, powers.map(power => power.id), problems);
    const standingModule = cut(text(section.standingModule), MAX_NAME) || null;
    return { table: { powers, tiers, caps, worldDirections, standingModule }, problems };
}

/** The id of the one power a quest served (its giver's; else the one its key, name or summary names), or null. */
function questOwner(quest, table) {
    const pick = haystack => {
        const hits = table.powers.filter(power => mentions(haystack, [...labelsOf(power), ...power.givers]));
        return hits.length === 1 ? hits[0].id : hits.length > 1 ? false : null;
    };
    const byGiver = text(quest.giver) ? pick(quest.giver) : null;
    if (byGiver !== null) return byGiver || null;
    return pick([quest.key, quest.name, quest.summary].map(text).join(' | ')) || null;
}

/** Sway per power from one signal's point of view: the matching entries, with their deltas and texts. */
function questReasons(power, quests, tiers, table) {
    const out = [];
    for (const quest of list(quests)) {
        const delta = quest.outcome === 'done' ? (quest.great === true ? tiers.great : tiers.small)
            : quest.outcome === 'failed' ? -tiers.failed
            : quest.outcome === 'abandoned' ? -tiers.abandoned : 0;
        if (!delta || questOwner(quest, table) !== power.id) continue;
        const label = cut(text(quest.name) || text(quest.key) || 'a quest', MAX_NAME);
        const giver = text(quest.giver);
        const verb = quest.outcome === 'done' ? 'finished' : quest.outcome === 'failed' ? 'failed' : 'gave up on';
        out.push({ kind: 'quest', delta, text: cut(`${verb} ${label}${giver ? ` for ${giver}` : ''}`, MAX_TEXT), when: when(quest.at) });
    }
    return out;
}

function eventReasons(power, events, directions, tiers) {
    const out = [];
    for (const event of list(events)) {
        if (event.open !== false) continue;
        const name = cut(text(event.name), MAX_NAME);
        const known = [name, text(event.id), ...list(event.aka).map(text)].map(fold).filter(Boolean);
        const entry = directions.find(item => known.includes(fold(item.event)));
        if (!entry) continue;
        const against = entry.unless.length > 0 && mentions(event.summary, entry.unless);
        const factions = list(event.factions).map(text);
        if (entry.favours === power.id) {
            const delta = against ? -tiers.great : tiers.great;
            out.push({ kind: 'event', delta, text: cut(against ? `${name} went against ${power.name}` : `${name} went ${power.name}'s way`, MAX_TEXT), when: when(event.at) });
        } else if (!against && factions.some(faction => mentions(faction, [...labelsOf(power), ...power.factions]))) {
            out.push({ kind: 'event', delta: -tiers.small, text: cut(`${name} cost ${power.name} ground`, MAX_TEXT), when: when(event.at) });
        }
    }
    return out;
}

function standingReasons(power, standing) {
    const out = [];
    if (!power.standing) return out;
    for (const change of list(standing)) {
        if (change.key !== power.standing || !Number.isSafeInteger(change.delta) || change.delta === 0) continue;
        const verb = change.delta > 0 ? 'rose' : 'fell';
        out.push({ kind: 'standing', delta: change.delta, text: `${power.name}'s standing ${verb}`, when: when(change.at) });
    }
    return out;
}

function fightReasons(power, fights, tiers) {
    const out = [];
    for (const fight of list(fights)) {
        if (fight.won !== true) continue;
        const groups = list(fight.groups).map(text);
        const npc = power.npcs.find(item => groups.some(group => mentions(group, [item.name])));
        if (!npc) continue;
        out.push({ kind: 'fight', delta: -tiers.fight * npc.weight, text: cut(`won a fight against ${npc.name}'s people`, MAX_TEXT), when: when(fight.at) });
    }
    return out;
}

/** Every signal's reasons for each power of the table: `Map(id → [{ kind, delta, text, when }])`. */
function reasonsOf(table, inputs) {
    const directions = table.worldDirections;
    const out = new Map();
    for (const power of table.powers) {
        out.set(power.id, [
            ...questReasons(power, inputs.quests, table.tiers, table),
            ...eventReasons(power, inputs.events, directions, table.tiers),
            ...standingReasons(power, inputs.standing),
            ...fightReasons(power, inputs.fights, table.tiers),
        ]);
    }
    return out;
}

/**
 * The sway of every power of the table, in pack order: `[{ id, name, sway, reasons: [{ kind, text, delta, when }] }]`.
 * `inputs` is `{ quests, events, standing, fights }` (missing lists count as empty). `only` (ids) narrows the answer
 * (the scoring still reads every signal). Reasons are sorted by size, the bigger first, ties in input order.
 * No table gives [] (no Director, no section).
 */
export function swayOf(table, inputs = {}, only = null) {
    if (!table) return [];
    const reasons = reasonsOf(table, inputs ?? {});
    const rows = [];
    for (const power of table.powers) {
        if (Array.isArray(only) && !only.includes(power.id)) continue;
        const mine = reasons.get(power.id) ?? [];
        let total = 0;
        for (const kind of KINDS) {
            const sum = mine.filter(item => item.kind === kind).reduce((acc, item) => acc + item.delta, 0);
            total += clamp(sum, table.caps[kind]);
        }
        const sway = Math.max(0, Math.min(100, power.base + clamp(total, table.caps.power)));
        const sorted = [...mine].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
        rows.push({ id: power.id, name: power.name, sway, reasons: sorted.map(({ kind, delta, text: line, when: at }) => ({ kind, text: line, delta, when: at })) });
    }
    return rows;
}

/**
 * The top or bottom power of `rows` (a `swayOf` answer) among the ids in `among` (null: all). Ties keep the
 * rows' order, which is pack order. Null when nothing is left to pick, or `pick` is neither 'top' nor 'bottom'.
 */
export function leaderOf(rows, { among = null, pick = 'top' } = {}) {
    const dir = pick === 'top' ? 1 : pick === 'bottom' ? -1 : 0;
    if (!dir || !Array.isArray(rows)) return null;
    const pool = rows.filter(row => !Array.isArray(among) || among.includes(row.id));
    if (!pool.length) return null;
    let best = pool[0];
    for (const row of pool.slice(1)) {
        if (dir * (row.sway - best.sway) > 0) best = row;
    }
    return best.id;
}

// ---- wiring: the part's two queries, the inputs read from the head state ------------------------------------------

const GREAT = new Set(['hard', 'nightmare']);
const ask = (tools, name, args) => {
    try { return typeof tools?.query === 'function' ? tools.query(name, args) ?? null : null; } catch { return null; }
};
const listOf = value => (Array.isArray(value) ? value : []);

/** The pack's table: the `packs.ripples` section (a host that has none gives null), validated; a bad one is ignored. */
export function tableOf(tools) {
    return checkedTable(tools).table;
}

const checkedTable = tools => {
    const found = ask(tools, 'packs.ripples', {});
    return validateRipples(found && typeof found === 'object' ? found : null);
};

/** `ripples.problems` → the pack table's Problems (strings), [] when it is fine or there is no section. */
export const problemsQuery = (state, args, tools) => checkedTable(tools).problems;

/** The inputs `swayOf` reads, from the head state: resolved quests, resolved world events, standing, won board fights. */
export function inputsOf(state, tools, table) {
    const quests = listOf(ask(tools, 'director.threads', { status: 'resolved' })).filter(thread => thread?.kind === 'quest' || thread?.kind === 'hook').map(thread => ({
        key: thread.key, name: thread.key, giver: thread.fields?.giver, summary: thread.summary,
        outcome: ['done', 'failed', 'abandoned'].includes(thread.ended?.outcome) ? thread.ended.outcome : null,
        great: GREAT.has(questDifficulty(thread.fields?.difficulty)), at: thread.ended?.at ?? null,
    }));
    // Finished quests and hooks the fold took still count: their records carry what is scored (tracker/fold.js).
    for (const row of foldedQuests(state?.domains?.director)) {
        quests.push({ key: row.key, name: row.name, giver: row.giver, summary: row.summary, outcome: row.outcome, great: GREAT.has(questDifficulty(row.difficulty)), at: null });
    }
    const events = listOf(ask(tools, 'chronicle.events', { open: false })).map(event => ({
        id: event.id, name: event.name, aka: listOf(event.aka), summary: event.summary, factions: listOf(event.factions).map(item => item?.name ?? item), open: event.open, at: event.updated ?? null,
    }));
    // Standing: the change since the chat's start: the key's value now minus the power's `standingBase` (0 unless the pack says).
    const standing = [];
    const fields = table.standingModule ? ask(tools, 'dataModules.view', { module: table.standingModule })?.chat : null;
    for (const power of table.powers) {
        const value = fields?.[power.standing];
        if (power.standing && Number.isSafeInteger(value)) standing.push({ key: power.standing, delta: value - power.standingBase, at: null });
    }
    // Won board fights: the `rpg.fight` receipts (a fight that is not won writes none) with the groups they faced.
    let entries = [];
    try { entries = typeof tools?.receipts === 'function' ? tools.receipts() ?? [] : []; } catch { entries = []; }
    const fights = [];
    const upTo = Number.isSafeInteger(tools?.reply?.index) ? tools.reply.index : null;
    for (const entry of listOf(entries)) {
        if (upTo !== null && Number.isSafeInteger(entry?.index) && entry.index > upTo) continue;
        const receipt = entry?.receipt ?? entry;
        const fight = receipt?.type === 'rpg.fight' ? receipt.data?.v2?.result?.fight : null;
        if (fight && Array.isArray(fight.groups)) fights.push({ won: true, groups: fight.groups.map(group => group?.name), at: null });
    }
    return { quests, events, standing, fights };
}

const hasClock = state => state?.domains?.director && Number.isSafeInteger(state.domains.director.time?.minutes);

/** `ripples.sway { powers? }` → `[{ id, name, sway, reasons }]` in pack order; [] with no table or no Director. */
export function swayQuery(state, args, tools) {
    const table = tableOf(tools);
    if (!table || !state?.domains?.director) return [];
    return swayOf(table, inputsOf(state, tools, table), Array.isArray(args?.powers) ? args.powers : null);
}

/** `ripples.leader { among, pick }` → a power id, or null (no table, no Director, no clock, nothing to pick). */
export function leaderQuery(state, args, tools) {
    if (!hasClock(state)) return null;
    return leaderOf(swayQuery(state, {}, tools), { among: Array.isArray(args?.among) ? args.among : null, pick: args?.pick ?? 'top' });
}

/** The part: three read-only queries (sway, leader, the table's problems), no state, no prompt text, no feature (a reader's switch must not change a pack's branch). */
export const part = {
    domains: {},
    commands: {},
    queries: { 'ripples.sway': swayQuery, 'ripples.leader': leaderQuery, 'ripples.problems': problemsQuery },
    kinds: {},
    hooks: {},
    tabs: [],
    widgets: {},
};
