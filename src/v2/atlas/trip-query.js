// Story Director v2, atlas part: the trip as screens read it (feature `story-director.trip`; pure).
//
// `atlas.trip` → the trip at the state it is asked on (a reply's card gets that reply's), with the movers {{user}} knows of, or null while the
// feature is off or there is neither. Nothing is stored here: the position comes from the story time against the planned legs (trip.js).

import { lineKey } from '../../changes.js';
import { parseLeg } from '../../routes.js';
import { scenePlace } from './note.js';
import { calendarOf, dateText, tripView } from './trip.js';
import { packWorld, worldOf } from './world.js';

export const MOVERS_SHOWN = 8;
// The thread kinds behind the scenes (screens/reveal.js BEHIND): what world/known.js never shows, so neither do the movers.
const BEHIND = new Set(['agenda', 'clock', 'beat', 'secret']);
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isInt = value => Number.isSafeInteger(value);
const text = value => (typeof value === 'string' || typeof value === 'number' ? String(value) : '').replace(/[\p{Cc}\p{Cf}]+/gu, ' ').replace(/\s+/g, ' ').trim();
const cut = (value, max) => { const chars = Array.from(text(value)); return chars.length <= max ? chars.join('') : `${chars.slice(0, max - 1).join('').trimEnd()}…`; };

const queryOf = tools => (typeof tools?.query === 'function' ? (name, args) => tools.query(name, args) : null);

function ask(query, name, fallback) {
    if (!query) return fallback;
    try {
        const out = query(name, {});
        return out === undefined ? fallback : out;
    } catch {
        return fallback;
    }
}

/**
 * The movers {{user}} knows of: the Director's open event threads with a `leg:` between two places on the map and an `arrive:` still ahead
 * (a courier, a caravan, a marching army the story told). What world/known.js keeps from {{user}} stays out: agendas, clocks, beats and secrets,
 * anything the arc planner made, and an event named like one of those. `[{ id, name, summary, from, to, fromId, toId, arrive, t }]`, `t` the
 * share of the leg done (from when the leg was written to its arrival), soonest arrival first.
 */
export function moversOf(state, world, { now, calendar }) {
    const director = state?.domains?.director;
    const threads = Object.values(isRecord(director?.threads) ? director.threads : {}).filter(isRecord);
    if (!isInt(now) || !threads.length) return [];
    const hidden = new Set();
    for (const thread of threads) if (BEHIND.has(thread.kind)) hidden.add(lineKey(text(thread.key)));
    for (const arc of Object.values(isRecord(state?.domains?.arc?.arcs) ? state.domains.arc.arcs : {})) if (isRecord(arc)) hidden.add(lineKey(text(arc.key)));
    const out = [];
    for (const thread of threads) {
        if (thread.kind !== 'event' || thread.status !== 'active' || thread.ended || thread.track?.arc || thread.offer) continue;
        if (hidden.has(lineKey(text(thread.key)))) continue;
        const legText = text(thread.fields?.leg);
        const arriveText = text(thread.fields?.arrive);
        if (!legText || !arriveText) continue;
        const leg = parseLeg(null, legText);
        const [from, to] = leg ? [world.find(leg.fromText), world.find(leg.toText)] : [null, null];
        if (!from || !to || from.id === to.id || from.hidden || to.hidden) continue;
        let arrive = null;
        try { arrive = calendar.parse(arriveText, { reference: now }); } catch { arrive = null; }
        if (!arrive || !Number.isFinite(arrive.abs)) continue;
        const at = Math.round(arrive.abs);
        if (at <= now) continue;
        const started = [thread.track?.legSince?.time, thread.track?.created?.time].find(isInt);
        const t = isInt(started) && at > started ? Math.min(1, Math.max(0, (now - started) / (at - started))) : 0.5;
        out.push({
            id: text(thread.id), name: cut(thread.key, 80), summary: cut(thread.summary, 80), from: from.name, to: to.name, fromId: from.id, toId: to.id,
            arrive: dateText(calendar, at, now), t: Math.round(t * 1000) / 1000, at,
        });
    }
    return out.sort((a, b) => a.at - b.at || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).slice(0, MOVERS_SHOWN).map(({ at, ...mover }) => mover);
}

/**
 * `atlas.trip`: `{ on, ...tripView, legs: [… with fromId, toId], you: { fromId, toId, t } | null, movers, hasMovers }` or null.
 * `on`: there is a trip (else only movers). Tagged with the feature (index.js), so Story Block answers null while it is off.
 */
export function tripQuery(state, _args, tools) {
    const atlas = state?.domains?.atlas;
    if (!atlas) return null;
    const query = queryOf(tools);
    const asked = ask(query, 'director.time', null);
    const minutes = isInt(asked?.minutes) ? asked.minutes : state?.domains?.director?.time?.minutes;
    const now = isInt(minutes) ? minutes : null;
    if (now === null) return null;
    const calendar = calendarOf(query ? (name, args) => query(name, args) : null);
    const world = worldOf(atlas, packWorld(query));
    const here = scenePlace({ state, query }).name;
    const view = tripView(atlas, { now, here, calendar });
    const movers = moversOf(state, world, { now, calendar });
    if (!view && !movers.length) return null;
    const idOf = name => world.find(name)?.id ?? '';
    const base = view ? {
        ...view,
        legs: view.legs.map(leg => ({ ...leg, fromId: idOf(leg.from), toId: idOf(leg.to) })),
        you: view.phase === 'road' ? { fromId: idOf(view.from), toId: idOf(view.next), t: view.of > 0 ? Math.round((view.along / view.of) * 1000) / 1000 : 0, along: view.along, of: view.of } : null,
    } : { phase: '', legs: [], you: null, row: '' };
    return { on: Boolean(view), ...base, movers, hasMovers: movers.length > 0 };
}
