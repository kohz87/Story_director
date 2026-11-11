// Story Director v2, pulse part: the World pulse tables, the table choice by real counts, the draw order, the place
// groups and the flavour lines (pure data and pure functions; no state, no ctx, no model call).
//
// * Table: 'std' (Standard) when at least STANDARD_MIN_NAMED named people are in play and at least STANDARD_MIN_OFFSCREEN
//   of them are off-screen, else 'duo' (Duo). The caller counts: named = scene present + known NPCs + cast; offscreen =
//   open agendas + key people away + unmet cast.
// * Draw order (fixed, always three draws from ctx.rng() in this order, unused ones spent anyway, so a result never
//   shifts the draws after it): 'd20' (1 + floor(u × 20)), 'actor' (which named person, when the entry names one), 'line'
//   (which flavour line, when the entry has lines here). The same seed and state give the same result; a swipe draws anew.
// * Step-down: an entry that cannot happen here (no flavour line for the place group or weather, or no one to name)
//   steps to the next row of its table, wrapping round. CALM is in both tables and is always possible, so the walk
//   ends. A step spends no draw.
// * Place groups: an atlas place kind folds into wild, town, indoors, road or water by its words; no kind (or an unknown
//   one) is DEFAULT_GROUP.
// * Flavour lines: {name} is the actor's name and {place} the place's (fillSlots: flattened, cut, no markup). Setting-
//   agnostic wording: no pack names, currencies or factions. The effect entries (ENTER_CHECK, GOSSIP_SURGE,
//   CHANCE_MEETING, OVERHEARD_DETAIL, TASK_SHIFT) have no lines here: effects.js builds their text and payloads.

export const STANDARD = 'std';
export const DUO = 'duo';
export const STANDARD_MIN_NAMED = 3;
export const STANDARD_MIN_OFFSCREEN = 1;
export const DRAW_ORDER = Object.freeze(['d20', 'actor', 'line']);
export const PLACE_GROUPS = Object.freeze(['wild', 'town', 'indoors', 'road', 'water']);
export const DEFAULT_GROUP = 'town';
export const SLOT_MAX = 60;

const row = (from, to, kind) => Object.freeze({ from, to, kind });

/** The two tables: rows by d20 range, 1 to 20 with no gap. */
export const TABLES = Object.freeze({
    [STANDARD]: Object.freeze({
        id: STANDARD,
        title: 'Standard',
        rows: Object.freeze([
            row(1, 2, 'CALM'),
            row(3, 4, 'ENTER_CHECK'),
            row(5, 6, 'BACKGROUND_INCIDENT'),
            row(7, 8, 'MOOD_SWING'),
            row(9, 10, 'MUNDANE_INTERRUPTION'),
            row(11, 12, 'GOSSIP_SURGE'),
            row(13, 14, 'OVERHEARD_DETAIL'),
            row(15, 16, 'TASK_SHIFT'),
            row(17, 18, 'CHANCE_MEETING'),
            row(19, 20, 'CALM'),
        ]),
    }),
    [DUO]: Object.freeze({
        id: DUO,
        title: 'Duo',
        rows: Object.freeze([
            row(1, 2, 'CALM'),
            row(3, 4, 'ENV_SHIFT'),
            row(5, 6, 'PHYSICAL_REACTION'),
            row(7, 8, 'MOOD_SWING'),
            row(9, 10, 'MEMORY_TRIGGER'),
            row(11, 12, 'OBJECT_DISCOVERY'),
            row(13, 14, 'OUTSIDE_INTRUSION'),
            row(15, 16, 'POWER_SHIFT'),
            row(17, 18, 'MUNDANE_INTERRUPTION'),
            row(19, 20, 'CALM'),
        ]),
    }),
});

/** Which actor count an entry needs to happen: 'none', 'present', 'offscreen', 'known' or 'cast'. */
export const ACTOR_NEEDS = Object.freeze({
    CALM: 'none',
    ENTER_CHECK: 'offscreen',
    BACKGROUND_INCIDENT: 'none',
    MOOD_SWING: 'present',
    MUNDANE_INTERRUPTION: 'none',
    GOSSIP_SURGE: 'known',
    OVERHEARD_DETAIL: 'known',
    CHANCE_MEETING: 'cast',
    TASK_SHIFT: 'offscreen',
    ENV_SHIFT: 'none',
    PHYSICAL_REACTION: 'none',
    OBJECT_DISCOVERY: 'none',
    OUTSIDE_INTRUSION: 'none',
    MEMORY_TRIGGER: 'present',
    POWER_SHIFT: 'none',
});

/** The flavour kinds: one tail line each, from FLAVOUR. Their lines have a place group; ENV_SHIFT lines also a weather. */
export const FLAVOUR = Object.freeze({
    BACKGROUND_INCIDENT: Object.freeze([
        Object.freeze({ group: 'wild', text: 'A branch cracks somewhere off the path near {place}, and birds scatter.' }),
        Object.freeze({ group: 'town', text: 'A cart wheel splinters in the street near {place}; someone shouts.' }),
        Object.freeze({ group: 'indoors', text: 'A tray of cups clatters to the floor in {place}; the room goes quiet, then loud again.' }),
        Object.freeze({ group: 'road', text: 'A rider gallops past {place} without slowing, calling for the way to clear.' }),
        Object.freeze({ group: 'water', text: 'A rope snaps on the landing at {place}; crates slide and someone curses.' }),
    ]),
    MUNDANE_INTERRUPTION: Object.freeze([
        Object.freeze({ group: 'wild', text: 'A stray dog noses around the packs at {place}.' }),
        Object.freeze({ group: 'town', text: 'A vendor calls a price right beside you, loud enough to stop the talk.' }),
        Object.freeze({ group: 'indoors', text: 'Someone asks you to move your bag from the bench, then forgets why.' }),
        Object.freeze({ group: 'road', text: 'A carter asks the way to a place he has already passed.' }),
        Object.freeze({ group: 'water', text: 'Gulls take the bread someone dropped on the dock at {place}.' }),
    ]),
    MOOD_SWING: Object.freeze([
        Object.freeze({ group: 'wild', text: '{name} goes quiet and stares at the treeline for a long moment.' }),
        Object.freeze({ group: 'town', text: '{name} snaps at a passing stranger, then looks embarrassed about it.' }),
        Object.freeze({ group: 'indoors', text: '{name} pushes a cup away untouched and does not say why.' }),
        Object.freeze({ group: 'road', text: '{name} walks faster for a while and will not look back at you.' }),
        Object.freeze({ group: 'water', text: '{name} laughs at nothing, then stops, as if caught out.' }),
    ]),
    ENV_SHIFT: Object.freeze([
        Object.freeze({ group: 'wild', weather: 'rain', text: 'Rain comes through the trees near {place} all at once and soaks the path.' }),
        Object.freeze({ group: 'wild', weather: 'wind', text: 'A gust bends the grass around {place} flat and carries off a loose cloak.' }),
        Object.freeze({ group: 'wild', weather: 'fog', text: 'Fog rolls in over {place} and the far trees vanish.' }),
        Object.freeze({ group: 'wild', weather: 'snow', text: 'Snow starts to fall thick and fast over {place}.' }),
        Object.freeze({ group: 'town', weather: 'rain', text: 'Rain drives everyone under the eaves near {place}.' }),
        Object.freeze({ group: 'town', weather: 'wind', text: 'A gust slams a shutter open somewhere near {place}.' }),
        Object.freeze({ group: 'town', weather: 'heat', text: 'The heat off the stones at {place} lies thick until someone opens a window.' }),
        Object.freeze({ group: 'indoors', weather: 'rain', text: 'Rain drums on the roof above {place} and drips through somewhere.' }),
        Object.freeze({ group: 'indoors', weather: 'wind', text: 'A draught finds its way under the door at {place}; the lamps gutter.' }),
        Object.freeze({ group: 'road', weather: 'rain', text: 'Rain turns the road to mud past {place}.' }),
        Object.freeze({ group: 'road', weather: 'fog', text: 'Fog thickens on the road by {place}; the next milestone disappears.' }),
        Object.freeze({ group: 'road', weather: 'heat', text: 'The road shimmers with heat near {place}; a horse stops and will not move.' }),
        Object.freeze({ group: 'water', weather: 'wind', text: 'The wind rises on the water at {place} and the boats strain at their lines.' }),
        Object.freeze({ group: 'water', weather: 'fog', text: 'Fog lies on the water at {place}; a bell sounds from somewhere unseen.' }),
        Object.freeze({ group: 'water', weather: 'rain', text: 'Rain pocks the water at {place} until the surface looks like hammered metal.' }),
    ]),
    PHYSICAL_REACTION: Object.freeze([
        Object.freeze({ group: 'wild', text: 'A tremor runs through the ground near {place}, enough to rattle your teeth.' }),
        Object.freeze({ group: 'town', text: 'A bell close to {place} rings hard enough that your chest hums.' }),
        Object.freeze({ group: 'indoors', text: 'The floor creaks loudly under you, as if it shifted beneath the boards.' }),
        Object.freeze({ group: 'road', text: 'Loose stone shifts under your feet on the road near {place}.' }),
        Object.freeze({ group: 'water', text: 'A wave slaps the landing at {place} hard enough to splash your boots.' }),
    ]),
    OBJECT_DISCOVERY: Object.freeze([
        Object.freeze({ group: 'wild', text: 'Something pale glints in the leaf litter near {place}, half buried.' }),
        Object.freeze({ group: 'town', text: 'A folded paper is pushed under a gap in a wall at {place}.' }),
        Object.freeze({ group: 'indoors', text: 'A loose board in {place} shows a gap with something wrapped inside.' }),
        Object.freeze({ group: 'road', text: 'A dropped purse lies in the verge near {place}, no one close by.' }),
        Object.freeze({ group: 'water', text: 'Something catches the light in the shallows by {place}.' }),
    ]),
    OUTSIDE_INTRUSION: Object.freeze([
        Object.freeze({ group: 'wild', text: 'Riders cross the clearing near {place}, far off, heading for the road.' }),
        Object.freeze({ group: 'town', text: 'Strangers in unfamiliar cloaks walk through {place} asking questions about newcomers.' }),
        Object.freeze({ group: 'indoors', text: 'Someone knocks at the door of {place} and waits without giving a name.' }),
        Object.freeze({ group: 'road', text: 'A column of riders comes up the road behind you near {place}.' }),
        Object.freeze({ group: 'water', text: 'A boat with no lights slides past the landing at {place}.' }),
    ]),
    MEMORY_TRIGGER: Object.freeze([
        Object.freeze({ group: 'wild', text: '{name} stops walking, as if remembering something, then goes on.' }),
        Object.freeze({ group: 'town', text: '{name} hears a familiar tune from an open window and stops in the street.' }),
        Object.freeze({ group: 'indoors', text: '{name} sees an old object on a shelf in {place} and looks at it a long moment.' }),
        Object.freeze({ group: 'road', text: '{name} points at a stone by the road, says nothing, and walks on.' }),
        Object.freeze({ group: 'water', text: '{name} watches the water at {place} for a long moment, as if waiting for someone.' }),
    ]),
    POWER_SHIFT: Object.freeze([
        Object.freeze({ group: 'wild', text: 'Word passes along the track near {place} that a new order has taken hold somewhere.' }),
        Object.freeze({ group: 'town', text: 'A notice on a wall near {place} is replaced overnight; the old one lies torn beneath.' }),
        Object.freeze({ group: 'indoors', text: 'A message is handed to the keeper of {place}, read twice, and put in the lamp.' }),
        Object.freeze({ group: 'road', text: 'A column of guards crosses the road near {place} and every traveller steps aside.' }),
        Object.freeze({ group: 'water', text: 'New landing rules are posted at {place}, the paint still wet.' }),
    ]),
});

const WEATHERS = Object.freeze(['rain', 'wind', 'fog', 'snow', 'heat']);
const GROUP_WORDS = Object.freeze({
    water: ['port', 'harbour', 'harbor', 'quay', 'dock', 'pier', 'lake', 'river', 'shore', 'ferry', 'coast', 'sea'],
    indoors: ['inn', 'tavern', 'temple', 'castle', 'tower', 'dungeon', 'cave', 'hall', 'house', 'shop', 'keep', 'cellar', 'chapel'],
    town: ['city', 'town', 'village', 'market', 'square', 'district', 'hamlet'],
    wild: ['forest', 'wood', 'woods', 'mountain', 'hill', 'moor', 'field', 'plain', 'marsh', 'camp', 'grove', 'valley'],
    road: ['road', 'bridge', 'crossroads', 'gate', 'pass', 'ford', 'landmark', 'ruin', 'ruins', 'trail', 'path'],
});
const GROUP_ORDER = Object.freeze(['water', 'indoors', 'town', 'wild', 'road']);

const count = value => (Number.isSafeInteger(value) && value > 0 ? value : 0);
const unitOf = value => (Number.isFinite(value) ? Math.max(0, Math.min(0.999999999, value)) : 0);

/** 'std' when the counts give the Standard table (3+ named, some off-screen), else 'duo'. */
export function tableFor({ named = 0, offscreen = 0 } = {}) {
    return count(named) >= STANDARD_MIN_NAMED && count(offscreen) >= STANDARD_MIN_OFFSCREEN ? STANDARD : DUO;
}

/** The d20 from one draw in [0, 1): 1 to 20. */
export const d20Of = unit => 1 + Math.floor(unitOf(unit) * 20);

/** The index of a pick among `length` from one draw in [0, 1); -1 when there is nothing to pick. */
export function pickIndex(length, unit) {
    return count(length) ? Math.floor(unitOf(unit) * count(length)) : -1;
}

/** The three draws of a roll, in DRAW_ORDER: `{ d20, actor, line }` as units in [0, 1). `rng` is ctx.rng (or any draw). */
export function drawsFrom(rng) {
    const out = {};
    for (const name of DRAW_ORDER) out[name] = unitOf(rng());
    return out;
}

/** The place group of an atlas place kind (`'inn/tavern'`, `'Forest'`, `'river port'`): the first group whose words it has. */
export function placeGroupOf(kind) {
    const words = String(kind ?? '').toLowerCase().split(/[\s/,;|-]+/).filter(Boolean);
    for (const group of GROUP_ORDER) {
        if (words.some(word => GROUP_WORDS[group].includes(word))) return group;
    }
    return DEFAULT_GROUP;
}

/** The weather words the ENV_SHIFT lines know: a line with another weather never shows. */
export const weatherOf = weather => (WEATHERS.includes(weather) ? weather : null);

/** The flavour lines of `kind` at this place group and weather (templates, unfilled); [] for none. */
export function flavourLines(kind, group = DEFAULT_GROUP, weather = null) {
    const lines = FLAVOUR[kind] ?? [];
    const now = weatherOf(weather);
    return lines.filter(line => line.group === group && (line.weather === undefined || line.weather === now)).map(line => line.text);
}

/** Whether `kind` can happen here with these counts (and is not in `blocked`): CALM always can; a flavour kind needs a line; an effect kind needs its actor. */
export function possibleKind(kind, { group = DEFAULT_GROUP, weather = null, counts = {}, blocked = null } = {}) {
    if (kind === 'CALM') return true;
    // `blocked`: kinds the caller found it cannot build here (an effect with no one to act on), stepped past like an impossible one.
    if (blocked?.has?.(kind)) return false;
    const need = ACTOR_NEEDS[kind];
    if (need === undefined) return false;
    if (need !== 'none' && count(counts?.[need]) === 0) return false;
    return FLAVOUR[kind] ? flavourLines(kind, group, weather).length > 0 : true;
}

/**
 * The entry a d20 gives at this place and with these counts: the row's kind, or, when it cannot happen here, the next
 * row down (wrapping) until one can. `{ kind, d20, table, steps }`; `steps` counts the rows passed. Draws nothing.
 */
export function resolveKind(tableId, d20, context = {}) {
    const table = TABLES[tableId] ? tableId : DUO;
    const rows = TABLES[table].rows;
    const roll = Number.isFinite(d20) ? Math.min(20, Math.max(1, Math.trunc(d20))) : 1;
    let index = rows.findIndex(entry => roll >= entry.from && roll <= entry.to);
    let steps = 0;
    while (!possibleKind(rows[index].kind, context)) {
        index = (index + 1) % rows.length;
        steps += 1;
    }
    return { kind: rows[index].kind, d20: roll, table, steps };
}

/** The flavour template of `kind` picked with one `line` draw; '' when the kind has no line here. */
export function flavourFor(kind, unit, { group = DEFAULT_GROUP, weather = null } = {}) {
    const lines = flavourLines(kind, group, weather);
    const at = pickIndex(lines.length, unit);
    return at < 0 ? '' : lines[at];
}

/** A slot value as plain text: no braces, angle brackets or line breaks; collapsed spaces; cut by code points. */
export function plainSlot(value, max = SLOT_MAX) {
    const text = String(value ?? '').replace(/[{}<>\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
    return Array.from(text).slice(0, max).join('');
}

/** The line with {name} and {place} filled; '' when it names someone and there is no name. {place} falls back to "here". */
export function fillSlots(text, { name = '', place = '' } = {}) {
    const line = String(text ?? '');
    const who = plainSlot(name);
    if (line.includes('{name}') && !who) return '';
    return line.replaceAll('{name}', who).replaceAll('{place}', plainSlot(place) || 'here');
}
