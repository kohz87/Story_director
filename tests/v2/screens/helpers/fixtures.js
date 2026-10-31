// Fixture states for the screens part's tests, in the documented shapes: `director` (MODULES §C1),
// `scene` and `inventory` (SPEC §7), `combat` (MODULES §B3). Queries run as Story Block runs them
// (SPEC §6, MODULES §F3): `(state, args, tools)` with `tools.query` over the same state, answers
// copied. The Director's own queries are the real tracker and quests parts'; other modules' are fakes.

import { PRESETS, makeCalendar } from '../../../../src/calendar.js';
import { part as tracker } from '../../../../src/v2/tracker/index.js';
import { part as arc } from '../../../../src/v2/arc/index.js';
import { part as atlas } from '../../../../src/v2/atlas/index.js';
import { createScreensPart } from '../../../../src/v2/screens/index.js';

export const calendar = makeCalendar(PRESETS.gregorian);
export const at = words => calendar.parse(words, { reference: null }).abs;

function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const child of Object.values(value)) deepFreeze(child);
    }
    return value;
}

let order = 0;
/** A thread record (MODULES §C1). */
export function thread(id, kind, key, fields = {}, more = {}) {
    order += 1;
    return {
        id, kind, key, summary: '', fields, status: 'active', offer: false, taken: null, ended: null,
        target: null, reward: null, rev: 1, track: { order }, ...more,
    };
}

export const closed = (outcome, rev, reason = '') => ({ status: 'resolved', ended: { rev, reason, outcome }, rev });

/** A State document with these threads, scene, stacks and beaten fights. */
export function makeState({ rev = 20, minutes = null, threads = [], place = {}, present = [], stacks = [], beaten = [], problems = [] } = {}) {
    const defs = {};
    const stackRecords = {};
    for (const [i, stack] of stacks.entries()) {
        const defId = `story/${stack.name.toLowerCase().replace(/\s+/g, '-')}`;
        defs[defId] = { id: defId, name: stack.name, kind: 'goods', rarity: 'common', value: 0, stack: true, slot: null, stats: {}, effect: {}, tags: [], note: '' };
        stackRecords[`st_0000000${i}`] = { id: `st_0000000${i}`, def: defId, qty: stack.qty, owner: 'party', equipped: null, note: '', from: '' };
    }
    return deepFreeze({
        v: 2,
        meta: { rev, claims: {} },
        domains: {
            director: {
                time: { minutes },
                threads: Object.fromEntries(threads.map(record => [record.id, record])),
                keys: Object.fromEntries(threads.map(record => [record.key.toLowerCase(), record.id])),
                problems,
                turn: { n: 3, reply: null, index: -1, from: null, quests: [], lone: null },
            },
            scene: { place: { name: '', kind: '', region: '', ...place }, present },
            inventory: { defs, stacks: stackRecords, wallets: {}, aliases: {} },
            combat: { offers: [], session: null, beaten, last: null },
        },
    });
}

const fakes = {
    'combat.foesBeaten': (state, { sinceRev } = {}) => (state.domains.combat?.beaten ?? []).filter(entry => !Number.isInteger(sinceRev) || entry.rev > sinceRev),
    'inventory.items': state => Object.values(state.domains.inventory?.stacks ?? {}).map(stack => ({
        stack: stack.id, def: stack.def, name: state.domains.inventory.defs[stack.def]?.name ?? '', kind: 'goods', qty: stack.qty, owner: stack.owner, equipped: null, note: '',
    })),
};

/** Every query the screens bind to, as Story Block's registry would hold them. */
export function makeQueries({ settings = { calendar: PRESETS.gregorian } } = {}) {
    return { ...fakes, ...tracker.queries, ...arc.queries, 'atlas.trip': atlas.queries['atlas.trip'], ...createScreensPart({ settings }).queries };
}

/** `run(state, name, args)` like Story Block's runQuery: tools.query over the same state, plain copies. */
export function makeRunner(queries = makeQueries()) {
    const calls = [];
    function run(state, name, args) {
        const fn = queries[name];
        if (!fn) throw new Error(`no module answers the query "${name}"`);
        calls.push({ name, args, state });
        const tools = Object.freeze({ query: (other, otherArgs) => run(state, other, otherArgs) });
        const answer = fn(state, args === undefined ? undefined : structuredClone(args), tools);
        return answer === undefined ? undefined : structuredClone(answer);
    }
    return { run, calls };
}

// ---------------------------------------------------------------------------------------------------
// The story the tests read

export const wolves = (more = {}) => thread('th_wolves01', 'quest', 'East Bluff Wolves',
    { goal: 'Clear at least 3 wolves from East Bluff', giver: 'Orsa', step: 'Hunt along the ridge' },
    { taken: { rev: 10 }, target: { noun: 'wolves', count: 3, kind: 'foes' }, reward: { amount: 1, each: true, unit: 'coin', text: '1 coin each wolf' }, rev: 12, ...more });

export const pelts = (more = {}) => thread('th_pelts001', 'quest', 'Tanner Pelts',
    { goal: 'Bring 5 wolf pelts', giver: 'Hesk the tanner' },
    { taken: { rev: 9 }, target: { noun: 'wolf pelt', count: 5, kind: 'items' }, rev: 11, ...more });

export const rats = (more = {}) => thread('th_rats0001', 'quest', 'Granary Rats',
    { goal: 'kill 6 rats in the granary', giver: 'Miller Fenna', reward: '5 coin' }, { offer: true, rev: 14, ...more });

export const ring = (more = {}) => thread('th_ring0001', 'quest', 'Lost Ring', { goal: 'find the ring' }, { taken: { rev: 2 }, ...closed('done', 8, 'returned it'), ...more });

export const fair = (more = {}) => thread('th_fair0001', 'event', 'Harvest Fair', { on: 'June 14, 2025' }, { summary: 'the fair opens in the square', ...more });
export const raid = (more = {}) => thread('th_raid0001', 'clock', 'Bandit Raid', { due: 'June 12, 2025, 8:00 pm' }, { summary: 'the bandits ride on the mill', ...more });
export const plot = (more = {}) => thread('th_plot0001', 'secret', 'The Reeve Is Bought', { due: 'June 11, 2025' }, { summary: 'paid by the bandits', ...more });
export const smuggler = (more = {}) => thread('th_smug0001', 'agenda', 'Smuggler Vane', { now: 'the docks', then: 'meet the reeve' }, { summary: 'moving crates at night', ...more });

/** The head: in Bluewatch on June 11, 2025, 9:00 am, eight wolves beaten since the hunt was taken. */
export function headState(more = {}) {
    return makeState({
        rev: 20,
        minutes: at('June 11, 2025, 9:00 am'),
        threads: [wolves(), pelts(), rats(), ring(), fair(), raid(), plot(), smuggler()],
        place: { name: 'Bluewatch Village', kind: 'settlement', region: 'Eastmarch' },
        present: ['Orsa'],
        stacks: [{ name: 'Wolf Pelt', qty: 2 }],
        beaten: [{ rev: 11, foes: [{ name: 'Wolf', count: 8 }], won: true }],
        problems: [{ rev: 18, kind: 'quest', text: '"Old Mill" is not tracked; write + quest first.' }, { rev: 19, kind: 'time', text: 'The story time is not set yet.' }],
        ...more,
    });
}

/** An earlier reply: on the Mill Road, June 10, evening; only the pelts quest open, before the hunt. */
export function earlierState() {
    return makeState({
        rev: 9,
        minutes: at('June 10, 2025, 6:30 pm'),
        threads: [pelts({ rev: 9 }), rats({ rev: 7 })],
        place: { name: 'Mill Road', kind: 'wild', region: 'Eastmarch' },
        stacks: [{ name: 'Wolf Pelt', qty: 1 }],
    });
}
