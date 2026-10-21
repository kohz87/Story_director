// A fake Story Block transaction for the quests part's tests (SPEC §3.2 ctx plus query, and
// `rev`: the meta.rev this receipt will carry). Handlers run on a copy of the state; their
// changes are kept only when they return, so a rejection saves nothing, as in the real bus.
// Other modules' queries and commands are fakes in the shapes of MODULES §B and SPEC §7.

const clone = value => structuredClone(value);
function freeze(value) {
    if (value && typeof value === 'object') {
        Object.freeze(value);
        for (const key of Object.keys(value)) freeze(value[key]);
    }
    return value;
}

function codeError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

// sfc32 from a uint32 seed, so ctx.rng is deterministic in tests.
function sfc32(seed) {
    let a = 0x9e3779b9; let b = 0x243f6a88; let c = 0xb7e15162; let d = seed >>> 0;
    return () => {
        a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
        const t = (a + b) | 0; a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11);
        d = (d + 1) | 0; const r = (t + d) | 0; c = (c + r) | 0;
        return (r >>> 0) / 4294967296;
    };
}

/** Fake commands other modules own, as `(state, payload) => result`, mutating the transaction state. */
export const fakeCommands = {
    // MODULES §F1/§F5: { owner, amount, note? }, one integer per owner under `coin`.
    'wallet.receive'(state, payload) {
        const { owner, amount } = payload;
        if (Object.keys(payload).some(key => !['owner', 'amount', 'note'].includes(key))) throw codeError('INVALID', 'Unknown field.');
        if (!Number.isSafeInteger(amount) || amount < 0) throw codeError('INVALID', 'Bad amount.');
        const wallets = state.domains.inventory.wallets;
        wallets[owner] ??= {};
        wallets[owner].coin = (wallets[owner].coin ?? 0) + amount;
        return { summary: `${amount} gold received.` };
    },
    'inventory.consume'(state, { stack, qty }) {
        const record = state.domains.inventory.stacks[stack];
        if (!record || record.qty < qty) throw codeError('NOT_ENOUGH', 'Not enough left.');
        record.qty -= qty;
        if (record.qty === 0) delete state.domains.inventory.stacks[stack];
        return { summary: 'consumed' };
    },
};

export const xpCommand = {
    'party.grantXp'(state, payload) {
        state.domains.party.xpLog.push(payload);
        return { summary: 'xp', data: { xp: 40 } };
    },
};

/** Fake queries other modules own, `(state, args)`. */
export const fakeQueries = {
    'combat.foesBeaten'(state, { sinceRev } = {}) {
        return clone(state.domains.combat.beaten.filter(entry => !Number.isInteger(sinceRev) || entry.rev > sinceRev));
    },
    'inventory.items'(state) {
        const { stacks, defs } = state.domains.inventory;
        return Object.values(stacks).map(stack => ({ ...clone(stack), name: defs[stack.def]?.name ?? '' }));
    },
    'inventory.currency'(state) {
        return clone(state.currency ?? { name: 'gold', short: 'g' });
    },
    'party.pc'(state) {
        const party = state.domains.party;
        return party.pc ? clone(party.actors[party.pc]) : null;
    },
};

export function quest(id, key, fields = {}, more = {}) {
    return {
        id, kind: 'quest', key, summary: '', fields: { giver: '', step: '', goal: '', due: '', reward: '', type: '', ...fields },
        status: 'active', offer: false, taken: null, ended: null, target: null, reward: null, rev: 1, ...more,
    };
}

/** A State with scene, inventory, party, combat and director slices. */
export function makeState({ threads = [], scene = {}, beaten = [], stacks = [], defs = [], rev = 10, claims = {} } = {}) {
    const director = { time: { minutes: null }, threads: {}, keys: {}, problems: [] };
    for (const thread of threads) {
        director.threads[thread.id] = thread;
        director.keys[thread.key.toLowerCase()] = thread.id;
    }
    return {
        v: 2,
        meta: { rev, claims: { ...claims } },
        domains: {
            scene: { place: { name: '', kind: '', region: '', ...(scene.place ?? {}) }, present: scene.present ?? [] },
            inventory: {
                defs: Object.fromEntries(defs.map(def => [def.id, { kind: 'goods', rarity: 'common', value: 0, ...def }])),
                stacks: Object.fromEntries(stacks.map(stack => [stack.id, { owner: 'party', equipped: null, note: '', from: '', ...stack }])),
                wallets: { party: {} },
                aliases: {},
            },
            party: { pc: 'ac_astra001', order: ['ac_astra001'], actors: { ac_astra001: { id: 'ac_astra001', name: 'Astra' } }, xpLog: [] },
            combat: { offers: [], session: null, beaten, last: null },
            director,
        },
    };
}

/**
 * A host for one module's handlers: `run(handler, payload)` → `{ ok, receipt }` or
 * `{ ok: false, code, message }`; `state` is replaced only on success.
 */
export function makeHost(state, { commands = fakeCommands, queries = fakeQueries, owns = ['director'] } = {}) {
    const host = { state, calls: [], seed: 7 };
    host.run = (handler, payload = {}) => {
        const working = clone(host.state);
        const rev = working.meta.rev + 1;
        const calls = [];
        const ctx = {
            receiptId: `rc_${String(rev).padStart(8, '0')}`,
            rev,
            read: domain => freeze(clone(working.domains[domain])),
            draft(domain) {
                if (!owns.includes(domain)) throw codeError('NOT_OWNER', `Not the owner of ${domain}.`);
                return working.domains[domain];
            },
            call(type, sub) {
                calls.push({ type, payload: clone(sub) });
                if (!Object.hasOwn(commands, type)) throw codeError('UNKNOWN_COMMAND', `There is no command ${type}.`);
                return commands[type](working, sub);
            },
            claim(key) {
                if (working.meta.claims[key]) return false;
                working.meta.claims[key] = true;
                return true;
            },
            query(name, args) {
                if (!Object.hasOwn(queries, name)) throw codeError('NOT_FOUND', `No query ${name}.`);
                return queries[name](working, args);
            },
            rng: sfc32(host.seed),
            roll: () => ({ total: 0, dice: [] }),
            settings: () => ({}),
            time: () => working.domains.director.time.minutes,
            fail(code, message) { throw codeError(code, message); },
        };
        let result;
        try {
            result = handler(ctx, payload);
        } catch (error) {
            host.calls.push(...calls.map(call => ({ ...call, rejected: true })));
            return { ok: false, code: error.code ?? 'FAILED', message: error.message };
        }
        working.meta.rev = rev;
        host.state = working;
        host.calls.push(...calls);
        return { ok: true, receipt: { id: ctx.receiptId, rev, cause: 'ui', narrate: result.narrate !== false, summary: result.summary, data: result.data ?? {} } };
    };
    return host;
}
