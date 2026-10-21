// A fake command context (SPEC §3.2) and a small change-line reader (SPEC §4.4) for the tracker
// part's tests. Commit works as Story Block's does in outline: the handler runs on drafts, the
// touched domains are validated, and a throw or a validation error keeps the state as it was.

import { part } from '../../../../src/v2/tracker/index.js';

function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const child of Object.values(value)) deepFreeze(child);
    }
    return value;
}

// sfc32, as SPEC §3.2 names it: the handler's only randomness.
function sfc32(seed) {
    let a = 0x9e3779b9;
    let b = 0x243f6a88;
    let c = 0xb7e15162;
    let d = seed >>> 0;
    return () => {
        a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
        const t = (a + b | 0) + d | 0;
        d = d + 1 | 0;
        a = b ^ b >>> 9;
        b = c + (c << 3) | 0;
        c = c << 21 | c >>> 11;
        c = c + t | 0;
        return (t >>> 0) / 4294967296;
    };
}

/** A state with only the director domain (and a scene for the note's place). */
export function makeState({ place = '' } = {}) {
    return deepFreeze({
        v: 2,
        meta: { rev: 0, claims: {} },
        domains: {
            director: part.domains.director.initial(),
            scene: { place: { name: place, kind: '', region: '' }, present: [] },
        },
    });
}

export class Rejected extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

/**
 * Runs `handler(ctx, payload)` as a command on `state`: `{ ok, state, result, ctx }`, or
 * `{ ok: false, code, message, state }` with the state untouched.
 */
export function runCommand(state, handler, payload, { said = null, settings = {}, seed = 7, carrier = undefined, owned = ['director'], call = null } = {}) {
    const rev = state.meta.rev + 1;
    const drafts = {};
    const claims = { ...state.meta.claims };
    const random = sfc32(seed);
    const ctx = {
        rev,
        receiptId: `rc_test${String(rev).padStart(4, '0')}`,
        chat: { length: 0, lastUser: said },
        ...(carrier === undefined ? {} : { carrier }),
        read: domain => deepFreeze(structuredClone(drafts[domain] ?? state.domains[domain])),
        draft: domain => {
            if (!owned.includes(domain)) throw new Rejected('NOT_OWNER', `This module does not own ${domain}.`);
            drafts[domain] ??= structuredClone(state.domains[domain]);
            return drafts[domain];
        },
        call: call ?? (type => { throw new Rejected('UNKNOWN_COMMAND', `No command ${type} in this test.`); }),
        claim: key => (claims[key] ? false : (claims[key] = true)),
        rng: random,
        roll: () => ({ total: 0, dice: [] }),
        settings: () => structuredClone(settings),
        time: () => (drafts.director ?? state.domains.director).time.minutes,
        fail: (code, message) => { throw new Rejected(code, message); },
        query: (name, args) => part.queries[name]({ ...state, domains: { ...state.domains, ...drafts } }, args),
    };
    let result;
    try {
        result = handler(ctx, payload);
    } catch (error) {
        return { ok: false, code: error.code ?? 'FAILED', message: error.message, state };
    }
    for (const [domain, draft] of Object.entries(drafts)) {
        const errors = domain === 'director' ? part.domains.director.validate(draft, state) : [];
        if (errors.length) return { ok: false, code: 'INVALID', message: errors.join(' '), state };
    }
    const next = deepFreeze({
        ...state,
        meta: { rev, claims },
        domains: { ...state.domains, ...structuredClone(drafts) },
    });
    return { ok: true, state: next, result, ctx };
}

/** One change line read as SPEC §4.4 says: `op kind Name[ — text][ | label: value]*`. */
export function readLine(raw, index = 0) {
    const match = String(raw).trim().match(/^([+\-~!?])\s+(\S+)\s+(.*)$/s);
    if (!match) throw new Error(`not a change line: ${raw}`);
    const [head, ...rest] = match[3].split(/\s*\|\s*/);
    const dash = head.match(/\s+[—–]\s+|\s+-\s+/);
    const name = (dash ? head.slice(0, dash.index) : head).trim();
    const text = dash ? head.slice(dash.index + dash[0].length).trim() : '';
    const labels = {};
    for (const part of rest) {
        const colon = part.indexOf(':');
        if (colon > 0) labels[part.slice(0, colon).trim().toLowerCase()] = part.slice(colon + 1).trim();
    }
    return { op: match[1], kind: match[2].toLowerCase(), name, text, labels, raw: String(raw).trim(), index };
}

/**
 * A reply's Director lines, each run as its own story command in order (SPEC §4.2): the final
 * state, every result, and the rejected lines.
 */
export function reply(state, block, options = {}) {
    const lines = String(block).split('\n').map(line => line.trim()).filter(Boolean).map(readLine);
    const results = [];
    for (const line of lines) {
        const kind = part.kinds[line.kind];
        if (!kind) throw new Error(`unknown kind ${line.kind}`);
        const run = runCommand(state, kind.apply, line, options);
        if (!run.ok) throw new Error(`${line.raw}: ${run.code} ${run.message}`);
        state = run.state;
        results.push(run.result);
    }
    return { state, results };
}

/** The replies in order, each `{ lines, said }`: the state after the last. */
export function story(replies, state = makeState()) {
    for (const entry of replies) state = reply(state, entry.lines, entry).state;
    return state;
}

/** The thread with this key or alias, as the query gives it. */
export function thread(state, key) {
    return part.queries['director.thread'](state, { key });
}

/** The director's problems of the latest reply. */
export function lastProblems(state) {
    const director = state.domains.director;
    return director.problems.filter(problem => problem.turn === director.turn.n);
}
